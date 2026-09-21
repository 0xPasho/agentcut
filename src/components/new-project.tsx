"use client";

import { useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, FileVideo, Link2, Loader2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { CreateVideo } from "./create-video";
import { api } from "@/lib/client";
import { classifyFile } from "@/lib/editor/dnd";

export function NewProject() {
  const [flow, setFlow] = useState("clips");
  return <section className="space-y-5"><div className="grid grid-cols-3 gap-3" aria-label="Start a project">
    <Button variant={flow === "clips" ? "secondary" : "outline"} size="lg" aria-pressed={flow === "clips"} onClick={() => setFlow("clips")}>Find clips</Button>
    <Button variant={flow === "batch" ? "secondary" : "outline"} size="lg" aria-pressed={flow === "batch"} onClick={() => setFlow("batch")}>Edit a set</Button>
    <Button variant={flow === "video" ? "secondary" : "outline"} size="lg" aria-pressed={flow === "video"} onClick={() => setFlow("video")}>Create a video</Button>
  </div>{flow === "clips" ? <ClippingStart /> : flow === "batch" ? <BatchStart /> : <CreateVideo />}</section>;
}

/** Several raw videos in, one edited set out. The brief is the first turn of the project's conversation. */
function BatchStart() {
  const router = useRouter();
  const id = useId();
  const [name, setName] = useState("");
  const [brief, setBrief] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const fileInput = useRef<HTMLInputElement>(null);
  const add = (chosen: FileList | File[] | null) => {
    const videos = Array.from(chosen ?? []).filter((f) => classifyFile(f.name) === "video");
    if (!videos.length) { setError("Choose video files."); return; }
    setError(null);
    setFiles((prev) => [...prev, ...videos.filter((f) => !prev.some((p) => p.name === f.name && p.size === f.size))]);
  };
  return (
    <Card aria-busy={pending} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); add(e.dataTransfer.files); }}>
      <CardContent className="flex flex-col gap-5 py-8">
        <div className="space-y-2 text-center">
          <h2 className="text-balance text-2xl font-semibold tracking-tight">Edit a set of raw videos</h2>
          <p className="mx-auto max-w-md text-pretty text-sm leading-relaxed text-muted-foreground">Each video is captioned, given a hook and edited under one shared plan, so they look like a series. You approve each one before it renders.</p>
        </div>
        <form className="mx-auto flex w-full max-w-xl flex-col gap-3" onSubmit={(e) => {
          e.preventDefault();
          if (!files.length) { setError("Add at least one video."); return; }
          start(async () => {
            try { const created = await api.createBatch(name.trim() || "Untitled set", files, brief); router.push(`/p/${created.id}`); router.refresh(); }
            catch (err) { setError((err as Error).message); }
          });
        }}>
          <Label htmlFor={`${id}-name`}>Set name</Label>
          <Input id={`${id}-name`} value={name} disabled={pending} placeholder="Tips for new users" onChange={(e) => setName(e.target.value)} />
          <Label htmlFor={`${id}-brief`}>What you want</Label>
          <Textarea id={`${id}-brief`} value={brief} disabled={pending} placeholder="Five short tips for TikTok, casual tone, my logo in the corner." onChange={(e) => setBrief(e.target.value)} />
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" disabled={pending} onClick={() => fileInput.current?.click()}><Upload aria-hidden /> Add videos</Button>
            <span className="text-xs text-muted-foreground">{files.length ? `${files.length} video${files.length === 1 ? "" : "s"} · ${files.map((f) => f.name).join(", ")}` : "or drop them here"}</span>
          </div>
          <input ref={fileInput} type="file" accept="video/*" multiple className="hidden" onChange={(e) => { add(e.target.files); e.target.value = ""; }} />
          {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
          <Button type="submit" size="lg" disabled={pending || !files.length}>{pending ? <Loader2 className="motion-safe:animate-spin" /> : null}Start the set <ArrowRight aria-hidden /></Button>
        </form>
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
            {dragging ? "Drop your video here" : "Your next clip starts here"}
          </h2>
          <p className="max-w-sm text-pretty text-sm leading-relaxed text-muted-foreground">
            Drop a video, paste a YouTube link, or choose a file from your computer.
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
