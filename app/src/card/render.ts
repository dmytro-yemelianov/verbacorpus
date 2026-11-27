// Card-by-recipe pipeline: resolve text (pro/contra), font (Nasinnia bitmap or PT Serif)
// and frame (UPA band), paint an RGBA card and encode it as PNG/GIF, or describe it as JSON.
//
// Degradation (Review Focus 2): if Nasinnia or UPA fail during a render the card is still
// 200 — the text falls back to PT Serif, the frame to a solid band of colour A — and the
// response carries `x-verba-degraded: font|frame|font,frame` with `cache-control: no-store`.
// Only explicit, well-formed requests for something that does not exist or is not allowed
// fail: see `strict` below.
import { CARD_SIZES, CardRequestError, DEFAULT_FONT, SERIF_FONT, type CardAlign, type CardSize, type CardStyle, type Recipe } from "./recipe";
import { fetchGlyphs, CardFontError, type GlyphSet } from "./glyphs";
import { layoutStyled, paintStyled, styledBlockHeight, tokenizeStyled } from "./styled-text";
import { upstreamSignal } from "../upstream";
import { fetchBand, CardFrameError, perimeterCells } from "./ornament";
import { loadCorpus, type CorpusEnv } from "../corpus-data";
import { cardModel, type CardModel } from "../shared/meta";
import { qrMatrix } from "../shared/qr";
import { bandPx, cleanForCard } from "../card";
import { encodeCardGif, encodeCardPng, encodeCardWebp, paperCanvas, serifContent, INK, PAPER, type CardScene } from "../card-gif";
import { computeDistanceGrid, QUANTUM_PALETTE, type QuantumSceneMeta } from "./quantum";

export interface CardEnv extends CorpusEnv {
  FONTS?: Fetcher;
  UPA?: Pick<Fetcher, "fetch">;
}

