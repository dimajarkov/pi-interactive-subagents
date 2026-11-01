import { execFileSync } from "node:child_process";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  appendFileSync,
  readFileSync,
  rmSync,
  chmodSync,
  statSync,
  readdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import extension from "../pi-extension/subagents/index.ts";
import { EventEmitter } from "node:events";
import childExtension from "../pi-extension/subagents/subagent-done.ts";
import {
  ManagedLaunchOutcomeUnknown,
  HerdrParent,
} from "../pi-extension/subagents/herdr-parent.ts";

function host(dir: string, name: string, nativeFile?: string) {
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
    getActiveTools: () => [...tools.keys()],
    appendEntry() {},
    sendMessage: (message: any) => delivered.push(message),
  };
  const file = nativeFile ?? join(dir, name + ".jsonl");
  if (!nativeFile)
    writeFileSync(file, JSON.stringify({ type: "session", id: name, version: 3 }) + "\n");
  const ctx: any = {
    shutdown: () => shutdowns++,
    cwd: dir,
    hasUI: false,
    ui: { setWidget() {} },
    sessionManager: {
      getSessionFile: () => file,
      getSessionId: () =>
        nativeFile ? JSON.parse(readFileSync(nativeFile, "utf8").split("\n")[0]).id : name,
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
    launch: async (options: any) => {
      const id = String(jobs.length + 1),
        job = {
          condition: { terminal: { ...terminal, pane_id: "child-" + id }, job_id: id },
          phase: "owned",
        };
      jobs.push({ ...job, launch: options });
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
      appendFileSync(
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
  const make = (name: string, nativeFile?: string) => {
    const h = host(dir, name, nativeFile);
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

test("replacement retains the stopped owner's durable hold without changing another host's work", async () =>
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
      0,
      "the replacement retains original unresolved native ownership",
    );
    current.emit("agent_end", { messages: [{ role: "assistant", stopReason: "stop" }] });
    assert.equal(current.shutdowns(), 0, "another extension host retains its own live child hold");
  }));

test("resume refuses an unowned legacy native session before allocating a pane", async () =>
  fixture(async ({ make, dir, jobs }: any) => {
    const h = make("original-parent");
    h.emit("session_start");
    const legacy = join(dir, "legacy.jsonl");
    writeFileSync(legacy, JSON.stringify({ type: "session", id: "legacy", version: 3 }) + "\n");
    await assert.rejects(
      h.tools
        .get("subagent_resume")
        .execute("resume", { sessionPath: legacy }, undefined, undefined, h.ctx),
      /policy|ownership|legacy/i,
    );
    assert.equal(jobs.length, 0, "file possession must not authorize managed adoption");
  }));

test("resume preserves the original restricted role after definitions and caller config change", async () =>
  fixture(async ({ make, dir, jobs }: any) => {
    const agentDir = join(dir, "config", "agents");
    mkdirSync(agentDir, { recursive: true });
    const role = join(agentDir, "restricted.md");
    writeFileSync(
      role,
      "---\nname: restricted\ntools: read\nspawning: false\nauto-exit: false\nsystem-prompt: replace\n---\nORIGINAL_ROLE_POLICY\n",
    );
    const h = make("policy-parent");
    h.emit("session_start");
    const launched = await h.tools
      .get("subagent")
      .execute(
        "start",
        { name: "Restricted", task: "Original task", agent: "restricted" },
        undefined,
        undefined,
        h.ctx,
      );
    await settle();
    writeFileSync(
      role,
      "---\nname: restricted\ntools: bash,write\nauto-exit: true\ndeny-tools: read\n---\nWIDENED_REPLACEMENT_POLICY\n",
    );
    const otherConfig = join(dir, "other-config");
    mkdirSync(otherConfig);
    process.env.PI_CODING_AGENT_DIR = otherConfig;
    process.env.PI_DENY_TOOLS = "bash";
    await h.tools
      .get("subagent_resume")
      .execute(
        "resume",
        { sessionPath: launched.details.sessionFile, message: "Follow up" },
        undefined,
        undefined,
        h.ctx,
      );
    await settle();
    const resumed = jobs[1].launch;
    assert.equal(resumed.cwd, dir);
    assert.match(resumed.command, /--tools 'read,caller_ping,subagent_done'/);
    assert.match(resumed.command, /ORIGINAL_ROLE_POLICY|--system-prompt/);
    assert.match(resumed.command, /PI_SUBAGENT_AGENT='restricted'/);
    assert.ok(!resumed.command.includes("WIDENED_REPLACEMENT_POLICY"));
    assert.ok(!resumed.command.includes("PI_SUBAGENT_AUTO_EXIT=1"));
    assert.match(resumed.command, /PI_CODING_AGENT_DIR='[^']*config'/);
    assert.match(resumed.command, /PI_DENY_TOOLS='[^']*read/);
    assert.match(resumed.command, /PI_DENY_TOOLS='[^']*bash/);
  }));

