/** The style choice that lets a project decide its guide on its own. */
export const AUTO_STYLE = "auto";

/**
 * The editor tools a recipe may call (decision 143). Everything a recipe changes goes
 * through `project.edit`, so it is validated, undoable and inspectable like any other
 * edit; nothing here reaches another project, the workspace's settings, packs, keys or
 * agents, and there is no tool to trust code.
 */
export const RECIPE_TOOLS = ["project.read", "project.edit", "assets.list", "templates.list", "templates.get"] as const;

/** A recipe that has not finished in this long is stopped, and what it already edited stays edited. */
export const RECIPE_TIMEOUT_MS = 5 * 60_000;

/** Where a recipe writes its scratch files, inside the run's own temporary folder. */
export const RECIPE_SCRATCH = "scratch";
