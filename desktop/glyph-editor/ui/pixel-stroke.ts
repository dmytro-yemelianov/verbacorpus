import { line, unpack, type Glyph } from "./model";
export type PixelTool = "pencil" | "eraser" | "flip";
/** A stroke owns its pixels. Re-entering a cell must not undo an earlier flip. */
export function createPixelStroke(glyph: Glyph, tool: PixelTool) {
  const pixels = unpack(glyph),
    visited = tool === "flip" ? new Uint8Array(pixels.length) : undefined;
  let last: { x: number; y: number } | undefined;
  const paint = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= glyph.width || y >= glyph.height) return;
    const i = y * glyph.width + x;
    if (visited) {
      if (visited[i]) return;
      visited[i] = 1;
      pixels[i] = 1 - pixels[i];
    } else pixels[i] = tool === "eraser" ? 0 : 1;
  };
  return {
    pixels,
    moveTo(x: number, y: number) {
      if (!Number.isInteger(x) || !Number.isInteger(y)) return;
      if (last) line(last.x, last.y, x, y, paint);
      else paint(x, y);
      last = { x, y };
    },
  };
}
