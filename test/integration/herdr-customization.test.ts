/** Opt-in native Pi/Herdr proof. Requires an explicitly authorized named session.
 * PI_HERDR_TEST_SESSION=handovers PI_HERDR_TEST_AUTH=/path/to/auth.json
 * PI_HERDR_BUNDLED_PROOF=layout opts into the autonomous bundled layout proof.
 * PI_HERDR_BUNDLED_PROOF=layout-manual uses explicitly enabled non-autoexit agents.
 * PI_HERDR_LAYOUT_HOLD=1 retains its seven-pane stage until layout.release is created.
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
  watch,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { shellEscape } from "../../pi-extension/subagents/cmux.ts";

const session = process.env.PI_HERDR_TEST_SESSION;
const authPath = process.env.PI_HERDR_TEST_AUTH;
const model = "openai-codex/gpt-6.1-sol";
const bundledProof = process.env.PI_HERDR_BUNDLED_PROOF;
const manualLayout = bundledProof === "layout-manual";
const layoutProof = bundledProof === "layout" || manualLayout;
const layoutRole = manualLayout ? "proof-layout-manual" : "worker";
const layoutCompletion = (result: string) =>
  manualLayout
    ? `First send an assistant message containing exactly ${result}, then call subagent_done with {}. This explicit completion is allowed ONLY after the assigned workload and every owned descendant result have been successfully processed. Do not call completion tools while work remains outstanding.`
    : `Return exactly ${result}. Do not call completion tools; complete autonomously.`;
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
    writeFileSync(
      join(config, "observer.ts"),
      `import { writeFileSync } from "node:fs";\nexport default function(pi) { pi.on("session_start", (_event, ctx) => { const file = ctx.sessionManager.getSessionFile(); if (file) writeFileSync(file + ".capabilities.json", JSON.stringify({ cwd: ctx.cwd, activeTools: pi.getActiveTools(), allTools: pi.getAllTools().map(t => t.name), role: process.env.PI_SUBAGENT_AGENT, pane: process.env.HERDR_PANE_ID, denied: process.env.PI_DENY_TOOLS, autoExit: process.env.PI_SUBAGENT_AUTO_EXIT ?? null })); }); }\n`,
    );
    mkdirSync(join(config, "agents"), { recursive: true, mode: 0o700 });
    mkdirSync(join(config, "skills", "native-proof"), { recursive: true, mode: 0o700 });
    writeFileSync(
      join(config, "skills", "native-proof", "SKILL.md"),
      "---\nname: native-proof\ndescription: Synthetic isolated native skill proof.\n---\nInclude SKILL_APPLIED_39 in your final result.\n",
    );
    const agent = (name: string, extra: string, body: string) =>
      writeFileSync(
        join(project, ".pi", "agents", `${name}.md`),
        `---\nname: ${name}\nmodel: ${model}\nthinking: medium\nauto-exit: true\ntools: bash,read,subagent,subagents_list\n${extra}\n---\n${body}\n`,
      );
    const synthetic = "Run only the exact synthetic task. Do not inspect any user files.";
    agent("proof-lineage", "session-mode: lineage-only\nspawning: false", synthetic);
    agent("proof-fork", "session-mode: standalone\nspawning: false", synthetic);
    agent("proof-nested", "session-mode: standalone\nspawning: true", synthetic);
    agent("proof-leaf", "session-mode: standalone\nspawning: false", synthetic);
    if (manualLayout) {
      writeFileSync(
        join(project, ".pi", "agents", "proof-layout-manual.md"),
        `---\nname: proof-layout-manual\nmodel: ${model}\nthinking: medium\nsession-mode: standalone\nauto-exit: false\nspawning: true\ntools: bash,read,subagent,subagent_interrupt,subagents_list,subagent_resume\n---\n${synthetic} Remain interactive while work is outstanding. After successfully completing your exact assigned task and reconciling every owned descendant, emit the requested assistant summary and then call subagent_done with {}.\n`,
      );
    }
    // Default definition cwd is deliberately overridden by the public call.
    agent(
      "proof-standalone",
      `session-mode: standalone\nspawning: false\ndeny-tools: edit\nskills: native-proof\ncwd: ${project}`,
      synthetic,
    );
    const herdr = (args: string[]) =>
      execFileSync("herdr", ["--session", session!, ...args], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    const json = (args: string[]) => JSON.parse(herdr(args)).result;
    const before = json(["workspace", "list"]).workspaces;
    const unrelatedPanes = layoutProof
      ? before.map((w: any) => ({
          workspace: w.workspace_id,
          panes: json(["pane", "list", "--workspace", w.workspace_id]).panes.map((p: any) => ({
            pane: p.pane_id,
            terminal: p.terminal_id,
          })),
        }))
      : [];
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
    const tasks = names
      .slice(0, 3)
      .map(
        (name) =>
          `Run exactly: sleep 30; pwd -P > ${shellEscape(markerFor(name))}. Then return RESULT_${name} and apply any configured skill instructions to the final result.`,
      );
    const nestedTask = `Call subagent with name "Leaf39", agent "proof-leaf", cwd ${JSON.stringify(childCwd)}, task ${JSON.stringify(`Run exactly: sleep 20; pwd -P > ${shellEscape(markerFor("Leaf39"))}. Return exactly RESULT_Leaf39.`)}. While the leaf is still working, call subagent_done with {} and caller_ping with message "GUARD_PROOF_55". Both must return errors refusing exit because owned work is outstanding. Then write NESTED_CONTINUED_39 to ${join(dir, "nested-continued.txt")} immediately after that call. Wait for its asynchronous completion. End your initial turn normally while it works. Once its asynchronous result arrives, return exactly RECONCILED_NESTED_55 RESULT_Nested39 RESULT_Leaf39. Do not call subagent_done; ordinary autonomous completion must return the reconciled result.`;
    let calls = [
      {
        name: names[0],
        agent: "proof-standalone",
        task: tasks[0],
        cwd: childCwd,
        model,
        tools: "bash,read",
      },
      { name: names[1], agent: "proof-lineage", task: tasks[1], cwd: childCwd },
      { name: names[2], agent: "proof-fork", task: tasks[2], cwd: childCwd, fork: true },
      { name: names[3], agent: "proof-nested", task: nestedTask, cwd: project },
    ];
    if (layoutProof) {
      // These bounded file barriers keep synthetic workloads observable. Agents
      // still yield normally and receive results through native Pi delivery.
      const barrier = join(dir, "layout-barrier.cjs");
      writeFileSync(
        barrier,
        `const { watch, existsSync, writeFileSync } = require("node:fs");
const [dir, name] = process.argv.slice(2);
const release = dir + "/" + name + ".release";
const timer = setTimeout(() => { watcher.close(); console.error("Synthetic barrier expired: " + name); process.exit(1); }, 420000);
const check = () => { if (existsSync(release)) { clearTimeout(timer); watcher.close(); process.stdout.write("BARRIER_RELEASED_" + name + "\\n"); } };
const watcher = watch(dir, check);
writeFileSync(dir + "/" + name + ".ready", "ready\\n");
check();
`,
      );
      calls = ["A", "B"].map((branch) => {
        const leafCalls = [1, 2].map((index) => ({
          name: `${branch}${index}`,
          agent: layoutRole,
          cwd: project,
          task:
            branch === "A" && index === 1
              ? `${synthetic} Run exactly ${shellEscape(process.execPath)} ${shellEscape(barrier)} ${shellEscape(dir)} A1 using bash with timeout 430 seconds. This event-driven synthetic workload keeps the initial layout observable. After successful release call subagent with name A1a, agent ${layoutRole}, cwd ${JSON.stringify(project)}, task ${JSON.stringify(`${synthetic} Run exactly ${shellEscape(process.execPath)} ${shellEscape(barrier)} ${shellEscape(dir)} A1a using bash with timeout 430 seconds. After successful release ${layoutCompletion("RESULT_A1a")}`)}. End your turn normally and await automatic delivery without polling or calling completion tools while descendants remain outstanding. After its asynchronous result arrives, ${layoutCompletion("RESULT_A1 RECONCILED_A1 RESULT_A1a")} Report any failure honestly.`
              : `${synthetic} Run exactly ${shellEscape(process.execPath)} ${shellEscape(barrier)} ${shellEscape(dir)} ${branch}${index} using bash with timeout 430 seconds. This is an event-driven synthetic workload, not agent status polling. After successful release ${layoutCompletion(`RESULT_${branch}${index}`)} On failure report the error honestly. Do not launch children.`,
        }));
        return {
          name: branch,
          agent: layoutRole,
          cwd: project,
          task: `${synthetic} Make these two public subagent calls in the supplied order, launching both before waiting: ${JSON.stringify(leafCalls)}. End your turn normally while they run. Do not poll, sleep, inspect sessions or call completion tools while descendants remain outstanding. After BOTH asynchronous child results arrive, reconcile them. ${layoutCompletion(`RECONCILED_${branch} RESULT_${branch}1 RESULT_${branch}2`)} If a child fails, report failure honestly.`,
        };
      });
    } else if (bundledProof) {
      const leaf = `This is a bounded synthetic delegation acceptance task, not a repository change. Do not inspect user files, use todos, commit, or modify code. Run exactly sleep 35 using bash. Return exactly BUNDLED_LEAF_57.`;
      const bundledTask =
        bundledProof === "baseline"
          ? "This is a bounded synthetic capability observation, not implementation. Do not inspect files, use todos, commit, or change code. Reply exactly BUNDLED_BASELINE_57 without calling tools."
          : `This is a bounded synthetic delegation acceptance task, not implementation. Do not inspect files, use todos, commit, or change code. Call subagent with name BundledLeaf57, agent worker, task ${JSON.stringify(leaf)}. Then end your turn normally while the leaf works. Do not poll or call completion tools. Once its asynchronous result arrives, return exactly RECONCILED_BUNDLED_57 BUNDLED_LEAF_57.`;
      calls = [{ name: "Bundled57", agent: "worker", task: bundledTask, cwd: project }];
    }
    // A real prior native turn supplies context that must be copied only by fork.
    const childEnv = {
      ...process.env,
      PI_CODING_AGENT_DIR: config,
      PI_CODING_AGENT_SESSION_DIR: sessions,
      PI_TELEMETRY: "0",
      PI_OFFLINE: "1",
    };
    execFileSync(
      "pi",
      [
        "-p",
        "-ne",
        "-ns",
        "-np",
        "-nc",
        "--no-mcp",
        "--session",
        parentSession,
        "--model",
        model,
        "--thinking",
        "medium",
        "Remember synthetic marker PRIOR_CONTEXT_39. Reply only ACK_CONTEXT_39. Use no tools.",
      ],
      { cwd: project, env: childEnv, stdio: ["ignore", "pipe", "pipe"] },
    );
    const task = layoutProof
      ? `${synthetic} Make these two public subagent calls in supplied order, launching both before waiting: ${JSON.stringify(calls)}. End your turn normally and await automatic delivery. Do not poll, sleep, inspect sessions, interrupt, focus or close panes. After BOTH completed reconciled results arrive, write exactly RECONCILED_A RESULT_A1 RESULT_A2 RECONCILED_B RESULT_B1 RESULT_B2 using bash to ${shellEscape(delivered)}. If either fails, report the failure instead of writing success.`
      : bundledProof
        ? `Synthetic isolated proof. Make exactly this public subagent call: ${JSON.stringify(calls[0])}. End your turn while it works and await automatic delivery. Do not poll, interrupt, focus, or close panes. After its completed reconciled result arrives write that full result using bash to ${delivered}. Do not inspect user files.`
        : `Synthetic isolated proof. Make these four public subagent calls with the exact supplied arguments, launching all before waiting: ${JSON.stringify(calls)}. Immediately after all launches write PARENT_CONTINUED_39 to ${parentMarker} using bash. Do independent parent work: calculate 17*19. End your turn and let upstream asynchronous results arrive. After all four independent results have arrived, write exactly RESULT_Standalone39 RESULT_Lineage39 RESULT_Fork39 RESULT_Nested39 RESULT_Leaf39 to ${delivered}. Do not inspect any user files, poll child sessions, interrupt, focus, or close panes.`;
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
    if (layoutProof) {
      await proveBranchLayout({
        dir,
        project,
        workspace,
        pane,
        parentSession,
        delivered,
        json,
        herdr,
      });
      const after = json(["workspace", "list"]).workspaces;
      assert.deepEqual(
        after.filter((w: any) => w.focused).map((w: any) => w.workspace_id),
        focusedBefore,
        "launch and completion preserve the previously focused workspace",
      );
      assert.ok(
        before.every((w: any) => after.some((a: any) => a.workspace_id === w.workspace_id)),
      );
      for (const unrelated of unrelatedPanes) {
        assert.deepEqual(
          json(["pane", "list", "--workspace", unrelated.workspace]).panes.map((p: any) => ({
            pane: p.pane_id,
            terminal: p.terminal_id,
          })),
          unrelated.panes,
          "unrelated pane identities survive all phases",
        );
      }
      assert.equal(createHash("sha256").update(readFileSync(authPath!)).digest("hex"), authHash);
      return;
    }
    const seenChildren = new Map<string, any>();
    const observations: any[] = [];
    const deadline = Date.now() + 480_000;
    while (Date.now() < deadline && !existsSync(delivered)) {
      const panes = json(["pane", "list", "--workspace", workspace]).panes;
      for (const child of panes.filter((p: any) => p.pane_id !== pane)) {
        assert.equal(child.focused, false);
        seenChildren.set(child.pane_id, {
          pane: child.pane_id,
          terminal: child.terminal_id,
          cwd: child.cwd,
          focused: child.focused,
          agent: child.agent,
        });
      }
      if (bundledProof && panes.length >= 3 && !existsSync(join(dir, "nested-layout.json"))) {
        writeFileSync(join(dir, "nested-layout.json"), herdr(["pane", "layout", "--pane", pane]));
      }
      observations.push({
        at: Date.now(),
        panes: panes.map((p: any) => ({ id: p.pane_id, cwd: p.cwd })),
      });
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
    if (bundledProof) {
      const entries = readFileSync(parentSession, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      const result = entries.find((e) => e.customType === "subagent_result");
      assert.ok(result, "bundled result delivered to root");
      const caps = JSON.parse(
        readFileSync(result.details.sessionFile + ".capabilities.json", "utf8"),
      );
      const lifecycle = ["subagent", "subagent_interrupt", "subagents_list", "subagent_resume"];
      assert.equal(caps.role, "worker");
      if (bundledProof === "baseline") {
        for (const tool of lifecycle) {
          assert.ok(!caps.activeTools.includes(tool));
          assert.ok(caps.denied.split(",").includes(tool));
        }
      } else {
        for (const tool of lifecycle) assert.ok(caps.activeTools.includes(tool), tool);
        const child = readFileSync(result.details.sessionFile, "utf8")
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line));
        const leaf = child.find((e) => e.customType === "subagent_result");
        assert.ok(leaf, "bundled parent processes leaf result");
        assert.match(result.content, /RECONCILED_BUNDLED_57 BUNDLED_LEAF_57/);
        const toolCalls = child
          .filter((e) => e.type === "message")
          .flatMap((e) => e.message.content ?? [])
          .filter((c) => c.type === "toolCall");
        assert.deepEqual(
          toolCalls.map((c) => c.name),
          ["subagent"],
          "one launch, ordinary yield and final completion without polling or manual done",
        );
        assert.equal(toolCalls[0].arguments.agent, "worker");
        const leafCaps = JSON.parse(
          readFileSync(leaf.details.sessionFile + ".capabilities.json", "utf8"),
        );
        assert.equal(leafCaps.role, "worker");
        for (const tool of lifecycle) assert.ok(leafCaps.activeTools.includes(tool), tool);
        assert.ok(existsSync(join(dir, "nested-layout.json")), "capture real nested layout");
        writeFileSync(
          join(dir, "native-mapping.json"),
          JSON.stringify(
            {
              root: { pane, session: parentSession },
              parent: { pane: caps.pane, session: result.details.sessionFile },
              leaf: { pane: leafCaps.pane, session: leaf.details.sessionFile },
            },
            null,
            2,
          ),
        );
      }
      assert.deepEqual(
        json(["pane", "list", "--workspace", workspace]).panes.map((p: any) => p.pane_id),
        [pane],
      );
      const after = json(["workspace", "list"]).workspaces;
      assert.deepEqual(
        after.filter((w: any) => w.focused).map((w: any) => w.workspace_id),
        focusedBefore,
      );
      assert.ok(
        before.every((w: any) => after.some((a: any) => a.workspace_id === w.workspace_id)),
      );
      assert.equal(createHash("sha256").update(readFileSync(authPath!)).digest("hex"), authHash);
      writeFileSync(join(dir, "observations.json"), JSON.stringify(observations, null, 2));
      writeFileSync(
        join(dir, "result.json"),
        JSON.stringify(
          {
            bundledProof,
            capabilities: caps,
            result,
            focusPreserved: true,
            authUnchanged: true,
            nativeVisualAcceptance: false,
          },
          null,
          2,
        ),
      );
      return;
    }
    assert.ok(seenChildren.size >= 4, "distinct native direct children observed");
    for (const name of names.slice(0, 3)) {
      assert.equal(readFileSync(markerFor(name), "utf8").trim(), childCwd);
      assert.ok(
        statSync(parentMarker).mtimeMs < statSync(markerFor(name)).mtimeMs,
        "parent continues before independent child completion",
      );
    }
    assert.equal(readFileSync(markerFor("Leaf39"), "utf8").trim(), childCwd);
    assert.ok(
      statSync(join(dir, "nested-continued.txt")).mtimeMs < statSync(markerFor("Leaf39")).mtimeMs,
    );
    const parse = (path: string) =>
      readFileSync(path, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
    const entries = parse(parentSession);
    const messages = entries.filter((e) => e.type === "message").map((e) => e.message);
    const callsMade = messages
      .flatMap((m) => m.content ?? [])
      .filter((c) => c.type === "toolCall" && c.name === "subagent");
    assert.equal(callsMade.length, 4);
    const results = entries.filter((e) => e.customType === "subagent_result");
    assert.equal(results.length, 4, "each direct child independently delivers its result");
    assert.equal(new Set(results.map((r) => r.details.sessionFile)).size, 4);
    const childSessions = new Map(
      results.map((r) => [r.details.name, parse(r.details.sessionFile)]),
    );
    for (const name of names) {
      const child = childSessions.get(name)!;
      assert.ok(
        child.some(
          (e) =>
            e.type === "model_change" &&
            e.provider === "openai-codex" &&
            e.modelId === "gpt-6.1-sol",
        ),
      );
      assert.ok(
        child.some((e) => e.type === "thinking_level_change" && e.thinkingLevel === "medium"),
      );
      assert.ok(
        JSON.stringify(results.find((r) => r.details.name === name)).includes(`RESULT_${name}`),
      );
    }
    const standalone = childSessions.get("Standalone39")!;
    const lineage = childSessions.get("Lineage39")!;
    const fork = childSessions.get("Fork39")!;
    assert.ok(!standalone[0].parentSession, "standalone has no parent ancestry");
    assert.equal(lineage[0].parentSession, parentSession);
    assert.equal(fork[0].parentSession, parentSession);
    assert.ok(!JSON.stringify(standalone).includes("PRIOR_CONTEXT_39"));
    assert.ok(!JSON.stringify(lineage).includes("PRIOR_CONTEXT_39"));
    assert.ok(
      JSON.stringify(fork).includes("PRIOR_CONTEXT_39"),
      "fork copies actual prior native parent context",
    );
    assert.ok(
      JSON.stringify(results.find((r) => r.details.name === "Standalone39")).includes(
        "SKILL_APPLIED_39",
      ),
      "configured skill influences the auto-exiting task result",
    );
    assert.ok(
      standalone.some(
        (e) =>
          e.type === "message" &&
          e.message.role === "user" &&
          JSON.stringify(e.message.content).includes(
            "Include SKILL_APPLIED_39 in your final result",
          ),
      ),
      "skill template expanded into native child conversation",
    );

    const nested = childSessions.get("Nested39")!;
    assert.match(
      results.find((r) => r.details.name === "Nested39").content,
      /RECONCILED_NESTED_55/,
    );
    for (const toolName of ["subagent_done", "caller_ping"]) {
      assert.ok(
        nested.some(
          (e) =>
            e.type === "message" &&
            e.message.role === "toolResult" &&
            e.message.toolName === toolName &&
            e.message.isError &&
            JSON.stringify(e.message.content).includes("Cannot exit while delegated children"),
        ),
        `${toolName} refuses exit through the native public tool while the leaf works`,
      );
    }
    assert.ok(
      nested.some(
        (e) =>
          e.type === "message" &&
          Array.isArray(e.message.content) &&
          e.message.content.some((c: any) => c.type === "toolCall" && c.name === "subagent"),
      ),
      "allowed nested public delegation called",
    );
    assert.ok(
      nested.some(
        (e) => e.customType === "subagent_result" && JSON.stringify(e).includes("RESULT_Leaf39"),
      ),
    );
    const launchResults = messages.filter(
      (m) => m.role === "toolResult" && m.toolName === "subagent",
    );
    const directPanes = launchResults.map(
      (m) => JSON.parse(readFileSync(m.details.sessionFile + ".capabilities.json", "utf8")).pane,
    );
    assert.ok(
      directPanes.every(Boolean),
      "native host capability snapshots identify all direct children",
    );
    assert.ok(
      observations.some((o) => directPanes.every((id) => o.panes.some((p: any) => p.id === id))),
      "all four direct native child panes coexist before completion",
    );
    const standaloneLaunch = launchResults.find((m) => m.details?.name === "Standalone39");
    const script = readFileSync(standaloneLaunch.details.launchScriptFile, "utf8");
    assert.match(script, /PI_DENY_TOOLS=.*subagent/);
    assert.match(script, /PI_SUBAGENT_SKILLS='native-proof'/);
    const standaloneCaps = JSON.parse(
      readFileSync(
        results.find((r) => r.details.name === "Standalone39").details.sessionFile +
          ".capabilities.json",
        "utf8",
      ),
    );
    assert.equal(standaloneCaps.cwd, childCwd);
    assert.ok(
      !standaloneCaps.allTools.includes("subagent"),
      "native forbidden nested delegation absent",
    );
    assert.deepEqual(
      standaloneCaps.activeTools.sort(),
      ["bash", "caller_ping", "read", "subagent_done"].sort(),
    );
    const nestedCaps = JSON.parse(
      readFileSync(
        results.find((r) => r.details.name === "Nested39").details.sessionFile +
          ".capabilities.json",
        "utf8",
      ),
    );
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
          configuredSkillInfluencesAutoexitResult: true,
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

/** Public native session receipts supply identities; public layout supplies geometry.
 * Failed runs deliberately retain their exact ownership file and native histories.
 */
