// Card routes: validate a recipe, check the font licence, proxy the Verba Worker's
// /card/render.{png,gif,json}.
import { ApiError, parseGlobalId } from "./contract.js";
import type { Corpus } from "./contract.js";
import type { Adapter } from "./adapters/types.js";

export const CARD_SIZES = ["fb", "square", "story", "yt", "sticker", "telegram"] as const;
export const CARD_TIMEOUT_MS = 15000;
export type CardExt = "png" | "gif" | "json";

const FRAME_RE = /^non:[A-Za-z0-9_.\-]+$/;
const FONT_RE = /^para:[A-Za-z0-9_.\-]+$/;
const bad = (m: string) => new ApiError(400, "invalid_request", m);

export interface CardRecipe {
  text: string;
  frame?: string;
  font?: string;
  size?: string;
  lang?: string;
}

export function validateText(text: string): string {
  const g = parseGlobalId(text);
  if (!g || (g.corpus !== "pro" && g.corpus !== "contra") || /[\s/]/.test(g.localId)) {
    throw bad("text id must be pro:<id> or contra:<id>");
  }
  return text;
}

export function recipeFrom(text: string, qp: URLSearchParams): CardRecipe {
  const r: CardRecipe = { text: validateText(text) };
  const frame = qp.get("frame")?.trim();
  if (frame) {
    if (!FRAME_RE.test(frame)) throw bad("frame must be non:<patternId>");
    r.frame = frame;
  }
  const font = qp.get("font")?.trim();
  if (font) {
    if (font !== "pt-serif" && !FONT_RE.test(font)) throw bad("font must be para:<fontId> or pt-serif");
    r.font = font;
  }
  const size = qp.get("size")?.trim();
  if (size) {
    if (!(CARD_SIZES as readonly string[]).includes(size)) throw bad(`size must be one of ${CARD_SIZES.join(", ")}`);
    r.size = size;
  }
  const lang = qp.get("lang")?.trim();
  if (lang) {
    if (lang !== "uk" && lang !== "en") throw bad("lang must be uk or en");
    r.lang = lang;
  }
  return r;
}

// Fonts whose licence is metadata-only may not be embedded in a card (§5.3).
export async function checkFont(adapters: Partial<Record<Corpus, Adapter>>, font: string | undefined): Promise<void> {
  if (!font || font === "pt-serif") return;
  const para = adapters.para;
  if (!para) throw new ApiError(503, "unavailable", 'corpus "para" is not available');
  const item = await para.get(font.slice("para:".length));
  if (!item) throw new ApiError(404, "not_found", "font not found");
  if (item.licence.status === "metadata-only") {
    throw new ApiError(422, "font_restricted", "this font is metadata-only and cannot be used on cards");
  }
}

const PASS_HEADERS = ["content-type", "cache-control", "x-verba-degraded"];

export async function proxyCard(
  pro: Pick<Fetcher, "fetch"> | undefined,
  recipe: CardRecipe,
  ext: CardExt,
): Promise<Response> {
  if (!pro) throw new ApiError(503, "unavailable", "card renderer is not available");
  const q = new URLSearchParams({ text: recipe.text });
  for (const k of ["frame", "font", "size", "lang"] as const) if (recipe[k]) q.set(k, recipe[k]!);
  // pro.verbacorpus.org is the canonical Verba host: the apex would answer with a 308 hop.
  const url = `https://pro.verbacorpus.org/card/render.${ext}?${q}`;
  let res: Response;
  try {
    res = await pro.fetch(new Request(url, { signal: AbortSignal.timeout(CARD_TIMEOUT_MS) }));
  } catch (e) {
    throw new ApiError(503, "unavailable", `card renderer failed: ${(e as Error).message}`);
  }
  if (res.status >= 500) throw new ApiError(503, "unavailable", `card renderer responded ${res.status}`);
  const headers = new Headers({
    "access-control-allow-origin": "*",
    "access-control-expose-headers": "x-verba-seed, x-verba-degraded",
  });
  for (const h of PASS_HEADERS) {
    const v = res.headers.get(h);
    if (v) headers.set(h, v);
  }
  if (!res.ok) headers.set("cache-control", "no-store");
  return new Response(res.body, { status: res.status, headers });
}
