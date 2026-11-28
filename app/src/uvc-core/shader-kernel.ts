// SYNCED FROM upa-archive/src/uvc/ — run `tsx scripts/uvc-sync-verba.ts` in upa-archive to update.
// Zero-dependency UVC Ordered Dither Matrices, 2-Pass Felzenszwalb EDT,
// Domain-Warped Folk Shaders, and Generative QR Shimmer.
// Shared single source of truth between upa-archive (@uvc/core) and verbacorpus.

export type RGB = [number, number, number];
export type UvcShaderName =
  | "kilim_drift"
  | "rushnyk_aura"
  | "halftone_brutalist"
  | "indigo_night"
  | "polissya_moss"
  | "podillia_ochre";
export type UvcDitherName = "bayer8" | "plakhta" | "aida" | "bayer4";

export interface ShaderPalette {
  PAPER: RGB;
  INK: RGB;
  RED: RGB;
  OCHRE: RGB;
  INDIGO: RGB;
  SAGE: RGB;
  UMBER: RGB;
  NIGHT: RGB;
}

export const DEFAULT_SHADER_PALETTE: ShaderPalette = {
  PAPER: [0xf4, 0xf1, 0xe8],
  INK: [0x1c, 0x1e, 0x1a],
  RED: [0xda, 0x26, 0x30],
  OCHRE: [0xda, 0x92, 0x20],
  INDIGO: [0x22, 0x44, 0x6e],
  SAGE: [0x30, 0x66, 0x3c],
  UMBER: [0x5e, 0x3a, 0x26],
  NIGHT: [0x12, 0x14, 0x18],
};

const norm = (m: number[][], max: number) => m.map((r) => r.map((v) => (v + 0.5) / max));

export const BAYER_4 = norm([
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
], 16);

export const BAYER_8 = norm([
  [0, 32, 8, 40, 2, 34, 10, 42],
  [48, 16, 56, 24, 50, 18, 58, 26],
  [12, 44, 4, 36, 14, 46, 6, 38],
  [60, 28, 52, 20, 62, 30, 54, 22],
  [3, 35, 11, 43, 1, 33, 9, 41],
  [51, 19, 59, 27, 49, 17, 57, 25],
  [15, 47, 7, 39, 13, 45, 5, 37],
  [63, 31, 55, 23, 61, 29, 53, 21],
], 64);

// 8x8 Ukrainian Plakhta (diamond / twill) ordered matrix: rises from sparse stars -> diagonal twill -> rhombs.
export const PLAKHTA_8 = norm([
  [63, 47, 31, 15, 1, 17, 33, 49],
  [55, 39, 23, 7, 9, 25, 41, 57],
  [35, 19, 5, 11, 13, 21, 37, 53],
  [3, 27, 43, 59, 61, 45, 29, 14],
  [2, 18, 34, 50, 62, 46, 30, 16],
  [10, 26, 42, 58, 54, 38, 22, 8],
  [12, 20, 36, 52, 32, 19, 4, 24],
  [60, 44, 28, 0, 6, 40, 48, 56],
], 64);

// 8x8 Woven Aida linen cross-stitch matrix
export const AIDA_8 = norm([
  [0, 36, 12, 48, 2, 38, 14, 50],
  [52, 16, 40, 24, 54, 18, 42, 26],
  [8, 44, 4, 56, 10, 46, 6, 58],
  [60, 28, 32, 20, 62, 30, 34, 22],
  [3, 39, 15, 51, 1, 37, 13, 49],
  [55, 19, 43, 27, 53, 17, 41, 25],
  [11, 47, 7, 59, 9, 45, 5, 57],
  [63, 31, 35, 23, 61, 29, 33, 21],
], 64);

