// Just enough of a TrueType reader to lay a line out by hand: the advance of each
// character and the cap height. ffmpeg's drawtext has no letter spacing, so a tracked
// title is drawn one character at a time at positions computed here.
import fs from "node:fs";
import path from "node:path";

export function loadFont(file) {
  const buf = fs.readFileSync(file);
  const tables = {};
  const count = buf.readUInt16BE(4);
  for (let i = 0; i < count; i++) {
    const at = 12 + i * 16;
    tables[buf.toString("ascii", at, at + 4)] = { offset: buf.readUInt32BE(at + 8), length: buf.readUInt32BE(at + 12) };
  }
  const need = (tag) => { if (!tables[tag]) throw new Error(`${path.basename(file)} has no ${tag} table`); return tables[tag].offset; };
  const unitsPerEm = buf.readUInt16BE(need("head") + 18);
  const metrics = buf.readUInt16BE(need("hhea") + 34);
  const hmtx = need("hmtx");
  const advance = (glyph) => buf.readUInt16BE(hmtx + 4 * Math.min(glyph, metrics - 1));
  let capHeight = 0.7 * unitsPerEm;
  if (tables["OS/2"]) {
    const os2 = tables["OS/2"].offset;
    if (buf.readUInt16BE(os2) >= 2) capHeight = buf.readInt16BE(os2 + 88) || capHeight;
  }
  const glyphOf = cmap(buf, need("cmap"));
  return {
    file,
    /** Width of `text` at `size` px with `tracking` px between characters. */
    measure(text, size, tracking = 0) {
      return [...text].reduce((sum, ch, i) => sum + (advance(glyphOf(ch.codePointAt(0))) * size) / unitsPerEm + (i ? tracking : 0), 0);
    },
    /** The x of each character, starting at `x`. */
    positions(text, size, x, tracking = 0) {
      const out = [];
      for (const ch of text) { out.push({ ch, x }); x += (advance(glyphOf(ch.codePointAt(0))) * size) / unitsPerEm + tracking; }
      return out;
    },
    capHeight: (size) => (capHeight * size) / unitsPerEm,
  };
}

/** Character to glyph, from a format 4 (BMP) or format 12 (full) cmap subtable. */
function cmap(buf, at) {
  const count = buf.readUInt16BE(at + 2);
  let best = null;
  for (let i = 0; i < count; i++) {
    const rec = at + 4 + i * 8;
    const platform = buf.readUInt16BE(rec), encoding = buf.readUInt16BE(rec + 2), sub = at + buf.readUInt32BE(rec + 4);
    const format = buf.readUInt16BE(sub);
    if ((platform === 3 && (encoding === 1 || encoding === 10)) || platform === 0) {
      if (format === 12) { best = { format, sub }; break; }
      if (format === 4 && !best) best = { format, sub };
    }
  }
  if (!best) throw new Error("No Unicode cmap in this font");
  const { format, sub } = best;
  if (format === 12) {
    const groups = buf.readUInt32BE(sub + 12);
    return (code) => {
      for (let g = 0; g < groups; g++) {
        const at = sub + 16 + g * 12;
        const start = buf.readUInt32BE(at), end = buf.readUInt32BE(at + 4);
        if (code >= start && code <= end) return buf.readUInt32BE(at + 8) + (code - start);
      }
      return 0;
    };
  }
  const segs = buf.readUInt16BE(sub + 6) / 2;
  const ends = sub + 14, starts = ends + segs * 2 + 2, deltas = starts + segs * 2, ranges = deltas + segs * 2;
  return (code) => {
    for (let s = 0; s < segs; s++) {
      if (code > buf.readUInt16BE(ends + s * 2)) continue;
      const start = buf.readUInt16BE(starts + s * 2);
      if (code < start) return 0;
      const delta = buf.readInt16BE(deltas + s * 2), range = buf.readUInt16BE(ranges + s * 2);
      if (!range) return (code + delta) & 0xffff;
      const glyph = buf.readUInt16BE(ranges + s * 2 + range + (code - start) * 2);
      return glyph ? (glyph + delta) & 0xffff : 0;
    }
    return 0;
  };
}
