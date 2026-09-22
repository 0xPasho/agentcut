"use client";
import { useEffect, useId, useMemo, useState } from "react";
import { Compass, Crop, Image as ImageIcon, Loader2, Save, Sparkles, Wand2 } from "lucide-react";
import { api, type AssetSummary } from "@/lib/client";
import type { TemplateRecord, VideoTemplate } from "@/lib/templates/schema";
import type { SlotValue, TemplatePlan } from "@/lib/templates/plan";
import type { DroppedBeat, TemplateApplyResult } from "@/lib/templates/apply";
import type { TemplateSuggestion } from "@/lib/templates/suggest";
import { Button } from "./ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Disclosure } from "@/components/ui/disclosure";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Slider } from "./ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Separator } from "./ui/separator";

/**
 * The human half of the template feature. Every button here calls the same
 * project tool an agent calls — `template.plan` to see what it would do, then
 * `template.apply` to commit it through the shared operation engine. There is no
 * second code path behind this panel.
 */

const SOURCE_LABELS: Record<string, string> = {
  slot: "Your pictures", brand: "Brand logos", project: "Project assets",
  frame: "Frames from this footage", web: "Image search",
};
const ALL_SOURCES = ["slot", "brand", "project", "frame", "web"];
/** Base UI prints the raw value unless the trigger is told what to show. */
const HOOK_LABELS: Record<string, string> = {
  sticky: "Stays on screen the whole video", intro: "Opening card only", off: "No hook",
};
const FRAMING_LABELS: Record<string, string> = {
  source: "Leave each shot's own framing", crop: "Centre of the frame", split: "Screen and person, stacked",
};
const CAMERA_LABELS: Record<string, string> = { top: "Person on top", bottom: "Person underneath" };
const MODE_LABELS: Record<string, string> = {
  auto: "Only where a sentence names something", alternate: "Every other sentence",
  every: "Every sentence that can be illustrated", off: "No pictures",
};
const STYLE_LABELS: Record<string, string> = {
  auto: "Automatic — logo for a brand, card otherwise", card: "Photo card",
  plain: "Bare picture", logo: "Logo plate",
};
const labelled = (labels: Record<string, string>, fallback: string) =>
  (value: unknown) => labels[String(value)] ?? fallback;
const asNumber = (v: number | readonly number[]) => (Array.isArray(v) ? v[0] : (v as number));

type Overrides = {
  captionLook?: string;
  layout: Pick<VideoTemplate["layout"], "mode" | "cameraPct" | "cameraPosition" | "camera" | "screen">;
  hook: Pick<VideoTemplate["hook"], "mode">;
  images: Pick<VideoTemplate["images"], "mode" | "density" | "minSentenceGap" | "durationSec" | "widthPct" | "logoWidthPct" | "style" | "sources">;
  rhythm: { silence: { enabled: boolean }; punch: { enabled: boolean; perMinute: number } };
};

const overridesFrom = (template: VideoTemplate): Overrides => ({
  ...(template.captionLook ? { captionLook: template.captionLook } : {}),
  layout: {
    mode: template.layout.mode, cameraPct: template.layout.cameraPct, cameraPosition: template.layout.cameraPosition,
    camera: { ...template.layout.camera }, screen: { ...template.layout.screen },
  },
  hook: { mode: template.hook.mode },
  images: {
    mode: template.images.mode, density: template.images.density, minSentenceGap: template.images.minSentenceGap,
    durationSec: template.images.durationSec, widthPct: template.images.widthPct,
    logoWidthPct: template.images.logoWidthPct, style: template.images.style,
    // A source list is compared and edited as a set of kinds; a `web:pexels` entry keeps its provider.
    sources: template.images.sources,
  },
  rhythm: {
    silence: { enabled: template.rhythm.silence.enabled },
    punch: { enabled: template.rhythm.punch.enabled, perMinute: template.rhythm.punch.perMinute },
  },
});

