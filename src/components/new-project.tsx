"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileVideo, Link2, Loader2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { api } from "@/lib/client";

export function NewProject() {
  const router = useRouter();
  const [source, setSource] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [pending, start] = useTransition();
  const fileInput = useRef<HTMLInputElement>(null);

  const open = (id: string) => {
    router.push(`/p/${id}`);
    router.refresh();
  };

  const submit = () => {
    if (!source.trim()) return;
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
      role="button"
      tabIndex={0}
      aria-label="Choose a video to clip"
      onClick={(e) => {
        // No secuestrar los clics del campo de texto ni de los botones.
        if ((e.target as HTMLElement).closest("input,button,a")) return;
        fileInput.current?.click();
      }}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          fileInput.current?.click();
        }
      }}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const file = e.dataTransfer.files?.[0];
        if (file) upload(file);
      }}
      className={`cursor-pointer border border-dashed transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring ${
        dragging ? "border-primary bg-primary/5" : "border-border bg-card hover:border-white/25"
      }`}
    >
      <CardContent className="flex flex-col items-center gap-6 py-12">
        <div className="flex size-14 items-center justify-center rounded-2xl border border-white/10 bg-white/5">
          {pending ? (
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          ) : (
            <FileVideo className="size-6 text-muted-foreground" />
          )}
        </div>

        <div className="text-center">
          <p className="text-xl font-semibold tracking-tight">Drop a video to clip it</p>
          <p className="text-sm text-muted-foreground">
            or paste a YouTube URL or a path on this machine
          </p>
        </div>

        <div className="flex w-full max-w-xl items-center gap-2">
          <div className="relative flex-1">
            <Link2 className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={source}
              disabled={pending}
              onChange={(e) => setSource(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              placeholder="https://youtube.com/watch?v=…  or  ~/Movies/podcast.mp4"
              className="pl-9"
            />
          </div>
          <Button onClick={submit} disabled={pending || !source.trim()}>
            Add
          </Button>
          <Button variant="outline" disabled={pending} onClick={() => fileInput.current?.click()}>
            <Upload className="size-4" />
            Upload
          </Button>
        </div>

        <input
          ref={fileInput}
          type="file"
          accept="video/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) upload(file);
          }}
        />

        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </CardContent>
    </Card>
  );
}
