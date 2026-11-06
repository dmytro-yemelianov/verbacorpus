import type { Glyph, FontSummary } from "../para/types";
import { visitGlyphPixels, boundedBitmapScale } from "./bitmap";

/** Decode a native glyph once. Zoom, repeated letters and themes reuse its mask. */
export class GlyphPainter {
  private masks = new WeakMap<Glyph, HTMLCanvasElement>();
  private pixels = 0;
  private tinted = new WeakMap<
    Glyph,
    { ink: string; canvas: HTMLCanvasElement }
  >();
  paint(
    ctx: CanvasRenderingContext2D,
    glyph: Glyph,
    x: number,
    y: number,
    zoom: number,
    ink: string,
  ) {
    if (!glyph.width || !glyph.height) return;
    let item = this.tinted.get(glyph);
    if (item?.ink !== ink) {
      let mask = this.masks.get(glyph);
      if (!mask) {
        if (this.pixels + glyph.width * glyph.height > 2_000_000) {
          this.masks = new WeakMap();
          this.tinted = new WeakMap();
          this.pixels = 0;
        }
        this.pixels += glyph.width * glyph.height;
        mask = document.createElement("canvas");
        mask.width = glyph.width;
        mask.height = glyph.height;
        const context = mask.getContext("2d")!;
        context.fillStyle = "#000";
        visitGlyphPixels(glyph, (px, py) => context.fillRect(px, py, 1, 1));
        this.masks.set(glyph, mask);
      }
      const canvas = document.createElement("canvas");
      canvas.width = glyph.width;
      canvas.height = glyph.height;
      const context = canvas.getContext("2d")!;
      context.drawImage(mask, 0, 0);
      context.globalCompositeOperation = "source-in";
      context.fillStyle = ink;
      context.fillRect(0, 0, glyph.width, glyph.height);
      item = { ink, canvas };
      this.tinted.set(glyph, item);
    }
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(
      item.canvas,
      Math.round(x),
      Math.round(y),
      glyph.width * zoom,
      glyph.height * zoom,
    );
  }
}
export function paintSpecimen(
  canvas: HTMLCanvasElement,
  font: FontSummary,
  byChar: Map<string, Glyph>,
  value: string,
  requested: number,
  availableWidth: number,
  ink: string,
  painter: GlyphPainter,
) {
  const chars = [...value].slice(0, 160),
    pad = 4;
  const lineHeight =
    Math.max(
      font.cell.height,
      Number(font.metrics.lineHeight ?? font.cell.height),
    ) + 4;
  let zoom = boundedBitmapScale(
    font.cell.width + pad * 2,
    lineHeight + pad * 2,
    requested,
  );
  const naturalWidth = () =>
    Math.max(font.cell.width + pad * 2, Math.floor(availableWidth / zoom));
  // Reducing zoom makes more logical pixels fit across the same viewport.
  // Recheck that width instead of assuming it stays fixed during scale capping.
  while (
    zoom > 1 &&
    naturalWidth() * (lineHeight + pad * 2) * zoom * zoom > 2_000_000
  )
    zoom--;
  const width = Math.max(
    font.cell.width + pad * 2,
    Math.min(
      naturalWidth(),
      Math.floor(2_000_000 / ((lineHeight + pad * 2) * zoom * zoom)),
    ),
  );
  const maxHeight = Math.floor(2_000_000 / (width * zoom * zoom));
  let left = pad,
    top = pad,
    shown = 0;
  const positions: { glyph?: Glyph; x: number; y: number; advance: number }[] =
    [];
  for (const char of chars) {
    const glyph = byChar.get(char),
      advance = Math.max(
        1,
        glyph?.advanceX ?? Math.round(Number(font.metrics.advanceX)),
      );
    if (
      char === "\n" ||
      (left > pad &&
        left + Math.max(advance, glyph?.width ?? font.cell.width) + pad > width)
    ) {
      left = pad;
      top += lineHeight;
    }
    if (top + lineHeight + pad > maxHeight) break;
    shown++;
    if (char === "\n") continue;
    positions.push({ glyph, x: left, y: top, advance });
    left += advance;
  }
  canvas.width = Math.max(1, width * zoom);
  canvas.height = Math.max(1, (top + lineHeight + pad) * zoom);
  const ctx = canvas.getContext("2d")!;
  for (const { glyph, x, y, advance } of positions) {
    if (glyph)
      painter.paint(
        ctx,
        glyph,
        (x + glyph.metrics.leftBearing) * zoom,
        (y +
          Number(font.metrics.baseline) -
          glyph.metrics.shiftUp -
          glyph.height) *
          zoom,
        zoom,
        ink,
      );
    else {
      ctx.strokeStyle = "#b4232a";
      ctx.lineWidth = 1;
      ctx.strokeRect(
        x * zoom + 0.5,
        y * zoom + 0.5,
        Math.max(1, advance - 1) * zoom,
        font.cell.height * zoom,
      );
    }
  }
  canvas.setAttribute("aria-label", font.name + ": " + value);
  return { shown, total: chars.length, zoom };
}
