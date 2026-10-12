import type { CaptureRequest, Idea, ReferenceDraft, Save } from "../types";
import { developIdea } from "./develop";
import { queueDownload } from "./media";
import { createSave, getSave, setMedia } from "./saves";
import { appendToIdea, createIdea, getIdea } from "./store";

/** Keep one thing from the web, and start copying its video if it has one. */
export function save(input: ReferenceDraft): Save {
  const kept = createSave(input);
  if (kept.mediaStatus === "pending") queueDownload(kept.id);
  return kept;
}

/** Try the video again: a login wall or a network blip the first time is not forever. */
export function retryDownload(id: string): Save {
  const kept = getSave(id);
  if (!kept) throw new Error(`No save ${id}`);
  if (kept.mediaStatus === "done") return kept;
  setMedia(id, "pending");
  queueDownload(id);
  return getSave(id)!;
}

/**
 * An idea from saves already kept and any new ones sent with it, and optionally the
 * harnesses to develop it with right away. The board, the library and the extension
 * all come in through here, so there is one way an idea is made.
 */
export async function capture(request: CaptureRequest): Promise<Idea> {
  const saves = [
    ...request.saveIds.map((id) => {
      const found = getSave(id);
      if (!found) throw new Error(`No save ${id}`);
      return found;
    }),
    ...request.refs.map(save),
  ];
  const idea = request.ideaId
    ? appendToIdea(request.ideaId, { note: request.note, saves })
    : createIdea({ title: request.title, note: request.note, saves });
  if (request.develop) await developIdea(idea.id, request.develop);
  return getIdea(idea.id) ?? idea;
}
