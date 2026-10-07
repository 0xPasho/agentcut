import type { MarkdownBlock, MarkdownInline, MarkdownItem } from "../types";

/**
 * The Markdown an agent writes, turned into blocks a component can draw.
 *
 * Every harness answers in Markdown, so a chat that prints the text raw shows its
 * reader `**the headline**` and a wall of dashes instead of a list. This is the
 * common subset those replies actually use — headings, lists, fences, quotes,
 * tables, links and the inline marks — parsed into plain values, which is why it is
 * here in `lib` and tested like any other pure function rather than pulled in as a
 * renderer with a plugin tree behind it.
 *
 * It is deliberately not a CommonMark implementation. Anything it does not
 * recognise stays as the text that was written, which is the right failure: the
 * reader sees the sentence, never a blank.
 */

const ESCAPABLE = /[\\`*_~[\]()#+\-.!>|]/;
const BULLET = /^(\s*)([-*+]|\d{1,9}[.)])[ \t]+(.*)$/;
const FENCE = /^\s{0,3}(`{3,}|~{3,})[ \t]*(\S*)[ \t]*$/;
const HEADING = /^\s{0,3}(#{1,6})[ \t]+(.*?)[ \t]*#*\s*$/;
const RULE = /^\s{0,3}([-*_])[ \t]*(?:\1[ \t]*){2,}$/;
const QUOTE = /^\s{0,3}>[ \t]?(.*)$/;
const DIVIDER = /^\s*\|?[ \t]*:?-{1,}:?[ \t]*(\|[ \t]*:?-{1,}:?[ \t]*)+\|?\s*$/;

const text = (value: string): MarkdownInline => ({ kind: "text", text: value });

/** `**bold**`, `` `code` ``, `[a link](…)` and the rest, left to right. */
export function parseInline(source: string): MarkdownInline[] {
  const out: MarkdownInline[] = [];
  let plain = "";
  const flush = () => { if (plain) { out.push(text(plain)); plain = ""; } };
  const push = (node: MarkdownInline) => { flush(); out.push(node); };

  let i = 0;
  while (i < source.length) {
    const rest = source.slice(i);
    const before = i === 0 ? "" : source[i - 1];

    if (rest[0] === "\\" && rest[1] && ESCAPABLE.test(rest[1])) { plain += rest[1]; i += 2; continue; }

    // Code first and always: inside a span nothing else is a mark.
    const code = /^(`+)([^`]|[\s\S]*?[^`])\1(?!`)/.exec(rest);
    if (code) { push({ kind: "code", text: code[2].replace(/^ | $/g, "") }); i += code[0].length; continue; }

    const link = /^\[([^\]]*)\]\(\s*<?([^\s<>]*)>?(?:\s+"[^"]*")?\s*\)/.exec(rest);
    if (link && link[2]) { push({ kind: "link", href: link[2], children: parseInline(link[1]) }); i += link[0].length; continue; }

    const strong = /^(\*\*|__)(?=\S)([\s\S]*?\S)\1/.exec(rest);
    if (strong && (strong[1] === "**" || !/\w/.test(before))) { push({ kind: "strong", children: parseInline(strong[2]) }); i += strong[0].length; continue; }

    const strike = /^~~(?=\S)([\s\S]*?\S)~~/.exec(rest);
    if (strike) { push({ kind: "strike", children: parseInline(strike[1]) }); i += strike[0].length; continue; }

    // `_` only opens a mark at a word boundary, or snake_case_names come out italic.
    const em = /^(\*|_)(?=\S)([\s\S]*?\S)\1/.exec(rest);
    if (em && (em[1] === "*" || !/\w/.test(before))) { push({ kind: "em", children: parseInline(em[2]) }); i += em[0].length; continue; }

    const bare = /^<?(https?:\/\/[^\s<>]+[^\s<>.,;:!?)\]])>?/.exec(rest);
    if (bare) { push({ kind: "link", href: bare[1], children: [text(bare[1])] }); i += bare[0].length; continue; }

    plain += rest[0];
    i += 1;
  }
  flush();
  return out;
}

/** The plain words of a parsed run — for a title, or a line that has no room for marks. */
export function inlineText(nodes: MarkdownInline[]): string {
  return nodes.map((n) => (n.kind === "text" || n.kind === "code" ? n.text : inlineText(n.children))).join("");
}

const isBlockStart = (line: string) =>
  !line.trim() || FENCE.test(line) || HEADING.test(line) || RULE.test(line) || QUOTE.test(line) || BULLET.test(line);

