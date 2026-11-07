import { createRasterMutation } from "./raster-mutation";
import type { Glyph, FontSummary } from "./model";
export interface Guide {
  axis: "x" | "y";
  value: number;
  label: string;
  color: string;
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
    { axis: "y", value: baseline, label: "Baseline", color: "#e8b965" },
    {
      axis: "x",
      value: -glyph.metrics.leftBearing,
      label: "Початок",
      color: "#db8dac",
    },
    {
      axis: "x",
      value: glyph.advanceX - glyph.metrics.leftBearing,
      label: "Крок",
      color: "#bba1eb",
    },
  ];
  if (font && Number.isFinite(Number(font.metrics.baseline))) {
    const top = baseline - Number(font.metrics.baseline);
    guides.push(
      { axis: "y", value: top, label: "Верх комірки", color: "#a2ad99" },
      {
        axis: "y",
        value: top + font.cell.height,
        label: "Низ комірки",
        color: "#a2ad99",
      },
    );
  }
  if (reference.cap !== undefined)
    guides.push({
      axis: "y",
      value: baseline - reference.cap,
      label: "Великі H/Н",
      color: "#91d29f",
    });
  if (reference.x !== undefined)
    guides.push({
      axis: "y",
      value: baseline - reference.x,
      label: "Малі x/х",
      color: "#80cbdc",
    });
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