test("a replacement host retains durable unresolved child ownership and refuses false completion", async () =>
  fixture(async ({ make, client, closed }: any) => {
    client.wait = true;
    const old = make("durable-parent");
    old.emit("session_start");
    const launched = await spawn(old, "RetainedDescendant");
    old.emit("session_shutdown", "replacement");
    await settle();
    const current = make("durable-parent");
    current.emit("session_start");
    const done = await current.tools
      .get("subagent_done")
      .execute("done", {}, undefined, undefined, current.ctx);
    assert.equal(done.isError, true, "reloading cannot erase a native child's ownership");
    assert.match(done.content[0].text, /unresolved|original delegation/i);
    assert.match(done.content[0].text, /delegations/);
    assert.equal(current.shutdowns(), 0);
    assert.deepEqual(closed, []);
    assert.ok(launched.details.sessionFile);
  }));

test("orchestrator loss reports unresolved descendants upward and retains their exact native surfaces", async () =>
  fixture(async ({ make, client, closed }: any) => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    client.poll = async (condition: any, _file: string, signal: AbortSignal) => {
      if (condition.job_id === "1") {
        await gate;
        return { exitCode: 0 };
      }
      return await new Promise((_resolve, reject) =>
        signal.addEventListener("abort", () => reject(Error("Observer lost")), { once: true }),
      );
    };
    const master = make("upward-parent");
    master.emit("session_start");
    const orchestrator = await spawn(master, "Orchestrator");
    const child = make("orchestrator", orchestrator.details.sessionFile);
    child.emit("session_start");
    const leaf = await spawn(child, "RetainedLeaf");
    child.emit("session_shutdown", "simulated_orchestrator_loss");
    await settle();
    release();
    await settle();
    assert.equal(master.delivered.length, 1);
    assert.notEqual(master.delivered[0].details.exitCode, 0);
    assert.equal(master.delivered[0].details.cleanupOutcome, "retained");
    assert.match(master.delivered[0].content, /unresolved/i);
    assert.ok(master.delivered[0].content.includes(leaf.details.sessionFile));
    assert.deepEqual(closed, [], "an exited orchestrator does not authorize descendant cleanup");
    master.emit("context", {
      messages: master.delivered.map((m: any) => ({ role: "custom", ...m })),
    });
    master.emit("message_end", { message: { role: "assistant", stopReason: "stop" } });
    const done = await master.tools
      .get("subagent_done")
      .execute("done", {}, undefined, undefined, master.ctx);
    assert.equal(
      done.isError,
      true,
      "reading an unresolved-work outcome does not settle the descendants",
    );
  }));

