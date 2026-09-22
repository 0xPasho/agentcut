import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

/**
 * The harness picker's logic, without a CLI on the machine.
 *
 * Everything here is either pure or backed by fixture directories, on purpose:
 * a test that shells out to `claude` passes on the author's laptop and fails in
 * every other place it runs, which makes it worse than no test.
 */
let workspace: string;
let binary: typeof import("../server/binary");
let auth: typeof import("../server/auth");
let catalog: typeof import("../lib/model-catalog");
let discover: typeof import("../server/model-discover");
let selection: typeof import("../server/selection");

before(async () => {
  workspace = await fs.mkdtemp(path.join(os.tmpdir(), "agentcut-agents-"));
  process.env.AGENTCUT_WORKSPACE = workspace;
  [binary, auth, catalog, discover, selection] = await Promise.all([
    import("../server/binary"),
    import("../server/auth"),
    import("../lib/model-catalog"),
    import("../server/model-discover"),
    import("../server/selection"),
  ]);
});

after(async () => {
  await fs.rm(workspace, { recursive: true, force: true });
});

// -----------------------------------------------------------------------------
// binary resolution
// -----------------------------------------------------------------------------

test("resolves a binary against a given PATH and reports the absolute file", async () => {
  const dir = await fs.mkdtemp(path.join(workspace, "bin-"));
  const file = path.join(dir, "pretend-cli");
  await fs.writeFile(file, "#!/bin/sh\nexit 0\n", { mode: 0o755 });

  assert.equal(binary.resolveBinary("pretend-cli", dir), file);
  assert.equal(binary.resolveBinary("not-a-cli", dir), null);
});

test("a non-executable file of the right name does not count as installed", async () => {
  const dir = await fs.mkdtemp(path.join(workspace, "bin-"));
  await fs.writeFile(path.join(dir, "inert"), "text", { mode: 0o644 });
  assert.equal(binary.resolveBinary("inert", dir), null);
});

test("a configured absolute path is taken as given, not searched for", async () => {
  const dir = await fs.mkdtemp(path.join(workspace, "bin-"));
  const file = path.join(dir, "elsewhere");
  await fs.writeFile(file, "#!/bin/sh\n", { mode: 0o755 });
  // Note the empty PATH: a path the user configured must not depend on it.
  assert.equal(binary.resolveBinary(file, ""), file);
});

test("the padded dirs are searched after PATH, so an empty PATH still finds CLIs", () => {
  const dirs = binary.searchDirs("/only/this");
  assert.equal(dirs[0], "/only/this");
  assert.ok(dirs.some((d) => d.endsWith("/.local/bin")), "expected ~/.local/bin in the padding");
  assert.ok(dirs.includes("/opt/homebrew/bin"));
});

// -----------------------------------------------------------------------------
// auth probes
// -----------------------------------------------------------------------------

test("claude reads as signed in when the config carries an oauth account", async () => {
  const dir = await fs.mkdtemp(path.join(workspace, "claude-"));
  await fs.writeFile(
    path.join(dir, ".claude.json"),
    JSON.stringify({ oauthAccount: { emailAddress: "someone@example.com" } }),
  );
  const probe = await auth.probeClaude(dir);
  assert.equal(probe.authState, "authenticated");
  assert.equal(probe.accountLabel, "someone@example.com");
});

test("claude reads as signed out when its config exists but names no account", async () => {
  const dir = await fs.mkdtemp(path.join(workspace, "claude-"));
  await fs.writeFile(path.join(dir, ".claude.json"), JSON.stringify({ userID: "x" }));
  assert.equal((await auth.probeClaude(dir)).authState, "unauthenticated");
});

test("a CLI that has never run reads as unknown, never as signed out", async () => {
  const dir = path.join(workspace, "never-used");
  assert.equal((await auth.probeClaude(dir)).authState, "unknown");
  assert.equal((await auth.probeCodex(dir)).authState, "unknown");
});

test("codex reads its auth mode as the account label", async () => {
  const dir = await fs.mkdtemp(path.join(workspace, "codex-"));
  await fs.writeFile(
    path.join(dir, "auth.json"),
    JSON.stringify({ auth_mode: "chatgpt", tokens: { access_token: "t" } }),
  );
  const probe = await auth.probeCodex(dir);
  assert.equal(probe.authState, "authenticated");
  assert.equal(probe.accountLabel, "chatgpt");
});

