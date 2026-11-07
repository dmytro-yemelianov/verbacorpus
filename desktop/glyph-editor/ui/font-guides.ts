import type { FontSummary } from "./model";
export const FONT_GUIDE_FIELDS = [
  {
    key: "baseline",
    label: "Baseline · базова лінія",
    color: "#e8b965",
    help: "Відстань униз від верху комірки до лінії, на якій стоять літери. Змінює розташування рядка відносно комірки, а не пікселі гліфів.",
  },
  {
    key: "capHeight",
    label: "Cap height · великі",
    color: "#91d29f",
    help: "Висота великих H/Н над базовою лінією. Діакритики можуть виходити вище.",
  },
  {
    key: "xHeight",
    label: "X-height · малі",
    color: "#80cbdc",
    help: "Висота основного тіла малих x/х над базовою лінією, без верхніх і нижніх виносних елементів.",
  },
  {
    key: "ascent",
    label: "Ascent · верхня межа",
    color: "#c7b5ec",
    help: "Відстань угору від базової лінії до верхньої межі рядка: місце для верхніх виносних елементів і діакритиків.",
  },
  {
    key: "descent",
    label: "Descent · нижня межа",
    color: "#e49da8",
    help: "Додатна відстань униз від базової лінії для хвостів у р, у, ц, щ.",
  },
  {
    key: "lineGap",
    label: "Line gap · міжрядковий проміжок",
    color: "#d4b76e",
    help: "Додатковий проміжок між рядками. Крок базових ліній = ascent + descent + line gap.",
  },
] as const;
export type FontGuideKey = (typeof FONT_GUIDE_FIELDS)[number]["key"];
export type FontGuideOverrides = Partial<Record<FontGuideKey, number>>;
export function validateFontGuides(
  value: FontGuideOverrides,
): FontGuideOverrides {
  const out: FontGuideOverrides = {};
  for (const [key, number] of Object.entries(value)) {
    if (
      !FONT_GUIDE_FIELDS.some((f) => f.key === key) ||
      !Number.isFinite(number) ||
      Math.abs(number) > 16384 ||
      (key !== "baseline" && number < 0)
    )
      throw new Error(
        "Гайди: скінченні значення 0–16384 px; baseline також може бути від’ємною.",
      );
  }
  for (const field of FONT_GUIDE_FIELDS)
    if (field.key in value) out[field.key] = value[field.key];
  return out;
}
const finite = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;
export function fontGuideValues(
  font: FontSummary,
  reference: { cap?: number; x?: number } = {},
): FontGuideOverrides {
  return {
    baseline: font.metrics.baseline,
    ascent: finite(font.metrics.ascent) ?? Math.max(0, font.metrics.baseline),
    descent: Math.abs(
      finite(font.metrics.descent) ??
        Math.max(0, font.cell.height - font.metrics.baseline),
    ),
    lineGap: finite(font.metrics.lineGap) ?? 0,
    capHeight: finite(font.metrics.capHeight) ?? reference.cap,
    xHeight: finite(font.metrics.xHeight) ?? reference.x,
  };
}
export function fontWithGuides<T extends Pick<FontSummary, "metrics" | "cell">>(
  font: T,
  overrides: FontGuideOverrides = {},
): T {
  const values = validateFontGuides(overrides);
  const metrics: FontSummary["metrics"] = { ...font.metrics, ...values };
  if (["ascent", "descent", "lineGap"].some((key) => key in values)) {
    const ascent = finite(metrics.ascent) ?? Math.max(0, metrics.baseline);
    const descent = Math.abs(
      finite(metrics.descent) ??
        Math.max(0, font.cell.height - metrics.baseline),
    );
    const lineHeight = ascent + descent + (finite(metrics.lineGap) ?? 0);
    if (lineHeight <= 0) throw new Error("Висота рядка має бути більшою за 0.");
    metrics.lineHeight = lineHeight;
  }
  return { ...font, metrics };
}
