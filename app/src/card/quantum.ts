// Unified 8px subpixel quantum scene engine backed by shared UVC shader-kernel:
// - O(W*H) Exact Euclidean Distance Transform (2-pass Felzenszwalb) for typography halos
// - Discrete ordered dithering matrices (Plakhta 8x8, Bayer 8x8, Aida 8x8, Bayer 4x4)
// - Domain-warped discrete folk shaders + multi-harmonic generative QR shimmer
// - Stitch-locked 4-sided 1:1 perimeter frame for Animated WebP and GIF
import { paintPerimeter1to1, UPA_PALETTE } from "./ornament";
import {
  BAYER_4,
  computeDistanceGrid,
  ditherThreshold,
  generativeQrRgb,
  shadeBackgroundCell,
  type RGB,
  type ShaderPalette,
  type UvcDitherName,
  type UvcShaderName,
} from "../uvc-core/shader-kernel";

export { computeDistanceGrid, ditherThreshold, type RGB };
export type QuantumShaderName = Exclude<UvcShaderName, "podillia_ochre">;
export type QuantumDitherName = UvcDitherName;

export const QUANTUM_PALETTE = {
  PAPER: [0xf4, 0xf1, 0xe8] as RGB,  // #f4f1e8 Unbleached linen
  INK: [0x23, 0x25, 0x20] as RGB,    // #232520 Charcoal ink
  RED: UPA_PALETTE.A,                // #dc143c Madder crimson
  OCHRE: [218, 146, 32] as RGB,      // #da9220 Golden ochre
  INDIGO: [34, 68, 110] as RGB,      // #22446e Carpathian indigo
  SAGE: [48, 102, 60] as RGB,        // #30663c Folk green
  DARK_BG: UPA_PALETTE.D,            // #0a0a0a Invert substrate
} as const;

export const BAYER_4X4 = BAYER_4;

const VERBA_SHADER_PALETTE: ShaderPalette = {
  PAPER: QUANTUM_PALETTE.PAPER,
  INK: QUANTUM_PALETTE.INK,
  RED: QUANTUM_PALETTE.RED,
  OCHRE: QUANTUM_PALETTE.OCHRE,
  INDIGO: QUANTUM_PALETTE.INDIGO,
  SAGE: QUANTUM_PALETTE.SAGE,
  UMBER: [0x5e, 0x3a, 0x26],
  NIGHT: QUANTUM_PALETTE.DARK_BG,
};

export function fillQuantumCell(
  rgba: Uint8Array,
  W: number,
  H: number,
  gx: number,
  gy: number,
  M: number,
  rgb: RGB,
): void {
  const y0 = gy * M;
  const y1 = Math.min(H, y0 + M);
  const x0 = gx * M;
  const x1 = Math.min(W, x0 + M);
  const [r, g, b] = rgb;
  for (let y = y0; y < y1; y++) {
    let o = (y * W + x0) * 4;
    for (let x = x0; x < x1; x++) {
      rgba[o++] = r;
      rgba[o++] = g;
      rgba[o++] = b;
      rgba[o++] = 255;
    }
  }
}

export function generativeQrColor(
  r: number,
  c: number,
  t: number,
  qrN: number,
  invert: boolean,
  dither: QuantumDitherName = "plakhta",
): RGB {
  return generativeQrRgb(r, c, qrN, t, dither, invert, VERBA_SHADER_PALETTE);
}

export interface QuantumSceneMeta {
  W: number;
  H: number;
  M: number;
  GW: number;
  GH: number;
  T: number;
  corpus: "pro" | "contra";
  invert: boolean;
  shader?: QuantumShaderName;
  dither?: QuantumDitherName;
  noBackgroundShader?: boolean;
  dist: Float32Array;
  qr?: { gx: number; gy: number; n: number; matrix: boolean[][] };
  unit: string[][];
}

function resolveShaderAndDither(meta: QuantumSceneMeta): { shader: UvcShaderName; dither: QuantumDitherName } {
  if (meta.shader && meta.dither) return { shader: meta.shader, dither: meta.dither };
  if (meta.invert) return { shader: "indigo_night", dither: meta.dither ?? "plakhta" };
  if (meta.corpus === "contra") return { shader: meta.shader ?? "halftone_brutalist", dither: meta.dither ?? "bayer4" };
  return { shader: meta.shader ?? "kilim_drift", dither: meta.dither ?? "plakhta" };
}

/**
 * Paints procedural dithered background, 4-sided 1:1 perimeter conveyor, and generative QR
 * shimmer onto a cloned frame buffer for normalized phase t in [0, 1).
 */
export function renderQuantumFrame(
  baseContent: Uint8Array,
  meta: QuantumSceneMeta,
  t: number,
  shiftStitches: number,
): Uint8Array<ArrayBuffer> {
  const { W, H, M, GW, GH, T, invert, dist, qr, unit, noBackgroundShader } = meta;
  const frame = new Uint8Array(baseContent.length);
  frame.set(baseContent);

  const phaseT = ((t % 1) + 1) % 1;
  const { shader, dither } = resolveShaderAndDither(meta);
  const bgShader: UvcShaderName = invert ? "indigo_night" : shader;

  if (!noBackgroundShader) {
    for (let gy = T; gy < GH - T; gy++) {
      const rowOff = gy * GW;
      for (let gx = T; gx < GW - T; gx++) {
        const d = dist[rowOff + gx]!;
        if (d <= 3.5) continue;
        const rgb = shadeBackgroundCell(bgShader, dither, gx, gy, GW, GH, d, 3.5, phaseT, VERBA_SHADER_PALETTE);
        const isBase =
          (invert && rgb[0] === VERBA_SHADER_PALETTE.NIGHT[0] && rgb[1] === VERBA_SHADER_PALETTE.NIGHT[1] && rgb[2] === VERBA_SHADER_PALETTE.NIGHT[2]) ||
          (!invert && rgb[0] === VERBA_SHADER_PALETTE.PAPER[0] && rgb[1] === VERBA_SHADER_PALETTE.PAPER[1] && rgb[2] === VERBA_SHADER_PALETTE.PAPER[2]);
        if (!isBase) fillQuantumCell(frame, W, H, gx, gy, M, rgb);
      }
    }
  }

  if (qr) {
    for (let r = 0; r < qr.n; r++) {
      for (let c = 0; c < qr.n; c++) {
        if (!qr.matrix[r]?.[c]) continue;
        const qRgb = generativeQrColor(r, c, phaseT, qr.n, invert, dither);
        fillQuantumCell(frame, W, H, qr.gx + c, qr.gy + r, M, qRgb);
      }
    }
  }

  paintPerimeter1to1(frame, W, H, unit, QUANTUM_PALETTE.PAPER, shiftStitches, M);
  return frame;
}
