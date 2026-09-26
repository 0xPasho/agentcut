/** Packs from the terminal: the same functions behind Settings → Packs and the pack tools. */
import { inspectPack, importPack, listPacks } from "../src/modules/packs/server/packs";
import { listRecipes, runRecipe, trustRecipes } from "../src/modules/packs/server/recipes";
import { formatActivity } from "../src/modules/project/lib/activity";

const USAGE = "usage: agentcut packs list | inspect <path|url> | import <path|url> [--replace] | recipes | trust <packId> | untrust <packId> | run <projectId> <packId> <recipeId> [--param name=value ...]";

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const print = (value: unknown) => console.log(JSON.stringify(value, null, 2));
  if (command === "list") return print(await listPacks());
  if (command === "inspect" && rest[0]) return print(await inspectPack(rest[0]));
  if (command === "import" && rest[0]) return print(await importPack(rest[0], { replace: rest.includes("--replace") }));
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
