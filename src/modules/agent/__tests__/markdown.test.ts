import { test } from "node:test";
import assert from "node:assert/strict";
import { inlineText, parseInline, parseMarkdown, safeHref } from "../lib/markdown";
import type { MarkdownBlock } from "../types";

const kinds = (blocks: MarkdownBlock[]) => blocks.map((b) => b.kind);

/** The block at `i`, asserted to be the kind the test is about and typed as it. */
function at<K extends MarkdownBlock["kind"]>(blocks: MarkdownBlock[], i: number, kind: K) {
  const block = blocks[i];
  assert.equal(block.kind, kind);
  return block as Extract<MarkdownBlock, { kind: K }>;
}

test("a plain sentence is one paragraph", () => {
  const blocks = parseMarkdown("I shortened the hook and lowered the music.");
  assert.deepEqual(kinds(blocks), ["paragraph"]);
  assert.equal(inlineText(at(blocks, 0, "paragraph").content), "I shortened the hook and lowered the music.");
});

test("the marks a reply actually uses", () => {
  const nodes = parseInline("**Done** — trimmed `clip.patch`, see [the plan](https://example.com/p) *now* ~~later~~");
  assert.deepEqual(nodes.map((n) => n.kind), ["strong", "text", "code", "text", "link", "text", "em", "text", "strike"]);
  assert.equal(inlineText(nodes), "Done — trimmed clip.patch, see the plan now later");
});

test("snake_case is not italics and an escape is not a mark", () => {
  assert.deepEqual(parseInline("source_path stays").map((n) => n.kind), ["text"]);
  assert.equal(inlineText(parseInline("\\*not bold\\*")), "*not bold*");
});

test("headings, rules and quotes", () => {
  const blocks = parseMarkdown("## What changed\n\n> It was too long.\n\n---\n\nSo I cut it.");
  assert.deepEqual(kinds(blocks), ["heading", "quote", "rule", "paragraph"]);
  assert.equal(at(blocks, 0, "heading").level, 2);
  assert.deepEqual(kinds(at(blocks, 1, "quote").blocks), ["paragraph"]);
});

test("a fence keeps its text and its language, marks and all", () => {
  const blocks = parseMarkdown("Try:\n\n```json\n{ \"tool\": \"clip.patch\" }\n*not italic*\n```\n\nDone.");
  assert.deepEqual(kinds(blocks), ["paragraph", "code", "paragraph"]);
  const code = at(blocks, 1, "code");
  assert.equal(code.language, "json");
  assert.equal(code.text, "{ \"tool\": \"clip.patch\" }\n*not italic*");
});

test("a list nests, and an ordered list keeps its first number", () => {
  const blocks = parseMarkdown("- trimmed the intro\n  - by 2.4s\n- raised the title\n");
  assert.deepEqual(kinds(blocks), ["list"]);
  const list = at(blocks, 0, "list");
  assert.equal(list.ordered, false);
  assert.equal(list.items.length, 2);
  assert.equal(inlineText(list.items[0].content), "trimmed the intro");
  assert.deepEqual(kinds(list.items[0].blocks), ["list"]);

  const ordered = at(parseMarkdown("3. third\n4. fourth"), 0, "list");
  assert.equal(ordered.ordered, true);
  assert.equal(ordered.start, 3);
  assert.equal(ordered.items.length, 2);
});

test("a table becomes a table", () => {
  const blocks = parseMarkdown("| clip | length |\n| --- | ---: |\n| hook | 4.2s |\n| body | 31s |");
  assert.deepEqual(kinds(blocks), ["table"]);
  const table = at(blocks, 0, "table");
  assert.equal(inlineText(table.header[1]), "length");
  assert.equal(table.align[1], "right");
  assert.equal(table.rows.length, 2);
  assert.equal(inlineText(table.rows[1][0]), "body");
});

test("a paragraph keeps the line breaks the agent wrote", () => {
  const blocks = parseMarkdown("first line\nsecond line");
  assert.deepEqual(kinds(blocks), ["paragraph"]);
  assert.equal(inlineText(at(blocks, 0, "paragraph").content), "first line\nsecond line");
});

test("only a link a browser should follow survives", () => {
  assert.equal(safeHref("https://example.com"), "https://example.com");
  assert.equal(safeHref("/p/abc"), "/p/abc");
  assert.equal(safeHref("javascript:alert(1)"), null);
});
