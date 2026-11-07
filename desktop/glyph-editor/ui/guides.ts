import { createRasterMutation } from "./raster-mutation";
import type { Glyph, FontSummary } from "./model";
import { fontGuideValues, FONT_GUIDE_FIELDS } from "./font-guides";
export interface Guide {
  axis: "x" | "y";
  value: number;
  label: string;
  color: string;
  help: string;
}
export interface ReferenceHeights {
  cap?: number;
  x?: number;
}
export function referenceHeight(glyph: Glyph) {
  const b = createRasterMutation(glyph).bounds;
  const height = b ? glyph.height + glyph.metrics.shiftUp - b.y : 0;
  return height > 0 ? height : undefined;
}
export function glyphGuides(
  glyph: Glyph,
  font: FontSummary | undefined,
  reference: ReferenceHeights = {},
): Guide[] {
  const baseline = glyph.height + glyph.metrics.shiftUp;
  const guides: Guide[] = [
    {
      axis: "y",
      value: baseline,
      label: "Baseline",
      color: "#e8b965",
      help: FONT_GUIDE_FIELDS[0].help,
    },
    {
      axis: "x",
      value: -glyph.metrics.leftBearing,
      label: "Початок",
      color: "#db8dac",
      help: "Нуль пера. Відстань від початку до лівого краю растра задає left bearing гліфа.",
    },
    {
      axis: "x",
      value: glyph.advanceX - glyph.metrics.leftBearing,
      label: "Крок",
      color: "#bba1eb",
      help: "Позиція пера після гліфа: початок + advanceX. Звідси починається наступний символ.",
    },
  ];
  if (font && Number.isFinite(Number(font.metrics.baseline))) {
    const top = baseline - Number(font.metrics.baseline);
    guides.push(
      {
        axis: "y",
        value: top,
        label: "Верх комірки",
        color: "#a2ad99",
        help: "Верх номінальної комірки шрифту: baseline мінус font baseline.",
      },
      {
        axis: "y",
        value: top + font.cell.height,
        label: "Низ комірки",
        color: "#a2ad99",
        help: "Верх комірки + її висота. Растр окремого гліфа може виходити за цю межу.",
      },
    );
  }
  const values = font
    ? fontGuideValues(font, reference)
    : { capHeight: reference.cap, xHeight: reference.x };
  if (values.capHeight !== undefined)
    guides.push({
      axis: "y",
      value: baseline - values.capHeight,
      label: "Великі H/Н",
      color: "#91d29f",
      help: FONT_GUIDE_FIELDS[1].help,
    });
  if (values.xHeight !== undefined)
    guides.push({
      axis: "y",
      value: baseline - values.xHeight,
      label: "Малі x/х",
      color: "#80cbdc",
      help: FONT_GUIDE_FIELDS[2].help,
    });
  if (font) {
    const values = fontGuideValues(font);
    guides.push(
      {
        axis: "y",
        value: baseline - values.ascent!,
        label: "Ascent",
        color: "#c7b5ec",
        help: FONT_GUIDE_FIELDS[3].help,
      },
      {
        axis: "y",
        value: baseline + values.descent!,
        label: "Descent",
        color: "#e49da8",
        help: FONT_GUIDE_FIELDS[4].help,
      },
      {
        axis: "y",
        value: baseline + values.descent! + values.lineGap!,
        label: "Проміжок до наступного рядка",
        color: "#d4b76e",
        help: FONT_GUIDE_FIELDS[5].help,
      },
    );
  }
  return guides.filter((g) => Number.isFinite(g.value));
}
export function paintGuides(
  context: CanvasRenderingContext2D,
  z: number,
  width: number,
  height: number,
  guides: Guide[],
) {
  context.save();
  context.lineWidth = 1;
  context.setLineDash([6, 3]);
  for (const g of guides) {
    if (g.value < 0 || g.value > (g.axis === "x" ? width : height)) continue;
    const position = Math.min(
      (g.axis === "x" ? width : height) * z - 0.5,
      Math.max(0.5, g.value * z + 0.5),
    );
    context.strokeStyle = g.color;
    context.beginPath();
    if (g.axis === "x") {
      context.moveTo(position, 0);
      context.lineTo(position, height * z);
    } else {
      context.moveTo(0, position);
      context.lineTo(width * z, position);
    }
    context.stroke();
  }
  context.restore();
}
