// A card recipe: which text, which ornament frame, which font, which size.
import { pickFrame } from "./ornament";
import type { QuantumDitherName, QuantumShaderName } from "./quantum";

export type CardSize = "fb" | "square" | "story" | "yt" | "sticker" | "telegram";
export type CardLang = "uk" | "en";
export type CardStyle = "base" | "color" | "big" | "shadowS" | "shadowD" | "stitch" | "invert" | "marker";
export type CardAlign = "left" | "center" | "right" | "stairR" | "stairL";

export const CARD_STYLES: readonly CardStyle[] = ["base", "color", "big", "shadowS", "shadowD", "stitch", "invert", "marker"];
export const CARD_ALIGNS: readonly CardAlign[] = ["left", "center", "right", "stairR", "stairL"];
export const CARD_SHADERS: readonly QuantumShaderName[] = ["kilim_drift", "rushnyk_aura", "halftone_brutalist", "indigo_night", "polissya_moss"];
export const CARD_DITHERS: readonly QuantumDitherName[] = ["plakhta", "bayer8", "aida", "bayer4"];

export interface Recipe {
  text: string; // "pro:<id>" | "contra:<id>"
  frame: string; // "non:<id>"
  font: string; // "para:<id>" | "pt-serif"
  size: CardSize;
  lang: CardLang;
  style?: CardStyle;
  align?: CardAlign;
  hook?: string; // "auto" | "none" | exact substring
  shader?: QuantumShaderName;
  dither?: QuantumDitherName;
}

export const DEFAULT_FONT = "para:cozette-13x15";
export const SERIF_FONT = "pt-serif";

export const CARD_SIZES: Record<CardSize, { W: number; H: number }> = {
  fb: { W: 1200, H: 630 },
  square: { W: 1080, H: 1080 },
  story: { W: 1080, H: 1920 },
  yt: { W: 1280, H: 720 },
  sticker: { W: 512, H: 512 },
  telegram: { W: 1200, H: 630 },
};

export const isCardSize = (s: string): s is CardSize => Object.prototype.hasOwnProperty.call(CARD_SIZES, s);

/** A request-level error with an HTTP status and an API error code. */
export class CardRequestError extends Error {
  constructor(public status: number, public code: string, message?: string) {
    super(message ?? code);
    this.name = "CardRequestError";
  }
}

const TEXT_RE = /^(pro|contra):[^\s/]+$/;
const FRAME_RE = /^non:[A-Za-z0-9_.\-]+$/;
const FONT_RE = /^para:[A-Za-z0-9_.\-]+$/;

const bad = (message: string) => new CardRequestError(400, "invalid_request", message);

/**
 * Builds a recipe from query parameters. `text` is required; `frame` defaults to
 * pickFrame(seedKey), `font` to para:cozette-13x15, `size` to fb, `lang` to uk.
 * Anything malformed or unknown throws CardRequestError 400 invalid_request.
 */
export function parseRecipe(qp: URLSearchParams, defaults: { seedKey: string }): Recipe {
  const text = qp.get("text")?.trim() ?? "";
  if (!text) throw bad("text is required (pro:<id> or contra:<id>)");
  if (!TEXT_RE.test(text)) throw bad("text must be pro:<id> or contra:<id>");

  const frame = qp.get("frame")?.trim() || pickFrame(defaults.seedKey);
  if (!FRAME_RE.test(frame)) throw bad("frame must be non:<patternId>");

  const font = qp.get("font")?.trim() || DEFAULT_FONT;
  if (font !== SERIF_FONT && !FONT_RE.test(font)) throw bad("font must be para:<fontId> or pt-serif");

  const size = qp.get("size")?.trim() || "fb";
  if (!isCardSize(size)) throw bad(`size must be one of ${Object.keys(CARD_SIZES).join(", ")}`);

  const lang = qp.get("lang")?.trim() || "uk";
  if (lang !== "uk" && lang !== "en") throw bad("lang must be uk or en");

  const out: Recipe = { text, frame, font, size, lang };
  const style = qp.get("style")?.trim();
  if (style) {
    if (!(CARD_STYLES as readonly string[]).includes(style)) throw bad(`style must be one of ${CARD_STYLES.join(", ")}`);
    out.style = style as CardStyle;
  }
  const align = qp.get("align")?.trim();
  if (align) {
    if (!(CARD_ALIGNS as readonly string[]).includes(align)) throw bad(`align must be one of ${CARD_ALIGNS.join(", ")}`);
    out.align = align as CardAlign;
  }
  const hook = qp.get("hook");
  if (hook !== null && hook !== "") out.hook = hook;
  const shader = qp.get("shader")?.trim();
  if (shader) {
    if (!(CARD_SHADERS as readonly string[]).includes(shader)) throw bad(`shader must be one of ${CARD_SHADERS.join(", ")}`);
    out.shader = shader as QuantumShaderName;
  }
  const dither = qp.get("dither")?.trim();
  if (dither) {
    if (!(CARD_DITHERS as readonly string[]).includes(dither)) throw bad(`dither must be one of ${CARD_DITHERS.join(", ")}`);
    out.dither = dither as QuantumDitherName;
  }

  return out;
}
