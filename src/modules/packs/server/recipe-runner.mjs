// The process a pack recipe runs in (decision 143). Plain JavaScript on purpose: it is
// started with `node --permission`, reads only the pack's folder and its own scratch
// folder, writes only the scratch folder, and has no network and no child processes.
// Everything that reaches the project goes back to the host over IPC, which runs it
// through the editor's own tools.
import { pathToFileURL } from "node:url";

let next = 0;
const waiting = new Map();

function request(method, payload) {
  const id = ++next;
  return new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject });
    process.send({ type: "request", id, method, payload });
  });
}

process.on("message", async (message) => {
  if (message.type === "reply") {
    const pending = waiting.get(message.id);
    if (!pending) return;
    waiting.delete(message.id);
    if (message.ok) pending.resolve(message.value);
    else pending.reject(new Error(message.error));
    return;
  }
  if (message.type !== "start") return;
  const ctx = {
    params: message.params,
    projectId: message.projectId,
    pack: message.pack,
    scratch: message.scratch,
    /** Font folders on this machine the recipe may read. */
    fonts: message.fonts,
    /** One editor tool call, e.g. `{ tool: "project.edit", expectedRevision, operations }`. */
    call: (toolRequest) => request("call", toolRequest),
    /** Where every item of a sequence starts and how long it lasts, in output seconds. */
    timeline: (sequenceId) => request("timeline", { sequenceId }),
    /** Put a file from the scratch folder in the library; resolves to the asset. */
    upload: (file, name) => request("upload", { file, name }),
    /** Run ffmpeg in the scratch folder. Paths are names inside it: no slashes. */
    ffmpeg: (args) => request("ffmpeg", { args }),
    log: (text) => process.send({ type: "log", text: String(text) }),
  };
  try {
    const module = await import(pathToFileURL(message.file).href);
    if (typeof module.default !== "function") throw new Error("A recipe's default export must be a function");
    const result = await module.default(ctx);
    process.send({ type: "done", result: result ?? null }, () => process.exit(0));
  } catch (error) {
    process.send({ type: "failed", error: error instanceof Error ? error.message : String(error) }, () => process.exit(1));
  }
});
