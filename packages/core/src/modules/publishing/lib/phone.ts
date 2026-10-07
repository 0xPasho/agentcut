import { PHONE_COMMAND_ERRORS } from "../data";
import { PhoneWindow } from "../types";

/** Only known diagnostics are surfaced: process errors may contain pasted text. */
export function phoneCommandFailure(error: unknown): string {
  if (error && typeof error === "object") {
    if ("code" in error && error.code === "ENOENT") return "Phone tool not found. Build it in Publishing settings or choose an existing executable.";
    if ("code" in error && error.code === "EACCES") return "The configured phone tool cannot run. Check its executable permission or rebuild it in Publishing settings.";
    if ("killed" in error && error.killed === true) return "The phone action timed out. Inspect the app before retrying; it may have received the input.";
    if ("stderr" in error && typeof error.stderr === "string") {
      const diagnostic = error.stderr.trim();
      if (Object.hasOwn(PHONE_COMMAND_ERRORS, diagnostic)) return PHONE_COMMAND_ERRORS[diagnostic];
    }
  }
  return "Phone action failed. Check the Mirroring window, Accessibility permission and phone-tool configuration.";
}

export function parsePhoneWindow(raw: string): PhoneWindow {
  const pairs = Object.fromEntries(raw.trim().split(/\s+/).map(value => value.split("=")));
  const parsed = PhoneWindow.safeParse({ id: Number(pairs.id), x: Number(pairs.x), y: Number(pairs.y), w: Number(pairs.w), h: Number(pairs.h), trusted: pairs.trusted === "true", frontmost: pairs.frontmost === "true" });
  if (!parsed.success) throw new Error("The phone tool returned invalid window information. Check that its info command reports a visible Mirroring window.");
  return parsed.data;
}
