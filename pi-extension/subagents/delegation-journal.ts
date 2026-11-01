import { existsSync, readdirSync, readFileSync, lstatSync } from "node:fs";
import { join } from "node:path";
import { privateRead, privateWrite } from "./recovery.ts";

export interface DelegationRecord {
  version: 1;
  id: string;
  parentSessionId: string;
  state: "running" | "queued" | "settled";
  recovery?: string;
  child?: unknown;
  message?: any;
}
export function journalPath(parentFile: string, id: string): string {
  return join(`${parentFile}.delegations`, `${id}.json`);
}
export function writeDelegation(parentFile: string, record: DelegationRecord): void {
  privateWrite(journalPath(parentFile, record.id), record);
}
export function unresolvedDelegations(parentFile: string): DelegationRecord[] {
  const dir = `${parentFile}.delegations`;
  if (!existsSync(dir)) return [];
  let parentId: string;
  try {
    const header = JSON.parse(readFileSync(parentFile, "utf8").split("\n")[0]);
    if (header.type !== "session" || typeof header.id !== "string")
      throw Error("Invalid original parent header");
    parentId = header.id;
  } catch (error) {
    return [
      {
        version: 1,
        id: "invalid-parent",
        parentSessionId: "unknown",
        state: "running",
        recovery: `Cannot verify original parent native header ${parentFile}: ${String(error)}`,
      },
    ];
  }
  let files: string[];
  try {
    const stat = lstatSync(dir);
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      stat.mode & 0o077 ||
      (process.getuid && stat.uid !== process.getuid())
    )
      throw Error("Unsafe ownership journal directory");
    files = readdirSync(dir);
  } catch (error) {
    return [
      {
        version: 1,
        id: "invalid-directory",
        parentSessionId: parentId,
        state: "running",
        recovery: `Cannot verify original ownership journal ${dir}: ${String(error)}`,
      },
    ];
  }
  return files
    .filter((file) => file.endsWith(".json"))
    .flatMap((file) => {
      try {
        const record = privateRead(join(dir, file));
        if (
          record.version !== 1 ||
          !["running", "queued", "settled"].includes(record.state) ||
          typeof record.id !== "string" ||
          !/^[a-f0-9-]{36}$/.test(record.id) ||
          file !== `${record.id}.json` ||
          record.parentSessionId !== parentId ||
          (record.recovery !== undefined && typeof record.recovery !== "string") ||
          (record.state === "queued" &&
            (!record.message ||
              !["subagent_result", "subagent_ping"].includes(record.message.customType) ||
              record.message.details?.subagentOutcomeId !== record.id))
        )
          throw Error("Invalid or foreign delegation journal identity");
        return record.state === "settled" ? [] : [record];
      } catch (error) {
        return [
          {
            version: 1,
            id: file,
            parentSessionId: "unknown",
            state: "running",
            recovery: `Unreadable original delegation receipt ${join(dir, file)}: ${String(error)}`,
          } as DelegationRecord,
        ];
      }
    });
}
