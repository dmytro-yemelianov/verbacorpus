import { detectFontGuides } from "./auto-guides";
import { REGIONS } from "./regions";
import {
  blankGlyph,
  unpack,
  pack,
  type FontSummary,
  type Glyph,
} from "./model";

// A font's maximum raster may be a logo or control picture, not a letter cell.
// Keep that source metadata intact and derive a separate editing frame.
export function editingProfile(font: FontSummary, samples: Glyph[]) {
  const letters = samples.filter((g) =>
    g.labels.some((l) => l.kind === "unicode" && /^[A-Za-z0-9]$/.test(l.value)),
  );
  const usable = (letters.length ? letters : samples).filter(
    (g) =>
      g.width > 0 && g.height > 0 && g.rows.some((r) => /[1-9a-f]/i.test(r)),
  );
  if (!usable.length) return font;
  const quantile = (values: number[], p: number) => {
    values.sort((a, b) => a - b);
    return values[Math.floor((values.length - 1) * p)];
  };
  return {
    ...font,
    cell: {
      ...font.cell,
      width: quantile(
        usable.map((g) => g.width),
        letters.length ? 1 : 0.95,
      ),
      height: quantile(
        usable.map((g) => g.height),
        letters.length ? 1 : 0.95,
      ),
    },
    metrics: {
      ...font.metrics,
      ...detectFontGuides(font, samples),
      advanceX: quantile(
        usable.map((g) => g.advanceX),
        0.5,
      ),
    },
  };
}
const peers = new Map<string, string>();
for (const [latin, cyrillic] of [
  ["ABCEHIKMOPTXaceiopxy", "АВСЕНІКМОРТХасеіорху"],
  ["LNVUPRWOM", "ГИЛПЬЯЖФЮ"],
  ["lnvuprowm", "гилпьяжфю"],
  ["EEINNW", "ЄЁЇЙИЩ"],
  ["eeinnw", "єёїйищ"],
])
  [...cyrillic].forEach((c, i) => peers.set(c, latin[i]));
// Explicit pairs above take precedence; the remaining letters use their case's
// representative frame, never a font-wide decorative maximum.
export function profiledBlank(
  font: FontSummary,
  samples: Glyph[],
  id: string,
  char: string,
): Glyph {
  const byChar = new Map<string, Glyph>();
  for (const g of samples)
    for (const label of g.labels)
      if (label.kind === "unicode") byChar.set(label.value, g);
  const peer =
    byChar.get(peers.get(char) ?? char) ??
    byChar.get(char === char.toUpperCase() ? "H" : "x");
  const result = blankGlyph(editingProfile(font, samples), id, char);
  if (!peer) return result;
  return {
    ...result,
    width: peer.width,
    height: peer.height,
    rowBytes: peer.rowBytes,
    advanceX: peer.advanceX,
    metrics: { ...peer.metrics },
    rows: Array(peer.height).fill("00".repeat(peer.rowBytes)),
  };
}

/** Only choose a populated queue automatically when opening a font. Explicit
 * navigation to an absent alphabet continues to expose editable placeholders. */
export function initialQueue(preferred: string, index: Map<string, string[]>) {
  if (
    ![
      "canonical",
      "latin",
      "ukrainian",
      "digits",
      "punctuation",
      "symbols",
      "drawing",
    ].includes(preferred)
  )
    return preferred;
  const any = (chars: string) => [...chars].some((c) => index.get(c)?.length);
  const chars = REGIONS.filter(
    (r) => preferred === "canonical" || r.id === preferred,
  )
    .flatMap((r) => r.sections.flatMap((s) => s.chars))
    .join("");
  if (any(chars)) return preferred;
  return any("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz")
    ? "latin"
    : "all";
}

/** Offer a reversible repair for legacy created letters that inherited a logo's
 * width. Refuse any crop that would discard ink; source glyphs stay untouched. */
export function compactLegacyFrame(
  font: FontSummary,
  samples: Glyph[],
  glyph: Glyph,
): Glyph | undefined {
  if (!glyph.character) return;
  const frame = profiledBlank(font, samples, glyph.id, glyph.character);
  if (glyph.width <= frame.width * 2 || glyph.height !== frame.height) return;
  const source = unpack(glyph),
    pixels = new Uint8Array(frame.width * frame.height);
  for (let y = 0; y < glyph.height; y++)
    for (let x = 0; x < glyph.width; x++) {
      const v = source[y * glyph.width + x];
      if (x >= frame.width) {
        if (v) return;
      } else pixels[y * frame.width + x] = v;
    }
  return {
    ...structuredClone(glyph),
    width: frame.width,
    rowBytes: frame.rowBytes,
    advanceX: frame.advanceX,
    metrics: { ...frame.metrics },
    rows: pack(pixels, frame.width, frame.height),
  };
}
