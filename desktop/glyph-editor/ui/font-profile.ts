import { detectFontGuides } from "./auto-guides";
import { REGIONS } from "./regions";
import { blankGlyph, type FontSummary, type Glyph } from "./model";
import { fixedCell, cellFont, type FontCell } from "./monospace";

export function editingProfile(
  font: FontSummary,
  samples: Glyph[],
  override?: FontCell,
) {
  const cell = fixedCell(font, samples, override);
  return {
    ...cellFont(font, cell),
    metrics: {
      ...font.metrics,
      ...detectFontGuides(font, samples),
      baseline: cell.baseline,
      advanceX: cell.advanceX,
    },
  };
}
export function profiledBlank(
  font: FontSummary,
  samples: Glyph[],
  id: string,
  char: string,
): Glyph {
  return blankGlyph(editingProfile(font, samples), id, char);
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
