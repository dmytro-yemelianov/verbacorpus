// Card-by-recipe pipeline: resolve text (pro/contra), font (Nasinnia bitmap or PT Serif)
// and frame (UPA band), paint an RGBA card and encode it as PNG/GIF, or describe it as JSON.
//
// Degradation (Review Focus 2): if Nasinnia or UPA fail during a render the card is still
// 200 — the text falls back to PT Serif, the frame to a solid band of colour A — and the
// response carries `x-verba-degraded: font|frame|font,frame` with `cache-control: no-store`.
// Only explicit, well-formed requests for something that does not exist or is not allowed
// fail: see `strict` below.
import { CARD_SIZES, CardRequestError, DEFAULT_FONT, SERIF_FONT, type CardSize, type Recipe } from "./recipe";
import { fetchGlyphs, CardFontError, type GlyphSet } from "./glyphs";
import { layoutText, paintText, type TextLayout } from "./bitmap-text";
import { fetchBand, CardFrameError } from "./ornament";
import { loadCorpus, type CorpusEnv } from "../corpus-data";
import { cardModel, type CardModel } from "../shared/meta";
import { qrMatrix } from "../shared/qr";
import { bandPx, cleanForCard } from "../card";
import { encodeCardGif, encodeCardPng, paperCanvas, serifContent, GRAY, INK, RULE, SAGE, type CardScene } from "../card-gif";

export interface CardEnv extends CorpusEnv {
  FONTS?: Fetcher;
  UPA?: Pick<Fetcher, "fetch">;
}

export interface RenderOut {
  format: "png" | "gif" | "json";
  minimal?: boolean;  // no QR / short link / brand line (credits and frame stay)
  nochrome?: boolean; // same as minimal (kept for the legacy thumbnail URLs)
  // Was the font / frame named by the caller? Explicit + missing/forbidden → 4xx;
  // defaulted → degrade. Default: font explicit unless it is the default font; frame explicit.
  explicit?: { font?: boolean; frame?: boolean };
  maxAge?: number;    // cache lifetime of a non-degraded response (seconds); default 86400
}

export const FRAME_ATTRIBUTION = "Hough, 2025 / Габданк-Рогозинський";
export const CONTRA_ATTRIBUTION = "Л. Ставицька, „Українська мова без табу“";
export const SERIF_ATTRIBUTION = "PT Serif — ParaType, OFL-1.1";
const PRO_LICENCE = "verba, CC BY 4.0";
const BRAND = "verba · verbacorpus.org · @VerbaCorpus";
const FALLBACK_UNIT = [["A"]];

// Always requested from Nasinnia alongside the card text, so credits/URLs whose exact
// characters are only known later (font metadata arrives in parallel) still have glyphs.
const UA = "АБВГҐДЕЄЖЗИІЇЙКЛМНОПРСТУФХЦЧШЩЬЮЯ";
const BASE_CHARS = UA + UA.toLowerCase() + "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789" +
  " .,:;!?()[]/-–—…·«»„“”\"'’ʼ&+@×№%";

const CORS = { "access-control-allow-origin": "*", "access-control-expose-headers": "x-verba-degraded" };

// ---------------------------------------------------------------- resolution

interface TextPick { text: string; attribution: string; model: CardModel; qrUrl: string }

async function resolveText(recipe: Recipe, env: CardEnv, host: string): Promise<TextPick> {
  const sep = recipe.text.indexOf(":");
  const corpus = recipe.text.slice(0, sep), local = recipe.text.slice(sep + 1);
  if (corpus === "pro") {
    const { byId, meta } = await loadCorpus(env);
    const p = byId.get(local);
    if (!p) throw new CardRequestError(404, "not_found", `no proverb ${recipe.text}`);
    const model = cardModel(p, { host, lang: recipe.lang, sources: meta?.sources });
    return {
      text: cleanForCard(model.text),
      attribution: model.cite ? `${model.cite} — ${PRO_LICENCE}` : PRO_LICENCE,
      model: { ...model, text: cleanForCard(model.text) },
      qrUrl: model.shortUrl,
    };
  }
  // contra only ever arrives here by an explicit text=contra:… (never picked by default).
  const { contraEntry } = await import("../contra-api");
  let entry;
  try {
    entry = await contraEntry(local, env);
  } catch {
    throw new CardRequestError(503, "unavailable", "contra data is temporarily unavailable");
  }
  if (!entry) throw new CardRequestError(404, "not_found", `no contra entry ${recipe.text}`);
  const text = `${entry.synonym} — ${entry.term}`;
  return { text, attribution: CONTRA_ATTRIBUTION, model: { text, modern: "", footer: "", cite: CONTRA_ATTRIBUTION, qr: "", shortUrl: "" }, qrUrl: "" };
}

