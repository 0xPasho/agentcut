"use client";
import { useMemo, type ReactNode } from "react";
import { cn } from "cn";
import type { MarkdownBlock, MarkdownInline } from "../types";
import { parseMarkdown, safeHref } from "../lib/markdown";

/**
 * An agent's reply, drawn the way it was written.
 *
 * Every harness answers in Markdown, so the panel used to show its reader the
 * asterisks and the pipes rather than the answer. The marks are small on purpose —
 * a heading here is a line of a chat turn, not a page title — and the whole thing is
 * a fixed set of elements with no HTML passthrough, because a reply quotes a
 * transcript we did not write.
 */

function Inline({ nodes }: { nodes: MarkdownInline[] }) {
  return <>{nodes.map((node, i) => <Piece key={i} node={node} />)}</>;
}

function Piece({ node }: { node: MarkdownInline }) {
  if (node.kind === "text") return <>{node.text}</>;
  if (node.kind === "code") return <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">{node.text}</code>;
  if (node.kind === "strong") return <strong className="font-semibold"><Inline nodes={node.children} /></strong>;
  if (node.kind === "em") return <em className="italic"><Inline nodes={node.children} /></em>;
  if (node.kind === "strike") return <s className="text-muted-foreground"><Inline nodes={node.children} /></s>;
  const href = safeHref(node.href);
  if (!href) return <Inline nodes={node.children} />;
  return (
    <a href={href} target="_blank" rel="noreferrer noopener" className="text-primary underline decoration-primary/40 underline-offset-2 hover:decoration-primary">
      <Inline nodes={node.children} />
    </a>
  );
}

const HEADING_SIZE = ["text-base", "text-sm", "text-sm", "text-sm", "text-sm", "text-sm"];

function Block({ block }: { block: MarkdownBlock }): ReactNode {
  if (block.kind === "paragraph") return <p className="whitespace-pre-wrap"><Inline nodes={block.content} /></p>;
  if (block.kind === "heading") {
    const Tag = `h${Math.min(block.level + 2, 6)}` as "h3";
    return <Tag className={cn("font-semibold text-foreground", HEADING_SIZE[block.level - 1])}><Inline nodes={block.content} /></Tag>;
  }
  if (block.kind === "rule") return <hr className="border-border/60" />;
  if (block.kind === "code") {
    return (
      <pre className="overflow-x-auto rounded-lg border border-border/60 bg-black/30 p-2.5 text-xs">
        <code className="font-mono">{block.text}</code>
      </pre>
    );
  }
  if (block.kind === "quote") {
    return (
      <blockquote className="flex flex-col gap-1.5 border-l-2 border-border pl-2.5 text-muted-foreground">
        <Blocks blocks={block.blocks} />
      </blockquote>
    );
  }
  if (block.kind === "list") {
    const List = block.ordered ? "ol" : "ul";
    return (
      <List
        className={cn("flex flex-col gap-1 ps-5", block.ordered ? "list-decimal" : "list-disc", "marker:text-muted-foreground")}
        {...(block.ordered && block.start !== 1 ? { start: block.start } : {})}
      >
        {block.items.map((item, i) => (
          <li key={i} className="whitespace-pre-wrap">
            <Inline nodes={item.content} />
            {item.blocks.length ? <div className="mt-1 flex flex-col gap-1.5"><Blocks blocks={item.blocks} /></div> : null}
          </li>
        ))}
      </List>
    );
  }
  const align = (i: number) => (block.align[i] === "right" ? "text-right" : block.align[i] === "center" ? "text-center" : "text-left");
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="border-b border-border">
            {block.header.map((cell, i) => (
              <th key={i} className={cn("px-2 py-1 font-medium", align(i))}><Inline nodes={cell} /></th>
            ))}
          </tr>
        </thead>
        <tbody>
          {block.rows.map((row, r) => (
            <tr key={r} className="border-b border-border/40 last:border-0">
              {row.map((cell, i) => <td key={i} className={cn("px-2 py-1 align-top", align(i))}><Inline nodes={cell} /></td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Blocks({ blocks }: { blocks: MarkdownBlock[] }) {
  return <>{blocks.map((block, i) => <Block key={i} block={block} />)}</>;
}

export function Markdown({ text, className }: { text: string; className?: string }) {
  const blocks = useMemo(() => parseMarkdown(text), [text]);
  return <div className={cn("flex flex-col gap-2 break-words", className)}><Blocks blocks={blocks} /></div>;
}
