import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSurface, sendCommand, sendEscape, readScreenAsync, closeSurface } from "../pi-extension/subagents/cmux.ts";
let fixtureId = 0;

// Registered Pi tools and completion notifications are the public host seam.
// Only the external Herdr process is synthetic; this does not prove native pixels.
async function fixture(run: (h: any) => Promise<void>) {
  const dir = mkdtempSync(join(tmpdir(), "pi-herdr-failure-"));
  const original = { ...process.env };
  const events = new Map<string, any[]>();
  const tools = new Map<string, any>();
  const messages: any[] = [];
  const log = join(dir, "calls.jsonl");
  const state = join(dir, "state.json");
  writeFileSync(state, JSON.stringify({ sequence: 0, fail: "read" }));
  writeFileSync(join(dir, "herdr"), `#!/usr/bin/env node
const fs = require("node:fs");
let a = process.argv.slice(2); if (a[0] === "--session") a = a.slice(2);
fs.appendFileSync(process.env.FAILURE_LOG, JSON.stringify(a) + "\\n");
const p = process.env.FAILURE_STATE; const s = JSON.parse(fs.readFileSync(p));
if ([s.fail].flat().includes(a[1]) && (!s.failPane || s.failPane === a[2])) { if (s.lateSidecar) fs.writeFileSync(s.lateSidecar,JSON.stringify({type:"done"})); process.stderr.write(JSON.stringify({error:{code:a[1] === "close" ? "protected_close" : "pane_not_found"}})); process.exit(1); }
if (a[1] === "layout") console.log(JSON.stringify({result:{layout:{zoomed:!!s.zoomed}}}));
else if (a[1] === "split") { s.sequence++; fs.writeFileSync(p,JSON.stringify(s)); console.log(JSON.stringify({result:{pane:{pane_id:"child-"+s.sequence,terminal_id:"terminal-"+s.sequence,workspace_id:"workspace",tab_id:"tab"}}})); }
else if (a[1] === "get") console.log(JSON.stringify({result:{pane:{pane_id:a[2],terminal_id:"terminal-"+a[2].split("-")[1],workspace_id:s.moved ? "foreign-workspace" : "workspace",tab_id:"tab"}}}));
else if (["rename","close"].includes(a[1])) console.log(JSON.stringify({result:{}}));
else if (a[1] === "read") console.log("synthetic active child");
`, { mode: 0o700 });
  process.env.PATH = `${dir}:${original.PATH}`;
  Object.assign(process.env, { FAILURE_LOG: log, FAILURE_STATE: state, HERDR_ENV: "1", HERDR_SESSION: "fixture", HERDR_PANE_ID: "parent", HERDR_WORKSPACE_ID: "workspace", HERDR_TAB_ID: "tab", PI_SUBAGENT_MUX: "herdr", PI_SUBAGENT_SHELL_READY_DELAY_MS: "0", PI_CODING_AGENT_DIR: join(dir, "config") });
  delete process.env.PI_DENY_TOOLS;
  delete process.env.PI_SUBAGENT_NAME;
  mkdirSync(join(dir, "config"), { recursive: true });
  const parentFile = join(dir, "parent.jsonl");
  writeFileSync(parentFile, JSON.stringify({type:"session",id:"parent-session",version:3}) + "\n");
  const api: any = { on(name: string, fn: any) { events.set(name, [...(events.get(name) ?? []), fn]); }, registerTool(t: any) { tools.set(t.name, t); }, registerCommand() {}, registerMessageRenderer() {}, registerShortcut() {}, sendMessage(m: any) { messages.push(m); }, getAllTools() { return []; } };
  const ctx = { cwd: dir, hasUI: false, sessionManager: {getSessionFile: () => parentFile, getSessionId: () => "parent-session", getSessionDir: () => dir} };
  const { default: extension } = await import(`../pi-extension/subagents/index.ts?failure-fixture=${++fixtureId}`);
  extension(api);
  try {
    await run({dir, tools, ctx, messages, state, calls: () => readFileSync(log,"utf8").trim().split("\n").map(l => JSON.parse(l)), configure: (options: object) => writeFileSync(state,JSON.stringify({...JSON.parse(readFileSync(state,"utf8")),...options}))});
  } finally {
    for (const fn of events.get("session_shutdown") ?? []) await fn({}, ctx);
    await new Promise(r => setTimeout(r, 100));
    process.env = original;
    rmSync(dir, {recursive:true,force:true});
  }
}
async function result(h: any) {
  const end = Date.now() + 2500;
  while (Date.now() < end) { const m = h.messages.find((m: any) => m.customType === "subagent_result"); if (m) return m; await new Promise(r => setTimeout(r,25)); }
  assert.fail("Herdr failure must notify the parent rather than strand its watcher");
}
const spawn = (h: any) => h.tools.get("subagent").execute("call", {name:"FailureChild",task:"Synthetic no-provider task"}, undefined,undefined,h.ctx);

