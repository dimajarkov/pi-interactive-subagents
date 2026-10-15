import { execFile, execFileSync, spawn } from "node:child_process";
import {
  accessSync,
  chmodSync,
  closeSync,
  constants,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  openSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const CHROME_APP = join(homedir(), "Applications/Google Chrome for Testing.app");
const CHROME = join(CHROME_APP, "Contents/MacOS/Google Chrome for Testing");
// Fixed application-QA configuration; never inferred target admission.
const QA_FEATURE_FLAG = "--disable-features=PreloadTopChromeWebUI";

export async function startOwner(argv, deps) {
  if (
    argv.length !== 2 ||
    argv[0] !== "--task" ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/.test(argv[1] || "")
  )
    throw new Error("Only --task <fresh bounded task> is supported");
  if (deps.platform !== "darwin") throw new Error("Chrome QA owner requires macOS");
  if (deps.cwd !== deps.sourceRoot) throw new Error("Use this checkout physical Git root");
  if (
    Object.keys(deps.env).some(
      (k) =>
        /^(CHROME_DEVTOOLS_|PUPPETEER_|PLAYWRIGHT_|npm_config_)/i.test(k) ||
        [
          "NODE_OPTIONS",
          "NODE_PATH",
          "BROWSER",
          "CHROME_BIN",
          "CHROMIUM_BIN",
          "GOOGLE_CHROME_SHIM",
          "CHROME_PATH",
          "CHROME_EXECUTABLE",
          "DEBUG",
          "NODE_DEBUG",
        ].includes(k),
    )
  )
    throw new Error("Browser/runtime override must be cleared");
  if (deps.env.HERDR_ENV !== "1" || !/^[A-Za-z0-9_.-]{1,64}$/.test(deps.env.HERDR_SESSION || ""))
    throw new Error("Live named Herdr caller required");
  const task = argv[1];
  const caller = deps.preflight();
  const state = { ...deps.createState(), task, repo: deps.cwd, caller, phase: "preparing" };
  let fixture;
  try {
    fixture = await deps.startFixture(state.token);
    state.origin = `http://127.0.0.1:${fixture.port}`;
    state.fixtureStatus = await deps.checkFixture(state);
    if (state.fixtureStatus !== 200) throw new Error("Owned fixture HTTP readiness failed");
    state.port = await deps.reservePort();
    state.bridgePort = await deps.reservePort();
    if (state.port === state.bridgePort)
      throw new Error("Distinct Chrome and bridge ports required");
    deps.prepareProfile(state);
    deps.assertFreshSession(state);
    state.phase = "allocated";
    deps.save(state);
    state.args = [
      `--user-data-dir=${state.profile}`,
      `--remote-debugging-port=${state.port}`,
      "--remote-debugging-address=127.0.0.1",
      "--disable-sync",
      "--disable-extensions",
      "--use-mock-keychain",
      "--password-store=basic",
      "--no-first-run",
      "--no-default-browser-check",
      QA_FEATURE_FLAG,
      `${state.origin}/`,
    ];
    const chrome = deps.launchChrome(state.args, state);
    if (!Number.isSafeInteger(chrome.pid) || chrome.pid < 1)
      throw new Error("Owned Chrome process failed to start");
    state.pid = chrome.pid;
    state.phase = "launched";
    deps.save(state);
    const deadline = deps.now() + (deps.timeoutMs ?? 15000);
    while (true) {
      if (state.chromeExited) throw new Error("Owned Chrome exited before proof readiness");
      try {
        deps.verifyChrome(state);
        break;
      } catch (error) {
        if (!error.retryable) throw error;
        if (deps.now() >= deadline) throw new Error("Owned Chrome listener startup timeout");
        await deps.sleep(500);
      }
    }
    deps.assertFreshSession(state);
    const pages = await deps.cli(["pages"], state);
    deps.recordPages("initial", pages, state);
    state.fixtureStatusAfterPages = await deps.checkFixture(state);
    if (state.fixtureStatusAfterPages !== 200)
      throw new Error("Owned fixture HTTP readiness failed after CLI");
    state.pageId = verifyFixturePage(pages, `${state.origin}/`).id;
    deps.verifyChrome(state);
    deps.verifyBridge(state);
    state.phase = "ready";
    deps.save(state);
    let closed = false;
    return {
      state,
      recheck: () => {
        if (state.phase !== "ready" || state.chromeExited)
          throw new Error("Owned proof is no longer live");
        deps.verifyChrome(state);
        deps.verifyBridge(state);
      },
      closeFixture: async () => {
        if (closed) return;
        closed = true;
        await fixture.close();
        state.phase = "retained";
        deps.save(state);
      },
    };
  } catch (error) {
    state.phase = "blocked";
    state.reason = error.message;
    deps.save(state);
    await fixture?.close();
    throw Object.assign(
      new Error(`Proof blocked; resources retained at ${state.directory}: ${error.message}`),
      { state },
    );
  }
}

export async function startFixture(token) {
  if (!/^[A-Za-z0-9_]{1,64}$/.test(token)) throw new Error("Invalid synthetic fixture token");
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Pi QA ${token}</title><style>body{font:20px system-ui;margin:40px}h1{color:#165ad4}strong{color:#078b44}button,input{font:inherit;margin:12px}</style></head><body><h1>Pi Browser Visual Proof 41</h1><strong>${token}</strong><p>Fabricated QA account: qa@example.invalid</p><button id="increment">Increment</button><output id="count">0</output><label>Draft <input id="draft"></label><p id="echo"></p><script nonce="${token}">document.getElementById('increment').onclick=()=>{const c=document.getElementById('count');c.textContent=String(Number(c.textContent)+1)};document.getElementById('draft').oninput=e=>{document.getElementById('echo').textContent=e.target.value};</script></body></html>`;
  const server = createServer((req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader(
      "Content-Security-Policy",
      `default-src 'none'; script-src 'nonce-${token}'; style-src 'unsafe-inline'; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'`,
    );
    if (!["GET", "HEAD"].includes(req.method)) {
      res.writeHead(405);
      res.end();
      return;
    }
    if (req.url !== "/") {
      res.writeHead(404);
      res.end();
      return;
    }
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(req.method === "HEAD" ? "" : html);
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return {
    host: "127.0.0.1",
    port: server.address().port,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeIdleConnections();
      }),
  };
}

export function verifyHerdrCaller(pane, info, env, cwd, pid) {
  if (
    !/^w[A-Za-z0-9]+$/.test(env.HERDR_WORKSPACE_ID || "") ||
    !env.HERDR_TAB_ID?.startsWith(`${env.HERDR_WORKSPACE_ID}:t`) ||
    !env.HERDR_PANE_ID?.startsWith(`${env.HERDR_WORKSPACE_ID}:p`) ||
    pane?.pane_id !== env.HERDR_PANE_ID ||
    pane.workspace_id !== env.HERDR_WORKSPACE_ID ||
    pane.tab_id !== env.HERDR_TAB_ID ||
    pane.cwd !== cwd ||
    (pane.foreground_cwd && pane.foreground_cwd !== cwd) ||
    pane.agent ||
    pane.agent_session ||
    info?.pane_id !== pane.pane_id ||
    !Number.isInteger(info.shell_pid) ||
    !info.foreground_processes?.some((p) => p.pid === pid)
  )
    throw new Error("Current ordinary Herdr foreground caller is unverified");
  return {
    session: env.HERDR_SESSION,
    workspace: pane.workspace_id,
    tab: pane.tab_id,
    pane: pane.pane_id,
    shell: info.shell_pid,
    owner: pid,
  };
}

/** Test injection is import-only; CLI uses fixed spawn and executable. */
/** @param {(file: string, args: string[], options: import("node:child_process").SpawnOptions) => any} spawnImpl */
export function launchOwnedChrome(args, options, spawnImpl = spawn) {
  const featureControls = args.filter(
    (arg) => arg.startsWith("--disable-features") || arg.startsWith("--enable-features"),
  );
  if (featureControls.length !== 1 || featureControls[0] !== QA_FEATURE_FLAG)
    throw new Error("Chrome owner requires the single fixed QA feature control");
  const log = openSync(options.log, "wx", 0o600);
  try {
    // Separate signal group prevents owner Ctrl+C reaching Chrome. Keep handle referenced.
    return spawnImpl(CHROME, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", log, log],
      detached: true,
    });
  } finally {
    closeSync(log);
  }
}

export function verifyFixturePage(output, url) {
  const lines = String(output).split("\n");
  const header = lines.findIndex((line) => line === "pages[1]{id,url,selected}:");
  const row = header < 0 ? null : (lines[header + 1] || "").match(/^  ([0-9]+),(.+),(true|false)$/);
  if (
    !row ||
    !Number.isSafeInteger(Number(row[1])) ||
    row[2] !== url ||
    /^  [0-9]+,/.test(lines[header + 2] || "")
  )
    throw new Error("Exact sole synthetic fixture page is unverified");
  return { id: Number(row[1]), selected: row[3] === "true" };
}

// Import-only command seam; production always passes the fixed public CLI executable.
export function executePublicCli(file, args, options) {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      { encoding: "utf8", timeout: 45000, maxBuffer: 256000, ...options },
      (error, stdout) => (error ? reject(error) : resolve(stdout)),
    );
  });
}

