import { UKRAINIAN, codepoint, type Glyph } from "./model";

export interface GlyphSlot {
  key: string;
  char?: string;
  id?: string;
  section?: string;
  group?: string;
}
interface Section {
  title: string;
  chars: string[];
}
export interface GlyphRegion {
  id: string;
  title: string;
  sections: Section[];
}
const section = (title: string, chars: string): Section => ({
  title,
  chars: [...chars],
});
export const REGIONS: GlyphRegion[] = [
  {
    id: "digits",
    title: "Цифри 0–9",
    sections: [section("Цифри · 0–9", "0123456789")],
  },
  {
    id: "latin",
    title: "Латиниця",
    sections: [
      section("Латиниця · великі A–Z", "ABCDEFGHIJKLMNOPQRSTUVWXYZ"),
      section("Латиниця · малі a–z", "abcdefghijklmnopqrstuvwxyz"),
    ],
  },
  {
    id: "ukrainian",
    title: "Українська",
    sections: [
      {
        title: "Українська абетка · великі А–Я",
        chars: UKRAINIAN.slice(0, 33),
      },
      { title: "Українська абетка · малі а–я", chars: UKRAINIAN.slice(33) },
    ],
  },
  {
    id: "punctuation",
    title: "Пунктуація",
    sections: [
      section(
        "Пробіли й пунктуація",
        " \u00a0.,:;!?…'ʼ‘’\"“”«»()-–—[]{}/_\\@#&*§¶",
      ),
    ],
  },
  {
    id: "symbols",
    title: "Математика й валюти",
    sections: [
      section("Математичні знаки", "+−=<>≤≥±×÷%‰^~|¬√∞≈≠∑∏∫°"),
      section("Валюти й інші знаки", "₴$€£¥¢¤©®™№"),
    ],
  },
  {
    id: "drawing",
    title: "Рамки й блоки",
    sections: [
      section("Рамки, блоки й фігури", "─│┌┐└┘├┤┬┴┼═║╔╗╚╝╠╣╦╩╬░▒▓█▀▄▌▐■□●○"),
    ],
  },
];
export function canonicalSlots(
  mode: string,
  index: Map<string, string[]>,
): GlyphSlot[] | undefined {
  const regions =
    mode === "canonical"
      ? REGIONS
      : REGIONS.filter((region) => region.id === mode);
  if (!regions.length) return;
  return regions.flatMap((region) =>
    region.sections.flatMap((s) =>
      s.chars.map((char) => ({
        key: codepoint(char),
        char,
        id: index.get(char)?.[0],
        section: s.title,
        group: region.id,
      })),
    ),
  );
}
export function regionFor(char: string) {
  return REGIONS.find((region) =>
    region.sections.some((s) => s.chars.includes(char)),
  );
}
const names: Record<string, string> = {
  " ": "Пробіл",
  "\u00a0": "Нерозривний пробіл",
  "\t": "Табуляція",
  "\n": "Новий рядок",
  "\r": "Повернення каретки",
  "\x7f": "DEL",
  "\0": "NUL",
};
export function characterLabel(char: string) {
  if (names[char]) return names[char];
  if ([...char].length !== 1) return char;
  if (/\p{Cc}|\p{Cf}/u.test(char)) return `Керувальний знак ${codepoint(char)}`;
  const register = /\p{Lu}/u.test(char)
    ? " · велика"
    : /\p{Ll}/u.test(char)
      ? " · мала"
      : "";
  if (UKRAINIAN.includes(char)) return char + " · укр." + register;
  if (/\p{Script=Latin}/u.test(char)) return char + " · лат." + register;
  if (/\p{Script=Cyrillic}/u.test(char)) return char + " · кир." + register;
  return char;
}
export function mappedCharacter(glyph?: Glyph) {
  return glyph?.labels.find(
    (label) => label.kind === "unicode" && [...label.value].length === 1,
  )?.value;
}
export function glyphCaption(char?: string, glyph?: Glyph) {
  const mapped = char ?? mappedCharacter(glyph);
  if (mapped) return characterLabel(mapped);
  return glyph?.sourceCode?.value != null
    ? `код ${String(glyph.sourceCode.value)}`
    : "Без Unicode";
}