export function ditherThreshold(kind: UvcDitherName, gx: number, gy: number): number {
  if (kind === "bayer4") return BAYER_4[gy & 3]![gx & 3]!;
  if (kind === "bayer8") return BAYER_8[gy & 7]![gx & 7]!;
  if (kind === "aida") return AIDA_8[gy & 7]![gx & 7]!;
  return PLAKHTA_8[gy & 7]![gx & 7]!;
}

/** O(GW * GH) Exact Euclidean Distance Transform (Felzenszwalb 2-pass). */
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
    const off = y * GW;
    for (let x = 0; x < GW; x++) f[x] = d2[off + x]!;
    edt1d(GW, d2, 1, off);
  }
  for (let i = 0; i < n; i++) d2[i] = Math.sqrt(d2[i]!);
  return d2;
}

/** Curated shader evaluation returning an exact discrete palette RGB. */
export function shadeBackgroundCell(
  shader: UvcShaderName,
  dither: UvcDitherName,
  gx: number,
  gy: number,
  GW: number,
  GH: number,
  dist: number,
  haloCells: number,
  t: number,
  pal: ShaderPalette = DEFAULT_SHADER_PALETTE,
): RGB {
  const isNight = shader === "indigo_night";
  const base = isNight ? pal.NIGHT : pal.PAPER;
  if (dist <= haloCells) return base;

  const phaseT = ((t % 1) + 1) % 1;
  const phase = 2 * Math.PI * phaseT;
  const th = ditherThreshold(dither, gx, gy);
  const haloFade = Math.min(1, (dist - haloCells) / 7);

  const nx = (gx / Math.max(1, GW - 1)) * 2 - 1;
  const ny = (gy / Math.max(1, GH - 1)) * 2 - 1;
  const edgeFactor = Math.min(1, 0.28 + 0.72 * Math.pow(Math.max(Math.abs(nx), Math.abs(ny)), 1.65));

  if (shader === "halftone_brutalist") {
    const scan = Math.sin(gy * 0.28 - phase) * 0.5 + 0.5;
    const warp = Math.sin(gx * 0.09 + Math.cos(gy * 0.08 + phase)) * 0.5 + 0.5;
    const density = (scan * 0.45 + warp * 0.55) * haloFade * (0.25 + 0.65 * edgeFactor);
    if (density < th) return base;
    return warp > 0.62 ? pal.INDIGO : density > 0.72 ? pal.RED : pal.INK;
  }

  if (shader === "indigo_night") {
    const wx = gx * 0.055 + Math.sin(gy * 0.04 + phase) * 0.7;
    const wy = gy * 0.055 + Math.cos(gx * 0.04 - phase) * 0.7;
    const field = (Math.sin(wx + phase) + Math.cos(wy - phase) + 2) * 0.25;
    const density = field * haloFade * edgeFactor * 0.85;
    if (density < th) return base;
    return field > 0.68 ? pal.OCHRE : field > 0.45 ? pal.RED : pal.INDIGO;
  }

  if (shader === "rushnyk_aura") {
    const sx = Math.abs(nx);
    const wave = Math.sin(dist * 0.34 - phase + sx * 2.2) * 0.5 + 0.5;
    const weave = Math.cos((gx - gy) * 0.08 + phase) * 0.5 + 0.5;
    const density = (wave * 0.6 + weave * 0.4) * haloFade * edgeFactor * 0.88;
    if (density < th) return base;
    if (wave > 0.72) return pal.RED;
    if (weave > 0.42) return pal.OCHRE;
    return pal.INDIGO;
  }

  if (shader === "polissya_moss") {
    const u = (gx + gy) * 0.065;
    const v = (gx - gy) * 0.065;
    const weave = (Math.sin(u + phase) * Math.cos(v - phase) + 1) * 0.5;
    const aura = Math.sin(dist * 0.3 - phase) * 0.5 + 0.5;
    const density = (weave * 0.65 + aura * 0.35) * haloFade * edgeFactor * 0.86;
    if (density < th) return base;
    const th2 = ditherThreshold(dither, gx + 2, gy + 4);
    if (weave > 0.68) return (weave - 0.68) / 0.32 > th2 ? pal.OCHRE : pal.SAGE;
    return aura > 0.62 && th2 < 0.45 ? pal.INDIGO : pal.SAGE;
  }

  if (shader === "podillia_ochre") {
    const band = Math.sin((gx * 0.075 - gy * 0.055) + Math.sin(ny * 3.1 + phase) * 0.65) * 0.5 + 0.5;
    const pulse = Math.cos(dist * 0.26 - phase) * 0.5 + 0.5;
    const density = (band * 0.68 + pulse * 0.32) * haloFade * edgeFactor * 0.9;
    if (density < th) return base;
    const th2 = ditherThreshold(dither, gx + 5, gy + 1);
    if (band > 0.68) return (band - 0.68) / 0.32 > th2 ? pal.RED : pal.OCHRE;
    if (band > 0.36) return (band - 0.36) / 0.32 > th2 ? pal.OCHRE : pal.UMBER;
    return th2 < 0.35 ? pal.INK : pal.UMBER;
  }

  // Default: "kilim_drift"
  const warpX = gx * 0.048 + 0.85 * Math.sin(gy * 0.052 + phase);
  const warpY = gy * 0.048 + 0.85 * Math.cos(gx * 0.052 - phase);
  const f1 = Math.sin(warpX + warpY + phase * 0.5);
  const f2 = Math.cos(warpX * 1.3 - warpY * 1.1 - phase);
  const flow = (f1 * 0.55 + f2 * 0.45 + 1) * 0.5;
  const breath = Math.sin(dist * 0.28 - phase) * 0.5 + 0.5;
  const density = (flow * 0.65 + breath * 0.35) * haloFade * edgeFactor * 0.92;
  if (density < th) return base;

  const th2 = ditherThreshold(dither, gx + 3, gy + 5);
  if (flow > 0.62) return (flow - 0.62) / 0.38 > th2 ? pal.RED : pal.OCHRE;
  if (flow > 0.32) return (flow - 0.32) / 0.3 > th2 ? pal.OCHRE : pal.INDIGO;
  return flow < 0.16 && th2 < 0.35 ? pal.SAGE : pal.INDIGO;
}

