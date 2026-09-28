import { z } from "zod";

export const Network = z.enum(["youtube", "instagram", "tiktok"]);
export type Network = z.infer<typeof Network>;
export const ProviderId = z.enum(["iphone", "postgun", "postbridge"]);
export type ProviderId = z.infer<typeof ProviderId>;
export const Format = z.enum(["youtube-video", "youtube-short", "instagram-reel", "tiktok-video"]);
export type Format = z.infer<typeof Format>;
export const DeliveryState = z.enum(["not_sent", "queued", "sending", "scheduled", "published", "failed", "unknown", "cancel_pending", "cancelled"]);
export type DeliveryState = z.infer<typeof DeliveryState>;
export type PublicationStatus = "draft" | "approved" | "pending" | "publishing" | "scheduled" | "published" | "partial" | "attention" | "cancelled";
export const Copy = z.object({ title: z.string().default(""), description: z.string().default(""), hashtags: z.array(z.string().trim().regex(/^[^#\s]+$/)).default([]) }).strict();
export type Copy = z.infer<typeof Copy>;
export const Overrides = z.object({ title: z.string().nullable().default(null), description: z.string().nullable().default(null), hashtags: z.array(z.string().trim().regex(/^[^#\s]+$/)).nullable().default(null) }).strict();
export const DestinationOptions = z.object({ useProviderDefaults: z.boolean().default(false), privacy: z.enum(["public", "private", "unlisted"]).default("public"), madeForKids: z.boolean().nullable().default(null), synthetic: z.boolean().default(false), branded: z.boolean().default(false), ownBrand: z.boolean().default(false), comments: z.boolean().default(true), duet: z.boolean().default(false), stitch: z.boolean().default(false), tags: z.array(z.string()).default([]) }).strict();
export type DestinationOptions = z.infer<typeof DestinationOptions>;
export const Account = z.object({ id: z.string(), connectionId: z.string(), remoteId: z.string(), network: Network, name: z.string(), disabled: z.boolean().default(false), needsReconnect: z.boolean().default(false), equivalentTo: z.string().nullable().default(null) });
export type Account = z.infer<typeof Account>;
export const Connection = z.object({ id: z.string(), provider: ProviderId, name: z.string(), baseUrl: z.string(), configured: z.boolean(), checkedAt: z.number().nullable().default(null), error: z.string().nullable().default(null) });
export type Connection = z.infer<typeof Connection>;
export const Artifact = z.object({ id: z.string(), projectId: z.string(), sequenceId: z.string(), revision: z.number(), signature: z.string(), sha256: z.string(), bytes: z.number(), width: z.number(), height: z.number(), duration: z.number(), createdAt: z.number() });
export type Artifact = z.infer<typeof Artifact>;
export const ResolvedPayload = z.object({ artifactId: z.string(), accountId: z.string(), connectionId: z.string(), remoteAccountId: z.string(), network: Network, format: Format, title: z.string(), caption: z.string(), hashtags: z.array(z.string()), options: DestinationOptions, scheduledAt: z.iso.datetime({ offset: true }).nullable(), timezone: z.string() });
export type ResolvedPayload = z.infer<typeof ResolvedPayload>;
export const Destination = z.object({ id: z.string(), accountId: z.string(), format: Format, overrides: Overrides.prefault({}), options: DestinationOptions.prefault({}), scheduledAt: z.iso.datetime({ offset: true }).nullable().default(null), state: DeliveryState.default("not_sent"), payload: ResolvedPayload.nullable().default(null), payloadHash: z.string().nullable().default(null), remoteId: z.string().nullable().default(null), remoteUrl: z.string().nullable().default(null), confirmedAt: z.string().nullable().default(null), publishedAt: z.string().nullable().default(null), checkedAt: z.number().nullable().default(null), error: z.string().nullable().default(null), evidence: z.array(z.string()).default([]) });
export type Destination = z.infer<typeof Destination>;
export const PhoneSource = z.object({ kind: z.enum(["drive", "photos"]), folder: z.string().default(""), file: z.string().min(1), artifactId: z.string().nullable().default(null) });
export const Publication = z.object({ id: z.string(), projectId: z.string(), sequenceId: z.string(), label: z.string(), copy: Copy, scheduledAt: z.iso.datetime({ offset: true }).nullable(), timezone: z.string(), priority: z.number().int().default(0), expiresAt: z.iso.datetime({ offset: true }).nullable().default(null), artifactId: z.string().nullable(), phoneSource: PhoneSource.nullable().default(null), destinations: z.array(Destination), revision: z.number().int(), createdAt: z.number(), updatedAt: z.number(), origin: z.string().nullable().default(null), archived: z.boolean().default(false) });
export type Publication = z.infer<typeof Publication>;
export type PublicationDetail = Publication & { status: PublicationStatus; videoApproved: boolean; projectRevision: number | null; editorHref: string | null; newerEdit: boolean; artifact: Artifact | null };
export type PublishingRun = <T = unknown>(input: unknown) => Promise<T | undefined>;
export type PublicationBatchResult = { id: string; ok: boolean; error?: string };
export const PublishingSettings = z.object({ timezone: z.string().default("America/Mexico_City"), slots: z.array(z.object({ weekday: z.number().int().min(0).max(6), time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/) })).default([]), minGapMinutes: z.number().int().min(1).default(60), leadMinutes: z.number().int().min(1).default(30), defaultAccountIds: z.array(z.string()).default([]), writing: z.string().default(""), autoPrepare: z.boolean().default(false), evidenceRetentionDays: z.number().int().min(1).max(3650).default(30), phoneBinary: z.string().default(""), revision: z.number().int().default(0) }).strict();
export type PublishingSettings = z.infer<typeof PublishingSettings>;
export type Occupancy = { accountId: string; at: string; publicationId: string };
export type SlotRequest = { publicationId: string; accountIds: string[]; priority: number; expiresAt: string | null };
export type SlotPlan = { placements: Array<{ publicationId: string; at: string }>; unavailable: Array<{ publicationId: string; reason: string }> };
export type ValidationIssue = { destinationId: string | null; field: string; message: string };
export type ProviderResult = { state: DeliveryState; remoteId?: string | null; remoteUrl?: string | null; confirmedAt?: string | null; publishedAt?: string | null; error?: string | null };
export type Attempt = { id: string; publicationId: string; destinationId: string; action: "publish" | "cancel" | "refresh" | "reschedule"; hash: string; startedAt: number; endedAt: number | null; result: string; owner: string };
export const PhoneSession = z.object({ id: z.string(), publicationId: z.string(), destinationIds: z.array(z.string()), hashes: z.record(z.string(), z.string()), status: z.enum(["active", "aborted", "done"]), step: z.string(), evidence: z.array(z.string()), leaseUntil: z.number(), createdAt: z.number(), updatedAt: z.number() });
export type PhoneSession = z.infer<typeof PhoneSession>;
export const PhoneWindow = z.object({ id: z.number().int().positive(), x: z.number(), y: z.number(), w: z.number().positive(), h: z.number().positive(), trusted: z.boolean(), frontmost: z.boolean() });
export type PhoneWindow = z.infer<typeof PhoneWindow>;
export type PhoneAction = { kind: "screen" | "tap" | "scroll" | "key" | "paste" | "home"; x?: number; y?: number; amount?: number; key?: string; modifier?: string; text?: string };
export type ToolContext = { actor: "human" | "agent" | "system"; projectId?: string };
export const CalendarQuery = z.object({ from: z.iso.date(), to: z.iso.date(), projectId: z.string().min(1).optional(), accountId: z.string().optional(), offset: z.number().int().min(0).default(0), limit: z.number().int().min(1).max(200).default(100) });
export const CalendarPlacement = z.object({ destinationId: z.string(), at: z.iso.datetime({ offset: true }).nullable() });
export type CalendarPlacement = z.infer<typeof CalendarPlacement>;
export type CalendarMove = { publication: PublicationDetail; destinationIds: string[]; day: string; time: string };
export type CalendarUndo = { id: string; revision: number; placements: CalendarPlacement[]; label: string; day: string | null };
export type CalendarDrag = { publicationId: string; revision: number; destinationIds: string[] };
export type CalendarQuery = z.infer<typeof CalendarQuery>;
export type PublishingOverview = { publications: PublicationDetail[]; accounts: Account[]; connections: Connection[]; settings: PublishingSettings; sessions: PhoneSession[]; externalCalendars: Array<{ connectionId: string; checkedAt: number }>; nextOffset?: number | null };
export type CalendarPageData = { initial: PublishingOverview; project: { id: string; name: string } | null };
export const ImportSourceMap = z.record(z.string(), z.object({ projectId: z.string(), sequenceId: z.string() }));
export type ImportSourceMap = z.infer<typeof ImportSourceMap>;
export const CadenceRow = z.object({
  id: z.string(), title: z.string().default(""), caption: z.string().default(""), scheduledAt: z.iso.datetime({ offset: true }).nullable().default(null), timezone: z.string().optional(), createdAt: z.number().optional(),
  origin: z.object({ ref: z.string().optional(), detail: z.string().optional() }).nullable().default(null),
  media: z.array(z.object({ path: z.string(), sha256: z.string().optional() })).default([]),
  destinations: z.array(z.object({ accountId: z.string(), network: z.string(), caption: z.string().default(""), title: z.string().default(""), hashtags: z.array(z.string()).default([]), settings: z.record(z.string(), z.unknown()).default({}), scheduledAt: z.iso.datetime({ offset: true }).nullable().default(null), status: z.string(), remoteId: z.string().nullable().default(null), remoteUrl: z.string().nullable().default(null), publishedAt: z.string().nullable().default(null) })),
});
export type ImportPreview = { source: string; entries: Publication[]; issues: Array<{ id: string; message: string }>; existing: number; artifacts: Array<{ publicationId: string; path: string; sha256: string }>; provenance: Array<{ publicationId: string; sourcePost: z.infer<typeof CadenceRow> }> };
export type AgentCopyProposal = { revision: number; copy: Copy; reason: string };

// Calendar backups carry records, never credentials, delivery grants or local media paths.
export const CalendarArchive = z.object({
  format: z.literal("agentcut-calendar"), version: z.literal(1),
  exportedAt: z.iso.datetime(), timezone: z.string(),
  publications: z.array(Publication).max(50_000),
  accounts: z.array(Account.pick({ id: true, connectionId: true, remoteId: true, network: true, name: true, equivalentTo: true })),
  connections: z.array(Connection.pick({ id: true, provider: true, name: true })),
}).strict();
export type CalendarArchive = z.infer<typeof CalendarArchive>;
export type CalendarImportPreview = { total: number; added: number; skipped: number; reconnect: number; missingVideos: number; uncertain: number; timezone: string; firstDay: string | null };

export const PublicationCommand = z.discriminatedUnion("tool", [
  z.object({ tool: z.literal("publication.calendar"), query: CalendarQuery }),
  z.object({ tool: z.literal("publication.calendar.export") }),
  z.object({ tool: z.literal("publication.calendar.import.preview"), archive: CalendarArchive }),
  z.object({ tool: z.literal("publication.calendar.import.apply"), archive: CalendarArchive }),
  z.object({ tool: z.literal("publication.overview"), projectId: z.string().optional() }),
  z.object({ tool: z.literal("publication.prepare"), projectId: z.string(), sequenceIds: z.array(z.string()).min(1), accountIds: z.array(z.string()).optional(), repeat: z.boolean().default(false) }),
  z.object({ tool: z.literal("publication.read"), id: z.string() }),
  z.object({ tool: z.literal("publication.patch"), id: z.string(), revision: z.number().int(), patch: Publication.pick({ label: true, copy: true, scheduledAt: true, timezone: true, priority: true, expiresAt: true, phoneSource: true }).partial(), destinations: z.array(Destination).optional() }),
  z.object({ tool: z.literal("publication.reschedule"), id: z.string(), revision: z.number().int(), placements: z.array(CalendarPlacement).min(1) }),
  z.object({ tool: z.literal("publication.approveVideo"), id: z.string(), projectRevision: z.number().int() }),
  z.object({ tool: z.literal("publication.pin"), id: z.string(), revision: z.number().int(), render: z.boolean().default(false) }),
  z.object({ tool: z.literal("publication.validate"), id: z.string() }),
  z.object({ tool: z.literal("publication.batch"), action: z.enum(["authorize", "dispatch"]), items: z.array(z.object({ id: z.string(), revision: z.number().int() })).min(1), confirmed: z.boolean().default(false) }),
  z.object({ tool: z.literal("publication.authorize"), id: z.string(), revision: z.number().int() }),
  z.object({ tool: z.literal("publication.dispatch"), id: z.string(), revision: z.number().int(), confirmed: z.boolean() }),
  z.object({ tool: z.literal("publication.refresh"), id: z.string() }),
  z.object({ tool: z.literal("publication.cancel"), id: z.string(), revision: z.number().int(), destinationId: z.string() }),
  z.object({ tool: z.literal("publication.move"), id: z.string(), revision: z.number().int(), destinationId: z.string(), at: z.iso.datetime({ offset: true }) }),
  z.object({ tool: z.literal("publication.reconcile"), id: z.string(), revision: z.number().int(), destinationId: z.string(), state: z.enum(["published", "scheduled", "cancelled", "not_sent"]), remoteId: z.string().nullable(), remoteUrl: z.url().nullable(), at: z.iso.datetime({ offset: true }).nullable(), note: z.string().min(10) }),
  z.object({ tool: z.literal("publication.slots"), ids: z.array(z.string()).min(1), from: z.iso.date(), days: z.number().int().min(1).max(90).default(30), reserve: z.boolean().default(false), revisions: z.record(z.string(), z.number()).default({}) }),
  z.object({ tool: z.literal("publication.copy.propose"), id: z.string(), instruction: z.string().default("") }),
  z.object({ tool: z.literal("publication.copy.apply"), id: z.string(), revision: z.number().int(), copy: Copy }),
  z.object({ tool: z.literal("publishing.settings.save"), settings: PublishingSettings }),
  z.object({ tool: z.literal("publishing.connection.save"), id: z.string().optional(), provider: ProviderId, name: z.string().min(1), baseUrl: z.string().optional(), key: z.string().optional() }),
  z.object({ tool: z.literal("publishing.connection.link"), connectionId: z.string(), network: z.enum(["instagram", "tiktok"]), returnUrl: z.url() }),
  z.object({ tool: z.literal("publishing.calendar.sync"), connectionId: z.string() }),
  z.object({ tool: z.literal("publishing.account.link"), accountId: z.string(), equivalentTo: z.string().nullable() }),
  z.object({ tool: z.literal("publishing.accounts.sync"), connectionId: z.string() }),
  z.object({ tool: z.literal("publishing.account.phone"), connectionId: z.string(), network: Network, name: z.string().min(1), remoteId: z.string().min(1) }),
  z.object({ tool: z.literal("publishing.evidence.cleanup") }),
  z.object({ tool: z.literal("publishing.phone.readiness") }),
  z.object({ tool: z.literal("publishing.phone.build") }),
  z.object({ tool: z.literal("publication.phone.start"), id: z.string(), attended: z.literal(true), run: z.boolean().default(false) }),
  z.object({ tool: z.literal("publication.phone.resume"), sessionId: z.string(), attended: z.literal(true), run: z.boolean().default(false) }),
  z.object({ tool: z.literal("publication.phone.action"), sessionId: z.string(), action: z.object({ kind: z.enum(["screen", "tap", "scroll", "key", "paste", "home"]), x: z.number().min(0).max(1).optional(), y: z.number().min(0).max(1).optional(), amount: z.number().int().min(-1000).max(1000).optional(), key: z.string().optional(), modifier: z.enum(["cmd", "shift"]).optional(), text: z.string().optional() }), note: z.string().min(1) }),
  z.object({ tool: z.literal("publication.phone.record"), sessionId: z.string(), destinationId: z.string(), outcome: z.enum(["scheduled", "published", "cancelled", "unknown"]), at: z.iso.datetime({ offset: true }).nullable(), remoteUrl: z.url().nullable(), evidenceId: z.string(), note: z.string().min(10) }),
  z.object({ tool: z.literal("publication.phone.abort"), sessionId: z.string(), reason: z.string().min(1) }),
  z.object({ tool: z.literal("publication.import.preview"), file: z.string(), accountMap: z.record(z.string(), z.string()).default({}), sourceMap: ImportSourceMap.default({}) }),
  z.object({ tool: z.literal("publication.import.apply"), file: z.string(), accountMap: z.record(z.string(), z.string()), sourceMap: ImportSourceMap.default({}) }),
  z.object({ tool: z.literal("publication.import.rollback"), importId: z.string() }),
]);
export type PublicationCommand = z.infer<typeof PublicationCommand>;
