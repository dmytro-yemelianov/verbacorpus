// Unified 8px subpixel quantum scene engine (ported from UVC Core v0.1.0):
// - O(W*H) Exact Euclidean Distance Transform (2-pass Felzenszwalb) for typography halos
// - Discrete ordered dithering matrices (Plakhta 8x8, Bayer 8x8, Aida 8x8, Bayer 4x4)
// - Domain-warped discrete folk shaders (kilim_drift, rushnyk_aura, halftone_brutalist, indigo_night, polissya_moss)
// - Multi-harmonic generative QR shimmer with seamless t=0/t=1 loop parity
// - Stitch-locked 4-sided 1:1 perimeter frame for Animated WebP and GIF
import { paintPerimeter1to1, UPA_PALETTE } from "./ornament";

export type RGB = [number, number, number];
export type QuantumShaderName = "kilim_drift" | "rushnyk_aura" | "halftone_brutalist" | "indigo_night" | "polissya_moss";
export type QuantumDitherName = "plakhta" | "bayer8" | "aida" | "bayer4";

export const QUANTUM_PALETTE = {
  PAPER: [0xf4, 0xf1, 0xe8] as RGB,  // #f4f1e8 Unbleached linen
  INK: [0x23, 0x25, 0x20] as RGB,    // #232520 Charcoal ink
  RED: UPA_PALETTE.A,                // #dc143c Madder crimson
  OCHRE: [218, 146, 32] as RGB,      // #da9220 Golden ochre
  INDIGO: [34, 68, 110] as RGB,      // #22446e Carpathian indigo
  SAGE: [48, 102, 60] as RGB,        // #30663c Folk green
  DARK_BG: UPA_PALETTE.D,            // #0a0a0a Invert substrate
} as const;

const norm = (m: number[][], max: number) => m.map((r) => r.map((v) => (v + 0.5) / max));

export const BAYER_4X4: readonly (readonly number[])[] = norm([
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
], 16);

const BAYER_8X8 = norm([
  [0, 32, 8, 40, 2, 34, 10, 42],
  [48, 16, 56, 24, 50, 18, 58, 26],
  [12, 44, 4, 36, 14, 46, 6, 38],
  [60, 28, 52, 20, 62, 30, 54, 22],
  [3, 35, 11, 43, 1, 33, 9, 41],
  [51, 19, 59, 27, 49, 17, 57, 25],
  [15, 47, 7, 39, 13, 45, 5, 37],
  [63, 31, 55, 23, 61, 29, 53, 21],
], 64);

const PLAKHTA_8X8 = norm([
  [63, 47, 31, 15, 1, 17, 33, 49],
  [55, 39, 23, 7, 9, 25, 41, 57],
  [35, 19, 5, 11, 13, 21, 37, 53],
  [3, 27, 43, 59, 61, 45, 29, 14],
  [2, 18, 34, 50, 62, 46, 30, 16],
  [10, 26, 42, 58, 54, 38, 22, 8],
  [12, 20, 36, 52, 32, 19, 4, 24],
  [60, 44, 28, 0, 6, 40, 48, 56],
], 64);

const AIDA_8X8 = norm([
  [0, 36, 12, 48, 2, 38, 14, 50],
  [52, 16, 40, 24, 54, 18, 42, 26],
  [8, 44, 4, 56, 10, 46, 6, 58],
  [60, 28, 32, 20, 62, 30, 34, 22],
  [3, 39, 15, 51, 1, 37, 13, 49],
  [55, 19, 43, 27, 53, 17, 41, 25],
  [11, 47, 7, 59, 9, 45, 5, 57],
  [63, 31, 35, 23, 61, 29, 33, 21],
], 64);

export function ditherThreshold(kind: QuantumDitherName, gx: number, gy: number): number {
  if (kind === "bayer4") return BAYER_4X4[gy & 3]![gx & 3]!;
  if (kind === "bayer8") return BAYER_8X8[gy & 7]![gx & 7]!;
  if (kind === "aida") return AIDA_8X8[gy & 7]![gx & 7]!;
  return PLAKHTA_8X8[gy & 7]![gx & 7]!;
}

/**
 * Computes exact Euclidean distance (in cell units) from every grid cell to the nearest
 * active foreground cell using a 2-pass Felzenszwalb 1D squared distance transform in O(GW * GH).
 */
