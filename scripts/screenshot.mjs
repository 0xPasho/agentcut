// Screenshot a page of the running app with Remotion's headless Chrome over CDP.
// usage: node scripts/screenshot.mjs <url> <out.png> [waitMs]
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

const [url, out, wait = "8000"] = process.argv.slice(2);
const bin = "node_modules/.remotion/chrome-headless-shell/mac-arm64/chrome-headless-shell-mac-arm64/chrome-headless-shell";
const port = 9333;
const child = spawn(bin, [
  "--remote-debugging-port=" + port, "--no-sandbox", "--disable-gpu", "--hide-scrollbars",
  "--window-size=1600,1000", "--autoplay-policy=no-user-gesture-required", "about:blank",
], { stdio: "ignore" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws;
try {
  let targets;
  for (let i = 0; i < 40; i++) {
    try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); break; } catch { await sleep(250); }
  }
  const page = targets.find((t) => t.type === "page");
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const pending = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 1000, deviceScaleFactor: 2, mobile: false });
  await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }] });
  await send("Page.enable");
  await send("Page.navigate", { url });
  await sleep(Number(wait));
  await send("Runtime.evaluate", { expression: "document.querySelectorAll('nextjs-portal').forEach(e=>e.remove()); [...document.querySelectorAll('video')].map(v=>v.readyState+':'+v.videoWidth).join(',')", returnByValue: true }).then(r=>console.log("videos", r.result?.result?.value));
  const shot = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(out, Buffer.from(shot.result.data, "base64"));
  console.log("wrote", out);
} finally {
  ws?.close(); child.kill("SIGKILL");
}
