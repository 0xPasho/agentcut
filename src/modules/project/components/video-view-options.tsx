"use client";

import { useId } from "react";
import { LayoutGrid, List, Settings2 } from "lucide-react";
import { Button } from "../../../common/ui/button";
import { Label } from "../../../common/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "../../../common/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../../common/ui/select";
import { SORTS, type VideoSort } from "../lib/overview";
import type { VideoLayout } from "../types";

type VideoViewOptionsProps = {
  layout: VideoLayout;
  sort: VideoSort;
  onLayout: (layout: VideoLayout) => void;
  onSort: (sort: VideoSort) => void;
};

export function VideoViewOptions(props: VideoViewOptionsProps) {
  return <>
    <div className="hidden @min-[32rem]:block"><ViewControls {...props} compact /></div>
    <Popover>
      <PopoverTrigger render={<Button size="icon" variant="ghost" aria-label="View options" title="View options" className="@min-[32rem]:hidden"><Settings2 aria-hidden className="size-4" /></Button>} />
      <PopoverContent align="end" side="bottom" positionMethod="fixed" className="w-60">
        <ViewControls {...props} compact={false} />
      </PopoverContent>
    </Popover>
  </>;
}

function ViewControls({ layout, sort, onLayout, onSort, compact }: VideoViewOptionsProps & { compact: boolean }) {
  const sortId = useId();
  return <div className={compact ? "flex items-center gap-2" : "flex flex-col gap-3"}>
    <Label id={sortId} className={compact ? "sr-only" : "text-xs text-muted-foreground"}>Sort videos</Label>
    <Select value={sort} onValueChange={value => { if (value) onSort(value as VideoSort); }}>
      <SelectTrigger aria-labelledby={sortId} className="h-9 rounded-full border-transparent bg-white/5 px-3 text-xs shadow-none">
        <SelectValue>{value => SORTS.find(option => option.value === value)?.label}</SelectValue>
      </SelectTrigger>
      <SelectContent align="end" alignItemWithTrigger={false}>
        {SORTS.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
      </SelectContent>
    </Select>
    <div role="group" aria-label="Video layout" className="flex w-fit items-center rounded-full bg-black/15 p-0.5">
      <Button size={compact ? "icon" : "sm"} className="min-h-9" variant={layout === "list" ? "secondary" : "ghost"} aria-label="List view" title="List view" aria-pressed={layout === "list"} onClick={() => onLayout("list")}>
        <List aria-hidden className="size-4" /><span className={compact ? "sr-only" : undefined}>List</span>
      </Button>
      <Button size={compact ? "icon" : "sm"} className="min-h-9" variant={layout === "grid" ? "secondary" : "ghost"} aria-label="Grid view" title="Grid view" aria-pressed={layout === "grid"} onClick={() => onLayout("grid")}>
        <LayoutGrid aria-hidden className="size-4" /><span className={compact ? "sr-only" : undefined}>Grid</span>
      </Button>
    </div>
  </div>;
}
