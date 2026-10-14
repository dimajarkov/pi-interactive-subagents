/** Opt-in native Pi/Herdr proof. Requires an explicitly authorized named session.
 * PI_HERDR_TEST_SESSION=handovers PI_HERDR_TEST_AUTH=/path/to/auth.json
 * node --test test/integration/herdr-customization.test.ts
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
  "public parallel/context/capability calls use distinct native Pi sessions and independent results",
  {
    skip: !session || !authPath,
    timeout: 600_000,
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
    const dir = mkdtempSync(join(realpathSync(tmpdir()), "pi-herdr-customization-"));
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
        extensions: [join(root, "pi-extension/subagents/index.ts"), join(config, "observer.ts")],
        skills: [join(config, "skills")],
        quietStartup: true,
        shellPath: "/bin/bash",
      }),
    );
    // Observe the native public host capability surface, not model self-report.
    writeFileSync(join(config, "observer.ts"), `import { writeFileSync } from "node:fs";\nexport default function(pi) { pi.on("session_start", (_event, ctx) => { const file = ctx.sessionManager.getSessionFile(); if (file) writeFileSync(file + ".capabilities.json", JSON.stringify({ cwd: ctx.cwd, activeTools: pi.getActiveTools(), allTools: pi.getAllTools().map(t => t.name), role: process.env.PI_SUBAGENT_AGENT, denied: process.env.PI_DENY_TOOLS })); }); }\n`);
    mkdirSync(join(config, "agents"), { recursive: true, mode: 0o700 });
    mkdirSync(join(config, "skills", "native-proof"), { recursive: true, mode: 0o700 });
    writeFileSync(join(config, "skills", "native-proof", "SKILL.md"), "---\nname: native-proof\ndescription: Synthetic isolated native skill proof.\n---\nInclude SKILL_APPLIED_39 in your final result.\n");
    const agent = (name: string, extra: string, body: string) => writeFileSync(
      join(project, ".pi", "agents", `${name}.md`),
      `---\nname: ${name}\nmodel: ${model}\nthinking: medium\nauto-exit: ${name === "proof-nested" ? "false" : "true"}\ntools: bash,read,subagent,subagents_list\n${extra}\n---\n${body}\n`,
    );
    const synthetic = "Run only the exact synthetic task. Do not inspect any user files.";
    agent("proof-lineage", "session-mode: lineage-only\nspawning: false", synthetic);
    agent("proof-fork", "session-mode: standalone\nspawning: false", synthetic);
    agent("proof-nested", "session-mode: standalone\nspawning: true", synthetic);
    agent("proof-leaf", "session-mode: standalone\nspawning: false", synthetic);
    // Default definition cwd is deliberately overridden by the public call.
    agent("proof-standalone", `session-mode: standalone\nspawning: false\ndeny-tools: edit\nskills: native-proof\ncwd: ${project}`, synthetic);
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
      "pi-herdr-customization-proof",
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
    const delivered = join(dir, "parent-delivered.txt");
    const parentSession = join(sessions, "parent.jsonl");
    const markerFor = (name: string) => join(dir, `${name}-cwd.txt`);
    const names = ["Standalone39", "Lineage39", "Fork39", "Nested39"];
    const tasks = names.slice(0, 3).map(name => `Run exactly: sleep 30; pwd -P > ${shellEscape(markerFor(name))}. Then return exactly RESULT_${name}.`);
    const nestedTask = `Call subagent with name "Leaf39", agent "proof-leaf", cwd ${JSON.stringify(childCwd)}, task ${JSON.stringify(`Run exactly: sleep 20; pwd -P > ${shellEscape(markerFor("Leaf39"))}. Return exactly RESULT_Leaf39.`)}. Write NESTED_CONTINUED_39 to ${join(dir, "nested-continued.txt")} immediately after that call. Wait for its asynchronous completion. Once its result arrives, emit assistant summary RESULT_Nested39 RESULT_Leaf39 and immediately invoke subagent_done with empty arguments {} before ending your turn. Do not merely return final text; the task is complete only after that tool call.`;
    const calls = [
      { name: names[0], agent: "proof-standalone", task: tasks[0], cwd: childCwd, model, tools: "bash,read", interactive: true },
      { name: names[1], agent: "proof-lineage", task: tasks[1], cwd: childCwd },
      { name: names[2], agent: "proof-fork", task: tasks[2], cwd: childCwd, fork: true },
      { name: names[3], agent: "proof-nested", task: nestedTask, cwd: project },
    ];
    // A real prior native turn supplies context that must be copied only by fork.
    const childEnv = { ...process.env, PI_CODING_AGENT_DIR: config, PI_CODING_AGENT_SESSION_DIR: sessions, PI_TELEMETRY: "0", PI_OFFLINE: "1" };
    execFileSync("pi", ["-p", "-ne", "-ns", "-np", "-nc", "--no-mcp", "--session", parentSession, "--model", model, "--thinking", "medium", "Remember synthetic marker PRIOR_CONTEXT_39. Reply only ACK_CONTEXT_39. Use no tools."], { cwd: project, env: childEnv, stdio: ["ignore", "pipe", "pipe"] });
    const task = `Synthetic isolated proof. Make these four public subagent calls with the exact supplied arguments, launching all before waiting: ${JSON.stringify(calls)}. Immediately after all launches write PARENT_CONTINUED_39 to ${parentMarker} using bash. Do independent parent work: calculate 17*19. End your turn and let upstream asynchronous results arrive. After all four independent results have arrived, write exactly RESULT_Standalone39 RESULT_Lineage39 RESULT_Fork39 RESULT_Nested39 RESULT_Leaf39 to ${delivered}. Do not inspect any user files, poll child sessions, interrupt, focus, or close panes.`;
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
    const seenChildren = new Map<string, any>();
    const observations: any[] = [];
    const deadline = Date.now() + 480_000;
    while (Date.now() < deadline && !existsSync(delivered)) {
      const panes = json(["pane", "list", "--workspace", workspace]).panes;
      for (const child of panes.filter((p: any) => p.pane_id !== pane)) {
        assert.equal(child.focused, false);
        seenChildren.set(child.pane_id, { pane: child.pane_id, terminal: child.terminal_id, cwd: child.cwd, focused: child.focused, agent: child.agent });
      }
      observations.push({ at: Date.now(), panes: panes.map((p: any) => ({ id: p.pane_id, cwd: p.cwd })) });
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
    assert.ok(seenChildren.size >= 4, "distinct native direct children observed");
    for (const name of names.slice(0, 3)) {
      assert.equal(readFileSync(markerFor(name), "utf8").trim(), childCwd);
      assert.ok(statSync(parentMarker).mtimeMs < statSync(markerFor(name)).mtimeMs, "parent continues before independent child completion");
    }
    assert.equal(readFileSync(markerFor("Leaf39"), "utf8").trim(), childCwd);
    assert.ok(statSync(join(dir, "nested-continued.txt")).mtimeMs < statSync(markerFor("Leaf39")).mtimeMs);
    const parse = (path: string) => readFileSync(path, "utf8").trim().split("\n").map(line => JSON.parse(line));
    const entries = parse(parentSession);
    const messages = entries.filter(e => e.type === "message").map(e => e.message);
    const callsMade = messages.flatMap(m => m.content ?? []).filter(c => c.type === "toolCall" && c.name === "subagent");
    assert.equal(callsMade.length, 4);
    const results = entries.filter(e => e.customType === "subagent_result");
    assert.equal(results.length, 4, "each direct child independently delivers its result");
    assert.equal(new Set(results.map(r => r.details.sessionFile)).size, 4);
    const childSessions = new Map(results.map(r => [r.details.name, parse(r.details.sessionFile)]));
    for (const name of names) {
      const child = childSessions.get(name)!;
      assert.ok(child.some(e => e.type === "model_change" && e.provider === "openai-codex" && e.modelId === "gpt-6.1-sol"));
      assert.ok(child.some(e => e.type === "thinking_level_change" && e.thinkingLevel === "medium"));
      assert.ok(JSON.stringify(results.find(r => r.details.name === name)).includes(`RESULT_${name}`));
    }
    const standalone = childSessions.get("Standalone39")!;
    const lineage = childSessions.get("Lineage39")!;
    const fork = childSessions.get("Fork39")!;
    assert.ok(!standalone[0].parentSession, "standalone has no parent ancestry");
    assert.equal(lineage[0].parentSession, parentSession);
    assert.equal(fork[0].parentSession, parentSession);
    assert.ok(!JSON.stringify(standalone).includes("PRIOR_CONTEXT_39"));
    assert.ok(!JSON.stringify(lineage).includes("PRIOR_CONTEXT_39"));
    assert.ok(JSON.stringify(fork).includes("PRIOR_CONTEXT_39"), "fork copies actual prior native parent context");
    assert.ok(standalone.some(e => e.type === "message" && e.message.role === "user" && JSON.stringify(e.message.content).includes("Include SKILL_APPLIED_39 in your final result")), "skill template expanded into native child conversation");

    const nested = childSessions.get("Nested39")!;
    assert.ok(nested.some(e => e.type === "message" && Array.isArray(e.message.content) && e.message.content.some((c: any) => c.type === "toolCall" && c.name === "subagent")), "allowed nested public delegation called");
    assert.ok(nested.some(e => e.customType === "subagent_result" && JSON.stringify(e).includes("RESULT_Leaf39")));
    const launchResults = messages.filter(m => m.role === "toolResult" && m.toolName === "subagent");
    const standaloneLaunch = launchResults.find(m => m.details?.name === "Standalone39");
    const script = readFileSync(standaloneLaunch.details.launchScriptFile, "utf8");
    assert.match(script, /PI_DENY_TOOLS=.*subagent/);
    assert.match(script, /\/skill:native-proof/);
    const standaloneCaps = JSON.parse(readFileSync(results.find(r => r.details.name === "Standalone39").details.sessionFile + ".capabilities.json", "utf8"));
    assert.equal(standaloneCaps.cwd, childCwd);
    assert.ok(!standaloneCaps.allTools.includes("subagent"), "native forbidden nested delegation absent");
    assert.deepEqual(standaloneCaps.activeTools.sort(), ["bash", "caller_ping", "read", "subagent_done"].sort());
    const nestedCaps = JSON.parse(readFileSync(results.find(r => r.details.name === "Nested39").details.sessionFile + ".capabilities.json", "utf8"));
    assert.ok(nestedCaps.activeTools.includes("subagent"));
    assert.match(script, /--tools 'bash,read,caller_ping,subagent_done'/);
    writeFileSync(join(dir, "observations.json"), JSON.stringify(observations, null, 2));
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
          children: [...seenChildren.values()],
          parallelIndependentResults: true,
          nativeContextModes: true,
          allowedNestedDelegation: true,
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
