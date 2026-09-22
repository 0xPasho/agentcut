import type { ProjectVideo } from "./overview";

export const editHref = (projectId: string, video: ProjectVideo) =>
  video.kind === "sequence" ? `/p/${projectId}/edit?sequence=${video.id}` : `/p/${projectId}/c/${video.id}`;
