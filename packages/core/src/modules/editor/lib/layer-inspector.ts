import { type SequenceItem, DEFAULT_ITEM_TRANSFORM } from "../types";

export const placement = (item: SequenceItem) => ({ at:item.at ?? null, layer:item.layer ?? 0, transform:{...DEFAULT_ITEM_TRANSFORM,...item.transform}, volume:item.volume ?? 1, muted:item.muted ?? false, hidden:item.hidden ?? false });
