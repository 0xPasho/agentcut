/**
 * The project's agent, as a chat.
 *
 * Everything here is the shared chat: the thread, the steps each run took, dropped
 * files, the harness picker. What this adds is the project — the editor's context
 * travels with every message, and the quick actions are this project's.
 */

/**
 * Quick actions are preset messages with a scope, nothing more: the same run as
 * typing them. Deterministic work (silence removal, template apply) has its own
 * buttons and never goes through here.
 */
export const QUICK_ACTIONS: Array<{ label: string; text: (selected: string | null) => string }> = [
  { label: "Suggest b-roll", text: (s) => `Suggest b-roll for ${s ? `"${s}"` : "this video"}: where a picture or a frame from the footage would help, and place the best ones with the template's image settings.` },
  { label: "Improve the hook", text: (s) => `Improve the hook of ${s ? `"${s}"` : "this video"}: tighten the first three seconds, propose a sharper title if the captions do not already say it, and keep the speaker's words.` },
  { label: "Reframe", text: (s) => `Check the framing of ${s ? `"${s}"` : "this video"} against the frames: keep the speaker centred, use a split when the frame is a screen share with a webcam, and fix crop keyframes where a face is cut off.` },
  { label: "Clean rhythm", text: (s) => `Clean the rhythm of ${s ? `"${s}"` : "this video"}: cut dead air over half a second except pauses doing rhetorical work, and add two to four punch-ins on the lines that land.` },
];

export const STYLES: Record<string, string> = {
  tool: "text-muted-foreground",
  text: "text-foreground",
  stage: "text-primary font-medium",
  error: "text-destructive",
  result: "text-foreground",
  editor: "text-muted-foreground",
  log: "text-muted-foreground/70",
};

/**
 * Pick the harness and the model, in one control, anywhere a prompt is typed.
 *
 * A rail of harnesses on the left, wearing their own brand marks, and that
 * harness's models on the right. Both halves are one decision: choosing a model
 * while browsing another harness switches the harness too, because "run this on
 * Sonnet" is not a sentence about Claude Code, it is a sentence about the next
 * message.
 *
 * Unavailable harnesses render DISABLED, never hidden. A missing row reads as
 * "Cursor is not a thing here", which is a different and wrong story from
 * "Cursor is installed but signed out" or "you cannot switch mid-run" — and each
 * of those three has a different fix, so each one says which it is.
 */
export const FAVOURITES = "*favourites*";

export const FAV_KEY = "agentcut:favourite-models";

/** Enough rows to be worth a shortcut; past nine the digits run out anyway. */
export const SHORTCUT_ROWS = 9;

/**
 * The project's conversation as a conversation.
 *
 * One thread, read top to bottom: what was asked, what the run did to answer it,
 * what it replied. The steps belong inside the turn that produced them — a separate
 * log panel makes the reader correlate two lists by eye, and nobody does that. Every
 * interface writes to this same thread, so a turn typed in a terminal over MCP shows
 * up here with its own steps.
 */
export const SOURCE_LABELS: Record<string, string> = { cli: "you · cli", mcp: "terminal agent", brief: "brief" };

/**
 * A project does not have to start from footage.
 *
 * Say what you want and this makes the project and hands the sentence to the agent;
 * drop a video and it starts from that; paste a link and it clips it. All three land
 * in the same editor with the conversation already open, because the first thing
 * somebody says is the most useful thing they will ever say about a video.
 */
export const SUGGESTIONS = [
  { label: "Explain something", text: "Make a 30-second explainer about " },
  { label: "From a link", text: "Find the best clips in https://" },
  { label: "A title card", text: "Start me a 9:16 video with a bold title card that says " },
];

/** The shapes on offer. A video's frame is the one decision that is awkward to change later. */
export const SHAPES = [
  { id: "", label: "Blank", note: "16:9", w: 32, h: 18 },
  { id: "9:16", label: "Vertical", note: "9:16", w: 18, h: 32 },
  { id: "4:5", label: "Portrait", note: "4:5", w: 24, h: 30 },
  { id: "1:1", label: "Square", note: "1:1", w: 28, h: 28 },
  { id: "16:9", label: "Wide", note: "16:9", w: 32, h: 18 },
];

/**
 * What an agent of ours may touch.
 *
 * `--permission-mode dontAsk` auto-approves everything that is not denied, so an
 * allowlist alone confines nothing: the denial is the fence. Transcripts come from
 * third-party video and are attacker-controlled text, so the fence has to cover every
 * way out of the working directory, not just the obvious one. A harness grows tools
 * between releases — a run was seen reaching for `Monitor` to run `node` once `Bash`
 * said no — so every door to a shell, a delegate or the network is named here, whether
 * or not the installed CLI has it yet.
 */
export const AGENT_FILE_TOOLS = ["Read", "Write", "Glob", "Grep"];
export const AGENT_DENIED_TOOLS = [
  "WebFetch", "WebSearch", "NotebookEdit",
  // Delegation: a subagent does not inherit this denial, so it is a way around it.
  "Task", "Agent", "Workflow", "SlashCommand", "Skill",
  // Shells, under each of the names one has gone by.
  "BashOutput", "KillShell", "KillBash", "Monitor",
];
/** The same fence with the shell itself shut, which is everywhere but clip selection. */
export const AGENT_SANDBOX_TOOLS = [...AGENT_DENIED_TOOLS, "Bash"];
