import { test } from "node:test";
import assert from "node:assert/strict";
import { homedir } from "node:os";
import { once } from "node:events";
import { startOwner } from "../scripts/qa/chrome-owner.mjs";

test("invalid owner admission cannot allocate or launch a browser", async () => {
  let effects = 0;
  const deps = {
    platform: "darwin",
    env: { HERDR_ENV: "1", HERDR_SESSION: "handovers" },
    cwd: "/repo",
    sourceRoot: "/repo",
    preflight() {
      effects++;
    },
  };
  for (const argv of [
    [],
    ["--task", "bad;command"],
    ["--task", "proof", "--url", "https://example.org"],
    ["--task", "proof", "--receipt", "old"],
  ]) {
    await assert.rejects(startOwner(argv, deps), /task|option/i);
  }
  await assert.rejects(startOwner(["--task", "proof"], { ...deps, platform: "linux" }), /macOS/);
  await assert.rejects(startOwner(["--task", "proof"], { ...deps, cwd: "/other" }), /physical/);
  await assert.rejects(
    startOwner(["--task", "proof"], {
      ...deps,
      env: { HERDR_ENV: "1", HERDR_SESSION: "handovers", CHROME_BIN: "/foreign" },
    }),
    /override/,
  );
  assert.equal(effects, 0);
});

function fixtureDeps(
  pages:
    | string
    | ((args: any) => string) = "pages[1]{id,url,selected}:\n  1,http://127.0.0.1:41001/,true",
) {
  const calls: any[] = [];
  let port = 41001;
  const deps: any = {
    platform: "darwin",
    env: { HERDR_ENV: "1", HERDR_SESSION: "handovers" },
    cwd: "/repo",
    sourceRoot: "/repo",
    now: () => 1000,
    preflight() {
      return { workspace: "w1" };
    },
    createState() {
      return {
        directory: "/private/state",
        profile: "/private/state/profile",
        token: "UNIQUE_TOKEN",
        session: "pi41_unique",
      };
    },
    async startFixture() {
      return {
        port: 41001,
        close() {
          calls.push(["closeFixture"]);
        },
      };
    },
    async reservePort() {
      return ++port;
    },
    checkFixture: async () => 200,
    recordPages(stage: any, output: any) {
      calls.push(["recordPages", stage, output]);
    },
    prepareProfile() {
      calls.push(["profile"]);
    },
    assertFreshSession() {
      calls.push(["freshSession"]);
    },
    launchChrome(args: any) {
      calls.push(["launch", args]);
      return { pid: 12345 };
    },
    verifyChrome() {
      calls.push(["verifyChrome"]);
    },
    verifyBridge() {
      calls.push(["verifyBridge"]);
    },
    cli(args: any, state: any) {
      calls.push(["cli", args, state.session]);
      return typeof pages === "function" ? pages(args) : pages;
    },
    save(state: any) {
      calls.push(["save", state.phase]);
    },
    sleep: async () => {},
    timeoutMs: 1,
  };
  return { deps, calls };
}

test("fresh owned fixture attaches upstream named session without removed guard APIs", async () => {
  const { deps, calls } = fixtureDeps();
  const owner = await startOwner(["--task", "proof"], deps);
  assert.equal(owner.state.phase, "ready");
  assert.equal(owner.state.profile, "/private/state/profile");
  assert.deepEqual(calls.find((x) => x[0] === "launch")[1], [
    "--user-data-dir=/private/state/profile",
    "--remote-debugging-port=41002",
    "--remote-debugging-address=127.0.0.1",
    "--disable-sync",
    "--disable-extensions",
    "--use-mock-keychain",
    "--password-store=basic",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-features=PreloadTopChromeWebUI",
    "http://127.0.0.1:41001/",
  ]);
  assert.deepEqual(
    calls.find((x) => x[0] === "cli"),
    ["cli", ["pages"], "pi41_unique"],
  );
  assert.ok(
    calls.findIndex((x) => x[0] === "verifyChrome") < calls.findIndex((x) => x[0] === "cli"),
  );
  assert.ok(
    calls.findIndex((x) => x[0] === "freshSession") < calls.findIndex((x) => x[0] === "cli"),
  );
  assert.equal(calls.filter((x) => x[0] === "verifyChrome").length, 2);
});

