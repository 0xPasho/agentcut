"use client";
import Link from "next/link";
import { useState } from "react";
import {
  ArrowUpRight,
  Cable,
  CalendarClock,
  Check,
  Plus,
  Settings2,
  Smartphone,
  Sparkles,
} from "lucide-react";
import { Button } from "../../common/ui/button";
import { Input } from "../../common/ui/input";
import { Checkbox } from "../../common/ui/checkbox";
import { Disclosure } from "../../common/ui/disclosure";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../../common/ui/tabs";
import {
  SectionHeader,
  Panel,
  PanelHeading,
} from "../settings/components/section-header";
import { PublishingSelect } from "./components/publishing-select";
import type {
  Connection,
  ImportPreview,
  Network,
  PublishingOverview,
  PublishingRun,
  PublishingSettings,
} from "./types";
import { usePublishing } from "./hooks";
import { NETWORK_LABELS, PROVIDER_URLS } from "./data";

export function ConnectionsView({ initial }: { initial: PublishingOverview }) {
  const {
    data = initial,
    error,
    busy,
    run,
  } = usePublishing(undefined, initial);
  const [provider, setProvider] = useState<Connection["provider"]>("iphone");
  const [name, setName] = useState("iPhone");
  const [notice, setNotice] = useState("");
  const [adding, setAdding] = useState(false);
  return (
    <section className="space-y-6">
      <SectionHeader
        title="Publishing"
        action={
          <Button
            size="sm"
            variant="outline"
            nativeButton={false}
            render={<Link href="/calendar" />}
          >
            Open calendar
            <ArrowUpRight aria-hidden className="size-3.5" />
          </Button>
        }
      >
        Your accounts, your schedule. Ready for the next release.
      </SectionHeader>
      {error && (
        <p
          role="alert"
          className="whitespace-pre-wrap text-sm text-destructive"
        >
          {error}
        </p>
      )}
      <p role="status" className="empty:hidden text-sm text-muted-foreground">
        {notice}
      </p>
      <Tabs defaultValue="accounts" className="gap-6">
        <TabsList aria-label="Publishing settings" className="max-w-full">
          <TabsTrigger
            value="accounts"
            className="px-2 text-xs sm:px-3 sm:text-sm"
          >
            <Cable className="size-4" aria-hidden />
            Accounts
          </TabsTrigger>
          <TabsTrigger
            value="schedule"
            className="px-2 text-xs sm:px-3 sm:text-sm"
          >
            <CalendarClock className="size-4" aria-hidden />
            Schedule
          </TabsTrigger>
          <TabsTrigger
            value="advanced"
            className="px-2 text-xs sm:px-3 sm:text-sm"
          >
            <Settings2 className="size-4" aria-hidden />
            Advanced
          </TabsTrigger>
        </TabsList>
        <TabsContent value="accounts" className="space-y-6">
          <Panel className="relative overflow-hidden p-5 sm:p-6">
            <div className="flex items-start gap-4">
              <div className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-foreground/5 ring-1 ring-foreground/10">
                <Smartphone
                  className="size-7 text-primary"
                  strokeWidth={1.5}
                  aria-hidden
                />
              </div>
              <div className="min-w-0">
                <p className="mb-1 text-xs text-muted-foreground">
                  Publish from this Mac
                </p>
                <h3 className="text-lg font-medium tracking-tight">
                  iPhone Mirroring
                </h3>
                <p className="mt-2 max-w-prose text-sm leading-relaxed text-muted-foreground">
                  Use the accounts already on your phone. Keep your iPhone
                  nearby and open Mirroring when you’re ready to publish.
                </p>
              </div>
            </div>
            <div className="mt-5 flex flex-wrap gap-2">
              <Button
                disabled={busy}
                onClick={async () => {
                  const result = await run<{ message: string }>({
                    tool: "publishing.phone.readiness",
                  });
                  if (result) setNotice(result.message);
                }}
              >
                <Smartphone className="size-4" aria-hidden />
                Check phone connection
              </Button>
              <Button
                variant="outline"
                disabled={busy}
                onClick={async () => {
                  const result = await run({ tool: "publishing.phone.build" });
                  if (result)
                    setNotice(
                      "iPhone publishing is installed. Check your phone connection next.",
                    );
                }}
              >
                Set up iPhone publishing
              </Button>
            </div>
            <Disclosure
              variant="plain"
              className="mt-4"
              summary="First-time setup and permissions"
            >
              <p className="max-w-prose text-xs leading-relaxed text-muted-foreground">
                Allow Accessibility and Screen Recording for the application
                running Agentcut in macOS System Settings. Restart that
                application after granting Screen Recording, then open Mirroring
                with your locked iPhone nearby.
              </p>
            </Disclosure>
          </Panel>
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-medium">Publishing connections</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                iPhone Mirroring, Postgun or Postbridge.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setAdding(!adding)}
            >
              <Plus className="size-4" aria-hidden />
              Add connection
            </Button>
          </div>
          {adding && (
            <Panel>
              <fieldset disabled={busy} className="space-y-4">
                <legend className="mb-3 text-sm font-medium">
                  New connection
                </legend>
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="block space-y-1.5 text-sm">
                    Publish through
                    <PublishingSelect
                      value={provider}
                      onValueChange={(value) => {
                        setProvider(value as Connection["provider"]);
                        setName(
                          {
                            iphone: "iPhone Mirroring",
                            postgun: "Postgun",
                            postbridge: "Postbridge",
                          }[value as Connection["provider"]],
                        );
                      }}
                    >
                      <option value="iphone">iPhone Mirroring</option>
                      <option value="postgun">Postgun</option>
                      <option value="postbridge">Postbridge</option>
                    </PublishingSelect>
                  </label>
                  <label className="block space-y-1.5 text-sm">
                    Connection name
                    <Input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                    />
                  </label>
                </div>
                <div className="flex gap-2">
                  <Button
                    onClick={async () => {
                      const result = await run({
                        tool: "publishing.connection.save",
                        provider,
                        name,
                        baseUrl: PROVIDER_URLS[provider],
                      });
                      if (result) setAdding(false);
                    }}
                  >
                    Add connection
                  </Button>
                  <Button variant="ghost" onClick={() => setAdding(false)}>
                    Cancel
                  </Button>
                </div>
              </fieldset>
            </Panel>
          )}
          {!data.connections.length && !adding && (
            <Panel className="py-8">
              <Cable
                className="mb-3 size-6 text-muted-foreground"
                aria-hidden
              />
              <h3 className="text-sm font-medium">
                Where will your videos go?
              </h3>
              <p className="mt-1 mb-4 max-w-prose text-sm text-muted-foreground">
                Add a connection, then choose the accounts you want to publish
                to.
              </p>
              <Button variant="outline" onClick={() => setAdding(true)}>
                <Plus className="size-4" aria-hidden />
                Add your first connection
              </Button>
            </Panel>
          )}
          <div className="space-y-4">
            {data.connections.map((c) => (
              <ConnectionForm
                key={c.id}
                connection={c}
                data={data}
                run={run}
                busy={busy}
              />
            ))}
          </div>
        </TabsContent>
        <TabsContent value="schedule">
          <ScheduleSettings
            key={data.settings.revision}
            initial={data.settings}
            data={data}
            run={run}
            busy={busy}
          />
        </TabsContent>
        <TabsContent value="advanced" className="space-y-4">
          <Panel>
            <PanelHeading
              title="Local publishing"
              icon={<Settings2 className="size-4" />}
            >
              Manage screenshots and an existing iPhone tool.
            </PanelHeading>
            <AdvancedSettings
              key={data.settings.revision}
              initial={data.settings}
              run={run}
              busy={busy}
            />
          </Panel>
          <ImportForm run={run} busy={busy} />
        </TabsContent>
      </Tabs>
    </section>
  );
}
function ConnectionForm({
  connection: c,
  data,
  run,
  busy,
}: {
  connection: Connection;
  data: PublishingOverview;
  run: PublishingRun;
  busy: boolean;
}) {
  const [key, setKey] = useState(""),
    [url, setUrl] = useState(c.baseUrl),
    [network, setNetwork] = useState<Network>("instagram"),
    [name, setName] = useState(""),
    [handle, setHandle] = useState(""),
    [link, setLink] = useState("");
  return (
    <Panel className="space-y-4">
      <div className="flex items-center gap-3">
        <span className="flex size-10 items-center justify-center rounded-xl bg-foreground/5">
          {c.provider === "iphone" ? (
            <Smartphone className="size-5" aria-hidden />
          ) : (
            <Cable className="size-5" aria-hidden />
          )}
        </span>
        <h3 className="text-sm font-medium">{c.name}</h3>
      </div>
      <p className="text-xs text-muted-foreground">
        {c.configured ? "Configured" : "Needs setup"}
        {c.checkedAt
          ? ` · checked ${new Date(c.checkedAt).toLocaleString()}`
          : " · not checked yet"}
      </p>
      {c.error && <p className="text-sm text-destructive">{c.error}</p>}
      {c.provider !== "iphone" && (
        <Disclosure summary="Connection settings" open={!c.configured}>
          <fieldset disabled={busy} className="space-y-3">
            <label className="block text-sm">
              API URL
              <Input value={url} onChange={(e) => setUrl(e.target.value)} />
            </label>
            <label className="block text-sm">
              API key
              <Input
                type="password"
                autoComplete="new-password"
                value={key}
                onChange={(e) => setKey(e.target.value)}
              />
            </label>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                onClick={async () => {
                  const result = await run({
                    tool: "publishing.connection.save",
                    id: c.id,
                    provider: c.provider,
                    name: c.name,
                    baseUrl: url,
                    ...(key ? { key } : {}),
                  });
                  if (result) setKey("");
                }}
              >
                Save connection
              </Button>
              <Button
                variant="outline"
                onClick={() =>
                  void run({
                    tool: "publishing.accounts.sync",
                    connectionId: c.id,
                  })
                }
              >
                Check and refresh accounts
              </Button>
              <Button
                variant="outline"
                onClick={() =>
                  void run({
                    tool: "publishing.calendar.sync",
                    connectionId: c.id,
                  })
                }
              >
                Refresh provider calendar
              </Button>
            </div>
          </fieldset>
        </Disclosure>
      )}
      {c.provider === "postbridge" && (
        <div className="flex flex-wrap gap-2">
          {(["instagram", "tiktok"] as const).map((network) => (
            <Button
              key={network}
              variant="outline"
              disabled={busy || !c.configured}
              onClick={async () => {
                const result = await run<{
                  url: string;
                }>({
                  tool: "publishing.connection.link",
                  connectionId: c.id,
                  network,
                  returnUrl: `${window.location.origin}/settings/publishing`,
                });
                if (result) setLink(result.url);
              }}
            >
              Connect {network}
            </Button>
          ))}
          {link && (
            <a
              href={link}
              target="_blank"
              rel="noreferrer"
              className="self-center text-sm underline"
            >
              Open provider consent page
            </a>
          )}
          <p className="text-xs text-muted-foreground">
            Connect YouTube in Postbridge directly. After consent, refresh
            accounts here.
          </p>
        </div>
      )}
      <ul className="space-y-2">
        {data.accounts
          .filter((a) => a.connectionId === c.id)
          .map((a) => (
            <li
              key={a.id}
              className="rounded-2xl bg-foreground/[0.035] p-3 text-sm"
            >
              {a.name} · {NETWORK_LABELS[a.network]}
              {a.needsReconnect && " · reconnect in provider"}
              {a.disabled && " · unavailable"}
              <Disclosure
                variant="plain"
                summary="Link another publishing route"
              >
                <label className="mt-1 block space-y-2 text-xs">
                  Same account through another route
                  <PublishingSelect
                    value={a.equivalentTo ?? ""}
                    disabled={busy}
                    onValueChange={(e) =>
                      void run({
                        tool: "publishing.account.link",
                        accountId: a.id,
                        equivalentTo: e || null,
                      })
                    }
                    className="w-full min-w-0"
                  >
                    <option value="">Independent account</option>
                    {data.accounts
                      .filter(
                        (other) =>
                          other.id !== a.id &&
                          other.network === a.network &&
                          !other.equivalentTo,
                      )
                      .map((other) => (
                        <option key={other.id} value={other.id}>
                          {other.name} ·{" "}
                          {
                            data.connections.find(
                              (c) => c.id === other.connectionId,
                            )?.name
                          }
                        </option>
                      ))}
                  </PublishingSelect>
                </label>
              </Disclosure>
            </li>
          ))}
      </ul>
      {c.provider === "iphone" && (
        <Disclosure summary="Add an account from your iPhone">
          <fieldset disabled={busy} className="space-y-3">
            <legend className="mb-2 text-sm font-medium">
              Account already signed in on the phone
            </legend>
            <label className="block text-sm">
              Network
              <PublishingSelect
                value={network}
                onValueChange={(e) => setNetwork(e as Network)}
                className="w-full min-w-0"
              >
                <option value="instagram">Instagram</option>
                <option value="tiktok">TikTok</option>
                <option value="youtube">YouTube</option>
              </PublishingSelect>
            </label>
            <label className="block text-sm">
              Account name
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label className="block text-sm">
              Exact account handle or channel ID
              <Input
                value={handle}
                onChange={(e) => setHandle(e.target.value)}
              />
            </label>
            <Button
              variant="outline"
              onClick={() =>
                void run({
                  tool: "publishing.account.phone",
                  connectionId: c.id,
                  network,
                  name,
                  remoteId: `${network}:${handle}`,
                })
              }
            >
              Add phone account
            </Button>
          </fieldset>
        </Disclosure>
      )}
    </Panel>
  );
}
function ImportForm({ run, busy }: { run: PublishingRun; busy: boolean }) {
  const [file, setFile] = useState(""),
    [map, setMap] = useState("{}"),
    [sourceMap, setSourceMap] = useState("{}"),
    [importId, setImportId] = useState(""),
    [preview, setPreview] = useState<ImportPreview | null>(null),
    [error, setError] = useState("");
  return (
    <Disclosure summary={<>Import existing Cadence publications</>}>
      <div className="mt-4 space-y-3">
        <p className="text-sm text-muted-foreground">
          One-time import from a Cadence database or exported posts JSON. It
          does not send anything. Stop Cadence dispatch for imported work at
          cutover.
        </p>
        <label className="block text-sm">
          Local database or JSON file
          <Input
            value={file}
            onChange={(e) => {
              setFile(e.target.value);
              setPreview(null);
            }}
          />
        </label>
        <label className="block text-sm">
          Account mapping (Cadence ID → Agentcut ID, JSON)
          <textarea
            className="w-full rounded-lg border bg-background p-3 font-mono text-xs"
            value={map}
            onChange={(e) => {
              setMap(e.target.value);
              setPreview(null);
            }}
          />
        </label>
        <label className="block text-sm">
          Video mapping (Cadence post ID → projectId and sequenceId, JSON)
          <textarea
            className="w-full rounded-lg border bg-background p-3 font-mono text-xs"
            value={sourceMap}
            onChange={(e) => {
              setSourceMap(e.target.value);
              setPreview(null);
            }}
          />
        </label>
        <Button
          variant="outline"
          disabled={busy}
          onClick={async () => {
            try {
              const result = await run<ImportPreview>({
                tool: "publication.import.preview",
                file,
                accountMap: JSON.parse(map),
                sourceMap: JSON.parse(sourceMap),
              });
              if (result) setPreview(result);
            } catch {
              setError("Enter a valid JSON account mapping.");
            }
          }}
        >
          Preview import
        </Button>
        {preview && (
          <>
            <p className="text-sm">
              {preview.entries.length} ready · {preview.existing} already
              imported
            </p>
            <ul className="space-y-1 text-xs text-muted-foreground">
              {preview.issues.map((issue, i) => (
                <li key={i}>{issue.message}</li>
              ))}
            </ul>
            <Button
              disabled={busy}
              onClick={async () => {
                try {
                  const accountMap = JSON.parse(map);
                  const result = await run<{
                    importId: string;
                  }>({
                    tool: "publication.import.apply",
                    file,
                    accountMap,
                    sourceMap: JSON.parse(sourceMap),
                  });
                  if (result) {
                    setPreview(null);
                    setImportId(result.importId);
                  }
                } catch {
                  setError("Enter a valid JSON account mapping.");
                }
              }}
            >
              Import local records
            </Button>
          </>
        )}
        {importId && (
          <Button
            variant="outline"
            disabled={busy}
            onClick={async () => {
              const result = await run({
                tool: "publication.import.rollback",
                importId,
              });
              if (result) setImportId("");
            }}
          >
            Undo untouched local import
          </Button>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </div>
    </Disclosure>
  );
}

function ScheduleSettings({
  initial,
  data,
  run,
  busy,
}: {
  initial: PublishingSettings;
  data: PublishingOverview;
  run: PublishingRun;
  busy: boolean;
}) {
  const [draft, setDraft] = useState(initial);
  const [saved, setSaved] = useState(false);
  return (
    <fieldset disabled={busy} className="space-y-5">
      <Panel className="space-y-5">
        <PanelHeading
          title="Your publishing rhythm"
          icon={<CalendarClock className="size-4" aria-hidden />}
        >
          Set your preferred times. Available slots are suggested around this
          schedule.
        </PanelHeading>
        <label className="block space-y-1.5 text-sm">
          Timezone
          <Input
            value={draft.timezone}
            onChange={(e) => setDraft({ ...draft, timezone: e.target.value })}
          />
        </label>
        <div className="space-y-3">
          <p className="text-sm font-medium">Weekly times</p>
          {!draft.slots.length && (
            <p className="text-xs text-muted-foreground">
              Add a time to start reserving slots automatically.
            </p>
          )}
          {draft.slots.map((slot, index) => (
            <div key={index} className="flex flex-wrap items-end gap-3">
              <label className="min-w-32 flex-1 space-y-1.5 text-xs text-muted-foreground">
                Day
                <PublishingSelect
                  value={slot.weekday}
                  onValueChange={(value) =>
                    setDraft({
                      ...draft,
                      slots: draft.slots.map((s, i) =>
                        i === index ? { ...s, weekday: Number(value) } : s,
                      ),
                    })
                  }
                >
                  {[
                    "Sunday",
                    "Monday",
                    "Tuesday",
                    "Wednesday",
                    "Thursday",
                    "Friday",
                    "Saturday",
                  ].map((day, n) => (
                    <option value={n} key={day}>
                      {day}
                    </option>
                  ))}
                </PublishingSelect>
              </label>
              <label className="space-y-1.5 text-xs text-muted-foreground">
                Time
                <Input
                  type="time"
                  value={slot.time}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      slots: draft.slots.map((s, i) =>
                        i === index ? { ...s, time: e.target.value } : s,
                      ),
                    })
                  }
                />
              </label>
              <Button
                variant="ghost"
                aria-label={`Remove weekly time ${index + 1}`}
                onClick={() =>
                  setDraft({
                    ...draft,
                    slots: draft.slots.filter((_, i) => i !== index),
                  })
                }
              >
                Remove
              </Button>
            </div>
          ))}
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              setDraft({
                ...draft,
                slots: [...draft.slots, { weekday: 1, time: "18:00" }],
              })
            }
          >
            <Plus className="size-4" aria-hidden />
            Add weekly time
          </Button>
        </div>
        <Disclosure variant="plain" summary="Spacing and preparation time">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-1.5 text-sm">
              Between posts (minutes)
              <Input
                type="number"
                min="1"
                value={draft.minGapMinutes}
                onChange={(e) =>
                  setDraft({ ...draft, minGapMinutes: Number(e.target.value) })
                }
              />
            </label>
            <label className="space-y-1.5 text-sm">
              Prepare ahead (minutes)
              <Input
                type="number"
                min="1"
                value={draft.leadMinutes}
                onChange={(e) =>
                  setDraft({ ...draft, leadMinutes: Number(e.target.value) })
                }
              />
            </label>
          </div>
        </Disclosure>
      </Panel>
      <Panel className="space-y-4">
        <PanelHeading
          title="Start new clips ready to publish"
          icon={<Sparkles className="size-4" aria-hidden />}
        >
          Choose defaults once. Review the text and time before sending.
        </PanelHeading>
        <Checkbox
          checked={draft.autoPrepare}
          onCheckedChange={(checked) =>
            setDraft({ ...draft, autoPrepare: checked })
          }
        >
          Prepare text and reserve times for generated clips
        </Checkbox>
        <div>
          <p className="mb-2 text-sm font-medium">Default accounts</p>
          {!data.accounts.length && (
            <p className="text-xs text-muted-foreground">
              Add a publishing account in the Accounts tab first.
            </p>
          )}
          <div className="grid gap-2 sm:grid-cols-2">
            {data.accounts.map((a) => (
              <Checkbox
                key={a.id}
                className="rounded-xl bg-foreground/5 px-3 py-2"
                checked={draft.defaultAccountIds.includes(a.id)}
                onCheckedChange={(checked) =>
                  setDraft({
                    ...draft,
                    defaultAccountIds: checked
                      ? [...draft.defaultAccountIds, a.id]
                      : draft.defaultAccountIds.filter((id) => id !== a.id),
                  })
                }
              >
                <span className="block text-sm">{a.name}</span>
                <span className="block text-xs text-muted-foreground">
                  {NETWORK_LABELS[a.network]}
                </span>
              </Checkbox>
            ))}
          </div>
        </div>
        <label className="block space-y-1.5 text-sm">
          Writing guidance
          <textarea
            rows={3}
            className="w-full rounded-xl border border-border bg-black/15 p-3 shadow-(--field-shadow) outline-none focus-visible:ring-2 focus-visible:ring-ring"
            placeholder="Tone, language and anything to include in your captions…"
            value={draft.writing}
            onChange={(e) => setDraft({ ...draft, writing: e.target.value })}
          />
        </label>
      </Panel>
      <div className="flex items-center gap-3">
        <Button
          onClick={async () => {
            const result = await run({
              tool: "publishing.settings.save",
              settings: draft,
            });
            if (result) setSaved(true);
          }}
        >
          Save publishing schedule
        </Button>
        <span role="status" className="text-xs text-muted-foreground">
          {saved && "Schedule saved"}
        </span>
      </div>
    </fieldset>
  );
}

