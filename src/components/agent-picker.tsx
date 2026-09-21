"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Loader2, RefreshCw, Star, Terminal } from "lucide-react";
import { cn } from "cn";
import { useAgents } from "@/lib/agent-store";
import { catalogNote, chipLabel, favKeyFor, favoriteRows, filterRows, harnessRows, shortReason, type ModelRow } from "@/lib/agent/model-rows";
import type { HarnessStatus } from "@/lib/agent/detect";
import { HARNESS_MARKS } from "./brand-marks";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { ScrollArea } from "./ui/scroll-area";

/**
 * Pick the harness and the model, in one control, anywhere a prompt is typed.
 *
 * A rail of harnesses on the left, wearing their own brand marks, and that
 * harness's models on the right. Both halves are one decision: choosing a model
 * while browsing another harness switches the harness too, because "run this on
 * Sonnet" is not a sentence about Claude Code, it is a sentence about the next
 * message.
 *
 * Unavailable harnesses render DISABLED, never hidden. A missing row reads as
 * "Cursor is not a thing here", which is a different and wrong story from
 * "Cursor is installed but signed out" or "you cannot switch mid-run" — and each
 * of those three has a different fix, so each one says which it is.
 */
const FAVOURITES = "*favourites*";
const FAV_KEY = "agentcut:favourite-models";
/** Enough rows to be worth a shortcut; past nine the digits run out anyway. */
const SHORTCUT_ROWS = 9;

const readFavourites = (): Record<string, string> => {
  try { return JSON.parse(localStorage.getItem(FAV_KEY) ?? "{}") as Record<string, string>; }
  catch { return {}; }
};

/** The mark a harness wears, with a terminal glyph for anything unrecognised. */
function HarnessMark({ id, className }: { id: string; className?: string }) {
  const Mark = HARNESS_MARKS[id];
  return Mark ? <Mark className={className} /> : <Terminal className={className} strokeWidth={2} />;
}

