// Encoders for recipe cards (card/render.ts): a card "scene" is the finished content
// (paper + text + QR + credits) plus the ornament band that frames it top and bottom.
// PNG = the scene at phase 0; GIF = the band drifting across a short loop.
import UPNG from "upng-js";
import { GIFEncoder, applyPalette } from "gifenc";
import { renderCard } from "./card";
import { type CardModel } from "./shared/meta";
import { compositeOver } from "./shader/vyshyvanka";
import { paintBand, UPA_PALETTE } from "./card/ornament";

export const PAPER: [number, number, number] = [0xf4, 0xf1, 0xe8];
export const INK: [number, number, number] = [0x23, 0x25, 0x20];
export const GRAY: [number, number, number] = [0x6f, 0x6a, 0x5c];
export const SAGE: [number, number, number] = [0x5e, 0x73, 0x55];
export const RULE: [number, number, number] = [0xe5, 0xdf, 0xcf];

// Fixed palette (≤16 slots): paper, the UPA thread colours, the card's ink/gray/sage/rule,
// plus a short paper→ink ramp so the PT Serif fallback's anti-aliased edges stay legible.
// The bitmap pipeline only ever produces exact palette colours.
const GIF_PALETTE: [number, number, number][] = [
  PAPER,
  UPA_PALETTE.A, UPA_PALETTE.C, UPA_PALETTE.D, UPA_PALETTE.E, UPA_PALETTE.F, UPA_PALETTE.G,
  INK, GRAY, SAGE, RULE,
  [192, 190, 182], // paper→ink AA (.25)
  [140, 139, 132], // paper→ink AA (.50)
  [87, 88, 82],    // paper→ink AA (.75)
  [178, 174, 162], // paper→gray AA (.50)
];

const FRAMES = 14;          // loop length
const DELAY_MS = 110;       // per-frame delay
const PALETTE_FMT = "rgb565" as const;

export interface CardScene {
  W: number;
  H: number;
  content: Uint8Array; // opaque RGBA, paper-filled, nothing drawn inside the band strips
  unit: string[][];    // band unitCell (A–G; B = paper)
  strip: number;       // painted strip height, top rows [0,strip) and bottom rows [H-strip,H)
}

export function paperCanvas(W: number, H: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(W * H * 4);
  for (let o = 0; o < out.length; o += 4) {
    out[o] = PAPER[0]; out[o + 1] = PAPER[1]; out[o + 2] = PAPER[2]; out[o + 3] = 255;
  }
  return out;
}

// One frame: the content with both strips painted; the bottom strip drifts the other way.
function frameAt(s: CardScene, phase: number): Uint8Array<ArrayBuffer> {
  const frame = new Uint8Array(s.content.length);
  frame.set(s.content);
  paintBand(frame, s.W, s.H, 0, s.strip, s.unit, PAPER, phase);
  paintBand(frame, s.W, s.H, s.H - s.strip, s.strip, s.unit, PAPER, (1 - phase) % 1);
  return frame;
}

export function encodeCardPng(s: CardScene): Uint8Array<ArrayBuffer> {
  return new Uint8Array(UPNG.encode([frameAt(s, 0).buffer], s.W, s.H, 0));
}

export function encodeCardGif(s: CardScene): Uint8Array<ArrayBuffer> {
  const enc = GIFEncoder();
  for (let i = 0; i < FRAMES; i++) {
    const indexed = applyPalette(frameAt(s, i / FRAMES), GIF_PALETTE, PALETTE_FMT);
    enc.writeFrame(indexed, s.W, s.H, { palette: i === 0 ? GIF_PALETTE : undefined, delay: DELAY_MS });
  }
  enc.finish();
  return enc.bytes();
}

// PT Serif fallback content: satori renders the card as a transparent layer (padded to
// clear the bands), composited over paper.
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
