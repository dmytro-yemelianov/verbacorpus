import {
  FONT_GUIDE_FIELDS,
  fontGuideValues,
  fontWithGuides,
  type FontGuideKey,
  type FontGuideOverrides,
} from "./font-guides";
import type { FontSummary } from "./model";
/** Schematics deliberately use fixed pixel letterforms: no font dependency. */
function diagram(key: FontGuideKey, color: string) {
  const ranges: Record<FontGuideKey, [number, number]> = {
    baseline: [8, 60],
    capHeight: [30, 60],
    xHeight: [42, 60],
    ascent: [18, 60],
    descent: [60, 76],
    lineGap: [76, 86],
  };
  const [a, b] = ranges[key];
  const letters = [
    { x: 35, y: 30, bitmap: ["10001", "10001", "11111", "10001", "10001"] },
    { x: 77, y: 42, bitmap: ["10001", "01010", "00100", "01010", "10001"] },
    {
      x: 115,
      y: 42,
      bitmap: [
        "11110",
        "10001",
        "11110",
        "10000",
        "10000",
        "10000",
        "10000",
        "10000",
      ],
    },
  ];
  const pixels = letters
    .flatMap((l) =>
      l.bitmap.flatMap((row, y) =>
        [...row].flatMap((v, x) =>
          v === "1"
            ? [
                `<rect x="${l.x + x * 5}" y="${l.y + y * (l.y === 30 ? 6 : 3.6)}" width="5" height="${l.y === 30 ? 6 : 3.6}"/>`,
              ]
            : [],
        ),
      ),
    )
    .join("");
  return `<svg viewBox="0 0 180 96" role="img" aria-label="Схема вимірювання ${key}">
    <g stroke="#52604e" stroke-dasharray="3 3"><path d="M22 8H160M22 18H160M22 30H160M22 42H160M22 60H160M22 76H160M22 86H160"/></g>
    <g fill="#7c8975">${pixels}</g>
    <g stroke="${color}" stroke-width="1.5" fill="none"><path d="M22 ${a}H160M22 ${b}H160M15 ${a}V${b}M11 ${a + 3}L15 ${a}L19 ${a + 3}M11 ${b - 3}L15 ${b}L19 ${b - 3}"/></g>
    <text x="164" y="63" fill="#e8b965" font-size="9">0</text></svg>`;
}
export function createFontGuidesEditor(options: {
  get: () => {
    font?: FontSummary;
    overrides?: FontGuideOverrides;
    reference: { cap?: number; x?: number };
    busy: boolean;
  };
  apply: (value: FontGuideOverrides) => Promise<void>;
  error: (reason: unknown) => void;
}) {
  const dialog = document.getElementById(
    "font-guides-dialog",
  ) as HTMLDialogElement;
  const form = document.getElementById("font-guides-form") as HTMLFormElement;
  const cards = document.getElementById("font-guide-fields")!;
  for (const field of FONT_GUIDE_FIELDS) {
    const card = document.createElement("section");
    card.className = "font-guide-card";
    const label = document.createElement("label"),
      title = document.createElement("strong"),
      input = document.createElement("input");
    title.textContent = field.label;
    title.style.color = field.color;
    input.id = "font-guide-" + field.key;
    input.type = "number";
    input.step = "any";
    input.max = "16384";
    input.min = field.key === "baseline" ? "-16384" : "0";
    label.append(title, input);
    const illustration = document.createElement("div");
    illustration.innerHTML = diagram(field.key, field.color);
    const help = document.createElement("p");
    help.textContent = field.help;
    help.id = "font-guide-help-" + field.key;
    input.setAttribute("aria-describedby", help.id);
    card.append(label, illustration, help);
    cards.append(card);
  }
  function refresh() {
    const { font, overrides, reference } = options.get();
    if (!font) return;
    const values = fontGuideValues(font, reference);
    for (const field of FONT_GUIDE_FIELDS) {
      const input = document.getElementById(
        "font-guide-" + field.key,
      ) as HTMLInputElement;
      input.value = overrides?.[field.key]?.toString() ?? "";
      input.placeholder =
        values[field.key] === undefined
          ? "Авто · немає зразка"
          : `Авто: ${values[field.key]} px`;
    }
    document.getElementById("font-guides-name")!.textContent = font.name;
  }
  document.getElementById("font-guides-open")!.onclick = () => {
    if (!options.get().busy) {
      refresh();
      dialog.showModal();
    }
  };
  document.getElementById("font-guides-close")!.onclick = () => dialog.close();
  document.getElementById("font-guides-reset")!.onclick = () => {
    for (const input of cards.querySelectorAll("input")) input.value = "";
  };
  form.onsubmit = (event) => {
    event.preventDefault();
    if (!form.reportValidity() || options.get().busy) return;
    const values: FontGuideOverrides = {};
    for (const field of FONT_GUIDE_FIELDS) {
      const input = document.getElementById(
        "font-guide-" + field.key,
      ) as HTMLInputElement;
      if (input.value !== "") values[field.key] = input.valueAsNumber;
    }
    const font = options.get().font;
    if (!font) return;
    try {
      fontWithGuides(font, values);
    } catch (reason) {
      options.error(reason);
      return;
    }
    void options
      .apply(values)
      .then(() => dialog.close())
      .catch(options.error);
  };
  return { close: () => dialog.close() };
}
