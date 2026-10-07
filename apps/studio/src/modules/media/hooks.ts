import { useState, useEffect, useRef, useCallback } from "react";
import { api, type AssetSummary } from "@agentcut/core/common/api/client";
import { LIBRARY_KINDS } from "@agentcut/core/modules/media/data";

/** Load one library snapshot, so switching filters cannot show another kind's response. */
export function useLibraryAssets() {
  const [assets, setAssets] = useState<AssetSummary[] | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const request = useRef(0);
  const reload = useCallback(async () => {
    const version = ++request.current;
    setLoading(true);
    setError("");
    try {
      const results = await Promise.all(LIBRARY_KINDS.map(({ kind }) => api.listAssets(kind, "")));
      if (version === request.current) setAssets(results.flatMap((result) => result.assets));
    } catch (e) {
      if (version === request.current) setError((e as Error).message);
    } finally {
      if (version === request.current) setLoading(false);
    }
  }, []);
  useEffect(() => { void reload(); return () => { request.current++; }; }, [reload]);
  return { assets, setAssets, error, loading, reload };
}

/** Listen before placing. One element for the whole panel: two sounds at once tell you nothing. */
export function useAudition() {
  const [playing, setPlaying] = useState<HTMLAudioElement | null>(null);
  useEffect(() => () => playing?.pause(), [playing]);
  return (url: string) => {
    playing?.pause();
    const element = new Audio(url);
    setPlaying(element);
    void element.play().catch(() => {});
  };
}

/** A preview owns its transport. Unmounting the dialog stops playback. */
export function useLibraryPlayback() {
  const media = useRef<HTMLMediaElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState("");
  const toggle = async () => {
    const element = media.current;
    if (!element) return;
    if (!element.paused) { element.pause(); return; }
    try { await element.play(); setError(""); }
    catch { setError("This file could not play. Try opening the original file."); }
  };
  const seek = (value: number | readonly number[]) => {
    const time = typeof value === "number" ? value : value[0];
    if (!media.current || !Number.isFinite(time)) return;
    media.current.currentTime = time;
    setPosition(time);
  };
  const toggleMute = () => {
    if (!media.current) return;
    media.current.muted = !media.current.muted;
    setMuted(media.current.muted);
  };
  return { media, playing, setPlaying, position, setPosition, duration, setDuration, muted, error, setError, toggle, seek, toggleMute };
}
