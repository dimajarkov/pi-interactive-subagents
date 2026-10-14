import { test } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HerdrParent } from "../pi-extension/subagents/herdr-parent.ts";
async function fixture(fn: (h: any) => Promise<void>, supported = true) {
  const dir = mkdtempSync(join(tmpdir(), "herdr-parent-"));
  const socket = join(dir, "api.sock");
  const calls: any[] = [];
  const state: any = {};
  const server = net.createServer((stream) => {
    let buf = "";
    stream.on("data", (chunk) => {
      buf += chunk;
      while (buf.includes("\n")) {
        const n = buf.indexOf("\n");
        const req = JSON.parse(buf.slice(0, n));
        buf = buf.slice(n + 1);
        calls.push(req);
        if (state.raw) {
          stream.end(state.raw);
          continue;
        }
        let result: any;
        if (req.method === "terminal.job.capabilities") {
          if (!supported) {
            stream.end(
              JSON.stringify({
                id: req.id,
                error: { code: "unknown_method", message: "unsupported" },
              }) + "\n",
            );
            continue;
          }
          result = {
            type: "managed_terminal_capabilities",
            job_ownership: true,
            cooperative_control: true,
            version: 1,
            max_frame_bytes: 16384,
            required_sdk_features: state.sdkFeatures ?? [
              "input_request_lifecycle_v1",
              "message_admission_v1",
              "external_request_correlation_v1",
            ],
          };
        } else if (req.method === "terminal.condition")
          result = {
            type: "terminal_condition",
            condition: {
              pane_id: "parent",
              tab_id: "tab",
              terminal_id: "terminal",
              launch_id: "launch",
            },
          };
        else if (req.method === "terminal.job.launch") {
          assert.match(readFileSync(req.params.argv[1], "utf8"), /HERDR_PANE_ID/);
          result = {
            type: "managed_terminal",
            condition: {
              terminal: {
                pane_id: "child",
                tab_id: "tab",
                terminal_id: "child-terminal",
                launch_id: "child-launch",
              },
              job_id: "job",
            },
            phase: "awaiting_enrollment",
            agent: null,
            exit: null,
          };
        }
        if (req.method === "terminal.job.get")
          result = {
            type: "managed_terminal",
            condition: req.params.condition,
            phase: state.exited ? "exited" : "owned",
            diagnostic: state.exited ? "protected_close: retained owned resource" : null,
            agent: {
              job: req.params.condition,
              connection: "connection",
              epoch: "epoch",
              session: "native-session",
            },
            native_scope_id: "native-request",
            busy: true,
          };
        if (req.method === "agent.control.abort")
          result = {
            type: "agent_control_operation",
            request_id: req.params.request_id,
            phase: "queued",
          };
        if (req.method === "agent.control.status")
          result = {
            type: "agent_control_operation",
            request_id: req.params.request_id,
            phase: "settled",
            native_request_id: state.wrongNative ? "foreign-request" : "native-request",
            aborted: true,
          };
        if (req.method === "terminal.job.close") {
          stream.end(
            JSON.stringify({
              id: req.id,
              error: { code: "protected_close", message: "retained" },
            }) + "\n",
          );
          continue;
        }
        if (req.method === "terminal.job.release")
          result = {
            type: "managed_terminal",
            condition: req.params.condition,
            phase: "released",
            agent: null,
          };
        stream.end(JSON.stringify({ id: req.id, result }) + "\n");
      }
    });
  });
  await new Promise<void>((r) => server.listen(socket, r));
  try {
    await fn({ dir, calls, state, client: new HerdrParent(socket, "parent") });
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    rmSync(dir, { recursive: true, force: true });
  }
}
test("unsupported managed control fails before allocating or writing a launch script", () =>
  fixture(async (h) => {
    await assert.rejects(h.client.prepare(), /unknown_method/);
    assert.deepEqual(
      h.calls.map((x: any) => x.method),
      ["terminal.job.capabilities"],
    );
  }, false));
