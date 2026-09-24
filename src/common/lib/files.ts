/**
 * What a file is to this app, by its name. One table for every door — a drop, a file
 * input, the folder browser, the library scan and the agent's imports — so nothing the
 * browser accepts is refused by the server, or the reverse.
 */
export type MediaKind = "video" | "image" | "audio";

const VIDEO = /\.(mp4|mov|mkv|webm|m4v|avi)$/i;
const IMAGE = /\.(png|jpe?g|gif|webp|avif|bmp|svg)$/i;
const AUDIO = /\.(mp3|wav|m4a|aac|ogg|flac|opus)$/i;

/** Video, image or audio, or null when the app does not take the file. */
export function classifyFile(name: string): MediaKind | null {
  if (VIDEO.test(name)) return "video";
  if (IMAGE.test(name)) return "image";
  if (AUDIO.test(name)) return "audio";
  return null;
}
