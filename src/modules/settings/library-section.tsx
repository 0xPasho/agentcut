"use client";
import { LibraryView } from "@/modules/media/library-view";
import { useWorkspaceSettings } from "./hooks";

/**
 * The library inside the workspace shell (decision 130): the media module's view,
 * told which packs are installed so a file can say where it came from, and told to
 * refresh the shell's counts when it adds or deletes.
 */
export function LibrarySection() {
  const { data, reload } = useWorkspaceSettings();
  return <LibraryView packs={data?.packs ?? []} onChanged={() => void reload()} />;
}
