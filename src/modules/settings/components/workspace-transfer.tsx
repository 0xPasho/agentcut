"use client";
import { useId, useState } from "react";
import { Archive, Download, Loader2, Upload, CheckCircle2 } from "lucide-react";
import { Button, buttonVariants } from "@/common/ui/button";
import { Input } from "@/common/ui/input";
import { Label } from "@/common/ui/label";
import { Checkbox } from "@/common/ui/checkbox";
import { Panel, PanelHeading, ErrorLine } from "./section-header";
import { useWorkspaceSnapshot } from "../hooks/snapshot";

export function WorkspaceTransfer() {
  const id = useId(), transfer = useWorkspaceSnapshot();
  const [confirmed, setConfirmed] = useState(false);
  const busy = !!transfer.pending;
  return (
    <Panel className="flex flex-col gap-4">
      <PanelHeading title="Move your workspace" icon={<Archive className="size-4" />}>
        Take your profile, preferences, packs and their assets, rules, glossary, agent choices,
        saved keys, project edits and history to another computer.
      </PanelHeading>
      <p className="text-xs text-muted-foreground">
        Source recordings and rendered videos travel separately. Save edits and close other editing tabs first.
        Snapshots contain private data and any saved API keys; keep them somewhere private.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" disabled={busy} onClick={transfer.exportFile}>
          {transfer.pending === "export" ? <Loader2 aria-hidden className="size-4 motion-safe:animate-spin" /> : <Download aria-hidden className="size-4" />}
          Export workspace data
        </Button>
        {transfer.exported && <a className={buttonVariants()} href={transfer.exported.downloadUrl} download>
          <Download aria-hidden className="size-4" />Download snapshot
        </a>}
      </div>
      {transfer.exported && <p className="text-xs text-muted-foreground">
        {transfer.exported.projects} projects · {transfer.exported.packs} packs · {transfer.exported.files} data files.
        {" "}{transfer.exported.omittedMedia} media files need a separate copy.
      </p>}
      <div className="flex flex-col gap-2 border-t border-border pt-4">
        <Label htmlFor={`${id}-file`}>Restore from a snapshot</Label>
        <p id={`${id}-help`} className="text-xs text-muted-foreground">Choose an Agentcut snapshot to preview its contents before replacing this workspace’s saved data.</p>
        <Input id={`${id}-file`} type="file" accept=".gz,.agentcut.gz" disabled={busy}
          aria-describedby={`${id}-help`} onChange={event => {
            const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; setConfirmed(false);
            if (file) void transfer.inspect(file);
          }} />
      </div>
      {transfer.candidate && <div className="flex flex-col gap-3 rounded-xl bg-foreground/5 p-3">
        <p className="text-sm font-medium">{transfer.candidate.preview.projects} projects · {transfer.candidate.preview.packs} packs · {transfer.candidate.preview.publications} publications</p>
        <p className="text-xs text-muted-foreground">
          Exported {new Date(transfer.candidate.preview.createdAt).toLocaleString()}.
          {" "}A recovery snapshot of this computer is saved first. Running jobs and sends stay stopped;
          pack recipes need your trust again. Copy missing media separately and sign in to your agent CLIs on this computer.
        </p>
        <Checkbox id={`${id}-confirm`} checked={confirmed} disabled={busy}
          className="items-start text-xs leading-relaxed" onCheckedChange={setConfirmed}>
          Replace this workspace’s profile, settings, packs and saved project data with this snapshot.
        </Checkbox>
        <div className="flex flex-wrap gap-2">
          <Button variant="destructive" disabled={busy || !confirmed} onClick={transfer.restore}>
            {transfer.pending === "restore" ? <Loader2 aria-hidden className="size-4 motion-safe:animate-spin" /> : <Upload aria-hidden className="size-4" />}
            Restore workspace data
          </Button>
          <Button variant="ghost" disabled={busy} onClick={transfer.cancel}>Cancel</Button>
        </div>
      </div>}
      <p role="status" className="text-xs text-muted-foreground">
        {transfer.pending === "export" && "Preparing and checking your snapshot…"}
        {transfer.pending === "inspect" && "Reading and checking the snapshot…"}
        {transfer.pending === "restore" && "Saving recovery data and restoring the workspace…"}
        {!transfer.pending && transfer.imported && "Workspace data restored. Reload to see your changes."}
      </p>
      {transfer.imported && <div className="flex flex-col gap-2">
        <p className="flex items-center gap-2 text-sm"><CheckCircle2 aria-hidden className="size-4" />Workspace data restored.</p>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => window.location.assign("/settings/machine")}>Reload workspace</Button>
          <a className={buttonVariants({ variant: "outline" })} href={transfer.imported.backup.downloadUrl} download>Download recovery snapshot</a>
        </div>
      </div>}
      <ErrorLine>{transfer.error}</ErrorLine>
    </Panel>
  );
}