test("preexisting upstream state refuses before CLI can reuse or terminate it", async () => {
  const { deps, calls } = fixtureDeps();
  deps.assertFreshSession = () => {
    throw new Error("Existing session");
  };
  await assert.rejects(startOwner(["--task", "proof"], deps), /Existing session/);
  assert.equal(
    calls.some((x) => x[0] === "cli" || x[0] === "launch"),
    false,
  );
});

test("upstream success cannot admit a foreign, malformed or multiple fixture page", async () => {
  for (const pages of [
    "status: ready",
    "pages[1]{id,url,selected}:\n  1,http://127.0.0.1:41001.evil/,true",
    "pages[1]{id,url,selected}:\n  1,http://127.0.0.1:41001/,unknown",
    "pages[2]{id,url,selected}:\n  1,http://127.0.0.1:41001/,true\n  2,https://example.org/,false",
  ]) {
    const { deps, calls } = fixtureDeps(pages);
    await assert.rejects(startOwner(["--task", "proof"], deps), /fixture page/);
    assert.equal(
      calls.some((x) => x[0] === "save" && x[1] === "ready"),
      false,
    );
    assert.equal(calls.filter((x) => x[0] === "closeFixture").length, 1);
  }
});

test("ownership timeout retains profile and never invokes upstream or deletes resources", async () => {
  const { deps, calls } = fixtureDeps();
  let time = 1000;
  deps.now = () => time;
  deps.sleep = async () => {
    time += 5;
  };
  deps.verifyChrome = () => {
    throw Object.assign(new Error("Listener not ready"), { retryable: true });
  };
  let state: any;
  await assert.rejects(startOwner(["--task", "proof"], deps), (error: any) => {
    state = error.state;
    return /timeout/.test(error.message);
  });
  assert.equal(state.pid, 12345);
  assert.equal(state.phase, "blocked");
  assert.equal(state.profile, "/private/state/profile");
  assert.equal(
    calls.some((x) => x[0] === "cli"),
    false,
  );
  assert.equal(calls.filter((x) => x[0] === "closeFixture").length, 1);
});

test("owner interruption closes only its own synthetic fixture", async () => {
  const { deps, calls } = fixtureDeps();
  const owner = await startOwner(["--task", "proof"], deps);
  await owner.closeFixture();
  assert.equal(calls.filter((x) => x[0] === "closeFixture").length, 1);
  assert.equal(
    calls.some((x) => x[0] === "kill" || x[0] === "delete"),
    false,
  );
  assert.equal(owner.state.phase, "retained");
});

test("synthetic HTTP fixture cannot serve local files or nonlocal routes", async () => {
  const { startFixture } = await import("../scripts/qa/chrome-owner.mjs");
  const fixture = await startFixture("TEST_TOKEN_123");
  try {
    assert.equal(fixture.host, "127.0.0.1");
    const root = await fetch(`http://127.0.0.1:${fixture.port}/`);
    const body = await root.text();
    assert.equal(root.status, 200);
    assert.match(body, /TEST_TOKEN_123/);
    assert.match(body, /Fabricated QA account/);
    assert.match(root.headers.get("content-security-policy")!, /connect-src 'none'/);
    assert.equal((await fetch(`http://127.0.0.1:${fixture.port}/etc/passwd`)).status, 404);
    assert.equal(
      (await fetch(`http://127.0.0.1:${fixture.port}/`, { method: "POST" })).status,
      405,
    );
  } finally {
    await fixture.close();
  }
});

test("owned Chrome exit before admission cannot become ready", async () => {
  const { deps, calls } = fixtureDeps();
  deps.launchChrome = (_args: any, state: any) => {
    state.chromeExited = true;
    return { pid: 12345 };
  };
  await assert.rejects(startOwner(["--task", "proof"], deps), /exited/);
  assert.equal(
    calls.some((x) => x[0] === "save" && x[1] === "ready"),
    false,
  );
});

