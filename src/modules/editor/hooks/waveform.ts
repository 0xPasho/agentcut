"use client";

import { type MediaPeaks } from "../types";

/**
 * Peaks for one audio file, normalised to 0..1 and sampled into a fixed number of buckets so
 * the drawing is independent of zoom. Decoding is done once per file and shared: the timeline
 * mounts and unmounts these clips constantly while editing.
 */
const cache = new Map<string, number[] | null>();
/**
 * One context for the document. Decoding needs no fresh context, a browser allows only a
 * handful at once, and a context created per file leaks its audio thread when decoding fails.
 */
let shared: AudioContext | null = null;
function audio(): AudioContext | null {
  if (shared) return shared;
  const Context = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Context) return null;
  shared = new Context();
  return shared;
}
const inFlight = new Map<string, Promise<number[] | null>>();

export const cachedPeaks = (url: string) => cache.get(url);

export function loadPeaks(url: string, buckets = 240): Promise<number[] | null> {
  const ready = cache.get(url);
  if (ready !== undefined) return Promise.resolve(ready);
  const running = inFlight.get(url);
  if (running) return running;
  const work = (async () => {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`${response.status}`);
      const bytes = await response.arrayBuffer();
      const context = audio();
      if (!context) return null;
      const decoded = await context.decodeAudioData(bytes);
      const channel = decoded.getChannelData(0);
      const span = Math.max(1, Math.floor(channel.length / buckets));
      const peaks: number[] = [];
      let loudest = 0;
      // Average energy, not the single loudest sample: mastered music peaks at full scale almost
      // everywhere, and a peak reading would draw it as a solid block with no shape to read.
      for (let bucket = 0; bucket < buckets; bucket++) {
        const start = bucket * span, stop = Math.min(channel.length, start + span);
        let sum = 0;
        for (let index = start; index < stop; index++) sum += channel[index] * channel[index];
        const energy = Math.sqrt(sum / Math.max(1, stop - start));
        peaks.push(energy);
        loudest = Math.max(loudest, energy);
      }
      // A quiet recording should still read as a shape, so the loudest bucket sets the ceiling.
      return loudest > 0 ? peaks.map(peak => peak / loudest) : peaks;
    } catch {
      // An undecodable or missing file keeps its plain block; the waveform is a reading aid.
      return null;
    }
  })().then(result => {
    cache.set(url, result);
    inFlight.delete(url);
    return result;
  });
  inFlight.set(url, work);
  return work;
}
const mediaCache = new Map<string, MediaPeaks | null>();
const mediaInFlight = new Map<string, Promise<MediaPeaks | null>>();
const mediaKey = (projectId: string, mediaId: string) => `${projectId}/${mediaId}`;

export const cachedMediaPeaks = (projectId: string, mediaId: string) => mediaCache.get(mediaKey(projectId, mediaId));

export function loadMediaPeaks(projectId: string, mediaId: string): Promise<MediaPeaks | null> {
  const key = mediaKey(projectId, mediaId);
  const ready = mediaCache.get(key);
  if (ready !== undefined) return Promise.resolve(ready);
  const running = mediaInFlight.get(key);
  if (running) return running;
  const work = (async () => {
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/media/${encodeURIComponent(mediaId)}/peaks`);
      if (!response.ok) return null;
      const data = (await response.json()) as MediaPeaks;
      return data.peaks?.length ? data : null;
    } catch {
      // Silent footage and an unreachable host look the same here, and both mean
      // the clip keeps its plain block. The waveform is a reading aid.
      return null;
    }
  })().then(result => {
    mediaCache.set(key, result);
    mediaInFlight.delete(key);
    return result;
  });
  mediaInFlight.set(key, work);
  return work;
}

/** At most this many points in one drawn shape: an hour of buckets is not a picture. */
export function thinPeaks(peaks: number[], limit = 600): number[] {
  if (peaks.length <= limit) return peaks;
  const span = peaks.length / limit;
  const out: number[] = [];
  for (let i = 0; i < limit; i++) {
    let loudest = 0;
    for (let j = Math.floor(i * span); j < Math.min(peaks.length, Math.floor((i + 1) * span)); j++) loudest = Math.max(loudest, peaks[j]);
    out.push(loudest);
  }
  return out;
}
