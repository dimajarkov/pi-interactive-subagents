/** Public adapter and integration-harness regression boundaries.
 * Fake executable boundaries prove routing, not a running multiplexer or native UI.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TEST_MODEL, createTestEnv } from "./integration/harness.ts";

test("upstream lifecycle harness defaults parent and synthetic child roles to approved OpenAI models", () => {
  const env = createTestEnv("wezterm");
  try {
    assert.equal(TEST_MODEL, process.env.PI_TEST_MODEL ?? "openai-codex/gpt-6.1-sol");
    for (const role of ["test-echo", "test-ping"]) {
      const definition = readFileSync(join(env.dir, ".pi", "agents", `${role}.md`), "utf8");
      assert.match(definition, /^model: openai-codex\/gpt-6\.1-sol$/m);
    }
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

test("explicit selection retains all four upstream backends inside a Herdr environment", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pi43-selection-"));
  const original = { ...process.env };
  try {
    for (const backend of ["cmux", "tmux", "zellij", "wezterm"]) {
      writeFileSync(join(dir, backend), "#!/bin/sh\nexit 0\n", { mode: 0o700 });
    }
    process.env.PATH = `${dir}:${process.env.PATH}`;
    process.env.HERDR_ENV = "1";
    process.env.CMUX_SOCKET_PATH = "/synthetic/cmux";
    process.env.TMUX = "synthetic-tmux";
    process.env.ZELLIJ = "synthetic-zellij";
    process.env.WEZTERM_UNIX_SOCKET = "/synthetic/wezterm";
    const { getMuxBackend } = await import("../pi-extension/subagents/cmux.ts");
    for (const backend of ["cmux", "tmux", "zellij", "wezterm"]) {
      process.env.PI_SUBAGENT_MUX = backend;
      assert.equal(getMuxBackend(), backend);
    }
    for (const [backend, variable] of [
      ["cmux", "CMUX_SOCKET_PATH"],
      ["tmux", "TMUX"],
      ["zellij", "ZELLIJ"],
      ["wezterm", "WEZTERM_UNIX_SOCKET"],
    ]) {
      process.env.PI_SUBAGENT_MUX = backend;
      delete process.env[variable];
      delete process.env.ZELLIJ_SESSION_NAME;
      assert.equal(getMuxBackend(), null);
    }
  } finally {
    process.env = original;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("WezTerm public operations target the returned pane for text, Escape, reads and closure", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pi43-wez-cli-"));
  const original = { ...process.env };
  const log = join(dir, "calls.jsonl");
  try {
    writeFileSync(
      join(dir, "wezterm"),
      `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.PI43_LOG, JSON.stringify(args) + '\\n');
if (args[1] === 'split-pane') process.stdout.write('41');
if (args[1] === 'get-text') process.stdout.write('TOP\\n\\nSYNTHETIC_WEZ_OUTPUT\\n' + '\\n'.repeat(30));
`,
      { mode: 0o700 },
    );
    process.env.PATH = `${dir}:${process.env.PATH}`;
    process.env.PI43_LOG = log;
    process.env.PI_SUBAGENT_MUX = "wezterm";
    process.env.WEZTERM_UNIX_SOCKET = "/synthetic/wezterm";
    const mux = await import("../pi-extension/subagents/cmux.ts");
    const pane = mux.createSurfaceSplit("Synthetic", "right", "40");
    assert.equal(pane, "41");
    mux.sendCommand(pane, "printf SYNTHETIC");
    mux.sendEscape(pane);
    assert.equal(mux.readScreen(pane, 5).trim(), "TOP\n\nSYNTHETIC_WEZ_OUTPUT");
    assert.equal((await mux.readScreenAsync(pane, 5)).trim(), "TOP\n\nSYNTHETIC_WEZ_OUTPUT");
    mux.closeSurface(pane);
    const calls = readFileSync(log, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.ok(calls.some((args) => args[1] === "split-pane" && args.includes("40")));
    for (const args of calls.filter((args) => args[1] !== "split-pane")) {
      assert.equal(args[args.indexOf("--pane-id") + 1], "41");
    }
    assert.ok(calls.some((args) => args[1] === "send-text" && args.at(-1) === "\u001b"));
    assert.ok(calls.some((args) => args[1] === "kill-pane"));
  } finally {
    process.env = original;
    rmSync(dir, { recursive: true, force: true });
  }
});