test("unknown counts as usable — a keychain-only login must not read as broken", () => {
  assert.equal(auth.usable(true, "unknown"), true);
  assert.equal(auth.usable(true, "authenticated"), true);
  assert.equal(auth.usable(true, "unauthenticated"), false);
  assert.equal(auth.usable(false, "unknown"), false);
});

// -----------------------------------------------------------------------------
// catalog
// -----------------------------------------------------------------------------

test("discovery order wins over the curated ordering", () => {
  const curated = [{ id: "sonnet", recommended: true }, { id: "haiku" }];
  const discovered = [{ id: "haiku" }, { id: "sonnet" }];
  assert.deepEqual(catalog.mergeCatalog(curated, discovered).map((m) => m.id), ["haiku", "sonnet"]);
});

test("a curated model the CLI did not list is kept, not dropped", () => {
  const merged = catalog.mergeCatalog([{ id: "opus" }], [{ id: "sonnet" }]);
  assert.deepEqual(merged.map((m) => m.id), ["sonnet", "opus"]);
});

test("an empty discovery leaves the curated list alone, recommended first", () => {
  const merged = catalog.mergeCatalog([{ id: "haiku" }, { id: "sonnet", recommended: true }], []);
  assert.deepEqual(merged.map((m) => m.id), ["sonnet", "haiku"]);
});

test("a slug with no display name still reads as a name", () => {
  assert.equal(catalog.prettyModelLabel({ id: "claude-sonnet-5" }), "Claude Sonnet 5");
  assert.equal(catalog.prettyModelLabel({ id: "anthropic/claude-opus-5" }), "Claude Opus 5");
  assert.equal(catalog.prettyModelLabel({ id: "gpt-5-codex" }), "GPT 5 Codex");
  assert.equal(catalog.prettyModelLabel({ id: "x", displayName: "Given" }), "Given");
});

test("filtering matches slug and description, not just the label", () => {
  const models = [
    { id: "gpt-5.3-codex-high", displayName: "Codex 5.3 High" },
    { id: "kimi/k3", displayName: "k3", description: "kimi-code-plan" },
  ];
  assert.deepEqual(catalog.filterModels(models, "5.3").map((m) => m.id), ["gpt-5.3-codex-high"]);
  assert.deepEqual(catalog.filterModels(models, "kimi").map((m) => m.id), ["kimi/k3"]);
  assert.equal(catalog.filterModels(models, "").length, 2);
});

// -----------------------------------------------------------------------------
// discovery parsers
// -----------------------------------------------------------------------------

test("claude's initialize response yields the aliases --model accepts", () => {
  const models = discover.parseClaudeModels({
    type: "control_response",
    response: {
      response: {
        models: [
          { value: "default", resolvedModel: "claude-opus-5[1m]", displayName: "Default (recommended)", description: "Opus 5" },
          { value: "sonnet", resolvedModel: "claude-sonnet-5", displayName: "Sonnet" },
        ],
      },
    },
  });
  // `value`, not `resolvedModel`: the alias carries the context window.
  assert.deepEqual(models.map((m) => m.id), ["default", "sonnet"]);
  assert.equal(models[0].recommended, true);
  assert.equal(models[1].displayName, "Sonnet");
});

test("codex pages are parsed, hidden models dropped, the default marked", () => {
  const page = discover.parseCodexPage({
    result: {
      data: [
        { id: "gpt-6-astra", displayName: "GPT-6-Astra", isDefault: true },
        { id: "internal", hidden: true },
        { id: "gpt-5.6-sol", displayName: "GPT-5.6-Sol" },
      ],
      nextCursor: "page2",
    },
  });
  assert.deepEqual(page.models.map((m) => m.id), ["gpt-6-astra", "gpt-5.6-sol"]);
  assert.equal(page.models[0].recommended, true);
  assert.equal(page.nextCursor, "page2");
});

