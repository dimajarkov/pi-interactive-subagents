/** Apply explicitly configured skills to the initial task, before auto-exit can run. */
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { stripFrontmatter } from "@mariozechner/pi-coding-agent";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export default function initialSkills(pi: ExtensionAPI) {
  const names = (process.env.PI_SUBAGENT_SKILLS ?? "").split(",").map(name => name.trim()).filter(Boolean);
  if (!names.length) return;
  let applied = false;
  pi.on("input", (event, ctx) => {
    if (applied) return { action: "continue" };
    // The child's public command inventory already resolves settings, packages,
    // project/global precedence and explicit invocation-only skills.
    try {
      const commands = pi.getCommands();
      const blocks = names.map(name => {
        const command = commands.find(command => command.source === "skill" && command.name === `skill:${name}`);
        if (!command) throw new Error(`Configured subagent skill not found: ${name}`);
        const path = command.sourceInfo.path;
        const body = stripFrontmatter(readFileSync(path, "utf8")).trim();
        return `<skill name="${name}" location="${path}">\nReferences are relative to ${dirname(path)}.\n\n${body}\n</skill>`;
      });
      applied = true;
      return { action: "transform", text: [...blocks, event.text].join("\n\n"), images: event.images };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      try {
        ctx.ui.notify(errorMessage, "error");
        const sessionFile = process.env.PI_SUBAGENT_SESSION;
        if (sessionFile) {
          try {
            writeFileSync(`${sessionFile}.exit`, JSON.stringify({ type: "error", errorMessage, stopReason: "error" }));
          } catch (deliveryError) {
            ctx.ui.notify(`Could not deliver skill error to parent: ${deliveryError instanceof Error ? deliveryError.message : String(deliveryError)}`, "error");
          }
        }
      } finally {
        // Sidecar delivery is best effort; a failed initial task must still terminate.
        ctx.shutdown();
      }
      return { action: "handled" };
    }
  });
}
