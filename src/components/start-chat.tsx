"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Check, ChevronDown, ListChecks, Scissors, Wand2, X } from "lucide-react";
import { AgentcutIcon } from "@/components/agentcut-mark";
import { useStartChat, type StartOptions } from "@/lib/use-chat";
import { Chat } from "./chat";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Glass } from "./ui/glass";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { cn } from "cn";

/**
 * A project does not have to start from footage.
 *
 * Say what you want and this makes the project and hands the sentence to the agent;
 * drop a video and it starts from that; paste a link and it clips it. All three land
 * in the same editor with the conversation already open, because the first thing
 * somebody says is the most useful thing they will ever say about a video.
 */
const SUGGESTIONS = [
  { label: "Explain something", text: "Make a 30-second explainer about " },
  { label: "From a link", text: "Find the best clips in https://" },
  { label: "A title card", text: "Start me a 9:16 video with a bold title card that says " },
];

type TemplateSummary = { id: string; name: string; description: string; tags: string[]; builtin: boolean };

/**
 * The look the project is made in, chosen before it exists.
 *
 * Several can be chosen: that is a shortlist, not a merge — two caption styles cannot both
 * win. One template names the project's look; several mean "decide per video, from these",
 * which is exactly what a set of clips wants. Either way it is written into the project's
 * plan, so the agent starts out knowing and the editor shows it.
 */
