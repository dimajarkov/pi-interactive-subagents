import { realpathSync } from "node:fs";
import type { EventEmitter } from "node:events";
import type { ControlContext, ControlSDK } from "./herdr-control.ts";

const processBus: EventEmitter = process;
const channel = "pi-interactive-subagents:private-control-reload-v1";
interface Identity {
  session: string;
  file?: string | null;
}
interface Claim {
  sdk: ControlSDK;
  ctx: ControlContext;
  event: any;
  claimed: boolean;
  start?: Promise<unknown>;
}

export function controlSessionFile(ctx: ControlContext): string | null | undefined {
  const file = ctx.sessionManager.getSessionFile?.();
  return file ? realpathSync(file) : file;
}
export function hasControlReload(): boolean {
  return processBus.listenerCount(channel) > 0;
}

/** A claim is made only after the new native host supplies its session identity.
 * The process handoff carries a fresh SDK/context, never an enrollment credential.
 */
export async function claimControlReload(
  sdk: ControlSDK,
  ctx: ControlContext,
  event: any,
): Promise<void> {
  const claim: Claim = { sdk, ctx, event, claimed: false };
  processBus.emit(channel, claim);
  await claim.start;
}

export function createControlReload(sdk: ControlSDK) {
  let current: ControlSDK | undefined = sdk;
  let identity: Identity | undefined;
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const handlers: Array<[string, (event: any, ctx: any) => unknown]> = [];
  let retire: (() => void) | undefined;
  function bind(owner: ControlSDK, event: string, handler: (event: any, ctx: any) => unknown) {
    owner.on(event, (value, ctx) => {
      if (current === owner) return handler(value, ctx);
    });
  }
  const onClaim = (claim: Claim) => {
    let file: string | null | undefined;
    try {
      file = controlSessionFile(claim.ctx);
    } catch {
      return;
    }
    if (
      !identity ||
      disposed ||
      claim.claimed ||
      typeof claim.sdk?.enqueueMessage !== "function" ||
      claim.ctx.sessionManager.getSessionId() !== identity.session ||
      file !== identity.file
    )
      return;
    current = claim.sdk;
    identity = undefined;
    if (timer) clearTimeout(timer);
    timer = undefined;
    claim.claimed = true;
    for (const [event, handler] of handlers) bind(claim.sdk, event, handler);
    claim.start = (async () => {
      for (const [event, handler] of handlers)
        if (event === "session_start") await handler(claim.event, claim.ctx);
    })();
  };
  const onExit = () => {
    retire?.();
    dispose();
  };
  function dispose() {
    disposed = true;
    identity = undefined;
    if (timer) clearTimeout(timer);
    timer = undefined;
    processBus.removeListener(channel, onClaim);
    processBus.removeListener("exit", onExit);
  }
  processBus.on(channel, onClaim);
  processBus.once("exit", onExit);
  return {
    sdk: {
      on(event: string, handler: (event: any, ctx: any) => unknown) {
        handlers.push([event, handler]);
        if (current) bind(current, event, handler);
      },
      enqueueMessage:
        typeof sdk.enqueueMessage === "function"
          ? (message, options) => {
              if (!current || identity || disposed)
                throw new Error("Herdr control registration is quiescent or retired");
              return current.enqueueMessage!(message, options);
            }
          : undefined,
    } satisfies ControlSDK,
    quiesce(original: Identity) {
      identity = original;
      // Failed reloads cannot retain an unowned controller indefinitely.
      timer = setTimeout(onExit, 30_000);
      timer.unref();
    },
    dispose,
    onExit(callback: () => void) {
      retire = callback;
    },
  };
}
export type ControlReload = ReturnType<typeof createControlReload>;
