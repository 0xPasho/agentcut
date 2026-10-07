const encoder = new TextEncoder();

export function randomToken(bytes = 32): string {
  const buf = crypto.getRandomValues(new Uint8Array(bytes));
  return base64url(buf);
}

export function base64url(buf: Uint8Array): string {
  let s = "";
  for (const b of buf) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** No vowels (no words), no 0/O/1/I lookalikes. */
const USER_CODE_ALPHABET = "BCDFGHJKLMNPQRSTVWXZ";

export function userCode(): string {
  const buf = crypto.getRandomValues(new Uint8Array(8));
  const chars = [...buf].map((b) => USER_CODE_ALPHABET[b % USER_CODE_ALPHABET.length]);
  return `${chars.slice(0, 4).join("")}-${chars.slice(4).join("")}`;
}

/** Normalises what a person types: case, spaces, a missing dash. */
export function normaliseUserCode(input: string): string {
  const raw = input.toUpperCase().replace(/[^A-Z]/g, "");
  if (raw.length !== 8) return input.trim().toUpperCase();
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}

export function decodeBase64(b64: string): Uint8Array | null {
  try {
    const bin = atob(b64.replace(/\s+/g, ""));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}
