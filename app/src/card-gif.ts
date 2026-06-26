import UPNG from "upng-js";
import { GIFEncoder, applyPalette } from "gifenc";
import { renderCard, bandPx } from "./card";
import { type CardModel } from "./shared/meta";
import { compositeOver } from "./shader/vyshyvanka";
import { pickBorder, paintBorders } from "./shader/embroidery";

// Fixed, palette-restricted colour set. Instead of a 256-colour median-cut
// quantize (which dragged in every text anti-alias shade), every frame snaps to
// this small list: the two-tone embroidery (cream/red/black), the card's
// ink/gray/sage text + accents, white for the QR quiet zone, and a short
// cream->ink ramp so serif glyph edges stay legible. ~12 colours => a 16-slot
// colour table: crisp, poster-like, palette-locked, and much smaller files.
const GIF_PALETTE: [number, number, number][] = [
  [244, 241, 232], // cream  #f4f1e8  background / no-stitch
  [180, 35, 42],   // red    #b4232a  thread
  [26, 26, 26],    // black  #1a1a1a  thread
  [35, 37, 32],    // ink    #232520  proverb text
  [111, 106, 92],  // gray   #6f6a5c  modern / footer / url
  [94, 115, 85],   // sage   #5e7355  accent bar / cursor
  [255, 255, 255], // white  QR quiet zone
  [192, 190, 182], // cream->ink AA (.25)
  [140, 139, 132], // cream->ink AA (.50)
  [87, 88, 82],    // cream->ink AA (.75)
  [178, 174, 162], // cream->gray AA (.50)
];

const FRAMES = 14;          // loop length
const DELAY_MS = 110;       // per-frame delay
const PALETTE_FMT = "rgb565" as const;
const CREAM: [number, number, number] = [244, 241, 232]; // linen background

type RenderExtra = { minimal?: boolean; nochrome?: boolean };
type CardBase = { W: number; H: number; text: Uint8Array; border: ReturnType<typeof pickBorder>; band: number };

// Render the proverb card once in layer mode (transparent bg + extra top/bottom
// padding so text/bar/QR clear the bands) and pick this proverb's UPA border.
// Shared by the GIF and the static PNG so both have the identical рушник design.
async function composeCardBase(model: CardModel, format: string, seedKey: string, extra: RenderExtra = {}): Promise<CardBase> {
  const png = await renderCard(model, { format, layer: true, transparent: true, ...extra }).arrayBuffer();
  const img = UPNG.decode(png);
  const W = img.width, H = img.height;
  const text = new Uint8Array(UPNG.toRGBA8(img)[0]);
  return { W, H, text, border: pickBorder(seedKey), band: bandPx(H) };
}

// One composited frame: cream field → tile the border into top/bottom bands at
// `phase` → composite the proverb on the clean cream center.
function renderCardFrame(b: CardBase, phase: number): Uint8Array {
  const frame = new Uint8Array(b.W * b.H * 4);
  for (let o = 0; o < frame.length; o += 4) {
    frame[o] = CREAM[0]; frame[o + 1] = CREAM[1]; frame[o + 2] = CREAM[2]; frame[o + 3] = 255;
  }
  paintBorders(frame, b.W, b.H, b.band, b.border, phase);
  compositeOver(frame, b.text);
  return frame;
}

// Animated рушник share-card: an authentic Ukrainian embroidery border (from the
// UPA pattern corpus, picked per proverb) is tiled into top + bottom bands that
// frame the card; the proverb sits on the clean cream center. The border gently
// drifts across the loop. The fixed palette rides frame 0 only as the GCT.
export async function makeVyshyvankaGif(model: CardModel, format: string, seedKey = ""): Promise<Uint8Array> {
  const b = await composeCardBase(model, format, seedKey);
  const enc = GIFEncoder();
  for (let i = 0; i < FRAMES; i++) {
    const indexed = applyPalette(renderCardFrame(b, i / FRAMES), GIF_PALETTE, PALETTE_FMT);
    enc.writeFrame(indexed, b.W, b.H, { palette: i === 0 ? GIF_PALETTE : undefined, delay: DELAY_MS });
  }
  enc.finish();
  return enc.bytes();
}

// Static рушник share-card — the GIF's first frame, encoded as a (lossless) PNG so
// the PNG endpoint and OG image carry the same border design as the GIF.
export async function makeVyshyvankaPng(model: CardModel, format: string, seedKey = "", extra: RenderExtra = {}): Promise<Uint8Array> {
  const b = await composeCardBase(model, format, seedKey, extra);
  const frame = renderCardFrame(b, 0);
  return new Uint8Array(UPNG.encode([frame.buffer], b.W, b.H, 0));
}
