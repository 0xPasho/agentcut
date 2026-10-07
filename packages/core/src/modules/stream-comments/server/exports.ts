import fs from "node:fs";
import path from "node:path";
import type { ChatComment, ChatPlatform } from "./comments";

/**
 * The unified chat's exports: a folder per stream under `clips/`, with `messages.json`
 * and a `cards/` folder holding every message already drawn the way the channel draws
 * it. When a message has one, that picture is the comment card — the owner's own design,
 * not one drawn here — and a folder can stand in for the chat database altogether.
 */

type ExportMessage = {
  id: number;
  type: string;
  platform: string;
  text: string | null;
  image?: string;
  image_path?: string;
  time: { ts: number };
  user?: { handle?: string; nickname?: string; avatar?: string; color?: string | null; is_bot?: boolean };
};
type ExportFile = { messages: ExportMessage[] };

/** The file an export path means: `messages.json` itself, or the folder holding it. */
export function exportFile(source: string): string | null {
  const file = source.endsWith(".json") ? source : path.join(source, "messages.json");
  return fs.existsSync(file) ? file : null;
}

const cache = new Map<string, { mtime: number; data: ExportFile }>();
function load(file: string): ExportFile | null {
  try {
    const mtime = fs.statSync(file).mtimeMs;
    const known = cache.get(file);
    if (known && known.mtime === mtime) return known.data;
    const data = JSON.parse(fs.readFileSync(file, "utf8")) as ExportFile;
    if (!Array.isArray(data.messages)) return null;
    cache.set(file, { mtime, data });
    return data;
  } catch {
    return null;
  }
}

/** The exports that sit beside a chat database: `<chat>/data/chat.db` → `<chat>/clips/*`. */
function exportsBeside(source: string): string[] {
  if (exportFile(source)) return [exportFile(source)!];
  const clips = path.join(path.dirname(path.dirname(source)), "clips");
  try {
    return fs.readdirSync(clips).map((dir) => exportFile(path.join(clips, dir))).filter((file): file is string => !!file);
  } catch {
    return [];
  }
}

/** The picture the export drew for a message, if any export has one on disk. */
export function exportCard(source: string, id: number): string | null {
  for (const file of exportsBeside(source)) {
    const message = load(file)?.messages.find((m) => m.id === id);
    if (!message) continue;
    const card = message.image_path ?? (message.image ? path.join(path.dirname(file), message.image) : null);
    if (card && fs.existsSync(card)) return card;
  }
  return null;
}

/** An export read the way the chat database is: chat messages from people, in a window of epoch ms, oldest first. */
export function readExportComments(file: string, fromMs: number, toMs: number): ChatComment[] {
  const data = load(file);
  if (!data) throw new Error(`${file} is not a chat export`);
  return data.messages
    .filter((m) => m.type === "chat" && !m.user?.is_bot && m.text?.trim() && m.time.ts >= fromMs && m.time.ts <= toMs)
    .sort((a, b) => a.time.ts - b.time.ts)
    .map((m) => ({
      id: m.id,
      platform: m.platform as ChatPlatform,
      ts: m.time.ts,
      name: m.user?.nickname || m.user?.handle || "anónimo",
      handle: m.user?.handle ?? "",
      avatar: m.user?.avatar ?? "",
      color: m.user?.color ?? "",
      text: m.text!.trim(),
    }));
}
