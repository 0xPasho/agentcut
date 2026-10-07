import { test } from "node:test";
import assert from "node:assert/strict";
import { catalogNote, chipLabel, chipParts, favKeyFor, favoriteRows, filterRows, harnessRows, shortReason } from "../lib/model-rows";
import type { HarnessStatus } from "../server/detect";

/**
 * The picker is one decision — which agent, on which model — so the rows carry
 * their harness. These cover that, and the three different stories a disabled row
 * can be telling.
 */
const harness = (over: Partial<HarnessStatus> = {}): HarnessStatus => ({
  id: "claude", label: "Claude Code", binary: "/usr/bin/claude", installed: true, authState: "authenticated",
  ready: true, reason: "", inheritLabel: "The CLI's default model",
  models: [{ id: "sonnet", displayName: "Sonnet", description: "Efficient" }, { id: "opus" }],
  modelSource: "cli", modelsFetchedAt: Date.now(), ...over,
});

test("every row knows which harness it runs on, default row included", () => {
  const rows = harnessRows(harness());
  assert.deepEqual(rows.map((r) => r.model), ["", "sonnet", "opus"], "the CLI's own default comes first");
  assert.ok(rows.every((r) => r.harnessId === "claude"), "picking a model picks its agent too");
  assert.equal(rows[0].favKey, null, "there is nothing stable to pin about 'whatever is configured'");
  assert.equal(rows[1].label, "Sonnet");
  assert.equal(rows[2].label, "Opus", "a bare slug is still given a name");
});

test("starred rows come from every harness, and disappear with the harness itself", () => {
  const codex = harness({ id: "codex", label: "Codex", models: [{ id: "gpt-5" }] });
  const favourites = { [favKeyFor("claude", "sonnet")]: "Sonnet", [favKeyFor("codex", "gpt-5")]: "GPT 5", "gone:x": "Ghost" };
  const rows = favoriteRows(favourites, [harness(), codex]);
  assert.deepEqual(rows.map((r) => [r.harnessId, r.model]), [["claude", "sonnet"], ["codex", "gpt-5"]],
    "a favourite whose agent is not on this machine is dropped, not shown dead");
  assert.equal(rows[1].detail, "Codex", "across agents, the row says whose it is");
});

test("search matches the name, the slug and the agent", () => {
  const rows = harnessRows(harness());
  assert.deepEqual(filterRows(rows, "sonn").map((r) => r.model), ["sonnet"]);
  assert.deepEqual(filterRows(rows, "opus").map((r) => r.model), ["opus"], "a slug with no display name is still findable");
  assert.equal(filterRows(rows, "").length, rows.length);
  assert.equal(filterRows(rows, "zzz").length, 0);
});

test("a disabled row says which of the three things is wrong", () => {
  assert.equal(shortReason(harness({ installed: false, ready: false }), false), "not installed");
  assert.equal(shortReason(harness({ authState: "unauthenticated", ready: false }), false), "signed out");
  assert.equal(shortReason(harness(), true), "run in progress");
  assert.equal(shortReason(harness(), false), "", "a ready agent explains nothing");
});

test("the chip names the model, never a bare slug, and says when it has nothing", () => {
  assert.equal(chipLabel(harness(), "sonnet", false), "Claude Code · Sonnet");
  assert.equal(chipLabel(harness(), "", false), "Claude Code · default");
  assert.equal(chipLabel(undefined, "", true), "Checking agents…");
  assert.equal(chipLabel(undefined, "", false), "No agent installed");
  assert.match(catalogNote(harness({ modelSource: "curated" })), /Built-in list/);
  assert.match(catalogNote(harness()), /2 models from Claude Code, just now/);

  // The same sentence split for the two-line chip: the agent labels it, the model is
  // the value. Never a bare slug, and never empty on either line.
  assert.deepEqual(chipParts(harness(), "sonnet", false), { agent: "Claude Code", model: "Sonnet" });
  assert.deepEqual(chipParts(harness(), "", false), { agent: "Claude Code", model: "Default" });
  assert.deepEqual(chipParts(undefined, "", true), { agent: "Agent", model: "Checking…" });
  assert.deepEqual(chipParts(undefined, "", false), { agent: "Agent", model: "None installed" });
});
