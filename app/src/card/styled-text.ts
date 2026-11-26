// Styled bitmap text layout and painting for the 8 card styles and 5 alignments.
import type { Glyph, GlyphSet } from "./glyphs";
import type { CardAlign, CardStyle } from "./recipe";
import { UPA_PALETTE } from "./ornament";
import { INK, PAPER } from "../card-gif";

export interface TextToken {
  w: string;
  h: boolean;
}

export interface StyledLine {
  tokens: TextToken[];
  scale: number;
  lineGap: number;
}

type RGB = [number, number, number];

const glyphOf = (g: GlyphSet, ch: string): Glyph => g.glyphs.get(ch) ?? g.fallback;

export function wordWidth(s: string, g: GlyphSet, scale: number): number {
  let w = 0;
  for (const ch of Array.from(s)) w += glyphOf(g, ch).advanceX * scale;
  return w;
}

const lineWidth = (tokens: TextToken[], g: GlyphSet, scale: number): number => {
  const sp = glyphOf(g, " ").advanceX * scale;
  return tokens.reduce((acc, t, i) => acc + wordWidth(t.w, g, scale) + (i > 0 ? sp : 0), 0);
};

/**
 * Prepares text for card rendering: strips trailing period, keeps em-dash attached to the
 * preceding word via NBSP, and splits into tokens with punctuation glued to the word.
 */
export function tokenizeStyled(rawText: string, hook: string | null): TextToken[] {
  const text = rawText.replace(/\.\s*$/, "").replace(/ — /g, "\u00A0— ");
  const out: TextToken[] = [];
  const push = (seg: string, h: boolean) => {
    for (const part of seg.split(/ +/).filter(Boolean)) {
      if (/^[.,!?;:…»)]+$/.test(part) && out.length) {
        out[out.length - 1]!.w += part;
      } else {
        out.push({ w: part, h });
      }
    }
  };
  const cleanHook = hook ? hook.replace(/ — /g, "\u00A0— ") : "";
  const idx = cleanHook ? text.indexOf(cleanHook) : -1;
  if (idx < 0) {
    push(text, false);
    return out;
  }
  push(text.slice(0, idx), false);
  push(cleanHook, true);
  push(text.slice(idx + cleanHook.length), false);
  return out;
}

function wrapTokens(tokens: TextToken[], g: GlyphSet, scale: number, maxW: number): TextToken[][] {
  const lines: TextToken[][] = [];
  let cur: TextToken[] = [];
  let cw = 0;
  const sp = glyphOf(g, " ").advanceX * scale;
  for (const t of tokens) {
    const ww = wordWidth(t.w, g, scale);
    if (cur.length && cw + sp + ww > maxW) {
      lines.push(cur);
      cur = [];
      cw = 0;
    }
    cw += (cur.length ? sp : 0) + ww;
    cur.push(t);
  }
  if (cur.length) lines.push(cur);
  return lines;
}

export function layoutStyled(
  tokens: TextToken[],
  g: GlyphSet,
  box: { width: number; height: number },
  style: CardStyle,
  opts: { maxScale: number; minScale: number; lineGap: number },
): StyledLine[] {
  if (!tokens.length) return [];
  const hasHook = tokens.some((t) => t.h);
  const big = style === "big" && hasHook;
  for (let s = Math.max(opts.maxScale, opts.minScale); s >= opts.minScale; s--) {
    const hs = big ? Math.max(s + 1, Math.round(s * 1.6)) : s;
    const lines: StyledLine[] = big
      ? [
          ...wrapTokens(tokens.filter((t) => !t.h), g, s, box.width).map((toks) => ({ tokens: toks, scale: s, lineGap: opts.lineGap })),
          ...wrapTokens(tokens.filter((t) => t.h), g, hs, box.width).map((toks) => ({ tokens: toks, scale: hs, lineGap: opts.lineGap })),
        ]
      : wrapTokens(tokens, g, s, box.width).map((toks) => ({ tokens: toks, scale: s, lineGap: opts.lineGap }));
    const totalH = lines.reduce((acc, l) => acc + (g.cell.height + l.lineGap) * l.scale, 0);
    const fitsW = lines.every((l) => lineWidth(l.tokens, g, l.scale) <= box.width);
    if (totalH <= box.height && fitsW) return lines;
  }
  const s = opts.minScale;
  return wrapTokens(tokens, g, s, box.width).map((toks) => ({ tokens: toks, scale: s, lineGap: opts.lineGap }));
}

function setPx(rgba: Uint8Array, W: number, H: number, x: number, y: number, rgb: RGB): void {
  if (x < 0 || x >= W || y < 0 || y >= H) return;
  const i = (y * W + x) * 4;
  rgba[i] = rgb[0]; rgba[i + 1] = rgb[1]; rgba[i + 2] = rgb[2]; rgba[i + 3] = 255;
}

