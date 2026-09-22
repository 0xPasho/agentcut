"use client";
import { Keyboard } from "lucide-react";
import { Button } from "../../../common/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "../../../common/ui/dialog";

/** Every gesture the timeline understands, in one place, so none of them has to be guessed. */
const GROUPS: { title: string; rows: [string, string][] }[] = [
  { title: "Editing", rows: [
    ["S", "Split the selected clip at the playhead"],
    ["D", "Duplicate the selected clip"],
    ["Delete", "Remove the focused clip and close its gap"],
    ["Cmd / Ctrl + C", "Copy the selected clip"],
    ["Cmd / Ctrl + V", "Paste it at the playhead"],
    ["Cmd / Ctrl + Z", "Undo"],
    ["Shift + Cmd / Ctrl + Z", "Redo"],
  ] },
  { title: "Dragging", rows: [
    ["Drag a clip", "Move it along its track or onto another one"],
    ["Drag a clip edge", "Trim it; main-track trims ripple the clips after it"],
    ["Alt + drag onto Main", "Insert between clips and close the gap"],
    ["Cmd / Ctrl while dragging", "Bypass snapping for this drag"],
    ["Right-click a clip", "Split, duplicate, mute, hide or remove it"],
    ["Shift / Cmd + click", "Add a clip to the selection; drag one to move them all"],
  ] },
  { title: "Adding media", rows: [
    ["Drag onto a track", "Place an asset, a folder file, an online image or a desktop file"],
    ["Drop on a clip's middle", "Replace that clip's media, keeping its place"],
    ["Drop on the preview", "Place it where you dropped it in the frame"],
    ["Drop on the asset panel", "Import it into the project without placing it"],
  ] },
  { title: "Playback", rows: [
    ["Space or K", "Play or pause"],
    [", and .", "Step one frame back or forward"],
    ["Up / Down", "Jump to the previous or next cut"],
    ["Home / End", "Jump to the start or the end"],
  ] },
  { title: "Moving around", rows: [
    ["Cmd / Ctrl + wheel", "Zoom the timeline around the pointer"],
    ["Pinch on a trackpad", "The same zoom"],
    ["Shift + wheel", "Scroll the timeline sideways"],
    ["Drag past an edge", "Scrolls while you keep dragging"],
  ] },
  { title: "Keyboard on a clip", rows: [
    ["Arrow keys", "Nudge one frame; Shift nudges one second"],
    ["Alt + arrows on Main", "Reorder it among the main clips"],
    ["Arrows on an edge", "Trim one frame at a time"],
  ] },
];

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
