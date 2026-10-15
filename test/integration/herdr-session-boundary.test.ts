/** Opt-in native acceptance using a private full Pi configuration with an immutable package pin.
 * PI_HERDR_TEST_SESSION=arena PI_LIFECYCLE_TEST_AGENT_DIR=/private/test-agent
 * node --test test/integration/herdr-session-boundary.test.ts
 * The selected agent directory supplies existing approved auth; no history or credentials are copied.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  realpathSync,
} from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const session = process.env.PI_HERDR_TEST_SESSION,
  agentDir = process.env.PI_LIFECYCLE_TEST_AGENT_DIR;
const quote = (s: string) => "'" + s.replaceAll("'", "'\\''") + "'";
test(
  "installed native package returns one and four parallel scout findings after session replacement",
  { skip: !session || !agentDir, timeout: 300_000 },
  async () => {
    assert.notEqual(
      realpathSync(agentDir!),
      realpathSync(join(homedir(), ".pi/agent")),
      "supply a private agent configuration",
    );
    const settings = JSON.parse(readFileSync(join(agentDir!, "settings.json"), "utf8"));
    const pin = settings.packages.find(
      (p: any) =>
        typeof p === "string" &&
        /^git:github.com\/dimajarkov\/pi-interactive-subagents@[a-f0-9]{40}$/.test(p),
    );
    assert.ok(
      pin,
      "native acceptance must use a declared immutable package, without force-loaded source",
    );
    const base = mkdtempSync(join(realpathSync(tmpdir()), "pi-session-boundary-"));
    mkdirSync(join(base, "project"), { mode: 0o700 });
    writeFileSync(join(base, "project/fixture.txt"), "Synthetic lifecycle fixture: 12\n");
    const herdr = (a: string[]) =>
      execFileSync("herdr", ["--session", session!, ...a], { encoding: "utf8" });
    const json = (a: string[]) => JSON.parse(herdr(a)).result;
    const before = json(["workspace", "list"]).workspaces;
    const made = json([
      "workspace",
      "create",
      "--cwd",
      join(base, "project"),
      "--label",
      "Native watcher lifecycle acceptance",
      "--no-focus",
      "--env",
      `PI_LIFECYCLE_TEST_ROOT=${base}`,
      "--env",
      `PI_LIFECYCLE_TEST_AGENT_DIR=${realpathSync(agentDir!)}`,
    ]);
    const workspace = made.workspace.workspace_id;
    writeFileSync(
      join(base, "ownership.json"),
      JSON.stringify({ session, workspace, parent: made.root_pane, pin }, null, 2),
      { mode: 0o600 },
    );
    console.log(`Private native lifecycle evidence: ${base}`);
    let maxChildren = 0;
    try {
      const driver = join(
        dirname(fileURLToPath(import.meta.url)),
        "fixtures/watcher-lifecycle-parent.mjs",
      );
      herdr(["pane", "run", made.root_pane.pane_id, `node ${quote(driver)}`]);
      const deadline = Date.now() + 260_000;
      while (Date.now() < deadline && !existsSync(join(base, "complete.json"))) {
        assert.ok(
          !existsSync(join(base, "failure.txt")),
          existsSync(join(base, "failure.txt"))
            ? readFileSync(join(base, "failure.txt"), "utf8")
            : "native failure",
        );
        const panes = json(["pane", "list", "--workspace", workspace]).panes;
        maxChildren = Math.max(maxChildren, panes.length - 1);
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      assert.ok(
        existsSync(join(base, "complete.json")),
        "real native child results required before deadline",
      );
      assert.equal(
        JSON.parse(readFileSync(join(base, "single-pass.json"), "utf8")).results.length,
        1,
      );
      assert.equal(
        JSON.parse(readFileSync(join(base, "parallel-pass.json"), "utf8")).results.length,
        4,
      );
      assert.ok(
        maxChildren >= 4,
        `four concurrent real child panes required, observed ${maxChildren}`,
      );
      assert.deepEqual(
        json(["pane", "list", "--workspace", workspace]).panes.map((p: any) => p.pane_id),
        [made.root_pane.pane_id],
      );
      assert.equal(
        readFileSync(join(base, "project/fixture.txt"), "utf8"),
        "Synthetic lifecycle fixture: 12\n",
      );
      const after = json(["workspace", "list"]).workspaces;
      assert.ok(
        before.every((w: any) => after.some((a: any) => a.workspace_id === w.workspace_id)),
      );
      assert.deepEqual(
        after.filter((w: any) => w.focused).map((w: any) => w.workspace_id),
        before.filter((w: any) => w.focused).map((w: any) => w.workspace_id),
      );
      writeFileSync(
        join(base, "acceptance.json"),
        JSON.stringify(
          {
            nativeSingle: true,
            nativeFourParallel: true,
            sessionReplacement: true,
            maxChildren,
            pin,
            childCleanup: true,
            otherWorkspacesPreserved: true,
          },
          null,
          2,
        ),
      );
    } finally {
      herdr(["workspace", "close", workspace]);
    }
  },
);
