import type { Glyph } from "../../../app/src/para/types";
export function unpack(glyph: Glyph) {
  const pixels = new Uint8Array(glyph.width * glyph.height);
  for (let y = 0; y < glyph.height; y++)
    for (let b = 0; b < glyph.rowBytes; b++) {
      const byte = parseInt(glyph.rows[y].slice(b * 2, b * 2 + 2), 16);
      if (!byte) continue;
      for (let bit = 0; bit < 8 && b * 8 + bit < glyph.width; bit++)
        if (byte & (128 >> bit)) pixels[y * glyph.width + b * 8 + bit] = 1;
    }
  return pixels;
}
export function pack(pixels: Uint8Array, width: number, height: number) {
  const rows: string[] = [];
  for (let y = 0; y < height; y++) {
    let row = "";
    for (let b = 0; b < Math.ceil(width / 8); b++) {
      let byte = 0;
      for (let bit = 0; bit < 8 && b * 8 + bit < width; bit++)
        if (pixels[y * width + b * 8 + bit]) byte |= 128 >> bit;
      row += byte.toString(16).toUpperCase().padStart(2, "0");
    }
    rows.push(row);
  }
  return rows;
}
