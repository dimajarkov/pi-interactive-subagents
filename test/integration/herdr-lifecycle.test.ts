import { HerdrParent } from "../../pi-extension/subagents/herdr-parent.ts";
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
  readdirSync,
  symlinkSync,
  writeFileSync,
  watch,
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
    const value = await check();
    if (value) return value;
    await pause(500);
  }
  assert.fail(`Timeout: ${label}`);
}
function setup(
  label: string,
  autoExit: boolean,
  task: (dir: string) => string,
  configure?: (paths: { dir: string; config: string; project: string }) => void,
) {
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
      extensions: [failureExtension, join(root, "pi-extension/subagents/index.ts")],
      skills: [],
      shellPath: "/bin/bash",
      quietStartup: true,
    }),
  );
  writeFileSync(
    join(project, ".pi", "agents", "lifecycle.md"),
    `---\nname: lifecycle\nmodel: openai-codex/gpt-6.1-sol\nthinking: medium\nauto-exit: ${autoExit}\ntools: bash,read\n---\nUse only the exact synthetic parent task. Do not inspect user files.\n`,
  );
  configure?.({ dir, config, project });
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
  return {
    dir,
    config,
    project,
    parentSession,
    panes,
    prompt,
    parent,
    verify,
    herdr,
    json,
    workspace,
  };
}
const options = { skip: !session || !authPath, timeout: 300_000 };
const explicitCompletion58 = (summary: string) =>
  `In ONE assistant response emit the exact summary text ${summary} immediately followed by an actual subagent_done tool call with {} exactly once. Do not end the turn between the summary and tool call. Do not merely promise to call the tool later. A text-only final response does not complete this synthetic task. This completion protocol applies only after the assigned work succeeds and every owned descendant outcome has actually arrived and been reconciled.`;

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
      `The previous waiting instruction is complete. ${explicitCompletion58("GUIDED_RESULT_38")}`,
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
            m.details?.status === "interrupted_verified",
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
      `The previous no-tool instructions applied only to those earlier turns. ${explicitCompletion58("FOLLOWUP_RESULT_38 SECOND_HUMAN_TURN_38")}`,
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