export function computeDistanceGrid(fgMask: Uint8Array, GW: number, GH: number): Float32Array {
  const INF = 1e9;
  const n = GW * GH;
  const d2 = new Float32Array(n);
  for (let i = 0; i < n; i++) d2[i] = fgMask[i] ? 0 : INF;

  const maxDim = Math.max(GW, GH);
  const f = new Float32Array(maxDim);
  const v = new Int32Array(maxDim);
  const z = new Float32Array(maxDim + 1);

  const edt1d = (len: number, out: Float32Array, stride: number, offset: number) => {
    let k = 0;
    v[0] = 0;
    z[0] = -INF;
    z[1] = INF;
    for (let q = 1; q < len; q++) {
      let s = (f[q]! + q * q - (f[v[k]!]! + v[k]! * v[k]!)) / (2 * q - 2 * v[k]!);
      while (s <= z[k]!) {
        k--;
        s = (f[q]! + q * q - (f[v[k]!]! + v[k]! * v[k]!)) / (2 * q - 2 * v[k]!);
      }
      k++;
      v[k] = q;
      z[k] = s;
      z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < len; q++) {
      while (z[k + 1]! < q) k++;
      const dx = q - v[k]!;
      out[offset + q * stride] = dx * dx + f[v[k]!]!;
    }
  };

  for (let x = 0; x < GW; x++) {
    for (let y = 0; y < GH; y++) f[y] = d2[y * GW + x]!;
    edt1d(GH, d2, GW, x);
  }
  for (let y = 0; y < GH; y++) {
    const rowOff = y * GW;
    for (let x = 0; x < GW; x++) f[x] = d2[rowOff + x]!;
    edt1d(GW, d2, 1, rowOff);
  }
  for (let i = 0; i < n; i++) d2[i] = Math.sqrt(d2[i]!);
  return d2;
}

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

/**
 * Evaluates generative multi-harmonic interference color for a dark QR module (r, c).
 * Normalized periodically on t in [0, 1) so frame[0] === frame[totalFrames].
 */
export function generativeQrColor(
  r: number,
  c: number,
  t: number,
  qrN: number,
  invert: boolean,
  dither: QuantumDitherName = "plakhta",
): RGB {
  const phaseT = ((t % 1) + 1) % 1;
  if (invert) {
    const rad = Math.hypot(r - qrN / 2, c - qrN / 2);
    const e = (Math.sin(rad * 0.45 - 2 * Math.PI * phaseT) + 1) * 0.5;
    const th = ditherThreshold(dither, c, r);
    return e > 0.72 && (e - 0.72) / 0.28 > th ? QUANTUM_PALETTE.OCHRE : QUANTUM_PALETTE.PAPER;
  }

  const tau = 2 * Math.PI;
  const cr = r - qrN / 2;
  const cc = c - qrN / 2;
  const rad = Math.hypot(cr, cc);
  const ang = Math.atan2(cr, cc);

  const w1 = Math.sin(rad * 0.42 - tau * phaseT);
  const w2 = Math.cos((r + c) * 0.32 + tau * phaseT);
  const w3 = Math.sin(ang * 2 + rad * 0.22 - tau * phaseT);
  const energy = (w1 * 0.42 + w2 * 0.33 + w3 * 0.25 + 1) * 0.5;
  const th = ditherThreshold(dither, c, r);

  if (energy > 0.78) {
    return (energy - 0.78) / 0.22 > th ? QUANTUM_PALETTE.OCHRE : QUANTUM_PALETTE.RED;
  }
  if (energy > 0.44) {
    return (energy - 0.44) / 0.34 > th ? QUANTUM_PALETTE.RED : QUANTUM_PALETTE.INK;
  }
  if (energy > 0.25 && th < 0.25) {
    return QUANTUM_PALETTE.INDIGO;
  }
  return QUANTUM_PALETTE.INK;
}

export interface QuantumSceneMeta {
  W: number;
  H: number;
  M: number; // subpixel quantum (px/cell)
  GW: number;
  GH: number;
  T: number; // border cells
  corpus: "pro" | "contra";
  invert: boolean;
  shader?: QuantumShaderName;
  dither?: QuantumDitherName;
  noBackgroundShader?: boolean;
  dist: Float32Array;
  qr?: { gx: number; gy: number; n: number; matrix: boolean[][] };
  unit: string[][];
}

function resolveShaderAndDither(meta: QuantumSceneMeta): { shader: QuantumShaderName; dither: QuantumDitherName } {
  if (meta.shader && meta.dither) return { shader: meta.shader, dither: meta.dither };
  if (meta.invert) return { shader: meta.shader ?? "indigo_night", dither: meta.dither ?? "plakhta" };
  if (meta.corpus === "contra") return { shader: meta.shader ?? "halftone_brutalist", dither: meta.dither ?? "bayer4" };
  return { shader: meta.shader ?? "kilim_drift", dither: meta.dither ?? "plakhta" };
}

