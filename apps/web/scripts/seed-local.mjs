// Publishes the example packs in <repo>/packs into the LOCAL dev server through the real API.
// usage: pnpm seed:local [baseUrl]   (default http://localhost:8787; needs `pnpm dev` running)
// The dev server must run with DEV_LOGIN=1, which `pnpm dev` sets: the token comes from
// POST /api/dev/token, which does not exist otherwise.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const base = (process.argv[2] ?? process.env.AGENTCUT_WEB ?? "http://localhost:8787").replace(/\/$/, "");
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const packsDir = path.join(repo, "packs");

async function walk(dir, prefix = "") {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === ".DS_Store") continue;
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...(await walk(path.join(dir, entry.name), rel)));
    else out.push(rel);
  }
  return out;
}

async function json(res) {
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { error: text.slice(0, 200) }; }
}

const tokenRes = await fetch(`${base}/api/dev/token`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ login: "pasho" }),
}).catch((err) => {
  console.error(`Cannot reach ${base}. Start it first: pnpm --filter @agentcut/web dev\n${err.message}`);
  process.exit(1);
});
if (!tokenRes.ok) {
  console.error(`POST /api/dev/token → ${tokenRes.status}. Is the dev server running with DEV_LOGIN=1?`, await json(tokenRes));
  process.exit(1);
}
const { token, user } = await tokenRes.json();
console.log(`Publishing as ${user.login} to ${base}`);

let failed = 0;
for (const name of (await readdir(packsDir, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name).sort()) {
  const dir = path.join(packsDir, name);
  const files = await Promise.all(
    (await walk(dir)).map(async (rel) => ({ path: rel, base64: (await readFile(path.join(dir, rel))).toString("base64") })),
  );
  const res = await fetch(`${base}/api/packs`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ files }),
  });
  const body = await json(res);
  if (res.status === 201) console.log(`  published ${body.name}@${body.version} (${files.length} files) → ${body.url}`);
  else if (res.status === 409) console.log(`  ${name}: this version is already published`);
  else {
    failed++;
    console.error(`  ${name}: ${res.status}`, body);
  }
}
process.exit(failed ? 1 : 0);
