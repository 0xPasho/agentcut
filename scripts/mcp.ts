/** The editor as an MCP server over stdio. Register it once with your coding agent; see RULES.md. */
import { serveMcp } from "../src/lib/mcp";
import { createRequire } from "node:module";
const version = (createRequire(import.meta.url)("../package.json") as { version?: string }).version ?? "0";
serveMcp(process.stdin, process.stdout, version).then(() => process.exit(0));
