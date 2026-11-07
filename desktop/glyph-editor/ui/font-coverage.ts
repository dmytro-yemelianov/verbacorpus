import { effectiveIndex, UKRAINIAN, type Draft, type Glyph } from "./model";
/** Exact coverage of a saved draft snapshot; labels without ink do not count. */
export async function ukrainianCoverage(
  state: Draft,
  index: Record<string, number[]>,
  source: (id: string) => Promise<Glyph | undefined>,
) {
  const mapping = effectiveIndex(index, state),
    missing: string[] = [];
  for (const char of UKRAINIAN) {
    const glyphs = await Promise.all(
      (mapping.get(char) ?? []).map((id) => state.edits[id] ?? source(id)),
    );
    if (!glyphs.some((g) => g?.rows.some((r) => /[1-9a-f]/i.test(r))))
      missing.push(char);
  }
  return {
    present: 66 - missing.length,
    missing,
    checkedRevision: state.revision,
  };
}