const cells = (line: string) =>
  line.trim().replace(/^\|/, "").replace(/\|$/, "").split(/(?<!\\)\|/).map((c) => parseInline(c.trim()));

function alignments(line: string) {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => {
    const spec = c.trim();
    if (spec.startsWith(":") && spec.endsWith(":")) return "center" as const;
    if (spec.endsWith(":")) return "right" as const;
    if (spec.startsWith(":")) return "left" as const;
    return null;
  });
}

/** How far in a line sits, tabs counted as four so an agent's mixed indentation still nests. */
const indentOf = (line: string) => (/^[ \t]*/.exec(line)?.[0] ?? "").replace(/\t/g, "    ").length;

function parseBlocks(lines: string[]): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i += 1; continue; }

    const fence = FENCE.exec(line);
    if (fence) {
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !new RegExp(`^\\s{0,3}${fence[1][0]}{${fence[1].length},}\\s*$`).test(lines[i])) body.push(lines[i++]);
      i += 1; // the closing fence, or the end of the text
      blocks.push({ kind: "code", language: fence[2] || null, text: body.join("\n") });
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) { blocks.push({ kind: "heading", level: heading[1].length, content: parseInline(heading[2]) }); i += 1; continue; }

    if (RULE.test(line)) { blocks.push({ kind: "rule" }); i += 1; continue; }

    if (QUOTE.test(line)) {
      const body: string[] = [];
      while (i < lines.length && (QUOTE.test(lines[i]) || (body.length && lines[i].trim() && !isBlockStart(lines[i])))) {
        body.push(QUOTE.exec(lines[i])?.[1] ?? lines[i].trim());
        i += 1;
      }
      blocks.push({ kind: "quote", blocks: parseBlocks(body) });
      continue;
    }

    if (line.includes("|") && lines[i + 1] && DIVIDER.test(lines[i + 1])) {
      const header = cells(line);
      const align = alignments(lines[i + 1]);
      const rows: MarkdownInline[][][] = [];
      i += 2;
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) rows.push(cells(lines[i++]));
      blocks.push({ kind: "table", header, align, rows });
      continue;
    }

    const bullet = BULLET.exec(line);
    if (bullet) {
      const base = indentOf(line);
      const ordered = /\d/.test(bullet[2]);
      const start = ordered ? Number.parseInt(bullet[2], 10) : 1;
      const items: MarkdownItem[] = [];
      while (i < lines.length) {
        const head = BULLET.exec(lines[i]);
        // A list ends at a blank line followed by anything that is not another of its items.
        if (!head) {
          if (lines[i].trim() || !lines[i + 1] || !BULLET.test(lines[i + 1]) || indentOf(lines[i + 1]) < base) break;
          i += 1;
          continue;
        }
        if (indentOf(lines[i]) < base) break;
        if (indentOf(lines[i]) > base) {
          // Deeper than this list: it belongs to the bullet above, which owns it below.
          break;
        }
        if (ordered !== /\d/.test(head[2])) break;
        const own: string[] = [];
        i += 1;
        while (i < lines.length) {
          const next = lines[i];
          if (!next.trim()) {
            if (lines[i + 1] && indentOf(lines[i + 1]) > base && lines[i + 1].trim()) { own.push(""); i += 1; continue; }
            break;
          }
          if (indentOf(next) <= base && BULLET.test(next)) break;
          if (indentOf(next) <= base && isBlockStart(next)) break;
          own.push(next.slice(Math.min(indentOf(next), base + head[2].length + 1)));
          i += 1;
        }
        items.push({ content: parseInline(head[3]), blocks: own.some((l) => l.trim()) ? parseBlocks(own) : [] });
      }
      blocks.push({ kind: "list", ordered, start, items });
      continue;
    }

    const paragraph: string[] = [line];
    i += 1;
    while (i < lines.length && lines[i].trim() && !isBlockStart(lines[i])) paragraph.push(lines[i++]);
    blocks.push({ kind: "paragraph", content: parseInline(paragraph.join("\n").trim()) });
  }

  return blocks;
}

export function parseMarkdown(source: string): MarkdownBlock[] {
  return parseBlocks(source.replace(/\r\n?/g, "\n").split("\n"));
}

/** Only what a browser will follow, so an agent's reply cannot smuggle in a script. */
export function safeHref(href: string): string | null {
  const url = href.trim();
  if (/^(https?:|mailto:|#|\/)/i.test(url)) return url;
  return null;
}