export interface RenderOut {
  format: "png" | "gif" | "webp" | "json";
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

interface TextPick { text: string; hook: string | null; attribution: string; model: CardModel; qrUrl: string; corpus: "pro" | "contra" }

function pickHook(rawText: string, modelHook: string | undefined, requested: string | undefined): string | null {
  if (!requested || requested === "auto") return modelHook && rawText.includes(modelHook) ? modelHook : null;
  if (requested === "none") return null;
  if (!rawText.includes(requested)) throw new CardRequestError(400, "invalid_hook", "hook must be an exact substring of text");
  return requested;
}

async function resolveText(recipe: Recipe, env: CardEnv, host: string): Promise<TextPick> {
  const sep = recipe.text.indexOf(":");
  const corpus = recipe.text.slice(0, sep), local = recipe.text.slice(sep + 1);
  if (corpus === "pro") {
    const { byId, meta } = await loadCorpus(env);
    const p = byId.get(local);
    if (!p) throw new CardRequestError(404, "not_found", `no proverb ${recipe.text}`);
    const model = cardModel(p, { host, lang: recipe.lang, sources: meta?.sources });
    const text = cleanForCard(model.text);
    const hook = pickHook(text, (p as { hook?: string }).hook, recipe.hook);
    return {
      text,
      hook,
      attribution: model.cite ? `${model.cite} — ${PRO_LICENCE}` : PRO_LICENCE,
      model: { ...model, text },
      qrUrl: model.shortUrl,
      corpus: "pro",
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
  const hook = pickHook(text, entry.synonym, recipe.hook);
  const qrUrl = `https://contra.verbacorpus.org/?spelling=${encodeURIComponent(entry.synonym)}`;
  return {
    text,
    hook,
    attribution: CONTRA_ATTRIBUTION,
    model: { text, modern: "", footer: "", cite: CONTRA_ATTRIBUTION, qr: "", shortUrl: qrUrl },
    qrUrl,
    corpus: "contra",
  };
}

interface FontPick { glyphs: GlyphSet | null; attribution: string; degraded: boolean }

type FontMeta = { id?: string; displayName?: string; availability?: string; license?: { id?: string; attribution?: string; redistributionAllowed?: boolean }; source?: { author?: string } };

async function fontMeta(fonts: Fetcher, id: string): Promise<FontMeta | null> {
  const res = await fonts.fetch(`https://upstream/v1/fonts/${encodeURIComponent(id)}`, { signal: upstreamSignal() });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`font API ${res.status}`);
  return (await res.json()) as FontMeta;
}

const SERIF: FontPick = { glyphs: null, attribution: SERIF_ATTRIBUTION, degraded: false };

async function resolveFont(recipe: Recipe, env: CardEnv, strict: boolean, chars: string | null): Promise<FontPick> {
  if (recipe.font === SERIF_FONT) return SERIF;
  const degrade: FontPick = { ...SERIF, degraded: true };
  if (!env.FONTS) return degrade;
  const id = recipe.font.slice("para:".length);
  // chars === null: metadata only (json cards never draw, so no glyph fetch).
  const [metaR, glyphR] = await Promise.allSettled([
    fontMeta(env.FONTS, id),
    chars === null ? Promise.resolve(null as GlyphSet | null) : fetchGlyphs(env.FONTS, id, chars),
  ]);
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

// Short-URL label under the QR: scale 2 on tall cards (story, anything >= 1080 px high), else 1.
export const qrLabelScale = (H: number): number => (H >= 1080 ? 2 : 1);

// Where the short-URL label goes. The right edge never passes `right` (= W - margin, the QR's right margin):
// the largest scale (<= preferred, >= 1) whose width fits is used, and the label is right-aligned to the QR's
// right edge (qx + q) - or centred under a centred QR when that still stays inside [margin, right].
export function qrLabelLayout(
  measureW: (scale: number) => number, preferred: number,
  qx: number, q: number, centred: boolean, margin: number, right: number,
): { scale: number; x: number; width: number } {
  let scale = preferred;
  while (scale > 1 && measureW(scale) > right - margin) scale--;
  const width = measureW(scale);
  let x = qx + q - width;
  if (centred) {
    const cx = Math.round(qx + q / 2 - width / 2);
    if (cx >= margin && cx + width <= right) x = cx;
  }
  x = Math.min(x, right - width);
  return { scale, x: Math.max(margin, x), width };
}

// QR + label placement for a size with an n-module matrix; null when the size draws no QR.
export function qrPlacement(size: CardSize, W: number, H: number, n: number, measureW: (scale: number) => number) {
  const s = SPECS[size];
  if (!s.qr) return null;
  const left = s.pad, right = W - s.pad;
  const mod = Math.max(1, Math.floor(s.qr / n));
  const q = mod * n;
  const centred = !(s.qrBeside || s.align === "left");
  const qx = centred ? Math.round(W / 2 - q / 2) : right - q;
  return { mod, q, qx, right, label: qrLabelLayout(measureW, qrLabelScale(H), qx, q, centred, left, right) };
}

// Scans interior grid cells [T .. GW-T) x [T .. GH-T) for any non-substrate foreground pixels
// (text, shadows, markers, QR) to construct the exact occupancy mask for protective halo SDF.
function buildForegroundMask(
  rgba: Uint8Array,
  W: number,
  H: number,
  GW: number,
  GH: number,
  M: number,
  substrate: [number, number, number],
): Uint8Array {
  const mask = new Uint8Array(GW * GH);
  const [sr, sg, sb] = substrate;
  for (let gy = 0; gy < GH; gy++) {
    const y0 = gy * M;
    const y1 = Math.min(H, y0 + M);
    for (let gx = 0; gx < GW; gx++) {
      const x0 = gx * M;
      const x1 = Math.min(W, x0 + M);
      let hit = false;
      for (let py = y0; py < y1 && !hit; py++) {
        for (let px = x0; px < x1; px++) {
          const o = (py * W + px) * 4;
          if (rgba[o] !== sr || rgba[o + 1] !== sg || rgba[o + 2] !== sb) {
            hit = true;
            break;
          }
        }
      }
      if (hit) mask[gy * GW + gx] = 1;
    }
  }
  return mask;
}

function bitmapContent(
  size: CardSize,
  W: number,
  H: number,
  unit: string[][],
  g: GlyphSet,
  text: string,
  hook: string | null,
  style: CardStyle,
  align: CardAlign,
  qrUrl: string,
  chrome: boolean,
  corpus: "pro" | "contra",
): { content: Uint8Array<ArrayBuffer>; quantum: QuantumSceneMeta } {
  const s = SPECS[size];
  const M = size === "sticker" ? 4 : 8; // 8px quantum on all full cards (4px on 512 sticker)
  const GW = Math.ceil(W / M);
  const GH = Math.ceil(H / M);
  const T = perimeterCells(unit);
  const invert = style === "invert";
  const substrate = invert ? QUANTUM_PALETTE.DARK_BG : PAPER;
  const rgba = paperCanvas(W, H, substrate);

  // Content safe margins snapped to M-pixel quantum cells (no text/QR credit clutter on card)
  const padCells = Math.max(T + 4, Math.round(s.pad / M));
  const leftCells = padCells;
  const rightCells = GW - padCells;
  const topCells = T + 4;
  let bottomCells = GH - T - 4;
  let textRightCells = rightCells;

  // Single QR code aligned strictly 1:1 (1 module = 1 cell = M x M px)
  let qrMeta: QuantumSceneMeta["qr"] | undefined;
  const drawQr = (size === "telegram" || s.qr > 0) && chrome && Boolean(qrUrl);
  if (drawQr) {
    const m = qrMatrix(qrUrl);
    const qrN = m.length;
    const qrBeside = s.qrBeside || size === "telegram";
    let qrGX: number;
    let qrGY: number;
    if (size === "story" || (!qrBeside && align === "center")) {
      qrGX = Math.floor((GW - qrN) / 2);
      qrGY = GH - T - qrN - 5;
    } else if (qrBeside) {
      qrGX = rightCells - qrN;
      qrGY = Math.max(T + 3, Math.floor((GH - qrN) / 2));
    } else {
      qrGX = GW - T - qrN - 4;
      qrGY = GH - T - qrN - 4;
    }

    const qrInk = invert ? PAPER : INK;
    for (let r = 0; r < qrN; r++) {
      for (let c = 0; c < qrN; c++) {
        if (!m[r]?.[c]) continue;
        const py0 = (qrGY + r) * M;
        const px0 = (qrGX + c) * M;
        for (let dy = 0; dy < M; dy++) {
          const py = py0 + dy;
          if (py < 0 || py >= H) continue;
          for (let dx = 0; dx < M; dx++) {
            const px = px0 + dx;
            if (px < 0 || px >= W) continue;
            const o = (py * W + px) * 4;
            rgba[o] = qrInk[0]; rgba[o + 1] = qrInk[1]; rgba[o + 2] = qrInk[2]; rgba[o + 3] = 255;
          }
        }
      }
    }
    qrMeta = { gx: qrGX, gy: qrGY, n: qrN, matrix: m };
    if (qrBeside) textRightCells = Math.max(leftCells + 20, qrGX - 4);
    else bottomCells = Math.max(topCells + 20, qrGY - 4);
  }

  const boxLeft = leftCells * M;
  const boxW = Math.max(M * 16, (textRightCells - leftCells) * M);
  const boxTop = topCells * M;
  const boxH = Math.max(M * 16, (bottomCells - topCells) * M);
  const cellH = g.cell.height;

  const tokens = tokenizeStyled(text, hook);
  const lines = layoutStyled(tokens, g, { width: boxW, height: boxH }, style, {
    maxScale: M,
    minScale: Math.max(2, Math.floor(M / 2)),
    lineGap: 2,
  });
  const blockH = styledBlockHeight(lines, cellH);
  const y = boxTop + Math.floor(Math.max(0, boxH - blockH) / (2 * M)) * M;
  paintStyled(rgba, W, H, lines, g, { left: boxLeft, width: boxW, y }, align, style);

  const fgMask = buildForegroundMask(rgba, W, H, GW, GH, M, substrate);
  const dist = computeDistanceGrid(fgMask, GW, GH);

  return {
    content: rgba,
    quantum: { W, H, M, GW, GH, T, corpus, invert, dist, qr: qrMeta, unit },
  };
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
    const [font, frame] = await Promise.all([
      resolveFont(recipe, env, strictFont, out.format === "json" ? null : chars),
      resolveFrame(recipe, env, strictFrame),
    ]);

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
    const style = recipe.style ?? "color";
    const align = recipe.align ?? SPECS[recipe.size].align;

    let scene: CardScene;
    if (font.glyphs) {
      const built = bitmapContent(recipe.size, W, H, frame.unit, font.glyphs, text.text, text.hook, style, align, text.qrUrl, chrome, text.corpus);
      scene = { W, H, content: built.content, unit: frame.unit, strip, quantum: built.quantum };
    } else {
      const content = await serifContent(text.model, recipe.size, W, H, { minimal: out.minimal, nochrome: out.nochrome, attribution: attribution.join(" · ") });
      const M = recipe.size === "sticker" ? 4 : 8;
      const GW = Math.ceil(W / M), GH = Math.ceil(H / M);
      scene = {
        W,
        H,
        content,
        unit: frame.unit,
        strip,
        quantum: {
          W,
          H,
          M,
          GW,
          GH,
          T: perimeterCells(frame.unit),
          corpus: text.corpus,
          invert: false,
          noBackgroundShader: true,
          dist: new Float32Array(GW * GH),
          unit: frame.unit,
        },
      };
    }

    const bytes =
      out.format === "webp" ? encodeCardWebp(scene)
      : out.format === "gif" ? encodeCardGif(scene)
      : encodeCardPng(scene);
    const contentType =
      out.format === "webp" ? "image/webp"
      : out.format === "gif" ? "image/gif"
      : "image/png";
    return new Response(bytes, { headers: { ...headers, "content-type": contentType } });
  } catch (e) {
    if (e instanceof CardRequestError) return errorResponse(e);
    throw e;
  }
}

