import fs from "node:fs/promises";
import path from "node:path";
import { WORKSPACE, projectDir } from "../../../common/server/config";

/**
 * How the owner likes their videos, in their own words. Workspace preferences go
 * into every prompt; a project's are added for that project. This is the owner's
 * text, not third-party material, so it is not wrapped as untrusted.
 */
export const preferencesFile = (level: "workspace" | "project", projectId?: string) => {
  if (level === "project") {
    if (!projectId) throw new Error("Project preferences need a project");
    return path.join(projectDir(projectId), "preferences.md");
  }
  return path.join(WORKSPACE, "preferences.md");
};

export type Preferences = { workspace: string; project: string };

export async function readPreferences(projectId?: string): Promise<Preferences> {
  const workspace = await fs.readFile(preferencesFile("workspace"), "utf8").catch(() => "");
  const project = projectId ? await fs.readFile(preferencesFile("project", projectId), "utf8").catch(() => "") : "";
  return { workspace: workspace.trim(), project: project.trim() };
}

/**
 * Preferences are written from three places now — the settings page, the interview
 * and an agent tool — and two of them can land at the same moment: an agent saving a
 * proposal while the owner saves a hand edit. Same reasoning as the interview's state
 * file (decision 62): writes queue in order and land by rename, so a reader never
 * sees half a file and the later write wins whole rather than interleaved. This is
 * the one writer of preferences.md; nothing else may open it for writing.
 */
let writes: Promise<unknown> = Promise.resolve();

export async function savePreferences(text: string, level: "workspace" | "project" = "workspace", projectId?: string): Promise<{ text: string }> {
  const file = preferencesFile(level, projectId);
  const body = text.trim();
  const next = writes.then(async () => {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.tmp`;
    await fs.writeFile(temporary, body ? body + "\n" : "");
    await fs.rename(temporary, file);
  });
  writes = next.catch(() => { /* a failed write must not block the next one */ });
  await next;
  return { text: body };
}

const MAX_CHARS = 6000;

/** One block for a prompt. Empty when the owner has written nothing. */
export function preferencesBlock(p: Preferences): string {
  const parts = [p.workspace && `### In general\n${p.workspace}`, p.project && `### For this project\n${p.project}`].filter(Boolean);
  if (!parts.length) return "";
  return `## The owner's preferences\nFollow these unless the instruction says otherwise.\n${parts.join("\n\n")}`.slice(0, MAX_CHARS);
}
