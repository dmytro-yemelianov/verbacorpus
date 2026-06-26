// Maps the octagram glow field to a pixelated Ukrainian-embroidery (vyshyvanka)
// stitch pattern: fixed red-on-cream palette, color-cycling threads, painted into
// top/bottom border bands. Pure module.

export type RGB = readonly [number, number, number];

export const VYSHYVANKA: Record<"cream" | "red" | "deepRed" | "black", RGB> = {
  cream: [244, 241, 232],   // #f4f1e8
  red: [180, 35, 42],       // #b4232a
  deepRed: [125, 22, 32],   // #7d1620
  black: [26, 26, 26],      // #1a1a1a
};

// Raised from 0.16 so fewer cells become stitches — more cream shows through and
// the card reads lighter and airier, with a sharper cream/stitch boundary.
export const STITCH_THRESHOLD = 0.40;
const TAU = Math.PI * 2;

// Pick a thread colour for a stitch. Below the threshold there is no stitch (cream).
// Above it, a phase-scrolling wave swaps each stitch between red (dominant, warm)
// and black (accent), producing the "color-cycle" shimmer. Two-tone — the old
// deep-red mid-tone is dropped, so red↔black↔cream sit at high contrast.
// Seamless: phase 0 and phase 1 are identical.
export function stitchRGB(intensity: number, phase: number): RGB {
  if (intensity < STITCH_THRESHOLD) return VYSHYVANKA.cream;
  const wave = 0.5 + 0.5 * Math.sin(intensity * 9.0 - phase * TAU);
  return wave > 0.4 ? VYSHYVANKA.red : VYSHYVANKA.black;
}

// Overwrite the top and bottom band rows (each `bandPx` tall) of an existing W×H
// RGBA buffer with octagram stitches. The center rows are left untouched — so on a
// cream card with inset padding, only the content-free bands get the pattern.
export function paintBands(
  rgba: Uint8Array, W: number, H: number, field: Float32Array, gw: number, gh: number,
  phase: number, bandPx: number,
): void {
  for (let py = 0; py < H; py++) {
    if (py >= bandPx && py < H - bandPx) continue; // center: leave as-is
    const gy = Math.min(gh - 1, Math.floor((py / H) * gh));
    for (let px = 0; px < W; px++) {
      const gx = Math.min(gw - 1, Math.floor((px / W) * gw));
      const [r, g, b] = stitchRGB(field[gy * gw + gx], phase);
      const o = (py * W + px) * 4;
      rgba[o] = r; rgba[o + 1] = g; rgba[o + 2] = b; rgba[o + 3] = 255;
    }
  }
}

// Build a full W×H RGBA pattern frame: every pixel comes from the stitch grid
// (cream where the field is below threshold). No masking — the octagram fills the card.
export function buildPatternFrame(
  W: number, H: number, field: Float32Array, gw: number, gh: number, phase: number,
): Uint8Array {
  const out = new Uint8Array(W * H * 4);
  for (let py = 0; py < H; py++) {
    const gy = Math.min(gh - 1, Math.floor((py / H) * gh));
    for (let px = 0; px < W; px++) {
      const gx = Math.min(gw - 1, Math.floor((px / W) * gw));
      const [r, g, b] = stitchRGB(field[gy * gw + gx], phase);
      const o = (py * W + px) * 4;
      out[o] = r; out[o + 1] = g; out[o + 2] = b; out[o + 3] = 255;
    }
  }
  return out;
}

// Build one W×H RGBA frame from scratch: cream everywhere, stitches in the bands.
// (Used in tests / standalone; the card pipeline overwrites bands on the rendered card.)
export function buildBaseFrame(
  W: number, H: number, field: Float32Array, gw: number, gh: number,
  phase: number, bandPx: number,
): Uint8Array {
  const out = new Uint8Array(W * H * 4);
  const [cr, cg, cb] = VYSHYVANKA.cream;
  for (let i = 0; i < W * H; i++) {
    const o = i * 4;
    out[o] = cr; out[o + 1] = cg; out[o + 2] = cb; out[o + 3] = 255;
  }
  paintBands(out, W, H, field, gw, gh, phase, bandPx);
  return out;
}

// Alpha-composite an RGBA `text` layer over `base` (both W×H×4), in place on base.
export function compositeOver(base: Uint8Array, text: Uint8Array): void {
  for (let o = 0; o < base.length; o += 4) {
    const a = text[o + 3];
    if (a === 0) continue;
    if (a === 255) {
      base[o] = text[o]; base[o + 1] = text[o + 1]; base[o + 2] = text[o + 2];
      continue;
    }
    const af = a / 255, ia = 1 - af;
    base[o] = (text[o] * af + base[o] * ia) | 0;
    base[o + 1] = (text[o + 1] * af + base[o + 1] * ia) | 0;
    base[o + 2] = (text[o + 2] * af + base[o + 2] * ia) | 0;
  }
}
