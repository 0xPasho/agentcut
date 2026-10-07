/** Every command the CLI answers to, with the line `agentcut help` prints for it. */
export const COMMANDS = {
  studio: { kind: "studio", help: "open the visual editor in your browser [--port 7927] [--no-open] (the default command)" },
  projects: { kind: "command", entry: "projects", help: 'list | create "Project name" video1.mp4 ... | batch "Set name" [--brief "..."] video1.mp4 video2.mp4 ...' },
  edit: { kind: "command", entry: "edit", help: "headless editor: <projectId> [read | call req.json | ask ...]" },
  render: { kind: "command", entry: "render", help: "render clips: <projectId|edl.json> [--only id,id]" },
  mcp: { kind: "command", entry: "mcp", help: "serve the editor tools over MCP (stdio) for Claude Code, Codex or OpenCode" },
  packs: { kind: "command", entry: "packs", help: "list | search [text] | install <name[@version]> | publish <folder> | inspect <path|url> | import <path|url> [--replace] | recipes | trust <packId> | untrust <packId> | run <projectId> <packId> <recipeId> [--param name=value ...]" },
  rules: { kind: "command", entry: "rules", help: "list | show <id> | evaluate <projectId> [--sequence ID] | apply <projectId> <ruleId,...> [--sequence ID] | glossary | preferences" },
  templates: { kind: "command", entry: "templates", help: "list | show <id> | plan|apply <projectId> <templateId> [--sequence ID] [--slot name=folder] [--text name=line] [--asset name=id]" },
  workspace: { kind: "command", entry: "workspace", help: "export [file] | preview file | restore file --replace — move your profile, packs and saved workspace data" },
  publishing: { kind: "command", entry: "publishing", help: "list | call request.json | tick — shared publishing commands" },
  login: { kind: "command", entry: "account", help: "sign in to the packs marketplace from this machine" },
  logout: { kind: "command", entry: "account", help: "forget this machine's marketplace sign-in" },
  whoami: { kind: "command", entry: "account", help: "who this machine is signed in to the marketplace as" },
  runtime: { kind: "command", entry: "runtime", help: "status | install <ffmpeg|render|studio|all> | prune | path — the parts downloaded on first use" },
  dev: { kind: "studio", help: "checkout only: the studio's Next dev server" },
  start: { kind: "studio", help: "checkout only: the studio's built Next server" },
} as const satisfies Record<string, { kind: "studio"; help: string } | { kind: "command"; entry: string; help: string }>;

export type CommandName = keyof typeof COMMANDS;

export const isCommand = (name: string): name is CommandName => Object.hasOwn(COMMANDS, name);

export function usage() {
  const lines = Object.entries(COMMANDS).map(([name, spec]) => `  ${name.padEnd(10)} ${spec.help}`);
  return [
    "usage: agentcut [command] [args…]",
    "",
    "With no command, agentcut opens the studio.",
    "",
    ...lines,
    "",
    "  --dry-run   print the resolved command as JSON instead of running it",
    "  --version   print the version",
  ].join("\n");
}
