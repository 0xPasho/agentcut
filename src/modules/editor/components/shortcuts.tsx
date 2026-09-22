"use client";
import { Keyboard } from "lucide-react";
import { Button } from "../../../common/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "../../../common/ui/dialog";
import { GROUPS } from "../data";

export function Shortcuts() {
  return (
    <Dialog>
      <DialogTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Keyboard shortcuts and gestures" title="Keyboard shortcuts and gestures" />}>
        <Keyboard />
      </DialogTrigger>
      <DialogContent className="max-h-[min(700px,calc(100dvh-2rem))] overflow-y-auto sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Shortcuts and gestures</DialogTitle>
          <DialogDescription>Everything here is also available as a button or a menu item.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-5">
          {GROUPS.map(group => (
            <section key={group.title} className="flex flex-col gap-2">
              <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{group.title}</h3>
              <dl className="flex flex-col gap-1.5">
                {group.rows.map(([keys, what]) => (
                  <div key={keys} className="flex items-baseline gap-3 rounded-xl bg-white/4 px-3 py-2">
                    <dt className="w-44 shrink-0 text-[11px] font-medium text-foreground">{keys}</dt>
                    <dd className="text-xs leading-relaxed text-muted-foreground">{what}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
