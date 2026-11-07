import { compose, type Composition } from "./composition";
import {
  codepoint,
  transformed,
  type Glyph,
  type Draft,
  type GlyphEdit,
} from "./model";

export type Transform =
  | "identity"
  | "flip-x"
  | "flip-y"
  | "rotate90"
  | "rotate180"
  | "rotate270"
  | Composition;
interface Rule {
  from: string;
  to: string;
  transform: Transform;
  components?: string[];
}
const pairs = (values: string[], transform: Transform): Rule[] =>
  values.flatMap((pair) => {
    const [from, to] = [...pair];
    const inverse =
      transform === "rotate90"
        ? "rotate270"
        : transform === "rotate270"
          ? "rotate90"
          : transform;
    return [
      { from, to, transform },
      { from: to, to: from, transform: inverse },
    ];
  });
// Curated visual starting points, not Unicode equivalence or transliteration.
// Lowercase k/m/t/h/b are deliberately excluded: their Cyrillic forms vary.
export const HOMOGRAPHS = pairs(
  [
    "AА",
    "BВ",
    "CС",
    "EЕ",
    "HН",
    "IІ",
    "KК",
    "MМ",
    "OО",
    "PР",
    "TТ",
    "XХ",
    "aа",
    "cс",
    "eе",
    "iі",
    "oо",
    "pр",
    "xх",
    "yу",
  ],
  "identity",
);
export const GEOMETRY = [
  ...pairs(["RЯ", "NИ", "ЭЄ", "эє", "bd", "pq"], "flip-x"),
  ...pairs(["PЬ", "pь", "LГ", "VЛ", "UП", "vл", "uп"], "flip-y"),
  ...pairs(["bq", "dp", "nu", "VЛ", "UП", "vл", "uп", "hч"], "rotate180"),
  ...pairs(["LГ", "HI", "НІ"], "rotate90"),
];
const COMPOSITIONS: Rule[] = [
  ...[
    ["к", "ж"],
    ["k", "ж"],
    ["К", "Ж"],
    ["K", "Ж"],
  ].map(([from, to]) => ({
    from: `${from} + дзеркало(${from})`,
    to,
    transform: "compose-zhe" as const,
    components: [from, from],
  })),
  ...[
    ["н", "о", "ю"],
    ["н", "o", "ю"],
    ["Н", "О", "Ю"],
    ["H", "O", "Ю"],
  ].map(([left, right, to]) => ({
    from: `${left} + ${right}`,
    to,
    transform: "compose-yu" as const,
    components: [left, right],
  })),
];
export const transformName: Record<Transform, string> = {
  identity: "Копія",
  "flip-x": "Дзеркало ↔",
  "flip-y": "Дзеркало ↕",
  rotate90: "Поворот 90° ↻",
  rotate180: "Поворот 180°",
  rotate270: "Поворот 270° ↻",
  "compose-zhe": "Складання · спільна ніжка",
  "compose-yu": "Складання · ніжка, перемичка й овал",
};
export interface Proposal {
  key: string;
  from: string;
  to: string;
  transform: Transform;
  source: Glyph;
  image: Glyph;
  components?: { char: string; glyph: Glyph }[];
  target?: Glyph;
}
const nonempty = (g: Glyph) => g.rows.some((row) => /[1-9a-f]/i.test(row));

export async function propose(
  kind: "homograph" | "geometry",
  index: Map<string, string[]>,
  draft: Draft,
  load: (id: string) => Promise<Glyph | undefined>,
): Promise<Proposal[]> {
  const rules =
    kind === "homograph" ? HOMOGRAPHS : [...GEOMETRY, ...COMPOSITIONS];
  // Load only glyphs referenced by rules. One page request per asset through the existing cache.
  const ids = [
    ...new Set(
      rules.flatMap((r) => [
        ...(r.components ?? [r.from]).flatMap((char) => index.get(char) ?? []),
        ...(index.get(r.to) ?? []),
      ]),
    ),
  ];
  const loaded = new Map(
    await Promise.all(ids.map(async (id) => [id, await load(id)] as const)),
  );
  const result: Proposal[] = [];
  for (const { from, to, transform, components } of rules) {
    const targets = (index.get(to) ?? []).map((id) => loaded.get(id));
    // A missing/failed asset is never permission to replace an existing glyph.
    if (targets.some((g) => !g || nonempty(g) || draft.edits[g.id])) continue;
    // Do not repurpose a blank raster with aliases for unrelated characters.
    const target = targets[0];
    if (
      targets.length > 1 ||
      target?.labels.some((l) => l.kind === "unicode" && l.value !== to)
    )
      continue;
    const inputs = (components ?? [from]).map((char) => ({
      char,
      glyph: (index.get(char) ?? [])
        .map((id) => loaded.get(id))
        .find((g) => g && nonempty(g)),
    }));
    if (inputs.some((input) => !input.glyph)) continue;
    const resolved = inputs as { char: string; glyph: Glyph }[];
    const source = resolved[0].glyph;
    const image =
      transform === "compose-zhe" || transform === "compose-yu"
        ? compose(
            transform,
            resolved.map((input) => input.glyph),
          )
        : transform === "identity"
          ? structuredClone(source)
          : transformed(source, transform);
    if (!image) continue;
    // Quarter turns are still offered for rectangular rasters, with swapped dimensions in preview.
    result.push({
      key: `${from}:${to}:${transform}`,
      from,
      to,
      transform,
      source: structuredClone(source),
      image,
      ...(components ? { components: structuredClone(resolved) } : {}),
      target: target && structuredClone(target),
    });
  }
  return result;
}

export function materialize(
  proposals: Proposal[],
  draft: Draft,
  sourceCount: number,
): GlyphEdit[] {
  let next =
    Math.max(
      sourceCount - 1,
      ...draft.created.map((id) => Number(id.slice(1))),
    ) + 1;
  const targets = new Set<string>();
  return proposals.map((p) => {
    if (targets.has(p.to)) throw new Error(`Оберіть один варіант для ${p.to}`);
    targets.add(p.to);
    const image = structuredClone(p.image);
    const id = p.target?.id ?? "g" + String(next++).padStart(6, "0");
    const glyph: Glyph = {
      ...image,
      id,
      character: p.target?.character ?? p.to,
      codepoint: p.target?.codepoint ?? codepoint(p.to),
      labels: p.target
        ? structuredClone(p.target.labels)
        : [{ kind: "unicode", value: p.to }],
      sourceCode: p.target?.sourceCode ?? null,
    };
    return {
      id,
      glyph,
      source: p.target,
      derivation: {
        sourceGlyphId: p.source.id,
        sourceChar: p.from,
        targetChar: p.to,
        transform: p.transform,
        kind: p.transform === "identity" ? "homograph" : "geometry",
        ...(p.components
          ? {
              recipeVersion: 1,
              components: p.components.map((part, i) => ({
                sourceGlyphId: part.glyph.id,
                sourceChar: part.char,
                transform:
                  p.transform === "compose-zhe" && i === 1
                    ? "flip-x"
                    : "identity",
              })),
            }
          : {}),
      },
    };
  });
}
