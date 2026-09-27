import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import { ROOT, WORKSPACE } from "../../../../common/server/config";
import type { PhoneAction, PhoneWindow } from "../../types";
import { settings } from "../store";

const exec = promisify(execFile);
export const phoneBinary = () => settings().phoneBinary || process.env.AGENTCUT_PHONECTL || path.join(WORKSPACE, "publishing", "bin", "phonectl");
export async function buildPhoneTool() {
  if (process.platform !== "darwin") throw new Error("iPhone Mirroring requires macOS");
  const binary = path.join(WORKSPACE, "publishing", "bin", "phonectl");
  await fs.mkdir(path.dirname(binary), { recursive: true });
  await exec("/usr/bin/swiftc", ["-O", path.join(ROOT, "tools", "publishing-phone.swift"), "-o", binary], { timeout: 120_000 });
  return { built: true };
}
async function command(args: string[]) {
  if (process.platform !== "darwin") throw new Error("iPhone Mirroring requires macOS");
  try { const { stdout } = await exec(phoneBinary(), args, { timeout: 30_000, maxBuffer: 1024 * 1024 }); return stdout.trim(); }
  catch { throw new Error("Phone action failed. Check the Mirroring window, Accessibility permission and phone-tool configuration."); }
}
export async function phoneInfo(): Promise<PhoneWindow> {
  const raw = await command(["info"]), pairs = Object.fromEntries(raw.split(/\s+/).map(k => k.split("=")));
  if (!pairs.id) throw new Error("Open iPhone Mirroring and unlock its connection");
  return { id: Number(pairs.id), x: Number(pairs.x), y: Number(pairs.y), w: Number(pairs.w), h: Number(pairs.h), frontmost: pairs.frontmost === "true", trusted: pairs.trusted === "true" };
}
export async function phoneReadiness() { try { const window = await phoneInfo(); return { ready: window.trusted, window, message: window.trusted ? "Ready. Keep the connected phone locked and nearby." : "Grant Accessibility to the application running Agentcut in macOS settings." }; } catch (error) { return { ready: false, window: null, message: (error as Error).message }; } }
export async function act(action: PhoneAction, screenshot: string) {
  await command(["focus"]);
  const window = await phoneInfo();
  if (!window.frontmost || !window.trusted) throw new Error("Phone must be frontmost and Accessibility enabled");
  if (action.kind === "tap" || action.kind === "scroll") {
    if (action.x === undefined || action.y === undefined || action.x < 0 || action.x > 1 || action.y < 0 || action.y > 1) throw new Error("Coordinates must be normalized between 0 and 1");
    const args = [action.kind, String(Math.round(action.x * window.w)), String(Math.round(action.y * window.h))];
    if (action.kind === "scroll") args.push(String(action.amount ?? 0));
    await command(args);
  } else if (action.kind === "key") {
    if (!action.key || !/^(return|tab|space|delete|escape|left|right|up|down|[a-z0-9])$/.test(action.key)) throw new Error("Unsupported key");
    await command(["key", action.key, ...(action.modifier ? [action.modifier] : [])]);
  } else if (action.kind === "paste") await command(["paste", action.text ?? "", "3000"]);
  else if (action.kind === "home") await command(["key", "1", "cmd"]);
  await fs.mkdir(path.dirname(screenshot), { recursive: true });
  await exec("/usr/sbin/screencapture", ["-x", "-o", "-l", String(window.id), screenshot], { timeout: 15_000 });
  if (!(await fs.stat(screenshot)).size) throw new Error("Screen capture failed. Grant Screen Recording and restart the terminal.");
  return window;
}
