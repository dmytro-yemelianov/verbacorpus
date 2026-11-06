import type { Glyph } from "../para/types";
/** Walk exact MSB-first native pixels, including rasters wider than 32 bits. */
export function visitGlyphPixels(
  glyph: Glyph,
  paint: (x: number, y: number) => void,
) {
  for (let y = 0; y < glyph.height; y++)
    for (let x = 0; x < glyph.width; x++) {
      const offset = Math.floor(x / 8) * 2,
        byte = parseInt(glyph.rows[y].slice(offset, offset + 2), 16);
      if (byte & (128 >> (x % 8))) paint(x, y);
    }
}

export function boundedBitmapScale(
  width: number,
  height: number,
  requested: number,
) {
  return Math.max(
    1,
    Math.min(
      requested,
      Math.floor(Math.sqrt(2_000_000 / Math.max(1, width * height))),
    ),
  );
}