export function upstreamEnvironment(env, state, mcpPath) {
  const clean = Object.fromEntries(
    Object.entries(env).filter(([key]) => !/^CHROME_DEVTOOLS_/i.test(key)),
  );
  return {
    ...clean,
    CHROME_DEVTOOLS_AXI_SESSION: state.session,
    CHROME_DEVTOOLS_AXI_PORT: String(state.bridgePort),
    CHROME_DEVTOOLS_AXI_BROWSER_URL: `http://127.0.0.1:${state.port}`,
    CHROME_DEVTOOLS_AXI_MCP_PATH: mcpPath,
  };
}

/** Fixed OS probes only; no browser protocol requests. Exported for actual socket tests. */
export function inspectProcess(pid, port) {
  const run = (file, args) =>
    execFileSync(file, args, {
      encoding: "utf8",
      timeout: 3000,
      maxBuffer: 64000,
      env: { ...process.env, LC_ALL: "C" },
    }).trim();
  const identity = run("/bin/ps", ["-p", String(pid), "-o", "pid=,ppid=,uid=,lstart="]);
  const match = identity.match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/);
  if (!match) throw new Error("Owned process identity unavailable");
  let listener = "";
  try {
    listener = run("/usr/sbin/lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-Fpn"]);
  } catch (error) {
    if (
      error.status !== 1 ||
      String(error.stderr || "").trim() ||
      String(error.stdout || "").trim()
    )
      throw error;
  }
  return {
    pid: Number(match[1]),
    parent: Number(match[2]),
    uid: Number(match[3]),
    birth: match[4],
    command: run("/bin/ps", ["-p", String(pid), "-o", "command="]),
    listener,
  };
}

