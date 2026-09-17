"use client";
import { useState } from "react";
import { api } from "@/lib/client";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";
export function AgentEditor({ projectId, beforeRun }: { projectId: string; beforeRun: () => Promise<boolean> }) {
  const [instruction, setInstruction] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  return <form className="space-y-3" onSubmit={async e => {
    e.preventDefault(); setPending(true); setMessage("");
    try {
      if (!(await beforeRun())) return;
      const current = await api.getProject(projectId);
      await api.agentEdit(projectId, instruction, current.revision);
      setMessage("The agent is editing this project. Saved changes appear here automatically.");
    } catch (error) { setMessage((error as Error).message); }
    finally { setPending(false); }
  }}>
    <label className="flex flex-col gap-2 text-sm font-medium">Ask the agent to edit
      <Textarea required value={instruction} onChange={e => setInstruction(e.target.value)} placeholder="Move the title to the bottom and lower the music volume." />
    </label>
    <Button variant="outline" type="submit" disabled={pending}>{pending ? "Starting…" : "Edit with agent"}</Button>
    <p role="status" className="text-xs text-muted-foreground">{message}</p>
  </form>;
}
