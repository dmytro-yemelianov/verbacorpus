import {
  Document,
  blankGlyph,
  type Draft,
  type FontSummary,
  type Glyph,
} from "./model";
import { glyphSignature, hiddenTarget } from "./candidates";
export interface StyleTarget {
  character: string;
  target: Glyph;
  source?: Glyph;
}
export function styleCharacters(value: string, references = false) {
  const chars = [
    ...new Set([...value.normalize("NFC")].filter((c) => !/[\s,;]/u.test(c))),
  ];
  const allowed = new Set([
    ..."ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789АБВГҐДЕЄЖЗИІЇЙКЛМНОПРСТУФХЦЧШЩЬЮЯабвгґдеєжзиіїйклмнопрстуфхцчшщьюя",
  ]);
  if (
    !chars.length ||
    chars.length > (references ? 64 : 128) ||
    (!references && chars.some((c) => !allowed.has(c)))
  )
    throw new Error(
      references
        ? "Вкажіть 1–64 референсні символи."
        : "Потрібні літери: 1–128 символів латинської/української абеток або цифр.",
    );
  return chars;
}
export async function planStyleTargets(options: {
  font: FontSummary;
  state: Draft;
  index: Map<string, string[]>;
  characters: string[];
  onlyMissing: boolean;
  load: (id: string) => Promise<Glyph | undefined>;
  blank?: (id: string, character: string) => Glyph;
  source: (id: string) => Promise<Glyph | undefined>;
}) {
  const targets: StyleTarget[] = [],
    skipped: string[] = [];
  const seen = new Set<string>();
  let next = Number(
    new Document(options.state)
      .nextID(options.font.coverage.glyphCount)
      .slice(1),
  );
  for (const character of options.characters) {
    const ids = options.index.get(character) ?? [];
    if (ids.length > 1)
      throw new Error(
        `Неоднозначна мапа ${character}: спочатку оберіть гліф у шрифті.`,
      );
    const id = ids[0];
    const existing = id ? await options.load(id) : undefined;
    if (id && !existing) throw new Error(`Не вдалося прочитати ${character}.`);
    if (
      existing &&
      options.onlyMissing &&
      existing.rows.some((row) => /[1-9a-f]/i.test(row))
    ) {
      skipped.push(character);
      continue;
    }
    if (id && seen.has(id))
      throw new Error(
        `${character} має спільний гліф з іншою літерою пакета. Обробіть аліаси окремо.`,
      );
    if (!existing && next > 999999)
      throw new Error("Вичерпано діапазон ID гліфів.");
    const target =
      existing ??
      (options.blank ?? ((id, char) => blankGlyph(options.font, id, char)))(
        "g" + String(next++).padStart(6, "0"),
        character,
      );
    seen.add(target.id);
    targets.push({
      character,
      target: structuredClone(target),
      source: id ? await options.source(id) : undefined,
    });
  }
  return { targets, skipped };
}
export function styleTargetRequest(target: StyleTarget) {
  return {
    character: target.character,
    target: hiddenTarget(target.target),
    targetSignature: glyphSignature(target.target),
  };
}
