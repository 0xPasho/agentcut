"use client";

import { useState } from "react";

/** Only visible, still-existing IDs can be acted on. Sort and layout never own selection. */
export function useVideoSelection(visibleIds: string[]) {
  const [checked, setChecked] = useState<string[]>([]);
  const ids = checked.filter(id => visibleIds.includes(id));
  const toggle = (id: string) => setChecked(current => {
    const live = current.filter(value => visibleIds.includes(value));
    return live.includes(id) ? live.filter(value => value !== id) : [...live, id];
  });
  return {
    ids,
    toggle,
    clear: () => setChecked([]),
    all: visibleIds.length > 0 && ids.length === visibleIds.length,
    selectAll: () => setChecked([...visibleIds]),
  };
}
