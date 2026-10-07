import { Captions, Clock, Loader2, CircleAlert, CircleSlash, Folder, Film, Image as ImageIcon, Music, type LucideIcon } from "lucide-react";
import type { TranscriptionState } from "@agentcut/core/modules/media/types";

/** One mark per state. Waiting is a clock, not a spinner that has nothing to spin about yet. */
export const TRANSCRIPTION_ICON: Record<TranscriptionState["status"], LucideIcon> = { none: Captions, queued: Clock, running: Loader2, done: Captions, failed: CircleAlert, skipped: CircleSlash };

export const ICONS = { folder: Folder, video: Film, image: ImageIcon, audio: Music } as const;
