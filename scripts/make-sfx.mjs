/**
 * The starter sounds that ship with the app, synthesised rather than downloaded so
 * they carry no licence and work with no network. Run `node scripts/make-sfx.mjs`
 * after changing one; the files it writes are committed.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ffmpeg from "ffmpeg-static";

const run = promisify(execFile);
const out = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public", "sfx");

/** Expressions carry no commas: a comma inside a lavfi description starts a new filter. */
const SOUNDS = [
  { name: "ding", d: 1.4, expr: "0.5*sin(2*PI*880*t)*exp(-5*t)+0.25*sin(2*PI*1320*t)*exp(-8*t)" },
  { name: "pop", d: 0.35, expr: "0.8*sin(2*PI*(180+700*exp(-30*t))*t)*exp(-22*t)" },
  { name: "impact", d: 1.2, expr: "0.9*sin(2*PI*(55+45*exp(-12*t))*t)*exp(-5*t)" },
  { name: "riser", d: 1.6, expr: "0.4*sin(2*PI*(220+950*t*t)*t)*(t/1.6)" },
  { name: "click", d: 0.12, expr: "0.7*(random(0)*2-1)*exp(-90*t)" },
  { name: "whoosh", d: 0.8, expr: "0.6*(random(0)*2-1)*sin(PI*t/0.8)", af: "highpass=f=500,lowpass=f=7000" },
  { name: "swipe", d: 0.5, expr: "0.5*(random(0)*2-1)*exp(-9*t)", af: "highpass=f=1600" },
  { name: "sparkle", d: 1.2, expr: "0.3*sin(2*PI*2200*t)*exp(-7*t)+0.2*sin(2*PI*3300*t)*exp(-5*t)+0.15*sin(2*PI*4400*t)*exp(-9*t)" },
];

await mkdir(out, { recursive: true });
for (const sound of SOUNDS) {
  const fade = Math.min(0.05, sound.d / 4);
  const chain = [sound.af, `afade=t=out:st=${(sound.d - fade).toFixed(3)}:d=${fade.toFixed(3)}`].filter(Boolean).join(",");
  const file = path.join(out, `${sound.name}.mp3`);
  await run(ffmpeg, [
    "-y", "-f", "lavfi", "-i", `aevalsrc=${sound.expr}:d=${sound.d}:s=44100`,
    "-af", chain, "-ac", "1", "-c:a", "libmp3lame", "-q:a", "6", file,
  ]);
  console.log(`wrote ${path.relative(process.cwd(), file)}`);
}
