import { db } from "../../../common/server/db";
import { ProjectName } from "../types";

/** Project names are metadata; renaming must not replace an EDL or invalidate a draft. */
export function renameProject(id: string, value: unknown) {
  const name = ProjectName.parse(value);
  const result = db.prepare("UPDATE projects SET name = ? WHERE id = ?").run(name, id);
  if (!result.changes) throw new Error("Project not found");
  return { id, name };
}
