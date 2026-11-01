import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { randomUUID } from "node:crypto";

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
  let work = new Map<string, "running" | "queued">();
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
    work = new Map();
    request = new Set();
    recovery = new Map();
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
    for (const id of request) work.delete(id);
    request.clear();
  });
  return {
    reserve() {
      const owned = work;
      const ownedRecovery = recovery;
      const id = randomUUID();
      owned.set(id, "running");
      return {
        abandon: () => owned.delete(id),
        retain: (diagnostic: string) => ownedRecovery.set(id, diagnostic),
        send(message: Parameters<ExtensionAPI["sendMessage"]>[0]) {
          owned.set(id, "queued");
          pi.sendMessage(
            {
              ...message,
              details: {
                ...(message.details && typeof message.details === "object" ? message.details : {}),
                subagentOutcomeId: id,
              },
            },
            { triggerTurn: true, deliverAs: "steer" },
          );
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
