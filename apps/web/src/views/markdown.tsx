import type { JSX } from "hono/jsx/jsx-runtime";
/**
 * A minimal Markdown reader for a pack's STYLE.md: headings, paragraphs, lists, quotes,
 * fenced code and a few inline marks. It builds JSX, never HTML strings, so everything a
 * pack says is escaped by the renderer; raw HTML in the file shows as text.
 */
type Inline = JSX.Element | string;

function inline(text: string): Inline[] {
  const out: Inline[] = [];
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\s][^*]*\*)|(_[^_\s][^_]*_)|(\[[^\]]+\]\([^)\s]+\))/g;
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0];
    if (m[1]) out.push(<code class="rounded-md bg-white/8 px-1.5 py-0.5 font-mono text-[0.85em] text-foreground">{t.slice(1, -1)}</code>);
    else if (m[2]) out.push(<strong class="font-semibold text-foreground">{inline(t.slice(2, -2))}</strong>);
    else if (m[3] || m[4]) out.push(<em>{inline(t.slice(1, -1))}</em>);
    else {
      const [, label, href] = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(t)!;
      if (/^https?:\/\//i.test(href)) {
        out.push(<a href={href} rel="nofollow noopener noreferrer" class="text-foreground underline decoration-white/30 underline-offset-4 hover:decoration-foreground">{label}</a>);
      } else {
        out.push(label);
      }
    }
    last = m.index + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

type Block =
  | { kind: "h"; level: number; text: string }
  | { kind: "p"; text: string }
  | { kind: "ul" | "ol"; items: string[] }
  | { kind: "quote"; text: string }
  | { kind: "code"; text: string }
  | { kind: "hr" };

function blocks(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const out: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    if (/^```/.test(line)) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) body.push(lines[i++]);
      i++;
      out.push({ kind: "code", text: body.join("\n") });
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) { out.push({ kind: "h", level: h[1].length, text: h[2].trim() }); i++; continue; }
    if (/^(-{3,}|\*{3,})\s*$/.test(line)) { out.push({ kind: "hr" }); i++; continue; }
    if (/^>\s?/.test(line)) {
      const body: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) body.push(lines[i++].replace(/^>\s?/, ""));
      out.push({ kind: "quote", text: body.join(" ") });
      continue;
    }
    const listRe = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
    const lm = listRe.exec(line);
    if (lm) {
      const ordered = /\d/.test(lm[2]);
      const items: string[] = [];
      while (i < lines.length) {
        const m = listRe.exec(lines[i]);
        if (m && /\d/.test(m[2]) === ordered && m[1].length < 2) { items.push(m[3]); i++; continue; }
        if (lines[i].trim() && /^\s{2,}/.test(lines[i]) && items.length) { items[items.length - 1] += ` ${lines[i].trim()}`; i++; continue; }
        break;
      }
      out.push({ kind: ordered ? "ol" : "ul", items });
      continue;
    }
    const body: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|```|>\s?)/.test(lines[i]) && !listRe.test(lines[i])) body.push(lines[i++].trim());
    out.push({ kind: "p", text: body.join(" ") });
  }
  return out;
}

export function Markdown({ source }: { source: string }) {
  return (
    <div class="space-y-4 text-[0.95rem] leading-relaxed text-muted-foreground">
      {blocks(source).map((b) => {
        switch (b.kind) {
          case "h":
            if (b.level === 1) return <h3 class="pt-2 text-xl font-semibold tracking-[-0.01em] text-foreground text-balance">{inline(b.text)}</h3>;
            if (b.level === 2) return <h4 class="pt-3 text-base font-semibold text-foreground text-balance">{inline(b.text)}</h4>;
            return <h5 class="pt-2 text-sm font-semibold text-foreground">{inline(b.text)}</h5>;
          case "p":
            return <p class="text-pretty">{inline(b.text)}</p>;
          case "ul":
            return <ul class="list-disc space-y-1.5 pl-5 marker:text-white/30">{b.items.map((it) => <li class="pl-1 text-pretty">{inline(it)}</li>)}</ul>;
          case "ol":
            return <ol class="list-decimal space-y-1.5 pl-5 marker:text-white/40 marker:tabular-nums">{b.items.map((it) => <li class="pl-1 text-pretty">{inline(it)}</li>)}</ol>;
          case "quote":
            return <blockquote class="border-l-2 border-white/15 pl-4 italic">{inline(b.text)}</blockquote>;
          case "code":
            return <pre class="overflow-x-auto rounded-2xl bg-black/40 p-4 font-mono text-[0.8rem] leading-relaxed text-foreground/90">{b.text}</pre>;
          case "hr":
            return <hr class="border-white/10" />;
        }
      })}
    </div>
  );
}
