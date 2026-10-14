/** Opt-in native Pi/Herdr proof. Requires an explicitly authorized named session.
 * PI_HERDR_TEST_SESSION=handovers PI_HERDR_TEST_AUTH=/path/to/auth.json
 * node --test test/integration/herdr-first-child.test.ts
 * Evidence and native sessions stay in an owner-private temporary directory.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { shellEscape } from "../../pi-extension/subagents/cmux.ts";

const session = process.env.PI_HERDR_TEST_SESSION;
const authPath = process.env.PI_HERDR_TEST_AUTH;
const model = "openai-codex/gpt-6.1-sol";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test(
  "real public subagent call returns before independent native Pi child completion",
  {
    skip: !session || !authPath,
    timeout: 240_000,
  },
  async () => {
    const authBytes = readFileSync(authPath!);
    const auth = JSON.parse(authBytes.toString());
    assert.equal(auth["openai-codex"]?.type, "oauth", "requires existing approved OAuth");
    assert.ok(
      auth["openai-codex"].expires - Date.now() > 15 * 60_000,
      "refuse expired or near-expiry auth; do not reconnect or refresh",
    );
    const authHash = createHash("sha256").update(authBytes).digest("hex");
    const dir = mkdtempSync(join(realpathSync(tmpdir()), "pi-herdr-first-child-"));
    const config = join(dir, "config");
    const project = join(dir, "project");
    const childCwd = join(dir, "child-cwd");
    const sessions = join(config, "sessions");
    for (const path of [config, project, childCwd, sessions, join(project, ".pi", "agents")])
      mkdirSync(path, { recursive: true, mode: 0o700 });
    symlinkSync(resolve(authPath!), join(config, "auth.json"));
    writeFileSync(
      join(config, "settings.json"),
      JSON.stringify({
        defaultProvider: "openai-codex",
        defaultModel: "gpt-6.1-sol",
        defaultThinkingLevel: "medium",
        enabledModels: ["openai-codex/*"],
        packages: [],
        extensions: [],
        skills: [],
        quietStartup: true,
        shellPath: "/bin/bash",
      }),
    );
    writeFileSync(
      join(project, ".pi", "agents", "test-herdr.md"),
      `---\nname: test-herdr\nmodel: ${model}\nthinking: medium\nauto-exit: true\ntools: bash,read\n---\nRun only the exact synthetic task given by the parent. Do not inspect any user files.\n`,
    );
    const herdr = (args: string[]) =>
      execFileSync("herdr", ["--session", session!, ...args], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    const json = (args: string[]) => JSON.parse(herdr(args)).result;
    const before = json(["workspace", "list"]).workspaces;
    const focusedBefore = before.filter((w: any) => w.focused).map((w: any) => w.workspace_id);
    const created = json([
      "workspace",
      "create",
      "--label",
      "pi-herdr-first-child-proof",
      "--cwd",
      project,
      "--no-focus",
      "--env",
      `PI_CODING_AGENT_DIR=${config}`,
      "--env",
      `PI_CODING_AGENT_SESSION_DIR=${sessions}`,
      "--env",
      "PI_OFFLINE=1",
      "--env",
      "PI_TELEMETRY=0",
      "--env",
      "PI_SUBAGENT_MUX=herdr",
    ]);
    const workspace = created.workspace.workspace_id;
    const pane = created.root_pane.pane_id;
    const terminal = created.root_pane.terminal_id;
    assert.equal(created.workspace.focused, false);
    const parentMarker = join(dir, "parent-continued.txt");
    const childMarker = join(dir, "child-cwd.txt");
    const delivered = join(dir, "parent-delivered.txt");
    const parentSession = join(sessions, "parent.jsonl");
    const task = `Synthetic integration proof. First call subagent with name "HerdrProof", agent "test-herdr", cwd ${JSON.stringify(childCwd)}, task ${JSON.stringify(`Run exactly: sleep 20; pwd -P > ${shellEscape(childMarker)}. Then return exactly HERDR_CHILD_EXPECTED_RESULT_37.`)}. Immediately after the subagent tool returns, use bash to write PARENT_CONTINUED_37 to ${parentMarker} while the child is still running. Wait for its independent completion notification, then write the exact delivered result token to ${delivered} and reply HERDR_PARENT_RECEIVED_37. Do not interrupt, focus, or close panes. Do not inspect any user files.`;
    const taskFile = join(dir, "task.md");
    writeFileSync(taskFile, task);
    const launch = join(dir, "launch.sh");
    writeFileSync(
      launch,
      [
        "#!/bin/bash",
        `export PI_CODING_AGENT_DIR=${shellEscape(config)}`,
        `export PI_CODING_AGENT_SESSION_DIR=${shellEscape(sessions)}`,
        `export HERDR_SESSION=${shellEscape(session!)}`,
        "export PI_SUBAGENT_MUX=herdr PI_TELEMETRY=0 PI_OFFLINE=1",
        `cd ${shellEscape(project)}`,
        `pi -ne -ns -np -nc --no-mcp -a -e ${shellEscape(join(root, "pi-extension/subagents/index.ts"))} --session ${shellEscape(parentSession)} --model ${model} --thinking medium @${shellEscape(taskFile)}`,
      ].join("\n"),
    );
    writeFileSync(
      join(dir, "ownership.json"),
      JSON.stringify({ session, workspace, pane, terminal, dir }, null, 2),
    );
    console.log(`Private evidence directory: ${dir}`);
    herdr(["pane", "run", pane, `bash ${shellEscape(launch)}`]);
    let seenChild: any;
    const deadline = Date.now() + 180_000;
    while (Date.now() < deadline && !existsSync(delivered)) {
      const panes = json(["pane", "list", "--workspace", workspace]).panes;
      const child = panes.find((p: any) => p.pane_id !== pane);
      if (child) {
        assert.equal(child.focused, false);
        assert.equal(child.cwd, childCwd);
        seenChild = {
          pane: child.pane_id,
          terminal: child.terminal_id,
          cwd: child.cwd,
          focused: child.focused,
          agent: child.agent,
        };
      }
      await pause(1000);
    }
    writeFileSync(
      join(dir, "parent-screen.txt"),
      herdr(["pane", "read", pane, "--source", "recent-unwrapped", "--lines", "160"]),
    );
    assert.ok(
      existsSync(delivered),
      "parent must receive independent child completion before timeout",
    );
    assert.ok(seenChild, "real child pane observed");
    assert.equal(readFileSync(childMarker, "utf8").trim(), childCwd);
    assert.ok(
      statSync(parentMarker).mtimeMs < statSync(childMarker).mtimeMs,
      "parent continues before child task finishes",
    );
    assert.equal(readFileSync(delivered, "utf8").trim(), "HERDR_CHILD_EXPECTED_RESULT_37");
    const entries = readFileSync(parentSession, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.ok(
      entries.some((entry) => JSON.stringify(entry).includes('"toolName":"subagent"')),
      "registered public subagent tool was called",
    );
    assert.ok(
      entries.some(
        (entry) =>
          JSON.stringify(entry).includes('"customType":"subagent_result"') &&
          JSON.stringify(entry).includes("HERDR_CHILD_EXPECTED_RESULT_37"),
      ),
      "asynchronous child result delivered to parent conversation",
    );
    const result = entries.find((entry) => entry.customType === "subagent_result");
    const childEntries = readFileSync(result.details.sessionFile, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.ok(
      childEntries.some(
        (entry) =>
          entry.type === "model_change" &&
          entry.provider === "openai-codex" &&
          entry.modelId === "gpt-6.1-sol",
      ),
      "native child uses the approved exact model",
    );
    assert.ok(
      childEntries.some(
        (entry) => entry.type === "thinking_level_change" && entry.thinkingLevel === "medium",
      ),
      "native child uses medium thinking",
    );
    const remaining = json(["pane", "list", "--workspace", workspace]).panes;
    assert.deepEqual(
      remaining.map((p: any) => p.pane_id),
      [pane],
      "owned completed child was closed",
    );
    const after = json(["workspace", "list"]).workspaces;
    assert.deepEqual(
      after.filter((w: any) => w.focused).map((w: any) => w.workspace_id),
      focusedBefore,
      "background launch preserves workspace focus",
    );
    assert.ok(
      before.every((w: any) => after.some((a: any) => a.workspace_id === w.workspace_id)),
      "unrelated workspaces preserved",
    );
    assert.equal(
      createHash("sha256").update(readFileSync(authPath!)).digest("hex"),
      authHash,
      "active OAuth store unchanged",
    );
    writeFileSync(
      join(dir, "result.json"),
      JSON.stringify(
        {
          session,
          workspace,
          parentPane: pane,
          child: seenChild,
          model,
          thinking: "medium",
          nonblocking: true,
          independentDelivery: true,
          childClosed: true,
          focusPreserved: true,
          unrelatedWorkspacesPreserved: true,
          authUnchanged: true,
          nativeVisualAcceptance: false,
        },
        null,
        2,
      ),
    );
    // Keep the task-owned parent and private evidence available for review.
    // Cleanup uses recorded identity and explicit /quit after acceptance, never server stop.
  },
);
