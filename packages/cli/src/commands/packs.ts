/** Packs from the terminal: the same functions behind Settings → Packs and the pack tools. */
import { inspectPack, importPack, listPacks } from "@agentcut/core/modules/packs/server/packs";
import { listRecipes, runRecipe, trustRecipes } from "@agentcut/core/modules/packs/server/recipes";
import { formatActivity } from "@agentcut/core/modules/project/lib/activity";
import { marketSource, marketUrl, searchPacks, submitUrl } from "@agentcut/core/modules/packs/server/market";
import { spawn } from "node:child_process";

const USAGE = "usage: agentcut packs list | search [text] | install <name[@version]> [--replace] | submit [owner/repo] | inspect <path|url> | import <path|url> [--replace] | recipes | trust <packId> | untrust <packId> | run <projectId> <packId> <recipeId> [--param name=value ...]";

function openBrowser(url: string) {
  const [cmd, args] = process.platform === "darwin" ? ["open", [url]] : process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : ["xdg-open", [url]];
  const child = spawn(cmd, args, { stdio: "ignore", detached: true });
  child.on("error", () => {});
  child.unref();
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const print = (value: unknown) => console.log(JSON.stringify(value, null, 2));
  if (command === "list") return print(await listPacks());
  if (command === "inspect" && rest[0]) return print(await inspectPack(rest[0]));
  if (command === "import" && rest[0]) return print(await importPack(rest[0], { replace: rest.includes("--replace") }));
  if (command === "search") {
    const packs = await searchPacks(rest.filter((a) => !a.startsWith("--")).join(" "));
    if (rest.includes("--json")) return print(packs);
    if (!packs.length) return console.log(`Nothing on ${marketUrl()} matches.`);
    for (const p of packs) console.log(`${p.name.padEnd(24)} ${p.latest.padEnd(8)} ${String(p.stars).padStart(6)} ★  ${p.title} — ${p.owner.login}${p.counts.recipes ? "  [recipes]" : ""}`);
    return console.log(`\nInstall one with: agentcut packs install <name>`);
  }
  // A marketplace pack is a URL import: the same preview, checks and copy as any other.
  if (command === "install" && rest[0]) {
    const source = await marketSource(rest[0]);
    const preview = await inspectPack(source);
    console.error(`Installing ${preview.manifest.name} ${preview.manifest.version} from ${source}`);
    if (preview.recipes.recipes.length) console.error(`It carries ${preview.recipes.recipes.length} recipe(s): code that runs only after you trust it (agentcut packs trust ${preview.manifest.id}).`);
    return print(await importPack(source, { replace: rest.includes("--replace") }));
  }
  // A pack lives in its own GitHub repository, and the GitHub account that owns it is who
  // may list it, so submitting happens in the browser rather than from a token here.
  if (command === "submit") {
    const url = submitUrl(rest.find((a) => !a.startsWith("--")));
    console.log(`Submit your pack at:\n  ${url}\n\nIt has to be a public GitHub repository with a pack.json in it.`);
    if (!rest.includes("--no-open")) openBrowser(url);
    return;
  }
  if (command === "recipes") return print(await listRecipes());
  // Trusting code is a person's decision, taken here or on the pack's page (decision 143).
  if ((command === "trust" || command === "untrust") && rest[0]) {
    const pack = await trustRecipes(rest[0], command === "trust");
    return console.log(`${pack.name}: recipes ${pack.trustedRecipesHash ? `trusted (${pack.trustedRecipesHash.slice(0, 12)})` : "not trusted"}`);
  }
  if (command === "run" && rest.length >= 3) {
    const [projectId, pack, recipe, ...flags] = rest;
    const params: Record<string, string> = {};
    for (let i = 0; i < flags.length; i++) {
      if (flags[i] !== "--param") continue;
      const [name, ...value] = (flags[++i] ?? "").split("=");
      params[name] = value.join("=");
    }
    const result = await runRecipe(projectId, { pack, recipe, params }, (e) => process.stderr.write(`${formatActivity({ ...e, at: Date.now() })}\n`));
    return print(result);
  }
  throw new Error(USAGE);
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