function AdvancedSettings({
  initial,
  run,
  busy,
}: {
  initial: PublishingSettings;
  run: PublishingRun;
  busy: boolean;
}) {
  const [draft, setDraft] = useState(initial);
  const [notice, setNotice] = useState("");
  return (
    <fieldset disabled={busy} className="mt-5 space-y-4">
      <label className="block space-y-1.5 text-sm">
        Keep session screenshots (days)
        <Input
          type="number"
          min="1"
          max="3650"
          value={draft.evidenceRetentionDays}
          onChange={(e) =>
            setDraft({
              ...draft,
              evidenceRetentionDays: Number(e.target.value),
            })
          }
        />
      </label>
      <label className="block space-y-1.5 text-sm">
        Existing phone tool path (optional)
        <Input
          value={draft.phoneBinary}
          onChange={(e) => setDraft({ ...draft, phoneBinary: e.target.value })}
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          onClick={async () => {
            const result = await run({
              tool: "publishing.settings.save",
              settings: draft,
            });
            if (result) setNotice("Local publishing settings saved.");
          }}
        >
          Save settings
        </Button>
        <Button
          variant="ghost"
          onClick={async () => {
            const result = await run({ tool: "publishing.evidence.cleanup" });
            if (result) setNotice("Expired screenshots removed.");
          }}
        >
          Remove expired screenshots
        </Button>
      </div>
      <p role="status" className="empty:hidden text-xs text-muted-foreground">
        {notice}
      </p>
    </fieldset>
  );
}
