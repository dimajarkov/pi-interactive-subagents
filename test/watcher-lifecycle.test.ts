import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import extension from "../pi-extension/subagents/index.ts";
import { EventEmitter } from "node:events";
import childExtension from "../pi-extension/subagents/subagent-done.ts";
import {
  ManagedLaunchOutcomeUnknown,
  HerdrParent,
} from "../pi-extension/subagents/herdr-parent.ts";

function host(dir: string, name: string) {
  const events = new Map<string, any[]>(),
    tools = new Map<string, any>(),
    delivered: any[] = [];
  const bus = new EventEmitter();
  let shutdowns = 0;
  const api: any = {
    events: {
      on: (name: string, fn: any) => bus.on(name, fn),
      emit: (name: string, value: any) => bus.emit(name, value),
    },
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
    shutdown: () => shutdowns++,
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
  childExtension(api);
  return {
    api,
    shutdowns: () => shutdowns,
    tools,
    delivered,
    ctx,
    emit: (event: string, reason: any = "new_session") => {
      for (const fn of events.get(event) ?? [])
        fn({ type: event, ...(typeof reason === "string" ? { reason } : reason) }, ctx);
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
    PI_SUBAGENT_AUTO_EXIT: "1",
    PI_SUBAGENT_SESSION: join(dir, "delegator.jsonl"),
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

test("autonomous delegator waits for owned children and processes the delivered outcome before completion", async () =>
  fixture(async ({ make, client }: any) => {
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const poll = client.poll;
    client.poll = async (...args: any[]) => {
      await gate;
      return poll(...args);
    };
    const h = make("delegator");
    h.emit("session_start");
    h.emit("agent_start");
    await spawn(h, "Leaf");
    h.emit("agent_end", { messages: [{ role: "assistant", stopReason: "stop" }] });
    assert.equal(h.shutdowns(), 0, "normal yielding must retain a live descendant");
    finish();
    await settle();
    assert.equal(h.delivered.length, 1);
    h.emit("agent_end", { messages: [{ role: "assistant", stopReason: "stop" }] });
    assert.equal(h.shutdowns(), 0, "enqueuing an outcome is not processing it");
    h.emit("context", { messages: [{ role: "custom", ...h.delivered[0] }] });
    h.emit("message_end", { message: { role: "assistant", stopReason: "stop" } });
    h.emit("agent_end", { messages: [{ role: "assistant", stopReason: "stop" }] });
    assert.equal(h.shutdowns(), 1, "a reconciled outcome permits normal autonomous completion");
  }));

test("completion and exit-help refuse live and queued work without writing an exit sidecar", async () =>
  fixture(async ({ make, client, dir }: any) => {
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const poll = client.poll;
    client.poll = async (...args: any[]) => {
      await gate;
      return poll(...args);
    };
    const h = make("guarded");
    h.emit("session_start");
    await spawn(h, "GuardedLeaf");
    for (const toolName of ["subagent_done", "caller_ping"]) {
      const result = await h.tools
        .get(toolName)
        .execute("call", { message: "Help" }, undefined, undefined, h.ctx);
      assert.equal(result.isError, true);
      assert.match(result.content[0].text, /End your turn normally/);
    }
    assert.equal(h.shutdowns(), 0);
    assert.throws(() => readFileSync(join(dir, "delegator.jsonl.exit")), /ENOENT/);
    finish();
    await settle();
    const refused = await h.tools
      .get("subagent_done")
      .execute("call", {}, undefined, undefined, h.ctx);
    assert.equal(refused.isError, true, "queued results still require reconciliation");
    h.emit("context", { messages: [{ role: "custom", ...h.delivered[0] }] });
    h.emit("message_end", { message: { role: "assistant", stopReason: "toolUse" } });
    const done = await h.tools
      .get("subagent_done")
      .execute("call", {}, undefined, undefined, h.ctx);
    assert.ok(!done.isError);
    assert.equal(h.shutdowns(), 1);
  }));

test("out-of-order outcomes cannot complete another child or acknowledge a result arriving during a request", async () =>
  fixture(async ({ make, client }: any) => {
    const completions = new Map<string, () => void>();
    const poll = client.poll;
    client.poll = async (condition: any, ...args: any[]) => {
      await new Promise<void>((resolve) => completions.set(condition.job_id, resolve));
      return poll(condition, ...args);
    };
    const h = make("parallel-delegator");
    h.emit("session_start");
    await Promise.all([spawn(h, "First"), spawn(h, "Second")]);
    completions.get("2")!();
    await settle();
    assert.equal(h.delivered[0].details.name, "Second");
    h.emit("context", { messages: [{ role: "custom", ...h.delivered[0] }] });
    completions.get("1")!();
    await settle();
    h.emit("message_end", { message: { role: "assistant", stopReason: "stop" } });
    h.emit("agent_end", { messages: [{ role: "assistant", stopReason: "stop" }] });
    assert.equal(h.shutdowns(), 0, "first outcome arrived after the request context was built");
    assert.equal(h.delivered.length, 2, "each outcome is delivered exactly once");
    h.emit("context", { messages: h.delivered.map((m: any) => ({ role: "custom", ...m })) });
    h.emit("message_end", { message: { role: "assistant", stopReason: "stop" } });
    h.emit("agent_end", { messages: [{ role: "assistant", stopReason: "stop" }] });
    assert.equal(h.shutdowns(), 1);
  }));

test("failed allocation releases its reservation and a child error is delivered for reconciliation", async () =>
  fixture(async ({ make, client }: any) => {
    const h = make("failure-delegator");
    h.emit("session_start");
    const launch = client.launch;
    client.launch = async () => {
      throw Error("Synthetic launch refused");
    };
    await assert.rejects(spawn(h, "NeverLaunched"), /Synthetic launch refused/);
    h.emit("agent_end", { messages: [{ role: "assistant", stopReason: "stop" }] });
    assert.equal(h.shutdowns(), 1, "there is no phantom child after a refused allocation");
    client.launch = launch;
    client.poll = async () => {
      throw Error("Synthetic child transport failure");
    };
    const current = make("child-error-delegator");
    current.emit("session_start");
    await spawn(current, "FailedChild");
    await settle();
    assert.equal(current.delivered.length, 1);
    assert.notEqual(current.delivered[0].details.exitCode, 0);
    assert.match(current.delivered[0].content, /Synthetic child transport failure/);
    current.emit("agent_end", { messages: [{ role: "assistant", stopReason: "stop" }] });
    assert.equal(current.shutdowns(), 0);
    current.emit("context", { messages: [{ role: "custom", ...current.delivered[0] }] });
    current.emit("message_end", { message: { role: "assistant", stopReason: "stop" } });
    current.emit("agent_end", { messages: [{ role: "assistant", stopReason: "stop" }] });
    assert.equal(current.shutdowns(), 1);
  }));

test("interruption and human takeover retain the native delegator after descendants reconcile", async () =>
  fixture(async ({ make }: any) => {
    const h = make("interactive-delegator");
    h.emit("session_start");
    h.emit("agent_start");
    await spawn(h, "InteractiveLeaf");
    await settle();
    h.emit("context", { messages: [{ role: "custom", ...h.delivered[0] }] });
    h.emit("message_end", { message: { role: "assistant", stopReason: "aborted" } });
    h.emit("agent_end", { messages: [{ role: "assistant", stopReason: "aborted" }] });
    assert.equal(h.shutdowns(), 0);
    h.emit("input");
    h.emit("context", { messages: [{ role: "custom", ...h.delivered[0] }] });
    h.emit("message_end", { message: { role: "assistant", stopReason: "stop" } });
    h.emit("agent_end", { messages: [{ role: "assistant", stopReason: "stop" }] });
    assert.equal(h.shutdowns(), 0, "human takeover survives successful descendant reconciliation");
  }));

test("an allocation in flight prevents autonomous exit before its child is registered", async () =>
  fixture(async ({ make, client }: any) => {
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const launch = client.launch;
    client.launch = async () => {
      await gate;
      return launch();
    };
    const h = make("allocating");
    h.emit("session_start");
    const pending = spawn(h, "AllocatingLeaf");
    await settle();
    h.emit("agent_end", { messages: [{ role: "assistant", stopReason: "stop" }] });
    assert.equal(h.shutdowns(), 0);
    finish();
    await pending;
    await settle();
  }));

test("unsupported native hosts refuse registration instead of silently bypassing exit coordination", () => {
  const api: any = { on() {} };
  assert.throws(() => extension(api), /require the native host event bus/);
  assert.throws(() => childExtension(api), /require the native host event bus/);
});

test("an uncertain allocation keeps completion guarded rather than forgetting possible owned work", async () =>
  fixture(async ({ make, client }: any) => {
    const h = make("uncertain-launch");
    h.emit("session_start");
    client.launch = async () => {
      throw new ManagedLaunchOutcomeUnknown("transport lost", "/private/recovery.json");
    };
    await assert.rejects(spawn(h, "UncertainChild"), /Recovery receipt/);
    h.emit("agent_end", { messages: [{ role: "assistant", stopReason: "stop" }] });
    assert.equal(h.shutdowns(), 0);
    const result = await h.tools
      .get("subagent_done")
      .execute("call", {}, undefined, undefined, h.ctx);
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /no automatic outcome is guaranteed/);
    assert.match(result.content[0].text, /private\/recovery.json/);
  }));

test("replacement clears the stopped owner's completion hold without clearing another host's work", async () =>
  fixture(async ({ make, client }: any) => {
    client.wait = true;
    const old = make("old-owner"),
      current = make("isolated-owner");
    old.emit("session_start");
    current.emit("session_start");
    await spawn(old, "OldLeaf");
    await spawn(current, "CurrentLeaf");
    old.emit("session_shutdown", "replacement");
    old.emit("session_start");
    old.emit("agent_end", { messages: [{ role: "assistant", stopReason: "stop" }] });
    assert.equal(
      old.shutdowns(),
      1,
      "the replacement does not inherit stale observer reservations",
    );
    current.emit("agent_end", { messages: [{ role: "assistant", stopReason: "stop" }] });
    assert.equal(current.shutdowns(), 0, "another extension host retains its own live child hold");
  }));