test("codex pagination stops when the cursor runs out", async () => {
  const pages = [
    { result: { data: [{ id: "a" }], nextCursor: "n" } },
    { result: { data: [{ id: "b" }] } },
  ];
  let calls = 0;
  const models = await discover.collectCodexModels(() => Promise.resolve(pages[calls++]));
  assert.equal(calls, 2);
  assert.deepEqual(models.map((m) => m.id), ["a", "b"]);
});

test("cursor's model lines split into slug and name, heading ignored", () => {
  const models = discover.parseCursorModels(
    ["Available models", "", "auto - Auto (current, default)", "gpt-5.2 - GPT-5.2"].join("\n"),
  );
  assert.deepEqual(models.map((m) => m.id), ["auto", "gpt-5.2"]);
  assert.equal(models[0].displayName, "Auto");
  assert.equal(models[0].recommended, true);
  assert.equal(models[1].recommended, undefined);
});

test("opencode's provider/model slugs keep the provider as the detail", () => {
  const models = discover.parseOpencodeModels("opencode/big-pickle\nkimi-code-plan-global/k3\n\nnoise line\n");
  assert.deepEqual(models.map((m) => m.id), ["opencode/big-pickle", "kimi-code-plan-global/k3"]);
  assert.equal(models[1].displayName, "k3");
  assert.equal(models[1].description, "kimi-code-plan-global");
});

// -----------------------------------------------------------------------------
// selection
// -----------------------------------------------------------------------------

test("nothing saved resolves to no preference, so the PATH walk still applies", () => {
  assert.deepEqual(selection.resolveSelection(), { provider: "", model: "", scope: "none" });
});

test("a project override beats the workspace default", () => {
  selection.saveSelection({ provider: "claude", model: "sonnet" });
  selection.saveSelection({ provider: "codex", model: "gpt-5.1-codex" }, "p1");

  assert.deepEqual(selection.resolveSelection(), { provider: "claude", model: "sonnet", scope: "workspace" });
  assert.deepEqual(selection.resolveSelection("p1"), { provider: "codex", model: "gpt-5.1-codex", scope: "project" });
  // A project that never chose inherits, and does not report the value as its own.
  assert.equal(selection.resolveSelection("p2").scope, "workspace");
  assert.equal(selection.storedSelection("p2"), null);
});

test("clearing a project override falls back to the workspace default", () => {
  selection.saveSelection({ provider: "claude", model: "" });
  selection.saveSelection({ provider: "codex", model: "" }, "p3");
  selection.saveSelection(null, "p3");
  assert.equal(selection.resolveSelection("p3").provider, "claude");
});

test("an explicit provider wins, and does not drag the saved model along with it", () => {
  selection.saveSelection({ provider: "claude", model: "sonnet" });
  // Asking for codex must not hand codex the string "sonnet".
  assert.deepEqual(selection.effectiveSelection(undefined, { provider: "codex" }), { provider: "codex" });
  // Same harness, explicit model: both are honoured.
  assert.deepEqual(selection.effectiveSelection(undefined, { provider: "claude", model: "opus" }), {
    provider: "claude",
    model: "opus",
  });
  // Nothing explicit: the saved pair, whole.
  assert.deepEqual(selection.effectiveSelection(undefined), { provider: "claude", model: "sonnet" });
});

test("a model alone keeps the saved harness", () => {
  selection.saveSelection({ provider: "claude", model: "sonnet" });
  assert.deepEqual(selection.effectiveSelection(undefined, { model: "haiku" }), {
    provider: "claude",
    model: "haiku",
  });
});

test("an unknown harness cannot be saved", () => {
  assert.throws(() => selection.saveSelection({ provider: "gemini" as never, model: "" }), /unknown harness/);
});

test("a named harness that is not installed fails instead of falling through", async () => {
  const { resolveProvider } = await import("../lib/providers");
  await assert.rejects(
    // An override pointing at nothing is the cheapest way to make a CLI missing.
    (async () => {
      process.env.AGENTCUT_CURSOR_BIN = path.join(workspace, "no-such-cursor");
      try {
        await resolveProvider("cursor");
      } finally {
        delete process.env.AGENTCUT_CURSOR_BIN;
      }
    })(),
    /not installed/,
  );
});
