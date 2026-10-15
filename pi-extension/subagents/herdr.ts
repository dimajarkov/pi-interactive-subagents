import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const ownedPanes = new Map<
  string,
  { terminal: string; workspace: string; tab: string; caller: string }
>();

function callerIdentity(): string {
  return JSON.stringify([
    process.env.HERDR_SESSION,
    process.env.HERDR_SOCKET_PATH,
    process.env.HERDR_CONFIG_PATH,
    process.env.HERDR_WORKSPACE_ID,
    process.env.HERDR_TAB_ID,
    process.env.HERDR_PANE_ID,
  ]);
}

function requireCaller(): void {
  if (
    process.env.HERDR_ENV !== "1" ||
    !process.env.HERDR_PANE_ID ||
    !process.env.HERDR_WORKSPACE_ID ||
    !process.env.HERDR_TAB_ID
  ) {
    throw new Error(
      "Herdr requires a managed caller pane with injected HERDR context; start Pi inside Herdr.",
    );
  }
}

function decode(output: string, action: string): any {
  try {
    const response = JSON.parse(output);
    if (!response.result || response.error) throw new Error("missing result");
    return response.result;
  } catch {
    throw new Error(
      `Herdr ${action} returned malformed or unsuccessful JSON; inspect the owned pane before retrying.`,
    );
  }
}

function failure(action: string, error: any): Error {
  // Herdr reports server failures as JSON on stderr. Preserve its actionable error,
  // without echoing the submitted shell command (which can contain private input).
  let detail = "Check the Herdr CLI and current session; no other backend was selected.";
  try {
    const response = JSON.parse(String(error.stderr));
    const code = response.error?.code;
    if (typeof code === "string" && /^[a-z_]{1,64}$/.test(code)) {
      detail = `${code}. Check the owned pane and current session before retrying.`;
      if (code === "protected_close") detail += " Pane is protected; close was rejected.";
    }
  } catch {}
  return new Error(`Herdr ${action} failed: ${detail}`);
}

function herdrArgs(args: string[]): string[] {
  const session = process.env.HERDR_SESSION;
  return [...(session ? ["--session", session] : []), "pane", ...args];
}

function call(args: string[], outputMode: "json" | "text" = "json"): any {
  requireCaller();
  let output: string;
  try {
    output = execFileSync("herdr", herdrArgs(args), {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    throw failure(args[0], error);
  }
  return outputMode === "text" ? output : decode(output, args[0]);
}

function verifyOwned(pane: string): void {
  requireCaller();
  const receipt = ownedPanes.get(pane);
  if (!receipt) throw new Error(`Herdr pane ${pane} is not an owned child; refusing to target it.`);
  if (receipt.caller !== callerIdentity())
    throw new Error("Herdr caller context changed; refusing the old child handle.");
  const current = call(["get", pane]).pane;
  if (
    current?.pane_id !== pane ||
    current?.terminal_id !== receipt.terminal ||
    current?.workspace_id !== receipt.workspace ||
    current?.tab_id !== receipt.tab
  ) {
    throw new Error(`Herdr child ${pane} is stale or replaced; refusing to target it.`);
  }
}

export function createHerdrSurface(
  name: string,
  cwd: string,
  direction = "right",
  fromSurface?: string,
): string {
  requireCaller();
  if (direction !== "right" && direction !== "down") {
    throw new Error(`Herdr does not support ${direction} splits; use right or down.`);
  }
  if (fromSurface && fromSurface !== process.env.HERDR_PANE_ID) verifyOwned(fromSurface);
  const target = fromSurface ? ["--pane", fromSurface] : ["--current"];
  const layout = call(["layout", ...target]).layout;
  if (typeof layout?.zoomed !== "boolean") {
    throw new Error(
      "Herdr layout returned no safe zoom state; inspect the caller layout before retrying. No pane was created.",
    );
  }
  if (layout.zoomed) {
    throw new Error(
      "Herdr caller layout is zoomed; unzoom it manually before launching a background child. No layout was changed.",
    );
  }
  const pane = call([
    "split",
    ...target,
    "--direction",
    direction,
    "--cwd",
    cwd,
    "--no-focus",
  ]).pane;
  if (
    !pane ||
    typeof pane.pane_id !== "string" ||
    !pane.pane_id ||
    typeof pane.terminal_id !== "string" ||
    !pane.terminal_id ||
    typeof pane.workspace_id !== "string" ||
    !pane.workspace_id ||
    typeof pane.tab_id !== "string" ||
    !pane.tab_id ||
    pane.pane_id === process.env.HERDR_PANE_ID
  ) {
    throw new Error(
      "Herdr split returned no safe child identity; inspect the caller layout before retrying. No pane was guessed or closed.",
    );
  }
  ownedPanes.set(pane.pane_id, {
    terminal: pane.terminal_id,
    workspace: pane.workspace_id,
    tab: pane.tab_id,
    caller: callerIdentity(),
  });
  try {
    verifyOwned(pane.pane_id);
    call(["rename", pane.pane_id, name]);
  } catch (error) {
    let cleanup = "The owned child was closed.";
    try {
      herdrClose(pane.pane_id);
    } catch (closeError) {
      cleanup = `Owned child ${pane.pane_id} remains: ${(closeError as Error).message}`;
    }
    throw new Error(`Herdr naming failed: ${(error as Error).message} ${cleanup}`);
  }
  return pane.pane_id;
}

export function herdrCommand(pane: string, command: string): void {
  verifyOwned(pane);
  call(["run", pane, command], "text");
}

export function herdrEscape(pane: string): void {
  verifyOwned(pane);
  call(["send-keys", pane, "esc"], "text");
}

export function herdrRead(pane: string, lines: number): string {
  verifyOwned(pane);
  return call(
    ["read", pane, "--source", "recent-unwrapped", "--lines", String(Math.max(1, lines))],
    "text",
  );
}

export async function herdrReadAsync(pane: string, lines: number): Promise<string> {
  verifyOwned(pane);
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync(
      "herdr",
      herdrArgs([
        "read",
        pane,
        "--source",
        "recent-unwrapped",
        "--lines",
        String(Math.max(1, lines)),
      ]),
      { encoding: "utf8" },
    ));
  } catch (error) {
    throw failure("read", error);
  }
  return stdout;
}

export function herdrClose(pane: string): void {
  verifyOwned(pane);
  call(["close", pane]);
  ownedPanes.delete(pane);
}

export function herdrRenameCaller(title: string): void {
  // Current is resolved from injected caller context, never the UI focus.
  call(["rename", process.env.HERDR_PANE_ID!, title]);
}
