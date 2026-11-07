import { unpack } from "./glyph-bitmap";
import type { FontSummary, Glyph } from "../../../app/src/para/types";
import type { FontGuideOverrides } from "./font-guides";

/** Distances in the glyph's native pixels, measured from its own baseline.
 * Blank padding and proportional widths never affect the vertical guides. */
export function detectFontGuides(
  font: Pick<FontSummary, "cell" | "metrics">,
  samples: Glyph[],
): FontGuideOverrides {
  const byChar = new Map<string, { above: number; below: number }>();
  for (const g of samples) {
    const chars = g.labels.filter(
      (l) => l.kind === "unicode" && /^[\p{L}\p{N}]$/u.test(l.value),
    );
    if (!chars.length) continue;
    const bits = unpack(g);
    let top = g.height,
      bottom = -1;
    bits.forEach((v, i) => {
      if (v) {
        const y = Math.floor(i / g.width);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
    });
    if (bottom < top) continue;
    const baseline = g.height + g.metrics.shiftUp;
    for (const c of chars)
      byChar.set(c.value, {
        above: Math.max(0, baseline - top),
        below: Math.max(0, bottom + 1 - baseline),
      });
  }
  const median = (chars: string) => {
    const values = [...chars]
      .flatMap((c) => {
        const v = byChar.get(c)?.above;
        return v && v > 0 ? [v] : [];
      })
      .sort((a, b) => a - b);
    return values.length ? values[Math.floor(values.length / 2)] : undefined;
  };
  const positive = (v: unknown) =>
    typeof v === "number" && Number.isFinite(v) && v > 0 ? v : undefined;
  const baseline = font.metrics.baseline;
  const ascent = Math.max(
    (Number(font.metrics.ascent) <= font.cell.height * 2
      ? positive(font.metrics.ascent)
      : undefined) ?? 0,
    ...[...byChar.values()].map((g) => g.above),
    byChar.size ? 0 : Math.max(0, baseline),
  );
  const descent = Math.max(
    Math.abs(Number(font.metrics.descent) || 0) <= font.cell.height * 2
      ? Math.abs(Number(font.metrics.descent) || 0)
      : 0,
    ...[...byChar.values()].map((g) => g.below),
    byChar.size ? 0 : Math.max(0, font.cell.height - baseline),
  );
  return {
    baseline,
    capHeight: median("HНIІEЕFПТT") ?? positive(font.metrics.capHeight),
    xHeight: median("xхzuvwxаеєиоосх") ?? positive(font.metrics.xHeight),
    ascent,
    descent,
    lineGap:
      positive(font.metrics.lineGap) ??
      Math.max(
        0,
        (Number(font.metrics.lineHeight) || ascent + descent) -
          ascent -
          descent,
      ),
  };
}
