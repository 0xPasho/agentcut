"use client";

/**
 * A row of frames sampled evenly across what a clip actually shows, so the strip changes with
 * the footage instead of repeating one frame. Sampling is done once per source and range and
 * shared, because timeline clips mount and unmount constantly while editing.
 */
const cache = new Map<string, string[] | null>();
const inFlight = new Map<string, Promise<string[] | null>>();
const key = (src: string, start: number, end: number, count: number) => `${src}|${start.toFixed(2)}|${end.toFixed(2)}|${count}`;

/**
 * Two sources at a time. A timeline full of clips would otherwise open a video element and a
 * run of range requests for every one of them at once, for a strip that is only a reading aid.
 */
let running = 0;
const waiting: (() => void)[] = [];
async function withSlot<T>(work: () => Promise<T>): Promise<T> {
  // A finishing caller hands its slot straight to the next in line rather than releasing it:
  // releasing first leaves a window where a fresh caller takes a slot that is already spoken for.
  if (running >= 2) await new Promise<void>(resolve => waiting.push(resolve));
  else running++;
  try { return await work(); }
  finally {
    const next = waiting.shift();
    if (next) next(); else running--;
  }
}

export const cachedFrames = (src: string, start: number, end: number, count: number) => cache.get(key(src, start, end, count));

/** Resolves when the seek lands, or after a moment, so one stubborn frame cannot stall the strip. */
function seek(video: HTMLVideoElement, time: number) {
  return new Promise<void>(resolve => {
    let done = false;
    const finish = () => { if (done) return; done = true; video.removeEventListener("seeked", finish); resolve(); };
    video.addEventListener("seeked", finish);
    setTimeout(finish, 1500);
    video.currentTime = time;
  });
}

export function loadFrames(src: string, start: number, end: number, count: number): Promise<string[] | null> {
  const id = key(src, start, end, count);
  const ready = cache.get(id);
  if (ready !== undefined) return Promise.resolve(ready);
  const running = inFlight.get(id);
  if (running) return running;
  const work = withSlot(async () => {
    const video = document.createElement("video");
    try {
      video.muted = true; video.playsInline = true; video.preload = "metadata"; video.crossOrigin = "anonymous";
      await new Promise<void>((resolve, reject) => {
        video.addEventListener("loadedmetadata", () => resolve());
        video.addEventListener("error", () => reject(new Error("unreadable")));
        setTimeout(() => reject(new Error("slow")), 8000);
        video.src = src;
      });
      const canvas = document.createElement("canvas");
      canvas.width = 96; canvas.height = 54;
      const context = canvas.getContext("2d");
      if (!context || !video.videoWidth) return null;
      const last = Math.max(0.001, (Number.isFinite(video.duration) ? video.duration : end) - 0.05);
      const frames: string[] = [];
      for (let index = 0; index < count; index++) {
        // Sample inside each slice rather than on its edge: a cut frame is rarely representative.
        const at = start + (end - start) * ((index + 0.5) / count);
        await seek(video, Math.min(Math.max(0.001, at), last));
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        frames.push(canvas.toDataURL("image/jpeg", 0.5));
      }
      return frames;
    } catch {
      return null;
    } finally {
      video.pause(); video.removeAttribute("src"); video.load();
    }
  }).then(result => {
    cache.set(id, result);
    inFlight.delete(id);
    return result;
  });
  inFlight.set(id, work);
  return work;
}
