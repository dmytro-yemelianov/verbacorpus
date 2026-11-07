import { pack, unpack, type Glyph } from "./model";

export type Anchor = "center" | "top-left" | "baseline";
export interface RasterBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface RasterMutation {
  dx: number;
  dy: number;
  width: number;
  height: number;
  anchor: Anchor;
}
export interface RasterPreview {
  pixels: Uint8Array;
  bounds?: RasterBounds;
  clipped: boolean;
}
/** Cache the initial raster so each preview samples the same pixels, including after clipping. */
export function createRasterMutation(glyph: Glyph) {
  const source = unpack(glyph);
  let left = glyph.width,
    top = glyph.height,
    right = -1,
    bottom = -1;
  for (let y = 0; y < glyph.height; y++)
    for (let x = 0; x < glyph.width; x++)
      if (source[y * glyph.width + x]) {
        left = Math.min(left, x);
        top = Math.min(top, y);
        right = Math.max(right, x);
        bottom = Math.max(bottom, y);
      }
  const bounds: RasterBounds | undefined =
    right < left
      ? undefined
      : {
          x: left,
          y: top,
          width: right - left + 1,
          height: bottom - top + 1,
        };
  function render(options: RasterMutation): RasterPreview {
    const { dx, dy, width, height, anchor } = options;
    if (
      ![dx, dy, width, height].every(Number.isInteger) ||
      Math.abs(dx) > 16384 ||
      Math.abs(dy) > 16384 ||
      width < 1 ||
      height < 1 ||
      width > 8192 ||
      height > 8192 ||
      !["center", "top-left", "baseline"].includes(anchor)
    )
      throw new Error("Некоректна трансформація растра");
    const pixels = new Uint8Array(source.length);
    if (!bounds) return { pixels, clipped: false };
    const x =
      Math.round(
        bounds.x + (anchor === "top-left" ? 0 : (bounds.width - width) / 2),
      ) + dx;
    const baseline = glyph.height + glyph.metrics.shiftUp;
    const y =
      Math.round(
        anchor === "baseline"
          ? baseline - ((baseline - bounds.y) * height) / bounds.height
          : bounds.y +
              (anchor === "top-left" ? 0 : (bounds.height - height) / 2),
      ) + dy;
    // Iterate only the visible cell, never an enormous off-screen scaled bitmap.
    for (
      let py = Math.max(0, y);
      py < Math.min(glyph.height, y + height);
      py++
    ) {
      const sy = bounds.y + Math.floor(((py - y) * bounds.height) / height);
      for (
        let px = Math.max(0, x);
        px < Math.min(glyph.width, x + width);
        px++
      ) {
        const sx = bounds.x + Math.floor(((px - x) * bounds.width) / width);
        pixels[py * glyph.width + px] = source[sy * glyph.width + sx];
      }
    }
    return {
      pixels,
      bounds: { x, y, width, height },
      clipped:
        x < 0 || y < 0 || x + width > glyph.width || y + height > glyph.height,
    };
  }
  return { bounds, render };
}
export function mutatedRaster(glyph: Glyph, options: RasterMutation): Glyph {
  const result = createRasterMutation(glyph).render(options);
  return {
    ...structuredClone(glyph),
    rows: pack(result.pixels, glyph.width, glyph.height),
  };
}
