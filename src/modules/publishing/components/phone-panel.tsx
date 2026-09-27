"use client";
import { useState } from "react";
import { Camera, Play, Smartphone, Square } from "lucide-react";
import { Button } from "../../../common/ui/button";
import { Input } from "../../../common/ui/input";
import type { PublicationDetail, PublishingOverview, PublishingRun } from "../types";
import { PHONE_GUIDE } from "../data";

export function PhonePanel({ publication: p, data, run, busy }: { publication: PublicationDetail; data: PublishingOverview; run: PublishingRun; busy: boolean }) {
  const [attended, setAttended] = useState(false), [text, setText] = useState(""), [x, setX] = useState("0.5"), [y, setY] = useState("0.5"), [key, setKey] = useState("return");
  const session = data.sessions.filter(s => s.publicationId === p.id).at(-1);
  const hasPhone = p.destinations.some(d => data.connections.find(c => c.id === data.accounts.find(a => a.id === d.accountId)?.connectionId)?.provider === "iphone");
  if (!hasPhone) return null;
  const evidence = session?.evidence.at(-1);
  const command = (action: unknown, note: string) => run({ tool: "publication.phone.action", sessionId: session?.id, action, note });
  return <section className="space-y-3 rounded-xl border p-4"><h3 className="flex items-center gap-2 text-sm font-medium"><Smartphone className="size-4" aria-hidden />Publish with iPhone</h3>
    <p className="text-sm text-muted-foreground">Open iPhone Mirroring on this Mac. The agent downloads the video once, completes the selected apps and verifies each result.</p>
    <label className="flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" checked={attended} onChange={e => setAttended(e.target.checked)} />I am here and the phone is ready.</label>
    <div className="flex flex-wrap gap-2">
      <Button disabled={busy || !attended || session?.status === "active"} onClick={() => void run({ tool: "publication.phone.start", id: p.id, attended: true, run: true })}><Play />Start agent session</Button>
      {session && session.status !== "done" && <Button variant="outline" disabled={busy || !attended} onClick={() => void run({ tool: "publication.phone.resume", sessionId: session.id, attended: true, run: true })}>Resume with agent</Button>}
      {session?.status === "active" && <Button variant="outline" disabled={busy} onClick={() => void run({ tool: "publication.phone.abort", sessionId: session.id, reason: "Stopped by the owner. Verify unfinished submissions before resuming." })}><Square />Stop session</Button>}
    </div>
    {session && <p role="status" className="text-sm">{session.step}</p>}
    {evidence && <a href={`/api/publishing/evidence/${session!.id}/${evidence}`} target="_blank" rel="noreferrer"><img src={`/api/publishing/evidence/${session!.id}/${evidence}`} alt="Latest iPhone verification screenshot" className="mx-auto max-h-96 rounded-lg border" /></a>}
    <details><summary className="cursor-pointer text-sm">Manual session controls and checklist</summary><div className="mt-4 space-y-3">
      <p className="text-sm">{PHONE_GUIDE.transfer}</p>
      {p.destinations.filter(d => hasPhone && session?.destinationIds.includes(d.id)).map(d => { const a = data.accounts.find(a => a.id === d.accountId); return <div key={d.id} className="space-y-2 rounded-lg bg-muted p-3"><p className="text-sm font-medium">{a?.name} · {d.payload?.scheduledAt ?? "Publish now"}</p><p className="text-xs">{a && PHONE_GUIDE[a.network]}</p><p className="whitespace-pre-wrap text-sm">{d.payload?.title}{"\n"}{d.payload?.caption}</p></div>; })}
      <Button variant="outline" disabled={busy || !attended || session?.status === "active"} onClick={() => void run({ tool: "publication.phone.start", id: p.id, attended: true, run: false })}>Start manual session</Button>
      {session?.status === "active" && <fieldset disabled={busy} className="space-y-3"><Button variant="outline" onClick={() => void command({ kind: "screen" }, "Inspect current phone screen")}><Camera />Capture screen</Button><div className="grid grid-cols-2 gap-3"><label className="text-sm">Horizontal position (0–1)<Input type="number" min="0" max="1" step="0.01" value={x} onChange={e => setX(e.target.value)} /></label><label className="text-sm">Vertical position (0–1)<Input type="number" min="0" max="1" step="0.01" value={y} onChange={e => setY(e.target.value)} /></label></div><div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => void command({ kind: "tap", x: Number(x), y: Number(y) }, "Owner tapped the verified target")}>Tap</Button><Button variant="outline" onClick={() => void command({ kind: "scroll", x: Number(x), y: Number(y), amount: -15 }, "Scroll form down")}>Scroll down</Button><Button variant="outline" onClick={() => void command({ kind: "scroll", x: Number(x), y: Number(y), amount: 15 }, "Scroll form up")}>Scroll up</Button><Button variant="outline" onClick={() => void command({ kind: "home" }, "Return to phone home")}>Home</Button></div><label className="block text-sm">Text to paste<Input value={text} onChange={e => setText(e.target.value)} /></label><Button variant="outline" onClick={() => void command({ kind: "paste", text }, "Paste once, then inspect the field")}>Paste once</Button><label className="block text-sm">Key<select className="min-h-10 w-full rounded-lg border bg-background px-3" value={key} onChange={e => setKey(e.target.value)}>{["return", "tab", "delete", "escape", "left", "right", "up", "down"].map(k => <option key={k}>{k}</option>)}</select></label><Button variant="outline" onClick={() => void command({ kind: "key", key }, "Send selected key")}>Send key</Button><p className="text-xs text-muted-foreground">After verifying the app, record the result on its destination above. Stop this session when finished.</p></fieldset>}
    </div></details>
  </section>;
}
