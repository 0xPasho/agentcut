"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api, type ProjectSummary } from "@/common/api/client";
import { Button } from "@/common/ui/button";
import { Menu, MenuTrigger, MenuContent, ContextMenuItem, ContextMenuSeparator } from "@/common/ui/context-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/common/ui/dialog";
import { Input } from "@/common/ui/input";
import { Label } from "@/common/ui/label";
import { ProjectName } from "../types";

/** One project menu in the list, overview and editor; extra actions belong to their surface. */
export function ProjectActions({ project, children, onRenamed, returnToProjects = false, fallbackFocus }: {
  project: Pick<ProjectSummary, "id" | "name">;
  children?: React.ReactNode;
  onRenamed?: (name: string) => void;
  returnToProjects?: boolean;
  fallbackFocus?: React.RefObject<HTMLElement | null>;
}) {
  const router = useRouter();
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const deleted = useRef(false);
  const [action, setAction] = useState<"rename" | "delete">("rename");
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(project.name);
  const [error, setError] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [pending, setPending] = useState(false);
  const removing = action === "delete";

  const choose = (next: "rename" | "delete") => {
    setAction(next);
    setName(project.name);
    setError(null);
    setInvalid(false);
    setOpen(true);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (pending) return;
    setError(null);
    if (!removing) {
      const parsed = ProjectName.safeParse(name);
      if (!parsed.success) {
        setError(parsed.error.issues[0].message);
        setInvalid(true);
        input.current?.focus();
        return;
      }
    }
    setInvalid(false);
    setPending(true);
    try {
      if (removing) {
        await api.deleteProject(project.id);
        deleted.current = true;
        toast.success("Project deleted");
        if (returnToProjects) router.replace("/");
      } else {
        const saved = await api.editorTool<Pick<ProjectSummary, "id" | "name">>(project.id, { tool: "project.rename", name });
        onRenamed?.(saved.name);
        toast.success("Project renamed");
      }
      setOpen(false);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to save changes. Try again.");
    } finally {
      setPending(false);
    }
  };

  return <>
    <Menu>
      <MenuTrigger render={
        <Button ref={trigger} variant="ghost" size="icon" className="size-10 shrink-0 text-muted-foreground" aria-label={`Actions for ${project.name}`} title="Project actions">
          <MoreHorizontal aria-hidden className="size-4" />
        </Button>
      } />
      <MenuContent align="end" className="w-64 max-w-[calc(100vw-2rem)] max-h-(--available-height) overflow-y-auto overscroll-contain" finalFocus={() => open ? false : trigger.current}>
        <ContextMenuItem className="min-h-10" onClick={() => choose("rename")}>
          <Pencil aria-hidden strokeWidth={1.5} className="size-4" />Rename project
        </ContextMenuItem>
        {children && <><ContextMenuSeparator />{children}</>}
        <ContextMenuSeparator />
        <ContextMenuItem className="min-h-10 text-destructive data-highlighted:bg-destructive/10 data-highlighted:text-destructive" onClick={() => choose("delete")}>
          <Trash2 aria-hidden strokeWidth={1.5} className="size-4" />Delete project
        </ContextMenuItem>
      </MenuContent>
    </Menu>
    <Dialog open={open} onOpenChange={next => { if (!pending) setOpen(next); }}>
      <DialogContent showCloseButton={!pending} initialFocus={removing ? cancel : input}
        finalFocus={() => !deleted.current && trigger.current?.isConnected ? trigger.current : fallbackFocus?.current ?? false}>
        <form onSubmit={submit} noValidate className="flex flex-col gap-5" aria-busy={pending}>
          <DialogHeader>
            <DialogTitle>{removing ? "Delete project?" : "Rename project"}</DialogTitle>
            <DialogDescription className="break-words">
              {removing ? `“${project.name}” will be removed from your workspace. This cannot be undone.` : "Choose a name for this project."}
            </DialogDescription>
          </DialogHeader>
          {!removing && <div className="space-y-2">
            <Label htmlFor={`${id}-name`}>Project name</Label>
            <Input ref={input} id={`${id}-name`} name="projectName" autoComplete="off" required value={name} disabled={pending}
              aria-invalid={invalid || undefined} aria-describedby={invalid ? `${id}-error` : undefined}
              onFocus={event => event.target.select()}
              onChange={event => { setName(event.target.value); if (invalid) { setInvalid(false); setError(null); } }} />
            {invalid && <p id={`${id}-error`} className="text-sm text-destructive">{error}</p>}
          </div>}
          {error && !invalid && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button ref={cancel} type="button" variant="outline" disabled={pending} onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" variant={removing ? "destructive" : "default"} disabled={pending}>
              {pending && <Loader2 aria-hidden className="size-4 motion-safe:animate-spin" />}
              {removing ? "Delete project" : "Save name"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  </>;
}
