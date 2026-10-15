/** Native opt-in lifecycle proof through registered Pi tools and explicit Herdr CLI.
 * The terminal input below is synthetic CLI input, not physical keyboard acceptance.
 * PI_HERDR_TEST_SESSION=handovers PI_HERDR_TEST_AUTH=/path/to/auth.json
 * node --test test/integration/herdr-lifecycle.test.ts
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
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { shellEscape } from "../../pi-extension/subagents/cmux.ts";
const session = process.env.PI_HERDR_TEST_SESSION;
const authPath = process.env.PI_HERDR_TEST_AUTH;
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
const entries = (path: string) =>
  existsSync(path)
    ? readFileSync(path, "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((s) => JSON.parse(s))
    : [];
const messages = (path: string) =>
  entries(path)
    .filter((e) => e.type === "message")
    .map((e) => e.message);
const results = (path: string) => entries(path).filter((e) => e.customType === "subagent_result");
async function waitFor(check: () => any, label: string, timeout = 180_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = check();
    if (value) return value;
    await pause(500);
  }
  assert.fail(`Timeout: ${label}`);
}
function setup(label: string, autoExit: boolean, task: (dir: string) => string) {
  const original = readFileSync(authPath!);
  const auth = JSON.parse(original.toString());
  assert.equal(auth["openai-codex"]?.type, "oauth");
  assert.ok(auth["openai-codex"].expires - Date.now() > 15 * 60_000, "refuse auth refresh");
  const dir = mkdtempSync(join(realpathSync(tmpdir()), `pi-herdr-lifecycle-${label}-`));
  const config = join(dir, "config"),
    project = join(dir, "project"),
    sessions = join(config, "sessions");
  for (const p of [config, project, sessions, join(project, ".pi", "agents")])
    mkdirSync(p, { recursive: true, mode: 0o700 });
  symlinkSync(resolve(authPath!), join(config, "auth.json"));
  const failureExtension = join(dir, "failure.ts");
  writeFileSync(
    failureExtension,
    `export default function(pi) { if (process.env.PI_SUBAGENT_NAME === "FailureProof") pi.registerProvider("openai-codex", { api: "herdr-synthetic-error", apiKey: "synthetic-local-fixture", models: [{ id: "gpt-6.1-sol", name: "Synthetic failure fixture", reasoning: true, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 272000, maxTokens: 1024 }], streamSimple: () => { throw new Error("SYNTHETIC_PROVIDER_FAILURE_38"); } }); }`,
  );
  writeFileSync(
    join(config, "settings.json"),
    JSON.stringify({
      defaultProvider: "openai-codex",
      defaultModel: "gpt-6.1-sol",
      defaultThinkingLevel: "medium",
      enabledModels: ["openai-codex/*"],
      packages: [],
      extensions: [failureExtension],
      skills: [],
      shellPath: "/bin/bash",
      quietStartup: true,
    }),
  );
  writeFileSync(
    join(project, ".pi", "agents", "lifecycle.md"),
    `---\nname: lifecycle\nmodel: openai-codex/gpt-6.1-sol\nthinking: medium\nauto-exit: ${autoExit}\ntools: bash,read\n---\nUse only the exact synthetic parent task. Do not inspect user files.\n`,
  );
  const herdr = (args: string[]) =>
    execFileSync("herdr", ["--session", session!, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  const json = (args: string[]) => JSON.parse(herdr(args)).result;
  const before = json(["workspace", "list"]).workspaces;
  const created = json([
    "workspace",
    "create",
    "--label",
    `pi-herdr-lifecycle-${label}`,
    "--cwd",
    project,
    "--no-focus",
    "--env",
    `PI_CODING_AGENT_DIR=${config}`,
    "--env",
    `PI_CODING_AGENT_SESSION_DIR=${sessions}`,
    "--env",
    "PI_SUBAGENT_MUX=herdr",
    "--env",
    "PI_TELEMETRY=0",
    "--env",
    "PI_OFFLINE=1",
  ]);
  const workspace = created.workspace.workspace_id,
    parent = created.root_pane.pane_id;
  assert.equal(created.workspace.focused, false);
  const parentSession = join(sessions, "parent.jsonl");
  writeFileSync(
    join(dir, "ownership.json"),
    JSON.stringify({ session, workspace, parent, terminal: created.root_pane.terminal_id, dir }),
  );
  writeFileSync(join(dir, "task.md"), task(dir));
  const launch = join(dir, "launch.sh");
  writeFileSync(
    launch,
    [
      `#!/bin/bash`,
      `export PI_CODING_AGENT_DIR=${shellEscape(config)} PI_CODING_AGENT_SESSION_DIR=${shellEscape(sessions)} HERDR_SESSION=${shellEscape(session!)}`,
      `export PI_SUBAGENT_MUX=herdr PI_TELEMETRY=0 PI_OFFLINE=1 PI_SUBAGENT_SHELL_READY_DELAY_MS=750`,
      `cd ${shellEscape(project)}`,
      `pi -ne -ns -np -nc --no-mcp -a -e ${shellEscape(join(root, "pi-extension/subagents/index.ts"))} --session ${shellEscape(parentSession)} --model openai-codex/gpt-6.1-sol --thinking medium @${shellEscape(join(dir, "task.md"))}`,
    ].join("\n"),
  );
  console.log(`Private lifecycle evidence: ${dir}`);
  herdr(["pane", "run", parent, `bash ${shellEscape(launch)}`]);
  const panes = () => json(["pane", "list", "--workspace", workspace]).panes;
  const prompt = (pane: string, text: string) => herdr(["agent", "prompt", pane, text]);
  const verify = () => {
    const launches = messages(parentSession).filter(
      (m) => m.role === "toolResult" && ["subagent", "subagent_resume"].includes(m.toolName),
    );
    assert.ok(launches.length > 0);
    for (const launch of launches) {
      const script = launch.details?.launchScriptFile;
      assert.ok(
        script && existsSync(script),
        "launch script returned by public tool remains inspectable",
      );
      const bytes = readFileSync(script, "utf8");
      assert.ok(bytes.startsWith("#!/bin/bash"), "long launch uses supported bash script");
      assert.ok(bytes.length > 300, "script preserves command exceeding terminal line width");
    }
    const after = json(["workspace", "list"]).workspaces;
    assert.deepEqual(
      after.filter((w: any) => w.focused).map((w: any) => w.workspace_id),
      before.filter((w: any) => w.focused).map((w: any) => w.workspace_id),
    );
    assert.ok(before.every((w: any) => after.some((a: any) => a.workspace_id === w.workspace_id)));
    assert.equal(
      createHash("sha256").update(readFileSync(authPath!)).digest("hex"),
      createHash("sha256").update(original).digest("hex"),
      "auth unchanged",
    );
    writeFileSync(
      join(dir, "parent-screen.txt"),
      herdr(["pane", "read", parent, "--source", "recent-unwrapped", "--lines", "160"]),
    );
  };
  return { dir, parentSession, panes, prompt, parent, verify };
}
const options = { skip: !session || !authPath, timeout: 300_000 };

test(
  "caller_ping help and both resume modes preserve the same native conversation",
  options,
  async () => {
    const h = setup(
      "help-resume",
      false,
      () =>
        `Call subagent name HelpProof agent lifecycle task "First say HELP_PARTIAL_38, then call caller_ping message NEED_GUIDANCE_38." End your turn. When a help notification arrives, call subagent_resume with its exact session path, name GuidedProof, autoExit false, message "Remember HELP_PARTIAL_38. Say GUIDED_RESULT_38 with that remembered token, and wait for user input." After that result arrives, call subagent_resume using that SAME original session path, name FinalProof, autoExit true, message "Return FINAL_RESUME_38 and include the earlier GUIDED_RESULT_38 token. Do not call subagent_done." After final delivery reply FINAL_PARENT_38. Do not use polling tools or inspect user files.`,
    );
    const guided = await waitFor(() => {
      const calls = messages(h.parentSession)
        .flatMap((m) => m.content ?? [])
        .filter((c) => c.type === "toolCall" && c.name === "subagent_resume");
      const path = calls[0]?.arguments.sessionPath;
      if (
        !path ||
        !messages(path).some(
          (m) =>
            m.role === "assistant" &&
            m.stopReason === "stop" &&
            JSON.stringify(m.content).includes("GUIDED_RESULT_38"),
        )
      )
        return;
      return h.panes().find((p: any) => p.label === "GuidedProof");
    }, "interactive resume accepts parent guidance");
    assert.equal(
      results(h.parentSession).length,
      0,
      "autoExit false preserves interactive pane after normal turn",
    );
    h.prompt(
      guided.pane_id,
      "The previous instruction to wait for user input is complete. For this turn you MUST invoke the available subagent_done tool exactly once, after your GUIDED_RESULT_38 summary. A text response alone does not complete this task.",
    );
    await waitFor(() => results(h.parentSession).length >= 2, "two resumed completions");
    const all = entries(h.parentSession);
    assert.ok(JSON.stringify(all).includes("NEED_GUIDANCE_38"), "help notification delivered");
    const calls = messages(h.parentSession)
      .flatMap((m) => m.content ?? [])
      .filter((c) => c.type === "toolCall" && c.name === "subagent_resume");
    assert.equal(calls.length, 2);
    assert.equal(calls[0].arguments.autoExit, false);
    assert.equal(calls[1].arguments.autoExit, true);
    assert.equal(calls[0].arguments.sessionPath, calls[1].arguments.sessionPath);
    const native = messages(calls[0].arguments.sessionPath);
    assert.ok(JSON.stringify(native).includes("GUIDED_RESULT_38"));
    assert.ok(JSON.stringify(native).includes("FINAL_RESUME_38"));
    const tools = native
      .flatMap((m) => m.content ?? [])
      .filter((c) => c.type === "toolCall")
      .map((c) => c.name);
    assert.ok(tools.includes("caller_ping"));
    assert.ok(tools.includes("subagent_done"));
    await waitFor(() => h.panes().length === 1, "all completed children close");
    h.verify();
  },
);

test(
  "public interruption aborts a native turn and leaves the same pane available for input",
  options,
  async () => {
    const h = setup(
      "interrupt",
      true,
      (dir) =>
        `Call subagent name InterruptProof agent lifecycle task ${JSON.stringify(`Use bash to run exactly: printf STARTED_38 > ${shellEscape(join(dir, "started"))}; sleep 120; printf UNEXPECTED_38 > ${shellEscape(join(dir, "finished"))}. Then return ORIGINAL_RESULT_38.`)}. End your turn immediately. When asked to interrupt, use subagent_interrupt name InterruptProof and end your turn. On independent completion reply PARENT_COMPLETION_38. Do not inspect user files.`,
    );
    await waitFor(() => existsSync(join(h.dir, "started")), "child active bash");
    const child = h.panes().find((p: any) => p.pane_id !== h.parent);
    assert.ok(child);
    h.prompt(
      h.parent,
      "Now call subagent_interrupt name InterruptProof exactly once. Then end your turn.",
    );
    await waitFor(
      () =>
        messages(h.parentSession).some(
          (m) =>
            m.role === "toolResult" &&
            m.toolName === "subagent_interrupt" &&
            m.details?.status === "interrupt_requested",
        ),
      "public interruption acknowledgement",
    );
    await pause(2500);
    assert.ok(
      h
        .panes()
        .some((p: any) => p.pane_id === child.pane_id && p.terminal_id === child.terminal_id),
      "interruption preserves native pane",
    );
    assert.equal(results(h.parentSession).length, 0, "interruption alone is not completion");
    assert.equal(existsSync(join(h.dir, "finished")), false, "active bash was aborted");
    h.prompt(
      child.pane_id,
      "Synthetic follow-up input: reply FOLLOWUP_RESULT_38 exactly. Do not call tools.",
    );
    const launch = messages(h.parentSession).find(
      (m) => m.role === "toolResult" && m.toolName === "subagent",
    );
    assert.ok(launch?.details?.sessionFile, "public launch returns its native session path");
    const childSession = launch.details.sessionFile;
    await waitFor(
      () =>
        messages(childSession).some(
          (m) =>
            m.role === "assistant" &&
            m.stopReason === "stop" &&
            JSON.stringify(m.content).includes("FOLLOWUP_RESULT_38"),
        ),
      "human follow-up finishes its native turn",
    );
    await pause(2500);
    assert.equal(
      results(h.parentSession).length,
      0,
      "human takeover disables autonomous completion",
    );
    assert.ok(
      h
        .panes()
        .some((p: any) => p.pane_id === child.pane_id && p.terminal_id === child.terminal_id),
      "same pane remains available after human input",
    );
    h.prompt(child.pane_id, "Reply SECOND_HUMAN_TURN_38 exactly. Do not call tools.");
    await waitFor(
      () =>
        messages(childSession).some(
          (m) =>
            m.role === "assistant" &&
            m.stopReason === "stop" &&
            JSON.stringify(m.content).includes("SECOND_HUMAN_TURN_38"),
        ),
      "second human turn completes in the same conversation",
    );
    await pause(2500);
    assert.equal(results(h.parentSession).length, 0, "takeover remains active across turns");
    assert.ok(
      h.panes().some((p: any) => p.pane_id === child.pane_id),
      "second human turn preserves the pane",
    );
    h.prompt(
      child.pane_id,
      "The previous instructions to avoid tools applied only to those previous turns. For this turn you MUST invoke the available subagent_done tool exactly once, after a summary including FOLLOWUP_RESULT_38 and SECOND_HUMAN_TURN_38. A text response alone does not complete this task.",
    );
    await waitFor(
      () => results(h.parentSession).length === 1,
      "explicit completion after takeover",
    );
    const result = results(h.parentSession)[0];
    const native = messages(result.details.sessionFile);
    assert.ok(
      native.some(
        (m) =>
          m.role === "assistant" &&
          (m.stopReason === "aborted" ||
            (m.stopReason === "error" && m.errorMessage === "This operation was aborted")),
      ),
      "native turn records abort",
    );
    assert.ok(JSON.stringify(native).includes("FOLLOWUP_RESULT_38"));
    await waitFor(() => h.panes().length === 1, "completed follow-up closes child");
    h.verify();
  },
);

test(
  "native provider-boundary failure is reported as failure and closes owned child",
  options,
  async () => {
    const h = setup(
      "error",
      true,
      () =>
        `Call subagent name FailureProof agent lifecycle task "Return NEVER_SUCCESS_38." End your turn. On failure notification reply ERROR_PARENT_38. Do not inspect user files.`,
    );
    await waitFor(() => results(h.parentSession).length === 1, "failure delivery");
    const result = results(h.parentSession)[0];
    assert.ok(
      JSON.stringify(result).includes("SYNTHETIC_PROVIDER_FAILURE_38"),
      "actual native failure propagated",
    );
    const native = messages(result.details.sessionFile);
    assert.ok(native.some((m) => m.role === "assistant" && m.stopReason === "error"));
    await waitFor(() => h.panes().length === 1, "failed owned child closes");
    h.verify();
  },
);
