"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft, ArrowRight, ArrowUp, ChevronRight, Film, Folder, Image as ImageIcon,
  LayoutGrid, List as ListIcon, Loader2, Lock, Music, Search,
} from "lucide-react";
import { api } from "@/lib/client";
import type { FilesResponse, FolderEntry } from "@/lib/editor/local-assets";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./ui/dialog";

const ICONS = { folder: Folder, video: Film, image: ImageIcon, audio: Music } as const;

const KINDS: Record<string, string> = {
  ".mp4": "MPEG-4 movie", ".m4v": "MPEG-4 movie", ".mov": "QuickTime movie",
  ".mkv": "Matroska movie", ".webm": "WebM movie",
  ".jpg": "JPEG image", ".jpeg": "JPEG image", ".png": "PNG image", ".webp": "WebP image",
  ".gif": "GIF image", ".avif": "AVIF image", ".svg": "SVG image",
  ".mp3": "MP3 audio", ".wav": "WAV audio", ".m4a": "Apple MPEG-4 audio",
  ".aac": "AAC audio", ".flac": "FLAC audio", ".ogg": "Ogg audio", ".oga": "Ogg audio",
};

const extension = (name: string) => {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot).toLowerCase() : "";
};

const kindLabel = (entry: FolderEntry) =>
  entry.kind === "folder" ? "Folder" : KINDS[extension(entry.name)] ?? `${extension(entry.name).slice(1).toUpperCase() || "Unknown"} file`;

/** Finder's own rounding: whole kilobytes, one decimal for megabytes, two for gigabytes. */
function sizeLabel(bytes: number | null) {
  if (bytes === null) return "--";
  if (bytes < 1000) return `${bytes} bytes`;
  const units = [
    { scale: 1e3, suffix: "KB", decimals: 0 },
    { scale: 1e6, suffix: "MB", decimals: 1 },
    { scale: 1e9, suffix: "GB", decimals: 2 },
    { scale: 1e12, suffix: "TB", decimals: 2 },
  ];
  const unit = units.findLast(u => bytes >= u.scale) ?? units[0];
  return `${(bytes / unit.scale).toFixed(unit.decimals)} ${unit.suffix}`;
}

function dateLabel(ms: number) {
  if (!ms) return "--";
  const date = new Date(ms);
  const time = date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  if (sameDay) return `Today at ${time}`;
  return `${date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })} at ${time}`;
}

type SortKey = "name" | "size" | "kind" | "date";

const COLUMNS: Array<{ key: SortKey; label: string; className: string }> = [
  { key: "name", label: "Name", className: "flex-1 min-w-0" },
  { key: "size", label: "Size", className: "w-24 shrink-0 justify-end" },
  { key: "kind", label: "Kind", className: "w-40 shrink-0" },
  { key: "date", label: "Date Modified", className: "w-48 shrink-0" },
];

/**
 * The folders of this machine, listed by the server that will read the file anyway. A local
 * app has no reason to copy a two-hour recording into its workspace before it can look at
 * it: the human picks the file here and the project keeps its path, which is exactly what
 * the agent sees through `assets.browseLocal`. The browser's own file dialog cannot do
 * this — it hands JavaScript the bytes and hides the path.
 *
 * It is shaped like the Finder because that is the shape people already know: places down
 * the left, size, kind and date beside the name, sortable columns, and a gallery for when
 * the filename is `2026-09-13 19-54-32.mp4` and only the picture tells you which one it is.
 */