function fillBox(rgba: Uint8Array, W: number, H: number, x0: number, y0: number, w: number, h: number, rgb: RGB): void {
  for (let y = Math.max(0, y0); y < Math.min(H, y0 + h); y++) {
    for (let x = Math.max(0, x0); x < Math.min(W, x0 + w); x++) {
      setPx(rgba, W, H, x, y, rgb);
    }
  }
}

function drawGlyphWord(
  rgba: Uint8Array, W: number, H: number, word: string, g: GlyphSet,
  x0: number, y0: number, scale: number, rgb: RGB, stitch: boolean,
): void {
  let x = x0;
  for (const ch of Array.from(word)) {
    const gl = glyphOf(g, ch);
    gl.rows.forEach((row, r) => {
      for (let c = 0; c < row.length; c++) {
        if (row[c] !== "1") continue;
        const bx = x + c * scale;
        const by = y0 + r * scale;
        if (!stitch || scale < 2) {
          fillBox(rgba, W, H, bx, by, scale, scale, rgb);
        } else {
          for (let d = 0; d < scale; d++) {
            setPx(rgba, W, H, bx + d, by + d, rgb);
            setPx(rgba, W, H, bx + (scale - 1 - d), by + d, rgb);
          }
        }
      }
    });
    x += gl.advanceX * scale;
  }
}

export function styledBlockHeight(lines: StyledLine[], cellH: number): number {
  if (!lines.length) return 0;
  const sum = lines.reduce((acc, l) => acc + (cellH + l.lineGap) * l.scale, 0);
  return sum - lines[lines.length - 1]!.lineGap * lines[lines.length - 1]!.scale;
}

export function paintStyled(
  rgba: Uint8Array, W: number, H: number, lines: StyledLine[], g: GlyphSet,
  box: { left: number; width: number; y: number }, align: CardAlign, style: CardStyle,
): void {
  const n = lines.length;
  let y = box.y;
  interface Placed { tok: TextToken; x: number; y: number; scale: number }
  const placed: Placed[] = [];

  lines.forEach((line, li) => {
    const lw = lineWidth(line.tokens, g, line.scale);
    const slack = Math.max(0, box.width - lw);
    const f = n > 1 ? li / (n - 1) : 0;
    const off =
      align === "center" ? slack / 2
      : align === "right" ? slack
      : align === "stairR" ? slack * f
      : align === "stairL" ? slack * (1 - f)
      : 0;
    let x = Math.round(box.left + off);
    const sp = glyphOf(g, " ").advanceX * line.scale;
    line.tokens.forEach((tok, ti) => {
      if (ti > 0) x += sp;
      placed.push({ tok, x, y, scale: line.scale });
      x += wordWidth(tok.w, g, line.scale);
    });
    y += (g.cell.height + line.lineGap) * line.scale;
  });

  const hooks = placed.filter((p) => p.tok.h && style !== "base");

  // Marker background strip behind hook words on each line
  if (style === "marker" && hooks.length) {
    const byY = new Map<number, { a: number; b: number; s: number }>();
    for (const p of hooks) {
      const cur = byY.get(p.y) ?? { a: p.x, b: 0, s: p.scale };
      cur.a = Math.min(cur.a, p.x);
      cur.b = Math.max(cur.b, p.x + wordWidth(p.tok.w, g, p.scale));
      byY.set(p.y, cur);
    }
    for (const [yy, e] of byY) {
      fillBox(rgba, W, H, e.a - e.s * 2, yy - e.s * 2, e.b - e.a + e.s * 4, g.cell.height * e.s + e.s * 3, UPA_PALETTE.A);
    }
  }

  // Drop shadow pass for shadowS / shadowD
  if (style === "shadowS" || style === "shadowD") {
    for (const p of hooks) {
      const half = Math.max(1, Math.round(p.scale / 2));
      const dx = style === "shadowS" ? half : 0;
      drawGlyphWord(rgba, W, H, p.tok.w, g, p.x + dx, p.y + half, p.scale, UPA_PALETTE.D, false);
    }
  }

  // Main text pass
  const mainInk: RGB = style === "invert" ? PAPER : INK;
  for (const p of placed) {
    if (!p.tok.h || style === "base") {
      drawGlyphWord(rgba, W, H, p.tok.w, g, p.x, p.y, p.scale, mainInk, false);
      continue;
    }
    const hookRgb: RGB =
      style === "invert" ? UPA_PALETTE.F
      : style === "marker" ? PAPER
      : UPA_PALETTE.A;
    drawGlyphWord(rgba, W, H, p.tok.w, g, p.x, p.y, p.scale, hookRgb, style === "stitch");
  }
}
