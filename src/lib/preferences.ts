import fs from "node:fs/promises";
import path from "node:path";
import { WORKSPACE, projectDir } from "./config";

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

export async function savePreferences(text: string, level: "workspace" | "project" = "workspace", projectId?: string): Promise<{ text: string }> {
  const file = preferencesFile(level, projectId);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, text.trim() ? text.trim() + "\n" : "");
  return { text: text.trim() };
}

const MAX_CHARS = 6000;

/** One block for a prompt. Empty when the owner has written nothing. */
export function preferencesBlock(p: Preferences): string {
  const parts = [p.workspace && `### In general\n${p.workspace}`, p.project && `### For this project\n${p.project}`].filter(Boolean);
  if (!parts.length) return "";
  return `## The owner's preferences\nFollow these unless the instruction says otherwise.\n${parts.join("\n\n")}`.slice(0, MAX_CHARS);
}
