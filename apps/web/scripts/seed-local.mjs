// Registers the example packs in this repository with the LOCAL dev server, through the
// real submit form, so a `pnpm dev` marketplace has something in it.
//
// usage: pnpm seed:local [baseUrl] [owner/repo]
//   baseUrl    default http://localhost:8787; needs `pnpm dev` running
//   owner/repo default 0xPasho/agentcut — any public repository with packs/<name>/pack.json
//
// This one reaches GitHub: a pack is a repository, and the server reads it to list it.
// The dev server must run with DEV_LOGIN=1 (which `pnpm dev` sets), because the submitter
// has to be the repository's owner and `x-dev-login` is how we say who that is locally.
import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const base = (process.argv[2] ?? process.env.AGENTCUT_WEB ?? "http://localhost:8787").replace(/\/$/, "");
const slug = process.argv[3] ?? process.env.AGENTCUT_PACKS_REPO ?? "0xPasho/agentcut";
const [owner, repo] = slug.split("/");
if (!owner || !repo) {
  console.error(`Not a repository: ${slug}. Use owner/repo.`);
  process.exit(1);
}
const packsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../packs");

const names = (await readdir(packsDir, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name).sort();
console.log(`Submitting ${names.length} packs from github.com/${slug} as ${owner} to ${base}`);

let failed = 0;
for (const name of names) {
  const res = await fetch(`${base}/submit`, {
    method: "POST",
    redirect: "manual",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      // The submit form is same-origin only, and this stands in for the browser's own header.
      origin: base,
      "x-dev-login": owner,
    },
    body: new URLSearchParams({ repo: `${owner}/${repo}`, folder: `packs/${name}` }),
  }).catch((err) => {
    console.error(`Cannot reach ${base}. Start it first: pnpm --filter @agentcut/web dev\n${err.message}`);
    process.exit(1);
  });
  if (res.status === 303) {
    console.log(`  listed packs/${name} → ${res.headers.get("location")}`);
    continue;
  }
  // The form answers with its own page and the reason in it; show the first alert.
  const text = await res.text();
  const reason = /role="alert"[^>]*>([\s\S]*?)<\/p>/.exec(text)?.[1]?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  failed++;
  console.error(`  packs/${name}: ${res.status} ${reason ?? ""}`);
}
process.exit(failed ? 1 : 0);
