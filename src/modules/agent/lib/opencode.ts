import { harnessBinary, spawnable } from "../server/binary";
import { spawnStream, makeEvent } from "../server/spawn";
import type { AgentEvent, AgentProvider, AgentResult, AgentRunOptions } from "../types";

/**
 * OpenCode in one-shot mode: `opencode run --format json`.
 *
 * Deska drives OpenCode through `opencode serve` and its HTTP API because it
 * needs a resumable session per thread. We do not: a run here is one prompt,
 * one answer, and `run` is that same engine with none of the port allocation,
 * readiness polling or server teardown to get wrong.
 *
 * Events are `{type, part}` envelopes rather than a message tree — `text`
 * parts carry the answer, `tool` parts the calls, `step_finish` the cost.
 *
 * Confinement: OpenCode's permission rules live in its config file, not in
 * flags, so `allowedTools`/`deniedTools` cannot be applied per run. `--auto`
 * approves what the user's own config does not deny, and `--dir` pins the run
 * to the per-project scratch dir.
 */
export const opencodeProvider: AgentProvider = {
  id: "opencode",
  label: "OpenCode",

  async available() {
    return harnessBinary("opencode") !== null;
  },

  async run(opts: AgentRunOptions): Promise<AgentResult> {
    const started = Date.now();
    const events: AgentEvent[] = [];
    const emit = (e: AgentEvent) => {
      events.push(e);
      opts.onEvent?.(e);
    };

    const args = ["run", "--format", "json", "--auto", "--dir", opts.cwd];
    if (opts.model) args.push("--model", opts.model);
    // The prompt is a positional rest arg; `--` keeps a prompt that starts with
    // a dash from being read as a flag.
    args.push("--", opts.prompt);

    let text = "";
    let costUsd: number | undefined;
    let sessionId: string | undefined;

    const res = await spawnStream(spawnable("opencode"), args, {
      cwd: opts.cwd,
      timeoutMs: opts.timeoutMs ?? 15 * 60_000,
      onStderr: (c) => emit(makeEvent("log", c)),
      onLine: (line) => {
        let msg: Record<string, unknown>;
        try {
          msg = JSON.parse(line) as Record<string, unknown>;
        } catch {
          emit(makeEvent("log", line));
          return;
        }
        sessionId ??= typeof msg.sessionID === "string" ? msg.sessionID : undefined;
        const part = (msg.part ?? {}) as Record<string, unknown>;

        if (msg.type === "text" && typeof part.text === "string") {
          // Parts arrive whole, one per assistant turn; the last one is the
          // answer, earlier ones are the steps that led to it.
          text = part.text;
          emit(makeEvent("text", part.text));
        } else if (msg.type === "tool") {
          const state = (part.state ?? {}) as Record<string, unknown>;
          const name = typeof part.tool === "string" ? part.tool : "tool";
          emit(makeEvent("tool", JSON.stringify(state.input ?? {}), name));
        } else if (msg.type === "step_finish") {
          if (typeof part.cost === "number") costUsd = (costUsd ?? 0) + part.cost;
        } else if (msg.type === "error") {
          emit(makeEvent("error", JSON.stringify(part)));
        }
      },
    });

    if (res.code !== 0 && !text) {
      throw new Error(`opencode exited ${res.code}: ${res.stderr.trim().split("\n").slice(-4).join("\n")}`);
    }

    return {
      provider: "opencode",
      text,
      events,
      durationMs: Date.now() - started,
      ...(costUsd !== undefined ? { costUsd } : {}),
      ...(sessionId ? { sessionId } : {}),
    };
  },
};