test("caller identity rejects borrowed pane IDs and coding-agent owner panes", async () => {
  const { verifyHerdrCaller } = await import("../scripts/qa/chrome-owner.mjs");
  const env = {
    HERDR_SESSION: "handovers",
    HERDR_WORKSPACE_ID: "w1",
    HERDR_TAB_ID: "w1:t1",
    HERDR_PANE_ID: "w1:p1",
  };
  const pane = {
    pane_id: "w1:p1",
    workspace_id: "w1",
    tab_id: "w1:t1",
    cwd: "/repo",
    foreground_cwd: "/repo",
  };
  const info = { pane_id: "w1:p1", shell_pid: 10, foreground_processes: [{ pid: 20 }] };
  assert.equal(verifyHerdrCaller(pane, info, env, "/repo", 20).owner, 20);
  for (const changed of [
    { ...pane, pane_id: "w2:p1" },
    { ...pane, cwd: "/foreign" },
    { ...pane, agent: "pi" },
  ])
    assert.throws(() => verifyHerdrCaller(changed, info, env, "/repo", 20), /unverified/);
  assert.throws(
    () =>
      verifyHerdrCaller(pane, { ...info, foreground_processes: [{ pid: 99 }] }, env, "/repo", 20),
    /unverified/,
  );
});

test("fixed Chrome spawn isolates signals without unreferencing its owned handle", async () => {
  const { launchOwnedChrome } = await import("../scripts/qa/chrome-owner.mjs");
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "pi-owner-spawn-test-"));
  let invocation: any;
  let unreferenced = false;
  const handle = {
    pid: 23456,
    once() {
      return this;
    },
    unref() {
      unreferenced = true;
    },
  };
  const result = launchOwnedChrome(
    ["--disable-features=PreloadTopChromeWebUI", "about:blank"],
    { cwd: "/repo", env: {}, log: join(dir, "chrome.log") },
    (file: any, args: any, options: any) => {
      invocation = { file, args, options };
      return handle;
    },
  );
  assert.equal(result, handle);
  assert.equal(
    invocation.file,
    join(
      homedir(),
      "Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
    ),
  );
  assert.equal(invocation.options.detached, true);
  assert.equal(unreferenced, false);
});

test("feature configuration cannot be supplied through the owner CLI", async () => {
  const { deps, calls } = fixtureDeps();
  for (const extra of [
    ["--disable-features=PreloadTopChromeWebUI"],
    ["--disable-features=OtherFeature"],
    ["--disable-features=PreloadTopChromeWebUI,OtherFeature"],
    ["--disable-features=PreloadTopChromeWebUI", "--disable-features=PreloadTopChromeWebUI"],
    ["--disable-features=PreloadTopChromeWebUI", "--enable-features=PreloadTopChromeWebUI"],
  ])
    await assert.rejects(startOwner(["--task", "proof", ...extra], deps), /task|option/i);
  assert.equal(calls.length, 0, "reject caller feature overrides before allocation or launch");
});

test("fixed Chrome spawn rejects absent, arbitrary, duplicate and conflicting feature controls", async () => {
  const { launchOwnedChrome } = await import("../scripts/qa/chrome-owner.mjs");
  let spawns = 0;
  for (const featureArgs of [
    [],
    ["--disable-features=OtherFeature"],
    ["--disable-features=PreloadTopChromeWebUI,OtherFeature"],
    ["--disable-features=PreloadTopChromeWebUI", "--disable-features=PreloadTopChromeWebUI"],
    ["--disable-features=PreloadTopChromeWebUI", "--enable-features=PreloadTopChromeWebUI"],
    ["--disable-features", "PreloadTopChromeWebUI"],
    ["--disable-features=PreloadTopChromeWebUI", "--enable-features=OtherFeature"],
  ])
    assert.throws(
      () =>
        launchOwnedChrome(
          [...featureArgs, "about:blank"],
          { cwd: "/repo", env: {}, log: "/must-not-be-opened/chrome.log" },
          () => {
            spawns++;
          },
        ),
      /fixed QA feature/i,
    );
  assert.equal(spawns, 0);
});

