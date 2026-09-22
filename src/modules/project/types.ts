import type { ProjectVideo } from "./lib/overview";

export type ClipListHandlers = {
  onSelect: (id: string) => void;
  onOpen: (video: ProjectVideo) => (event: React.MouseEvent) => void;
  onApprove: (video: ProjectVideo) => void;
  onDelete: (video: ProjectVideo) => void;
  href: (video: ProjectVideo) => string;
};
