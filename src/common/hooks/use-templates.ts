"use client";

import { useEffect, useState } from "react";
import type { TemplateSummary } from "@/modules/templates/types";

/**
 * Every template on this machine, for a screen that has to offer them before a project
 * exists. Two screens ask now — the home box and the analyse form — and both need the
 * same thing, including what each template makes, so a form can ask for a clip count or
 * a running time rather than assuming one.
 */
export function useTemplates(): { templates: TemplateSummary[]; loaded: boolean } {
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let live = true;
    fetch("/api/templates")
      .then(r => r.json())
      .then(d => { if (live) setTemplates(d.templates ?? []); })
      .catch(() => { if (live) setTemplates([]); })
      .finally(() => { if (live) setLoaded(true); });
    return () => { live = false; };
  }, []);
  return { templates, loaded };
}