export function verifyProcess(evidence, expected) {
  if (
    evidence.pid !== expected.pid ||
    evidence.uid !== expected.uid ||
    (expected.parent !== undefined && evidence.parent !== expected.parent) ||
    (expected.birth && evidence.birth !== expected.birth) ||
    evidence.command !== expected.command
  )
    throw new Error("Owned process identity changed");
  if (!evidence.listener)
    throw Object.assign(new Error("Owned loopback listener not ready"), { retryable: true });
  if (
    evidence.listener.replace(/\nf[0-9]+(?=\n)/g, "") !==
    `p${expected.pid}\nn127.0.0.1:${expected.port}`
  )
    throw new Error("Owned exclusive loopback listener unverified");
}

export function verifyPrivateProfile(profile, inode, uid) {
  const st = lstatSync(profile);
  if (
    st.isSymbolicLink() ||
    !st.isDirectory() ||
    st.uid !== uid ||
    (st.mode & 0o077) !== 0 ||
    st.ino !== inode
  )
    throw new Error("Owned private profile changed");
}

function productionDependencies() {
  const cwd = realpathSync(process.cwd());
  const sourceRoot = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), "../.."));
  const home = homedir();
  const cli = join(home, ".local/bin/chrome-devtools-axi");
  const mcp = join(
    home,
    ".npm-global/lib/node_modules/chrome-devtools-mcp/build/src/bin/chrome-devtools-mcp.js",
  );
  const herdr = "/opt/homebrew/bin/herdr";
  let directory;
  const execute = (file, args, env = process.env, timeout = 5000) =>
    execFileSync(file, args, { cwd, env, encoding: "utf8", timeout, maxBuffer: 256000 });
  return {
    platform: process.platform,
    env: process.env,
    cwd,
    sourceRoot,
    now: Date.now,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    preflight() {
      if (execute("/usr/bin/git", ["rev-parse", "--show-toplevel"]).trim() !== cwd)
        throw new Error("Use physical Git root");
      for (const path of [cli, mcp, CHROME, "/bin/ps", "/usr/sbin/lsof"])
        accessSync(path, constants.X_OK);
      const app = realpathSync(CHROME_APP);
      const store = dirname(dirname(app));
      if (!/^\/nix\/store\/[a-z0-9]{32}-chrome-for-testing-/.test(store))
        throw new Error("Use the declared Nix-owned Chrome for Testing app");
      execute(
        "/nix/var/nix/profiles/default/bin/nix-store",
        ["--verify-path", store],
        process.env,
        30000,
      );
      if (
        execute("/usr/libexec/PlistBuddy", [
          "-c",
          "Print :CFBundleIdentifier",
          join(app, "Contents/Info.plist"),
        ]).trim() !== "com.google.chrome.for.testing"
      )
        throw new Error("Dedicated Chrome app identity mismatch");
      const args = ["--session", process.env.HERDR_SESSION];
      const pane = JSON.parse(execute(herdr, [...args, "pane", "current", "--current"])).result
        ?.pane;
      const info = JSON.parse(execute(herdr, [...args, "pane", "process-info", "--current"])).result
        ?.process_info;
      return {
        ...verifyHerdrCaller(pane, info, process.env, cwd, process.pid),
        sourceHead: execute("/usr/bin/git", ["rev-parse", "HEAD"]).trim(),
      };
    },
    createState() {
      directory = mkdtempSync(join(realpathSync(tmpdir()), "pi-chrome-owner-"));
      chmodSync(directory, 0o700);
      return {
        directory,
        profile: join(directory, "profile"),
        token: `PI41_${randomBytes(8).toString("hex").toUpperCase()}`,
        session: `pi41-${randomBytes(16).toString("hex")}`,
      };
    },
    prepareProfile(state) {
      mkdirSync(state.profile, { mode: 0o700 });
      state.profileInode = lstatSync(state.profile).ino;
    },
    assertFreshSession(state) {
      state.sessionDirectory = join(home, ".chrome-devtools-axi/sessions", state.session);
      if (state.sessionInode) {
        const st = lstatSync(state.sessionDirectory);
        if (
          !st.isDirectory() ||
          st.isSymbolicLink() ||
          st.ino !== state.sessionInode ||
          existsSync(join(state.sessionDirectory, "bridge.pid"))
        )
          throw new Error("Existing upstream session refused");
      } else {
        if (existsSync(state.sessionDirectory))
          throw new Error("Existing upstream session refused");
        mkdirSync(dirname(state.sessionDirectory), { recursive: true });
        mkdirSync(state.sessionDirectory, { mode: 0o700 });
        state.sessionInode = lstatSync(state.sessionDirectory).ino;
      }
      // No listener is safe to adopt: upstream ensureBridge may reuse or terminate it.
      try {
        execute("/usr/sbin/lsof", ["-nP", `-iTCP:${state.bridgePort}`, "-sTCP:LISTEN", "-Fp"]);
      } catch (error) {
        if (
          error.status === 1 &&
          !String(error.stderr || "").trim() &&
          !String(error.stdout || "").trim()
        )
          return;
        throw error;
      }
      throw new Error("Occupied upstream bridge port refused");
    },
    startFixture,
    async checkFixture(state) {
      const response = await fetch(`${state.origin}/`, {
        signal: AbortSignal.timeout(2000),
        redirect: "error",
      });
      await response.arrayBuffer();
      return response.status;
    },
    recordPages(stage, output, state) {
      const path = join(directory, `${stage}-pages.txt`);
      writeFileSync(path, output, { mode: 0o600, flag: "wx" });
      (state.pagesDiagnostics ??= []).push(path);
    },
    async reservePort() {
      const s = createNetServer();
      await new Promise((resolve, reject) => {
        s.once("error", reject);
        s.listen(0, "127.0.0.1", resolve);
      });
      const port = s.address().port;
      await new Promise((resolve) => s.close(resolve));
      return port;
    },
    verifyChrome(state) {
      if (state.chromeExited) throw new Error("Owned Chrome exited");
      verifyPrivateProfile(state.profile, state.profileInode, process.getuid());
      const evidence = inspectProcess(state.pid, state.port);
      verifyProcess(evidence, {
        pid: state.pid,
        parent: process.pid,
        uid: process.getuid(),
        birth: state.birth,
        command: [CHROME, ...state.args].join(" "),
        port: state.port,
      });
      state.birth ??= evidence.birth;
    },
    cli(args, state) {
      return executePublicCli(cli, args, {
        cwd,
        env: upstreamEnvironment(process.env, state, mcp),
      });
    },
    verifyBridge(state) {
      const info = JSON.parse(readFileSync(join(state.sessionDirectory, "bridge.pid"), "utf8"));
      if (
        !Number.isSafeInteger(info.pid) ||
        info.pid < 1 ||
        info.port !== state.bridgePort ||
        (state.bridgePid && state.bridgePid !== info.pid)
      )
        throw new Error("Owned upstream bridge changed");
      const evidence = inspectProcess(info.pid, state.bridgePort);
      if (!evidence.command.includes("/chrome-devtools-axi/dist/bin/chrome-devtools-axi-bridge.js"))
        throw new Error("Upstream bridge executable unverified");
      verifyProcess(evidence, {
        pid: info.pid,
        uid: process.getuid(),
        birth: state.bridgeBirth,
        command: state.bridgeCommand ?? evidence.command,
        port: state.bridgePort,
      });
      state.bridgePid = info.pid;
      state.bridgeBirth = evidence.birth;
      state.bridgeCommand = evidence.command;
    },
    launchChrome(args, state) {
      const child = launchOwnedChrome(args, {
        cwd,
        env: process.env,
        log: join(directory, "chrome.log"),
      });
      child.once("error", () => {
        state.chromeExited = true;
      });
      child.once("exit", () => {
        state.chromeExited = true;
      });
      return child;
    },
    save(state) {
      const temp = join(directory, "state.next");
      writeFileSync(temp, JSON.stringify(state, null, 2), { mode: 0o600, flag: "wx" });
      renameSync(temp, join(directory, "state.json"));
    },
  };
}

async function main() {
  let owner;
  try {
    owner = await startOwner(process.argv.slice(2), productionDependencies());
    console.log(
      `Owned synthetic page metadata ready. Private task state: ${join(owner.state.directory, "state.json")}`,
    );
    console.log(
      "Keep this owner foreground. Root must freshly verify the exact synthetic Chrome window before native Computer Use.",
    );
    let stopping = false;
    const stop = async () => {
      if (stopping) return;
      stopping = true;
      await owner.closeFixture();
      console.log(`Fixture closed; external Chrome/profile retained: ${owner.state.directory}`);
      process.exit(0);
    };
    const monitor = setInterval(() => {
      try {
        owner.recheck();
      } catch (error) {
        clearInterval(monitor);
        console.error(`Proof stopped: ${error.message}`);
        void stop();
      }
    }, 2000);
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
