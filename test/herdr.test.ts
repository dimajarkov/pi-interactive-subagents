import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getMuxBackend,
  createSurface,
  sendCommand,
  readScreen,
  readScreenAsync,
  closeSurface,
  sendEscape,
} from "../pi-extension/subagents/cmux.ts";

const dir = mkdtempSync(join(tmpdir(), "pi-herdr-adapter-"));
const log = join(dir, "calls.jsonl");
writeFileSync(
  join(dir, "herdr"),
  `#!/usr/bin/env node
const fs = require("node:fs");
const rawArgs = process.argv.slice(2);
const args = rawArgs[0] === "--session" ? rawArgs.slice(2) : rawArgs;
fs.appendFileSync(process.env.HERDR_TEST_LOG, JSON.stringify(rawArgs) + "\\n");
if (process.env.HERDR_TEST_FAILURE === args[1]) {
  process.stderr.write(JSON.stringify({ error: { code: "protected_close", message: "Pane is protected; private task" } }));
  process.exit(1);
}
if (process.env.HERDR_TEST_MALFORMED === args[1]) {
  process.stdout.write("malformed");
  process.exit(0);
}
if (args[1] === "read") process.stdout.write("child output\\n");
else if (["run", "send-keys"].includes(args[1])) process.stdout.write("");
else process.stdout.write(JSON.stringify({ result: { pane: { pane_id: "opaque-child", terminal_id: process.env.HERDR_TEST_TERMINAL || "terminal-child" } } }));
`,
  { mode: 0o700 },
);
const original = { ...process.env };
process.env.HERDR_TEST_LOG = log;
process.env.PATH = `${dir}:${process.env.PATH}`;
process.env.HERDR_ENV = "1";
process.env.HERDR_PANE_ID = "opaque-caller";
process.env.HERDR_TAB_ID = "opaque-tab";
process.env.HERDR_WORKSPACE_ID = "opaque-workspace";

test("Herdr is selected inside Herdr and explicit unavailable backend never falls back", () => {
  try {
    delete process.env.PI_SUBAGENT_MUX;
    assert.equal(getMuxBackend(), "herdr");
    process.env.PI_SUBAGENT_MUX = "tmux";
    delete process.env.TMUX;
    assert.equal(getMuxBackend(), null);
    process.env.PI_SUBAGENT_MUX = "herdr";
    delete process.env.HERDR_ENV;
    assert.equal(getMuxBackend(), null);
  } finally {
    process.env.HERDR_ENV = "1";
    process.env.PI_SUBAGENT_MUX = "herdr";
  }
});

after(() => {
  process.env = original;
  rmSync(dir, { recursive: true, force: true });
});

test("a caller-relative background child can launch, read, and close using its returned opaque handle", async () => {
  const child = createSurface("Scout", "/tmp/explicit child cwd");
  assert.equal(child, "opaque-child");
  sendCommand(child, "pi --model openai-codex/gpt-6.1-sol");
  assert.equal(readScreen(child, 12), "child output\n");
  assert.equal(await readScreenAsync(child, 12), "child output\n");
  closeSurface(child);
  const calls = readFileSync(log, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.deepEqual(
    calls.filter((args) => args[1] === "split"),
    [
      [
        "pane",
        "split",
        "--current",
        "--direction",
        "right",
        "--cwd",
        "/tmp/explicit child cwd",
        "--no-focus",
      ],
    ],
  );
  assert.deepEqual(
    calls.filter((args) => args[1] === "run"),
    [["pane", "run", "opaque-child", "pi --model openai-codex/gpt-6.1-sol"]],
  );
  assert.deepEqual(
    calls.filter((args) => args[1] === "close"),
    [["pane", "close", "opaque-child"]],
  );
  assert.equal(
    calls.some((args) => args.includes("focus")),
    false,
  );
});

test("an incomplete Herdr caller fails closed even with another available multiplexer", () => {
  delete process.env.PI_SUBAGENT_MUX;
  const pane = process.env.HERDR_PANE_ID;
  const tmux = process.env.TMUX;
  delete process.env.HERDR_PANE_ID;
  process.env.TMUX = "available-session";
  writeFileSync(join(dir, "tmux"), "#!/bin/sh\nexit 0\n", { mode: 0o700 });
  try {
    assert.equal(getMuxBackend(), null);
  } finally {
    process.env.HERDR_PANE_ID = pane;
    if (tmux === undefined) delete process.env.TMUX;
    else process.env.TMUX = tmux;
    process.env.PI_SUBAGENT_MUX = "herdr";
  }
});

test("unowned and stale children reject input and closure without affecting another pane", () => {
  assert.throws(() => sendCommand("unrelated-focused", "dangerous command"), /not an owned child/);
  const child = createSurface("Owned");
  process.env.HERDR_TEST_TERMINAL = "replacement-terminal";
  try {
    assert.throws(() => sendCommand(child, "dangerous command"), /stale or replaced/);
    assert.throws(() => closeSurface(child), /stale or replaced/);
  } finally {
    delete process.env.HERDR_TEST_TERMINAL;
  }
  sendEscape(child);
  closeSurface(child);
  assert.throws(() => readScreen(child), /not an owned child/);
  const calls = readFileSync(log, "utf8");
  assert.equal(calls.includes("dangerous command"), false);
  assert.equal(calls.includes("unrelated-focused"), false);
});

test("launch and protected-close failures preserve actionable diagnostics and never change backend", () => {
  const child = createSurface("Failure");
  process.env.HERDR_TEST_FAILURE = "run";
  assert.throws(
    () => sendCommand(child, "private task"),
    (error: Error) => {
      assert.match(error.message, /Herdr run failed.*protected_close/);
      assert.equal(error.message.includes("private task"), false);
      return true;
    },
  );
  assert.equal(getMuxBackend(), "herdr");
  process.env.HERDR_TEST_FAILURE = "close";
  assert.throws(() => closeSurface(child), /Herdr close failed.*Pane is protected/);
  delete process.env.HERDR_TEST_FAILURE;
  assert.equal(readScreen(child), "child output\n");
  closeSurface(child);
});

test("malformed creation never guesses a child target", () => {
  process.env.HERDR_TEST_MALFORMED = "split";
  const before = readFileSync(log, "utf8");
  try {
    assert.throws(() => createSurface("Malformed"), /malformed or unsuccessful JSON/);
  } finally {
    delete process.env.HERDR_TEST_MALFORMED;
  }
  const newCalls = readFileSync(log, "utf8")
    .slice(before.length)
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.equal(newCalls.length, 1);
  assert.equal(newCalls[0][1], "split");
});

test("changing Herdr session refuses an old owned handle", () => {
  const child = createSurface("Session");
  process.env.HERDR_SESSION = "another-session";
  try {
    assert.throws(() => closeSurface(child), /caller context changed/);
  } finally {
    delete process.env.HERDR_SESSION;
  }
  closeSurface(child);
});

test("a named caller session is explicit on every owned CLI operation", async () => {
  process.env.HERDR_SESSION = "owned-session";
  const before = readFileSync(log, "utf8");
  try {
    const child = createSurface("Named session");
    sendCommand(child, "pi");
    assert.equal(await readScreenAsync(child), "child output\n");
    closeSurface(child);
  } finally {
    delete process.env.HERDR_SESSION;
  }
  const calls = readFileSync(log, "utf8")
    .slice(before.length)
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.ok(calls.length > 0);
  assert.ok(
    calls.every(
      (args) => args[0] === "--session" && args[1] === "owned-session" && args[2] === "pane",
    ),
  );
});
