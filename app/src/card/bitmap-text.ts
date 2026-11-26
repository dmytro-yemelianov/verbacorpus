import type { Glyph, GlyphSet } from "./glyphs";

export { fetchGlyphs, CardFontError } from "./glyphs";
export type { GlyphSet } from "./glyphs";

export interface TextLayout {
  scale: number;
  lines: string[];
  truncated: boolean;
  lineGap: number; // unscaled, carried so paintText spaces lines identically
}

export interface LayoutOpts {
  maxScale: number;
  minScale: 2;
  lineGap: number; // unscaled font pixels between lines (multiplied by scale)
}

const glyphOf = (g: GlyphSet, ch: string): Glyph => g.glyphs.get(ch) ?? g.fallback;

function widthOf(s: string, g: GlyphSet, scale: number): number {
  let w = 0;
  for (const ch of Array.from(s)) w += glyphOf(g, ch).advanceX * scale;
  return w;
}

function wrap(text: string, g: GlyphSet, scale: number, maxW: number): string[] {
  const lines: string[] = [];
  for (const para of text.split(/\r?\n/)) {
    let cur = "";
    for (const word of para.split(/ +/).filter(Boolean)) {
      const cand = cur ? `${cur} ${word}` : word;
      if (widthOf(cand, g, scale) <= maxW) { cur = cand; continue; }
      if (cur) { lines.push(cur); cur = ""; }
      if (widthOf(word, g, scale) <= maxW) { cur = word; continue; }
      // Single word wider than a line: break by characters.
      for (const ch of Array.from(word)) {
        if (cur && widthOf(cur + ch, g, scale) > maxW) { lines.push(cur); cur = ""; }
        cur += ch;
      }
    }
    if (cur || !para) lines.push(cur);
  }
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

export function layoutText(text: string, g: GlyphSet, box: { width: number; height: number }, opts: LayoutOpts): TextLayout {
  if (!text.trim()) return { scale: Math.max(opts.minScale, 1), lines: [], truncated: false, lineGap: opts.lineGap };
  const rowH = (s: number) => g.cell.height * s + opts.lineGap * s;
  const maxLines = (s: number) => Math.floor((box.height + opts.lineGap * s) / rowH(s));
  for (let scale = Math.max(opts.maxScale, opts.minScale); scale >= opts.minScale; scale--) {
    const lines = wrap(text, g, scale, box.width);
    if (lines.length <= maxLines(scale)) return { scale, lines, truncated: false, lineGap: opts.lineGap };
  }
  const scale = opts.minScale;
  const keep = Math.max(0, maxLines(scale));
  const lines = wrap(text, g, scale, box.width).slice(0, keep);
  if (!lines.length) return { scale, lines, truncated: true, lineGap: opts.lineGap };
  let last = Array.from(lines[lines.length - 1]);
  while (last.length && widthOf(last.join("").trimEnd() + "…", g, scale) > box.width) last.pop();
  lines[lines.length - 1] = last.join("").trimEnd() + "…";
  return { scale, lines, truncated: true, lineGap: opts.lineGap };
}

/**
 * Paints opaque RGBA pixels. origin.y is the top of the first line; origin.x is the
 * left edge of each line for "left", or the horizontal centre for "center".
 */
export function paintText(
  rgba: Uint8Array, W: number, H: number, layout: TextLayout, g: GlyphSet,
  origin: { x: number; y: number }, align: "left" | "center", rgb: [number, number, number],
): void {
  const { scale } = layout;
  const rowH = g.cell.height * scale + layout.lineGap * scale;
  layout.lines.forEach((line, li) => {
    let x = align === "center" ? Math.round(origin.x - widthOf(line, g, scale) / 2) : origin.x;
    const y0 = origin.y + li * rowH;
    for (const ch of Array.from(line)) {
      const gl = glyphOf(g, ch);
      gl.rows.forEach((row, r) => {
        for (let c = 0; c < row.length; c++) {
          if (row[c] !== "1") continue;
          for (let dy = 0; dy < scale; dy++) {
            const py = y0 + r * scale + dy;
            if (py < 0 || py >= H) continue;
            for (let dx = 0; dx < scale; dx++) {
              const px = x + c * scale + dx;
              if (px < 0 || px >= W) continue;
              const i = (py * W + px) * 4;
              rgba[i] = rgb[0]; rgba[i + 1] = rgb[1]; rgba[i + 2] = rgb[2]; rgba[i + 3] = 255;
            }
          }
        }
      });
      x += gl.advanceX * scale;
    }
  });
}
