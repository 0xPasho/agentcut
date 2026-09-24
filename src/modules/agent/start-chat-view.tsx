"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Check, ChevronDown, ListChecks, Wand2, X } from "lucide-react";
import { AgentcutIcon } from "@/common/components/agentcut-mark";
import { useStartChat } from "@/modules/agent/hooks/use-chat";
import { type StartOptions } from "@/modules/agent/types";
import { Chat } from "./components/chat";
import { Button } from "../../common/ui/button";
import { Input } from "../../common/ui/input";
import { Glass } from "../../common/ui/glass";
import { Popover, PopoverContent, PopoverTrigger } from "../../common/ui/popover";
import { cn } from "cn";
import { SUGGESTIONS, SHAPES } from "./data";
import { type TemplateSummary } from "./types";

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

function StartFrom({ value, onChange }: { value: string; onChange: (aspect: string) => void }) {
  const [open, setOpen] = useState(false);
  const selected = SHAPES.find(shape => shape.id === value) ?? SHAPES[0];
  return (
    <fieldset className="mt-4 border-t border-border/60 pt-3">
      <legend className="sr-only">Video format</legend>
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="flex min-h-10 items-center gap-2 rounded-full px-3 text-xs text-muted-foreground hover:bg-white/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        Video format <span className="text-foreground">{selected.label}</span>
        <ChevronDown aria-hidden className={cn("size-3", open && "rotate-180")} />
      </button>
      {open && <div className="mt-2 flex flex-wrap items-center gap-1">
        {SHAPES.map(shape => (
          <button
            key={shape.label}
            type="button"
            aria-pressed={value === shape.id}
            aria-label={`${shape.label}: ${shape.note}`}
            onClick={() => onChange(shape.id)}
            className={cn(
              "inline-flex min-h-10 items-center gap-2 rounded-full border px-2.5 text-xs transition-[background-color,border-color] duration-150 motion-reduce:transition-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
              value === shape.id ? "border-white/10 bg-white/12 text-foreground shadow-(--control-highlight)" : "border-transparent text-muted-foreground hover:bg-muted/50 hover:text-foreground",
            )}
          >
            <span aria-hidden className="flex size-4 items-center justify-center">
              <span className={cn("rounded-[2px] border border-current", shape.auto && "border-dashed")} style={{ width: shape.w / 2, height: shape.h / 2 }} />
            </span>
            {shape.label}
          </button>
        ))}
      </div>}
    </fieldset>
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
        <div className="space-y-3 text-center">
          <h1 className="text-balance font-heading text-3xl leading-tight font-medium tracking-tight sm:text-4xl">{heading}</h1>
          <p className="text-pretty text-sm leading-relaxed text-muted-foreground">
            Describe your video, attach footage, or start with an idea.
          </p>
        </div>
      ) : null}
      <Glass shape="panel" thickness="thin" className="p-3 sm:p-4">
        <Chat
          controller={controller}
          suggestions={SUGGESTIONS}
          composerLabel="Describe your video"
          threadHidden={!controller.messages.length}
          threadClassName="h-[22rem]"
          tools={<TemplateChip value={templateIds} onChange={setTemplateIds} />}
          below={!controller.messages.length && onClips ? <StartFrom value={aspect} onChange={setAspect} /> : null}
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
        <span className="text-xl font-bold tracking-[-0.04em]">agentcut</span>
        <Button variant="ghost" size="sm" nativeButton={false} className="ml-auto" render={<Link href="/" />}>Projects</Button>
      </Glass>
      <StartChatPanel />
    </main>
  );
}