test(
  "private recovery restores custom role policy and native history with fresh managed ownership",
  options,
  async () => {
    const h = setup(
      "recovery-policy",
      false,
      () =>
        `Call subagent exactly once with name Original58, agent recovery58, task "First say ORIGINAL_NATIVE_HISTORY_58, then call caller_ping with message READY_FOR_POLICY_RESUME_58." End your turn after launch. When the help arrives reply READY_FOR_GUIDANCE_58 and wait for explicit guidance. Do not resume or launch anything else until asked. Do not poll or inspect user files.`,
      ({ dir, config, project }) => {
        writeFileSync(
          join(project, ".pi", "agents", "recovery58.md"),
          `---\nname: recovery58\nmodel: openai-codex/gpt-6.1-sol\nthinking: medium\nauto-exit: false\nspawning: true\ntools: read,bash,subagent,subagent_interrupt,subagents_list,subagent_resume\nsystem-prompt: append\n---\nORIGINAL_POLICY_58: follow only the exact synthetic task and original parent guidance.\n`,
        );
        const observer = join(dir, "policy-observer.ts");
        writeFileSync(
          observer,
          `import {existsSync,readFileSync,writeFileSync} from "node:fs"; export default function(pi) { pi.on("session_start", (e,ctx) => { if (process.env.PI_SUBAGENT_AGENT !== "recovery58") return; const p=${JSON.stringify(join(dir, "starts-"))}+process.env.PI_SUBAGENT_ID+".json"; const old=existsSync(p)?JSON.parse(readFileSync(p,"utf8")):[]; old.push({reason:e.reason,id:ctx.sessionManager.getSessionId()}); writeFileSync(p,JSON.stringify(old),{mode:0o600}); }); pi.on("before_agent_start", (_e,ctx) => { if (process.env.PI_SUBAGENT_AGENT !== "recovery58") return; writeFileSync(${JSON.stringify(join(dir, "policy-"))} + process.env.PI_SUBAGENT_ID + ".json", JSON.stringify({ id:process.env.PI_SUBAGENT_ID, nativeId:ctx.sessionManager.getSessionId(), file:ctx.sessionManager.getSessionFile(), cwd:ctx.cwd, role:process.env.PI_SUBAGENT_AGENT, config:process.env.PI_CODING_AGENT_DIR, autoExit:process.env.PI_SUBAGENT_AUTO_EXIT, activity:process.env.PI_SUBAGENT_ACTIVITY_FILE, exitFile:process.env.PI_SUBAGENT_EXIT_FILE, denied:process.env.PI_DENY_TOOLS, tools:pi.getActiveTools() }), {mode:0o600}); }); }`,
        );
        const settingsPath = join(config, "settings.json");
        const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
        settings.extensions.push(observer);
        writeFileSync(settingsPath, JSON.stringify(settings));
      },
    );
    await waitFor(
      () =>
        entries(h.parentSession).some(
          (e) =>
            e.customType === "subagent_ping" &&
            JSON.stringify(e).includes("READY_FOR_POLICY_RESUME_58"),
        ),
      "original native help result",
    );
    const original = messages(h.parentSession).find(
      (m) => m.role === "toolResult" && m.toolName === "subagent",
    );
    const childFile = original.details.sessionFile;
    await waitFor(() => h.panes().length === 1, "original managed child exact cleanup");
    const originalBytes = readFileSync(childFile, "utf8");
    assert.match(originalBytes, /ORIGINAL_NATIVE_HISTORY_58/);
    const firstProbe = JSON.parse(
      readFileSync(join(h.dir, "policy-" + original.details.id + ".json"), "utf8"),
    );
    assert.ok(firstProbe.tools.includes("bash"));
    assert.ok(firstProbe.tools.includes("subagent"));
    writeFileSync(
      join(h.project, ".pi", "agents", "recovery58.md"),
      `---\nname: recovery58\nauto-exit: true\nspawning: false\ntools: write\ndeny-tools: bash\nsystem-prompt: replace\n---\nCHANGED_POLICY_MUST_NOT_REPLACE_ORIGINAL_58\n`,
    );
    h.prompt(
      h.parent,
      `Call subagent_resume exactly once with sessionPath ${JSON.stringify(childFile)}, name Restored58, autoExit false, message "Recall ORIGINAL_NATIVE_HISTORY_58 from this native conversation. Reply RESTORED_NATIVE_HISTORY_58 with that original token. Do not call tools, do not spawn children, and wait for human input after your response." End your turn and wait. Do not inspect files or poll.`,
    );
    const resumed = await waitFor(
      () =>
        messages(h.parentSession).find(
          (m) => m.role === "toolResult" && m.toolName === "subagent_resume",
        ),
      "public resume acknowledgement",
    );
    await waitFor(
      () =>
        messages(childFile).some(
          (m) =>
            m.role === "assistant" &&
            m.stopReason === "stop" &&
            JSON.stringify(m.content).includes("RESTORED_NATIVE_HISTORY_58"),
        ),
      "restored native response",
    );
    const secondProbe = JSON.parse(
      readFileSync(join(h.dir, "policy-" + resumed.details.id + ".json"), "utf8"),
    );
    assert.equal(
      secondProbe.nativeId,
      firstProbe.nativeId,
      "native conversation identity persists",
    );
    assert.equal(secondProbe.role, "recovery58");
    assert.equal(secondProbe.config, firstProbe.config);
    assert.equal(secondProbe.cwd, firstProbe.cwd);
    assert.equal(secondProbe.autoExit, undefined);
    assert.ok(secondProbe.tools.includes("read"));
    assert.ok(!secondProbe.tools.includes("write"), "changed allowlist cannot widen original role");
    assert.ok(!secondProbe.tools.includes("bash"), "new explicit denial narrows original role");
    assert.ok(!secondProbe.tools.includes("subagent"), "new spawning false remains authoritative");
    assert.ok(secondProbe.tools.includes("subagent_done"));
    assert.notEqual(secondProbe.id, firstProbe.id);
    assert.notEqual(secondProbe.activity, firstProbe.activity);
    assert.notEqual(secondProbe.exitFile, firstProbe.exitFile);
    assert.ok(
      readFileSync(childFile, "utf8").startsWith(originalBytes),
      "original native history prefix is untouched",
    );
    const records = readdirSync(h.parentSession + ".delegations").map((file) =>
      JSON.parse(readFileSync(join(h.parentSession + ".delegations", file), "utf8")),
    );
    const originalJob = records.find(
      (r) => r.child?.sessionFile === childFile && r.state === "settled",
    )?.child.job;
    const resumedJob = records.find(
      (r) => r.child?.sessionFile === childFile && r.state === "running",
    )?.child.job;
    assert.ok(originalJob && resumedJob);
    assert.notEqual(resumedJob.job_id, originalJob.job_id);
    assert.notEqual(resumedJob.terminal.terminal_id, originalJob.terminal.terminal_id);
    const pane = h.panes().find((p: any) => p.label === "Restored58");
    assert.equal(pane.pane_id, resumedJob.terminal.pane_id);
    writeFileSync(
      join(h.dir, "resumed-layout.json"),
      JSON.stringify(h.json(["pane", "layout", "--pane", h.parent]), null, 2),
    );
    assert.equal(
      results(h.parentSession).length,
      0,
      "autoExit false retains the resumed native pane",
    );
    const statusOutput = JSON.parse(h.herdr(["status", "server", "--json"]));
    const server = statusOutput.server ?? statusOutput;
    assert.equal(server.session, session);
    const managed = new HerdrParent(server.socket, h.parent);
    const beforeReload = await waitFor(async () => {
      const current = await managed.get(resumedJob);
      return current.agent && !current.busy ? current : undefined;
    }, "resumed native controller is idle before reload");
    // Synthetic terminal input exercises the actual native /reload command, not physical keys.
    h.herdr(["pane", "run", pane.pane_id, "/reload"]);
    await waitFor(() => {
      const starts = JSON.parse(
        readFileSync(join(h.dir, "starts-" + resumed.details.id + ".json"), "utf8"),
      );
      return starts.length >= 2 && starts.at(-1).reason === "reload";
    }, "native same-session extension reload");
    await pause(500);
    const operation = await managed.prompt(
      resumedJob,
      "Reply AFTER_RELOAD_NATIVE_HISTORY_58 and include ORIGINAL_NATIVE_HISTORY_58. Do not call tools; wait for explicit completion guidance.",
    );
    await waitFor(
      () =>
        messages(childFile).some(
          (m) =>
            m.role === "assistant" &&
            m.stopReason === "stop" &&
            JSON.stringify(m.content).includes("AFTER_RELOAD_NATIVE_HISTORY_58"),
        ),
      "fresh managed control after native reload",
    );
    const settlement = await waitFor(async () => {
      const result = await managed.request("agent.control.status", {
        condition: beforeReload.agent,
        request_id: operation.request_id,
      });
      if (["rejected", "outcome_unknown"].includes(result.phase))
        assert.fail(`Reload control did not settle: ${JSON.stringify(result)}`);
      return result.phase === "settled" ? result : undefined;
    }, "fresh native control request settles through original enrolled condition");
    const verifiedAfterReload = await managed.get(resumedJob);
    assert.deepEqual(
      verifiedAfterReload.agent,
      beforeReload.agent,
      "same enrolled AgentCondition survives native reload without credential replay",
    );
    writeFileSync(
      join(h.dir, "reload-control.json"),
      JSON.stringify(
        { before: beforeReload, operation, settlement, after: verifiedAfterReload },
        null,
        2,
      ),
      { mode: 0o600 },
    );
    const afterReload = JSON.parse(
      readFileSync(join(h.dir, "policy-" + resumed.details.id + ".json"), "utf8"),
    );
    assert.equal(afterReload.nativeId, secondProbe.nativeId);
    assert.deepEqual(
      [...afterReload.tools].sort(),
      [...secondProbe.tools].sort(),
      "reload preserves restored effective restrictions",
    );
    h.prompt(
      pane.pane_id,
      `The waiting period is complete. ${explicitCompletion58("RESTORED_NATIVE_HISTORY_58 ORIGINAL_NATIVE_HISTORY_58")}`,
    );
    await waitFor(
      () => results(h.parentSession).length === 1,
      "one immediate-parent resumed outcome",
    );
    assert.equal(results(h.parentSession)[0].details.exitCode, 0);
    await waitFor(() => h.panes().length === 1, "resumed exact managed cleanup");
    h.verify();
  },
);

