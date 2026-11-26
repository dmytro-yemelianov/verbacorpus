// Ornament bands for cards: UPA band patterns (reached through the UPA service binding),
// painted as repeating strips, plus the curated list of frame ids.
import framesFile from "../../content/card-frames.json";

import { UPA_PALETTE, type UpaColor } from "../shared/upa-palette";
export { UPA_PALETTE, type UpaColor };

export type CardFrameErrorCode = "frame_not_found" | "frame_not_band" | "frame_unavailable";

export class CardFrameError extends Error {
  constructor(public code: CardFrameErrorCode, message?: string, public status = code === "frame_not_found" ? 404 : code === "frame_not_band" ? 422 : 502) {
    super(message ?? code);
    this.name = "CardFrameError";
  }
}

export interface Band { id: string; unit: string[][] }

// `patternId` is the bare UPA id ("p08_L_b03"); a global id "non:p08_L_b03" is accepted too.
export async function fetchBand(upa: Fetcher, patternId: string): Promise<Band> {
  const id = patternId.startsWith("non:") ? patternId.slice(4) : patternId;
  let res: Response;
  try {
    res = await upa.fetch(`https://upstream/api/v1/patterns/${encodeURIComponent(id)}`);
  } catch (e) {
    throw new CardFrameError("frame_unavailable", String(e));
  }
  if (res.status === 404) throw new CardFrameError("frame_not_found");
  if (!res.ok) throw new CardFrameError("frame_unavailable", `UPA API ${res.status}`);
  let body: any;
  try {
    body = await res.json();
  } catch {
    throw new CardFrameError("frame_unavailable", "invalid UPA API response");
  }
  const p = body?.pattern ?? body; // the API wraps the pattern in { pattern }
  if (p?.kind !== "band") throw new CardFrameError("frame_not_band", `kind ${String(p?.kind)}`);
  const unit = p.geometry?.unitCell;
  if (!Array.isArray(unit) || !unit.length || !Array.isArray(unit[0]) || !unit[0].length ||
      !unit.every((r: unknown) => Array.isArray(r) && r.length === unit[0].length && r.every((c) => typeof c === "string" && /^[A-G]$/.test(c)))) {
    throw new CardFrameError("frame_unavailable", "invalid unitCell");
  }
  return { id, unit: unit as string[][] };
}

// Paint one strip into rows [y0, y0+band) of a W×H RGBA buffer. The unit is scaled by an
// integer stitch (floor(band/rows), min 1). A unit taller than the band is first thinned
// to every k-th row and column (k = ceil(rows/band)) so it fits; a 1×1 unit gives a solid
// strip. The repeat tiles across the width, drifting by `phase` (in [0,1) = one repeat),
// like paintBorders; callers mirror the drift by passing 1 - phase for the other strip.
export function paintBand(
  rgba: Uint8Array, W: number, H: number, y0: number, band: number,
  unit: string[][], paper: [number, number, number], phase: number,
): void {
  if (band <= 0 || !unit.length || !unit[0]!.length) return;
  const k = Math.max(1, Math.ceil(unit.length / band));
  const cells: string[][] = [];
  for (let r = 0; r < unit.length; r += k) {
    const row: string[] = [];
    for (let c = 0; c < unit[r]!.length; c += k) row.push(unit[r]![c]!);
    cells.push(row);
  }
  const rows = cells.length, cols = cells[0]!.length;
  const stitch = Math.max(1, Math.floor(band / rows));
  const stripH = Math.min(band, stitch * rows);
  const unitW = cols * stitch;
  const offset = Math.round(phase * unitW);
  for (let sy = 0; sy < stripH; sy++) {
    const y = y0 + sy;
    if (y < 0 || y >= H) continue;
    const prow = cells[(sy / stitch) | 0]!;
    for (let x = 0; x < W; x++) {
      const srcX = (((x + offset) % unitW) + unitW) % unitW;
      const sym = prow[(srcX / stitch) | 0]!;
      const [r, g, b] = sym === "B" ? paper : (UPA_PALETTE[sym as UpaColor] ?? paper);
      const o = (y * W + x) * 4;
      rgba[o] = r; rgba[o + 1] = g; rgba[o + 2] = b; rgba[o + 3] = 255;
    }
  }
}

export const CARD_FRAMES: readonly string[] = framesFile.frames;

// Deterministic pick of a global frame id ("non:<patternId>") by FNV-1a over the seed key.
export function pickFrame(seedKey: string): string {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seedKey.length; i++) h = Math.imul(h ^ seedKey.charCodeAt(i), 16777619) >>> 0;
  return CARD_FRAMES[h % CARD_FRAMES.length]!;
}
