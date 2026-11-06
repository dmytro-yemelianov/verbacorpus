import type { Glyph } from "../para/types";
/** Walk exact MSB-first native pixels, including rasters wider than 32 bits. */
export function visitGlyphPixels(
  glyph: Glyph,
  paint: (x: number, y: number) => void,
) {
  for (let y = 0; y < glyph.height; y++) {
    const row = glyph.rows[y];
    for (let byteIndex = 0; byteIndex < glyph.rowBytes; byteIndex++) {
      const offset = byteIndex * 2;
      const byte = parseInt(row.slice(offset, offset + 2), 16);
      if (!byte) continue;
      const base = byteIndex * 8,
        end = Math.min(8, glyph.width - base);
      for (let bit = 0; bit < end; bit++)
        if (byte & (128 >> bit)) paint(base + bit, y);
    }
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
