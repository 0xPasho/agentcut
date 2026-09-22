"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowUp, Film, Folder, ImageIcon, Loader2, Music, Plus, RefreshCw, Upload } from "lucide-react";
import { api, assetFileUrl, type AssetSummary } from "@/lib/client";
import type { Edl } from "@/lib/edl";
import type { FolderListing } from "@/lib/editor/local-assets";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Card } from "./ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { ImageSearch } from "./image-search";
import { AssetViewer, transcriptionSentence, type TranscriptionState, type ViewerAsset } from "./asset-viewer";
import { setActiveDrag, writeDrag, type DragKind } from "@/lib/editor/dnd";

/** What `media.transcription` answers. The agent reads the same shape. */
type TranscriptionReport = { media: Array<TranscriptionState & { id: string; name: string }>; settings: { effective: { mode: string; scope: string } } };
const wordsFor = (report: TranscriptionReport | null, mediaId: string): TranscriptionState | undefined =>
  report?.media.find(m => m.id === mediaId);

export function MediaBrowser({ projectId, edl, beforeImport, afterImport, onBusy, onPlace, onPreview, onVideo, onLibraryVideo, onVideoLayer, onRemoveVideo, onReplace, replace, focus, videoAction = "Add to video", canPlace = true, children }: {
  projectId: string; edl: Edl; beforeImport: () => Promise<boolean>; afterImport: () => Promise<void>;
  onBusy: (busy: boolean) => void; onPlace: (asset: AssetSummary, mode?: "music" | "sfx") => void;
  onPreview?: () => void; onVideo: (mediaId: string) => void; onVideoLayer?: (mediaId: string) => void; onRemoveVideo?: (mediaId: string) => void;
  /** A library video: imported into the project and placed at the end of the main track. */
  onLibraryVideo?: (assetId: string) => void;
  onReplace?: (id: string, kind: "video" | "image" | "audio") => void; replace?: { kind: "video" | "image" | "audio"; title: string };
  /** "Show me the pictures" from elsewhere in the editor: the same browser, pointed at one kind. */
  focus?: { kind: "image" | "audio"; nonce: number } | null;
  videoAction?: string; canPlace?: boolean; children?: React.ReactNode;
}) {
  const [tab, setTab] = useState("project"), [filter, setFilter] = useState("");
  const [selectedKey,setSelectedKey]=useState<string|null>(null),[kind,setKind]=useState("all");
  const [assets, setAssets] = useState<AssetSummary[]>([]);
  const [folder, setFolder] = useState(""); const [listing, setListing] = useState<FolderListing | null>(null);
  const [pending, setPending] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [words, setWords] = useState<TranscriptionReport | null>(null);
  /** What every source's words were doing last time this was read, and what to say when one lands. */
  const heard = useRef(new Map<string, string>());
  const [announcement, setAnnouncement] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const search = useRef<HTMLInputElement>(null);
  // Only when it is asked for: a filter that reset itself on every render would fight the
  // person using it. The nonce is what makes asking twice in a row work.
  useEffect(() => {
    if (!focus) return;
    setKind(focus.kind); setFilter("");
    setTab(current => current === "project" || current === "library" ? current : "project");
    requestAnimationFrame(() => { search.current?.focus({ preventScroll: true }); search.current?.scrollIntoView({ block: "nearest" }); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.nonce]);
  const refresh = async () => {
    const results = await Promise.all(["image", "audio", "video"].map(kind => api.editorTool<AssetSummary[]>(projectId, { tool: "assets.list", kind })));
    setAssets(results.flat());
  };
  useEffect(() => { void refresh().catch(e => setError(e.message)); }, [projectId, tab]);
  /**
   * Where each source's words stand. Read through the same tool the agent calls, so
   * the two interfaces cannot drift, and polled only while something is actually
   * running — a project whose sources are all done costs one request.
   */
  const readWords = async () => {
    const next = await api.editorTool<TranscriptionReport>(projectId, { tool: "media.transcription" });
    // A source finishes on its own, minutes after it was dropped in and while somebody
    // is looking at something else. Whatever crossed from "being listened to" into a
    // settled answer since the last read is the news, and it is the only thing said.
    const landed = next.media.filter(m => (m.status === "done" || m.status === "failed")
      && ["running", "queued"].includes(heard.current.get(m.id) ?? ""));
    heard.current = new Map(next.media.map(m => [m.id, m.status]));
    if (landed.length) setAnnouncement(landed.map(m => `${m.name}: ${transcriptionSentence(m)}`).join(". "));
    setWords(next);
  };
  const busyWords = !!words?.media.some(m => m.status === "running" || m.status === "queued");
  useEffect(() => {
    let live = true;
    void readWords().catch(() => {});
    if (!busyWords) return () => { live = false; };
    // The words themselves arrive through the editor's own revision polling; this
    // only follows which source is being listened to.
    const timer = setInterval(() => { if (live) void readWords().catch(() => {}); }, 3000);
    return () => { live = false; clearInterval(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, busyWords, edl.media.length, edl.media.map(m => m.transcription?.status ?? "").join()]);
  const transcribe = (mediaId: string, force: boolean) => run(async () => {
    await api.editorTool(projectId, { tool: "media.transcribe", mediaIds: [mediaId], background: true, force });
    await readWords();
  }, false);
  const setMode = (mode: string) => run(async () => { await api.editorTool(projectId, { tool: "media.transcription.set", mode, level: "workspace" }); await readWords(); }, false);
  /**
   * An import rewrites the project underneath the editor, so it holds the rest of the editor
   * still until it lands. Only an import: reading a folder or the asset list changes nothing,
   * and freezing the timeline and the canvas while a listing loads reads as a broken page.
   */
  const run = async (fn: () => Promise<void>, writes = true) => {
    if (pending) return;
    setPending(true); if (writes) onBusy(true); setError(""); setNotice("");
    try { await fn(); } catch(e) { setError((e as Error).message); }
    finally { setPending(false); if (writes) onBusy(false); }
  };
  const browse = (path?: string, offset = 0) => run(async () => {
    const result = await api.editorTool<FolderListing>(projectId, { tool: "assets.browseLocal", folder: path || undefined, offset });
    setListing(result); setFolder(result.path);
  }, false);
  const importLocal = (file: string, kind: string) => run(async () => {
    if (!(await beforeImport())) return;
    if (kind === "video") {
      const p = await api.getProject(projectId);
      const imported=await api.editorTool<{edl:Edl}>(projectId, { tool: "media.import", file, expectedRevision: p.revision });
      setSelectedKey(`video:${imported.edl.media.at(-1)!.id}`);
      await afterImport();
    } else {
      const asset=await api.editorTool<AssetSummary>(projectId, { tool: "assets.importLocal", file });
      setSelectedKey(`asset:${asset.id}`);
    }
    await refresh(); setTab("project"); setKind("all"); setFilter(""); setNotice("Imported. Choose where to use it.");
  });
  const upload = (files: File[]) => run(async () => {
    if (!(await beforeImport())) return;
    let mediaChanged = false;
    try {
      for (const file of files) {
        if (/\.(mp4|mov|mkv|webm|m4v)$/i.test(file.name)) {
          const p = await api.getProject(projectId); const form = new FormData(); form.append("file", file); form.append("expectedRevision", String(p.revision));
          const response = await fetch(`/api/projects/${projectId}/media`, { method: "POST", body: form });
          if (!response.ok) throw new Error((await response.json()).error);
          mediaChanged = true;
        } else await api.uploadAsset(file);
      }
      setTab(mediaChanged ? "project" : "library"); setNotice("Imported. Choose where to use it.");
    } finally { if (mediaChanged) await afterImport(); await refresh(); }
  });
  const sources = [...(edl.media ?? [])];
  if (edl.source && !sources.some(m => m.file === edl.source!.file)) sources.unshift({ ...edl.source, id: "primary_source", name: "Original source" });
  const used = new Set([...edl.clips, ...(edl.sequences ?? []).flatMap(s => s.items.map(i => i.clip))].flatMap(c => c.edits.flatMap(e => "src" in e ? [e.src] : [])));
  const match = (name: string) => name.toLowerCase().includes(filter.toLowerCase());
  const visible = assets.filter(a => match(a.name) && (tab === "library" ? a.scope === "library" : a.project_id === projectId || a.in_project || used.has(a.id)));
  const collection:ViewerAsset[] = [
    ...(tab==='project'?sources.filter(m=>match(m.name)).map(m=>({key:`video:${m.id}`,id:m.id,name:m.name,kind:'video' as const,transcription:wordsFor(words,m.id),url:edl.media.some(source=>source.id===m.id)?`/api/projects/${projectId}/media/${m.id}`:`/api/projects/${projectId}/source`,duration:m.durationSec,width:m.width,height:m.height,used:edl.sequences.some(s=>s.items.some(i=>i.mediaId===m.id)) || (edl.source?.file===m.file&&!!edl.clips.length),removable:edl.media.some(source=>source.id===m.id)})):[]),
    ...visible.filter(a=>a.kind==='image'||a.kind==='audio'||a.kind==='video').map(a=>({key:`asset:${a.id}`,id:a.id,name:a.name,kind:a.kind as 'image'|'audio'|'video',url:assetFileUrl(a.id),duration:a.duration_sec,width:a.width,height:a.height,license:a.license,attribution:a.attribution,used:used.has(a.id),vector:/\.svg$/i.test(a.path ?? ''),library:a.kind==='video'})),
  ].filter(a=>kind==='all'||a.kind===kind);
  const place=(asset:ViewerAsset,mode?:'music'|'sfx')=>{
    if(asset.kind==='video'&&asset.library)onLibraryVideo?.(asset.id);
    else if(asset.kind==='video')onVideo(asset.id);
    else {const original=assets.find(a=>a.id===asset.id);if(original)onPlace(original,mode);}
    setNotice("");
  };
  const viewer=<AssetViewer assets={collection} selectedKey={selectedKey} onSelect={key=>{setSelectedKey(key);onPreview?.();}} onPlace={place} onOverlay={onVideoLayer?a=>{onVideoLayer(a.id);setNotice("");}:undefined} onRemove={onRemoveVideo?a=>onRemoveVideo(a.id):undefined} onReplace={onReplace?a=>{onReplace(a.id,a.kind);setNotice("");}:undefined} onTranscribe={(a,force)=>void transcribe(a.id,force)} replace={replace} disabled={!canPlace||pending} videoAction={videoAction} emptyMessage={filter||kind!=='all'?'No matching assets. Try another filter.':tab==='project'?'Import media or browse your folders to start building your video.':'Reusable images and audio live here. Import files or explore online images.'} />;
  return <Card className="min-w-0 gap-4 rounded-3xl border-white/12 bg-card/95 p-3 shadow-[inset_0_1px_0_rgb(255_255_255/0.06)]" aria-busy={pending}>
    <div className="flex items-center justify-between gap-2"><h2 className="text-sm font-semibold">Assets</h2><div className="flex gap-1"><Button variant="ghost" size="icon-sm" aria-label="Refresh assets" disabled={pending} onClick={() => run(refresh, false)}><RefreshCw /></Button><Button variant="outline" size="sm" disabled={pending} onClick={() => input.current?.click()}><Upload />Import</Button></div></div>
    <input ref={input} type="file" multiple accept="video/*,image/*,audio/*" className="hidden" onChange={e => { const files = Array.from(e.target.files ?? []); e.target.value = ""; if (files.length) void upload(files); }} />
    <Tabs value={tab} onValueChange={v => {setTab(String(v));setKind("all");}}>
      <TabsList className="grid h-auto w-full grid-cols-4"><TabsTrigger value="project" className="px-1 text-xs">Project</TabsTrigger><TabsTrigger value="library" className="px-1 text-xs">Library</TabsTrigger><TabsTrigger value="folders" className="px-1 text-xs">Folders</TabsTrigger><TabsTrigger value="online" className="px-1 text-xs">Online</TabsTrigger></TabsList>
      {(tab === "project" || tab === "library") && <div className="my-4 space-y-3"><Input ref={search} aria-label="Filter assets" placeholder="Search your media…" value={filter} onChange={e => setFilter(e.target.value)} /><div role="group" aria-label="Asset type" className="flex flex-wrap gap-1">{[['all','All'],['video','Video'],['image','Images'],['audio','Audio']].filter(([value])=>tab==='project'||value!=='video').map(([value,label])=><Button key={value} variant={kind===value?'secondary':'ghost'} size="xs" aria-pressed={kind===value} onClick={()=>setKind(value)}>{label}</Button>)}</div></div>}
      <TabsContent value="project" className="space-y-3">{viewer}{words&&<section aria-label="Transcription" className="space-y-2 rounded-2xl border border-white/10 bg-black/20 p-3">
        <p className="text-[11px] text-muted-foreground">{busyWords?`Listening to ${words.media.filter(m=>m.status==='running'||m.status==='queued').length} of ${words.media.length} sources. You can keep editing.`:'Imported videos are transcribed so captions, silence cuts and the agent can read what is said.'}</p>
        {/* A stable region, empty until a source lands, so the same news announces twice. */}
        <p role="status" className="sr-only">{announcement}</p>
        <div role="group" aria-label="Transcribe new sources" className="flex flex-wrap gap-1">{[['audio','When they have sound'],['always','Always'],['off','Never']].map(([value,label])=><Button key={value} variant={words.settings.effective.mode===value?'secondary':'ghost'} size="xs" aria-pressed={words.settings.effective.mode===value} disabled={pending} onClick={()=>setMode(value)}>{label}</Button>)}</div>
      </section>}{children}</TabsContent>
      <TabsContent value="library" className="space-y-3">{viewer}</TabsContent>
      <TabsContent value="folders" className="space-y-3 pt-3">
        <p className="text-xs leading-relaxed text-muted-foreground">Browse a folder on this computer. Drag a file onto the timeline to import it where you drop it, or use the add button to import it into the project. Imported files are copied into your workspace.</p>
        <form className="flex gap-2" onSubmit={e => { e.preventDefault(); void browse(folder); }}><Input aria-label="Folder path" value={folder} onChange={e => setFolder(e.target.value)} placeholder="~/Movies" /><Button type="submit" size="sm" variant="outline" disabled={pending}>Open</Button></form>
        <div className="flex flex-wrap gap-2"><Button size="xs" variant="outline" disabled={pending} onClick={() => browse()}>Home folder</Button><Button size="xs" variant="ghost" disabled={pending || !listing?.parent} onClick={() => browse(listing!.parent!)}><ArrowUp />Up</Button></div>
        {listing && <><p className="break-all text-[11px] text-muted-foreground">{listing.path}</p><ul className="space-y-1">{listing.entries.map(entry => <li key={entry.path} draggable={entry.kind !== "folder" && !pending}
      onDragStart={event => { if (entry.kind === "folder") return; const payload = { kind: entry.kind as DragKind, file: entry.path, name: entry.name }; writeDrag(event.dataTransfer, payload); setActiveDrag(payload); }}
      onDragEnd={() => setActiveDrag(null)}
      className={`flex min-w-0 items-center gap-2 rounded-lg bg-white/3 px-2 py-2 ${entry.kind === "folder" ? "" : "cursor-grab active:cursor-grabbing"}`}>{entry.kind === "folder" ? <Folder aria-hidden className="size-4 shrink-0 text-muted-foreground" /> : entry.kind === "video" ? <Film aria-hidden className="size-4 shrink-0 text-muted-foreground" /> : entry.kind === "image" ? <ImageIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" /> : <Music aria-hidden className="size-4 shrink-0 text-muted-foreground" />}{entry.kind === "folder" ? <button className="min-w-0 flex-1 break-words rounded text-left text-xs focus-visible:outline-2 focus-visible:outline-ring" disabled={pending} onClick={() => browse(entry.path)}>{entry.name}</button> : <><span className="min-w-0 flex-1 break-words text-xs">{entry.name}</span><Button variant="ghost" size="icon-sm" aria-label={`Import ${entry.name}`} disabled={pending} onClick={() => importLocal(entry.path, entry.kind)}><Plus /></Button></>}</li>)}</ul>{!listing.entries.length && <p className="text-xs text-muted-foreground">No supported media or subfolders in this folder.</p>}<div className="flex items-center justify-between gap-2"><Button size="xs" variant="ghost" disabled={pending || listing.offset === 0} onClick={() => browse(listing.path, Math.max(0,listing.offset-100))}>Previous</Button><span className="text-[10px] text-muted-foreground">{listing.total} entries</span><Button size="xs" variant="ghost" disabled={pending || listing.nextOffset === null} onClick={() => browse(listing.path, listing.nextOffset!)}>Next</Button></div></>}
      </TabsContent>
      <TabsContent value="online" className="space-y-3 pt-3"><p className="text-xs leading-relaxed text-muted-foreground">Search images online. A company or product name returns its official logo; Wikimedia Commons and Openverse cover photographs. Pexels, Unsplash and Google join in once their keys are configured. Credits stay with the asset.</p><ImageSearch projectId={projectId} onAdopt={asset => { setAssets(old=>[...old.filter(a=>a.id!==asset.id),asset]); setSelectedKey(`asset:${asset.id}`); setTab("project"); setKind("all"); setFilter(""); void refresh().catch(e=>setError(e.message)); setNotice("Image imported. Preview it, then choose where to place it."); }} /></TabsContent>
    </Tabs>
    {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    <p role="status" className="text-xs text-muted-foreground">{pending ? <span className="flex items-center gap-2"><Loader2 className="size-3 motion-safe:animate-spin" />Loading assets…</span> : notice}</p>
  </Card>;
}
