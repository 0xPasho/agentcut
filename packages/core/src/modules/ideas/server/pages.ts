import type { IdeasPageData, SavesPageData } from "../types";
import { resumeDownloads } from "./media";
import { listSaves } from "./saves";
import { listIdeas } from "./store";

export function loadIdeas(params: { open?: string | string[] } = {}): IdeasPageData {
  const ideas = listIdeas();
  const open = typeof params.open === "string" && ideas.some((idea) => idea.id === params.open) ? params.open : null;
  return { ideas, openId: open };
}

export function loadSaves(): SavesPageData {
  resumeDownloads();
  return { saves: listSaves() };
}