/** Generative QR Shimmer maintaining >= 4.5:1 scan contrast with seamless t=0/t=1 loop parity. */
export function generativeQrRgb(
  r: number,
  c: number,
  qrN: number,
  t: number,
  dither: UvcDitherName,
  night: boolean,
  pal: ShaderPalette = DEFAULT_SHADER_PALETTE,
): RGB {
  const phaseT = ((t % 1) + 1) % 1;
  if (night) {
    const rad = Math.hypot(r - qrN / 2, c - qrN / 2);
    const e = (Math.sin(rad * 0.45 - 2 * Math.PI * phaseT) + 1) * 0.5;
    const th = ditherThreshold(dither, c, r);
    return e > 0.72 && (e - 0.72) / 0.28 > th ? pal.OCHRE : pal.PAPER;
  }
  const tau = 2 * Math.PI;
  const cr = r - qrN / 2;
  const cc = c - qrN / 2;
  const rad = Math.hypot(cr, cc);
  const ang = Math.atan2(cr, cc);
  const e = (Math.sin(rad * 0.42 - tau * phaseT) * 0.42 + Math.cos((r + c) * 0.32 + tau * phaseT) * 0.33 + Math.sin(ang * 2 + rad * 0.22 - tau * phaseT) * 0.25 + 1) * 0.5;
  const th = ditherThreshold(dither, c, r);
  if (e > 0.78) return (e - 0.78) / 0.22 > th ? pal.OCHRE : pal.RED;
  if (e > 0.44) return (e - 0.44) / 0.34 > th ? pal.RED : pal.INK;
  if (e > 0.25 && th < 0.25) return pal.INDIGO;
  return pal.INK;
}
