/** Cooperative control for explicitly managed Herdr jobs.
 * This is a structural facade of the dotfiles-patched native public Pi SDK.
 * Unmanaged children and generic multiplexers never open a control route.
 */
import net from "node:net";
import { randomBytes, randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";

export interface NativeRequest { readonly id: string; readonly correlationId?: string; readonly source?: string; readonly delivery?: string; }
export interface NativeScope extends NativeRequest { readonly requests?: readonly NativeRequest[]; }
export interface ControlContext {
  sessionManager: { getSessionId(): string };
  getUserRequest?: () => NativeScope | undefined;
  getUserRequestPreparation?: () => NativeRequest | undefined;
  isIdle(): boolean;
  hasPendingMessages(): boolean;
  abort(): void | Promise<void>;
  shutdown(): void;
  ui?: { notify(message: string, type?: string): void };
}
export interface ControlSDK {
  on(event: string, handler: (event: any, ctx: ControlContext) => unknown): unknown;
  enqueueMessage?: (message: { customType: string; content: string; display: boolean; details?: object }, options: {deliverAs: "followUp"; correlationId: string}) => {status: "queued"};
}
export interface JobCondition { terminal: { pane_id: string; tab_id: string; terminal_id: string; launch_id: string }; job_id: string; }
export interface AgentCondition { job: JobCondition; connection: string; epoch: string; session: string; }
const MAX_FRAME = 16 * 1024;
const WRITE_TIMEOUT = 5000;
const features = ["input_request_lifecycle_v1", "message_admission_v1", "external_request_correlation_v1"];
function identifier(value: unknown): value is string { return typeof value === "string" && value.length > 0 && value.length <= 256; }
function validCondition(value: any): value is AgentCondition {
  return value && identifier(value.connection) && identifier(value.epoch) && identifier(value.session) && identifier(value.job?.job_id) &&
    ["pane_id", "tab_id", "terminal_id", "launch_id"].every(k => identifier(value.job?.terminal?.[k]));
}

export default function herdrControl(pi: ControlSDK): void {
  const capability = process.env.HERDR_CONTROL_CAPABILITY;
  const version = process.env.HERDR_CONTROL_VERSION;
  const path = process.env.HERDR_CONTROL_SOCKET;
  // Capture once, then remove secrets before a native tool or nested child runs.
  delete process.env.HERDR_CONTROL_CAPABILITY;
  delete process.env.HERDR_CONTROL_VERSION;
  delete process.env.HERDR_CONTROL_SOCKET;
  if (!capability && !version && !path) return;
  let startupFailed = false;
  pi.on("input", () => startupFailed ? {action: "handled"} : {action: "continue"});
  const failStartup = (ctx: ControlContext, detail: string): void => {
    startupFailed = true;
    const message = `Herdr managed control initialization failed: ${detail}`;
    try {
      const sessionFile = process.env.PI_SUBAGENT_SESSION;
      if (sessionFile) writeFileSync(`${sessionFile}.exit`, JSON.stringify({type: "error", errorMessage: message, stopReason: "error"}));
    } catch {
      ctx.ui?.notify("Herdr control failure sidecar could not be written; initialization still stops.", "error");
    } finally {
      try { ctx.ui?.notify(message, "error"); }
      finally { if (typeof ctx.shutdown !== "function") throw new Error("Native public shutdown capability unavailable"); ctx.shutdown(); }
    }
  };
  let attempted = false;
  interface Binding { socket: net.Socket; session: string; epoch: string; ctx: ControlContext; condition?: AgentCondition; accepting: boolean;
    pending?: { id: string; nativeId?: string; scopeId?: string };
    start?: (event: any, ctx: ControlContext) => void;
    end?: (event: any, ctx: ControlContext) => void;
    observe?: () => void;
  }
  let route: Binding | undefined;
  let binding: Binding | undefined;
  function invalidate(message?: string): void {
    const owned = route;
    route = undefined;
    if (owned) { owned.accepting = false; owned.pending = undefined; owned.socket.destroy(); if (message) owned.ctx.ui?.notify(`Herdr cooperative control unavailable: ${message}`, "error"); }
  }
  pi.on("session_shutdown", () => { invalidate(); binding = undefined; });
  const beforeSwitch = () => { if (binding?.pending) return {cancel: true}; invalidate(); };
  pi.on("session_before_switch", beforeSwitch);
  pi.on("session_before_fork", beforeSwitch);
  pi.on("user_request_start", (event, ctx) => binding?.start?.(event, ctx));
  pi.on("user_request_end", (event, ctx) => binding?.end?.(event, ctx));
  pi.on("user_request_prepare", () => binding?.observe?.());
  pi.on("user_request_prepare_end", () => binding?.observe?.());
  pi.on("agent_settled", () => binding?.observe?.());
  pi.on("session_start", async (_event, ctx) => {
    if (attempted) { invalidate(); return; }
    attempted = true;
    if (version !== "1" || !capability || !path || !path.startsWith("/") ||
      typeof pi.enqueueMessage !== "function" || typeof ctx.getUserRequest !== "function" || typeof ctx.getUserRequestPreparation !== "function" || typeof ctx.isIdle !== "function" || typeof ctx.hasPendingMessages !== "function" || typeof ctx.abort !== "function" || typeof ctx.shutdown !== "function") {
      failStartup(ctx, "declared patched native Pi SDK and control v1 required; enrollment refused");
      return;
    }
    const session = ctx.sessionManager.getSessionId();
    if (!identifier(session)) { failStartup(ctx, "native session identity unavailable"); return; }
    const epoch = randomBytes(32).toString("hex");
    const socket = net.createConnection(path);
    const owned: Binding = {socket, session, epoch, ctx, accepting: true};
    binding = owned;
    route = owned;
    const live = () => route === owned && owned.accepting && ctx.sessionManager.getSessionId() === session;
    const write = (frame: object): void => {
      if (!live()) return;
      const bytes = Buffer.from(JSON.stringify(frame) + "\n");
      if (bytes.length > MAX_FRAME) { invalidate("outgoing frame too large"); return; }
      const timer = setTimeout(() => { if (route === owned) invalidate("write deadline exceeded"); }, WRITE_TIMEOUT);
      timer.unref();
      socket.write(bytes, error => { clearTimeout(timer); if (error && route === owned) invalidate("control write failed"); });
    };
    const sameCondition = (value: any): boolean => {
      const expected = owned.condition;
      return validCondition(value) && !!expected && value.connection === expected.connection && value.epoch === expected.epoch &&
        value.session === expected.session && value.job.job_id === expected.job.job_id &&
        ["pane_id", "tab_id", "terminal_id", "launch_id"].every(k => value.job.terminal[k as keyof JobCondition["terminal"]] === expected.job.terminal[k as keyof JobCondition["terminal"]]);
    };
    const ack = (id: string, phase: string, nativeId?: string, error?: string, aborted?: boolean) => write({id, method: "agent.control.ack", params: {condition: owned.condition, request_id: id, phase,
      ...(nativeId ? {native_request_id: nativeId} : {}), ...(error ? {error} : {}), ...(aborted !== undefined ? {aborted} : {})}});
    const used = new Set<string>();
    const aborts = new Map<string, {id: string; accepted: boolean; outcome?: string}>();
    let sequence = 0;
    let activeScope: string | undefined;
    const endedScopes = new Set<string>();
    const members = (scope: NativeScope): readonly NativeRequest[] => scope.requests ?? [scope];
    owned.observe = () => {
      if (!live() || !owned.condition) return;
      const currentScope = ctx.getUserRequest?.();
      const scope = currentScope && !endedScopes.has(currentScope.id) ? currentScope : undefined;
      write({id: randomUUID(), method: "agent.control.observe", params: {condition: owned.condition, sequence: ++sequence,
        ...(scope ? {native_scope_id: scope.id} : {}), native_request_ids: scope ? members(scope).map(r => r.id) : [],
        busy: !!scope || !!ctx.getUserRequestPreparation?.() || !ctx.isIdle() || ctx.hasPendingMessages()}});
    };
    const finishAbort = (scopeId: string, outcome: string) => {
      const operation = aborts.get(scopeId);
      if (!operation) return;
      if (!operation.accepted) {operation.outcome = outcome; return;}
      ack(operation.id, "settled", scopeId, outcome === "failed" ? "native request failed" : undefined, outcome === "interrupted");
      aborts.delete(scopeId);
    };
    owned.start = (event, context) => {
      if (context.sessionManager.getSessionId() !== session) { invalidate("native session changed"); return; }
      if (identifier(event.request?.id)) {activeScope = event.request.id; endedScopes.delete(event.request.id);}
      owned.observe?.();
      const pending = owned.pending;
      if (!pending) return;
      const members: NativeRequest[] = event.request?.requests ?? [event.request];
      const matching = members.filter(member => member?.correlationId === pending.id);
      if (matching.length === 0) return;
      if (matching.length !== 1) {invalidate("ambiguous native request correlation"); return;}
      if (!identifier(matching[0].id) || context.getUserRequest?.()?.id !== event.request?.id) { invalidate("ambiguous native request scope"); return; }
      if (pending.nativeId) { invalidate("duplicate native request admission"); return; }
      pending.nativeId = matching[0].id;
      pending.scopeId = event.request.id;
      ack(pending.id, "accepted", pending.nativeId);
    };
    owned.end = (event, context) => {
      if (context.sessionManager.getSessionId() !== session) {invalidate("native session changed"); return;}
      if (!["completed", "interrupted", "failed"].includes(event.outcome)) {invalidate("unknown native request outcome"); return;}
      if (identifier(event.request?.id)) {endedScopes.add(event.request.id); if (activeScope === event.request.id) activeScope = undefined;}
      if (endedScopes.size > 256) {invalidate("native scope ledger full"); return;}
      finishAbort(event.request?.id, event.outcome);
      owned.observe?.();
      const pending = owned.pending;
      if (!pending || context.sessionManager.getSessionId() !== session || event.request?.id !== pending.scopeId) return;
      const members: NativeRequest[] = event.request?.requests ?? [event.request];
      if (!members.some(member => member?.id === pending.nativeId && member.correlationId === pending.id)) return;
      if (!["completed", "interrupted", "failed"].includes(event.outcome)) { invalidate("unknown native request outcome"); return; }
      ack(pending.id, "settled", pending.nativeId, event.outcome === "failed" ? "native request failed" : undefined, event.outcome === "interrupted");
      owned.pending = undefined;
    };
    const dispatch = (frame: any) => {
      if (!live() || !owned.condition) return;
      // Replies to our connection-local notifications carry no executable method.
      if (!frame.method) { if (frame.error) invalidate("control server rejected a notification"); return; }
      const params = frame.params;
      if (!identifier(frame.id) || !params || frame.id !== params.request_id || !sameCondition(params.condition)) { invalidate("operation binding mismatch"); return; }
      if (used.has(frame.id)) { ack(frame.id, "rejected", undefined, "operation replay"); return; }
      if (used.size >= 256) { invalidate("operation ledger full"); return; }
      used.add(frame.id);
      if (frame.method === "agent.control.abort") {
        const scope = ctx.getUserRequest?.();
        if (!identifier(params.native_request_id) || !Number.isInteger(params.deadline_ms) || params.deadline_ms < 1 || params.deadline_ms > 30000 ||
            !scope || scope.id !== params.native_request_id || scope.id !== activeScope || endedScopes.has(scope.id) || aborts.has(scope.id)) {ack(frame.id, "rejected", undefined, "native scope mismatch or abort outstanding"); return;}
        ack(frame.id, "received");
        // Recheck at the public abort boundary, never infer identity from text or agent kind.
        if (!live() || ctx.getUserRequest?.()?.id !== scope.id || activeScope !== scope.id || endedScopes.has(scope.id)) {ack(frame.id, "rejected", undefined, "native scope changed"); return;}
        const operation = {id: frame.id, accepted: false, outcome: undefined as string | undefined};
        aborts.set(scope.id, operation);
        try {
          const completion = ctx.abort();
          operation.accepted = true;
          ack(frame.id, "accepted", scope.id);
          if (operation.outcome) finishAbort(scope.id, operation.outcome);
          Promise.resolve(completion).catch(() => {if (route === owned) invalidate("native abort failed");});
        } catch {aborts.delete(scope.id); ack(frame.id, "rejected", undefined, "native abort failed");}
        return;
      }
      if (frame.method !== "agent.control.prompt") { ack(frame.id, "rejected", undefined, "unsupported operation"); return; }
      if (typeof params.text !== "string" || !params.text.trim() || !Number.isInteger(params.deadline_ms) || params.deadline_ms < 1 || params.deadline_ms > 30000) { ack(frame.id, "rejected", undefined, "invalid prompt"); return; }
      if (owned.pending || ctx.getUserRequest?.() || ctx.getUserRequestPreparation?.() || !ctx.isIdle() || ctx.hasPendingMessages()) { ack(frame.id, "rejected", undefined, "native request busy or preparing"); return; }
      owned.pending = {id: frame.id};
      ack(frame.id, "received");
      try {
        const receipt = pi.enqueueMessage!({customType: "herdr_control_prompt", content: params.text, display: true, details: {herdrRequestId: frame.id}}, {deliverAs: "followUp", correlationId: frame.id});
        if (receipt?.status !== "queued") throw new Error("unsupported native queue receipt");
      } catch {
        ack(frame.id, "rejected", undefined, "native queue rejected");
        owned.pending = undefined;
      }
    };
    const registration = randomUUID();
    await new Promise<void>(resolve => {
      let buffer = Buffer.alloc(0);
      let resolved = false;
      const finish = () => { if (!resolved) { resolved = true; clearTimeout(timer); resolve(); } };
      const timer = setTimeout(() => { if (route === owned) invalidate("registration deadline exceeded"); finish(); }, WRITE_TIMEOUT);
      socket.on("connect", () => write({id: registration, method: "agent.control.register", params: {capability, version: 1, epoch, session, sdk_features: features}}));
      socket.on("error", () => { if (route === owned) invalidate("control socket failed"); finish(); });
      socket.on("close", () => { if (route === owned) invalidate(); finish(); });
      socket.on("data", chunk => {
        if (!live()) { socket.destroy(); finish(); return; }
        buffer = Buffer.concat([buffer, chunk]);
        for (;;) {
          const newline = buffer.indexOf(10);
          if (newline < 0) { if (buffer.length > MAX_FRAME) invalidate("incoming frame too large"); break; }
          if (newline + 1 > MAX_FRAME) { invalidate("incoming frame too large"); break; }
          const frameBytes = buffer.subarray(0, newline);
          buffer = buffer.subarray(newline + 1);
          let frame: any;
          try { frame = JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(frameBytes)); } catch { invalidate("malformed control frame"); break; }
          if (!frame || typeof frame !== "object" || Array.isArray(frame)) { invalidate("invalid control frame object"); finish(); break; }
          if (!owned.condition) {
            if (frame.id !== registration || frame.result?.type !== "agent_control_registered" || !validCondition(frame.result.condition) ||
              frame.result.condition.epoch !== epoch || frame.result.condition.session !== session) { invalidate("registration rejected or binding mismatch"); finish(); break; }
            owned.condition = frame.result.condition;
            owned.observe?.();
            finish();
          } else {
            dispatch(frame);
          }
        }
      });
    });
    if (!owned.condition) failStartup(ctx, "registration refused or unavailable");
  });
}
