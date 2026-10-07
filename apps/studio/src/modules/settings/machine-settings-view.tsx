"use client";
import { useEffect, useId, useState } from "react";
import { Captions, HardDrive, KeyRound, Loader2, MessageSquareText } from "lucide-react";
import { api } from "@agentcut/core/common/api/client";
import type { ProviderKeyInfo } from "@agentcut/core/common/server/secrets";
import { Button } from "@/common/ui/button";
import { Input } from "@/common/ui/input";
import { Label } from "@/common/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/common/ui/select";
import { ErrorLine, Loading, Panel, PanelHeading, SectionHeader } from "./components/section-header";
import { useWorkspaceSettings } from "./hooks";
import { TRANSCRIBE_LABELS } from "@agentcut/core/modules/settings/data";
import type { MachineSettings as Machine } from "@agentcut/core/modules/settings/types";
import { WorkspaceTransfer } from "./components/workspace-transfer";

/**
 * This machine (decision 135): what is true of the computer rather than of the
 * person. Where the workspace is, what runs when footage lands, where the stream
 * chat is read from, and the keys the picture search may use. Each control calls the
 * function an agent's tool calls — `media.transcription.set`, `chat.setSource`,
 * `providerkeys.set` — with the level fixed at workspace.
 */
export function MachineSettings() {
  const { data, error, pending, run } = useWorkspaceSettings();

  return (
    <section className="flex flex-col gap-5">
      <SectionHeader title="This machine">
        Where your work is kept and what runs on it. Nothing here leaves this computer.
      </SectionHeader>

      {!data ? <Loading label="Loading this machine" /> : (
        <>
          <Panel className="flex flex-col gap-3">
            <PanelHeading title="Where the workspace is" icon={<HardDrive className="size-4" />}>
              Projects, the library, your preferences and installed packs are kept here. Media linked from other folders needs its own copy.
            </PanelHeading>
            <dl className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-[auto_minmax(0,1fr)]">
              <dt className="text-muted-foreground">Workspace</dt>
              <dd className="break-all font-mono">{data.machine.workspace}</dd>
              <dt className="text-muted-foreground">Database</dt>
              <dd className="break-all font-mono">{data.machine.database}</dd>
            </dl>
            <p className="text-xs text-muted-foreground">Set <code className="font-mono">AGENTCUT_WORKSPACE</code> before starting agentcut to use another folder.</p>
          </Panel>

          <WorkspaceTransfer />

          <TranscribeOnImport machine={data.machine} pending={pending === "transcribe"} onChange={(mode) => run("transcribe", () => api.workspace({ action: "transcription.set", mode }))} />

          <ChatSource machine={data.machine} pending={pending === "chat"} onSave={(path) => run("chat", () => api.workspace({ action: "chat.source.set", path }))} />

          <Panel className="flex flex-col gap-4">
            <PanelHeading title="Keys for picture search" icon={<KeyRound className="size-4" />}>
              Optional. Wikimedia Commons, Openverse and the brand marks need no key and are always on;
              these add stock photography. A key is kept on this machine, never shown again and never
              handed to an agent.
            </PanelHeading>
            <ul className="flex flex-col gap-4">
              {data.providerKeys.map((key) => (
                <li key={key.id}>
                  <ProviderKeyField
                    info={key}
                    pending={pending === `key:${key.id}`}
                    onSave={(value) => run(`key:${key.id}`, () => api.workspace({ action: "providerkeys.set", id: key.id, value }))}
                  />
                </li>
              ))}
            </ul>
          </Panel>
        </>
      )}
      <ErrorLine>{error}</ErrorLine>
    </section>
  );
}

function TranscribeOnImport({ machine, pending, onChange }: { machine: Machine; pending: boolean; onChange: (mode: string | null) => void }) {
  const id = useId();
  const { transcribe } = machine;
  const fromEnv = transcribe.scope === "env";
  const value = transcribe.stored ?? "";
  return (
    <Panel className="flex flex-col gap-3">
      <PanelHeading title="Transcription on import" icon={<Captions className="size-4" />}>
        Whether footage is transcribed as soon as it lands. A project can choose differently in its editor.
      </PanelHeading>
      <div className="grid gap-2 sm:grid-cols-[minmax(0,20rem)_minmax(0,1fr)] sm:items-center sm:gap-4">
        <Select value={value} onValueChange={(v) => onChange(v ? String(v) : null)} disabled={fromEnv || pending}>
          <SelectTrigger aria-label="Transcription on import" aria-describedby={`${id}-help`} className="w-full">
            <SelectValue>{(v: unknown) => (v ? TRANSCRIBE_LABELS[String(v)]?.label : `Default — ${TRANSCRIBE_LABELS.audio.label.toLowerCase()}`)}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">Default — {TRANSCRIBE_LABELS.audio.label.toLowerCase()}</SelectItem>
            {Object.entries(TRANSCRIBE_LABELS).map(([mode, { label }]) => <SelectItem key={mode} value={mode}>{label}</SelectItem>)}
          </SelectContent>
        </Select>
        <p id={`${id}-help`} className="text-xs text-muted-foreground">
          {fromEnv
            ? "Answering from AGENTCUT_TRANSCRIBE_ON_IMPORT in this machine's environment; the variable wins over this choice."
            : TRANSCRIBE_LABELS[transcribe.mode]?.help}
        </p>
      </div>
    </Panel>
  );
}