test("upstream environment binds only fresh named session and explicit owned endpoint", async () => {
  const { upstreamEnvironment } = await import("../scripts/qa/chrome-owner.mjs");
  const env = upstreamEnvironment(
    {
      PATH: "/bin",
      CHROME_DEVTOOLS_AXI_AUTO_CONNECT: "1",
      CHROME_DEVTOOLS_AXI_MCP_SERVER_URL: "https://foreign",
      CHROME_DEVTOOLS_AXI_USER_DATA_DIR: "/personal",
    },
    { session: "pi41_new", bridgePort: 42001, port: 42002 },
    "/declared/mcp.js",
  );
  assert.deepEqual(env, {
    PATH: "/bin",
    CHROME_DEVTOOLS_AXI_SESSION: "pi41_new",
    CHROME_DEVTOOLS_AXI_PORT: "42001",
    CHROME_DEVTOOLS_AXI_BROWSER_URL: "http://127.0.0.1:42002",
    CHROME_DEVTOOLS_AXI_MCP_PATH: "/declared/mcp.js",
  });
});

test("owned process verification rejects replacement and nonexclusive or nonloopback listeners", async () => {
  const { verifyProcess } = await import("../scripts/qa/chrome-owner.mjs");
  const expected = {
    pid: 42,
    parent: 10,
    uid: 501,
    birth: "Thu Oct 15 12:00:00 2026",
    command: "/owned/chrome --user-data-dir=/private/task/profile",
    port: 42002,
  };
  const good = { ...expected, listener: "p42\nn127.0.0.1:42002" };
  assert.doesNotThrow(() => verifyProcess(good, expected));
  for (const patch of [
    { pid: 43 },
    { parent: 99 },
    { uid: 502 },
    { birth: "Fri Oct 16 12:00:00 2026" },
    { command: "/foreign/chrome" },
    { listener: "p42\nn*:42002" },
    { listener: "p42\nn127.0.0.1:42002\np99\nn127.0.0.1:42002" },
    { listener: "" },
  ])
    assert.throws(() => verifyProcess({ ...good, ...patch }, expected), /identity|listener/);
});

test("private task profile refuses replacement, symlink and public permissions", async () => {
  const { verifyPrivateProfile } = await import("../scripts/qa/chrome-owner.mjs");
  const { mkdtempSync, mkdirSync, lstatSync, chmodSync, symlinkSync, rmSync } =
    await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "pi41-profile-test-"));
  const profile = join(dir, "profile");
  mkdirSync(profile, { mode: 0o700 });
  const inode = lstatSync(profile).ino;
  try {
    assert.doesNotThrow(() => verifyPrivateProfile(profile, inode, process.getuid!()));
    assert.throws(() => verifyPrivateProfile(profile, inode + 1, process.getuid!()), /profile/);
    chmodSync(profile, 0o755);
    assert.throws(() => verifyPrivateProfile(profile, inode, process.getuid!()), /profile/);
    chmodSync(profile, 0o700);
    symlinkSync(profile, join(dir, "link"));
    assert.throws(
      () => verifyPrivateProfile(join(dir, "link"), inode, process.getuid!()),
      /profile/,
    );
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test(
  "real owned Node process and IPv4 socket satisfy OS probe, then fail after exit",
  { skip: process.platform !== "darwin" },
  async () => {
    const { inspectProcess, verifyProcess } = await import("../scripts/qa/chrome-owner.mjs");
    const { spawn } = await import("node:child_process");
    const program =
      "const s=require('node:net').createServer();s.listen(0,'127.0.0.1',()=>console.log(s.address().port))";
    const child = spawn(process.execPath, ["-e", program], { stdio: ["ignore", "pipe", "pipe"] });
    try {
      const [line] = await once(child.stdout!, "data");
      const port = Number(String(line).trim());
      assert.ok(port > 0);
      const probe = inspectProcess(child.pid!, port);
      verifyProcess(probe, {
        pid: child.pid!,
        parent: process.pid,
        uid: process.getuid!(),
        command: `${process.execPath} -e ${program}`,
        port,
      });
      assert.match(probe.birth, /^[A-Za-z]{3} [A-Za-z]{3}/);
      const exited = once(child, "exit");
      child.kill();
      await exited;
      assert.throws(() => inspectProcess(child.pid!, port));
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        const done = once(child, "exit");
        child.kill();
        await done;
      }
    }
  },
);

test("post-CLI ownership loss prevents readiness and closes only fixture", async () => {
  const { deps, calls } = fixtureDeps();
  let checks = 0;
  deps.verifyChrome = () => {
    if (++checks === 2) throw new Error("Owned process identity changed");
  };
  await assert.rejects(startOwner(["--task", "proof"], deps), /identity changed/);
  assert.equal(
    calls.some((x) => x[0] === "save" && x[1] === "ready"),
    false,
  );
  assert.equal(calls.filter((x) => x[0] === "closeFixture").length, 1);
});