test("the dispatched launch and resume bootstrap clears stale mux-daemon identities and visual authority", async () =>
  fixture(async ({ make, dir, jobs }: any) => {
    const bin = join(dir, "bin");
    mkdirSync(bin);
    const pi = join(bin, "pi");
    writeFileSync(
      pi,
      `#!${process.execPath}\nconsole.log(JSON.stringify({ env: process.env, cwd: process.cwd(), argv: process.argv.slice(2) }));\n`,
    );
    chmodSync(pi, 0o700);
    const h = make("bootstrap-parent");
    h.emit("session_start");
    const launched = await spawn(h, "FreshChild");
    await settle();
    await h.tools
      .get("subagent_resume")
      .execute(
        "resume",
        { sessionPath: launched.details.sessionFile, autoExit: false },
        undefined,
        undefined,
        h.ctx,
      );
    await settle();
    const seen: any[] = [];
    for (const job of jobs) {
      const output = execFileSync("/bin/bash", ["-c", job.launch.command], {
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: bin + ":" + process.env.PATH,
          HERDR_PANE_ID: "fresh-managed-pane",
          PI_HERDR_BRANCH_ROOT: "fresh-verified-branch-context",
          PI_SUBAGENT_AGENT: "stale-role",
          PI_SUBAGENT_AUTO_EXIT: "1",
          PI_SUBAGENT_UNKNOWN: "stale-future-identity",
          PI_SUBAGENT_ACTIVITY_FILE: "stale-activity",
          PI_SUBAGENT_SKILLS: "stale-skills",
          PI_CODEX_VISUAL_HOST: "stale-private-host-authority",
          PI_DENY_TOOLS: "stale-denial",
        },
      });
      const snapshot = JSON.parse(output.split("\n")[0]);
      seen.push(snapshot);
      assert.equal(snapshot.env.PI_SUBAGENT_AGENT, undefined);
      assert.equal(snapshot.env.PI_SUBAGENT_AUTO_EXIT, undefined);
      assert.equal(snapshot.env.PI_SUBAGENT_UNKNOWN, undefined);
      assert.equal(snapshot.env.PI_SUBAGENT_SKILLS, undefined);
      assert.equal(snapshot.env.PI_CODEX_VISUAL_HOST, undefined);
      assert.notEqual(snapshot.env.PI_DENY_TOOLS, "stale-denial");
      assert.notEqual(snapshot.env.PI_SUBAGENT_ACTIVITY_FILE, "stale-activity");
      assert.equal(snapshot.env.PI_SUBAGENT_SURFACE, "fresh-managed-pane");
      assert.equal(snapshot.env.PI_HERDR_BRANCH_ROOT, "fresh-verified-branch-context");
    }
    assert.notEqual(seen[0].env.PI_SUBAGENT_ID, seen[1].env.PI_SUBAGENT_ID);
    assert.notEqual(seen[0].env.PI_SUBAGENT_EXIT_FILE, seen[1].env.PI_SUBAGENT_EXIT_FILE);
    const policyPath = launched.details.sessionFile + ".subagent-policy.json";
    assert.equal(statSync(policyPath).mode & 0o777, 0o600);
    const metadata = readFileSync(policyPath, "utf8");
    assert.ok(!metadata.includes("stale-private-host-authority"));
    assert.ok(!metadata.includes("HERDR_CONTROL_CAPABILITY"));
  }));

test("only the original native parent can resume and an unresolved execution excludes concurrent resume", async () =>
  fixture(async ({ make, client, jobs }: any) => {
    client.wait = true;
    const owner = make("exclusive-owner");
    owner.emit("session_start");
    const launched = await spawn(owner, "StillRunning");
    const resume = (h: any) =>
      h.tools
        .get("subagent_resume")
        .execute(
          "resume",
          { sessionPath: launched.details.sessionFile },
          undefined,
          undefined,
          h.ctx,
        );
    await assert.rejects(resume(owner), /active or unresolved execution/);
    const foreign = make("foreign-owner");
    foreign.emit("session_start");
    await assert.rejects(resume(foreign), /foreign|lineage/);
    assert.equal(jobs.length, 1, "refused resumes allocate no new managed jobs");
  }));

test("a resumed provider failure cannot return old native success and leaves original history intact", async () =>
  fixture(async ({ make, client }: any) => {
    const h = make("failure-resume-owner");
    h.emit("session_start");
    const launched = await spawn(h, "OriginalSuccess");
    await settle();
    const originalHistory = readFileSync(launched.details.sessionFile, "utf8");
    assert.match(originalHistory, /CHILD_FINDINGS_OK/);
    client.poll = async () => ({ exitCode: 1, errorMessage: "RESUMED_FAILURE_BEFORE_ASSISTANT" });
    await h.tools
      .get("subagent_resume")
      .execute(
        "resume",
        { sessionPath: launched.details.sessionFile },
        undefined,
        undefined,
        h.ctx,
      );
    await settle();
    const result = h.delivered[1];
    assert.notEqual(result.details.exitCode, 0);
    assert.match(result.content, /RESUMED_FAILURE_BEFORE_ASSISTANT/);
    assert.ok(!result.content.includes("CHILD_FINDINGS_OK"));
    assert.equal(readFileSync(launched.details.sessionFile, "utf8"), originalHistory);
  }));