test("a missing Herdr pane produces a parent lifecycle failure without an exit sidecar", async () => fixture(async h => {
  await spawn(h);
  const m = await result(h);
  assert.match(m.content, /Herdr read failed.*pane_not_found/);
  assert.equal(m.details.exitCode,1);
}));


test("a read failure also reports protected cleanup rejection without retrying another pane", async () => fixture(async h => {
  h.configure({fail:["read","close"]});
  await spawn(h);
  const m = await result(h);
  assert.match(m.content, /Herdr read failed.*pane_not_found/);
  assert.match(m.content, /cleanup.*protected_close/i);
  assert.ok(h.calls().filter((a: string[]) => a[1] === "close").every((a: string[]) => a[2] === "child-1"));
}));

test("completed child summary survives protected cleanup rejection and no close retry is issued", async () => fixture(async h => {
  h.configure({fail:"close"});
  const started = await spawn(h);
  const session = started.details.sessionFile;
  writeFileSync(session, JSON.stringify({type:"message",message:{role:"assistant",content:[{type:"text",text:"CHILD_RESULT_42"}]}}) + "\n");
  writeFileSync(session + ".exit", JSON.stringify({type:"done"}));
  const m = await result(h);
  assert.match(m.content,/CHILD_RESULT_42/);
  assert.match(m.content,/cleanup.*protected_close/i);
  assert.equal(h.calls().filter((a: string[]) => a[1] === "close").length,1);
}));

test("run failure after split closes only its launch-owned child and preserves protected cleanup diagnostic", async () => fixture(async h => {
  h.configure({fail:["run","close"]});
  await assert.rejects(() => spawn(h), /Herdr run failed.*Cleanup failed.*protected_close/s);
  const closes = h.calls().filter((a: string[]) => a[1] === "close");
  assert.deepEqual(closes.map((a: string[]) => a[2]),["child-1"]);
  assert.ok(!h.calls().some((a: string[]) => ["focus","zoom","move"].includes(a[1])));
}));

test("resume launch failure closes only the new child rather than the original session pane", async () => fixture(async h => {
  h.configure({fail:"run"});
  const sessionPath = join(h.dir,"resume.jsonl");
  writeFileSync(sessionPath, JSON.stringify({type:"session",id:"resume",version:3}) + "\n");
  await assert.rejects(() => h.tools.get("subagent_resume").execute("resume",{sessionPath,name:"ResumeFailure"},undefined,undefined,h.ctx),/Herdr run failed/);
  assert.deepEqual(h.calls().filter((a: string[]) => a[1] === "close").map((a: string[]) => a[2]),["child-1"]);
}));


test("a moved owned child rejects input, interruption, read and closure instead of following its occupant", async () => fixture(async h => {
  h.configure({fail:null});
  const pane = createSurface("Moved",h.dir);
  h.configure({moved:true});
  assert.throws(() => sendCommand(pane,"UNRELATED_INPUT_42"),/stale|moved|replaced/);
  assert.throws(() => sendEscape(pane),/stale|moved|replaced/);
  await assert.rejects(() => readScreenAsync(pane),/stale|moved|replaced/);
  assert.throws(() => closeSurface(pane),/stale|moved|replaced/);
  assert.ok(!h.calls().some((a: string[]) => ["run","send-keys","read","close"].includes(a[1])));
  h.configure({moved:false});
  closeSurface(pane);
}));


test("a sidecar arriving during terminal read failure wins over the read error", async () => fixture(async h => {
  h.configure({fail:null});
  const started = await spawn(h);
  writeFileSync(started.details.sessionFile, JSON.stringify({type:"message",message:{role:"assistant",content:[{type:"text",text:"LATE_RESULT_42"}]}}) + "\n");
  h.configure({fail:"read",lateSidecar:started.details.sessionFile + ".exit"});
  const m = await result(h);
  assert.match(m.content,/LATE_RESULT_42/);
  assert.equal(m.details.exitCode,0);
}));

