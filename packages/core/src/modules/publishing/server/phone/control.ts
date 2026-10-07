import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { ASSETS, WORKSPACE } from "../../../../common/server/config";
import type { PhoneAction, PhoneWindow } from "../../types";
import { parsePhoneWindow, phoneCommandFailure } from "../../lib/phone";
import { settings } from "../store";

const exec = promisify(execFile);
export const phoneBinary = () => settings().phoneBinary || process.env.AGENTCUT_PHONECTL || path.join(WORKSPACE, "publishing", "bin", "phonectl");
export async function buildPhoneTool() {
  if (process.platform !== "darwin") throw new Error("iPhone Mirroring requires macOS");
  const binary = path.join(WORKSPACE, "publishing", "bin", "phonectl");
  await fs.mkdir(path.dirname(binary), { recursive: true });
  await exec("/usr/bin/swiftc", ["-O", path.join(ASSETS, "tools", "publishing-phone.swift"), "-o", binary], { timeout: 120_000 });
  return { built: true };
}
async function command(args: string[]) {
  if (process.platform !== "darwin") throw new Error("iPhone Mirroring requires macOS");
  try { const { stdout } = await exec(phoneBinary(), args, { timeout: 30_000, maxBuffer: 1024 * 1024 }); return stdout.trim(); }
  catch (error) { throw new Error(phoneCommandFailure(error)); }
}
export async function phoneInfo(): Promise<PhoneWindow> {
  return parsePhoneWindow(await command(["info"]));
}
async function captureWindow(window: PhoneWindow, screenshot: string) {
  await fs.mkdir(path.dirname(screenshot), { recursive: true });
  try {
    await exec("/usr/sbin/screencapture", ["-x", "-o", "-l", String(window.id), screenshot], { timeout: 15_000 });
    if (!(await fs.stat(screenshot)).size) throw new Error("Empty capture");
  } catch {
    throw new Error("Could not capture the Mirroring window. Keep it open, grant Screen Recording to the application running Agentcut, then restart that application and check again.");
  }
}
export async function phoneReadiness() {
  let directory: string | undefined;
  try {
    const window = await phoneInfo();
    if (!window.trusted) return { ready: false, window, message: "Grant Accessibility to the application running Agentcut in macOS settings." };
    directory = await fs.mkdtemp(path.join(os.tmpdir(), "agentcut-phone-check-"));
    await captureWindow(window, path.join(directory, "check.png"));
    return { ready: true, window, message: "Mac input and screen capture are ready. Verify the iPhone connection and account in the attended session." };
  } catch (error) { return { ready: false, window: null, message: (error as Error).message }; }
  finally { if (directory) await fs.rm(directory, { recursive: true, force: true }); }
}
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
  await captureWindow(window, screenshot);
  return window;
}
