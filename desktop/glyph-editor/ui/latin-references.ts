import { UKRAINIAN, type Glyph } from "./model";
export interface LatinReferences {
  upper: number;
  lower: number;
}
export function latinReferences(glyphs: Glyph[]): LatinReferences {
  const chars = new Set<string>();
  for (const g of glyphs)
    if (g.rows.some((r) => /[1-9a-f]/i.test(r)))
      for (const l of g.labels)
        if (l.kind === "unicode" && /^[A-Za-z]$/.test(l.value))
          chars.add(l.value);
  return {
    upper: [...chars].filter((c) => /^[A-Z]$/.test(c)).length,
    lower: [...chars].filter((c) => /^[a-z]$/.test(c)).length,
  };
}
export function latinSupportedTargets(
  references: LatinReferences,
  characters = UKRAINIAN,
) {
  return characters.filter((c) =>
    c === c.toUpperCase() ? references.upper > 0 : references.lower > 0,
  );
}
export function requireLatinReferences(glyphs: Glyph[], characters: string[]) {
  const refs = latinReferences(glyphs),
    blocked = characters.filter(
      (c) => UKRAINIAN.includes(c) && !latinSupportedTargets(refs, [c]).length,
    );
  if (blocked.length)
    throw new Error(
      `Немає ${blocked.some((c) => c === c.toUpperCase()) ? "великих" : "малих"} латинських референсів. Спочатку перевірте Unicode-мапу або додайте відповідні латинські гліфи.`,
    );
}
