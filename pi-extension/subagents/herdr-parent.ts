import net from "node:net";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { isAbsolute, dirname } from "node:path";
import { mkdirSync, writeFileSync, existsSync, readFileSync, unlinkSync } from "node:fs";
export interface TerminalCondition {
  pane_id: string;
  tab_id: string;
  terminal_id: string;
  launch_id: string;
}
export interface JobCondition {
  terminal: TerminalCondition;
  job_id: string;
}
export interface AgentCondition {
  job: JobCondition;
  connection: string;
  epoch: string;
  session: string;
}
export interface JobReceipt {
  type: "managed_terminal";
  condition: JobCondition;
  phase: string;
  agent: AgentCondition | null;
  exit?: { code: number | null; reason: string } | null;
  diagnostic?: string | null;
  native_scope_id?: string | null;
  busy?: boolean;
}
const FEATURES = [
  "input_request_lifecycle_v1",
  "message_admission_v1",
  "external_request_correlation_v1",
];
const MAX_FRAME = 16384;
export class HerdrParent {
  readonly socket: string;
  readonly parentPane: string;
  constructor(socket: string, parentPane: string) {
    if (!isAbsolute(socket) || !parentPane)
      throw new Error(
        "Herdr managed jobs require an absolute local socket and explicit parent pane",
      );
    this.socket = socket;
    this.parentPane = parentPane;
  }
  static discover(): HerdrParent {
    const session = process.env.HERDR_SESSION;
    if (!session || !process.env.HERDR_PANE_ID)
      throw new Error("Herdr managed jobs require HERDR_SESSION and HERDR_PANE_ID");
    const output = JSON.parse(
      execFileSync("herdr", ["--session", session, "status", "server", "--json"], {
        encoding: "utf8",
        timeout: 5000,
        maxBuffer: MAX_FRAME,
      }),
    );
    const status = output.server ?? output;
    if (status.running !== true || status.session !== session || typeof status.socket !== "string")
      throw new Error("Herdr server discovery did not match the explicit parent session");
    return new HerdrParent(status.socket, process.env.HERDR_PANE_ID);
  }
  async request(method: string, params: object, id = randomUUID()): Promise<any> {
    const frame = JSON.stringify({ id, method, params }) + "\n";
    if (Buffer.byteLength(frame) > MAX_FRAME)
      throw new Error("Herdr request exceeds the managed frame limit");
    return new Promise((resolve, reject) => {
      const socket = net.connect(this.socket);
      let buffer = Buffer.alloc(0),
        done = false;
      const finish = (error?: Error, result?: unknown) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        socket.destroy();
        error ? reject(error) : resolve(result);
      };
      const timer = setTimeout(
        () =>
          finish(
            new Error(
              `Herdr ${method} outcome unknown after transport deadline; do not retry mutation`,
            ),
          ),
        5000,
      );
      socket.on("connect", () => socket.write(frame));
      socket.on("error", (e) => finish(e));
      socket.on("end", () =>
        finish(new Error(`Herdr ${method} closed without a matching response`)),
      );
      socket.on("data", (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);
        if (buffer.length > MAX_FRAME) {
          finish(new Error("Herdr response exceeds the managed frame limit"));
          return;
        }
        const end = buffer.indexOf(10);
        if (end < 0) return;
        try {
          const message = JSON.parse(
            new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, end)),
          );
          if (!message || typeof message !== "object" || Array.isArray(message))
            throw new Error("Herdr response must be an object");
          if (message.id !== id) throw new Error("Herdr response request identity mismatch");
          if (message.error)
            throw new Error(
              `Herdr ${method}: ${message.error.code}: ${message.error.message ?? ""}`,
            );
          if (!message.result) throw new Error("Herdr response has no result");
          finish(undefined, message.result);
        } catch (e) {
          finish(e instanceof Error ? e : new Error(String(e)));
        }
      });
    });
  }
  async prepare(): Promise<TerminalCondition> {
    let caps: any;
    try {
      caps = await this.request("terminal.job.capabilities", {});
    } catch (cause) {
      throw new Error(
        `Herdr managed API unsupported or unavailable; no pane allocated: ${cause instanceof Error ? cause.message : String(cause)}`,
        { cause },
      );
    }
    if (
      caps.type !== "managed_terminal_capabilities" ||
      caps.version !== 1 ||
      caps.job_ownership !== true ||
      caps.cooperative_control !== true ||
      caps.max_frame_bytes !== MAX_FRAME ||
      !Array.isArray(caps.required_sdk_features) ||
      !FEATURES.every((f) => caps.required_sdk_features.includes(f))
    )
      throw new Error("Herdr server does not support managed job/control v1; no pane allocated");
    const result = await this.request("terminal.condition", { pane_id: this.parentPane });
    const c = result.condition;
    if (
      result.type !== "terminal_condition" ||
      !c ||
      c.pane_id !== this.parentPane ||
      !["pane_id", "tab_id", "terminal_id", "launch_id"].every(
        (k) => typeof c[k] === "string" && c[k],
      )
    )
      throw new Error("Herdr did not return the original parent terminal condition");
    return c;
  }
  async launch(
    options: {
      name: string;
      cwd: string;
      scriptPath: string;
      command: string;
      env?: Record<string, string>;
    },
    parent?: TerminalCondition,
  ): Promise<JobReceipt> {
    const condition = parent ?? (await this.prepare());
    if (!isAbsolute(options.cwd) || !isAbsolute(options.scriptPath))
      throw new Error("Managed launch cwd and script must be absolute");
    mkdirSync(dirname(options.scriptPath), { recursive: true, mode: 0o700 });
    const command = options.command.replace(
      /; echo '__SUBAGENT_DONE_'\$\?'__'$/,
      `; status=$?; echo "__SUBAGENT_DONE_${"${status}"}__"; exit "$status"`,
    );
    writeFileSync(
      options.scriptPath,
      '#!/bin/bash\nexport PI_SUBAGENT_SURFACE="${HERDR_PANE_ID:?missing managed pane identity}"\n' +
        command +
        "\n",
      { mode: 0o700 },
    );
    const result = await this.request("terminal.job.launch", {
      parent: condition,
      argv: ["/bin/bash", options.scriptPath],
      cwd: options.cwd,
      env: options.env ?? {},
      direction: "right",
      label: options.name,
    });
    if (
      result.type !== "managed_terminal" ||
      !result.condition?.job_id ||
      !["pane_id", "tab_id", "terminal_id", "launch_id"].every(
        (key) =>
          typeof result.condition.terminal?.[key] === "string" && result.condition.terminal[key],
      ) ||
      result.condition.terminal.pane_id === this.parentPane
    )
      throw new Error(
        "Herdr launch returned no safe managed job condition; inspect the original parent before cleanup",
      );
    return result;
  }

  async get(condition: JobCondition): Promise<JobReceipt> {
    const result = await this.request("terminal.job.get", { condition });
    if (result.type !== "managed_terminal" || !sameJob(result.condition, condition))
      throw new Error("Herdr job status identity mismatch");
    if (result.agent && !sameJob(result.agent.job, condition))
      throw new Error("Herdr agent route does not belong to the original job");
    return result;
  }
  async close(condition: JobCondition): Promise<void> {
    const current = await this.get(condition);
    if (current.phase === "exited") {
      if (current.diagnostic)
        throw new Error(`Herdr exited job cleanup is unresolved: ${current.diagnostic}`);
      return;
    }
    await this.request("terminal.job.close", { condition });
  }
  async release(condition: JobCondition): Promise<void> {
    await this.request("terminal.job.release", { condition });
  }
  async rename(condition: JobCondition, label: string): Promise<void> {
    await this.request("terminal.job.rename", { condition, label });
  }
  async prompt(condition: JobCondition, text: string): Promise<any> {
    const current = await this.get(condition);
    if (current.phase !== "owned" || !current.agent || current.busy)
      throw new Error("Original Herdr agent is unavailable or busy; no prompt sent");
    const request_id = randomUUID();
    const receipt = await this.request(
      "agent.control.prompt",
      { condition: current.agent, request_id, text, deadline_ms: 5000 },
      request_id,
    );
    if (
      receipt.type !== "agent_control_operation" ||
      receipt.request_id !== request_id ||
      receipt.phase !== "queued"
    )
      throw new Error("Herdr prompt queue receipt is uncertain; no retry issued");
    return receipt;
  }
  async interrupt(condition: JobCondition): Promise<any> {
    const current = await this.get(condition);
    if (current.phase !== "owned" || !current.agent || !current.busy || !current.native_scope_id)
      throw new Error(
        "Original Herdr job has no observed active native request; no interrupt sent",
      );
    const agent = current.agent,
      native = current.native_scope_id,
      request_id = randomUUID();
    const receipt = await this.request(
      "agent.control.abort",
      { condition: agent, request_id, native_request_id: native, deadline_ms: 5000 },
      request_id,
    );
    if (
      receipt.type !== "agent_control_operation" ||
      receipt.request_id !== request_id ||
      receipt.phase !== "queued"
    )
      throw new Error("Herdr abort queue receipt is uncertain; no retry issued");
    const end = Date.now() + 5500;
    while (Date.now() < end) {
      const status = await this.request("agent.control.status", { condition: agent, request_id });
      if (status.type !== "agent_control_operation" || status.request_id !== request_id)
        throw new Error("Herdr interrupt status identity mismatch");
      if (status.phase === "settled") {
        if (status.native_request_id !== native || status.aborted !== true)
          throw new Error("Herdr did not confirm interruption of the exact native request");
        return status;
      }
      if (["rejected", "outcome_unknown"].includes(status.phase))
        throw new Error(
          `Herdr native interrupt ${status.phase}: ${status.error ?? "no settlement proof"}`,
        );
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error("Herdr native interrupt settlement unknown; no retry issued");
  }
  async poll(
    condition: JobCondition,
    sessionFile: string,
    signal: AbortSignal,
    onTick?: () => void,
  ): Promise<{
    reason: "done" | "error" | "sentinel" | "ping";
    exitCode: number;
    errorMessage?: string;
    ping?: { name: string; message: string };
  }> {
    while (!signal.aborted) {
      if (existsSync(sessionFile + ".exit")) {
        let data: any;
        try {
          data = JSON.parse(readFileSync(sessionFile + ".exit", "utf8"));
        } catch {
          throw new Error("Invalid child completion sidecar");
        }
        if (!["error", "ping", "done"].includes(data.type))
          throw new Error("Unknown child completion sidecar type");
        // Consume the original completion once before a same-session resume can observe it.
        unlinkSync(sessionFile + ".exit");
        if (data.type === "error")
          return {
            reason: "error",
            exitCode: 1,
            errorMessage: data.errorMessage ?? "Native child reported an error",
          };
        if (data.type === "ping")
          return { reason: "ping", exitCode: 0, ping: { name: data.name, message: data.message } };
        if (data.type === "done") return { reason: "done", exitCode: 0 };
        throw new Error("Unknown child completion sidecar type");
      }
      let status: JobReceipt;
      try {
        status = await this.get(condition);
      } catch (error) {
        if (existsSync(sessionFile + ".exit"))
          return this.poll(condition, sessionFile, signal, onTick);
        throw error;
      }
      if (status.phase === "exited") {
        if (!status.exit || !Number.isInteger(status.exit.code))
          throw new Error("Herdr retained an uncertain job exit; completion sidecar missing");
        return { reason: "sentinel", exitCode: status.exit.code! };
      }
      if (!["owned", "awaiting_enrollment"].includes(status.phase))
        throw new Error(
          `Herdr original job ${status.phase}: ${status.diagnostic ?? "ownership unavailable"}`,
        );
      onTick?.();
      await new Promise<void>((resolve) => {
        const finish = () => {
          clearTimeout(timer);
          signal.removeEventListener("abort", finish);
          resolve();
        };
        const timer = setTimeout(finish, 1000);
        signal.addEventListener("abort", finish, { once: true });
      });
    }
    throw new Error("Subagent watcher cancelled");
  }
}

function sameJob(a: JobCondition, b: JobCondition): boolean {
  return (
    !!a &&
    a.job_id === b.job_id &&
    !!a.terminal &&
    ["pane_id", "tab_id", "terminal_id", "launch_id"].every(
      (k) => a.terminal[k as keyof TerminalCondition] === b.terminal[k as keyof TerminalCondition],
    )
  );
}
