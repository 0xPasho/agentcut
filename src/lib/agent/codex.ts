import { which } from "../bin";
import { spawnStream, makeEvent } from "./spawn";
import type { AgentEvent, AgentProvider, AgentResult, AgentRunOptions } from "./types";

/**
 * Codex CLI in headless mode. `workspace-write` confines writes to --cd,
 * which is always the per-project workspace dir.
 */
export const codexProvider: AgentProvider = {
  id: "codex",
  label: "Codex",

  async available() {
    return (await which("codex")) !== null;
  },

  async run(opts: AgentRunOptions): Promise<AgentResult> {
    const started = Date.now();
    const events: AgentEvent[] = [];
    const emit = (e: AgentEvent) => {
      events.push(e);
      opts.onEvent?.(e);
    };

    const args = [
      "exec",
      "--json",
      "--cd", opts.cwd,
      "--sandbox", "workspace-write",
      "--skip-git-repo-check",
    ];
    if (opts.model) args.push("--model", opts.model);
    args.push(opts.prompt);

    let text = "";

    const res = await spawnStream("codex", args, {
      cwd: opts.cwd,
      timeoutMs: opts.timeoutMs ?? 15 * 60_000,
      onStderr: (c) => emit(makeEvent("log", c)),
      onLine: (line) => {
        let msg: Record<string, unknown>;
        try {
          msg = JSON.parse(line);
        } catch {
          emit(makeEvent("log", line));
          return;
        }
        const type = String(msg.type ?? "");
        if (type.includes("agent_message") && typeof msg.message === "string") {
          text = msg.message;
          emit(makeEvent("text", msg.message));
        } else if (type.includes("command") || type.includes("exec")) {
          const cmd = Array.isArray(msg.command) ? msg.command.join(" ") : String(msg.command ?? "");
          if (cmd) emit(makeEvent("tool", cmd.slice(0, 200), "Bash"));
        } else if (type.includes("error")) {
          emit(makeEvent("error", JSON.stringify(msg).slice(0, 500)));
        }
      },
    });

    if (!text) text = events.filter((e) => e.kind === "text").map((e) => e.text).join("\n");
    if (res.code !== 0 && !text) {
      throw new Error(`codex exited ${res.code}: ${res.stderr.slice(-800)}`);
    }

    emit(makeEvent("result", text));
    return { provider: "codex", text, events, durationMs: Date.now() - started };
  },
};