test("parallel child failure and completion keep independent ownership and result notifications", async () => fixture(async h => {
  h.configure({fail:"read",failPane:"child-1"});
  const first = await spawn(h);
  const second = await spawn(h);
  assert.notEqual(first.details.sessionFile,second.details.sessionFile);
  writeFileSync(second.details.sessionFile, JSON.stringify({type:"message",message:{role:"assistant",content:[{type:"text",text:"SECOND_CHILD_RESULT_42"}]}}) + "\n");
  writeFileSync(second.details.sessionFile + ".exit",JSON.stringify({type:"done"}));
  const end = Date.now() + 2500;
  while (h.messages.filter((m: any) => m.customType === "subagent_result").length < 2 && Date.now() < end) await new Promise(r=>setTimeout(r,25));
  const messages=h.messages.filter((m: any) => m.customType === "subagent_result");
  assert.equal(messages.length,2);
  assert.ok(messages.some((m: any) => /Herdr read failed/.test(m.content)));
  assert.ok(messages.some((m: any) => /SECOND_CHILD_RESULT_42/.test(m.content)));
  assert.deepEqual(h.calls().filter((a: string[])=>a[1]==="close").map((a: string[])=>a[2]).sort(),["child-1","child-2"]);
}));


test("existing zoom refuses background launch before creating or changing layout", async () => fixture(async h => {
  h.configure({fail:null,zoomed:true});
  assert.throws(() => createSurface("Zoom",h.dir),/zoom.*unzoom|unzoom.*zoom/i);
  assert.ok(!h.calls().some((a: string[]) => ["split","zoom","focus","close"].includes(a[1])));
}));

test("resumed completion preserves new summary and cleanup rejection in its parent notification", async () => fixture(async h => {
  h.configure({fail:"close"});
  const sessionPath = join(h.dir,"resume-complete.jsonl");
  writeFileSync(sessionPath,JSON.stringify({type:"session",id:"resume",version:3}) + "\n");
  await h.tools.get("subagent_resume").execute("resume",{sessionPath,name:"ResumeCleanup"},undefined,undefined,h.ctx);
  writeFileSync(sessionPath, readFileSync(sessionPath,"utf8") + JSON.stringify({type:"message",message:{role:"assistant",content:[{type:"text",text:"RESUMED_RESULT_42"}]}}) + "\n");
  writeFileSync(sessionPath + ".exit",JSON.stringify({type:"done"}));
  const m = await result(h);
  assert.match(m.content,/RESUMED_RESULT_42/);
  assert.match(m.content,/cleanup.*protected_close/i);
  assert.equal(h.calls().filter((a: string[])=>a[1]==="close").length,1);
}));

test("unavailable exact specialist models fail before creating a child and never substitute parent defaults", async () => fixture(async h => {
  h.configure({fail:null});
  h.ctx.modelRegistry = {find: () => undefined};
  await assert.rejects(() => h.tools.get("subagent").execute("planner",{name:"Planner",agent:"planner",task:"Plan synthetic work"},undefined,undefined,h.ctx), /Requested model openai-codex\/gpt-6-astra is unavailable.*no substitution/i);
  assert.equal(JSON.parse(readFileSync(h.state,"utf8")).sequence,0);
}));

test("all five specialist launches pass their exact medium model to Pi without mutating the parent", async () => fixture(async h => {
  h.configure({fail:null});
  const parentModel = {provider:"openai-codex",id:"gpt-6.1-sol",thinking:"xhigh"};
  h.ctx.model = parentModel;
  h.ctx.modelRegistry = {find: () => ({})};
  for (const [role, phase] of [["planner","Planning"],["scout","Investigation"],["worker","Execution"],["reviewer","Review"],["visual-tester","Visual QA"]]) {
    const r = await h.tools.get("subagent").execute(role,{name:`${phase}: ${role}`,agent:role,task:"Synthetic role task"},undefined,undefined,h.ctx);
    const script = readFileSync(r.details.launchScriptFile,"utf8");
    assert.match(script, new RegExp(`--model 'openai-codex/${role === "planner" ? "gpt-6-astra" : "gpt-6\\.1-sol"}:medium'`));
    assert.ok(!script.includes("exec claude"));
    if (role === "worker") assert.match(script, /--tools '[^']*\btodo\b/);
    assert.ok(h.calls().some((a: string[]) => a[1] === "rename" && a[3] === `${phase}: ${role}`));
    writeFileSync(r.details.sessionFile + ".exit",JSON.stringify({type:"done"}));
  }
  assert.deepEqual(h.ctx.model,{provider:"openai-codex",id:"gpt-6.1-sol",thinking:"xhigh"});
  assert.ok(h.calls().filter((a: string[]) => a[1] === "rename").every((a: string[]) => a[2].startsWith("child-")));
}));
