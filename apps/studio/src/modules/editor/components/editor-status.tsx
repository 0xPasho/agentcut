"use client";
import { Button } from "../../../common/ui/button";
import type { useEditor } from "@/modules/editor/hooks/use-editor";
export function EditorStatus({ editor }: { editor: ReturnType<typeof useEditor> }) {
  return <div className="space-y-2 text-xs text-muted-foreground">
    <p role="status">{editor.saving ? "Saving changes…" : editor.dirty ? "Unsaved changes" : "All changes saved"}</p>
    {editor.error && <p role="alert" className="text-sm text-destructive">{editor.error}</p>}
    {editor.conflict ? <div className="flex flex-wrap gap-2">
      <Button size="sm" variant="outline" onClick={editor.downloadDraft}>Download my draft</Button>
      <Button size="sm" variant="outline" onClick={() => { if (window.confirm("Discard your unsaved draft and load the latest project?")) void editor.reload(); }}>Discard draft and load latest</Button>
    </div> : editor.error && editor.dirty ? <Button size="sm" variant="outline" onClick={() => void editor.save()}>Retry save</Button> : null}
  </div>;
}
