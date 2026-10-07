"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import { Download, Upload } from "lucide-react";
import { Button } from "../../../common/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../../../common/ui/dialog";
import type {
  CalendarArchive,
  CalendarImportPreview,
  PublishingRun,
} from "@agentcut/core/modules/publishing/types";
import { parseCalendarArchive } from "@agentcut/core/modules/publishing/lib/calendar-transfer";

export function CalendarTransfer({
  run,
  busy,
  error,
  onImported,
}: {
  run: PublishingRun;
  busy: boolean;
  error: string;
  onImported?: (day: string | null) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [reading, setReading] = useState(false);
  const [archive, setArchive] = useState<CalendarArchive | null>(null);
  const [preview, setPreview] = useState<CalendarImportPreview | null>(null);
  const [fileName, setFileName] = useState("");
  const [localError, setLocalError] = useState("");
  const [notice, setNotice] = useState("");
  const [complete, setComplete] = useState(false);
  const recordCount = `${preview?.added ?? 0} ${preview?.added === 1 ? "record" : "records"}`;

  async function readFile(file?: File) {
    if (!file) return;
    setReading(true);
    setArchive(null);
    setPreview(null);
    setLocalError("");
    setComplete(false);
    setFileName(file.name);
    try {
      let raw: unknown;
      try {
        raw = JSON.parse(await file.text());
      } catch {
        throw new Error(
          "This file is not valid JSON. Choose a calendar exported from Agentcut.",
        );
      }
      const parsed = parseCalendarArchive(raw);
      const result = await run<CalendarImportPreview>({
        tool: "publication.calendar.import.preview",
        archive: parsed,
      });
      if (result) {
        setArchive(parsed);
        setPreview(result);
      }
    } catch (error) {
      setLocalError((error as Error).message);
    } finally {
      setReading(false);
    }
  }

  async function download() {
    setNotice("");
    const archive = await run<CalendarArchive>({
      tool: "publication.calendar.export",
    });
    if (!archive) return;
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(archive, null, 2)], {
        type: "application/json",
      }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `agentcut-calendar-${archive.exportedAt.slice(0, 10)}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice(`Exported ${archive.publications.length} calendar records.`);
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={busy || reading}
          onClick={() => void download()}
          title="Download all calendar records, including unscheduled and archived publications"
        >
          <Download className="size-4" aria-hidden />
          Export calendar
        </Button>
        <Dialog
          open={open}
          onOpenChange={(value) => {
            if (!busy && !reading) setOpen(value);
          }}
        >
          <DialogTrigger
            render={
              <Button
                size="sm"
                variant="outline"
                disabled={busy || reading}
                onClick={() => {
                  setArchive(null);
                  setPreview(null);
                  setLocalError("");
                  setFileName("");
                  setComplete(false);
                }}
              />
            }
          >
            <Upload className="size-4" aria-hidden />
            Import calendar
          </DialogTrigger>
          <DialogContent
            showCloseButton={!busy && !reading}
            className="sm:max-w-lg"
          >
            <DialogHeader>
              <DialogTitle>
                {complete ? "Calendar imported" : "Import calendar"}
              </DialogTitle>
              <DialogDescription>
                Bring calendar records from another computer. Existing records
                stay as they are.
              </DialogDescription>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              Includes text, dates, accounts and delivery history. Video files,
              projects and credentials are transferred separately.
            </p>
            {!complete && (
              <>
                <input
                  ref={input}
                  type="file"
                  accept=".json,application/json"
                  aria-label="Calendar file"
                  className="sr-only"
                  tabIndex={-1}
                  onChange={(e) => {
                    void readFile(e.target.files?.[0]);
                    e.target.value = "";
                  }}
                />
                <Button
                  variant="outline"
                  disabled={busy || reading}
                  onClick={() => input.current?.click()}
                >
                  {reading ? "Reading calendar…" : "Choose calendar file"}
                </Button>
                {fileName && (
                  <p className="break-all text-xs text-muted-foreground">
                    {fileName}
                  </p>
                )}
              </>
            )}
            {preview && (
              <div className="space-y-3 rounded-xl bg-foreground/5 p-4">
                <p className="font-medium">
                  {complete
                    ? `${recordCount} imported`
                    : `${recordCount} to import`}
                </p>
                <p className="text-sm text-muted-foreground">
                  {preview.skipped} already here · {preview.total} in this file
                </p>
                <p className="text-xs text-muted-foreground">
                  Exported in {preview.timezone.replaceAll("_", " ")}. Dates
                  display in this workspace’s timezone.
                </p>
                {preview.missingVideos > 0 && (
                  <p className="text-sm">
                    {preview.missingVideos === 1
                      ? "1 record has its video on the other computer."
                      : `${preview.missingVideos} records have videos on the other computer.`}{" "}
                    You can still organize their dates and text here.
                  </p>
                )}
                {preview.reconnect > 0 && (
                  <p className="text-sm">
                    Confirm {preview.reconnect} imported accounts in publishing
                    settings before sending new posts.
                  </p>
                )}
                {preview.uncertain > 0 && (
                  <p className="text-sm">
                    {preview.uncertain} records were mid-delivery. Check their
                    results in the publishing app before retrying.
                  </p>
                )}
              </div>
            )}
            {(localError || (fileName && error)) && (
              <p
                role="alert"
                className="text-sm text-destructive whitespace-pre-wrap"
              >
                {localError || error}
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              Importing does not send or schedule posts with a publishing
              service.
            </p>
            <div className="flex flex-wrap justify-end gap-2">
              {complete && preview && preview.reconnect > 0 && (
                <Button
                  variant="outline"
                  nativeButton={false}
                  render={<Link href="/settings/publishing" />}
                >
                  Review accounts
                </Button>
              )}
              <Button
                variant="outline"
                disabled={busy || reading}
                onClick={() => setOpen(false)}
              >
                {complete ? "Done" : "Cancel"}
              </Button>
              {!complete && archive && preview && preview.added > 0 && (
                <Button
                  disabled={busy || reading}
                  onClick={async () => {
                    const result = await run<CalendarImportPreview>({
                      tool: "publication.calendar.import.apply",
                      archive,
                    });
                    if (!result) return;
                    setPreview(result);
                    setComplete(true);
                    setNotice(
                      `Imported ${result.added} calendar records. ${result.skipped} existing records skipped.`,
                    );
                    onImported?.(result.firstDay);
                  }}
                >
                  {busy ? "Importing…" : `Import ${recordCount}`}
                </Button>
              )}
            </div>
          </DialogContent>
        </Dialog>
      </div>
      <p role="status" className="text-xs text-muted-foreground">
        {notice}
      </p>
    </div>
  );
}