export function AgentPicker({
  projectId,
  locked = false,
  lockedReason = "the agent is already running",
  className,
}: {
  /** Scope of the selection. Omit for the workspace default. */
  projectId?: string;
  /** A live run has already been spawned with its flags: the harness cannot change. */
  locked?: boolean;
  lockedReason?: string;
  className?: string;
}) {
  const { harnesses, selection, loading, error, select, refresh } = useAgents(projectId);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<string>("");
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const [favourites, setFavourites] = useState<Record<string, string>>({});
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => { setFavourites(readFavourites()); }, [open]);

  const active = harnesses.find((h) => h.id === selection.provider) ?? harnesses.find((h) => h.ready);
  // Nothing chosen yet still has an answer: whatever would run if you hit send now.
  const chosen = { provider: selection.provider || active?.id || "", model: selection.model };
  const browsing = view && view !== FAVOURITES ? harnesses.find((h) => h.id === view) ?? active : active;
  const showingFavourites = view === FAVOURITES;

  const rows = useMemo(() => {
    if (showingFavourites) {
      const all = favoriteRows(favourites, harnesses);
      // Frozen to one harness mid-run: a favourite on another is not reachable now.
      return locked ? all.filter((row) => row.harnessId === active?.id) : all;
    }
    return browsing ? harnessRows(browsing) : [];
  }, [showingFavourites, favourites, harnesses, locked, active?.id, browsing]);
  const filtered = useMemo(() => filterRows(rows, query), [rows, query]);
  const cursor = Math.min(index, Math.max(0, filtered.length - 1));

  const pick = useCallback((row: ModelRow | undefined) => {
    if (!row || !row.ready) return;
    void select(row.harnessId, row.model);
    setOpen(false);
  }, [select]);

  const toggleFavourite = useCallback((row: ModelRow) => {
    if (!row.favKey) return;
    // Read → toggle → write in one motion: another picker on the page writes here too.
    const current = readFavourites();
    if (row.favKey in current) delete current[row.favKey];
    else current[row.favKey] = row.label;
    localStorage.setItem(FAV_KEY, JSON.stringify(current));
    setFavourites(current);
  }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    // e.code, not e.key: macOS turns Alt+digit into a special character.
    if (e.altKey && e.code.startsWith("Digit") && e.code !== "Digit0") {
      e.preventDefault();
      pick(filtered[Number(e.code.slice(5)) - 1]);
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!filtered.length) return;
      const step = e.key === "ArrowDown" ? 1 : -1;
      // From the previous value, not from the rendered one: a held arrow key fires
      // faster than React re-renders, and reading the closure stalls on one row.
      setIndex((prev) => (Math.min(prev, filtered.length - 1) + step + filtered.length) % filtered.length);
      return;
    }
    if (e.key === "Enter") { e.preventDefault(); pick(filtered[cursor]); }
  };

  // Keep the keyboard cursor in view without stealing focus from the search box.
  useEffect(() => {
    list.current?.querySelector('[data-cursor="true"]')?.scrollIntoView({ block: "nearest" });
  }, [cursor, filtered.length]);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) { setView(active?.id ?? ""); setQuery(""); setIndex(0); }
      }}
    >
      <PopoverTrigger
        render={
          <Button type="button" size="xs" variant="ghost" className={cn("gap-1.5 font-normal text-muted-foreground", className)}>
            {loading ? <Loader2 className="size-3.5 motion-safe:animate-spin" /> : active ? <HarnessMark id={active.id} className="size-3.5 shrink-0" /> : null}
            <span className="max-w-44 truncate">{chipLabel(active, selection.model, loading)}</span>
            <ChevronDown className="size-3 opacity-60" strokeWidth={2} />
          </Button>
        }
      />
      <PopoverContent className="w-[27rem] p-0" aria-label="Agent and model" onKeyDown={onKeyDown}>
        <div className="flex">
          <ul className="w-40 shrink-0 space-y-0.5 border-r border-border/60 p-1.5" aria-label="Agents">
            <li>
              <RailButton
                active={showingFavourites}
                onClick={() => { setView(FAVOURITES); setQuery(""); setIndex(0); }}
                icon={<Star className={cn("size-4 shrink-0", showingFavourites && "fill-current")} strokeWidth={2} />}
                label="Starred"
                caption={Object.keys(favourites).length ? `${Object.keys(favourites).length} pinned` : "star a model"}
              />
            </li>
            {harnesses.map((h) => {
              const unreachable = !h.ready || (locked && h.id !== active?.id);
              const reason = !h.ready ? h.reason : locked && h.id !== active?.id ? `Cannot switch while ${lockedReason}` : "";
              return (
                <li key={h.id}>
                  <RailButton
                    active={!showingFavourites && browsing?.id === h.id}
                    disabled={unreachable}
                    title={reason || h.accountLabel || h.label}
                    onClick={() => { setView(h.id); setQuery(""); setIndex(0); }}
                    icon={<HarnessMark id={h.id} className="size-4 shrink-0" />}
                    label={h.label}
                    caption={shortReason(h, locked && h.id !== active?.id) || h.accountLabel || ""}
                  />
                </li>
              );
            })}
          </ul>

          <div className="min-w-0 flex-1 p-1.5">
            <Input
              autoFocus
              value={query}
              onChange={(e) => { setQuery(e.target.value); setIndex(0); }}
              placeholder={showingFavourites ? "Search starred" : `Search ${browsing?.label ?? ""} models`}
              aria-label="Search models"
              className="mb-1.5 h-7 text-xs"
            />
            <ScrollArea className="h-64">
              <div ref={list} role="listbox" aria-label="Models" className="space-y-0.5 pr-2">
                {filtered.map((row, i) => (
                  <Row
                    key={row.key}
                    row={row}
                    cursor={i === cursor}
                    shortcut={i < SHORTCUT_ROWS ? i + 1 : null}
                    selected={chosen.provider === row.harnessId && chosen.model === row.model}
                    favourited={!!row.favKey && row.favKey in favourites}
                    onHover={() => setIndex(i)}
                    onPick={() => pick(row)}
                    onStar={() => toggleFavourite(row)}
                  />
                ))}
                {!filtered.length ? (
                  <p className="px-2 py-8 text-center text-xs text-muted-foreground">
                    {showingFavourites && !query
                      ? "Nothing starred yet. Star a model to keep it one click away."
                      : `No model matches “${query}”.`}
                  </p>
                ) : null}
              </div>
            </ScrollArea>
          </div>
        </div>

        <footer className="flex items-center justify-between gap-2 border-t border-border/60 px-2 py-1.5 text-[10px] text-muted-foreground">
          <span className="truncate">{showingFavourites ? "Starred models, across agents" : catalogNote(browsing)}</span>
          <Button type="button" size="xs" variant="ghost" disabled={loading} onClick={() => void refresh()}>
            <RefreshCw className={cn("size-3", loading && "motion-safe:animate-spin")} strokeWidth={2} />
            Refresh
          </Button>
        </footer>
        {error ? <p role="alert" className="px-2 pb-1.5 text-[10px] text-destructive">{error}</p> : null}
      </PopoverContent>
    </Popover>
  );
}