test("managed launch writes the complete private script before direct argv allocation and binds child identity from Herdr", () =>
  fixture(async (h) => {
    const job = await h.client.launch({
      name: "Owned child",
      cwd: h.dir,
      scriptPath: join(h.dir, "child.sh"),
      command: "pi --session '/tmp/native-session'; echo '__SUBAGENT_DONE_'$?'__'",
      env: { PI_SUBAGENT_ID: "child-id" },
    });
    assert.equal(job.condition.terminal.pane_id, "child");
    const launch = h.calls.find((x: any) => x.method === "terminal.job.launch");
    assert.deepEqual(launch.params.argv, ["/bin/bash", join(h.dir, "child.sh")]);
    assert.equal(launch.params.env.PI_SUBAGENT_ID, "child-id");
    assert.equal(launch.params.cwd, h.dir);
    assert.equal(launch.params.label, "Owned child");
    assert.deepEqual(
      h.calls.map((x: any) => x.method),
      ["terminal.job.capabilities", "terminal.condition", "terminal.job.launch"],
    );
  }));

test("scoped abort waits for exact native settlement and protected closure is never retried", () =>
  fixture(async (h) => {
    const job = await h.client.launch({
      name: "Owned child",
      cwd: h.dir,
      scriptPath: join(h.dir, "child.sh"),
      command: "pi",
    });
    const settled = await h.client.interrupt(job.condition);
    assert.equal(settled.phase, "settled");
    assert.equal(settled.aborted, true);
    const abort = h.calls.find((x: any) => x.method === "agent.control.abort");
    assert.equal(abort.params.native_request_id, "native-request");
    assert.equal(abort.params.condition.connection, "connection");
    await assert.rejects(h.client.close(job.condition), /protected_close/);
    assert.equal(h.calls.filter((x: any) => x.method === "terminal.job.close").length, 1);
    await h.client.release(job.condition);
    assert.equal(h.calls.at(-1).method, "terminal.job.release");
  }));

test("an exited receipt with protected-close diagnostics is not successful cleanup", () =>
  fixture(async (h) => {
    const job = await h.client.launch({
      name: "Owned child",
      cwd: h.dir,
      scriptPath: join(h.dir, "child.sh"),
      command: "pi",
    });
    h.state.exited = true;
    await assert.rejects(h.client.close(job.condition), /cleanup is unresolved.*protected_close/);
    assert.equal(h.calls.filter((x: any) => x.method === "terminal.job.close").length, 0);
  }));

test("malformed UTF-8 capability response fails without allocation", () =>
  fixture(async (h) => {
    h.state.raw = Buffer.from([123, 34, 105, 100, 34, 58, 34, 0xff, 34, 125, 10]);
    await assert.rejects(h.client.prepare(), /encoded data|encoding|UTF/i);
    assert.equal(h.calls.length, 1);
  }));
test("oversized response fails at the public transport bound without allocation", () =>
  fixture(async (h) => {
    h.state.raw = "x".repeat(16385);
    await assert.rejects(h.client.prepare(), /frame limit/);
    assert.equal(h.calls.length, 1);
  }));
test("interrupt never credits a successor native request settlement", () =>
  fixture(async (h) => {
    const job = await h.client.launch({
      name: "Owned child",
      cwd: h.dir,
      scriptPath: join(h.dir, "child.sh"),
      command: "pi",
    });
    h.state.wrongNative = true;
    await assert.rejects(h.client.interrupt(job.condition), /exact native request/);
    assert.equal(h.calls.filter((x: any) => x.method === "agent.control.abort").length, 1);
  }));

test("capability feature strings cannot masquerade as the required feature array", () =>
  fixture(async (h) => {
    h.state.sdkFeatures =
      "input_request_lifecycle_v1,message_admission_v1,external_request_correlation_v1";
    await assert.rejects(h.client.prepare(), /does not support/);
    assert.equal(h.calls.length, 1);
  }));
test("legacy empty-ID unknown-method reply explains refusal without accepting its identity", () =>
  fixture(async (h) => {
    h.state.raw =
      JSON.stringify({
        id: "",
        error: { code: "invalid_request", message: "unknown variant terminal.job.capabilities" },
      }) + "\n";
    await assert.rejects(
      h.client.prepare(),
      /managed API unsupported.*no pane allocated.*identity mismatch/i,
    );
    assert.equal(h.calls.length, 1);
  }));
