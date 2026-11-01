import {
  closeSync,
  fsyncSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute } from "node:path";
import { randomUUID } from "node:crypto";

export interface SessionPolicy {
  version: 1;
  sessionId: string;
  sessionFile: string;
  parentSessionId: string;
  parentSessionFile: string;
  cwd: string;
  configDir: string;
  agent?: string;
  model?: string;
  thinking?: string;
  tools?: string;
  skills?: string;
  denied: string[];
  systemPromptMode?: "replace" | "append";
  systemPrompt?: string;
  autoExit: boolean;
  interactive: boolean;
}

export function privateWrite(file: string, value: unknown): void {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    const fd = openSync(temp, "wx", 0o600);
    try {
      writeFileSync(fd, JSON.stringify(value, null, 2));
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(temp, file);
    const directory = openSync(dirname(file), "r");
    try {
      fsyncSync(directory);
    } finally {
      closeSync(directory);
    }
  } finally {
    if (existsSync(temp)) unlinkSync(temp);
  }
}

export function privateRead(file: string): any {
  const stat = lstatSync(file);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.size > 262144 ||
    stat.mode & 0o077 ||
    (process.getuid && stat.uid !== process.getuid())
  )
    throw new Error("Unsafe private recovery file");
  return JSON.parse(readFileSync(file, "utf8"));
}

export function saveSessionPolicy(policy: SessionPolicy): void {
  privateWrite(`${policy.sessionFile}.subagent-policy.json`, policy);
}

export function loadSessionPolicy(
  sessionFile: string,
  parentId: string,
  parentFile: string | null | undefined,
): SessionPolicy {
  let p: any;
  try {
    p = privateRead(`${sessionFile}.subagent-policy.json`);
    const required = [
      "sessionId",
      "sessionFile",
      "parentSessionId",
      "parentSessionFile",
      "cwd",
      "configDir",
    ];
    const optional = ["agent", "model", "thinking", "tools", "skills", "systemPrompt"];
    if (
      !p ||
      p.version !== 1 ||
      required.some((k) => typeof p[k] !== "string" || !p[k]) ||
      optional.some((k) => p[k] !== undefined && typeof p[k] !== "string") ||
      ![undefined, "replace", "append"].includes(p.systemPromptMode) ||
      typeof p.autoExit !== "boolean" ||
      typeof p.interactive !== "boolean" ||
      !Array.isArray(p.denied) ||
      p.denied.some((v: unknown) => typeof v !== "string") ||
      ![p.cwd, p.configDir, p.sessionFile, p.parentSessionFile].every(isAbsolute)
    )
      throw new Error("Invalid policy schema");
    const header = JSON.parse(readFileSync(sessionFile, "utf8").split("\n")[0]);
    const parentHeader = parentFile && JSON.parse(readFileSync(parentFile, "utf8").split("\n")[0]);
    if (
      header.type !== "session" ||
      header.id !== p.sessionId ||
      realpathSync(sessionFile) !== p.sessionFile ||
      p.parentSessionId !== parentId ||
      !parentFile ||
      realpathSync(parentFile) !== p.parentSessionFile ||
      parentHeader.type !== "session" ||
      parentHeader.id !== parentId
    )
      throw new Error("Foreign native session or original parent lineage mismatch");
  } catch (error) {
    throw new Error(
      `Cannot resume native session: original private policy/ownership is missing, invalid or foreign. Legacy or orphan recovery requires explicit human inspection; no adoption or pane allocation attempted. ${String(error)}`,
    );
  }
  return p;
}

/** An unresolved execution is never stolen based on a PID, timeout or absent observer. */
export function claimExecution(sessionFile: string, executionId: string): () => void {
  const file = `${sessionFile}.subagent-active.json`;
  let fd: number;
  try {
    fd = openSync(file, "wx", 0o600);
  } catch (error) {
    throw new Error(
      `Native session already has an active or unresolved execution; inspect ${file}. No concurrent resume attempted. ${String(error)}`,
    );
  }
  try {
    writeFileSync(fd, JSON.stringify({ version: 1, executionId, sessionFile }));
    fsyncSync(fd);
  } catch (error) {
    closeSync(fd);
    unlinkSync(file);
    throw error;
  }
  closeSync(fd);
  return () => {
    const record = privateRead(file);
    if (record.executionId !== executionId)
      throw new Error("Execution ownership changed; retained recovery lock");
    unlinkSync(file);
  };
}

/** Sanitize the shell that actually launches Pi, including mux-daemon inheritance. */
export function childBootstrap(assignments: string[], command: string, managed: boolean): string {
  const freshSurface = managed ? 'export PI_SUBAGENT_SURFACE="$HERDR_PANE_ID"; ' : "";
  return `( for _pi_child_var in \${!PI_SUBAGENT_@}; do unset "$_pi_child_var"; done; unset PI_DENY_TOOLS PI_CODEX_VISUAL_HOST; export ${assignments.join(" ")}; ${freshSurface}exec ${command} )`;
}

export function executionExitFile(sessionFile: string, executionId: string): string {
  return `${sessionFile}.${executionId}.exit`;
}

export function ownExitFile(sessionFile: string): string {
  return process.env.PI_SUBAGENT_EXIT_FILE || `${sessionFile}.exit`;
}