// CLI routing selection is unnecessary for root-native acquisition and must not trigger snapshots.
test("sole exact fixture is ready for native acquisition regardless of CLI selected routing", async () => {
  for (const selected of [false, true]) {
    const { deps, calls } = fixtureDeps((args: any) => {
      assert.deepEqual(args, ["pages"]);
      return `pages[1]{id,url,selected}:\n  0,http://127.0.0.1:41001/,${selected}`;
    });
    const owner = await startOwner(["--task", "proof"], deps);
    assert.equal(owner.state.phase, "ready");
    assert.deepEqual(
      calls.filter((x) => x[0] === "cli").map((x) => x[1]),
      [["pages"]],
    );
    const discovery = calls.findIndex((x) => x[0] === "cli");
    assert.ok(calls.slice(0, discovery).some((x) => x[0] === "verifyChrome"));
    assert.ok(calls.slice(discovery + 1).some((x) => x[0] === "verifyChrome"));
    assert.ok(calls.slice(discovery + 1).some((x) => x[0] === "verifyBridge"));
  }
});

test("sole fixture discovery still rejects malformed page ids and selected-field formats", async () => {
  for (const row of [
    "-1,http://127.0.0.1:41001/,false",
    "1x,http://127.0.0.1:41001/,false",
    "9007199254740992,http://127.0.0.1:41001/,false",
    "1,http://127.0.0.1:41001/,unknown",
  ]) {
    const { deps, calls } = fixtureDeps(`pages[1]{id,url,selected}:\n  ${row}`);
    await assert.rejects(startOwner(["--task", "proof"], deps), /fixture page/);
    assert.equal(
      calls.some((x) => x[0] === "save" && x[1] === "ready"),
      false,
    );
    assert.equal(
      calls.some((x) => x[0] === "cli" && x[1][0] !== "pages"),
      false,
    );
  }
});

// An actual child requesting the owner's HTTP fixture reproduces same-event-loop starvation.
test("public CLI subprocess can fetch owner fixture while its command is pending", async () => {
  const { startFixture, executePublicCli } = await import("../scripts/qa/chrome-owner.mjs");
  const { deps } = fixtureDeps();
  deps.startFixture = startFixture;
  deps.checkFixture = async (state: any) => (await fetch(`${state.origin}/`)).status;
  deps.cli = (args: any, state: any) => {
    const program =
      "fetch(process.argv[1],{signal:AbortSignal.timeout(700)}).then(r=>{if(r.status!==200)process.exitCode=1;console.log(r.status)}).catch(()=>{process.exitCode=2})";
    const command = executePublicCli(process.execPath, ["-e", program, `${state.origin}/`], {
      timeout: 2000,
    });
    return Promise.resolve(command).then((output) => {
      assert.equal(output.trim(), "200");
      return `pages[1]{id,url,selected}:\n  1,${state.origin}/,true`;
    });
  };
  let owner: any;
  try {
    owner = await startOwner(["--task", "proof"], deps);
    assert.equal(owner.state.phase, "ready");
  } finally {
    await owner?.closeFixture();
  }
});

test("initial public page evidence and fixture health are retained before a refusal closes fixture", async () => {
  const { deps, calls } = fixtureDeps(
    "pages[1]{id,url,selected}:\n  1,chrome-error://chromewebdata/,false",
  );
  await assert.rejects(startOwner(["--task", "proof"], deps), /fixture page/);
  const recorded = calls.findIndex((x) => x[0] === "recordPages" && x[1] === "initial");
  assert.ok(recorded >= 0);
  assert.ok(recorded < calls.findIndex((x) => x[0] === "closeFixture"));
  assert.match(calls[recorded][2], /chrome-error:/);
  const bad = fixtureDeps();
  bad.deps.checkFixture = async () => 503;
  await assert.rejects(startOwner(["--task", "proof"], bad.deps), /fixture HTTP/);
  assert.equal(
    bad.calls.some((x) => x[0] === "launch" || x[0] === "cli"),
    false,
  );
});
