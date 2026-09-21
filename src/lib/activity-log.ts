import { q } from "./db";
import { describeToolCall, describeToolResult } from "./activity";
import { executeEditorTool, type ToolActivity } from "./editor/tools";

/**
 * Running an editor tool where everyone can see it.
 *
 * Whoever drives the editor — the human clicking in the UI, a terminal agent over
 * MCP, the CLI — writes the same lines into the project's feed, so the browser shows
 * the work of the terminal and the terminal can poll for the work of the browser.
 * There is one editor; there should be one account of what it is doing.
 */

/** Reading something is not activity: polling for status would otherwise fill the feed. */
export const QUIET_TOOL = /\.(read|list|get|schema|status|looks|preview|providers|browseLocal)$/;

export type ToolSource = "web" | "mcp" | "cli";

/** Put one line in the project's feed, from whichever interface produced it. */
export function recordActivity(projectId: string, e: { kind: string; name?: string | null; text: string }, via: ToolSource) {
  q.insertEvent({ project_id: projectId, job_id: null, kind: e.kind, name: e.name ?? via, text: e.text.slice(0, 2000), at: Date.now() });
}

export async function runReportedTool(projectId: string, request: unknown, o: { via: ToolSource; onActivity?: ToolActivity } = { via: "web" }) {
  const call = describeToolCall(request);
  if (QUIET_TOOL.test(call.name)) return executeEditorTool(projectId, request, o.onActivity);

  const label = `${o.via}:${call.name}`;
  const report: ToolActivity = (e) => {
    o.onActivity?.(e);
    q.insertEvent({ project_id: projectId, job_id: null, kind: e.kind, name: e.name ?? label, text: e.text.slice(0, 2000), at: Date.now() });
  };
  report({ kind: "tool", name: label, text: call.text });
  const started = Date.now();
  try {
    const data = await executeEditorTool(projectId, request, report);
    const outcome = describeToolResult(call.name, data);
    const took = Date.now() - started;
    if (outcome || took > 1500) report({ kind: "log", name: label, text: [outcome, took > 1500 ? `${(took / 1000).toFixed(1)}s` : ""].filter(Boolean).join(" · ") });
    return data;
  } catch (error) {
    report({ kind: "error", name: label, text: (error as Error).message });
    throw error;
  }
}
