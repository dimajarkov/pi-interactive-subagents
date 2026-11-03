import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import {
  journalPath,
  unresolvedDelegations,
  writeDelegation,
  type DelegationRecord,
} from "./delegation-journal.ts";

const channel = "interactive-subagents:outstanding-work";
interface ExitQuery {
  sessionId: string;
  outstanding: number;
  recovery: string[];
}

/** Host-local coordination between the delegation and autonomous-exit extensions.
 * Each registration owns its work, and each native session gets a fresh generation.
 * A watcher finishing is not enough: its outcome must reach a successful model response.
 */
export function requireDelegationLifecycleBus(pi: ExtensionAPI) {
  if (!pi.events || typeof pi.events.on !== "function" || typeof pi.events.emit !== "function")
    throw new Error(
      "Interactive subagents require the native host event bus for safe delegation and completion; no child allocated.",
    );
  return pi.events;
}

export function registerDelegationLifecycle(pi: ExtensionAPI) {
  const bus = requireDelegationLifecycleBus(pi);
  let sessionId: string | undefined;
  let sessionFile: string | undefined;
  let work = new Map<string, "running" | "queued">();
  let records = new Map<string, DelegationRecord>();
  let request = new Set<string>();
  let recovery = new Map<string, string>();
  bus.on(channel, (value) => {
    const query = value as ExitQuery;
    if (sessionId === query.sessionId) {
      query.outstanding += work.size;
      query.recovery.push(...recovery.values());
    }
  });
  pi.on("session_start", (_event, ctx) => {
    sessionId = ctx.sessionManager.getSessionId();
    sessionFile = ctx.sessionManager.getSessionFile() ?? undefined;
    work = new Map();
    records = new Map();
    request = new Set();
    recovery = new Map();
    if (!sessionFile) return;
    const transcript = existsSync(sessionFile)
      ? readFileSync(sessionFile, "utf8")
          .split("\n")
          .filter(Boolean)
          .map((line) => {
            try {
              return JSON.parse(line);
            } catch {
              return null;
            }
          })
      : [];
    for (const record of unresolvedDelegations(sessionFile)) {
      records.set(record.id, record);
      work.set(record.id, record.state === "queued" ? "queued" : "running");
      if (record.state === "running" || record.recovery || record.parentSessionId !== sessionId) {
        recovery.set(
          record.id,
          record.recovery ??
            `Original delegation is unresolved: ${journalPath(sessionFile, record.id)}. Inspect its original child/session identity; no automatic adoption or retry was attempted.`,
        );
      } else if (
        record.message &&
        !transcript.some((entry) => entry?.details?.subagentOutcomeId === record.id)
      ) {
        pi.sendMessage(record.message, { triggerTurn: true, deliverAs: "steer" });
      }
    }
  });
  pi.on("session_shutdown", () => {
    sessionId = undefined;
  });
  pi.on("context", (event) => {
    request = new Set(
      event.messages.flatMap((message: any) => {
        const id = message.role === "custom" && message.details?.subagentOutcomeId;
        return typeof id === "string" && work.get(id) === "queued" ? [id] : [];
      }),
    );
  });
  pi.on("message_end", (event) => {
    const message = event.message as any;
    if (
      message.role !== "assistant" ||
      message.stopReason === "aborted" ||
      message.stopReason === "error"
    )
      return;
    for (const id of request) {
      if (recovery.has(id)) continue;
      const record = records.get(id);
      if (record && sessionFile) {
        record.state = "settled";
        writeDelegation(sessionFile, record);
      }
      work.delete(id);
    }
    request.clear();
  });
  return {
    reserve(ctx: {
      sessionManager: { getSessionId(): string; getSessionFile(): string | null | undefined };
    }) {
      const ownedFile = ctx.sessionManager.getSessionFile();
      const ownerId = ctx.sessionManager.getSessionId();
      if (!ownerId || !ownedFile)
        throw new Error("Persistent original parent session required for delegation ownership");
      const owned = work;
      const ownedRecords = records;
      const ownedRecovery = recovery;
      const id = randomUUID();
      const record: DelegationRecord = {
        version: 1,
        id,
        parentSessionId: ownerId,
        state: "running",
      };
      writeDelegation(ownedFile, record);
      ownedRecords.set(id, record);
      owned.set(id, "running");
      let deliveryFailed = false;
      return {
        abandon() {
          record.state = "settled";
          writeDelegation(ownedFile, record);
          owned.delete(id);
        },
        bind(child: unknown) {
          record.child = child;
          writeDelegation(ownedFile, record);
        },
        retain(diagnostic: string) {
          ownedRecovery.set(id, diagnostic);
          record.recovery = diagnostic;
          try {
            writeDelegation(ownedFile, record);
          } catch (error) {
            ownedRecovery.set(id, `${diagnostic} Recovery journal update failed: ${String(error)}`);
          }
        },
        send(message: Parameters<ExtensionAPI["sendMessage"]>[0]) {
          if (deliveryFailed || record.state === "queued" || record.state === "settled") return;
          const tagged = {
            ...message,
            details: {
              ...(message.details && typeof message.details === "object" ? message.details : {}),
              subagentOutcomeId: id,
            },
          };
          const queued: DelegationRecord = { ...record, state: "queued", message: tagged };
          try {
            writeDelegation(ownedFile, queued);
          } catch (error) {
            deliveryFailed = true;
            const receipt = journalPath(ownedFile, id);
            const diagnostic = `Outcome journal publication failed: ${receipt}: ${String(error)}. Original delegated ownership remains unresolved; no successful completion was published.`;
            ownedRecovery.set(id, diagnostic);
            record.recovery = diagnostic;
            // Keep the original durable reservation and running hold intact.
            // This one diagnostic wakes the caller but cannot settle that hold.
            pi.sendMessage(
              {
                customType: "subagent_result",
                content: diagnostic,
                display: true,
                details: {
                  ...tagged.details,
                  exitCode: 1,
                  error: "outcome journal persistence failed",
                  cleanupOutcome: "retained",
                  recoveryReceipt: receipt,
                },
              },
              { triggerTurn: true, deliverAs: "steer" },
            );
            return;
          }
          Object.assign(record, queued);
          owned.set(id, "queued");
          pi.sendMessage(tagged, { triggerTurn: true, deliverAs: "steer" });
        },
      };
    },
  };
}

export function outstandingDelegation(pi: ExtensionAPI, ctx: ExtensionContext): number {
  const query: ExitQuery = {
    sessionId: ctx.sessionManager.getSessionId(),
    outstanding: 0,
    recovery: [],
  };
  requireDelegationLifecycleBus(pi).emit(channel, query);
  return query.outstanding;
}

export const outstandingDelegationGuidance =
  "Cannot exit while delegated children or unprocessed child outcomes remain outstanding. " +
  "End your turn normally to wait for automatic child results, then reconcile them before completing or requesting help. " +
  "Do not poll or abandon child sessions.";

export function delegationExitRefusal(pi: ExtensionAPI, ctx: ExtensionContext): string | undefined {
  const query: ExitQuery = {
    sessionId: ctx.sessionManager.getSessionId(),
    outstanding: 0,
    recovery: [],
  };
  requireDelegationLifecycleBus(pi).emit(channel, query);
  if (!query.outstanding) return undefined;
  if (query.recovery.length)
    return (
      "Cannot exit while delegated launch ownership is unresolved. " +
      "Inspect the recorded original launch and recovery receipt; no automatic outcome is guaranteed. " +
      "Do not retry the launch or destroy unverified child sessions.\n" +
      query.recovery.join("\n")
    );
  return outstandingDelegationGuidance;
}
