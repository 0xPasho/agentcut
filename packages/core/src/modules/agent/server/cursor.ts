import { harnessBinary, spawnable } from "./binary";
import { spawnStream, makeEvent } from "./spawn";
import type { AgentEvent, AgentProvider, AgentResult, AgentRunOptions } from "../types";

/**
 * Cursor Agent in print mode.
 *
 * `cursor-agent -p --output-format stream-json` emits the same envelope shape
 * as Claude Code's stream-json (system/user/assistant/result), so the parsing
 * below reads familiar on purpose.
 *
 * Confinement is weaker here than for the other two, and it is worth being
 * plain about it. Cursor has no per-tool allow/deny flags, so `allowedTools`
 * and `deniedTools` cannot be honoured; what we get instead is `--sandbox
 * enabled`, which is OS-level and applies to every tool at once. Print mode
 * also blocks on an approval prompt forever without `--force`, so the choice is
 * between `--force` inside the sandbox and a run that hangs. We take the
 * sandbox. `--workspace` pins the roots to the per-project scratch dir, the
 * same boundary every other provider gets.
 */
export const cursorProvider: AgentProvider = {
  id: "cursor",
  label: "Cursor",

  async available() {
    return harnessBinary("cursor") !== null;
  },

  async run(opts: AgentRunOptions): Promise<AgentResult> {
    const started = Date.now();
    const events: AgentEvent[] = [];
    const emit = (e: AgentEvent) => {
      events.push(e);
      opts.onEvent?.(e);
    };

    const args = [
      "-p", opts.prompt,
      "--output-format", "stream-json",
      // The directory is ours and freshly created per run; asking a headless
      // process to answer a trust prompt is asking it to hang.
      "--trust",
      "--force",
      "--sandbox", "enabled",
      "--workspace", opts.cwd,
    ];
    if (opts.model) args.push("--model", opts.model);

    let text = "";
    let sessionId: string | undefined;

    const res = await spawnStream(spawnable("cursor"), args, {
      cwd: opts.cwd,
      idleMs: opts.idleMs ?? 10 * 60_000,
      maxMs: opts.timeoutMs ?? 2 * 60 * 60_000,
      busy: opts.busy,
      onStderr: (c) => emit(makeEvent("log", c)),
      onLine: (line) => {
        let msg: Record<string, unknown>;
        try {
          msg = JSON.parse(line) as Record<string, unknown>;
        } catch {
          // A usage-limit refusal arrives as a bare line, not as JSON. Losing it
          // would turn "you are out of quota" into an empty successful run.
          emit(makeEvent("log", line));
          return;
        }
        sessionId ??= typeof msg.session_id === "string" ? msg.session_id : undefined;

        if (msg.type === "assistant") {
          const content = (msg.message as { content?: Array<Record<string, unknown>> })?.content ?? [];
          for (const block of content) {
            if (block.type === "text" && typeof block.text === "string") {
              text = block.text;
              emit(makeEvent("text", block.text));
            } else if (block.type === "tool_use") {
              emit(makeEvent("tool", JSON.stringify(block.input ?? {}), String(block.name ?? "")));
            }
          }
        } else if (msg.type === "result") {
          if (typeof msg.result === "string" && msg.result) text = msg.result;
          if (msg.subtype && msg.subtype !== "success") {
            emit(makeEvent("error", String(msg.result ?? msg.subtype)));
          }
        }
      },
    });

    if (res.code !== 0 && !text) {
      throw new Error(`cursor-agent exited ${res.code}: ${res.stderr.trim().split("\n").slice(-4).join("\n")}`);
    }

    return { provider: "cursor", text, events, durationMs: Date.now() - started, ...(sessionId ? { sessionId } : {}) };
  },
};
