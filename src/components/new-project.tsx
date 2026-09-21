"use client";

import { useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, FileVideo, Film, Link2, Loader2, MessageCircle, Plus, Scissors, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StartChatPanel } from "./start-chat";
import { api } from "@/lib/client";
import { classifyFile } from "@/lib/editor/dnd";

/**
 * Three ways into the same workspace: drop footage and edit it, cut a long video into
 * clips, or say what you want. They are entry points, not products — whichever you pick,
 * you land in the one editor, with the same operations and the same conversation.
 */
export function NewProject() {
  const [flow, setFlow] = useState("edit");
  return (
    <Tabs value={flow} onValueChange={value => setFlow(String(value))} className="gap-5">
      <TabsList className="mx-auto" aria-label="Start a project">
        <TabsTrigger value="edit"><Film />Edit</TabsTrigger>
        <TabsTrigger value="clips"><Scissors />Clips</TabsTrigger>
        <TabsTrigger value="chat"><MessageCircle />Chat</TabsTrigger>
      </TabsList>
      <TabsContent value="edit"><EditStart /></TabsContent>
      <TabsContent value="clips"><ClippingStart /></TabsContent>
      <TabsContent value="chat">
        <Card><CardContent className="flex min-h-[26rem] flex-col py-6"><StartChatPanel heading="What do you want to make?" /></CardContent></Card>
      </TabsContent>
    </Tabs>
  );
}

/**
 * Drop videos in and start editing. Footage is optional: with nothing dropped this is an
 * empty canvas in the same editor. Several files can mean one video made of them or one
 * video each, which is asked rather than guessed.
 */
function EditStart() {
  const router = useRouter();
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [paths, setPaths] = useState("");
  const [name, setName] = useState("");
  const [layout, setLayout] = useState<"together" | "separate">("together");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);

  /** Say the drop will land before it does. */
  const add = (dropped: File[]) => {
    const videos = dropped.filter(file => classifyFile(file.name) === "video");
    if (!videos.length) return setError("Choose video files to start from. Images and audio are added inside the editor.");
    setError("");
    setFiles(old => [...old, ...videos.filter(file => !old.some(kept => kept.name === file.name && kept.size === file.size))]);
  };

  const submit = async () => {
    setPending(true); setError("");
    try {
      let body: FormData | string, headers: HeadersInit | undefined;
      if (files.length) {
        body = new FormData();
        body.append("name", name);
        body.append("layout", layout);
        files.forEach(file => (body as FormData).append("files", file));
      } else {
        body = JSON.stringify({ name, layout, files: paths.split("\n").map(line => line.trim()).filter(Boolean) });
        headers = { "Content-Type": "application/json" };
      }
      const response = await fetch("/api/projects/assemble", { method: "POST", body, headers });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      router.push(`/p/${data.id}/edit`);
      router.refresh();
    } catch (e) { setError((e as Error).message); setPending(false); }
  };

  return (
    <Card
      aria-busy={pending}
      onDragOver={e => { e.preventDefault(); if (!pending) setDragging(true); }}
      onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false); }}
      onDrop={e => { e.preventDefault(); setDragging(false); if (!pending) add(Array.from(e.dataTransfer.files)); }}
      className={`border border-dashed transition-[border-color,box-shadow] duration-150 motion-reduce:transition-none ${dragging ? "border-primary/70 shadow-[0_0_0_4px_var(--glass-specular)]" : "border-white/15"}`}
    >
      <CardContent className="mx-auto flex w-full max-w-2xl flex-col gap-6 py-5 sm:py-8">
        <div className="space-y-2 text-center">
          <Film aria-hidden className="mx-auto mb-4 size-8 text-primary" />
          <h2 className="text-balance text-2xl font-semibold tracking-tight sm:text-3xl">{dragging ? "Drop your footage here" : "Drag your videos in"}</h2>
          <p className="text-pretty text-sm leading-relaxed text-muted-foreground">
            Drop them here and start editing. Titles, images and audio come later, in the same editor — and nothing is required to begin.
          </p>
        </div>

        <Label htmlFor={`${id}-name`}>Project name</Label>
        <Input id={`${id}-name`} value={name} disabled={pending} onChange={e => setName(e.target.value)} placeholder="My next video" />

        {files.length > 0 && (
          <ol className="space-y-2">
            {files.map((file, index) => (
              <li key={`${index}-${file.name}`} className="flex items-center gap-3 rounded-xl bg-white/5 px-3 py-2">
                <span className="text-xs tabular-nums text-muted-foreground">{String(index + 1).padStart(2, "0")}</span>
                <span className="min-w-0 flex-1 break-words text-sm">{file.name}</span>
                <Button variant="ghost" size="icon-sm" disabled={pending} aria-label={`Remove ${file.name}`} onClick={() => setFiles(files.filter((_, n) => n !== index))}><X /></Button>
              </li>
            ))}
          </ol>
        )}

        {files.length > 1 && (
          <fieldset className="space-y-2">
            <legend className="text-sm">{files.length} videos</legend>
            <div className="grid grid-cols-2 gap-2">
              <Button type="button" variant={layout === "together" ? "secondary" : "outline"} aria-pressed={layout === "together"} disabled={pending} onClick={() => setLayout("together")}>One video</Button>
              <Button type="button" variant={layout === "separate" ? "secondary" : "outline"} aria-pressed={layout === "separate"} disabled={pending} onClick={() => setLayout("separate")}>One each</Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {layout === "together" ? "All of them on one timeline, in this order." : "One timeline per video, in a single project — ask the agent to edit them all the same way."}
            </p>
          </fieldset>
        )}

        <Button variant="outline" size="lg" disabled={pending} onClick={() => input.current?.click()}><Plus />{files.length ? "Add more videos" : "Choose videos"}</Button>
        <input ref={input} type="file" accept="video/*" multiple className="hidden" onChange={e => { add(Array.from(e.target.files ?? [])); e.target.value = ""; }} />

        {!files.length && (
          <details className="text-sm">
            <summary className="cursor-pointer text-muted-foreground">Use local file paths</summary>
            <label className="mt-3 block space-y-2">Video paths, one per line
              <Textarea disabled={pending} value={paths} onChange={e => setPaths(e.target.value)} placeholder="/Users/me/Videos/interview.mp4" />
            </label>
          </details>
        )}

        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <Button size="lg" disabled={pending} onClick={submit}>{pending ? <Loader2 className="motion-safe:animate-spin" /> : <Film />}{pending ? "Opening your project…" : "Open editor"}</Button>
        <p role="status" className="text-center text-xs text-muted-foreground">{pending ? "Preparing your local project." : "No footage required. Your project stays on this computer."}</p>
      </CardContent>
    </Card>
  );
}