test("a queued native outcome is not delivered twice after host replacement", async () =>
  fixture(async ({ make }: any) => {
    const old = make("queued-owner");
    old.emit("session_start");
    await spawn(old, "FinishedChild");
    await settle();
    assert.equal(old.delivered.length, 1);
    appendFileSync(
      old.ctx.sessionManager.getSessionFile(),
      JSON.stringify({ type: "custom_message", ...old.delivered[0] }) + "\n",
    );
    old.emit("session_shutdown", "reload");
    const current = make("queued-owner", old.ctx.sessionManager.getSessionFile());
    current.emit("session_start");
    assert.equal(
      current.delivered.length,
      0,
      "native history already holds the original outcome identity",
    );
    current.emit("context", { messages: [{ role: "custom", ...old.delivered[0] }] });
    current.emit("message_end", { message: { role: "assistant", stopReason: "stop" } });
    const done = await current.tools
      .get("subagent_done")
      .execute("done", {}, undefined, undefined, current.ctx);
    assert.ok(!done.isError);
    assert.equal(current.shutdowns(), 1);
  }));

test("tampered or foreign queued recovery evidence is retained and never replayed as success", async () => {
  for (const tamper of ["foreign-parent", "wrong-id", "public-permissions", "invalid-json"]) {
    await fixture(async ({ make, client, dir }: any) => {
      client.wait = true;
      const old = make("tamper-owner");
      old.emit("session_start");
      await spawn(old, "Retained");
      old.emit("session_shutdown", "reload");
      await settle();
      const journal = old.ctx.sessionManager.getSessionFile() + ".delegations";
      const path = join(journal, readdirSync(journal)[0]);
      const record = JSON.parse(readFileSync(path, "utf8"));
      record.state = "queued";
      record.message = {
        customType: "subagent_result",
        content: "FORGED_QUEUED_SUCCESS",
        details: { subagentOutcomeId: record.id },
      };
      if (tamper === "foreign-parent") record.parentSessionId = "sibling-owner";
      if (tamper === "wrong-id") record.id = "00000000-0000-0000-0000-000000000000";
      writeFileSync(path, tamper === "invalid-json" ? "{invalid" : JSON.stringify(record));
      if (tamper === "public-permissions") chmodSync(path, 0o644);
      const current = make("tamper-owner", old.ctx.sessionManager.getSessionFile());
      current.emit("session_start");
      assert.deepEqual(current.delivered, [], tamper + " must not replay a forged queued result");
      const done = await current.tools
        .get("subagent_done")
        .execute("done", {}, undefined, undefined, current.ctx);
      assert.equal(done.isError, true, tamper + " remains an explicit unresolved ownership hold");
      assert.ok(!done.content[0].text.includes("FORGED_QUEUED_SUCCESS"));
      assert.ok(done.content[0].text.includes(dir));
    });
  }
});

test("a definite pre-dispatch failure releases its execution claim for a same-parent retry", async () =>
  fixture(async ({ make, client }: any) => {
    const h = make("definite-failure-owner");
    h.emit("session_start");
    const launch = client.launch;
    let candidate: any;
    client.launch = async (options: any) => {
      candidate = options;
      throw Error("PROVEN_NO_DISPATCH");
    };
    await assert.rejects(spawn(h, "NotDispatched"), /PROVEN_NO_DISPATCH/);
    const file = candidate.command.match(/PI_SUBAGENT_SESSION='([^']+)'/)[1];
    assert.throws(() => readFileSync(file + ".subagent-active.json"), /ENOENT/);
    client.launch = launch;
    await h.tools
      .get("subagent_resume")
      .execute("resume", { sessionPath: file }, undefined, undefined, h.ctx);
    await settle();
    assert.equal(h.delivered[0].details.exitCode, 0);
  }));

test("an explicitly empty child allowlist remains restrictive on launch and resume", async () =>
  fixture(async ({ make, jobs }: any) => {
    const h = make("empty-tools-owner");
    h.emit("session_start");
    const child = await h.tools
      .get("subagent")
      .execute(
        "start",
        { name: "NoWorkTools", task: "Return synthetic findings", tools: "" },
        undefined,
        undefined,
        h.ctx,
      );
    await settle();
    await h.tools
      .get("subagent_resume")
      .execute("resume", { sessionPath: child.details.sessionFile }, undefined, undefined, h.ctx);
    await settle();
    for (const job of jobs) assert.match(job.launch.command, /--tools 'caller_ping,subagent_done'/);
  }));