export function LocalFilePicker({ open, onOpenChange, onPick, kinds = ["video"], title = "Choose a file on this computer", description }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (file: FolderEntry) => void;
  kinds?: ReadonlyArray<"video" | "image" | "audio">;
  title?: string;
  description?: string;
}) {
  const [listing, setListing] = useState<FilesResponse | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [step, setStep] = useState(-1);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [view, setView] = useState<"list" | "gallery">("list");
  const [sort, setSort] = useState<{ key: SortKey; descending: boolean }>({ key: "date", descending: true });
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<FolderEntry | null>(null);
  const rows = useRef<HTMLDivElement>(null);

  const load = async (folder: string | undefined, remember = true) => {
    setPending(true); setError("");
    try {
      // Everything in the folder, not a page of it: sorting by size across a page boundary
      // would put the biggest file of page two below the smallest of page one.
      const result = await api.browseFiles(folder, 0, 2000);
      setListing(result); setSelected(null); setQuery("");
      if (remember) {
        setHistory(past => [...past.slice(0, step + 1), result.path]);
        setStep(at => at + 1);
      }
    } catch (e) { setError((e as Error).message); }
    finally { setPending(false); }
  };

  const travel = (to: number) => { setStep(to); void load(history[to], false); };

  // The home folder is where a recording most often lands, and it is the same starting
  // point the agent gets when it browses without saying where.
  useEffect(() => { if (open && !listing) void load(undefined); }, [open]);

  const shown = useMemo(() => {
    const entries = (listing?.entries ?? []).filter(entry =>
      (entry.kind === "folder" || kinds.includes(entry.kind as (typeof kinds)[number]))
      && (!query || entry.name.toLowerCase().includes(query.toLowerCase())));
    const order = sort.descending ? -1 : 1;
    return entries.sort((a, b) =>
      // Folders stay above files however the files themselves are ordered: they are the
      // way out of this folder, not one more row competing for the same sort.
      Number(b.kind === "folder") - Number(a.kind === "folder") || order * compare(a, b, sort.key));
  }, [listing, kinds, query, sort]);

  const choose = (entry: FolderEntry) => (entry.kind === "folder" ? void load(entry.path) : onPick(entry));

  const move = (delta: number) => {
    if (!shown.length) return;
    const at = selected ? shown.findIndex(entry => entry.path === selected.path) : -1;
    const next = shown[Math.max(0, Math.min(shown.length - 1, at + delta))];
    setSelected(next);
    rows.current?.querySelector<HTMLElement>(`[data-path="${CSS.escape(next.path)}"]`)?.scrollIntoView({ block: "nearest" });
  };

  const crumbs = (listing?.path ?? "").split("/").filter(Boolean);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="flex h-[min(42rem,calc(100dvh-3rem))] flex-col gap-0 overflow-hidden p-0 sm:max-w-[min(64rem,calc(100vw-3rem))]"
        onKeyDown={e => {
          if (e.key === "ArrowDown") { e.preventDefault(); move(1); }
          if (e.key === "ArrowUp") { e.preventDefault(); move(-1); }
          if (e.key === "Enter" && selected) { e.preventDefault(); choose(selected); }
        }}
      >
        <DialogTitle className="sr-only">{title}</DialogTitle>
        <DialogDescription className="sr-only">
          {description ?? "Nothing is copied. The project points at the file where it already lives."}
        </DialogDescription>

        <div className="flex min-h-0 flex-1">
          <aside className="hidden w-52 shrink-0 flex-col gap-1 overflow-y-auto border-r border-white/10 bg-black/25 p-3 sm:flex">
            <p className="px-2 pb-1 text-[11px] font-medium tracking-wide text-muted-foreground">Favorites</p>
            {listing?.places.map(place => {
              const here = listing.path === place.path;
              return (
                <button
                  key={place.path}
                  type="button"
                  disabled={pending}
                  onClick={() => void load(place.path)}
                  aria-current={here ? "true" : undefined}
                  className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] transition-colors duration-150 motion-reduce:transition-none ${
                    here ? "bg-white/10 text-foreground" : "text-foreground/80 hover:bg-white/5"
                  }`}
                >
                  <Folder aria-hidden className="size-4 shrink-0 text-primary/80" />
                  <span className="min-w-0 flex-1 truncate">{place.name}</span>
                  {/* macOS has not let this server into the folder yet. Saying so here beats
                      an error after the click, which reads as the app being broken. */}
                  {place.blocked ? <Lock aria-label="Blocked by macOS privacy settings" className="size-3 shrink-0 text-muted-foreground" /> : null}
                </button>
              );
            })}
          </aside>

          <div className="flex min-w-0 flex-1 flex-col">
            <header className="flex items-center gap-2 border-b border-white/10 px-3 py-2.5">
              <Button variant="ghost" size="icon-sm" aria-label="Back" disabled={pending || step <= 0} onClick={() => travel(step - 1)}><ArrowLeft /></Button>
              <Button variant="ghost" size="icon-sm" aria-label="Forward" disabled={pending || step >= history.length - 1} onClick={() => travel(step + 1)}><ArrowRight /></Button>
              <Button variant="ghost" size="icon-sm" aria-label="Enclosing folder" disabled={pending || !listing?.parent} onClick={() => void load(listing!.parent!)}><ArrowUp /></Button>
              <h2 className="min-w-0 flex-1 truncate px-1 font-heading text-base font-medium">
                {crumbs.at(-1) ?? "/"}
              </h2>
              {pending ? <Loader2 aria-hidden className="size-4 motion-safe:animate-spin text-muted-foreground" /> : null}
              <div className="flex items-center rounded-full border border-white/10 p-0.5" role="group" aria-label="View">
                {([["list", ListIcon, "List"], ["gallery", LayoutGrid, "Gallery"]] as const).map(([mode, Icon, label]) => (
                  <button
                    key={mode}
                    type="button"
                    aria-pressed={view === mode}
                    aria-label={label}
                    onClick={() => setView(mode)}
                    className={`rounded-full p-1.5 transition-colors duration-150 motion-reduce:transition-none ${
                      view === mode ? "bg-white/12 text-foreground" : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <Icon aria-hidden className="size-4" />
                  </button>
                ))}
              </div>
              <div className="relative w-44">
                <Search aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input aria-label="Search this folder" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search" className="h-8 pl-8 text-xs" />
              </div>
            </header>

            {view === "list" ? (
              <div className="flex items-center gap-3 border-b border-white/10 px-4 py-1.5 text-[11px] text-muted-foreground">
                {COLUMNS.map(column => (
                  <button
                    key={column.key}
                    type="button"
                    onClick={() => setSort(current => ({ key: column.key, descending: current.key === column.key ? !current.descending : column.key !== "name" }))}
                    className={`flex items-center gap-1 rounded py-0.5 text-left hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring ${column.className}`}
                    aria-sort={sort.key === column.key ? (sort.descending ? "descending" : "ascending") : "none"}
                  >
                    {column.label}
                    {sort.key === column.key ? <span aria-hidden className="text-[9px]">{sort.descending ? "▼" : "▲"}</span> : null}
                  </button>
                ))}
              </div>
            ) : null}

            <div ref={rows} className="min-h-0 flex-1 overflow-y-auto p-2">
              {error ? <p role="alert" className="px-2 py-3 text-sm text-destructive">{error}</p> : null}

              {view === "list" ? (
                <div role="listbox" aria-label="Files">
                  {shown.map(entry => {
                    const Icon = ICONS[entry.kind];
                    const active = selected?.path === entry.path;
                    return (
                      <div
                        key={entry.path}
                        role="option"
                        aria-selected={active}
                        data-path={entry.path}
                        tabIndex={-1}
                        onClick={() => (entry.kind === "folder" ? choose(entry) : setSelected(entry))}
                        onDoubleClick={() => choose(entry)}
                        className={`flex cursor-default items-center gap-3 rounded-lg px-2 py-1.5 text-[13px] transition-colors duration-150 motion-reduce:transition-none ${
                          active ? "bg-primary/20 text-foreground" : "hover:bg-white/5"
                        }`}
                      >
                        <span className="flex min-w-0 flex-1 items-center gap-2">
                          <Icon aria-hidden className={`size-4 shrink-0 ${entry.kind === "folder" ? "text-primary/80" : "text-muted-foreground"}`} />
                          <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                          {entry.kind === "folder" ? <ChevronRight aria-hidden className="size-3.5 shrink-0 text-muted-foreground" /> : null}
                        </span>
                        <span className="w-24 shrink-0 text-right tabular-nums text-muted-foreground">{sizeLabel(entry.size)}</span>
                        <span className="w-40 shrink-0 truncate text-muted-foreground">{kindLabel(entry)}</span>
                        <span className="w-48 shrink-0 truncate text-muted-foreground">{dateLabel(entry.modifiedAt)}</span>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div role="listbox" aria-label="Files" className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-2">
                  {shown.map(entry => {
                    const Icon = ICONS[entry.kind];
                    const active = selected?.path === entry.path;
                    return (
                      <div
                        key={entry.path}
                        role="option"
                        aria-selected={active}
                        data-path={entry.path}
                        tabIndex={-1}
                        onClick={() => (entry.kind === "folder" ? choose(entry) : setSelected(entry))}
                        onDoubleClick={() => choose(entry)}
                        className={`flex cursor-default flex-col gap-1.5 rounded-xl p-2 transition-colors duration-150 motion-reduce:transition-none ${
                          active ? "bg-primary/20" : "hover:bg-white/5"
                        }`}
                      >
                        <span className="flex aspect-video items-center justify-center overflow-hidden rounded-lg border border-white/10 bg-black/40">
                          {entry.kind === "folder" || entry.kind === "audio" ? (
                            <Icon aria-hidden className="size-7 text-muted-foreground" />
                          ) : (
                            // A plain <img>: the source is an arbitrary path on this disk
                            // behind a route of ours, not something the image optimiser
                            // can resolve or resize ahead of time.
                            <img
                              src={`/api/files/thumb?path=${encodeURIComponent(entry.path)}`}
                              alt=""
                              loading="lazy"
                              className="size-full object-cover"
                            />
                          )}
                        </span>
                        <span className="truncate text-center text-[12px]" title={entry.name}>{entry.name}</span>
                        <span className="truncate text-center text-[11px] text-muted-foreground">{sizeLabel(entry.size)}</span>
                      </div>
                    );
                  })}
                </div>
              )}

              {listing && listing.total > listing.entries.length ? (
                <p className="px-2 py-3 text-center text-[11px] text-muted-foreground">
                  Showing the first {listing.entries.length} of {listing.total} items in this folder. Search to narrow it down.
                </p>
              ) : null}

              {!shown.length && !pending && !error ? (
                <p className="px-2 py-6 text-center text-sm text-muted-foreground">
                  {query ? `Nothing here matches “${query}”.` : "No video or folder here. Try another place."}
                </p>
              ) : null}
            </div>

            <footer className="flex items-center gap-3 border-t border-white/10 bg-black/35 px-3 py-2.5">
              <nav aria-label="Path" className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden text-[11px] text-muted-foreground">
                {crumbs.map((crumb, at) => (
                  <span key={at} className="flex min-w-0 items-center gap-1">
                    {at ? <ChevronRight aria-hidden className="size-3 shrink-0" /> : null}
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => void load("/" + crumbs.slice(0, at + 1).join("/"))}
                      className="truncate rounded px-0.5 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
                    >
                      {crumb}
                    </button>
                  </span>
                ))}
              </nav>
              <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button disabled={!selected || selected.kind === "folder"} onClick={() => selected && onPick(selected)}>
                Choose
              </Button>
            </footer>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function compare(a: FolderEntry, b: FolderEntry, key: SortKey) {
  if (key === "size") return (a.size ?? 0) - (b.size ?? 0);
  if (key === "date") return a.modifiedAt - b.modifiedAt;
  if (key === "kind") return kindLabel(a).localeCompare(kindLabel(b)) || a.name.localeCompare(b.name);
  return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
}