function TemplateChip({ value, onChange }: { value: string[]; onChange: (ids: string[]) => void }) {
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [open, setOpen] = useState(false);
  const [multi, setMulti] = useState(false);
  const [query, setQuery] = useState("");
  useEffect(() => {
    fetch("/api/templates").then(r => r.json()).then(d => setTemplates(d.templates ?? [])).catch(() => setTemplates([]));
  }, []);

  const chosen = templates.filter(t => value.includes(t.id));
  const term = query.trim().toLowerCase();
  const shown = term
    ? templates.filter(t => `${t.name} ${t.description} ${t.tags.join(" ")}`.toLowerCase().includes(term))
    : templates;
  const label = chosen.length > 1 ? `${chosen.length} templates` : chosen[0]?.name ?? "None yet";

  const pick = (id: string) => {
    if (!multi) { onChange([id]); setOpen(false); return; }
    onChange(value.includes(id) ? value.filter(kept => kept !== id) : [...value, id]);
  };

  return (
    <div className="flex items-center gap-1">
      {/* Each one that is in also sits on the row, the way an attachment does. */}
      {chosen.map(template => (
        <button
          key={template.id}
          type="button"
          onClick={() => onChange(value.filter(id => id !== template.id))}
          title={`${template.name} — click to remove`}
          aria-label={`Remove ${template.name}`}
          className="h-10 w-6 shrink-0 overflow-hidden rounded-md border border-primary/50 hover:border-destructive focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/api/templates/${template.id}/preview?aspect=9:16`} alt="" className="size-full object-cover" />
        </button>
      ))}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button type="button" variant="outline" className={cn("h-10 gap-2 px-3 font-normal", chosen.length && "border-primary/50 bg-primary/10")}>
              <Wand2 className="size-4 shrink-0 text-primary" />
              <span className="flex flex-col items-start leading-tight">
                <span className="text-[10px] text-muted-foreground">Template</span>
                <span className="max-w-40 truncate text-xs">{label}</span>
              </span>
              <ChevronDown className="size-3 opacity-60" />
            </Button>
          }
        />
        <PopoverContent align="start" className="w-[23rem] rounded-2xl p-1.5">
          <div className="flex items-center gap-1.5 px-0.5 pb-1.5">
            <Input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search templates"
              aria-label="Search templates"
              className="h-8 flex-1 text-xs"
            />
            <Button
              type="button" size="xs" variant={multi ? "secondary" : "ghost"} aria-pressed={multi}
              title="Choose several and let each video take the one that suits it"
              onClick={() => setMulti(!multi)}
            ><ListChecks />Multi</Button>
            {value.length ? (
              <Button type="button" size="icon-sm" variant="ghost" aria-label="Clear templates" onClick={() => onChange([])}><X /></Button>
            ) : null}
          </div>
          <ul className="max-h-80 space-y-0.5 overflow-y-auto" aria-label="Templates">
            {!value.length || !multi ? (
              <li>
                <button
                  type="button"
                  onClick={() => { onChange([]); setOpen(false); }}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
                >
                  <span className="flex-1">Decide later</span>
                  {!value.length ? <Check className="size-4 text-primary" /> : null}
                </button>
              </li>
            ) : null}
            {shown.map(template => (
              <li key={template.id}>
                <button
                  type="button"
                  aria-pressed={value.includes(template.id)}
                  onClick={() => pick(template.id)}
                  className={cn(
                    "flex w-full items-start gap-2.5 rounded-lg border p-2 text-left focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none",
                    value.includes(template.id) ? "border-primary/60 bg-primary/10" : "border-transparent hover:bg-accent",
                  )}
                >
                  {/* The same schematic the editor's template panel shows: hook, caption band,
                      picture plate. A drawing of the layout, not a render of a video. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/api/templates/${template.id}/preview?aspect=9:16`} alt="" className="h-14 w-8 shrink-0 rounded border border-white/10 object-cover" />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 text-sm">{template.name}{value.includes(template.id) ? <Check className="size-3.5 text-primary" /> : null}</span>
                    <span className="line-clamp-2 text-[11px] leading-snug text-muted-foreground">{template.description}</span>
                  </span>
                </button>
              </li>
            ))}
            {!shown.length ? <li className="px-2 py-3 text-xs text-muted-foreground">Nothing matches “{query}”.</li> : null}
          </ul>
          {value.length > 1 ? (
            <p className="px-2 pt-1.5 text-[11px] text-muted-foreground">Each video takes whichever of these suits it.</p>
          ) : null}
        </PopoverContent>
      </Popover>
    </div>
  );
}

/** The shapes on offer. A video's frame is the one decision that is awkward to change later. */
const SHAPES = [
  { id: "", label: "Blank", note: "16:9", w: 32, h: 18 },
  { id: "9:16", label: "Vertical", note: "9:16", w: 18, h: 32 },
  { id: "4:5", label: "Portrait", note: "4:5", w: 24, h: 30 },
  { id: "1:1", label: "Square", note: "1:1", w: 28, h: 28 },
  { id: "16:9", label: "Wide", note: "16:9", w: 32, h: 18 },
];

function StartFrom({ value, onChange, onClips }: { value: string; onChange: (aspect: string) => void; onClips: () => void }) {
  const [open, setOpen] = useState(true);
  return (
    <section className="-mx-3 -mb-3 mt-3 rounded-b-xl border-t border-white/5 bg-black/25 px-3 py-3">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        Start from <ChevronDown className={cn("size-3 transition-transform duration-150 motion-reduce:transition-none", open && "rotate-180")} />
      </button>
      {open ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {SHAPES.map(shape => (
            <button
              key={shape.label}
              type="button"
              aria-pressed={value === shape.id}
              onClick={() => onChange(shape.id)}
              className={cn(
                "flex w-24 flex-col items-center gap-2 rounded-xl border p-3 transition-[background-color,border-color] duration-150 motion-reduce:transition-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none",
                value === shape.id ? "border-primary/60 bg-primary/10" : "border-white/10 hover:bg-white/5",
              )}
            >
              <span aria-hidden className="flex h-9 items-center justify-center">
                <span className="rounded-[3px] border border-white/25 bg-white/5" style={{ width: shape.w, height: shape.h }} />
              </span>
              <span className="text-xs">{shape.label}</span>
              <span className="text-[10px] text-muted-foreground">{shape.note}</span>
            </button>
          ))}
          <button
            type="button"
            onClick={onClips}
            className="flex w-24 flex-col items-center gap-2 rounded-xl border border-dashed border-white/15 p-3 hover:bg-white/5 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            <span aria-hidden className="flex h-9 items-center justify-center"><Scissors className="size-6 text-muted-foreground" /></span>
            <span className="text-xs">Clips</span>
            <span className="text-[10px] text-muted-foreground">long video</span>
          </button>
        </div>
      ) : null}
      <p className="mt-3 text-[11px] text-muted-foreground">
        Attach videos with <span className="font-medium text-foreground">+</span> to start from footage, or paste a link to clip one.
      </p>
    </section>
  );
}

/**
 * The conversation itself, without a page around it. The home screen mounts this as one
 * of its two ways in; `/chat` is the same panel on a page of its own.
 */
export function StartChatPanel({ heading = "What are we making?", onClips }: { heading?: string; onClips?: () => void }) {
  const [aspect, setAspect] = useState("");
  const [templateIds, setTemplateIds] = useState<string[]>([]);
  // Read when a message is sent rather than when this renders, so the controller is
  // never rebuilt because somebody clicked a shape.
  const options = useRef<StartOptions>({});
  options.current = { aspect, templateIds };
  const controller = useStartChat(() => options.current);

  return (
    <div className="flex flex-1 flex-col justify-end gap-6">
      {!controller.messages.length ? (
        <div className="space-y-2 pt-6 text-center">
          <h2 className="text-balance font-heading text-4xl leading-tight font-medium sm:text-5xl">{heading}</h2>
          <p className="text-pretty text-sm leading-relaxed text-muted-foreground">
            Describe it, drop a video or an image, or paste a link. It lands in the editor with this conversation already going.
          </p>
        </div>
      ) : null}
      <Glass shape="panel" thickness="thin" className="rounded-2xl p-3">
        <Chat
          controller={controller}
          suggestions={SUGGESTIONS}
          autoFocus
          threadHidden={!controller.messages.length}
          threadClassName="h-[22rem]"
          tools={<TemplateChip value={templateIds} onChange={setTemplateIds} />}
          below={!controller.messages.length && onClips ? <StartFrom value={aspect} onChange={setAspect} onClips={onClips} /> : null}
        />
      </Glass>
    </div>
  );
}

export function StartChat() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-6 px-4 pt-4 pb-10 sm:px-6">
      <Glass shape="capsule" thickness="thick" className="sticky top-4 z-20 flex items-center gap-2 px-3 py-3 sm:gap-3 sm:px-5">
        <AgentcutIcon className="size-7 shrink-0" />
        <h1 className="text-xl font-bold tracking-[-0.04em]">agentcut</h1>
        <Button variant="ghost" size="sm" nativeButton={false} className="ml-auto" render={<Link href="/" />}>Projects</Button>
      </Glass>
      <StartChatPanel />
    </main>
  );
}