interface FontPick { glyphs: GlyphSet | null; attribution: string; degraded: boolean }

type FontMeta = { id?: string; displayName?: string; availability?: string; license?: { id?: string; attribution?: string; redistributionAllowed?: boolean }; source?: { author?: string } };

async function fontMeta(fonts: Fetcher, id: string): Promise<FontMeta | null> {
  const res = await fonts.fetch(`https://upstream/v1/fonts/${encodeURIComponent(id)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`font API ${res.status}`);
  return (await res.json()) as FontMeta;
}

const SERIF: FontPick = { glyphs: null, attribution: SERIF_ATTRIBUTION, degraded: false };

async function resolveFont(recipe: Recipe, env: CardEnv, strict: boolean, chars: string): Promise<FontPick> {
  if (recipe.font === SERIF_FONT) return SERIF;
  const degrade: FontPick = { ...SERIF, degraded: true };
  if (!env.FONTS) return degrade;
  const id = recipe.font.slice("para:".length);
  const [metaR, glyphR] = await Promise.allSettled([fontMeta(env.FONTS, id), fetchGlyphs(env.FONTS, id, chars)]);
  const meta = metaR.status === "fulfilled" ? metaR.value : undefined;
  const notFound = meta === null;
  const restricted = (meta && !(meta.availability === "downloadable" && meta.license?.redistributionAllowed === true)) ||
    (glyphR.status === "rejected" && glyphR.reason instanceof CardFontError && glyphR.reason.code === "font_restricted");
  if (strict && notFound) throw new CardRequestError(404, "font_not_found", `no font ${recipe.font}`);
  if (strict && restricted) throw new CardRequestError(422, "font_restricted", `${recipe.font} is metadata-only; its rasters cannot be used on cards`);
  // Anything else — network, 5xx, malformed body (even a plain TypeError), or a defaulted
  // font that turned out missing/restricted — degrades to PT Serif.
  if (!meta || restricted || glyphR.status !== "fulfilled") return degrade;
  const who = meta.source?.author || meta.license?.attribution || "";
  const name = meta.displayName || id;
  const attribution = [who ? `${name} — ${who}` : name, meta.license?.id].filter(Boolean).join(", ");
  return { glyphs: glyphR.value, attribution, degraded: false };
}

interface FramePick { unit: string[][]; degraded: boolean }

async function resolveFrame(recipe: Recipe, env: CardEnv, strict: boolean): Promise<FramePick> {
  if (!env.UPA) return { unit: FALLBACK_UNIT, degraded: true };
  try {
    return { unit: (await fetchBand(env.UPA as Fetcher, recipe.frame)).unit, degraded: false };
  } catch (e) {
    if (strict && e instanceof CardFrameError && (e.code === "frame_not_found" || e.code === "frame_not_band")) {
      throw new CardRequestError(e.status, e.code, `${recipe.frame}: ${e.code}`);
    }
    return { unit: FALLBACK_UNIT, degraded: true };
  }
}

// Height of the strip paintBand actually draws for this unit in a band of `band` rows
// (same arithmetic), so the bottom strip can sit flush with the card's bottom edge.
export function stripFor(unit: string[][], band: number): number {
  const k = Math.max(1, Math.ceil(unit.length / band));
  const rows = Math.ceil(unit.length / k);
  const stitch = Math.max(1, Math.floor(band / rows));
  return Math.min(band, stitch * rows);
}

// ---------------------------------------------------------------- bitmap layout

interface Spec { pad: number; align: "left" | "center"; maxScale: number; qr: number; qrBeside: boolean; attrScale: number; brand: boolean }

const SPECS: Record<CardSize, Spec> = {
  fb:       { pad: 72, align: "left",   maxScale: 7, qr: 132, qrBeside: true,  attrScale: 2, brand: false },
  square:   { pad: 90, align: "left",   maxScale: 8, qr: 144, qrBeside: false, attrScale: 2, brand: false },
  story:    { pad: 80, align: "center", maxScale: 9, qr: 180, qrBeside: false, attrScale: 2, brand: false },
  yt:       { pad: 80, align: "left",   maxScale: 7, qr: 132, qrBeside: true,  attrScale: 2, brand: false },
  sticker:  { pad: 34, align: "center", maxScale: 5, qr: 0,   qrBeside: false, attrScale: 1, brand: false },
  telegram: { pad: 80, align: "left",   maxScale: 7, qr: 0,   qrBeside: false, attrScale: 2, brand: true },
};

const glyphW = (g: GlyphSet, ch: string) => (g.glyphs.get(ch) ?? g.fallback).advanceX;
const measure = (s: string, g: GlyphSet, scale: number) => Array.from(s).reduce((w, ch) => w + glyphW(g, ch) * scale, 0);

// Greedy word wrap for the small credit lines (scale 1 allowed, unlike layoutText).
// Credits are joined with " · " and a separator stays on the line of the part it ends.
function wrapCredits(parts: string[], g: GlyphSet, scale: number, maxW: number, maxLines: number): string[] {
  const words: string[] = [];
  parts.forEach((part, i) => {
    const ws = part.split(/ +/).filter(Boolean);
    if (i < parts.length - 1 && ws.length) ws[ws.length - 1] += " ·";
    words.push(...ws);
  });
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const cand = cur ? `${cur} ${w}` : w;
    if (!cur || measure(cand, g, scale) <= maxW) { cur = cand; continue; }
    lines.push(cur);
    cur = w;
  }
  if (cur) lines.push(cur);
  // A line still too wide (one very long word) or the last kept line of an overflow ends in "…".
  const ellipsize = (l: string) => {
    const a = Array.from(l);
    while (a.length && measure(a.join("").trimEnd() + "…", g, scale) > maxW) a.pop();
    return a.join("").trimEnd() + "…";
  };
  const out = lines.slice(0, maxLines).map((l) => (measure(l, g, scale) > maxW ? ellipsize(l) : l));
  if (lines.length > maxLines) out[maxLines - 1] = ellipsize(out[maxLines - 1]!);
  return out;
}

const lineLayout = (lines: string[], scale: number): TextLayout => ({ scale, lines, truncated: false, lineGap: 0 });

function fillRect(rgba: Uint8Array, W: number, H: number, x0: number, y0: number, w: number, h: number, rgb: [number, number, number]) {
  for (let y = Math.max(0, y0); y < Math.min(H, y0 + h); y++) {
    for (let x = Math.max(0, x0); x < Math.min(W, x0 + w); x++) {
      const o = (y * W + x) * 4;
      rgba[o] = rgb[0]; rgba[o + 1] = rgb[1]; rgba[o + 2] = rgb[2]; rgba[o + 3] = 255;
    }
  }
}

function bitmapContent(
  size: CardSize, W: number, H: number, strip: number, g: GlyphSet,
  text: string, credits: string[], qrUrl: string, chrome: boolean,
): Uint8Array<ArrayBuffer> {
  const s = SPECS[size];
  const rgba = paperCanvas(W, H);
  const gap = Math.round(H * 0.035);
  const small = Math.max(6, Math.round(gap * 0.6));
  const left = s.pad, right = W - s.pad, cw = right - left;
  const top = strip + gap;
  let bottom = H - strip - gap;
  const cellH = g.cell.height;
  const centreX = Math.round(W / 2);

  // Credits: text source · frame · font, small, at the very bottom of the content area.
  const creditLines = wrapCredits(credits, g, s.attrScale, cw, 3);
  bottom -= creditLines.length * cellH * s.attrScale;
  paintText(rgba, W, H, lineLayout(creditLines, s.attrScale), g, { x: s.align === "center" ? centreX : left, y: bottom }, s.align, GRAY);
  bottom -= small;

  if (s.brand && chrome) {
    bottom -= cellH * 2;
    paintText(rgba, W, H, lineLayout([BRAND], 2), g, { x: left, y: bottom }, "left", SAGE);
    bottom -= small;
    fillRect(rgba, W, H, left, bottom - 2, cw, 2, RULE);
    bottom -= 2 + small;
  }

  let textRight = right;
  if (s.qr && chrome && qrUrl) {
    const m = qrMatrix(qrUrl);
    const n = m.length;
    const mod = Math.max(1, Math.floor(s.qr / n));
    const q = mod * n;
    const label = qrUrl.replace(/^https?:\/\//, "");
    const labelH = cellH;
    const qx = s.qrBeside || s.align === "left" ? right - q : Math.round(centreX - q / 2);
    const qy = bottom - labelH - small - q;
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (m[r]![c]) fillRect(rgba, W, H, qx + c * mod, qy + r * mod, mod, mod, SAGE);
    paintText(rgba, W, H, lineLayout([label], 1), g, { x: Math.round(qx + q / 2), y: bottom - labelH }, "center", GRAY);
    if (s.qrBeside) textRight = qx - gap;
    else bottom = qy - gap;
  }

  const box = { width: textRight - left, height: bottom - top };
  const layout = layoutText(text, g, box, { maxScale: s.maxScale, minScale: 2, lineGap: 1 });
  const rowH = cellH * layout.scale + layout.lineGap * layout.scale;
  const blockH = layout.lines.length * rowH - layout.lineGap * layout.scale;
  const y = top + Math.max(0, Math.floor((box.height - blockH) / 2));
  const x = s.align === "center" ? Math.round(left + box.width / 2) : left;
  paintText(rgba, W, H, layout, g, { x, y }, s.align, INK);
  return rgba;
}

// ---------------------------------------------------------------- entry point

function errorResponse(e: CardRequestError): Response {
  return new Response(JSON.stringify({ error: { code: e.code, message: e.message } }), {
    status: e.status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...CORS },
  });
}

export async function renderCard(recipe: Recipe, env: CardEnv, host: string, out: RenderOut): Promise<Response> {
  try {
    const strictFont = out.explicit?.font ?? recipe.font !== DEFAULT_FONT;
    const strictFrame = out.explicit?.frame ?? true;
    const chrome = !out.minimal && !out.nochrome;

    const text = await resolveText(recipe, env, host);
    const chars = text.text + text.attribution + text.qrUrl + BRAND + BASE_CHARS;
    const [font, frame] = await Promise.all([resolveFont(recipe, env, strictFont, chars), resolveFrame(recipe, env, strictFrame)]);

    const attribution = [text.attribution, ...(frame.degraded ? [] : [FRAME_ATTRIBUTION]), font.attribution];
    const degraded = [...(font.degraded ? ["font"] : []), ...(frame.degraded ? ["frame"] : [])];
    const headers: Record<string, string> = { ...CORS };
    if (degraded.length) headers["x-verba-degraded"] = degraded.join(",");
    const maxAge = out.maxAge ?? 86400;
    headers["cache-control"] = degraded.length ? "no-store" : `public, max-age=${maxAge}${maxAge > 86400 ? ", immutable" : ""}`;

    if (out.format === "json") {
      return new Response(JSON.stringify({ recipe, attribution, degraded }), {
        headers: { ...headers, "content-type": "application/json; charset=utf-8" },
      });
    }

    const { W, H } = CARD_SIZES[recipe.size];
    const strip = stripFor(frame.unit, bandPx(H));
    const content = font.glyphs
      ? bitmapContent(recipe.size, W, H, strip, font.glyphs, text.text, attribution, text.qrUrl, chrome)
      : await serifContent(text.model, recipe.size, W, H, { minimal: out.minimal, nochrome: out.nochrome, attribution: attribution.join(" · ") });
    const scene: CardScene = { W, H, content, unit: frame.unit, strip };
    const bytes = out.format === "gif" ? encodeCardGif(scene) : encodeCardPng(scene);
    return new Response(bytes, { headers: { ...headers, "content-type": out.format === "gif" ? "image/gif" : "image/png" } });
  } catch (e) {
    if (e instanceof CardRequestError) return errorResponse(e);
    throw e;
  }
}

