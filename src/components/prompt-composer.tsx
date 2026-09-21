"use client";
import { forwardRef, useImperativeHandle, useRef, useState, type ReactNode } from "react";
import { Loader2, Paperclip, SendHorizontal, X } from "lucide-react";
import { cn } from "cn";
import { assetFileUrl, type Attachment } from "@/lib/client";
import { AgentPicker } from "./agent-picker";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";

/**
 * Every place the app asks the user to write a prompt.
 *
 * The harness picker is part of this component rather than something each
 * surface remembers to add, which is the whole point: a new prompt surface gets
 * the choice for free, and there is no second place where a prompt can be sent
 * to whichever CLI happened to be first on PATH.
 *
 * The composer does not know what the prompt means. It hands `onSend` the text
 * and gets out of the way — which harness runs it is already saved server-side,
 * so the caller does not have to thread the selection through either.
 */
export type PromptComposerHandle = { focus: () => void };

export const PromptComposer = forwardRef<PromptComposerHandle, {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void | Promise<void>;
  /** Scope for the picker. Omit on surfaces with no project (welcome, onboarding). */
  projectId?: string;
  label?: string;
  placeholder?: string;
  busy?: boolean;
  /** Label for the send button while `busy`. */
  busyLabel?: string;
  sendLabel?: string;
  /** A run is live: the harness is argv-frozen until it ends. */
  locked?: boolean;
  lockedReason?: string;
  /** Quick actions, template chips — anything that fills the box. */
  actions?: ReactNode;
  /** Status lines, errors, job progress: rendered under the controls. */
  footer?: ReactNode;
  /**
   * Files already uploaded and riding along with the next message. Dropping,
   * pasting and picking all go through `onFiles`; the caller decides what an
   * attachment becomes, because that differs between a project and a new chat.
   */
  attachments?: Attachment[];
  onFiles?: (files: File[]) => void;
  onRemoveAttachment?: (id: string) => void;
  attaching?: boolean;
  accept?: string;
  required?: boolean;
  className?: string;
}>(function PromptComposer({
  value,
  onChange,
  onSend,
  projectId,
  label,
  placeholder,
  busy = false,
  busyLabel = "Working…",
  sendLabel = "Send",
  locked,
  lockedReason,
  actions,
  footer,
  attachments = [],
  onFiles,
  onRemoveAttachment,
  attaching = false,
  accept = "image/*,audio/*,video/*",
  required = true,
  className,
}, ref) {
  const input = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  useImperativeHandle(ref, () => ({ focus: () => input.current?.focus() }), []);

  const take = (files: FileList | File[] | null | undefined) => {
    const chosen = Array.from(files ?? []);
    if (chosen.length) onFiles?.(chosen);
  };

  const box = (
    <Textarea
      ref={input}
      required={required && !attachments.length}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      // A screenshot in the clipboard is the fastest way to show the agent
      // something; it should not need a trip through the file system.
      onPaste={(e) => { const files = Array.from(e.clipboardData.files); if (files.length) { e.preventDefault(); take(files); } }}
      onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void onSend(); } }}
    />
  );

  return (
    <form
      className={cn("space-y-2", className)}
      onSubmit={(e) => { e.preventDefault(); void onSend(); }}
    >
      {/* The whole composer is the drop target, and it says so while something is
          over it: aiming at a small zone is a needless thing to ask of anyone. */}
      <div
        onDragOver={(e) => { if (!onFiles) return; e.preventDefault(); setDragging(true); }}
        onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false); }}
        onDrop={(e) => { if (!onFiles) return; e.preventDefault(); setDragging(false); take(e.dataTransfer.files); }}
        className={cn("relative rounded-xl transition-[box-shadow] duration-150 motion-reduce:transition-none", dragging && "shadow-[0_0_0_3px_var(--glass-specular)]")}
      >
        {label ? <label className="flex flex-col gap-2 text-sm font-medium">{label}{box}</label> : box}
        {dragging ? (
          <p className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-xl border-2 border-dashed border-primary/70 bg-background/80 text-sm font-medium">
            Drop to attach
          </p>
        ) : null}
      </div>

      {attachments.length || attaching ? (
        <ul className="flex flex-wrap gap-1.5" aria-label="Attachments">
          {attachments.map((a) => (
            <li key={a.id} className="flex items-center gap-1.5 rounded-lg border border-border bg-card/60 py-1 pr-1 pl-1.5 text-xs">
              {a.kind === "image" ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={assetFileUrl(a.id)} alt="" className="size-6 rounded object-cover" />
              ) : (
                <span className="rounded bg-muted px-1 text-[10px] text-muted-foreground uppercase">{a.kind}</span>
              )}
              <span className="max-w-32 truncate">{a.name}</span>
              {onRemoveAttachment ? (
                <Button type="button" size="icon-sm" variant="ghost" aria-label={`Remove ${a.name}`} onClick={() => onRemoveAttachment(a.id)}><X /></Button>
              ) : null}
            </li>
          ))}
          {attaching ? <li className="flex items-center gap-1.5 px-1.5 py-1 text-xs text-muted-foreground"><Loader2 className="size-3 motion-safe:animate-spin" />Uploading…</li> : null}
        </ul>
      ) : null}

      {actions ? <div className="flex flex-wrap gap-1.5">{actions}</div> : null}

      <div className="flex flex-wrap items-center gap-2">
        {onFiles ? <>
          <Button type="button" size="icon" variant="ghost" aria-label="Attach a file" title="Attach an image, sound or video" onClick={() => picker.current?.click()}><Paperclip /></Button>
          <input ref={picker} type="file" accept={accept} multiple className="hidden" onChange={(e) => { take(e.target.files); e.target.value = ""; }} />
        </> : null}
        <Button variant="outline" type="submit" disabled={busy}>
          {busy ? <Loader2 className="motion-safe:animate-spin" /> : <SendHorizontal />}
          {busy ? busyLabel : sendLabel}
        </Button>
        <span className="text-xs text-muted-foreground">⌘↩ to send</span>
        <AgentPicker
          projectId={projectId}
          locked={locked ?? busy}
          {...(lockedReason ? { lockedReason } : {})}
          className="ml-auto"
        />
      </div>

      {footer}
    </form>
  );
});
