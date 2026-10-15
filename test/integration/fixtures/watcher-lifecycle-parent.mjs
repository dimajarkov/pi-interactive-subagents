import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { writeFileSync, appendFileSync, readFileSync } from "node:fs";
import assert from "node:assert/strict";
const b = process.env.PI_LIFECYCLE_TEST_ROOT;
if (!b || !process.env.PI_LIFECYCLE_TEST_AGENT_DIR)
  throw Error("Missing isolated native lifecycle test environment");
const pi = spawn(
  "/Users/dmitrijarkov/.local/bin/pi",
  [
    "--mode",
    "rpc",
    "--session",
    b + "/before.jsonl",
    "--model",
    "openai-codex/gpt-6.1-sol",
    "--thinking",
    "medium",
  ],
  {
    cwd: b + "/project",
    env: {
      ...process.env,
      PI_CODING_AGENT_DIR: process.env.PI_LIFECYCLE_TEST_AGENT_DIR,
      PI_SUBAGENT_MUX: "herdr",
      PI_TELEMETRY: "0",
    },
    stdio: ["pipe", "pipe", "pipe"],
  },
);
writeFileSync(
  b + "/parent-process.json",
  JSON.stringify({ pid: pi.pid, pane: process.env.HERDR_PANE_ID }),
  { mode: 0o600 },
);
let phase = "single",
  sessionFile,
  finalSeen = false,
  pending = false,
  finished = false;
const send = (x) => {
  appendFileSync(b + "/requests.jsonl", JSON.stringify(x) + "\n", { mode: 0o600 });
  pi.stdin.write(JSON.stringify(x) + "\n");
};
function audit() {
  const es = readFileSync(sessionFile, "utf8").trim().split("\n").map(JSON.parse),
    rs = es.filter((e) => e.customType === "subagent_result");
  assert.equal(rs.length, phase === "single" ? 1 : 4);
  assert.ok(rs.every((r) => r.details.exitCode === 0));
  for (const r of rs) {
    assert.ok(r.content.includes(phase === "single" ? "NATIVE_SINGLE_12" : "NATIVE_PARALLEL_"));
    const cs = readFileSync(r.details.sessionFile, "utf8").trim().split("\n").map(JSON.parse);
    assert.ok(
      cs.some(
        (e) =>
          e.type === "model_change" && e.provider === "openai-codex" && e.modelId === "gpt-6.1-sol",
      ),
    );
    assert.ok(cs.some((e) => e.type === "thinking_level_change" && e.thinkingLevel === "medium"));
  }
  writeFileSync(
    b + "/" + phase + "-pass.json",
    JSON.stringify({ sessionFile, results: rs }, null, 2),
    { mode: 0o600 },
  );
}
createInterface({ input: pi.stdout }).on("line", (line) => {
  appendFileSync(b + "/events.jsonl", line + "\n", { mode: 0o600 });
  let e;
  try {
    e = JSON.parse(line);
  } catch {
    return;
  }
  try {
    if (e.type === "response" && e.id === "commands") {
      assert.ok(e.success);
      send({ id: "replace-single", type: "new_session" });
    }
    if (e.type === "response" && e.id === "replace-" + phase) {
      assert.ok(e.success && !e.data.cancelled);
      send({ id: "state-" + phase, type: "get_state" });
    }
    if (e.type === "response" && e.id === "state-" + phase) {
      assert.ok(e.success);
      sessionFile = e.data.sessionFile;
      writeFileSync(b + "/" + phase + "-state.json", JSON.stringify(e.data));
      const task =
        phase === "single"
          ? "Call subagent exactly once with name SingleAfterNew, agent scout, cwd " +
            b +
            '/project, task "Read fixture.txt only and return NATIVE_SINGLE_12". Wait for the actual result, then reply exactly SINGLE_COMPLETE.'
          : "Call the public subagent tool four times to launch scout agents named Parallel1, Parallel2, Parallel3 and Parallel4, each with cwd " +
            b +
            '/project. Each child task is "Read fixture.txt, run bash sleep 20, then return NATIVE_PARALLEL_N_12", replacing N with that child number. Acknowledge all four launches before waiting for their independent results. After receiving all four actual results, reply exactly PARALLEL_COMPLETE.';
      send({
        id: "prompt-" + phase,
        type: "prompt",
        message:
          "Synthetic acceptance after native session replacement. Use only the synthetic fixture, do not inspect or modify user files. If a child fails, report INFRA_BLOCKED and do not retry or replace delegated work with local findings. " +
          task,
      });
    }
    if (e.type === "message_end" && e.message?.role === "assistant") {
      if (e.message.content?.some((c) => c.type === "text" && c.text.includes("INFRA_BLOCKED"))) {
        throw Error("Native child infrastructure failed");
      }
      if (
        e.message.content?.some(
          (c) =>
            c.type === "text" &&
            c.text.trim() === (phase === "single" ? "SINGLE_COMPLETE" : "PARALLEL_COMPLETE"),
        )
      )
        finalSeen = true;
    }
    if (e.type === "response" && e.id === "idle") {
      pending = false;
      if (!finalSeen || !e.success || e.data.isStreaming || e.data.pendingMessageCount !== 0)
        return;
      audit();
      if (phase === "single") {
        phase = "parallel";
        finalSeen = false;
        send({ id: "replace-parallel", type: "new_session" });
      } else {
        finished = true;
        writeFileSync(
          b + "/complete.json",
          JSON.stringify({
            nativeSingle: true,
            nativeFourParallel: true,
            afterNativeSessionReplacement: true,
            parentPid: pi.pid,
          }),
          { mode: 0o600 },
        );
        clearInterval(timer);
      }
    }
  } catch (error) {
    writeFileSync(b + "/failure.txt", String(error), { mode: 0o600 });
    finished = true;
    clearInterval(timer);
  }
});
pi.stderr.on("data", (data) => appendFileSync(b + "/stderr.txt", data, { mode: 0o600 }));
pi.on("exit", (code, signal) =>
  writeFileSync(b + "/exit.json", JSON.stringify({ code, signal, finished }), { mode: 0o600 }),
);
const timer = setInterval(() => {
  if (finalSeen && !pending && !finished) {
    pending = true;
    send({ id: "idle", type: "get_state" });
  }
}, 500);
send({ id: "commands", type: "get_commands" });