function RailButton({ active, disabled, title, onClick, icon, label, caption }: {
  active: boolean; disabled?: boolean; title?: string; onClick: () => void;
  icon: React.ReactNode; label: string; caption?: string;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      title={title}
      aria-current={active}
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition-colors duration-150 motion-reduce:transition-none",
        active ? "bg-white/10 text-foreground" : "text-muted-foreground hover:bg-white/5",
        disabled && "cursor-not-allowed opacity-40 hover:bg-transparent",
      )}
    >
      {icon}
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{label}</span>
        {caption ? <span className="block truncate text-[10px] leading-tight opacity-70">{caption}</span> : null}
      </span>
    </button>
  );
}

function Row({ row, cursor, shortcut, selected, favourited, onHover, onPick, onStar }: {
  row: ModelRow; cursor: boolean; shortcut: number | null; selected: boolean; favourited: boolean;
  onHover: () => void; onPick: () => void; onStar: () => void;
}) {
  return (
    <div
      role="option"
      aria-selected={selected}
      data-cursor={cursor || undefined}
      onMouseEnter={onHover}
      onClick={onPick}
      className={cn(
        "group flex cursor-pointer items-start gap-2 rounded-lg px-2 py-1.5 transition-colors duration-150 motion-reduce:transition-none",
        cursor && "bg-white/5",
        !row.ready && "cursor-not-allowed opacity-40",
      )}
    >
      <Check className={cn("mt-0.5 size-3 shrink-0", selected ? "opacity-100" : "opacity-0")} strokeWidth={2} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs">{row.label}</span>
        {row.detail ? <span className="block truncate text-[10px] text-muted-foreground">{row.detail}</span> : null}
      </span>
      {shortcut ? (
        <kbd className="mt-0.5 hidden shrink-0 rounded border border-border/60 px-1 font-mono text-[10px] leading-4 text-muted-foreground group-hover:inline sm:inline">
          ⌥{shortcut}
        </kbd>
      ) : null}
      {row.favKey ? (
        <button
          type="button"
          aria-label={favourited ? `Unstar ${row.label}` : `Star ${row.label}`}
          aria-pressed={favourited}
          onClick={(e) => { e.stopPropagation(); onStar(); }}
          className={cn(
            "mt-0.5 shrink-0 rounded p-0.5 transition-[color,opacity] duration-150 motion-reduce:transition-none",
            favourited ? "text-primary opacity-100" : "text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
          )}
        >
          <Star className={cn("size-3", favourited && "fill-current")} strokeWidth={2} />
        </button>
      ) : null}
    </div>
  );
}

export type { HarnessStatus };