test(
  "nested orchestrator loss reports unresolved ownership and retains its leaf without disturbing another branch",
  { ...options, timeout: 480_000 },
  async () => {
    const h = setup(
      "nested-loss",
      false,
      (dir) => {
        const leafTask = `Run only this synthetic task. Run exactly ${shellEscape(process.execPath)} ${shellEscape(join(dir, "loss-barrier.cjs"))} ${shellEscape(dir)} Leaf58 using bash with timeout 360 seconds. After successful release: ${explicitCompletion58("LEAF_SETTLED_58")} Do not inspect user files.`;
        const aTask = `Call subagent exactly once with name Leaf58, agent loss-leaf58, task ${JSON.stringify(leafTask)}. After launch say WAITING_STALE_A_58 and end your turn normally. Do not poll or inspect files. Do not call completion tools while owned work remains outstanding. Only after its actual asynchronous result arrives, reconcile it. ${explicitCompletion58("RECONCILED_A_58")}`;
        const bTask = `Run only this synthetic task. Run exactly ${shellEscape(process.execPath)} ${shellEscape(join(dir, "loss-barrier.cjs"))} ${shellEscape(dir)} B58 using bash with timeout 360 seconds. After successful release: ${explicitCompletion58("B_UNAFFECTED_RESULT_58")}`;
        return `Synthetic isolated ownership failure proof. Launch A58 using agent loss-parent58 with task ${JSON.stringify(aTask)}, then launch B58 using agent loss-b58 with task ${JSON.stringify(bTask)}, before waiting. End your turn normally and receive asynchronous outcomes. Do not poll, inspect sessions, interrupt, resume, relaunch, close panes or call completion tools. If A fails honestly acknowledge its unresolved failure; never call WAITING_STALE_A_58 a successful outcome. B must continue independently.`;
      },
      ({ dir, config, project }) => {
        for (const [name, spawning] of [
          ["loss-parent58", true],
          ["loss-leaf58", true],
          ["loss-b58", false],
        ] as const) {
          writeFileSync(
            join(project, ".pi", "agents", `${name}.md`),
            `---\nname: ${name}\nmodel: openai-codex/gpt-6.1-sol\nthinking: medium\nauto-exit: false\nspawning: ${spawning}\ntools: bash,read,subagent,subagent_interrupt,subagents_list,subagent_resume\n---\nPerform only the exact synthetic task. Remain interactive until task completion; never abandon owned descendants. Once the synthetic task and every owned result are settled, the requested summary text and actual subagent_done tool call MUST be in the SAME assistant response. A text-only response or a promise to call the tool later is incomplete.\n`,
          );
        }
        writeFileSync(
          join(dir, "loss-barrier.cjs"),
          `const {watch,existsSync,writeFileSync}=require("node:fs"); const [dir,name]=process.argv.slice(2); const timer=setTimeout(()=>{w.close();process.exit(1)},350000); const check=()=>{if(existsSync(dir+"/"+name+".release")){clearTimeout(timer);w.close();process.stdout.write("RELEASED_"+name+"\\n")}}; const w=watch(dir,check); writeFileSync(dir+"/"+name+".ready","ready\\n"); check();`,
        );
        // Public pane process-info has PID/argv but no birth token. Bind native
        // startup to the OS birth identity, then read it again before injection.
        writeFileSync(
          join(dir, "process-birth.py"),
          `import ctypes,json,os,sys\npid=int(sys.argv[1])\nif sys.platform == "darwin":\n b=ctypes.create_string_buffer(136)\n lib=ctypes.CDLL("/usr/lib/libproc.dylib")\n n=lib.proc_pidinfo(pid,3,0,b,136)\n if n != 136 or int.from_bytes(b.raw[12:16],sys.byteorder) != pid: raise RuntimeError("Cannot verify original process birth")\n birth=[int.from_bytes(b.raw[120:128],sys.byteorder),int.from_bytes(b.raw[128:136],sys.byteorder)]\nelif sys.platform.startswith("linux"):\n text=open("/proc/"+str(pid)+"/stat").read(); birth=[open("/proc/sys/kernel/random/boot_id").read().strip(),text[text.rfind(")")+2:].split()[19]]\nelse: raise RuntimeError("No verified process birth reader on this platform")\nprint(json.dumps({"pid":pid,"birth":birth}))\n`,
        );
        const observer = join(dir, "loss-observer.ts");
        writeFileSync(
          observer,
          `import {writeFileSync} from "node:fs"; import {execFileSync} from "node:child_process"; export default function(pi) { pi.on("session_start",(_e,ctx)=>{if(!process.env.PI_SUBAGENT_AGENT?.startsWith("loss-"))return; const file=ctx.sessionManager.getSessionFile(); writeFileSync(file+".identity.json",JSON.stringify({pid:process.pid,argv:[...process.argv],nativeId:ctx.sessionManager.getSessionId(),file,role:process.env.PI_SUBAGENT_AGENT,birth:JSON.parse(execFileSync("python3",[${JSON.stringify(join(dir, "process-birth.py"))},String(process.pid)],{encoding:"utf8"})).birth}),{mode:0o600});});}`,
        );
        const settingsPath = join(config, "settings.json");
        const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
        settings.extensions.push(observer);
        writeFileSync(settingsPath, JSON.stringify(settings));
      },
    );
    const safeEntries = (path: string): any[] => {
      if (!existsSync(path)) return [];
      return readFileSync(path, "utf8")
        .split("\n")
        .filter(Boolean)
        .flatMap((line) => {
          try {
            return [JSON.parse(line)];
          } catch {
            return [];
          }
        });
    };
    const eventReceipt = (label: string, ready: () => boolean, timeout = 180_000) =>
      new Promise<void>((resolve, reject) => {
        const watcher = watch(h.dir, { recursive: true }, check);
        const timer = setTimeout(() => {
          watcher.close();
          reject(new Error(`Timeout: ${label}; retain ${h.dir}/ownership.json`));
        }, timeout);
        function check() {
          try {
            if (!ready()) return;
            clearTimeout(timer);
            watcher.close();
            resolve();
          } catch (error) {
            clearTimeout(timer);
            watcher.close();
            reject(error);
          }
        }
        check();
      });
    const launches = (path: string) =>
      safeEntries(path)
        .filter(
          (e) =>
            e.type === "message" &&
            e.message.role === "toolResult" &&
            e.message.toolName === "subagent" &&
            !e.message.isError,
        )
        .map((e) => e.message);
    const outcomes = () =>
      safeEntries(h.parentSession).filter((e) => e.customType === "subagent_result");
    const journal = (path: string) =>
      existsSync(path + ".delegations")
        ? readdirSync(path + ".delegations")
            .filter((f) => f.endsWith(".json"))
            .map((f) => JSON.parse(readFileSync(join(path + ".delegations", f), "utf8")))
        : [];
    const evidence: any = {
      owner: "root",
      retained: [],
      nestedTurnInterruption: "unproven; separate acceptance required",
    };
    try {
      await eventReceipt(
        "nested leaf and independent B workloads",
        () => existsSync(join(h.dir, "Leaf58.ready")) && existsSync(join(h.dir, "B58.ready")),
      );
      const a = launches(h.parentSession).find((m) => m.details.name === "A58");
      const b = launches(h.parentSession).find((m) => m.details.name === "B58");
      assert.ok(a && b);
      const leaf = launches(a.details.sessionFile).find((m) => m.details.name === "Leaf58");
      assert.ok(leaf);
      await eventReceipt("A's normal waiting boundary", () =>
        safeEntries(a.details.sessionFile).some(
          (e) =>
            e.type === "message" &&
            e.message.role === "assistant" &&
            e.message.stopReason === "stop" &&
            JSON.stringify(e.message.content).includes("WAITING_STALE_A_58"),
        ),
      );
      const aRecord = journal(h.parentSession).find(
        (r) => r.child?.sessionFile === a.details.sessionFile,
      );
      const bRecord = journal(h.parentSession).find(
        (r) => r.child?.sessionFile === b.details.sessionFile,
      );
      const leafRecord = journal(a.details.sessionFile).find(
        (r) => r.child?.sessionFile === leaf.details.sessionFile,
      );
      assert.ok(aRecord?.child?.job && bRecord?.child?.job && leafRecord?.child?.job);
      const statusOutput = JSON.parse(h.herdr(["status", "server", "--json"]));
      const server = statusOutput.server ?? statusOutput;
      assert.equal(server.session, session);
      const managed = new HerdrParent(server.socket, h.parent);
      const original = JSON.parse(readFileSync(a.details.sessionFile + ".identity.json", "utf8"));
      const aHeader = safeEntries(a.details.sessionFile)[0];
      assert.equal(original.file, a.details.sessionFile);
      assert.equal(original.nativeId, aHeader.id);
      assert.equal(original.role, "loss-parent58");
      const sessionArg = original.argv.indexOf("--session");
      assert.ok(sessionArg >= 0);
      assert.equal(
        original.argv[sessionArg + 1],
        a.details.sessionFile,
        "native startup argv binds the original session argument",
      );
      assert.ok(Number.isInteger(original.pid) && original.pid > 1 && original.pid !== process.pid);
      const aPane = aRecord.child.job.terminal.pane_id;
      const aCurrent = await waitFor(
        async () => {
          const current = await managed.get(aRecord.child.job);
          return current.phase === "owned" && current.agent && !current.busy ? current : undefined;
        },
        "original A58 native waiting boundary becomes idle",
        15_000,
      );
      assert.equal(aCurrent.phase, "owned");
      assert.ok(
        aCurrent.agent && !aCurrent.busy,
        "kill only the original idle native orchestrator",
      );
      const processInfo = h.json(["pane", "process-info", "--pane", aPane]).process_info;
      assert.equal(processInfo.pane_id, aPane);
      const foreground = processInfo.foreground_processes.find((p: any) => p.pid === original.pid);
      assert.ok(foreground, "exact observed native PID is in the owned pane foreground");
      // Pi mutates process.title, so macOS can omit current argv/cmdline.
      // Startup argv binds the native session; current PID/name/cwd and OS
      // birth bind that same process without inventing unavailable argv.
      assert.equal(foreground.name, "node");
      assert.equal(foreground.argv0, "pi");
      assert.equal(realpathSync(foreground.cwd), realpathSync(h.project));
      const birth = JSON.parse(
        execFileSync("python3", [join(h.dir, "process-birth.py"), String(original.pid)], {
          encoding: "utf8",
        }),
      );
      assert.deepEqual(
        birth.birth,
        original.birth,
        "process birth still matches native startup receipt",
      );
      evidence.before = {
        a,
        b,
        leaf,
        aRecord,
        bRecord,
        leafRecord,
        original,
        aCurrent,
        processInfo,
        birth,
      };
      writeFileSync(join(h.dir, "nested-loss-evidence.json"), JSON.stringify(evidence, null, 2), {
        mode: 0o600,
      });
      // Revalidate after writing the private receipt, immediately before injection.
      const finalJob = await managed.get(aRecord.child.job);
      assert.deepEqual(finalJob.condition, aRecord.child.job);
      assert.equal(finalJob.phase, "owned");
      assert.ok(finalJob.agent && !finalJob.busy);
      const finalInfo = h.json(["pane", "process-info", "--pane", aPane]).process_info;
      assert.ok(
        finalInfo.foreground_processes.some(
          (p: any) =>
            p.pid === original.pid &&
            p.name === "node" &&
            p.argv0 === "pi" &&
            realpathSync(p.cwd) === realpathSync(h.project),
        ),
      );
      const finalBirth = JSON.parse(
        execFileSync("python3", [join(h.dir, "process-birth.py"), String(original.pid)], {
          encoding: "utf8",
        }),
      );
      assert.deepEqual(finalBirth.birth, original.birth);
      // Never kill a process group, shell, wrapper, guessed PID or descendant.
      process.kill(original.pid, "SIGKILL");
      await eventReceipt("honest immediate-parent unresolved failure", () =>
        outcomes().some((r) => r.details.name === "A58"),
      );
      const failure = outcomes().find((r) => r.details.name === "A58");
      assert.equal(failure.details.exitCode, 1);
      assert.match(failure.content, /ownership is unresolved/);
      assert.match(failure.content, /original native sessions and surfaces are retained/);
      assert.ok(
        !failure.content.includes("RECONCILED_A_58"),
        "waiting text cannot become fabricated reconciled success",
      );
      assert.equal(outcomes().filter((r) => r.details.name === "B58").length, 0);
      assert.equal(outcomes().filter((r) => r.details.name === "Leaf58").length, 0);
      const leafAfterLoss = await managed.get(leafRecord.child.job);
      const bAfterLoss = await managed.get(bRecord.child.job);
      assert.equal(leafAfterLoss.phase, "owned");
      assert.ok(
        leafAfterLoss.agent && leafAfterLoss.busy,
        "A loss preserves active leaf native execution",
      );
      assert.equal(bAfterLoss.phase, "owned");
      assert.ok(bAfterLoss.agent && bAfterLoss.busy, "independent branch remains active");
      assert.deepEqual(leafAfterLoss.condition, leafRecord.child.job);
      assert.deepEqual(bAfterLoss.condition, bRecord.child.job);
      assert.ok(existsSync(leaf.details.sessionFile) && existsSync(a.details.sessionFile));
      assert.ok(
        journal(a.details.sessionFile).some(
          (r) => r.state === "running" && r.child?.sessionFile === leaf.details.sessionFile,
        ),
        "unresolved descendant ownership remains durable",
      );
      evidence.afterLoss = {
        failure,
        leafAfterLoss,
        bAfterLoss,
        aJournal: journal(a.details.sessionFile),
        rootJournal: journal(h.parentSession),
        layout: h.json(["pane", "layout", "--pane", h.parent]),
      };
      writeFileSync(join(h.dir, "Leaf58.release"), "release\n");
      writeFileSync(join(h.dir, "B58.release"), "release\n");
      await eventReceipt("independent B completion", () =>
        outcomes().some((r) => r.details.name === "B58"),
      );
      assert.equal(outcomes().find((r) => r.details.name === "B58").details.exitCode, 0);
      assert.match(
        outcomes().find((r) => r.details.name === "B58").content,
        /B_UNAFFECTED_RESULT_58/,
      );
      await eventReceipt("orphan leaf explicitly finishes its original native task", () =>
        safeEntries(leaf.details.sessionFile).some(
          (e) =>
            e.type === "message" &&
            Array.isArray(e.message.content) &&
            e.message.content.some((c: any) => c.type === "toolCall" && c.name === "subagent_done"),
        ),
      );
      for (const [name, job] of [
        ["A58", aRecord.child.job],
        ["Leaf58", leafRecord.child.job],
      ] as const) {
        try {
          const current = await managed.get(job);
          evidence[name] = current;
          if (current.phase !== "exited") {
            const info = h.json([
              "pane",
              "process-info",
              "--pane",
              job.terminal.pane_id,
            ]).process_info;
            const shellOnly = info.foreground_processes.every((p: any) => p.pid === info.shell_pid);
            if (current.busy || !shellOnly)
              throw new Error("Original owned job is not proven quiet");
          }
          await managed.close(job);
          evidence[name + "Cleanup"] = "exact managed close accepted";
        } catch (error) {
          evidence.retained.push({ name, job, owner: "root", blocker: String(error) });
        }
      }
      assert.equal(outcomes().filter((r) => r.details.name === "A58").length, 1);
      assert.equal(
        outcomes().filter((r) => r.details.name === "Leaf58").length,
        0,
        "orphan leaf is never misrouted to root",
      );
      evidence.final = {
        rootJournal: journal(h.parentSession),
        aJournal: journal(a.details.sessionFile),
        panes: h.panes(),
        nativeHistoryRetained: [
          a.details.sessionFile,
          b.details.sessionFile,
          leaf.details.sessionFile,
        ].every(existsSync),
        authAndFocus: "verified by shared fixture",
      };
      assert.equal(evidence.final.nativeHistoryRetained, true);
      h.verify();
    } catch (error) {
      evidence.error = String(error);
      evidence.retained.push({
        owner: "root",
        ownership: join(h.dir, "ownership.json"),
        blocker: String(error),
      });
      throw error;
    } finally {
      writeFileSync(join(h.dir, "nested-loss-evidence.json"), JSON.stringify(evidence, null, 2), {
        mode: 0o600,
      });
      console.log(
        `Nested loss retained ownership/evidence: ${join(h.dir, "nested-loss-evidence.json")}`,
      );
    }
  },
);

