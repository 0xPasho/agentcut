import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { q } from "../db";
import { projectDir } from "../config";
import { grabFrame } from "../media";
import { scanLibrary, registerAsset, uploadLibraryAsset } from "../assets";
import { searchImages, adoptHit } from "../search";
import { EditRequest, EditorOperation } from "./operations";
import { editProject, readEditor } from "./store";

export const EditorToolCall = z.discriminatedUnion("tool", [
  z.object({ tool: z.literal("project.read") }),
  z.object({ tool: z.literal("media.import"), file: z.string().min(1), expectedRevision: z.number().int().nonnegative() }),
  z.object({ tool: z.literal("media.upload"), name: z.string().min(1), base64: z.string().min(1), expectedRevision: z.number().int().nonnegative() }),
  z.object({ tool: z.literal("project.edit"), ...EditRequest.shape }),
  z.object({ tool: z.literal("assets.browseLocal"), folder: z.string().optional(), offset: z.number().int().nonnegative().default(0) }),
  z.object({ tool: z.literal("assets.importLocal"), file: z.string().min(1) }),
  z.object({ tool: z.literal("assets.list"), kind: z.enum(["image", "audio", "video"]) }),
  z.object({ tool: z.literal("assets.capture"), atSec: z.number().nonnegative(), mediaId: z.string().optional() }),
  z.object({ tool: z.literal("assets.search"), query: z.string().trim().min(1) }),
  z.object({ tool: z.literal("assets.adopt"), query: z.string().trim().min(1), provider: z.string(), id: z.string() }),
  z.object({ tool: z.literal("assets.upload"), name: z.string().min(1), base64: z.string().min(1).max(100_000_000) }),
  z.object({ tool: z.literal("assets.import"), file: z.string().min(1) }),
  z.object({ tool: z.literal("project.render"), only: z.array(z.string()).optional(), expectedRevision: z.number().int().nonnegative() }),
]);
export const editorToolSchema = () => z.toJSONSchema(EditorToolCall);
export const editorOperationSchema = () => z.toJSONSchema(EditorOperation);

export async function captureAsset(projectId: string, atSec: number, mediaId?: string) {
  const project = q.getProject(projectId);
  if (!project) throw new Error("Project not found");
  const at = z.number().nonnegative().parse(atSec);
  const edl = project.edl ? readEditor(projectId).edl : undefined;
  const media = mediaId ? edl?.media.find(m => m.id === mediaId) : undefined;
  if (mediaId && !media) throw new Error("Source media not found");
  // Without a media ID this captures the primary source, which a source-free project
  // does not have. Say so rather than probing an empty path.
  const primary = edl ? edl.source?.file ?? null : project.source_path || null;
  const from = media?.file ?? primary;
  if (!from) throw new Error("This project has no source video. Choose imported media to capture a frame from.");
  const duration = media?.durationSec ?? edl?.source?.durationSec;
  if (duration !== undefined && at >= duration) throw new Error("Capture time must be inside the source");
  const dir = path.join(projectDir(projectId), "assets");
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `frame-${media?.id ?? "primary"}-${Math.round(at * 1000)}.jpg`);
  await grabFrame(from, at, file, 1280);
  return registerAsset({ file, scope: "project", projectId, source: "capture" });
}

/** The host binds projectId; agents cannot select another project through tool arguments. */
export async function executeEditorTool(projectId: string, raw: unknown): Promise<unknown> {
  if (!q.getProject(projectId)) throw new Error("Project not found");
  const call = EditorToolCall.parse(raw);
  switch (call.tool) {
    case "project.read": return readEditor(projectId);
    case "media.import": case "media.upload": {
      const { importProjectMedia } = await import("./media");
      return importProjectMedia(projectId, call.expectedRevision, call.tool === "media.import" ? { file: call.file } : { name: call.name, bytes: Buffer.from(call.base64, "base64") });
    }
    case "project.edit": return editProject(projectId, { expectedRevision: call.expectedRevision, operations: call.operations });
    case "assets.browseLocal": {
      const { browseLocalFolder } = await import("./local-assets");
      return browseLocalFolder(call.folder, call.offset);
    }
    case "assets.importLocal": {
      const { importLocalAsset } = await import("./local-assets");
      return importLocalAsset(projectId, call.file);
    }
    case "assets.list": await scanLibrary(); return q.listAssets(call.kind, projectId);
    case "assets.capture": return captureAsset(projectId, call.atSec, call.mediaId);
    case "assets.search": return searchImages(call.query);
    case "assets.adopt": {
      const hit = (await searchImages(call.query)).find(h => h.id === call.id && h.provider === call.provider);
      if (!hit) throw new Error("Search result is no longer available. Search again before selecting an image.");
      return adoptHit(hit, projectId);
    }
    case "assets.upload": return uploadLibraryAsset(call.name, Buffer.from(call.base64, "base64"));
    case "assets.import": {
      const root = await fs.realpath(projectDir(projectId));
      const file = await fs.realpath(path.resolve(root, call.file));
      if (!file.startsWith(root + path.sep)) throw new Error("Import a file inside this project's workspace");
      return registerAsset({ file, scope: "project", projectId, source: "import" });
    }
    case "project.render": {
      const { renderProject } = await import("./render");
      return renderProject(projectId, { only: call.only, expectedRevision: call.expectedRevision });
    }
  }
}