function ClippingStart() {
  const router = useRouter();
  const id = useId();
  const [source, setSource] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [pending, start] = useTransition();
  const fileInput = useRef<HTMLInputElement>(null);
  const sourceInput = useRef<HTMLInputElement>(null);

  const open = (projectId: string) => {
    router.push(`/p/${projectId}`);
    router.refresh();
  };

  const submit = () => {
    if (pending) return;
    if (!source.trim()) {
      setError("Paste a video link or local path, or choose Upload video.");
      sourceInput.current?.focus();
      return;
    }
    setError(null);
    start(async () => {
      try {
        open((await api.createProject(source)).id);
      } catch (e) {
        setError((e as Error).message);
      }
    });
  };

  const upload = (file: File) => {
    if (pending) return;
    setError(null);
    start(async () => {
      try {
        open((await api.uploadProject(file)).id);
      } catch (e) {
        setError((e as Error).message);
      }
    });
  };

  return (
    <Card
      aria-busy={pending}
      onDragOver={(e) => {
        e.preventDefault();
        if (!pending) setDragging(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const file = Array.from(e.dataTransfer.files).find(candidate => classifyFile(candidate.name) === "video");
        if (file) upload(file);
        else setError("Choose a video file to find clips in.");
      }}
      className={`border border-dashed transition-[border-color,box-shadow] duration-150 motion-reduce:transition-none ${
        dragging ? "border-primary/70 shadow-[0_0_0_4px_var(--glass-specular)]" : "border-white/15"
      }`}
    >
      <CardContent className="flex flex-col items-center gap-7 py-8 sm:py-12">
        <div aria-hidden className="flex size-16 items-center justify-center rounded-[20px] border border-white/15 bg-linear-to-b from-white/10 to-white/3 shadow-(--control-highlight)">
          {pending ? <Loader2 className="size-7 motion-safe:animate-spin text-muted-foreground" /> : <FileVideo className="size-7 text-foreground/80" />}
        </div>
        <div className="space-y-2 text-center">
          <h2 className="text-balance text-2xl font-semibold tracking-tight sm:text-3xl">
            {dragging ? "Drop your video here" : "Turn a long video into clips"}
          </h2>
          <p className="max-w-sm text-pretty text-sm leading-relaxed text-muted-foreground">
            Drop a stream or a talk, paste a YouTube link, or choose a file. Every clip it finds opens in the editor.
          </p>
        </div>
        <form className="flex w-full max-w-xl flex-col gap-3" onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <Label htmlFor={id}>Video link or local path</Label>
          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="relative min-w-0 flex-1">
              <Link2 aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id={id}
                ref={sourceInput}
                value={source}
                disabled={pending}
                aria-invalid={!!error}
                aria-describedby={error ? `${id}-error` : undefined}
                onChange={(e) => { setSource(e.target.value); setError(null); }}
                placeholder="https://youtube.com/watch?v=…"
                className="h-11 pl-9"
              />
            </div>
            <Button type="submit" size="lg" disabled={pending}>Add video <ArrowRight aria-hidden /></Button>
          </div>
          {error ? <p id={`${id}-error`} role="alert" className="text-sm text-destructive">{error}</p> : null}
        </form>
        <div className="flex w-full max-w-xl items-center gap-4">
          <span className="h-px flex-1 bg-border" />
          <span className="text-xs text-muted-foreground">or</span>
          <span className="h-px flex-1 bg-border" />
        </div>
        <Button variant="outline" size="lg" disabled={pending} onClick={() => fileInput.current?.click()}>
          <Upload aria-hidden /> Upload video
        </Button>
        <p role="status" className="min-h-5 text-xs text-muted-foreground">{pending ? "Adding your video…" : "Choose a video file to get started."}</p>
        <input ref={fileInput} type="file" accept="video/*" className="hidden" onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) upload(file);
          e.target.value = "";
        }} />
      </CardContent>
    </Card>
  );
}
