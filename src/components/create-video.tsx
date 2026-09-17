"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Film, Loader2, Plus, X } from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { Card, CardContent } from "./ui/card";

export function CreateVideo() {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [paths, setPaths] = useState("");
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const submit = async () => {
    setPending(true); setError("");
    try {
      let body: FormData | string, headers: HeadersInit | undefined;
      if (files.length) { body = new FormData(); body.append("name", name); files.forEach(f => (body as FormData).append("files", f)); }
      else { body = JSON.stringify({ name, files: paths.split("\n").map(p => p.trim()).filter(Boolean) }); headers = { "Content-Type": "application/json" }; }
      const response = await fetch("/api/projects/assemble", { method: "POST", body, headers });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      router.push(`/p/${data.id}/edit`); router.refresh();
    } catch (e) { setError((e as Error).message); setPending(false); }
  };
  return <Card aria-busy={pending} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); if (!pending) { const added = Array.from(e.dataTransfer.files); setFiles(old => [...old, ...added]); } }}>
    <CardContent className="mx-auto flex w-full max-w-2xl flex-col gap-6 py-5 sm:py-8">
      <div className="space-y-2 text-center"><Film aria-hidden className="mx-auto mb-4 size-8 text-primary" /><h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">Make something of your own</h2><p className="text-sm leading-relaxed text-muted-foreground">Start with an empty canvas. Add videos, images, titles, and audio as you go, using the same editor as your clips.</p></div>
      <label className="space-y-2 text-sm">Project name<Input value={name} disabled={pending} onChange={e => setName(e.target.value)} placeholder="My next video" /></label>
      {files.length > 0 && <ol className="space-y-2">{files.map((f,i) => <li key={`${i}-${f.name}`} className="flex items-center gap-3 rounded-xl bg-white/5 px-3 py-2"><span className="text-xs tabular-nums text-muted-foreground">{String(i+1).padStart(2,"0")}</span><span className="min-w-0 flex-1 break-words text-sm">{f.name}</span><Button variant="ghost" size="icon-sm" disabled={pending} aria-label={`Remove ${f.name}`} onClick={() => setFiles(files.filter((_,n) => n !== i))}><X /></Button></li>)}</ol>}
      <Button variant="outline" size="lg" disabled={pending} onClick={() => input.current?.click()}><Plus />{files.length ? "Add more videos" : "Add starting footage (optional)"}</Button>
      <input ref={input} type="file" accept="video/*" multiple className="hidden" onChange={e => { const added = Array.from(e.target.files ?? []); setFiles(old => [...old, ...added]); e.target.value = ""; }} />
      {!files.length && <details className="text-sm"><summary className="cursor-pointer text-muted-foreground">Use local file paths</summary><label className="mt-3 block space-y-2">Video paths, one per line<Textarea disabled={pending} value={paths} onChange={e => setPaths(e.target.value)} placeholder="/Users/me/Videos/interview.mp4" /></label></details>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <Button size="lg" disabled={pending} onClick={submit}>{pending ? <Loader2 className="motion-safe:animate-spin" /> : <Film />}{pending ? "Opening your project…" : "Open editor"}</Button>
      <p role="status" className="text-center text-xs text-muted-foreground">{pending ? "Preparing your local project." : "No footage required. Your project stays on this computer."}</p>
    </CardContent>
  </Card>;
}