test(
  "nested public interruption preserves the leaf conversation, its descendant and the independent branch",
  { ...options, timeout: 480_000 },
  async () => {
    const h = setup(
      "nested-interrupt",
      false,
      (dir) => {
        const work = (name: string, result: string) =>
          `Run only this synthetic workload. Run exactly ${shellEscape(process.execPath)} ${shellEscape(join(dir, "interrupt-barrier.cjs"))} ${shellEscape(dir)} ${name} using bash with timeout 360 seconds. After successful release: ${explicitCompletion58(result)} Do not inspect user files.`;
        const leafTask = `Call subagent exactly once with name Deeper58, agent interrupt-deeper58, task ${JSON.stringify(work("Deeper58", "DEPTH_RESULT_58"))}. Then run exactly ${shellEscape(process.execPath)} ${shellEscape(join(dir, "interrupt-barrier.cjs"))} ${shellEscape(dir)} LeafActive58 using bash with timeout 360 seconds. This bounded synthetic workload may be interrupted intentionally. Never relaunch Deeper58. After its actual asynchronous result arrives, reconcile DEPTH_RESULT_58. ${explicitCompletion58("RECONCILED_LEAF_58 DEPTH_RESULT_58")} Never call completion while descendants remain outstanding.`;
        const aTask = `Call subagent exactly once with name InterruptLeaf58, agent interrupt-leaf58, task ${JSON.stringify(leafTask)}. End your turn normally while it works. Do not poll or call completion tools while descendants remain outstanding. When its FIRST real asynchronous result arrives, reconcile it, say FIRST_LEAF_RECONCILED_58 RECONCILED_LEAF_58 DEPTH_RESULT_58 and end your turn normally. Remain interactive and do NOT call subagent_done yet: a later controller instruction will request one resume of this same original leaf. After that resumed child finishes, follow that later instruction for final reconciliation and explicit completion. Later exact guidance may request public interruption of that same original child; obey it without relaunching or closing anything.`;
        return `Synthetic isolated nested interruption proof. Launch InterruptA58 using agent interrupt-parent58 with task ${JSON.stringify(aTask)}, then launch InterruptB58 using agent interrupt-b58 with task ${JSON.stringify(work("InterruptB58", "INTERRUPT_B_RESULT_58"))}, before waiting. End your turn normally, receive independent asynchronous outcomes and report them honestly. Do not poll, inspect sessions, interrupt, resume, relaunch or close any pane yourself.`;
      },
      ({ dir, config, project }) => {
        for (const [name, spawning] of [
          ["interrupt-parent58", true],
          ["interrupt-leaf58", true],
          ["interrupt-deeper58", false],
          ["interrupt-b58", false],
        ] as const) {
          writeFileSync(
            join(project, ".pi", "agents", `${name}.md`),
            `---\nname: ${name}\nmodel: openai-codex/gpt-6.1-sol\nthinking: medium\nauto-exit: false\nspawning: ${spawning}\ntools: bash,read,subagent,subagent_interrupt,subagents_list,subagent_resume\n---\nFollow only the exact synthetic task and guidance. Preserve original owned descendants and wait for actual asynchronous outcomes before explicit completion. Once work is settled, emit the requested summary text immediately followed by the actual subagent_done tool call in the SAME assistant response, without ending the turn between them. A text-only response or future promise is incomplete.\n`,
          );
        }
        const executionObserver = join(dir, "nested-execution-observer.ts");
        writeFileSync(
          executionObserver,
          `import {writeFileSync} from "node:fs"; export default function(pi) { pi.on("session_start",(_e,ctx)=>{if(process.env.PI_SUBAGENT_AGENT !== "interrupt-leaf58")return;writeFileSync(${JSON.stringify(join(dir, "leaf-execution-"))}+process.env.PI_SUBAGENT_ID+".json",JSON.stringify({id:process.env.PI_SUBAGENT_ID,nativeId:ctx.sessionManager.getSessionId(),file:ctx.sessionManager.getSessionFile(),role:process.env.PI_SUBAGENT_AGENT,activity:process.env.PI_SUBAGENT_ACTIVITY_FILE,exitFile:process.env.PI_SUBAGENT_EXIT_FILE,autoExit:process.env.PI_SUBAGENT_AUTO_EXIT,tools:pi.getActiveTools()}),{mode:0o600});});}`,
        );
        const settingsPath = join(config, "settings.json");
        const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
        settings.extensions.push(executionObserver);
        writeFileSync(settingsPath, JSON.stringify(settings));
        writeFileSync(
          join(dir, "interrupt-barrier.cjs"),
          `const {watch,existsSync,writeFileSync}=require("node:fs"); const [dir,name]=process.argv.slice(2); const timer=setTimeout(()=>{w.close();process.exit(1)},350000); const check=()=>{if(existsSync(dir+"/"+name+".release")){clearTimeout(timer);w.close();writeFileSync(dir+"/"+name+".finished","finished\\n");process.stdout.write("RELEASED_"+name+"\\n")}}; const w=watch(dir,check); writeFileSync(dir+"/"+name+".ready","ready\\n"); check();`,
        );
      },
    );
    const launchFrom = (path: string, name: string) =>
      messages(path).find(
        (m) =>
          m.role === "toolResult" &&
          m.toolName === "subagent" &&
          !m.isError &&
          m.details.name === name,
      );
    const recordFrom = (path: string, childFile: string) =>
      readdirSync(path + ".delegations")
        .filter((f) => f.endsWith(".json"))
        .map((f) => JSON.parse(readFileSync(join(path + ".delegations", f), "utf8")))
        .find((r) => r.child?.sessionFile === childFile);
    const evidence: any = { owner: "root", retained: [] };
    try {
      await waitFor(
        () =>
          ["Deeper58", "LeafActive58", "InterruptB58"].every((name) =>
            existsSync(join(h.dir, name + ".ready")),
          ),
        "nested descendant, active leaf turn and independent B workloads",
      );
      const a = launchFrom(h.parentSession, "InterruptA58");
      const b = launchFrom(h.parentSession, "InterruptB58");
      assert.ok(a && b);
      const leaf = launchFrom(a.details.sessionFile, "InterruptLeaf58");
      assert.ok(leaf);
      const deeper = launchFrom(leaf.details.sessionFile, "Deeper58");
      assert.ok(deeper);
      const aRecord = recordFrom(h.parentSession, a.details.sessionFile);
      const bRecord = recordFrom(h.parentSession, b.details.sessionFile);
      const leafRecord = recordFrom(a.details.sessionFile, leaf.details.sessionFile);
      const deeperRecord = recordFrom(leaf.details.sessionFile, deeper.details.sessionFile);
      assert.ok(
        aRecord?.child?.job &&
          bRecord?.child?.job &&
          leafRecord?.child?.job &&
          deeperRecord?.child?.job,
      );
      evidence.original = { a, b, leaf, deeper, aRecord, bRecord, leafRecord, deeperRecord };
      const statusOutput = JSON.parse(h.herdr(["status", "server", "--json"]));
      const server = statusOutput.server ?? statusOutput;
      assert.equal(server.session, session);
      const managed = new HerdrParent(server.socket, h.parent);
      const leafBefore = await managed.get(leafRecord.child.job);
      assert.equal(leafBefore.phase, "owned");
      assert.ok(leafBefore.agent && leafBefore.busy && leafBefore.native_scope_id);
      const nativePrefix = readFileSync(leaf.details.sessionFile, "utf8");
      const nativeHeader = entries(leaf.details.sessionFile)[0];
      await waitFor(
        async () => {
          const current = await managed.get(aRecord.child.job);
          return current.agent && !current.busy;
        },
        "A becomes idle before exact nested interruption guidance",
        20_000,
      );
      const interruptControl = await managed.prompt(
        aRecord.child.job,
        `Call the public subagent_interrupt tool exactly once with id ${JSON.stringify(leaf.details.id)} for your original InterruptLeaf58. Then say NESTED_INTERRUPT_REQUESTED_58 and end your turn normally. Do not poll, relaunch, resume, close or complete anything. Your original leaf retains its descendant and must later reconcile its real result.`,
      );
      await waitFor(
        () =>
          messages(a.details.sessionFile).some(
            (m) =>
              m.role === "toolResult" &&
              m.toolName === "subagent_interrupt" &&
              !m.isError &&
              m.details?.status === "interrupted_verified",
          ),
        "A's public interruption verifies the exact active native request",
      );
      const interruptCalls = messages(a.details.sessionFile)
        .flatMap((m) => m.content ?? [])
        .filter((c) => c.type === "toolCall" && c.name === "subagent_interrupt");
      assert.equal(interruptCalls.length, 1);
      assert.equal(interruptCalls[0].arguments.id, leaf.details.id);
      const leafAfter = await waitFor(
        async () => {
          const current = await managed.get(leafRecord.child.job);
          return current.agent && !current.busy ? current : undefined;
        },
        "interrupted original leaf remains enrolled and idle",
        20_000,
      );
      assert.deepEqual(leafAfter.condition, leafBefore.condition);
      assert.deepEqual(leafAfter.agent, leafBefore.agent);
      assert.equal(entries(leaf.details.sessionFile)[0].id, nativeHeader.id);
      assert.ok(
        readFileSync(leaf.details.sessionFile, "utf8").startsWith(nativePrefix),
        "interruption preserves the native conversation prefix",
      );
      assert.ok(
        messages(leaf.details.sessionFile).some(
          (m) =>
            m.role === "assistant" &&
            (m.stopReason === "aborted" ||
              (m.stopReason === "error" && m.errorMessage === "This operation was aborted")),
        ),
      );
      assert.equal(
        existsSync(join(h.dir, "LeafActive58.finished")),
        false,
        "interrupted synthetic bash never reached successful release",
      );
      const deeperAfter = await managed.get(deeperRecord.child.job);
      const bAfter = await managed.get(bRecord.child.job);
      assert.equal(deeperAfter.phase, "owned");
      assert.ok(
        deeperAfter.agent && deeperAfter.busy,
        "the interrupted child's descendant remains active",
      );
      assert.equal(bAfter.phase, "owned");
      assert.ok(bAfter.agent && bAfter.busy, "the independent branch remains active");
      const visible = h.panes();
      for (const record of [leafRecord, deeperRecord, bRecord]) {
        const terminal = record.child.job.terminal;
        assert.ok(
          visible.some(
            (p: any) => p.pane_id === terminal.pane_id && p.terminal_id === terminal.terminal_id,
          ),
          "original leaf, descendant and independent branch keep their native panes",
        );
      }
      assert.equal(results(h.parentSession).length, 0);
      assert.equal(results(a.details.sessionFile).length, 0);
      assert.equal(results(leaf.details.sessionFile).length, 0);
      evidence.afterInterrupt = {
        a,
        b,
        leaf,
        deeper,
        aRecord,
        bRecord,
        leafRecord,
        deeperRecord,
        leafBefore,
        interruptControl,
        leafAfter,
        deeperAfter,
        bAfter,
        layout: h.json(["pane", "layout", "--pane", h.parent]),
      };
      writeFileSync(
        join(h.dir, "nested-interruption-evidence.json"),
        JSON.stringify(evidence, null, 2),
        { mode: 0o600 },
      );
      const guidance = await managed.prompt(
        leafRecord.child.job,
        `Your interrupted LeafActive58 synthetic workload is intentionally cancelled. Do not restart it. Your original Deeper58 remains working and owned by this native conversation. Do not relaunch, resume, poll or complete early. Say WAITING_FOR_ORIGINAL_DEEPER_58 and end your turn normally. When its actual asynchronous result arrives, reconcile it. ${explicitCompletion58("RECONCILED_LEAF_58 DEPTH_RESULT_58")}`,
      );
      await waitFor(
        () =>
          messages(leaf.details.sessionFile).some(
            (m) =>
              m.role === "assistant" &&
              m.stopReason === "stop" &&
              JSON.stringify(m.content).includes("WAITING_FOR_ORIGINAL_DEEPER_58"),
          ),
        "original leaf processes follow-up guidance in the same conversation",
      );
      await waitFor(
        async () => !(await managed.get(leafRecord.child.job)).busy,
        "guided leaf yields normally",
        20_000,
      );
      assert.equal(launchFrom(leaf.details.sessionFile, "Deeper58").details.id, deeper.details.id);
      assert.equal(
        messages(leaf.details.sessionFile).filter(
          (m) => m.role === "toolResult" && m.toolName === "subagent",
        ).length,
        1,
        "follow-up never duplicates the descendant",
      );
      writeFileSync(join(h.dir, "Deeper58.release"), "release\n");
      await waitFor(
        () => results(a.details.sessionFile).length === 1,
        "original leaf delivers only to its immediate parent A",
      );
      assert.equal(results(a.details.sessionFile)[0].details.exitCode, 0);
      assert.equal(results(a.details.sessionFile)[0].details.sessionFile, leaf.details.sessionFile);
      await waitFor(
        () =>
          !h
            .panes()
            .some((p: any) =>
              [
                leafRecord.child.job.terminal.pane_id,
                deeperRecord.child.job.terminal.pane_id,
              ].includes(p.pane_id),
            ),
        "original leaf and deeper managed cleanup before nested resume",
        30_000,
      );
      await waitFor(
        () =>
          messages(a.details.sessionFile).some(
            (m) =>
              m.role === "assistant" &&
              m.stopReason === "stop" &&
              JSON.stringify(m.content).includes("FIRST_LEAF_RECONCILED_58"),
          ),
        "A reconciles the first leaf and remains interactive",
      );
      await waitFor(
        async () => {
          const current = await managed.get(aRecord.child.job);
          return current.agent && !current.busy;
        },
        "A idle before exact nested resume guidance",
        20_000,
      );
      assert.equal(
        results(h.parentSession).length,
        0,
        "A remains interactive and B remains active before resume",
      );
      const originalExecution = JSON.parse(
        readFileSync(join(h.dir, "leaf-execution-" + leaf.details.id + ".json"), "utf8"),
      );
      const completedPrefix = readFileSync(leaf.details.sessionFile, "utf8");
      const resumeMessage = `This resumed execution is autonomous with autoExit true. Your prior assigned workload and descendant have settled; do not restart them or spawn another child. Run exactly ${shellEscape(process.execPath)} ${shellEscape(join(h.dir, "interrupt-barrier.cjs"))} ${shellEscape(h.dir)} ResumedLeaf58 using bash with timeout 360 seconds. After successful release, recall the original RECONCILED_LEAF_58 and DEPTH_RESULT_58 from this native conversation and return exactly NESTED_RESUME_58 RECONCILED_LEAF_58 DEPTH_RESULT_58. For THIS resumed execution do not call subagent_done or caller_ping; return normally for autonomous completion. Do not inspect user files.`;
      const resumeCall = {
        sessionPath: leaf.details.sessionFile,
        name: "ResumedLeaf58",
        autoExit: true,
        message: resumeMessage,
      };
      const resumeControl = await managed.prompt(
        aRecord.child.job,
        `Now call public subagent_resume exactly once with these arguments: ${JSON.stringify(resumeCall)}. This is the original leaf conversation you already reconciled. End your turn normally while the resumed execution works. Do not poll, interrupt, close, relaunch or complete early. After its real asynchronous final result arrives, reconcile BOTH leaf executions, then ${explicitCompletion58("RECONCILED_INTERRUPT_A_58 RECONCILED_LEAF_58 DEPTH_RESULT_58 NESTED_RESUME_58")}`,
      );
      const resumed = await waitFor(
        () =>
          messages(a.details.sessionFile).find(
            (m) =>
              m.role === "toolResult" &&
              m.toolName === "subagent_resume" &&
              !m.isError &&
              m.details.name === "ResumedLeaf58",
          ),
        "nested public resume acknowledgement from A",
      );
      await waitFor(
        () => existsSync(join(h.dir, "ResumedLeaf58.ready")),
        "resumed original leaf bounded native workload",
      );
      const resumedRecord = readdirSync(a.details.sessionFile + ".delegations")
        .filter((f) => f.endsWith(".json"))
        .map((f) =>
          JSON.parse(readFileSync(join(a.details.sessionFile + ".delegations", f), "utf8")),
        )
        .find((r) => r.state === "running" && r.child?.sessionFile === leaf.details.sessionFile);
      assert.ok(resumedRecord?.child?.job);
      evidence.resumed = { resumed, resumedRecord, resumeControl };
      const restoredExecution = JSON.parse(
        readFileSync(join(h.dir, "leaf-execution-" + resumed.details.id + ".json"), "utf8"),
      );
      assert.equal(entries(leaf.details.sessionFile)[0].id, nativeHeader.id);
      assert.equal(restoredExecution.nativeId, originalExecution.nativeId);
      assert.equal(restoredExecution.file, leaf.details.sessionFile);
      assert.equal(restoredExecution.role, originalExecution.role);
      assert.ok(
        readFileSync(leaf.details.sessionFile, "utf8").startsWith(completedPrefix),
        "nested resume preserves completed original history prefix",
      );
      assert.notEqual(resumed.details.id, leaf.details.id);
      assert.notEqual(resumedRecord.id, leafRecord.id, "fresh durable child ownership identity");
      assert.notEqual(resumedRecord.child.job.job_id, leafRecord.child.job.job_id);
      assert.notEqual(
        resumedRecord.child.job.terminal.terminal_id,
        leafRecord.child.job.terminal.terminal_id,
      );
      assert.ok(originalExecution.activity && restoredExecution.activity);
      assert.ok(originalExecution.exitFile && restoredExecution.exitFile);
      assert.notEqual(restoredExecution.activity, originalExecution.activity);
      assert.notEqual(restoredExecution.exitFile, originalExecution.exitFile);
      assert.equal(restoredExecution.autoExit, "1");
      assert.deepEqual(
        [...restoredExecution.tools].sort(),
        [...originalExecution.tools].sort(),
        "nested resume restores the original effective public tool policy",
      );
      const resumedCurrent = await managed.get(resumedRecord.child.job);
      assert.equal(resumedCurrent.phase, "owned");
      assert.ok(resumedCurrent.agent && resumedCurrent.busy);
      const stillB = await managed.get(bRecord.child.job);
      assert.equal(stillB.phase, "owned");
      assert.deepEqual(stillB.condition, bAfter.condition);
      assert.deepEqual(stillB.agent, bAfter.agent);
      assert.ok(stillB.busy, "original independent B remains active across nested resume");
      const resumedLayout = h.json(["pane", "layout", "--pane", h.parent]).layout;
      const rect = (id: string) => {
        const p = resumedLayout.panes.find((p: any) => p.pane_id === id);
        assert.ok(p);
        return p.rect;
      };
      const masterRect = rect(h.parent);
      const aRect = rect(aRecord.child.job.terminal.pane_id);
      const bRect = rect(bRecord.child.job.terminal.pane_id);
      const resumedRect = rect(resumedRecord.child.job.terminal.pane_id);
      assert.ok(masterRect.x + masterRect.width <= aRect.x && aRect.x + aRect.width <= bRect.x);
      assert.equal(
        resumedRect.x,
        aRect.x,
        "resumed descendant returns to A's original branch column",
      );
      assert.equal(resumedRect.width, aRect.width);
      assert.ok(
        resumedRect.y >= aRect.y + aRect.height,
        "resumed leaf stacks below its original parent",
      );
      assert.equal(resumedLayout.panes.length, 4, "nested resume creates no extra root column");
      assert.equal(resumedLayout.focused_pane_id, h.parent);
      for (const p of resumedLayout.panes) assert.ok(p.rect.width >= 40 && p.rect.height >= 12);
      assert.equal(results(h.parentSession).length, 0);
      assert.equal(
        results(a.details.sessionFile).length,
        1,
        "resumed work remains pending while barrier is active",
      );
      evidence.resumed = {
        ...evidence.resumed,
        originalExecution,
        restoredExecution,
        resumedCurrent,
        stillB,
        resumedLayout,
      };
      writeFileSync(
        join(h.dir, "nested-interruption-evidence.json"),
        JSON.stringify(evidence, null, 2),
        { mode: 0o600 },
      );
      writeFileSync(join(h.dir, "ResumedLeaf58.release"), "release\n");
      writeFileSync(join(h.dir, "InterruptB58.release"), "release\n");
      await waitFor(
        () => results(h.parentSession).length === 2,
        "independent A/B reconciled root outcomes",
      );
      const rootResults = results(h.parentSession);
      assert.deepEqual(rootResults.map((r) => r.details.name).sort(), [
        "InterruptA58",
        "InterruptB58",
      ]);
      assert.ok(rootResults.every((r) => r.details.exitCode === 0));
      assert.match(
        rootResults.find((r) => r.details.name === "InterruptA58").content,
        /RECONCILED_INTERRUPT_A_58 RECONCILED_LEAF_58 DEPTH_RESULT_58/,
      );
      assert.match(
        rootResults.find((r) => r.details.name === "InterruptB58").content,
        /INTERRUPT_B_RESULT_58/,
      );
      assert.match(
        rootResults.find((r) => r.details.name === "InterruptA58").content,
        /NESTED_RESUME_58/,
      );
      assert.deepEqual(
        results(a.details.sessionFile).map((r) => r.details.name),
        ["InterruptLeaf58", "ResumedLeaf58"],
      );
      assert.deepEqual(
        results(leaf.details.sessionFile).map((r) => r.details.name),
        ["Deeper58"],
      );
      assert.equal(results(a.details.sessionFile)[0].details.sessionFile, leaf.details.sessionFile);
      assert.equal(results(a.details.sessionFile)[1].details.sessionFile, leaf.details.sessionFile);
      assert.equal(results(a.details.sessionFile)[1].details.exitCode, 0);
      assert.match(
        results(a.details.sessionFile)[1].content,
        /NESTED_RESUME_58 RECONCILED_LEAF_58 DEPTH_RESULT_58/,
      );
      const resumedEntries = readFileSync(leaf.details.sessionFile, "utf8")
        .slice(completedPrefix.length)
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line));
      assert.ok(
        !resumedEntries
          .filter((e) => e.type === "message")
          .flatMap((e) => e.message.content ?? [])
          .some((c) => c.type === "toolCall" && c.name === "subagent_done"),
        "resumed autonomous execution needs no manual completion tool",
      );
      assert.equal(
        results(leaf.details.sessionFile)[0].details.sessionFile,
        deeper.details.sessionFile,
      );
      await waitFor(
        () => h.panes().length === 1,
        "all settled child jobs close through their original parent watchers",
        30_000,
      );
      assert.ok(
        [a, b, leaf, deeper].every((receipt) => existsSync(receipt.details.sessionFile)),
        "all native histories remain after exact managed cleanup",
      );
      evidence.final = {
        guidance,
        rootResults,
        aJournal: recordFrom(a.details.sessionFile, leaf.details.sessionFile),
        leafJournal: recordFrom(leaf.details.sessionFile, deeper.details.sessionFile),
        panes: h.panes(),
        immediateParentRouting: true,
        nativeHistoryPreserved: true,
        originalDescendantPreserved: true,
        nestedResume: true,
        resumedJournal: JSON.parse(
          readFileSync(
            join(a.details.sessionFile + ".delegations", resumedRecord.id + ".json"),
            "utf8",
          ),
        ),
      };
      h.verify();
    } catch (error) {
      evidence.error = String(error);
      for (const [name, record] of [
        ["InterruptA58", evidence.original?.aRecord],
        ["InterruptB58", evidence.original?.bRecord],
        ["InterruptLeaf58", evidence.original?.leafRecord],
        ["Deeper58", evidence.original?.deeperRecord],
        ["ResumedLeaf58", evidence.resumed?.resumedRecord],
      ] as const) {
        if (record?.child?.job)
          evidence.retained.push({
            name,
            job: record.child.job,
            owner: "root",
            blocker: String(error),
          });
      }
      evidence.retained.push({
        owner: "root",
        ownership: join(h.dir, "ownership.json"),
        blocker: String(error),
      });
      throw error;
    } finally {
      writeFileSync(
        join(h.dir, "nested-interruption-evidence.json"),
        JSON.stringify(evidence, null, 2),
        { mode: 0o600 },
      );
      console.log(
        `Nested interruption retained ownership/evidence: ${join(h.dir, "nested-interruption-evidence.json")}`,
      );
    }
  },
);