test("unverified cleanup retains completion ownership after both launch and resume outcomes are processed", async () => {
  for (const mode of ["launch-done", "launch-error", "resume-done", "resume-error"]) {
    await fixture(async ({ make, client }: any) => {
      const h = make("cleanup-owner");
      h.emit("session_start");
      let nativeFile: string;
      if (mode.startsWith("resume")) {
        const original = await spawn(h, "Original");
        nativeFile = original.details.sessionFile;
        await settle();
        h.emit("context", { messages: h.delivered.map((m: any) => ({ role: "custom", ...m })) });
        h.emit("message_end", { message: { role: "assistant", stopReason: "stop" } });
        h.delivered.splice(0);
      }
      let closes = 0;
      client.close = async () => {
        closes++;
        throw Error("PROTECTED_CLEANUP_58");
      };
      if (mode.endsWith("error"))
        client.poll = async () => {
          throw Error("CHILD_TRANSPORT_FAILURE_58");
        };
      if (mode.startsWith("resume")) {
        await h.tools
          .get("subagent_resume")
          .execute("resume", { sessionPath: nativeFile! }, undefined, undefined, h.ctx);
      } else {
        const launch = await spawn(h, "UnverifiedCleanup");
        nativeFile = launch.details.sessionFile;
      }
      await settle();
      assert.equal(h.delivered.length, 1, mode);
      assert.equal(
        h.delivered[0].details.cleanupOutcome,
        "retained",
        mode + " must expose unresolved native ownership",
      );
      assert.notEqual(h.delivered[0].details.exitCode, 0);
      assert.match(h.delivered[0].content, /PROTECTED_CLEANUP_58/);
      assert.equal(closes, 1, "unverified cleanup is never blindly retried");
      assert.ok(readFileSync(nativeFile! + ".subagent-active.json", "utf8"));
      h.emit("context", { messages: h.delivered.map((m: any) => ({ role: "custom", ...m })) });
      h.emit("message_end", { message: { role: "assistant", stopReason: "stop" } });
      const done = await h.tools
        .get("subagent_done")
        .execute("done", {}, undefined, undefined, h.ctx);
      assert.equal(
        done.isError,
        true,
        mode + " result consumption cannot clear unverified cleanup ownership",
      );
      assert.match(done.content[0].text, /unresolved/);
      assert.match(done.content[0].text, /PROTECTED_CLEANUP_58/);
      assert.equal(h.shutdowns(), 0);
    });
  }
});

test("an outcome journal write failure preserves the original reservation and exposes an actionable recovery hold", async () =>
  fixture(async ({ make, client }: any) => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const poll = client.poll;
    client.poll = async (...args: any[]) => {
      await gate;
      return poll(...args);
    };
    const h = make("journal-failure-owner");
    h.emit("session_start");
    await spawn(h, "JournalFailureChild");
    const directory = h.ctx.sessionManager.getSessionFile() + ".delegations";
    const receipt = join(directory, readdirSync(directory)[0]);
    const original = readFileSync(receipt, "utf8");
    chmodSync(directory, 0o500);
    try {
      release();
      await settle();
      await settle();
      assert.equal(
        readFileSync(receipt, "utf8"),
        original,
        "failed publication leaves original durable reservation intact",
      );
      assert.ok(
        h.delivered.length <= 1,
        "failed journal publication cannot emit duplicate outcomes",
      );
      if (h.delivered.length) {
        assert.notEqual(
          h.delivered[0].details.exitCode,
          0,
          "a journal failure is not successful completion",
        );
        h.emit("context", { messages: h.delivered.map((m: any) => ({ role: "custom", ...m })) });
        h.emit("message_end", { message: { role: "assistant", stopReason: "stop" } });
      }
      const done = await h.tools
        .get("subagent_done")
        .execute("done", {}, undefined, undefined, h.ctx);
      assert.equal(done.isError, true);
      assert.ok(
        done.content[0].text.includes(receipt),
        "recovery guidance identifies the exact durable receipt",
      );
      assert.match(done.content[0].text, /EACCES|permission|journal.*failed/i);
      assert.equal(h.shutdowns(), 0);
    } finally {
      chmodSync(directory, 0o700);
    }
  }));
