import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import extension from "../pi-extension/subagents/index.ts";
import { HerdrParent } from "../pi-extension/subagents/herdr-parent.ts";

function host(dir: string, name: string) {
  const events = new Map<string, any[]>(),
    tools = new Map<string, any>(),
    delivered: any[] = [];
  const api: any = {
    on: (event: string, fn: any) => events.set(event, [...(events.get(event) ?? []), fn]),
    registerTool: (tool: any) => tools.set(tool.name, tool),
    registerCommand() {},
    registerMessageRenderer() {},
    registerShortcut() {},
    getAllTools: () => [...tools.values()],
    sendMessage: (message: any) => delivered.push(message),
  };
  const file = join(dir, name + ".jsonl");
  writeFileSync(file, JSON.stringify({ type: "session", id: name, version: 3 }) + "\n");
  const ctx: any = {
    cwd: dir,
    hasUI: false,
    ui: { setWidget() {} },
    sessionManager: {
      getSessionFile: () => file,
      getSessionId: () => name,
      getSessionDir: () => dir,
    },
  };
  extension(api);
  return {
    api,
    tools,
    delivered,
    ctx,
    emit: (event: string, reason = "new_session") => {
      for (const fn of events.get(event) ?? []) fn({ type: event, reason }, ctx);
    },
  };
}
async function fixture(run: (f: any) => Promise<void>) {
  const dir = mkdtempSync(join(tmpdir(), "pi-watcher-lifecycle-")),
    env = { ...process.env },
    discover = HerdrParent.discover;
  const closed: string[] = [],
    jobs: any[] = [];
  Object.assign(process.env, {
    PI_CODING_AGENT_DIR: join(dir, "config"),
    PI_SUBAGENT_MUX: "herdr",
    HERDR_ENV: "1",
    HERDR_SESSION: "synthetic",
    HERDR_PANE_ID: "parent",
    HERDR_TAB_ID: "tab",
    HERDR_WORKSPACE_ID: "workspace",
  });
  mkdirSync(join(dir, "config"), { recursive: true });
  const terminal = {
    pane_id: "parent",
    tab_id: "tab",
    terminal_id: "parent-terminal",
    launch_id: "parent-launch",
  };
  const client: any = {
    prepare: async () => terminal,
    launch: async () => {
      const id = String(jobs.length + 1),
        job = {
          condition: { terminal: { ...terminal, pane_id: "child-" + id }, job_id: id },
          phase: "owned",
        };
      jobs.push(job);
      return job;
    },
    close: async (c: any) => {
      closed.push(c.job_id);
    },
    poll: async (_c: any, file: string, signal: AbortSignal) => {
      if (signal.aborted) throw Error("Subagent watcher cancelled");
      if (client.wait)
        return await new Promise((_resolve, reject) =>
          signal.addEventListener("abort", () => reject(Error("Subagent watcher cancelled")), {
            once: true,
          }),
        );
      mkdirSync(join(file, ".."), { recursive: true });
      writeFileSync(
        file,
        JSON.stringify({
          type: "message",
          message: { role: "assistant", content: [{ type: "text", text: "CHILD_FINDINGS_OK" }] },
        }) + "\n",
      );
      return { exitCode: 0 };
    },
  };
  HerdrParent.discover = () => client;
  const hosts: any[] = [];
  const make = (name: string) => {
    const h = host(dir, name);
    hosts.push(h);
    return h;
  };
  try {
    await run({ dir, make, closed, jobs, client });
  } finally {
    for (const h of hosts) h.emit("session_shutdown", "test_cleanup");
    HerdrParent.discover = discover;
    process.env = env;
    rmSync(dir, { recursive: true, force: true });
  }
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 25));
const spawn = (h: any, name: string) =>
  h.tools
    .get("subagent")
    .execute("call", { name, task: "Synthetic findings" }, undefined, undefined, h.ctx);

test("native session shutdown/start boundary permits a fresh watcher", async () =>
  fixture(async ({ make }: any) => {
    const h = make("parent");
    h.emit("session_start");
    h.emit("session_shutdown");
    h.emit("session_start");
    await spawn(h, "AfterNewSession");
    await settle();
    assert.equal(h.delivered[0]?.details.exitCode, 0, h.delivered[0]?.content);
    assert.match(h.delivered[0]?.content, /CHILD_FINDINGS_OK/);
  }));

test("old runtime shutdown cannot poison a new extension instance", async () =>
  fixture(async ({ make }: any) => {
    const old = make("old"),
      current = make("current");
    old.emit("session_start");
    current.emit("session_start");
    old.emit("session_shutdown", "reload");
    await spawn(current, "CurrentChild");
    await settle();
    assert.equal(current.delivered[0]?.details.exitCode, 0, current.delivered[0]?.content);
  }));

test("observer shutdown retains its child and writes cancellation provenance without waking a stale parent", async () =>
  fixture(async ({ make, client, closed }: any) => {
    client.wait = true;
    const h = make("parent");
    h.emit("session_start");
    const ack = await spawn(h, "RetainedChild");
    h.emit("session_shutdown", "reload");
    await settle();
    assert.deepEqual(closed, [], "observer cancellation must not close a live child job");
    assert.equal(h.delivered.length, 0, "do not steer a replaced native parent");
    const receipt = JSON.parse(readFileSync(ack.details.lifecycleReceiptFile, "utf8"));
    assert.equal(receipt.cancellation.source, "observer");
    assert.equal(receipt.cancellation.event, "session_shutdown");
    assert.equal(receipt.cancellation.reason, "reload");
    assert.equal(receipt.cleanupOutcome, "retained");
    assert.equal(receipt.sessionFile, ack.details.sessionFile);
  }));

test("four parallel launches after replacement all return findings", async () =>
  fixture(async ({ make, closed }: any) => {
    const h = make("parallel-parent");
    h.emit("session_start");
    h.emit("session_shutdown");
    h.emit("session_start");
    await Promise.all([0, 1, 2, 3].map((i) => spawn(h, `Parallel${i}`)));
    await settle();
    assert.equal(h.delivered.length, 4);
    assert.ok(
      h.delivered.every(
        (r: any) => r.details.exitCode === 0 && r.content.includes("CHILD_FINDINGS_OK"),
      ),
    );
    assert.equal(closed.length, 4);
  }));

test("shutdown during an in-flight launch retains the acknowledged child with its original owner reason", async () =>
  fixture(async ({ make, client, closed }: any) => {
    const h = make("in-flight");
    h.emit("session_start");
    const original = client.launch;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    client.launch = async () => {
      const job = await original();
      await gate;
      return job;
    };
    const pending = spawn(h, "InFlightChild");
    await settle();
    h.emit("session_shutdown", "reload");
    release();
    const ack = await pending;
    await settle();
    assert.deepEqual(closed, []);
    assert.equal(h.delivered.length, 0);
    const receipt = JSON.parse(readFileSync(ack.details.lifecycleReceiptFile, "utf8"));
    assert.equal(receipt.cancellation.reason, "reload");
    assert.equal(receipt.cleanupOutcome, "retained");
  }));
