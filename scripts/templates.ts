/** Headless access to the SAME templates as the editor panel and the agent tools. */
import { executeEditorTool } from "../src/lib/editor/tools";
import { listTemplates, getTemplate } from "../src/lib/templates/registry";

const USAGE = `usage:
  templates list
  templates show <templateId>
  templates plan  <projectId> <templateId> [--sequence ID] [--hook "line"]
                  [--slot name=/path/to/folder] [--text name="a line"] [--asset name=ASSET_ID]
  templates apply <projectId> <templateId> [same options]

  --slot fills an image-pool slot from a folder; --text fills a text slot (a card's
  line); --asset fills an image, video or audio slot (a logo, an end card, a music bed) with an asset id.`;

type Slot = { folder?: string; text?: string; assetId?: string };
type Options = { sequenceId?: string; hookText?: string; slots: Record<string, Slot> };

/** Split on the FIRST "=", so a folder containing one survives. */
function splitOnce(value: string): [string, string | undefined] {
  const at = value.indexOf("=");
  return at < 0 ? [value, undefined] : [value.slice(0, at), value.slice(at + 1)];
}

function options(rest: string[]): Options {
  const parsed: Options = { slots: {} };
  for (let i = 0; i < rest.length; i++) {
    const [flag, inline] = splitOnce(rest[i]);
    const value = inline ?? rest[++i];
    if (value === undefined) throw new Error(`${flag} needs a value\n\n${USAGE}`);
    if (flag === "--sequence") parsed.sequenceId = value;
    else if (flag === "--hook") parsed.hookText = value;
    else if (flag === "--slot" || flag === "--text" || flag === "--asset") {
      const [name, content] = splitOnce(value);
      if (!content) throw new Error(`${flag} takes name=value, e.g. ${flag} ${flag === "--slot" ? "screenshots=~/Desktop/shots" : flag === "--text" ? 'cta="Follow for part two"' : "logo=a_1234abcd"}`);
      parsed.slots[name] = flag === "--slot" ? { folder: content } : flag === "--text" ? { text: content } : { assetId: content };
    } else throw new Error(`unknown option: ${flag}\n\n${USAGE}`);
  }
  return parsed;
}

async function main() {
  const [mode, ...rest] = process.argv.slice(2);
  if (!mode || mode === "list") {
    for (const template of await listTemplates())
      console.log(`${template.id.padEnd(18)} ${template.builtin ? "built-in" : "yours   "}  ${template.name} — ${template.description}`);
    return;
  }
  if (mode === "show") {
    if (!rest[0]) throw new Error(USAGE);
    console.log(JSON.stringify(await getTemplate(rest[0]), null, 2));
    return;
  }
  if (mode !== "plan" && mode !== "apply") throw new Error(USAGE);
  const [projectId, templateId, ...flags] = rest;
  if (!projectId || !templateId) throw new Error(USAGE);
  const { sequenceId, hookText, slots } = options(flags);
  const request = { templateId, ...(sequenceId ? { sequenceId } : {}), ...(hookText ? { hookText } : {}), slots };
  if (mode === "plan") {
    console.log(JSON.stringify(await executeEditorTool(projectId, { tool: "template.plan", ...request }), null, 2));
    return;
  }
  // Read the current revision here rather than asking the caller to find it; a
  // concurrent save still fails the batch, which is the point of the check.
  const { revision } = await executeEditorTool(projectId, { tool: "project.read" }) as { revision: number };
  console.log(JSON.stringify(await executeEditorTool(projectId, { tool: "template.apply", ...request, expectedRevision: revision }), null, 2));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