async function proveBranchLayout({
  dir,
  project,
  workspace,
  pane,
  parentSession,
  delivered,
  json,
  herdr,
}: {
  dir: string;
  project: string;
  workspace: string;
  pane: string;
  parentSession: string;
  delivered: string;
  json: (args: string[]) => any;
  herdr: (args: string[]) => string;
}): Promise<void> {
  const deadline = Date.now() + 480_000;
  const parse = (path: string): any[] => {
    if (!existsSync(path)) return [];
    // A writer may be between append and newline when fs.watch fires.
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
  const awaitReceipt = (label: string, ready: () => boolean) =>
    new Promise<void>((resolve, reject) => {
      const watcher = watch(dir, { recursive: true }, check);
      const timer = setTimeout(
        () => {
          watcher.close();
          reject(
            new Error(
              `Timed out awaiting ${label}; retained ownership: ${join(dir, "ownership.json")}`,
            ),
          );
        },
        Math.max(1, deadline - Date.now()),
      );
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
  const launchReceipts = (sessionFile: string) =>
    parse(sessionFile)
      .filter((e) => e.type === "message")
      .map((e) => e.message)
      .filter((m) => m.role === "toolResult" && m.toolName === "subagent" && !m.isError);
  const resultReceipts = (sessionFile: string) =>
    parse(sessionFile).filter((e) => e.customType === "subagent_result");
  const nativeMapping = () => {
    const mapping: Record<string, { pane: string; session: string; parent: string | null }> = {
      Master: { pane, session: parentSession, parent: null },
    };
    const visit = (parent: string, sessionFile: string) => {
      for (const receipt of launchReceipts(sessionFile)) {
        const { name, sessionFile: childSession } = receipt.details;
        const caps = JSON.parse(readFileSync(childSession + ".capabilities.json", "utf8"));
        assert.equal(caps.role, layoutRole, `${name} uses the selected layout role`);
        if (manualLayout) assert.notEqual(caps.autoExit, "1", `${name} remains non-autoexit`);
        for (const tool of [
          "subagent",
          "subagent_interrupt",
          "subagents_list",
          "subagent_resume",
        ]) {
          assert.ok(
            caps.activeTools.includes(tool),
            `${name} exposes effective ${layoutRole} ${tool}`,
          );
        }
        mapping[name] = { pane: caps.pane, session: childSession, parent };
        visit(name, childSession);
      }
    };
    visit("Master", parentSession);
    return mapping;
  };
  const snapshots: any[] = [];
  const capture = (phase: string) => {
    const layout = json(["pane", "layout", "--pane", pane]).layout;
    const panes = json(["pane", "list", "--workspace", workspace]).panes;
    snapshots.push({ phase, at: Date.now(), layout, panes });
    writeFileSync(join(dir, "layout-observations.json"), JSON.stringify(snapshots, null, 2));
    return layout;
  };
  try {
    await awaitReceipt("four event-driven leaf workloads", () =>
      ["A1", "A2", "B1", "B2"].every((name) => existsSync(join(dir, `${name}.ready`))),
    );
    let mapping = nativeMapping();
    const names = ["Master", "A", "A1", "A2", "B", "B1", "B2"];
    assert.deepEqual(Object.keys(mapping).sort(), [...names].sort());
    assert.equal(new Set(names.map((name) => mapping[name].session)).size, 7);
    assert.equal(new Set(names.map((name) => mapping[name].pane)).size, 7);
    assert.deepEqual(
      launchReceipts(parentSession).map((r) => r.details.name),
      ["A", "B"],
    );
    for (const branch of ["A", "B"]) {
      assert.deepEqual(
        launchReceipts(mapping[branch].session).map((r) => r.details.name),
        [`${branch}1`, `${branch}2`],
        "accepted launches supply sibling order independently of completion",
      );
    }
    const full = capture("seven-live-panes");
    const focusedPane = full.focused_pane_id;
    assert.equal(focusedPane, pane, "nested launch never focuses a child");
    const assertGeometry = (layout: any, present: string[]) => {
      const rect = (name: string) => {
        const item = layout.panes.find((p: any) => p.pane_id === mapping[name].pane);
        assert.ok(item, `${name} remains in the task-owned tab`);
        assert.ok(
          item.rect.width >= 40 && item.rect.height >= 12,
          `${name} meets 40x12 capacity policy`,
        );
        return item.rect;
      };
      assert.equal(layout.zoomed, false);
      assert.equal(layout.focused_pane_id, focusedPane, "layout updates preserve pane focus");
      const master = rect("Master");
      const a = rect("A");
      const b = rect("B");
      assert.equal(master.y, layout.area.y);
      assert.equal(master.height, layout.area.height, "master keeps the full tab height");
      assert.equal(a.y, master.y, "A begins at the top of its column");
      assert.equal(b.y, master.y, "B begins at the top of its column");
      assert.ok(master.x + master.width <= a.x, "master stays left of branch A");
      assert.ok(a.x + a.width <= b.x, "accepted root branch order is A then B");
      for (const branch of ["A", "B"]) {
        const parent = rect(branch);
        let previous = parent;
        for (const leaf of (branch === "A" ? ["A1", "A1a", "A2"] : ["B1", "B2"]).filter((name) =>
          present.includes(name),
        )) {
          const child = rect(leaf);
          assert.equal(
            child.x,
            parent.x,
            `${leaf} belongs to its immediate parent's branch column`,
          );
          assert.equal(child.width, parent.width, `${leaf} shares the entire column width`);
          assert.ok(
            previous.y + previous.height <= child.y,
            `${leaf} follows accepted sibling order downward`,
          );
          previous = child;
        }
      }
      if (present.includes("C")) {
        const c = rect("C");
        assert.ok(b.x + b.width <= c.x, "later root branch C follows B as a distinct column");
        assert.equal(c.y, master.y, "later direct child begins at the top");
        assert.equal(c.height, master.height, "later direct child spans the tab height");
      }
    };
    assertGeometry(full, names);
    writeFileSync(join(dir, "native-mapping.json"), JSON.stringify(mapping, null, 2));
    writeFileSync(
      join(dir, "layout-ready.json"),
      JSON.stringify(
        {
          session,
          workspace,
          pane,
          mapping,
          geometry: "seven-live-panes",
          release: join(dir, "layout.release"),
          nativeVisualAcceptance: false,
        },
        null,
        2,
      ),
    );
    console.log(`Seven-pane geometry ready: ${join(dir, "layout-ready.json")}`);
    if (process.env.PI_HERDR_LAYOUT_HOLD === "1") {
      await awaitReceipt("explicit native-inspection release", () =>
        existsSync(join(dir, "layout.release")),
      );
    }
    writeFileSync(join(dir, "A1.release"), "deepen\n");
    await awaitReceipt("deeper autonomous worker workload", () =>
      existsSync(join(dir, "A1a.ready")),
    );
    mapping = nativeMapping();
    assert.equal(mapping.A1a.parent, "A1", "deeper result belongs to its immediate parent");
    const deepNames = [...names, "A1a"];
    assertGeometry(capture("deeper-generation"), deepNames);
    const cTask = `Run only this exact synthetic task. Do not inspect user files or modify code. Run exactly ${shellEscape(process.execPath)} ${shellEscape(join(dir, "layout-barrier.cjs"))} ${shellEscape(dir)} C using bash with timeout 430 seconds. After successful release ${layoutCompletion("RESULT_C")} Report any failure honestly.`;
    const cCall = { name: "C", agent: layoutRole, task: cTask, cwd: project };
    herdr([
      "agent",
      "prompt",
      pane,
      `Continue the same synthetic proof. Make exactly this additional public subagent call now: ${JSON.stringify(cCall)}. This is a later direct branch after grandchildren exist. Updated completion condition: end your turn normally and wait for ALL THREE direct child results A, B and C. Only after all three successful results arrive write exactly RECONCILED_A RESULT_A1 RESULT_A2 RECONCILED_B RESULT_B1 RESULT_B2 RESULT_C to ${shellEscape(delivered)} using bash. Do not poll, sleep, focus, interrupt, close panes or inspect sessions.`,
    ]);
    await awaitReceipt("later root branch C workload", () => existsSync(join(dir, "C.ready")));
    mapping = nativeMapping();
    assert.deepEqual(
      launchReceipts(parentSession).map((r) => r.details.name),
      ["A", "B", "C"],
    );
    const allNames = [...deepNames, "C"];
    assert.equal(new Set(allNames.map((name) => mapping[name].pane)).size, 9);
    assertGeometry(capture("later-root-column"), allNames);
    writeFileSync(join(dir, "native-mapping.json"), JSON.stringify(mapping, null, 2));
    // Finish the later sibling first in both branches, retaining each parent
    // and earlier sibling so the remaining branch structure is inspectable.
    for (const leaf of ["B2", "A2"]) {
      const parent = mapping[leaf].parent!;
      writeFileSync(join(dir, `${leaf}.release`), "release\n");
      await awaitReceipt(`${leaf} immediate-parent delivery`, () =>
        resultReceipts(mapping[parent].session).some((r) => r.details.name === leaf),
      );
      assert.equal(
        resultReceipts(parentSession).length,
        0,
        "master cannot receive grandchildren directly",
      );
      const remaining = capture(`after-${leaf}-completion`);
      assert.ok(
        !remaining.panes.some((p: any) => p.pane_id === mapping[leaf].pane),
        "completed leaf closes through managed ownership",
      );
      assertGeometry(
        remaining,
        leaf === "B2"
          ? allNames.filter((n) => n !== "B2")
          : allNames.filter((n) => !["B2", "A2"].includes(n)),
      );
    }
    for (const leaf of ["A1a", "B1", "C"]) writeFileSync(join(dir, `${leaf}.release`), "release\n");
    await awaitReceipt("all three reconciled root results", () => existsSync(delivered));
    assert.equal(
      readFileSync(delivered, "utf8").trim(),
      "RECONCILED_A RESULT_A1 RESULT_A2 RECONCILED_B RESULT_B1 RESULT_B2 RESULT_C",
    );
    const rootResults = resultReceipts(parentSession);
    assert.deepEqual(rootResults.map((r) => r.details.name).sort(), ["A", "B", "C"]);
    for (const branch of ["A", "B"]) {
      const results = resultReceipts(mapping[branch].session);
      assert.deepEqual(
        results.map((r) => r.details.name),
        [`${branch}2`, `${branch}1`],
        "completion order differs from accepted launch order",
      );
      assert.match(
        rootResults.find((r) => r.details.name === branch).content,
        new RegExp(`RECONCILED_${branch} RESULT_${branch}1 RESULT_${branch}2`),
      );
      assert.ok(
        existsSync(mapping[branch].session),
        "closed panes retain native conversation history",
      );
    }
    assert.deepEqual(
      resultReceipts(mapping.A1.session).map((r) => r.details.name),
      ["A1a"],
      "third-generation result is routed only to A1",
    );
    assert.match(rootResults.find((r) => r.details.name === "C").content, /RESULT_C/);
    if (manualLayout) {
      for (const name of allNames.filter((n) => n !== "Master")) {
        const entries = parse(mapping[name].session);
        const completions = entries
          .filter((e) => e.type === "message")
          .flatMap((e) => e.message.content ?? [])
          .filter((c) => c.type === "toolCall" && c.name === "subagent_done");
        assert.equal(completions.length, 1, `${name} explicitly completes exactly once`);
        const doneIndex = entries.findIndex(
          (e) =>
            e.type === "message" &&
            Array.isArray(e.message.content) &&
            e.message.content.some((c: any) => c.type === "toolCall" && c.name === "subagent_done"),
        );
        for (const result of resultReceipts(mapping[name].session)) {
          assert.ok(
            entries.findIndex((e) => e.id === result.id) < doneIndex,
            `${name} processes descendant results before explicit completion`,
          );
        }
      }
    }
    const final = capture("all-descendants-completed");
    assert.deepEqual(
      final.panes.map((p: any) => p.pane_id),
      [pane],
    );
    writeFileSync(
      join(dir, "result.json"),
      JSON.stringify(
        {
          bundledProof,
          role: layoutRole,
          completion: manualLayout
            ? "public subagent_done after descendant reconciliation"
            : "autonomous",
          sevenPaneGeometry: true,
          deeperGeneration: true,
          laterRootBranch: true,
          readable40x12: true,
          acceptedLaunchOrder: true,
          outOfOrderCompletion: true,
          immediateParentRouting: true,
          managedChildRemoval: true,
          retainedHistory: true,
          nativeVisualAcceptance: false,
          unproven: [
            "same-parent simultaneous public calls",
            "resume and recovery",
            "rendered native acceptance",
          ],
        },
        null,
        2,
      ),
    );
  } catch (error) {
    writeFileSync(
      join(dir, "layout-failure.json"),
      JSON.stringify(
        {
          error: String(error),
          retainedOwnership: join(dir, "ownership.json"),
          nativeVisualAcceptance: false,
        },
        null,
        2,
      ),
    );
    writeFileSync(
      join(dir, "parent-screen.txt"),
      herdr(["pane", "read", pane, "--source", "recent-unwrapped", "--lines", "160"]),
    );
    throw error;
  }
}