export function TemplatePanel({ projectId, sequenceId, beforeApply, afterApply, onBusy }: {
  projectId: string;
  sequenceId: string;
  beforeApply: () => Promise<boolean>;
  afterApply: () => Promise<void>;
  onBusy: (busy: boolean) => void;
}) {
  const id = useId();
  const [templates, setTemplates] = useState<TemplateRecord[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [overrides, setOverrides] = useState<Overrides | null>(null);
  const [hookText, setHookText] = useState("");
  const [slots, setSlots] = useState<Record<string, SlotValue>>({});
  const [plan, setPlan] = useState<TemplatePlan | null>(null);
  const [pending, setPending] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saveAs, setSaveAs] = useState("");
  const [assets, setAssets] = useState<AssetSummary[]>([]);
  const [suggestions, setSuggestions] = useState<TemplateSuggestion[] | null>(null);
  const [looks, setLooks] = useState<Array<{ id: string; label: string; description: string }>>([]);
  useEffect(() => { api.editorTool<Array<{ id: string; label: string; description: string }>>(projectId, { tool: "templates.looks" }).then(setLooks).catch(() => setLooks([])); }, [projectId]);
  const [dropped, setDropped] = useState<DroppedBeat[]>([]);

  const template = useMemo(() => templates.find((t) => t.id === templateId) ?? null, [templates, templateId]);

  const load = async (select?: string) => {
    const list = await api.editorTool<TemplateRecord[]>(projectId, { tool: "templates.list" });
    setTemplates(list);
    const next = select ?? (list.some((t) => t.id === templateId) ? templateId : list[0]?.id ?? "");
    setTemplateId(next);
    const chosen = list.find((t) => t.id === next);
    if (chosen) setOverrides(overridesFrom(chosen));
  };
  useEffect(() => { void load().catch((e) => setError((e as Error).message)); }, [projectId]);
  useEffect(() => {
    void Promise.all(["image", "audio", "video"].map((kind) => api.editorTool<AssetSummary[]>(projectId, { tool: "assets.list", kind })))
      .then((lists) => setAssets(lists.flat()))
      .catch(() => setAssets([]));
  }, [projectId]);
  useEffect(() => { setPlan(null); setNotice(""); setDropped([]); }, [templateId, sequenceId]);
  useEffect(() => { setSuggestions(null); }, [sequenceId]);

  const run = async (label: string, fn: () => Promise<void>) => {
    if (pending) return;
    setPending(label); onBusy(true); setError(""); setNotice("");
    try { await fn(); } catch (e) { setError((e as Error).message); }
    finally { setPending(""); onBusy(false); }
  };

  const request = () => ({
    templateId, sequenceId,
    ...(hookText.trim() ? { hookText: hookText.trim() } : {}),
    ...(Object.keys(slots).length ? { slots } : {}),
    ...(overrides ? { overrides } : {}),
  });

  const suggest = () => run("suggest", async () => {
    const result = await api.editorTool<{ suggestions: TemplateSuggestion[] }>(projectId,
      { tool: "templates.suggest", sequenceId, ...(Object.keys(slots).length ? { slots } : {}) });
    setSuggestions(result.suggestions);
  });

  const choose = (suggestion: TemplateSuggestion) => {
    setTemplateId(suggestion.templateId);
    const chosen = templates.find((t) => t.id === suggestion.templateId);
    if (chosen) setOverrides(overridesFrom(chosen));
    setSuggestions(null);
  };

  const preview = () => run("preview", async () => {
    setPlan(await api.editorTool<TemplatePlan>(projectId, { tool: "template.plan", ...request() }));
  });

  const apply = () => run("apply", async () => {
    if (!(await beforeApply())) return;
    const current = await api.getProject(projectId);
    const result = await api.editorTool<TemplateApplyResult>(
      projectId, { tool: "template.apply", ...request(), expectedRevision: current.revision });
    await afterApply();
    setPlan(result.plan);
    setDropped(result.applied.dropped);
    const { images, dropped: missed, credits } = result.applied;
    setNotice(`Applied ${template?.name}. ${images} picture${images === 1 ? "" : "s"} placed`
      + (missed.length ? `, ${missed.length} beat${missed.length === 1 ? "" : "s"} left bare` : "")
      + (credits.length ? `. ${credits.length} credit line${credits.length === 1 ? "" : "s"} recorded with the assets` : "") + ".");
  });

  const saveTemplate = () => run("save", async () => {
    if (!template || !overrides) return;
    const name = saveAs.trim();
    if (!name) throw new Error("Name your template first.");
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    if (!slug) throw new Error("Use letters or digits in the template name.");
    // The same overrides that Apply would use, merged by the same code. Re-merging
    // them here would quietly ignore any part of a template this panel cannot edit.
    const saved = await api.editorTool<TemplateRecord>(projectId,
      { tool: "templates.save", from: template.id, id: slug, name, author: "you", overrides });
    setSaveAs("");
    await load(saved.id);
    setNotice(`Saved as your own template. It lives in your workspace at templates/${saved.id}.json.`);
  });

  const setImages = (patch: Partial<Overrides["images"]>) =>
    setOverrides((current) => current && ({ ...current, images: { ...current.images, ...patch } }));
  const setLayout = (patch: Partial<Overrides["layout"]>) =>
    setOverrides((current) => current && ({ ...current, layout: { ...current.layout, ...patch } }));
  /** A rectangle is edited as whole percentages of the frame; the document keeps fractions. */
  const setRect = (which: "camera" | "screen", side: "x" | "y" | "w" | "h", percent: number) =>
    setOverrides((current) => current && ({ ...current,
      layout: { ...current.layout, [which]: { ...current.layout[which], [side]: Math.min(100, Math.max(0, percent)) / 100 } } }));

  const chosenSources = new Set((overrides?.images.sources ?? []).map((s) => s.split(":")[0]));
  // The template's own order, with any kind it never listed appended in the canonical order.
  const sourceOrder = [
    ...(template?.images.sources ?? []),
    ...ALL_SOURCES.filter((kind) => !(template?.images.sources ?? []).some((s) => s.split(":")[0] === kind)),
  ];
  const busy = !!pending;
  const setSlot = (id: string, value: SlotValue) => setSlots((current) => {
    const next = { ...current };
    if (!Object.values(value).some((entry) => typeof entry === "string" ? entry.trim() : entry)) delete next[id];
    else next[id] = value;
    return next;
  });
  const cueBySentence = (itemIndex: number) =>
    new Map((plan?.items[itemIndex]?.cues ?? []).map((cue) => [cue.sentenceIndex, cue]));

  return (
    <div className="flex flex-col gap-4" aria-busy={busy}>
      <div className="flex flex-col gap-2">
        <Label id={`${id}-template`} className="text-xs text-muted-foreground">Template</Label>
        <Select value={templateId} onValueChange={(v) => { setTemplateId(String(v)); const chosen = templates.find((t) => t.id === v); if (chosen) setOverrides(overridesFrom(chosen)); }}>
          <SelectTrigger aria-labelledby={`${id}-template`} className="w-full">
            <SelectValue>{(value: unknown) => templates.find((t) => t.id === value)?.name ?? "Choose a template"}</SelectValue>
          </SelectTrigger>
          <SelectContent>{templates.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}{t.builtin ? "" : " (yours)"}</SelectItem>)}</SelectContent>
        </Select>
        {template && <p className="text-xs leading-relaxed text-muted-foreground">{template.description}</p>}
        {template && <img key={`${template.id}-${templateId}`} src={`/api/templates/${encodeURIComponent(template.id)}/preview?project=${encodeURIComponent(projectId)}&sequence=${encodeURIComponent(sequenceId)}&t=${template.file ? encodeURIComponent(template.file) : "builtin"}`} alt={`${template.name} layout`} className="h-40 w-auto self-start rounded-xl border border-border" />}
        <Button size="xs" variant="ghost" className="self-start" disabled={busy} onClick={suggest}>
          {pending === "suggest" ? <Loader2 className="motion-safe:animate-spin" /> : <Compass />}Which one suits this video?
        </Button>
        {suggestions && (
          <ol className="space-y-1">
            {suggestions.map((suggestion) => (
              <li key={suggestion.templateId}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => choose(suggestion)}
                  className="w-full rounded-lg bg-white/4 px-2 py-1.5 text-left text-[11px] leading-relaxed outline-none hover:bg-white/8 focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="font-medium">{suggestion.name}</span>
                  <span className="text-muted-foreground"> · {Math.round(suggestion.fit * 100)}% fit
                    {/* A picture count is noise next to "cannot be applied yet". */}
                    {suggestion.missingSlots.length ? "" :
                      suggestion.expectedImages ? ` · about ${suggestion.expectedImages} picture${suggestion.expectedImages === 1 ? "" : "s"}` : " · no pictures"}</span>
                  <span className="block text-muted-foreground">{suggestion.why.join("; ")}</span>
                </button>
              </li>
            ))}
          </ol>
        )}
      </div>

      {template && overrides && <>
        <div className="flex flex-col gap-2">
          <Label id={`${id}-look`} className="text-xs text-muted-foreground">Caption look</Label>
          <Select value={overrides.captionLook ?? ""} onValueChange={(v) => setOverrides({ ...overrides, captionLook: v ? String(v) : undefined })}>
            <SelectTrigger aria-labelledby={`${id}-look`} className="w-full"><SelectValue>{(v: unknown) => looks.find((l) => l.id === v)?.label ?? "As the template says"}</SelectValue></SelectTrigger>
            <SelectContent><SelectItem value="">As the template says</SelectItem>{looks.map((l) => <SelectItem key={l.id} value={l.id}>{l.label} — {l.description}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-2">
          <Label className="text-xs text-muted-foreground" htmlFor={`${id}-hook`}>Hook line</Label>
          <Input id={`${id}-hook`} value={hookText} placeholder="Leave empty to use this video's own hook" onChange={(e) => setHookText(e.target.value)} />
          <Select value={overrides.hook.mode} onValueChange={(v) => setOverrides({ ...overrides, hook: { mode: v as Overrides["hook"]["mode"] } })}>
            <SelectTrigger aria-label="Hook behaviour" className="w-full"><SelectValue>{labelled(HOOK_LABELS, "No hook")}</SelectValue></SelectTrigger>
            <SelectContent>
              <SelectItem value="sticky">Stays on screen the whole video</SelectItem>
              <SelectItem value="intro">Opening card only</SelectItem>
              <SelectItem value="off">No hook</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Separator />

        <div className="flex flex-col gap-3">
          <h3 className="flex items-center gap-2 text-xs font-medium"><Crop aria-hidden className="size-3.5" />Framing</h3>
          <Select value={overrides.layout.mode} onValueChange={(v) => setLayout({ mode: v as Overrides["layout"]["mode"] })}>
            <SelectTrigger aria-label="How the source fills the frame" className="w-full"><SelectValue>{labelled(FRAMING_LABELS, "Leave each shot's own framing")}</SelectValue></SelectTrigger>
            <SelectContent>
              <SelectItem value="source">Leave each shot&apos;s own framing</SelectItem>
              <SelectItem value="crop">Centre of the frame</SelectItem>
              <SelectItem value="split">Screen and person, stacked</SelectItem>
            </SelectContent>
          </Select>
          {overrides.layout.mode === "split" && <>
            <p className="text-xs text-muted-foreground">
              Where each part sits in <em>your</em> recording, as a share of its frame. Nothing can read the
              webcam&apos;s position off a document, so this is the one setting to check against your own scene.
            </p>
            <Select value={overrides.layout.cameraPosition} onValueChange={(v) => setLayout({ cameraPosition: v as Overrides["layout"]["cameraPosition"] })}>
              <SelectTrigger aria-label="Which half the person is in" className="w-full"><SelectValue>{labelled(CAMERA_LABELS, "Person on top")}</SelectValue></SelectTrigger>
              <SelectContent>
                <SelectItem value="bottom">Person underneath</SelectItem>
                <SelectItem value="top">Person on top</SelectItem>
              </SelectContent>
            </Select>
            <Label className="text-xs text-muted-foreground">The person takes {overrides.layout.cameraPct}% of the height</Label>
            <Slider aria-label="Share of height the person takes" min={15} max={85} step={1} value={[overrides.layout.cameraPct]}
              onValueChange={(v) => setLayout({ cameraPct: asNumber(v) })} />
            {(["camera", "screen"] as const).map((which) => (
              <fieldset key={which} className="space-y-1.5">
                <legend className="text-xs text-muted-foreground">{which === "camera" ? "The webcam in your scene (%)" : "The part of the screen to show (%)"}</legend>
                <div className="grid grid-cols-4 gap-2">
                  {(["x", "y", "w", "h"] as const).map((side) => (
                    <label key={side} className="space-y-1 text-xs text-muted-foreground">
                      {{ x: "Left", y: "Top", w: "Width", h: "Height" }[side]}
                      <Input type="number" min={0} max={100} step="1"
                        value={Math.round(overrides.layout[which][side] * 100)}
                        onChange={(e) => setRect(which, side, Number(e.target.value))} />
                    </label>
                  ))}
                </div>
              </fieldset>
            ))}
          </>}
        </div>

        <Separator />

        <div className="flex flex-col gap-3">
          <h3 className="flex items-center gap-2 text-xs font-medium"><ImageIcon aria-hidden className="size-3.5" />Pictures</h3>
          <Select value={overrides.images.mode} onValueChange={(v) => setImages({ mode: v as Overrides["images"]["mode"] })}>
            <SelectTrigger aria-label="When to show a picture" className="w-full"><SelectValue>{labelled(MODE_LABELS, "No pictures")}</SelectValue></SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">Only where a sentence names something</SelectItem>
              <SelectItem value="alternate">Every other sentence</SelectItem>
              <SelectItem value="every">Every sentence that can be illustrated</SelectItem>
              <SelectItem value="off">No pictures</SelectItem>
            </SelectContent>
          </Select>
          {overrides.images.mode !== "off" && <>
            <Label className="flex items-center justify-between text-xs text-muted-foreground">
              At most {Math.round(overrides.images.density * 100)}% of sentences
              <span className="sr-only">Picture density</span>
            </Label>
            <Slider aria-label="Picture density" min={5} max={100} step={5} value={[Math.round(overrides.images.density * 100)]}
              onValueChange={(v) => setImages({ density: asNumber(v) / 100 })} />
            <Label className="text-xs text-muted-foreground">Skip at least {overrides.images.minSentenceGap} sentence{overrides.images.minSentenceGap === 1 ? "" : "s"} between pictures</Label>
            <Slider aria-label="Sentences between pictures" min={0} max={5} step={1} value={[overrides.images.minSentenceGap]}
              onValueChange={(v) => setImages({ minSentenceGap: asNumber(v) })} />
            <div className="grid grid-cols-2 gap-2">
              <label className="space-y-1 text-xs text-muted-foreground">Seconds on screen
                <Input type="number" min={0.3} step="0.1" value={overrides.images.durationSec} onChange={(e) => setImages({ durationSec: Number(e.target.value) })} /></label>
              {/* A logo plate is sized by its own width. Showing a field the plate ignores
                  is the kind of control that looks broken, so each style gets the one it reads. */}
              {overrides.images.style !== "logo" && (
                <label className="space-y-1 text-xs text-muted-foreground">{overrides.images.style === "auto" ? "Photo width (%)" : "Width (%)"}
                  <Input type="number" min={5} max={100} step="1" value={overrides.images.widthPct} onChange={(e) => setImages({ widthPct: Number(e.target.value) })} /></label>
              )}
              {(overrides.images.style === "logo" || overrides.images.style === "auto") && (
                <label className="space-y-1 text-xs text-muted-foreground">Logo width (%)
                  <Input type="number" min={5} max={100} step="1" value={overrides.images.logoWidthPct} onChange={(e) => setImages({ logoWidthPct: Number(e.target.value) })} /></label>
              )}
            </div>
            <Select value={overrides.images.style} onValueChange={(v) => setImages({ style: v as Overrides["images"]["style"] })}>
              <SelectTrigger aria-label="Picture style" className="w-full"><SelectValue>{labelled(STYLE_LABELS, "Photo card")}</SelectValue></SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">Automatic — logo plate for a brand, photo card otherwise</SelectItem>
                <SelectItem value="card">Photo card</SelectItem>
                <SelectItem value="plain">Bare picture</SelectItem>
                <SelectItem value="logo">Logo plate</SelectItem>
              </SelectContent>
            </Select>
            <fieldset className="space-y-1.5">
              <legend className="text-xs text-muted-foreground">Where pictures come from, in order</legend>
              {ALL_SOURCES.map((source) => (
                <Checkbox key={source} className="min-h-8 text-xs" checked={chosenSources.has(source)}
                  onCheckedChange={(on) => setImages({ sources: on
                    // Order is the whole point of this list, so a source comes back to
                    // the place the template gave it, not to the end of the line.
                    ? sourceOrder.filter((s) => s === source || chosenSources.has(s.split(":")[0]))
                    : overrides.images.sources.filter((s) => s.split(":")[0] !== source) })}>
                  {SOURCE_LABELS[source]}
                </Checkbox>
              ))}
            </fieldset>
          </>}
        </div>

        {template.slots.length > 0 && <>
          <Separator />
          <div className="flex flex-col gap-3">
            {template.slots.map((slot) => {
              const kind = slot.kind === "audio" ? "audio" : slot.kind === "video" ? "video" : "image";
              const choices = slot.kind === "audio" || slot.kind === "image" || slot.kind === "video"
                ? assets.filter((asset) => asset.kind === kind)
                : [];
              return (
                <label key={slot.id} className="space-y-1 text-xs text-muted-foreground">
                  {slot.label}{slot.required ? " (required)" : ""}
                  {slot.kind === "imagePool" ? (
                    <Input placeholder="~/Desktop/screenshots" value={slots[slot.id]?.folder ?? ""}
                      onChange={(e) => setSlot(slot.id, { folder: e.target.value })} />
                  ) : slot.kind === "text" ? (
                    <Input placeholder="Leave empty to skip it" value={slots[slot.id]?.text ?? ""}
                      onChange={(e) => setSlot(slot.id, { text: e.target.value })} />
                  ) : (
                    <Select value={slots[slot.id]?.assetId ?? ""} onValueChange={(v) => setSlot(slot.id, { assetId: String(v) })}>
                      <SelectTrigger aria-label={slot.label} className="w-full">
                        <SelectValue>{(value: unknown) => choices.find((a) => a.id === value)?.name ?? "None"}</SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {choices.length
                          ? choices.map((asset) => <SelectItem key={asset.id} value={asset.id}>{asset.name}</SelectItem>)
                          : <SelectItem value="" disabled>Import {kind} into this project first</SelectItem>}
                      </SelectContent>
                    </Select>
                  )}
                  <span className="block leading-relaxed">{slot.description}</span>
                </label>
              );
            })}
          </div>
        </>}

        <Separator />

        <div className="flex flex-col gap-2 text-xs">
          <Checkbox className="min-h-8 text-xs" checked={overrides.rhythm.silence.enabled}
            onCheckedChange={(enabled) => setOverrides({ ...overrides, rhythm: { ...overrides.rhythm, silence: { enabled } } })}>Cut dead air</Checkbox>
          <Checkbox className="min-h-8 text-xs" checked={overrides.rhythm.punch.enabled}
            onCheckedChange={(enabled) => setOverrides({ ...overrides, rhythm: { ...overrides.rhythm, punch: { ...overrides.rhythm.punch, enabled } } })}>Punch in on the line that lands</Checkbox>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" disabled={busy} onClick={preview}>
            {pending === "preview" ? <Loader2 className="motion-safe:animate-spin" /> : <Sparkles />}Preview plan</Button>
          <Button size="sm" disabled={busy || !sequenceId} onClick={apply}>
            {pending === "apply" ? <Loader2 className="motion-safe:animate-spin" /> : <Wand2 />}Apply to this video</Button>
        </div>

        {plan && <div className="space-y-2 rounded-xl border border-border bg-black/20 p-3">
          <p className="text-xs">
            {plan.totals.sentences} sentence{plan.totals.sentences === 1 ? "" : "s"} · {plan.totals.images} picture{plan.totals.images === 1 ? "" : "s"}
            {" "}· {plan.totals.silences} dead-air cut{plan.totals.silences === 1 ? "" : "s"}
            {plan.totals.redundancies > 0 && <> · {plan.totals.redundancies} false start{plan.totals.redundancies === 1 ? "" : "s"}</>}
            {" "}· {plan.totals.punches} punch-in{plan.totals.punches === 1 ? "" : "s"}
          </p>
          {plan.hook && <p className="text-xs text-muted-foreground">Hook: “{plan.hook.text}” {plan.hook.seconds === null ? "for the whole video" : `for ${plan.hook.seconds}s`}</p>}
          {plan.warnings.map((warning) => <p key={warning} role="alert" className="text-xs text-amber-400">{warning}</p>)}
          <ol className="max-h-56 space-y-1 overflow-y-auto">
            {plan.items.flatMap((item, itemIndex) => {
              const cues = cueBySentence(itemIndex);
              return item.analyses.slice(0, 60).map((analysis) => {
                const cue = cues.get(analysis.sentence.index);
                return <li key={`${item.itemId}-${analysis.sentence.index}`} className={`rounded-md px-2 py-1 text-[11px] leading-relaxed ${cue ? "bg-primary/15" : "text-muted-foreground"}`}>
                  {cue ? <span className="font-medium">🖼 {cue.query || "your picture"} — </span> : null}{analysis.sentence.text}
                </li>;
              });
            })}
          </ol>
          {!plan.totals.sentences && <p className="text-xs text-muted-foreground">No transcript on this video yet.</p>}
        </div>}

        <Separator />
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); saveTemplate(); }}>
          <Input aria-label="New template name" placeholder="Save these settings as…" value={saveAs} onChange={(e) => setSaveAs(e.target.value)} />
          <Button type="submit" size="sm" variant="outline" disabled={busy || !saveAs.trim()}>
            {pending === "save" ? <Loader2 className="motion-safe:animate-spin" /> : <Save />}Save</Button>
        </form>
      </>}

      {dropped.length > 0 && (
        <Disclosure variant="plain" className="rounded-2xl bg-amber-500/8 p-1 text-[11px] ring-1 ring-amber-500/25"
          summaryClassName="text-amber-300 hover:text-amber-200"
          summary={`${dropped.length} beat${dropped.length === 1 ? "" : "s"} wanted a picture and found none`}>
          {/* Which beats came back empty, and what each source said, is the only way to
              tell a template that needs tuning from a script that names nothing. */}
          <ul className="mt-2 space-y-1.5">
            {dropped.slice(0, 12).map((beat, index) => (
              <li key={`${beat.itemId}-${index}`} className="leading-relaxed">
                <span className="text-foreground">{beat.query ? `“${beat.query}” — ` : ""}{beat.sentence || `at ${beat.atSec.toFixed(1)}s`}</span>
                <span className="block text-muted-foreground">
                  {beat.attempts.map((a) => `${a.source}: ${a.detail ?? a.outcome}`).join(" · ") || "no source was configured to answer"}
                </span>
              </li>
            ))}
          </ul>
        </Disclosure>
      )}

      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      <p role="status" className="text-xs text-muted-foreground">{notice}</p>
    </div>
  );
}
