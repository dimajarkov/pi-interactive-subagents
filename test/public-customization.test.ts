/** Public extension registration, discovery and native TUI component contracts.
 * The host API is a boundary fixture; these tests do not prove physical keys or pixels.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { initTheme } from "@mariozechner/pi-coding-agent";
import extension from "../pi-extension/subagents/index.ts";
import childExtension from "../pi-extension/subagents/subagent-done.ts";

function host() {
  const tools = new Map<string, any>();
  const commands = new Map<string, any>();
  const renderers = new Map<string, any>();
  const events = new Map<string, any[]>();
  const shortcuts = new Map<string, any>();
  const messages: string[] = [];
  const api: any = {
    on(name: string, handler: any) { events.set(name, [...(events.get(name) ?? []), handler]); },
    registerTool(tool: any) { tools.set(tool.name, tool); },
    registerCommand(name: string, command: any) { commands.set(name, command); },
    registerMessageRenderer(name: string, renderer: any) { renderers.set(name, renderer); },
    registerShortcut(name: string, shortcut: any) { shortcuts.set(name, shortcut); },
    sendUserMessage(message: string) { messages.push(message); },
    getAllTools() { return [...tools.values()]; },
  };
  return { api, tools, commands, renderers, events, shortcuts, messages };
}
const theme = { fg: (_: string, text: string) => text, bg: (_: string, text: string) => text, bold: (text: string) => text };
async function isolated(run: (dir: string) => Promise<void> | void) {
  const dir = mkdtempSync(join(tmpdir(), "pi-public-customization-"));
  const env = { ...process.env };
  const cwd = process.cwd();
  try {
    process.env.PI_CODING_AGENT_DIR = join(dir, "config");
    mkdirSync(join(dir, "config", "agents"), { recursive: true });
    mkdirSync(join(dir, ".pi", "agents"), { recursive: true });
    process.chdir(dir);
    delete process.env.PI_DENY_TOOLS;
    await run(dir);
  } finally { process.chdir(cwd); process.env = env; rmSync(dir, { recursive: true, force: true }); }
}
function agent(path: string, body: string) { writeFileSync(path, `---\n${body}\n---\nSynthetic definition.\n`); }

test("public discovery gives project precedence, global fallback and bundled fallback; hidden project override shadows bundled", async () => isolated(async dir => {
  agent(join(dir, "config", "agents", "worker.md"), "name: worker\ndescription: GLOBAL_WORKER");
  agent(join(dir, ".pi", "agents", "worker.md"), "name: worker\ndescription: PROJECT_WORKER\nmodel: openai-codex/gpt-6.1-sol\nthinking: medium\ntools: read\nskills: synthetic\nspawning: false\ndeny-tools: bash\nsession-mode: lineage-only\ninteractive: true");
  agent(join(dir, "config", "agents", "global-only.md"), "name: global-only\ndescription: GLOBAL_ONLY");
  agent(join(dir, ".pi", "agents", "scout.md"), "name: scout\ndisable-model-invocation: true");
  const h = host(); extension(h.api);
  const result = await h.tools.get("subagents_list").execute();
  const listed = result.details.agents;
  assert.equal(listed.find((a: any) => a.name === "worker").description, "PROJECT_WORKER");
  assert.equal(listed.find((a: any) => a.name === "worker").source, "project");
  assert.equal(listed.find((a: any) => a.name === "global-only").source, "global");
  assert.equal(listed.find((a: any) => a.name === "reviewer").source, "package");
  assert.ok(!listed.some((a: any) => a.name === "scout"));
  const worker = listed.find((a: any) => a.name === "worker");
  assert.deepEqual([worker.tools, worker.skills, worker.spawning, worker.denyTools, worker.sessionMode, worker.interactive, worker.thinking], ["read", "synthetic", false, "bash", "lineage-only", true, "medium"]);
  // Hidden is a model-discovery rule, not a prohibition on a user's explicit command.
  const notices: string[] = [];
  await h.commands.get("subagent").handler("scout explicit synthetic task", { ui: { notify: (text: string) => notices.push(text) } });
  assert.equal(notices.length, 0);
  assert.match(h.messages[0], /agent: "scout"/);
}));

test("child delegation restrictions remove denied registered tools while preserving allowed native completion tools", async () => isolated(() => {
  process.env.PI_DENY_TOOLS = "subagent, subagent_resume, subagents_list, subagent_interrupt";
  const h = host(); extension(h.api); childExtension(h.api);
  assert.deepEqual([...h.tools.keys()].sort(), ["caller_ping", "subagent_done"]);
  delete process.env.PI_DENY_TOOLS;
  const allowed = host(); extension(allowed.api); childExtension(allowed.api);
  assert.ok(allowed.tools.has("subagent"));
  assert.ok(allowed.tools.has("subagent_resume"));
}));

test("registered completion renderer expands full summary and native session reference", async () => isolated(() => {
  initTheme("dark", false);
  const h = host(); extension(h.api);
  const render = h.renderers.get("subagent_result");
  const message = { content: "ONE\nTWO\nTHREE\nFOUR\nFIVE\nSIX_UNIQUE", details: { name: "Synthetic", elapsed: 7, exitCode: 0, sessionFile: "/tmp/synthetic-native.jsonl" } };
  const collapsed = render(message, { expanded: false }, theme).render(100).join("\n");
  const expanded = render(message, { expanded: true }, theme).render(100).join("\n");
  assert.match(collapsed, /completed/);
  assert.match(collapsed, /1 more lines/);
  assert.ok(!collapsed.includes("SIX_UNIQUE"));
  assert.match(expanded, /SIX_UNIQUE/);
  assert.match(expanded, /Resume:  pi --session \/tmp\/synthetic-native.jsonl/);
}));

test("child widget toggle exposes effective tools and deny list; native activity events produce active and waiting snapshots", async () => isolated(async dir => {
  process.env.PI_SUBAGENT_NAME = "SyntheticChild";
  process.env.PI_SUBAGENT_ID = "synthetic-child-id";
  process.env.PI_SUBAGENT_ACTIVITY_FILE = join(dir, "activity.json");
  process.env.PI_DENY_TOOLS = "subagent";
  const h = host();
  h.tools.set("read", { name: "read" });
  childExtension(h.api);
  let widget: any;
  const ctx = { ui: { setWidget: (_name: string, component: any) => { widget = component; } } };
  const emit = (name: string, event: any = {}) => { for (const handler of h.events.get(name) ?? []) handler(event, ctx); };
  emit("session_start");
  assert.match(widget(null, theme).render(100).join("\n"), /SyntheticChild.*3 tools.*1 denied/);
  await h.shortcuts.get("ctrl+j").handler(ctx);
  const expanded = widget(null, theme).render(100).join("\n");
  assert.match(expanded, /caller_ping, read, subagent_done/);
  assert.match(expanded, /denied: subagent/);
  emit("agent_start");
  emit("tool_execution_start", { toolCallId: "synthetic-call", toolName: "read" });
  assert.equal(JSON.parse(readFileSync(join(dir, "activity.json"), "utf8")).phase, "active");
  emit("tool_execution_end", { toolCallId: "synthetic-call", toolName: "read" });
  emit("agent_end", { messages: [{ role: "assistant", stopReason: "stop" }] });
  const snapshot = JSON.parse(readFileSync(join(dir, "activity.json"), "utf8"));
  assert.equal(snapshot.phase, "waiting");
  assert.equal(snapshot.latestEvent, "agent_end");
}));

test("public background launches expose parent states and notify autonomous stall/recovery while suppressing interactive notices", async () => isolated(async dir => {
  // Stub only the external CLI/process boundary. No Pi child or real terminal is claimed.
  const cli = join(dir, "herdr");
  writeFileSync(cli, `#!/usr/bin/env node
const fs = require("node:fs");
let a = process.argv.slice(2); if (a[0] === "--session") a = a.slice(2);
const seq = process.env.TEST_SPLIT_COUNTER;
if (a[1] === "split") { const id = Number(fs.existsSync(seq) ? fs.readFileSync(seq,"utf8") : 0) + 1; fs.writeFileSync(seq, String(id)); console.log(JSON.stringify({result:{pane:{pane_id:"child-"+id, terminal_id:"terminal-"+id}}})); }
else if (a[1] === "get") console.log(JSON.stringify({result:{pane:{pane_id:a[2], terminal_id:"terminal-"+a[2].split("-")[1]}}}));
else if (a[1] === "rename") console.log(JSON.stringify({result:{}}));
else if (a[1] === "read") console.log("synthetic ongoing task");
`, { mode: 0o700 });
  process.env.PATH = `${dir}:${process.env.PATH}`;
  process.env.TEST_SPLIT_COUNTER = join(dir, "split-counter");
  process.env.HERDR_ENV = "1";
  process.env.HERDR_SESSION = "synthetic";
  process.env.HERDR_WORKSPACE_ID = "synthetic-workspace";
  process.env.HERDR_TAB_ID = "synthetic-tab";
  process.env.HERDR_PANE_ID = "synthetic-parent";
  process.env.PI_SUBAGENT_MUX = "herdr";
  process.env.PI_SUBAGENT_SHELL_READY_DELAY_MS = "0";
  const h = host();
  const delivered: any[] = [];
  h.api.sendMessage = (message: any, options: any) => delivered.push({ message, options });
  extension(h.api);
  const parentFile = join(dir, "parent.jsonl");
  writeFileSync(parentFile, JSON.stringify({ type: "session", id: "synthetic-parent-session", version: 3 }) + "\n");
  let widget: any;
  const ctx = {
    cwd: dir, hasUI: true,
    ui: { setWidget: (_name: string, component: any) => { widget = component; } },
    sessionManager: { getSessionFile: () => parentFile, getSessionId: () => "synthetic-parent-session", getSessionDir: () => dir },
  };
  const emit = (name: string) => { for (const fn of h.events.get(name) ?? []) fn({}, ctx); };
  const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
  const now = Date.now;
  let clock = now();
  Date.now = () => clock;
  try {
    emit("session_start");
    const spawn = h.tools.get("subagent").execute;
    const autonomous = await spawn("a", { name: "Autonomous", task: "Synthetic", interactive: false }, undefined, undefined, ctx);
    const interactive = await spawn("b", { name: "Interactive", task: "Synthetic", interactive: true }, undefined, undefined, ctx);
    assert.match(widget(null, theme).render(120).join("\n"), /starting/);
    await sleep(1100); // Establish the first missing-snapshot observation.
    clock += 61_000;
    await sleep(1100);
    const statuses = delivered.filter(d => d.message.customType === "subagent_status");
    assert.equal(statuses.length, 1);
    assert.match(statuses[0].message.content, /Autonomous/);
    assert.ok(!statuses[0].message.content.includes("Interactive"));
    assert.match(widget(null, theme).render(120).join("\n"), /stalled/);
    const childHost = host();
    process.env.PI_SUBAGENT_ID = autonomous.details.id;
    process.env.PI_SUBAGENT_ACTIVITY_FILE = join(dir, "synthetic-parent-session", "subagent-activity", `${autonomous.details.id}.json`);
    // Use the emitted launch script's public artifact path rather than private state.
    const script = readFileSync(autonomous.details.launchScriptFile, "utf8");
    const activity = script.match(/PI_SUBAGENT_ACTIVITY_FILE='([^']+)'/);
    assert.ok(activity, "launch script exposes native activity output path");
    process.env.PI_SUBAGENT_ACTIVITY_FILE = activity[1];
    childExtension(childHost.api);
    for (const fn of childHost.events.get("session_start") ?? []) fn({}, { ui: { setWidget() {} } });
    for (const fn of childHost.events.get("agent_start") ?? []) fn({}, {});
    await sleep(1100);
    assert.match(widget(null, theme).render(120).join("\n"), /active/);
    assert.ok(delivered.some(d => d.message.customType === "subagent_status" && d.message.content.includes("Autonomous") && /recovered|active/.test(d.message.content)));
    for (const fn of childHost.events.get("agent_end") ?? []) fn({ messages: [{ role: "assistant", stopReason: "stop" }] }, {});
    await sleep(1100);
    assert.match(widget(null, theme).render(120).join("\n"), /waiting/);
    assert.ok(delivered.filter(d => d.message.customType === "subagent_status").every(d => !d.message.content.includes("Interactive")));
    assert.equal(interactive.details.status, "started");
  } finally { emit("session_shutdown"); Date.now = now; }
}));


test("configured skills transform the initial task before its first autonomous turn", async () => isolated(async dir => {
  process.env.PI_SUBAGENT_SKILLS = "first,second";
  const first = join(dir, "first.md");
  const second = join(dir, "second.md");
  writeFileSync(first, "---\nname: first\ndescription: First synthetic skill.\n---\nAlways include FIRST_MARKER.");
  writeFileSync(second, "---\nname: second\ndescription: Second synthetic skill.\n---\nAlways include SECOND_MARKER.");
  const { default: skillsExtension } = await import("../pi-extension/subagents/initial-skills.ts");
  const h = host();
  h.api.getCommands = () => [
    { name: "skill:first", source: "skill", sourceInfo: { path: first } },
    { name: "skill:second", source: "skill", sourceInfo: { path: second } },
  ];
  skillsExtension(h.api);
  const input = h.events.get("input")![0];
  const result = await input({ text: "Perform TASK_MARKER.", images: undefined, source: "interactive" });
  assert.equal(result.action, "transform");
  assert.match(result.text, /FIRST_MARKER/);
  assert.match(result.text, /SECOND_MARKER/);
  assert.match(result.text, /References are relative to /);
  assert.ok(result.text.endsWith("Perform TASK_MARKER."));
  assert.doesNotMatch(result.text, /description:/);
  assert.deepEqual(await input({ text: "Human follow-up", source: "interactive" }), { action: "continue" });
}));


test("missing configured skill stops initial execution with an actionable error", async () => isolated(async dir => {
  process.env.PI_SUBAGENT_SKILLS = "missing";
  process.env.PI_SUBAGENT_SESSION = join(dir, "failed.jsonl");
  let shutdown = false;
  const { default: skillsExtension } = await import("../pi-extension/subagents/initial-skills.ts");
  const h = host();
  h.api.getCommands = () => [];
  skillsExtension(h.api);
  const notices: string[] = [];
  const result = await h.events.get("input")![0]({ text: "Do not execute without skill." }, { shutdown() { shutdown = true; }, ui: { notify: (text: string) => notices.push(text) } });
  assert.equal(shutdown, true);
  assert.deepEqual(JSON.parse(readFileSync(process.env.PI_SUBAGENT_SESSION + ".exit", "utf8")), { type: "error", errorMessage: "Configured subagent skill not found: missing", stopReason: "error" });
  assert.deepEqual(result, { action: "handled" });
  assert.match(notices[0], /Configured subagent skill not found: missing/);
}));


test("initial skill failure shuts down even when the parent error sidecar cannot be written", async () => isolated(async dir => {
  process.env.PI_SUBAGENT_SKILLS = "missing";
  process.env.PI_SUBAGENT_SESSION = join(dir, "failed.jsonl");
  // A directory at the sidecar path forces a real, portable filesystem write failure.
  mkdirSync(process.env.PI_SUBAGENT_SESSION + ".exit");
  let shutdown = false;
  const { default: skillsExtension } = await import("../pi-extension/subagents/initial-skills.ts");
  const h = host();
  h.api.getCommands = () => [];
  skillsExtension(h.api);
  const notices: string[] = [];
  const result = await h.events.get("input")![0]({ text: "Do not execute without skill." }, { shutdown() { shutdown = true; }, ui: { notify: (text: string) => notices.push(text) } });
  assert.equal(shutdown, true);
  assert.deepEqual(result, { action: "handled" });
  assert.match(notices[0], /Configured subagent skill not found: missing/);
  assert.match(notices[1], /Could not deliver skill error to parent/);
}));