function shadeQuantumCell(
  shader: QuantumShaderName,
  dither: QuantumDitherName,
  gx: number,
  gy: number,
  GW: number,
  GH: number,
  dist: number,
  phase: number,
  invert: boolean,
): RGB | null {
  const haloCells = 3.5;
  if (dist <= haloCells) return null;

  const th = ditherThreshold(dither, gx, gy);
  const haloFade = Math.min(1, (dist - haloCells) / 7);
  const nx = (gx / Math.max(1, GW - 1)) * 2 - 1;
  const ny = (gy / Math.max(1, GH - 1)) * 2 - 1;
  const edgeFactor = Math.min(1, 0.28 + 0.72 * Math.pow(Math.max(Math.abs(nx), Math.abs(ny)), 1.65));

  if (shader === "indigo_night" || invert) {
    const wx = gx * 0.055 + Math.sin(gy * 0.04 + phase) * 0.7;
    const wy = gy * 0.055 + Math.cos(gx * 0.04 - phase) * 0.7;
    const field = (Math.sin(wx + phase) + Math.cos(wy - phase) + 2) * 0.25;
    const density = field * haloFade * edgeFactor * 0.85;
    if (density < th) return null;
    return field > 0.68 ? QUANTUM_PALETTE.OCHRE : field > 0.45 ? QUANTUM_PALETTE.RED : QUANTUM_PALETTE.INDIGO;
  }

  if (shader === "halftone_brutalist") {
    const scan = Math.sin(gy * 0.28 - phase) * 0.5 + 0.5;
    const warp = Math.sin(gx * 0.09 + Math.cos(gy * 0.08 + phase)) * 0.5 + 0.5;
    const density = (scan * 0.45 + warp * 0.55) * haloFade * (0.25 + 0.65 * edgeFactor);
    if (density < th) return null;
    return warp > 0.62 ? QUANTUM_PALETTE.INDIGO : density > 0.72 ? QUANTUM_PALETTE.RED : QUANTUM_PALETTE.INK;
  }

  if (shader === "rushnyk_aura") {
    const sx = Math.abs(nx);
    const wave = Math.sin(dist * 0.34 - phase + sx * 2.2) * 0.5 + 0.5;
    const weave = Math.cos((gx - gy) * 0.08 + phase) * 0.5 + 0.5;
    const density = (wave * 0.6 + weave * 0.4) * haloFade * edgeFactor * 0.88;
    if (density < th) return null;
    if (wave > 0.72) return QUANTUM_PALETTE.RED;
    if (weave > 0.42) return QUANTUM_PALETTE.OCHRE;
    return QUANTUM_PALETTE.INDIGO;
  }

  if (shader === "polissya_moss") {
    const u = (gx + gy) * 0.065;
    const v = (gx - gy) * 0.065;
    const weave = (Math.sin(u + phase) * Math.cos(v - phase) + 1) * 0.5;
    const aura = Math.sin(dist * 0.3 - phase) * 0.5 + 0.5;
    const density = (weave * 0.65 + aura * 0.35) * haloFade * edgeFactor * 0.86;
    if (density < th) return null;
    const th2 = ditherThreshold(dither, gx + 2, gy + 4);
    if (weave > 0.68) return (weave - 0.68) / 0.32 > th2 ? QUANTUM_PALETTE.OCHRE : QUANTUM_PALETTE.SAGE;
    return aura > 0.62 && th2 < 0.45 ? QUANTUM_PALETTE.INDIGO : QUANTUM_PALETTE.SAGE;
  }

  // Default: "kilim_drift" — warm domain-warped currents with quiet center & lush woven corners
  const warpX = gx * 0.048 + 0.85 * Math.sin(gy * 0.052 + phase);
  const warpY = gy * 0.048 + 0.85 * Math.cos(gx * 0.052 - phase);
  const f1 = Math.sin(warpX + warpY + phase * 0.5);
  const f2 = Math.cos(warpX * 1.3 - warpY * 1.1 - phase);
  const flow = (f1 * 0.55 + f2 * 0.45 + 1) * 0.5;
  const breath = Math.sin(dist * 0.28 - phase) * 0.5 + 0.5;
  const density = (flow * 0.65 + breath * 0.35) * haloFade * edgeFactor * 0.92;
  if (density < th) return null;

  const th2 = ditherThreshold(dither, gx + 3, gy + 5);
  if (flow > 0.62) return (flow - 0.62) / 0.38 > th2 ? QUANTUM_PALETTE.RED : QUANTUM_PALETTE.OCHRE;
  if (flow > 0.32) return (flow - 0.32) / 0.3 > th2 ? QUANTUM_PALETTE.OCHRE : QUANTUM_PALETTE.INDIGO;
  return flow < 0.16 && th2 < 0.35 ? QUANTUM_PALETTE.SAGE : QUANTUM_PALETTE.INDIGO;
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
  const phase = 2 * Math.PI * phaseT;
  const { shader, dither } = resolveShaderAndDither(meta);

  if (!noBackgroundShader) {
    for (let gy = T; gy < GH - T; gy++) {
      const rowOff = gy * GW;
      for (let gx = T; gx < GW - T; gx++) {
        const rgb = shadeQuantumCell(shader, dither, gx, gy, GW, GH, dist[rowOff + gx]!, phase, invert);
        if (rgb) fillQuantumCell(frame, W, H, gx, gy, M, rgb);
      }
    }
  }

  // Generative QR Shimmer
  if (qr) {
    for (let r = 0; r < qr.n; r++) {
      for (let c = 0; c < qr.n; c++) {
        if (!qr.matrix[r]?.[c]) continue;
        const qRgb = generativeQrColor(r, c, phaseT, qr.n, invert, dither);
        fillQuantumCell(frame, W, H, qr.gx + c, qr.gy + r, M, qRgb);
      }
    }
  }

  // 4-sided 1:1 Perimeter Frame with 45-degree miter joins
  paintPerimeter1to1(frame, W, H, unit, QUANTUM_PALETTE.PAPER, shiftStitches, M);
  return frame;
}
