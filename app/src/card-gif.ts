// Encoders for recipe cards (card/render.ts): supports PNG, GIF (<=16 colours), and
// lossless Animated WebP (32-frame 10fps seamless loop with procedural dithering & QR shimmer).
import UPNG from "upng-js";
import { GIFEncoder, applyPalette } from "gifenc";
import { renderCard } from "./card";
import { type CardModel } from "./shared/meta";
import { compositeOver } from "./shader/vyshyvanka";
import { paintBand, paintPerimeter1to1, UPA_PALETTE } from "./card/ornament";
import { QUANTUM_PALETTE, renderQuantumFrame, type QuantumSceneMeta } from "./card/quantum";
import { encodeAnimatedWebp, encodeWebpLossless } from "./card-webp";

export const PAPER: [number, number, number] = QUANTUM_PALETTE.PAPER;
export const INK: [number, number, number] = QUANTUM_PALETTE.INK;
export const GRAY: [number, number, number] = [0x6f, 0x6a, 0x5c];
export const SAGE: [number, number, number] = QUANTUM_PALETTE.SAGE;
export const RULE: [number, number, number] = [0xe5, 0xdf, 0xcf];

// Fixed palette (16 slots): covers UPA threads, quantum shader palette (Ochre, Indigo,
// Sage, Paper, Ink), and 4 PT Serif fallback AA stops while keeping GIF GCT <= 16.
const GIF_PALETTE: [number, number, number][] = [
  PAPER,
  UPA_PALETTE.A, UPA_PALETTE.C, UPA_PALETTE.D, UPA_PALETTE.E, UPA_PALETTE.F, UPA_PALETTE.G,
  INK, GRAY, SAGE,
  QUANTUM_PALETTE.OCHRE,
  QUANTUM_PALETTE.INDIGO,
  [192, 190, 182], // paper→ink AA (.25)
  [140, 139, 132], // paper→ink AA (.50)
  [87, 88, 82],    // paper→ink AA (.75)
  [178, 174, 162], // paper→gray AA (.50)
];

const GIF_FRAMES = 16;      // seamless loop for GIF
const GIF_DELAY_MS = 100;   // 10 fps
const WEBP_FRAMES = 32;     // stately 32-frame 3.2s seamless loop for WebP
const WEBP_DELAY_MS = 100;  // 10 fps
const PALETTE_FMT = "rgb565" as const;

export interface CardScene {
  W: number;
  H: number;
  content: Uint8Array; // opaque RGBA base content (paper/invert + foreground text + QR slot)
  unit: string[][];    // band unitCell (A–G; B = paper)
  strip: number;       // legacy strip height (used only when quantum is absent)
  quantum?: QuantumSceneMeta;
}

export function paperCanvas(W: number, H: number, rgb: [number, number, number] = PAPER): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(W * H * 4);
  for (let o = 0; o < out.length; o += 4) {
    out[o] = rgb[0]; out[o + 1] = rgb[1]; out[o + 2] = rgb[2]; out[o + 3] = 255;
  }
  return out;
}

function frameAt(s: CardScene, frameIdx: number, totalFrames: number): Uint8Array<ArrayBuffer> {
  if (s.quantum) {
    const P = Math.max(1, s.unit[0]?.length ?? 1);
    const t = totalFrames > 0 ? frameIdx / totalFrames : 0;
    const shiftStitches = totalFrames > 0 ? Math.floor((frameIdx * P) / totalFrames) : 0;
    return renderQuantumFrame(s.content, s.quantum, t, shiftStitches);
  }
  const phase = totalFrames > 0 ? frameIdx / totalFrames : 0;
  const frame = new Uint8Array(s.content.length);
  frame.set(s.content);
  paintBand(frame, s.W, s.H, 0, s.strip, s.unit, PAPER, phase);
  paintBand(frame, s.W, s.H, s.H - s.strip, s.strip, s.unit, PAPER, (1 - phase) % 1);
  return frame;
}

export function encodeCardPng(s: CardScene): Uint8Array<ArrayBuffer> {
  return new Uint8Array(UPNG.encode([frameAt(s, 0, 1).buffer], s.W, s.H, 0));
}

export function encodeCardGif(s: CardScene): Uint8Array<ArrayBuffer> {
  const enc = GIFEncoder();
  for (let i = 0; i < GIF_FRAMES; i++) {
    const indexed = applyPalette(frameAt(s, i, GIF_FRAMES), GIF_PALETTE, PALETTE_FMT);
    enc.writeFrame(indexed, s.W, s.H, { palette: i === 0 ? GIF_PALETTE : undefined, delay: GIF_DELAY_MS });
  }
  enc.finish();
  return enc.bytes();
}

export function encodeCardWebp(s: CardScene): Uint8Array<ArrayBuffer> {
  const frames: Uint8Array[] = [];
  for (let i = 0; i < WEBP_FRAMES; i++) {
    frames.push(frameAt(s, i, WEBP_FRAMES));
  }
  return encodeAnimatedWebp(s.W, s.H, frames, WEBP_DELAY_MS, PAPER);
}

export function encodeCardStaticWebp(s: CardScene): Uint8Array<ArrayBuffer> {
  return encodeWebpLossless(s.W, s.H, frameAt(s, 0, 1));
}

// PT Serif fallback content: satori renders the card as a transparent layer (padded to
// clear the perimeter), composited over paper.
export async function serifContent(
  model: CardModel, format: string, W: number, H: number,
  extra: { minimal?: boolean; nochrome?: boolean; attribution: string },
): Promise<Uint8Array<ArrayBuffer>> {
  const png = await renderCard(model, { format, layer: true, transparent: true, ...extra }).arrayBuffer();
  const img = UPNG.decode(png);
  const layer = new Uint8Array(UPNG.toRGBA8(img)[0]);
  const content = paperCanvas(W, H);
  if (img.width === W && img.height === H) compositeOver(content, layer);
  return content;
}

export { paintPerimeter1to1 };