function ChatSource({ machine, pending, onSave }: { machine: Machine; pending: boolean; onSave: (path: string) => void }) {
  const id = useId();
  const { chat } = machine;
  const [draft, setDraft] = useState(chat.configured);
  useEffect(() => { setDraft(chat.configured); }, [chat.configured]);
  const where: Record<string, string> = {
    setting: "Reading the database you chose.",
    env: "Reading the database named by CHAT_DB_PATH in this machine's environment; a path saved here takes over.",
    default: "Reading the chat recorder's default database, found on this machine.",
    none: "No chat database found. Stream clips still cut; they just cannot open on the comment they answer.",
  };
  return (
    <Panel as="form" className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); onSave(draft); }}>
      <PanelHeading title="Stream chat" icon={<MessageSquareText className="size-4" />}>
        The database a chat recorder writes during a stream, so a clip opens on the comment it answers.
      </PanelHeading>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${id}-chat`}>Chat database</Label>
        <div className="flex flex-wrap items-center gap-2">
          <Input id={`${id}-chat`} value={draft} spellCheck={false} className="min-w-0 flex-1 font-mono text-xs" placeholder={chat.from === "setting" ? "" : (chat.path ?? "~/Library/Application Support/restream-tiktok-chat/chat.db")} aria-describedby={`${id}-chat-help`} onChange={(e) => setDraft(e.target.value)} />
          <Button type="submit" size="sm" variant="outline" disabled={pending || draft === chat.configured}>{pending && <Loader2 aria-hidden className="motion-safe:animate-spin" />}Save</Button>
          {chat.from === "setting" && <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => { setDraft(""); onSave(""); }}>Clear</Button>}
        </div>
        <p id={`${id}-chat-help`} className="text-xs text-muted-foreground">
          {where[chat.from]}{chat.path && chat.from !== "setting" ? <> <span className="break-all font-mono">{chat.path}</span></> : null}
        </p>
      </div>
    </Panel>
  );
}

/**
 * A key you can set and clear but never read. There is no reveal and no masked
 * tail: a secret that cannot be shown cannot be shoulder-surfed, screen-shared or
 * pasted into a bug report, and the only thing anybody needs from this field is
 * whether it is set.
 */
function ProviderKeyField({ info, pending, onSave }: { info: ProviderKeyInfo; pending: boolean; onSave: (value: string) => void }) {
  const id = useId();
  const [draft, setDraft] = useState(info.secret ? "" : (info.value ?? ""));
  const fromEnvironment = info.source === "environment";

  return (
    <form
      className="flex flex-col gap-1.5"
      onSubmit={(e) => { e.preventDefault(); onSave(draft); if (info.secret) setDraft(""); }}
    >
      <Label htmlFor={id}>{info.label}</Label>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          id={id}
          type={info.secret ? "password" : "text"}
          autoComplete="off"
          spellCheck={false}
          className="min-w-0 flex-1 font-mono"
          placeholder={info.secret ? (info.set ? "Set — type a new one to replace it" : "Paste the key") : "Paste the id"}
          value={draft}
          aria-describedby={`${id}-help`}
          onChange={(e) => setDraft(e.target.value)}
        />
        <Button type="submit" size="sm" variant="outline" disabled={pending || !draft.trim()}>
          {pending && <Loader2 aria-hidden className="motion-safe:animate-spin" />}Save
        </Button>
        {info.source === "workspace" && (
          <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => { setDraft(""); onSave(""); }}>Clear</Button>
        )}
      </div>
      <p id={`${id}-help`} className="text-xs text-muted-foreground">
        {info.what}{" "}
        {fromEnvironment && `Answering right now from ${info.env} in this machine's environment; saving one here takes over.`}
        {!fromEnvironment && info.set && "Saved on this machine."}
        {!fromEnvironment && !info.set && <>Get one at{" "}
          {/* A new tab, so a key half-typed in the field above survives the trip. */}
          <a href={info.from} target="_blank" rel="noreferrer" className="break-all underline underline-offset-2">{info.from}</a></>}
      </p>
    </form>
  );
}
