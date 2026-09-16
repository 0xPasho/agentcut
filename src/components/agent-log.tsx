"use client";

import { useEffect, useRef } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { LogEvent } from "@/lib/client";

const STYLES: Record<string, string> = {
  tool: "text-muted-foreground",
  text: "text-foreground",
  stage: "text-primary font-medium",
  error: "text-destructive",
  result: "text-foreground",
  log: "text-muted-foreground/70",
};

export function AgentLog({ events }: { events: LogEvent[] }) {
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [events.length]);

  if (!events.length) {
    return (
      <p className="px-3 py-6 text-center text-xs text-muted-foreground">
        The agent&apos;s tool calls and reasoning will stream here.
      </p>
    );
  }

  return (
    <ScrollArea className="h-64">
      <div className="flex flex-col gap-1 p-3 font-mono text-xs">
        {events.map((e) => (
          <div key={e.id} className="flex gap-2 leading-relaxed">
            {e.name ? (
              <span className="shrink-0 rounded bg-muted px-1.5 text-[10px] leading-5 text-muted-foreground">
                {e.name}
              </span>
            ) : null}
            <span className={`min-w-0 break-words whitespace-pre-wrap ${STYLES[e.kind] ?? ""}`}>
              {e.text}
            </span>
          </div>
        ))}
        <div ref={bottom} />
      </div>
    </ScrollArea>
  );
}
