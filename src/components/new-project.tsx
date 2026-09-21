"use client";

import { useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, FileVideo, FolderOpen, Link2, Loader2, Scissors, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StartChatPanel } from "./start-chat";
import { LocalFilePicker } from "./local-file-picker";
import { api } from "@/lib/client";
import { classifyFile } from "@/lib/editor/dnd";

/**
 * Two ways into the same workspace: say what you want — with videos dropped in, a shape
 * and a template beside the box — or cut a long video into clips. They are entry points,
 * not products: both land in the one editor, with the same operations and the same
 * conversation. What to do with several videos is a sentence, not a form.
 */
export function NewProject() {
  const [flow, setFlow] = useState("make");
  return (
    <Tabs value={flow} onValueChange={value => setFlow(String(value))} className="gap-5">
      <TabsList className="mx-auto" aria-label="Start a project">
        <TabsTrigger value="make"><Sparkles />Make something</TabsTrigger>
        <TabsTrigger value="clips"><Scissors />Clip a long video</TabsTrigger>
      </TabsList>
      {/* Say it, drop it, or shape it first — one box, and the shape and look are chosen
          beside it rather than on a screen of their own. */}
      <TabsContent value="make"><StartChatPanel onClips={() => setFlow("clips")} /></TabsContent>
      <TabsContent value="clips"><ClippingStart /></TabsContent>
    </Tabs>
  );
}

function ClippingStart() {
  const router = useRouter();
  const id = useId();
  const [source, setSource] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [picking, setPicking] = useState(false);
  const [pending, start] = useTransition();
  const sourceInput = useRef<HTMLInputElement>(null);

  const open = (projectId: string) => {
    router.push(`/p/${projectId}`);
    router.refresh();
  };

  const submit = (value = source) => {
    if (pending) return;
    if (!value.trim()) {
      setError("Paste a video link or local path, or choose a file from this computer.");
      sourceInput.current?.focus();
      return;
    }
    setError(null);
    start(async () => {
      try {
        open((await api.createProject(value)).id);
      } catch (e) {
        setError((e as Error).message);
      }
    });
  };

  /** A drop hands over bytes and no path, so those are copied in; a picked file is not. */
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
        <Button variant="outline" size="lg" disabled={pending} onClick={() => setPicking(true)}>
          <FolderOpen aria-hidden /> Choose from this computer
        </Button>
        <p role="status" className="min-h-5 text-xs text-muted-foreground">
          {pending ? "Adding your video…" : "Your file stays where it is — the project just points at it."}
        </p>
        <LocalFilePicker
          open={picking}
          onOpenChange={setPicking}
          title="Choose a video on this computer"
          description="Nothing is copied or uploaded. The project reads the file where it already lives, and the agent gets the same path."
          onPick={(file) => { setPicking(false); setSource(file.path); submit(file.path); }}
        />
      </CardContent>
    </Card>
  );
}
