import { test } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import control from "../pi-extension/subagents/herdr-control.ts";

const condition = {
  job: {
    terminal: {
      pane_id: "owned-pane",
      tab_id: "owned-tab",
      terminal_id: "owned-terminal",
      launch_id: "launch",
    },
    job_id: "job",
  },
  connection: "connection",
  epoch: "",
  session: "native-session",
};
async function fixture(run: (h: any) => Promise<void>, nativeSession = "native-session") {
  const dir = mkdtempSync(join(tmpdir(), "pi-control-"));
  const socket = join(dir, "route.sock");
  const env = { ...process.env };
  const frames: any[] = [];
  const peers: net.Socket[] = [];
  let registrationReply: ((frame: any) => any) | undefined;
  const server = net.createServer((peer) => {
    peers.push(peer);
    let buffer = "";
    peer.on("data", (chunk) => {
      buffer += chunk;
      while (buffer.includes("\n")) {
        const i = buffer.indexOf("\n");
        const frame = JSON.parse(buffer.slice(0, i));
        buffer = buffer.slice(i + 1);
        frames.push(frame);
        if (frame.method === "agent.control.register")
          peer.write(
            JSON.stringify(
              registrationReply
                ? registrationReply(frame)
                : {
                    id: frame.id,
                    result: {
                      type: "agent_control_registered",
                      condition: {
                        ...condition,
                        session: nativeSession,
                        epoch: frame.params.epoch,
                      },
                    },
                  },
            ) + "\n",
          );
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(socket, resolve));
  Object.assign(process.env, {
    HERDR_CONTROL_CAPABILITY: "one-use-secret",
    HERDR_CONTROL_VERSION: "1",
    HERDR_CONTROL_SOCKET: socket,
  });
  const events = new Map<string, any[]>();
  const queued: any[] = [];
  let shutdown = 0;
  let current: any;
  let preparation: any;
  let aborted = 0;
  const notices: string[] = [];
  const nativeFile = join(dir, "native.jsonl");
  writeFileSync(nativeFile, JSON.stringify({ type: "session", id: nativeSession }) + "\n");
  const ctx = {
    sessionManager: { getSessionId: () => nativeSession, getSessionFile: () => nativeFile },
    getUserRequest: () => current,
    getUserRequestPreparation: () => preparation,
    isIdle: () => !current,
    hasPendingMessages: () => false,
    abort: () => {
      aborted++;
    },
    shutdown: () => {
      shutdown++;
    },
    ui: { notify: (s: string) => notices.push(s) },
  };
  const pi = {
    on(name: string, fn: any) {
      events.set(name, [...(events.get(name) ?? []), fn]);
    },
    enqueueMessage(message: any, options: any) {
      queued.push({ message, options });
      return { status: "queued" };
    },
  };
  const h = {
    pi,
    ctx,
    events,
    frames,
    peers,
    queued,
    notices,
    setRegistrationReply: (fn: (frame: any) => any) => {
      registrationReply = fn;
    },
    send: (method: string, params: any) =>
      peers[0].write(
        JSON.stringify({
          id: params.request_id,
          method,
          params: {
            condition: { ...condition, session: nativeSession, epoch: frames[0].params.epoch },
            ...params,
          },
        }) + "\n",
      ),
    setCurrent: (v: any) => {
      current = v;
    },
    setPreparation: (v: any) => {
      preparation = v;
    },
    aborts: () => aborted,
    shutdowns: () => shutdown,
    emit: async (name: string, event: any = {}) => {
      let result;
      for (const fn of (events.get(name) ?? []).slice()) result = await fn(event, ctx);
      return result;
    },
  };
  try {
    await run(h);
  } finally {
    await h.emit("session_shutdown");
    for (const p of peers) p.destroy();
    await new Promise<void>((r) => server.close(() => r()));
    process.env = env;
    rmSync(dir, { recursive: true, force: true });
  }
}

test("managed child registers once on its native session and scrubs one-use capability before tool inheritance", async () =>
  fixture(async (h) => {
    control(h.pi);
    assert.equal(process.env.HERDR_CONTROL_CAPABILITY, undefined);
    assert.equal(process.env.HERDR_CONTROL_SOCKET, undefined);
    await h.emit("session_start");
    const registration = h.frames.find((f: any) => f.method === "agent.control.register");
    assert.equal(registration.params.capability, "one-use-secret");
    assert.equal(registration.params.session, "native-session");
    assert.deepEqual(registration.params.sdk_features, [
      "input_request_lifecycle_v1",
      "message_admission_v1",
      "external_request_correlation_v1",
    ]);
    await h.emit("session_start");
    assert.equal(h.frames.filter((f: any) => f.method === "agent.control.register").length, 1);
  }));

async function waitFor(check: () => any) {
  const end = Date.now() + 1000;
  while (Date.now() < end) {
    const result = check();
    if (result) return result;
    await new Promise((r) => setTimeout(r, 5));
  }
  assert.fail("expected bounded control frame");
}
const nativeId = "d21d4734-0285-4f8a-8a84-26ed1da6a7d1";

test("prompt receives before synchronous correlated native acceptance and settles only its own request end", async () =>
  fixture(async (h) => {
    control(h.pi);
    await h.emit("session_start");
    h.pi.enqueueMessage = (message: any, options: any) => {
      h.queued.push({ message, options });
      const scope = { id: nativeId, correlationId: options.correlationId };
      h.setCurrent(scope);
      for (const fn of h.events.get("user_request_start") ?? []) fn({ request: scope }, h.ctx);
      return { status: "queued" };
    };
    h.send("agent.control.prompt", {
      request_id: "operation-one",
      text: "same text",
      deadline_ms: 1000,
    });
    await waitFor(() =>
      h.frames.find((f: any) => f.method === "agent.control.ack" && f.params.phase === "accepted"),
    );
    const phases = h.frames
      .filter((f: any) => f.method === "agent.control.ack")
      .map((f: any) => f.params.phase);
    assert.deepEqual(phases, ["received", "accepted"]);
    assert.equal(h.queued[0].options.correlationId, "operation-one");
    await h.emit("agent_settled", { aborted: false });
    await h.emit("user_request_end", {
      request: { id: "f866393d-9a72-4b79-ad3f-a1de4e05ce4c", correlationId: "foreign-identical" },
      outcome: "completed",
    });
    assert.equal(h.frames.filter((f: any) => f.params?.phase === "settled").length, 0);
    await h.emit("user_request_end", {
      request: { id: nativeId, correlationId: "operation-one" },
      outcome: "completed",
    });
    await waitFor(() => h.frames.find((f: any) => f.params?.phase === "settled"));
    assert.equal(
      h.frames.find((f: any) => f.params?.phase === "settled").params.native_request_id,
      nativeId,
    );
  }));

test("initial human native scope is observed and only exact current scope can be aborted", async () =>
  fixture(async (h) => {
    control(h.pi);
    await h.emit("session_start");
    const scope = { id: nativeId, source: "interactive", delivery: "prompt" };
    h.setCurrent(scope);
    await h.emit("user_request_start", { request: scope });
    const observation = await waitFor(() =>
      h.frames.find(
        (f: any) => f.method === "agent.control.observe" && f.params.native_scope_id === nativeId,
      ),
    );
    assert.deepEqual(observation.params.native_request_ids, [nativeId]);
    h.send("agent.control.abort", {
      request_id: "wrong-abort",
      native_request_id: "f866393d-9a72-4b79-ad3f-a1de4e05ce4c",
      deadline_ms: 1000,
    });
    await waitFor(() =>
      h.frames.find(
        (f: any) => f.params?.request_id === "wrong-abort" && f.params.phase === "rejected",
      ),
    );
    assert.equal(h.aborts(), 0);
    h.send("agent.control.abort", {
      request_id: "exact-abort",
      native_request_id: nativeId,
      deadline_ms: 1000,
    });
    await waitFor(() =>
      h.frames.find(
        (f: any) => f.params?.request_id === "exact-abort" && f.params.phase === "accepted",
      ),
    );
    assert.equal(h.aborts(), 1);
    h.setCurrent(undefined);
    await h.emit("user_request_end", { request: scope, outcome: "interrupted" });
    const settled = await waitFor(() =>
      h.frames.find(
        (f: any) => f.params?.request_id === "exact-abort" && f.params.phase === "settled",
      ),
    );
    assert.equal(settled.params.aborted, true);
  }));

test("unpatched SDK refuses enrollment and generic unmanaged children are a no-op", async () =>
  fixture(async (h) => {
    delete h.pi.enqueueMessage;
    control(h.pi);
    await h.emit("session_start");
    assert.equal(h.frames.length, 0);
    assert.match(h.notices[0], /patched native Pi SDK/);
    assert.equal(h.shutdowns(), 1);
    const events: string[] = [];
    control({ on: (name: string) => events.push(name) });
    assert.deepEqual(events, []);
  }));

test("preparation and pending native messages reject remote prompt without enqueuing a dummy wake", async () =>
  fixture(async (h) => {
    control(h.pi);
    await h.emit("session_start");
    h.setPreparation({ id: nativeId });
    h.send("agent.control.prompt", { request_id: "preparing", text: "hello", deadline_ms: 1000 });
    await waitFor(() =>
      h.frames.find(
        (f: any) => f.params?.request_id === "preparing" && f.params.phase === "rejected",
      ),
    );
    h.setPreparation(undefined);
    h.ctx.hasPendingMessages = () => true;
    h.send("agent.control.prompt", {
      request_id: "queued-native",
      text: "hello",
      deadline_ms: 1000,
    });
    await waitFor(() =>
      h.frames.find(
        (f: any) => f.params?.request_id === "queued-native" && f.params.phase === "rejected",
      ),
    );
    assert.equal(h.queued.length, 0);
  }));

test("grouped response admits only its exact correlated member and uses scope UUID for abort", async () =>
  fixture(async (h) => {
    control(h.pi);
    await h.emit("session_start");
    h.send("agent.control.prompt", {
      request_id: "group-operation",
      text: "same text",
      deadline_ms: 1000,
    });
    await waitFor(() => h.queued.length);
    const scopeId = "f866393d-9a72-4b79-ad3f-a1de4e05ce4c";
    const foreignId = "40dd6a75-1a5d-466d-bd89-a64612da1fdd";
    const scope = {
      id: scopeId,
      mode: "all",
      requests: [
        { id: foreignId, correlationId: "foreign-identical" },
        { id: nativeId, correlationId: "group-operation" },
      ],
    };
    h.setCurrent(scope);
    await h.emit("user_request_start", { request: scope });
    const accepted = await waitFor(() =>
      h.frames.find(
        (f: any) => f.params?.request_id === "group-operation" && f.params.phase === "accepted",
      ),
    );
    assert.equal(accepted.params.native_request_id, nativeId);
    h.send("agent.control.abort", {
      request_id: "member-is-not-scope",
      native_request_id: nativeId,
      deadline_ms: 1000,
    });
    await waitFor(() =>
      h.frames.find(
        (f: any) => f.params?.request_id === "member-is-not-scope" && f.params.phase === "rejected",
      ),
    );
    assert.equal(h.aborts(), 0);
    assert.deepEqual(await h.emit("session_before_switch"), { cancel: true });
    assert.equal(h.peers[0].destroyed, false);
    h.setCurrent(undefined);
    await h.emit("user_request_end", { request: scope, outcome: "completed" });
    await waitFor(() =>
      h.frames.find(
        (f: any) => f.params?.request_id === "group-operation" && f.params.phase === "settled",
      ),
    );
  }));

test("operation replay and unknown method reject without native mutation", async () =>
  fixture(async (h) => {
    control(h.pi);
    await h.emit("session_start");
    h.send("agent.control.unknown", { request_id: "unsupported", deadline_ms: 1000 });
    await waitFor(() =>
      h.frames.find(
        (f: any) => f.params?.request_id === "unsupported" && f.params.phase === "rejected",
      ),
    );
    h.send("agent.control.prompt", {
      request_id: "unsupported",
      text: "replayed",
      deadline_ms: 1000,
    });
    await waitFor(
      () =>
        h.frames.filter(
          (f: any) => f.params?.request_id === "unsupported" && f.params.phase === "rejected",
        ).length === 2,
    );
    assert.equal(h.queued.length, 0);
    assert.equal(h.aborts(), 0);
  }));

test("oversized and malformed frames close only the control route before any native mutation", async () => {
  for (const frame of ["x".repeat(16385), "{malformed}\n"]) {
    await fixture(async (h) => {
      control(h.pi);
      await h.emit("session_start");
      h.peers[0].write(frame);
      await waitFor(() => h.peers[0].destroyed);
      assert.equal(h.queued.length, 0);
      assert.equal(h.aborts(), 0);
      assert.ok(h.notices.some((s: string) => /frame/.test(s)));
    });
  }
});

test("queue rejection is explicit after received and does not reserve a native operation", async () =>
  fixture(async (h) => {
    control(h.pi);
    await h.emit("session_start");
    h.pi.enqueueMessage = () => {
      throw new Error("private exception must not leak");
    };
    h.send("agent.control.prompt", { request_id: "throwing", text: "hello", deadline_ms: 1000 });
    await waitFor(() =>
      h.frames.find(
        (f: any) => f.params?.request_id === "throwing" && f.params.phase === "rejected",
      ),
    );
    assert.deepEqual(
      h.frames
        .filter((f: any) => f.params?.request_id === "throwing")
        .map((f: any) => f.params.phase),
      ["received", "rejected"],
    );
    assert.ok(!JSON.stringify(h.frames).includes("private exception"));
  }));

test("ended observed scope cannot abort even while native getter retains it during end callbacks", async () =>
  fixture(async (h) => {
    control(h.pi);
    await h.emit("session_start");
    const scope = { id: nativeId, source: "interactive", delivery: "prompt" };
    h.setCurrent(scope);
    await h.emit("user_request_start", { request: scope });
    await h.emit("user_request_end", { request: scope, outcome: "completed" });
    h.send("agent.control.abort", {
      request_id: "after-end",
      native_request_id: nativeId,
      deadline_ms: 1000,
    });
    await waitFor(() =>
      h.frames.find(
        (f: any) => f.params?.request_id === "after-end" && f.params.phase === "rejected",
      ),
    );
    assert.equal(h.aborts(), 0);
  }));

test("failed startup blocks native initial input and shutdown survives an unwritable sidecar", async () =>
  fixture(async (h) => {
    process.env.PI_SUBAGENT_SESSION = "/nonexistent/herdr-control-test/task";
    delete h.pi.enqueueMessage;
    control(h.pi);
    await h.emit("session_start");
    assert.equal(h.shutdowns(), 1);
    assert.deepEqual(await h.emit("input", { text: "initial task", source: "interactive" }), {
      action: "handled",
    });
    assert.equal(h.queued.length, 0);
  }));

test("old connection or epoch rejects operations and never reenrolls on switch, fork or reload", async () => {
  for (const event of ["session_before_switch", "session_before_fork", "session_start"]) {
    await fixture(async (h) => {
      control(h.pi);
      await h.emit("session_start");
      await h.emit(event);
      await waitFor(() => h.peers[0].destroyed);
      await h.emit("session_start");
      assert.equal(h.frames.filter((f: any) => f.method === "agent.control.register").length, 1);
      assert.equal(h.shutdowns(), 0);
    });
  }
  await fixture(async (h) => {
    control(h.pi);
    await h.emit("session_start");
    h.send("agent.control.prompt", {
      request_id: "wrong-epoch",
      text: "private",
      deadline_ms: 1000,
      condition: { ...condition, epoch: "foreign" },
    });
    await waitFor(() => h.peers[0].destroyed);
    assert.equal(h.queued.length, 0);
    assert.equal(h.shutdowns(), 0);
  });
});

test("duplicate native correlation in a grouped scope revokes the ambiguous route without false acceptance", async () =>
  fixture(async (h) => {
    control(h.pi);
    await h.emit("session_start");
    h.send("agent.control.prompt", {
      request_id: "duplicate-members",
      text: "hello",
      deadline_ms: 1000,
    });
    await waitFor(() => h.queued.length);
    const scope = {
      id: "f866393d-9a72-4b79-ad3f-a1de4e05ce4c",
      mode: "all",
      requests: [
        { id: nativeId, correlationId: "duplicate-members" },
        { id: "40dd6a75-1a5d-466d-bd89-a64612da1fdd", correlationId: "duplicate-members" },
      ],
    };
    h.setCurrent(scope);
    await h.emit("user_request_start", { request: scope });
    await waitFor(() => h.peers[0].destroyed);
    assert.equal(h.frames.filter((f: any) => f.params?.phase === "accepted").length, 0);
    assert.equal(h.shutdowns(), 0);
  }));

test("missing public abort or shutdown refuses enrollment and initial input without a success receipt", async () => {
  await fixture(async (h) => {
    delete h.ctx.abort;
    control(h.pi);
    await h.emit("session_start");
    assert.equal(h.frames.length, 0);
    assert.equal(h.shutdowns(), 1);
    assert.deepEqual(await h.emit("input", { text: "task" }), { action: "handled" });
  });
  await fixture(async (h) => {
    delete h.ctx.shutdown;
    control(h.pi);
    await assert.rejects(() => h.emit("session_start"), /shutdown capability unavailable/);
    assert.equal(h.frames.length, 0);
    assert.equal(h.queued.length, 0);
    assert.deepEqual(await h.emit("input", { text: "task" }), { action: "handled" });
  });
});

test("JSON null, arrays and scalars revoke malformed pre/post-registration routes without uncaught callbacks", async () => {
  for (const value of [null, [], true, 42, "scalar"]) {
    await fixture(async (h) => {
      h.setRegistrationReply(() => value);
      control(h.pi);
      await h.emit("session_start");
      assert.equal(h.shutdowns(), 1);
      assert.equal(h.queued.length, 0);
    });
    await fixture(async (h) => {
      control(h.pi);
      await h.emit("session_start");
      h.peers[0].write(JSON.stringify(value) + "\n");
      await waitFor(() => h.peers[0].destroyed);
      assert.equal(h.shutdowns(), 0);
      assert.equal(h.queued.length, 0);
    });
  }
});

test("disconnect clears only local route admission authority so pending native work cannot strand switch or fork", async () =>
  fixture(async (h) => {
    control(h.pi);
    await h.emit("session_start");
    h.send("agent.control.prompt", {
      request_id: "route-loss",
      text: "already queued native message",
      deadline_ms: 1000,
    });
    await waitFor(() => h.queued.length);
    assert.deepEqual(await h.emit("session_before_switch"), { cancel: true });
    h.peers[0].destroy();
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(await h.emit("session_before_switch"), undefined);
    assert.equal(await h.emit("session_before_fork"), undefined);
    await h.emit("session_start");
    assert.equal(h.frames.filter((f: any) => f.method === "agent.control.register").length, 1);
    assert.equal(h.queued.length, 1);
    assert.equal(h.aborts(), 0);
    assert.equal(h.shutdowns(), 0);
  }));

test("same-native-session reload keeps enrollment and routes control only through a fresh registration", async () =>
  fixture(async (h) => {
    control(h.pi);
    await h.emit("session_start");
    await h.emit("session_shutdown", { reason: "reload" });
    const freshEvents = new Map<string, any[]>();
    const freshQueued: any[] = [];
    const freshCtx = {
      ...h.ctx,
      sessionManager: { ...h.ctx.sessionManager, getSessionId: () => "native-session" },
    };
    const fresh = {
      on: (name: string, fn: any) => freshEvents.set(name, [...(freshEvents.get(name) ?? []), fn]),
      enqueueMessage(message: any, options: any) {
        freshQueued.push({ message, options });
        return { status: "queued" as const };
      },
    };
    h.pi.enqueueMessage = () => {
      throw Error("stale SDK invoked");
    };
    for (const key of [
      "getUserRequest",
      "getUserRequestPreparation",
      "isIdle",
      "hasPendingMessages",
      "abort",
      "shutdown",
    ])
      h.ctx[key] = () => {
        throw Error("stale context invoked: " + key);
      };
    control(fresh);
    for (const fn of (freshEvents.get("session_start") ?? []).slice())
      await fn({ reason: "reload" }, freshCtx);
    assert.ok(
      freshEvents.has("session_start"),
      "fresh extension receives process-owned bridge handoff",
    );
    assert.equal(process.env.HERDR_CONTROL_CAPABILITY, undefined);
    assert.equal(
      h.frames.filter((f: any) => f.method === "agent.control.register").length,
      1,
      "consumed capability is never replayed",
    );
    h.send("agent.control.prompt", {
      request_id: "after-reload",
      text: "Fresh native guidance",
      deadline_ms: 1000,
    });
    await waitFor(() => freshQueued.length === 1);
    assert.equal(freshQueued[0].options.correlationId, "after-reload");
    for (const fn of freshEvents.get("session_shutdown") ?? [])
      await fn({ reason: "quit" }, freshCtx);
  }));

test("a different native session cannot claim or invalidate another host's quiescent connection", async () =>
  fixture(async (h) => {
    control(h.pi);
    await h.emit("session_start");
    await h.emit("session_shutdown", { reason: "reload" });
    const events = new Map<string, any[]>();
    const fresh = {
      on: (name: string, fn: any) => events.set(name, [...(events.get(name) ?? []), fn]),
      enqueueMessage: () => {
        throw Error("foreign session received control");
      },
    };
    control(fresh);
    const foreign = {
      ...h.ctx,
      sessionManager: { ...h.ctx.sessionManager, getSessionId: () => "foreign-native-session" },
    };
    for (const fn of (events.get("session_start") ?? []).slice())
      await fn({ reason: "reload" }, foreign);
    assert.equal(
      h.peers[0].destroyed,
      false,
      "foreign identity cannot consume or retire the original host's bridge",
    );
    await h.emit("session_shutdown", { reason: "quit" });
    await waitFor(() => h.peers[0].destroyed);
    assert.equal(h.frames.filter((f: any) => f.method === "agent.control.register").length, 1);
  }));

test("reload with an uncorrelated pending external prompt closes rather than handing off uncertain control", async () =>
  fixture(async (h) => {
    control(h.pi);
    await h.emit("session_start");
    h.send("agent.control.prompt", {
      request_id: "pending-at-reload",
      text: "pending",
      deadline_ms: 1000,
    });
    await waitFor(() => h.queued.length === 1);
    await h.emit("session_shutdown", { reason: "reload" });
    await waitFor(() => h.peers[0].destroyed);
    const events: string[] = [];
    control({
      on: (name: string) => events.push(name),
      enqueueMessage: () => ({ status: "queued" }),
    });
    assert.deepEqual(events, [], "an uncertain old operation has no process handoff owner");
    assert.equal(process.env.HERDR_CONTROL_CAPABILITY, undefined);
  }));

test("independent native hosts reclaim their own reload connections in reverse registration order", async () =>
  fixture(async (a) => {
    control(a.pi);
    await a.emit("session_start");
    await a.emit("session_shutdown", { reason: "reload" });
    await fixture(async (b) => {
      control(b.pi);
      await b.emit("session_start");
      await b.emit("session_shutdown", { reason: "reload" });
      const reload = async (h: any) => {
        const events = new Map<string, any[]>();
        const queued: any[] = [];
        const sdk = {
          on: (name: string, fn: any) => events.set(name, [...(events.get(name) ?? []), fn]),
          enqueueMessage: (message: any, options: any) => {
            queued.push({ message, options });
            return { status: "queued" as const };
          },
        };
        control(sdk);
        const ctx = { ...h.ctx };
        for (const fn of (events.get("session_start") ?? []).slice())
          await fn({ reason: "reload" }, ctx);
        return { events, queued, ctx };
      };
      const freshB = await reload(b),
        freshA = await reload(a);
      a.send("agent.control.prompt", {
        request_id: "a-after-reload",
        text: "A guidance",
        deadline_ms: 1000,
      });
      b.send("agent.control.prompt", {
        request_id: "b-after-reload",
        text: "B guidance",
        deadline_ms: 1000,
      });
      await waitFor(() => freshA.queued.length === 1 && freshB.queued.length === 1);
      assert.equal(freshA.queued[0].options.correlationId, "a-after-reload");
      assert.equal(freshB.queued[0].options.correlationId, "b-after-reload");
      assert.equal(a.frames.filter((f: any) => f.method === "agent.control.register").length, 1);
      assert.equal(b.frames.filter((f: any) => f.method === "agent.control.register").length, 1);
      for (const fresh of [freshA, freshB])
        for (const fn of (fresh.events.get("session_shutdown") ?? []).slice())
          await fn({ reason: "quit" }, fresh.ctx);
    }, "native-host-B");
  }, "native-host-A"));

test("a failed reload expires the quiescent process bridge after thirty seconds", async (t) =>
  fixture(async (h) => {
    control(h.pi);
    await h.emit("session_start");
    t.mock.timers.enable({ apis: ["setTimeout"] });
    try {
      await h.emit("session_shutdown", { reason: "reload" });
      t.mock.timers.tick(30_001);
    } finally {
      t.mock.timers.reset();
    }
    await waitFor(() => h.peers[0].destroyed);
    const registrations: string[] = [];
    control({
      on: (name: string) => registrations.push(name),
      enqueueMessage: () => ({ status: "queued" }),
    });
    assert.deepEqual(registrations, [], "expired owner cannot be silently reattached");
    assert.equal(process.env.HERDR_CONTROL_CAPABILITY, undefined);
  }));

test("a control request arriving during the reload gap retires uncertain ownership", async () =>
  fixture(async (h) => {
    control(h.pi);
    await h.emit("session_start");
    await h.emit("session_shutdown", { reason: "reload" });
    h.send("agent.control.prompt", {
      request_id: "during-reload",
      text: "must not disappear silently",
      deadline_ms: 1000,
    });
    await waitFor(() => h.peers[0].destroyed);
    const registrations: string[] = [];
    control({
      on: (name: string) => registrations.push(name),
      enqueueMessage: () => ({ status: "queued" }),
    });
    assert.deepEqual(registrations, []);
    assert.deepEqual(h.queued, [], "quiesced owner invokes no stale native API");
  }));

test("reload without a concrete native file cannot hand off an enrolled controller", async () =>
  fixture(async (h) => {
    delete h.ctx.sessionManager.getSessionFile;
    control(h.pi);
    await h.emit("session_start");
    await h.emit("session_shutdown", { reason: "reload" });
    await waitFor(() => h.peers[0].destroyed);
    const registrations: string[] = [];
    control({
      on: (name: string) => registrations.push(name),
      enqueueMessage: () => ({ status: "queued" }),
    });
    assert.deepEqual(registrations, []);
  }));
