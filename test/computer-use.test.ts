import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  openVisualHost,
  readVisualRequest,
  completeVisualRequest,
  requestVisualObservation,
} from "../pi-extension/subagents/computer-use.ts";

test("a task-bound Pi observation receives the app host result", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-cu-test-"));
  const binding = {
    task: "synthetic-qa",
    session: "pi-session",
    checkout: realpathSync("."),
    role: "visual-tester",
    target: "synthetic-preview",
    hostThread: "codex-thread",
  };
  const host = openVisualHost(dir, binding, 10000);
  const waiting = requestVisualObservation(dir, binding, "Observe the synthetic preview");
  const request = readVisualRequest(dir, host);
  assert.ok(request);
  completeVisualRequest(dir, host, request.id, {
    status: "observed",
    summary: "The blue card is visible",
    nativeTool: "mcp__cua_repl.js",
    evidence: ["private-screenshot.png"],
  });
  const result = await waiting;
  assert.equal(result.summary, "The blue card is visible");
  assert.equal(result.hostThread, "codex-thread");
});

test("absent and foreign host bindings cannot create a GUI request", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-cu-negative-"));
  const binding = {
    task: "synthetic-qa",
    session: "pi-session",
    checkout: realpathSync("."),
    role: "visual-tester",
    target: "synthetic-preview",
    hostThread: "codex-thread",
  };
  await assert.rejects(requestVisualObservation(dir, binding, "Observe"), /No active Codex app/);
  openVisualHost(dir, binding);
  await assert.rejects(
    requestVisualObservation(dir, { ...binding, session: "foreign-session" }, "Observe"),
    /another task/,
  );
});

test("Pi receives a bounded host screenshot as image content", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-cu-image-"));
  const binding = {
    task: "synthetic-qa",
    session: "pi-session",
    checkout: realpathSync("."),
    role: "visual-tester",
    target: "synthetic-preview",
    hostThread: "codex-thread",
  };
  const host = openVisualHost(dir, binding);
  const waiting = requestVisualObservation(dir, binding, "Observe");
  const request = readVisualRequest(dir, host)!;
  const { writeFileSync } = await import("node:fs");
  writeFileSync(
    join(dir, "capture.png"),
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j6iQAAAAASUVORK5CYII=",
      "base64",
    ),
    { mode: 0o600 },
  );
  completeVisualRequest(dir, host, request.id, {
    status: "observed",
    summary: "Fixture",
    nativeTool: "mcp__cua_repl.js",
    evidence: [],
    image: "capture.png",
  });
  assert.equal((await waiting).image?.mimeType, "image/png");
});

test("native denial is preserved in the waiting Pi call", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-cu-denied-"));
  const binding = {
    task: "synthetic-qa",
    session: "pi-session",
    checkout: realpathSync("."),
    role: "visual-tester",
    target: "synthetic-preview",
    hostThread: "codex-thread",
  };
  const host = openVisualHost(dir, binding);
  const waiting = requestVisualObservation(dir, binding, "Observe");
  completeVisualRequest(dir, host, readVisualRequest(dir, host)!.id, {
    status: "denied",
    summary: "App access denied",
    nativeTool: "mcp__cua_repl.js",
    evidence: [],
  });
  await assert.rejects(waiting, /Native Computer Use denied: App access denied/);
});

test("expired host and cancelled Pi request fail closed", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-cu-expired-"));
  const binding = {
    task: "synthetic-qa",
    session: "pi-session",
    checkout: realpathSync("."),
    role: "visual-tester",
    target: "synthetic-preview",
    hostThread: "codex-thread",
  };
  openVisualHost(dir, binding, 1);
  await new Promise((resolve) => setTimeout(resolve, 5));
  await assert.rejects(requestVisualObservation(dir, binding, "Observe"), /stale/);
  const second = mkdtempSync(join(tmpdir(), "pi-cu-cancel-"));
  const live = openVisualHost(second, binding);
  const abort = new AbortController();
  const waiting = requestVisualObservation(second, binding, "Observe", abort.signal);
  abort.abort();
  await assert.rejects(waiting, /cancelled/);
  assert.throws(
    () =>
      completeVisualRequest(second, live, readVisualRequest(second, live)!.id, {
        status: "observed",
        summary: "Late",
        nativeTool: "mcp__cua_repl.js",
        evidence: [],
      }),
    /cancelled/,
  );
});

test("replaced host and foreign result cannot resume the original Pi request", async () => {
  const { writeFileSync } = await import("node:fs");
  const binding = {
    task: "synthetic-qa",
    session: "pi-session",
    checkout: realpathSync("."),
    role: "visual-tester",
    target: "synthetic-preview",
    hostThread: "codex-thread",
  };
  const dir = mkdtempSync(join(tmpdir(), "pi-cu-replaced-"));
  const host = openVisualHost(dir, binding);
  const waiting = requestVisualObservation(dir, binding, "Observe");
  writeFileSync(join(dir, "host.json"), JSON.stringify({ ...host, nonce: "replacement" }), {
    mode: 0o600,
  });
  await assert.rejects(waiting, /replaced/);
  const second = mkdtempSync(join(tmpdir(), "pi-cu-foreign-"));
  openVisualHost(second, binding);
  const pending = requestVisualObservation(second, binding, "Observe");
  writeFileSync(join(second, "result.json"), JSON.stringify({ id: "foreign", binding }), {
    mode: 0o600,
  });
  await assert.rejects(pending, /Foreign Computer Use result/);
});
