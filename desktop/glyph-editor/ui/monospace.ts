import type { FontSummary, Glyph } from "../../../app/src/para/types";
import { pack, unpack } from "./glyph-bitmap";
export interface FontCell {
  width: number;
  height: number;
  advanceX: number;
  baseline: number;
}
type Geometry = Pick<FontSummary, "cell" | "metrics">;
export const FRAME_CHARACTERS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789ÁÀÂÃÄÅÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÝŸАБВГҐДЕЄЖЗИІЇЙКЛМНОПРСТУФХЦЧШЩЬЮЯабвгґдеєжзиіїйклмнопрстуфхцчшщьюя";
export function frameOrdinals(count: number, index: Record<string, number[]>) {
  const ids = [
    ...new Set([...FRAME_CHARACTERS].flatMap((c) => index[c] ?? [])),
  ];
  return ids.length
    ? ids
    : Array.from({ length: Math.min(128, count) }, (_, i) => i);
}
function ink(g: Glyph) {
  const pixels = unpack(g);
  let left = g.width,
    right = -1,
    top = g.height,
    bottom = -1;
  pixels.forEach((v, i) => {
    if (v) {
      const x = i % g.width,
        y = Math.floor(i / g.width);
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
  });
  return right >= left ? { left, right, top, bottom, pixels } : undefined;
}
export function validateCell(value: FontCell): FontCell {
  if (
    ![value.width, value.height, value.advanceX, value.baseline].every(
      Number.isInteger,
    ) ||
    value.width < 1 ||
    value.height < 1 ||
    value.width > 1024 ||
    value.height > 1024 ||
    value.width * value.height > 262144 ||
    value.advanceX < 1 ||
    value.advanceX > 4096 ||
    value.baseline < 0 ||
    value.baseline > value.height
  )
    throw new Error(
      "Комірка шрифту: 1–1024 px, до 262144 пікселів; крок 1–4096; baseline у межах висоти",
    );
  return {
    width: value.width,
    height: value.height,
    advanceX: value.advanceX,
    baseline: value.baseline,
  };
}
/** One logical frame for every glyph. Decorative/control rasters do not set
 * letter spacing. Source assets and the original cropped rasters stay immutable. */
export function fixedCell(
  font: Geometry,
  samples: Glyph[],
  override?: FontCell,
): FontCell {
  if (override) return validateCell(override);
  const mapped = samples.filter((g) =>
    g.labels.some(
      (l) =>
        l.kind === "unicode" &&
        FRAME_CHARACTERS.includes(l.value) &&
        [...l.value].length === 1,
    ),
  );
  const numeric = samples
    .slice(0, 128)
    .filter((g) =>
      g.labels.some(
        (l) =>
          l.kind === "codepoint" &&
          /^(0x[0-9a-f]+|[0-9]+)$/i.test(l.value) &&
          Number(l.value) >= 32 &&
          Number(l.value) <= 126,
      ),
    );
  const usable = (
    mapped.length ? mapped : numeric.length ? numeric : samples.slice(0, 128)
  ).flatMap((g) => {
    const b = ink(g);
    return b ? [{ g, b }] : [];
  });
  if (!usable.length) {
    const width = Math.max(1, Math.min(1024, font.cell.width)),
      height = Math.max(1, Math.min(1024, font.cell.height));
    return validateCell({
      width,
      height,
      advanceX: Math.max(1, Math.round(font.metrics.advanceX) || width),
      baseline: Math.max(
        0,
        Math.min(height, Math.round(font.metrics.baseline)),
      ),
    });
  }
  const advances = usable.map(({ g }) => Math.max(1, Math.round(g.advanceX))),
    advanceX = Math.max(...advances);
  const widths = usable.map(
    ({ g, b }) =>
      b.right -
      b.left +
      1 +
      Math.max(
        0,
        Math.round((advanceX - g.advanceX) / 2) +
          g.metrics.leftBearing +
          b.left,
      ),
  );
  let width = Math.max(advanceX, ...widths);
  if (font.cell.monospace && font.cell.width <= width * 2)
    width = Math.max(width, font.cell.width);
  const sampleHeight = Math.max(1, ...usable.map(({ g }) => g.height));
  const vertical = usable.filter(
    ({ g }) => Math.abs(g.metrics.shiftUp) <= Math.max(8, sampleHeight * 3),
  );
  const above = Math.max(
    0,
    ...vertical.map(({ g, b }) =>
      Math.ceil(g.height + g.metrics.shiftUp - b.top),
    ),
  );
  const suppliedBaseline = Math.round(font.metrics.baseline);
  const baseline = Math.max(
    above,
    suppliedBaseline <= Math.max(8, sampleHeight * 3) ? suppliedBaseline : 0,
  );
  const descent = Math.max(
    0,
    ...vertical.map(({ g, b }) =>
      Math.ceil(b.bottom + 1 - g.height - g.metrics.shiftUp),
    ),
  );
  const nominal = Number(font.metrics.lineHeight);
  const sourceHeight =
    font.cell.height <= sampleHeight * 3
      ? font.cell.height
      : Number.isFinite(nominal) && nominal > 0 && nominal <= sampleHeight * 3
        ? nominal
        : 0;
  const height = Math.max(1, sourceHeight, baseline + descent);
  return validateCell({
    width,
    height,
    advanceX: Math.max(width, advanceX),
    baseline,
  });
}
export function cellFont<T extends Geometry>(font: T, cell: FontCell): T {
  return {
    ...font,
    cell: {
      ...font.cell,
      width: cell.width,
      height: cell.height,
      monospace: true,
    },
    metrics: {
      ...font.metrics,
      baseline: cell.baseline,
      advanceX: cell.advanceX,
    },
  };
}
export function cellNeedsFit(glyph: Glyph, cell: FontCell) {
  const b = ink(glyph);
  return (
    !!b &&
    (b.right - b.left + 1 > cell.width || b.bottom - b.top + 1 > cell.height)
  );
}
/** Padding and integer translation preserve normal glyph pixels. Only ink that
 * exceeds the common cell is fitted with nearest pixels, never clipped/antialiased. */
export function normalizeCell(glyph: Glyph, cell: FontCell): Glyph {
  validateCell(cell);
  const b = ink(glyph),
    pixels = new Uint8Array(cell.width * cell.height);
  if (b) {
    const bw = b.right - b.left + 1,
      bh = b.bottom - b.top + 1;
    if (bw > cell.width || bh > cell.height) {
      const scale = Math.min(cell.width / bw, cell.height / bh),
        w = Math.max(1, Math.floor(bw * scale)),
        h = Math.max(1, Math.floor(bh * scale));
      const left = Math.floor((cell.width - w) / 2),
        top = Math.max(0, Math.min(cell.height - h, cell.baseline - h));
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++)
          pixels[(top + y) * cell.width + left + x] =
            b.pixels[
              (b.top + Math.min(bh - 1, Math.floor(((y + 0.5) * bh) / h))) *
                glyph.width +
                b.left +
                Math.min(bw - 1, Math.floor(((x + 0.5) * bw) / w))
            ];
    } else {
      const dx = Math.max(
        -b.left,
        Math.min(
          cell.width - 1 - b.right,
          Math.round(
            (cell.advanceX - glyph.advanceX) / 2 + glyph.metrics.leftBearing,
          ),
        ),
      );
      const dy = Math.max(
        -b.top,
        Math.min(
          cell.height - 1 - b.bottom,
          Math.round(
            cell.baseline -
              glyph.height -
              (glyph.metrics.shiftUp >= 128 &&
              glyph.metrics.shiftUp <= 255 &&
              glyph.metrics.shiftUp > cell.height * 2
                ? glyph.metrics.shiftUp - 256
                : glyph.metrics.shiftUp),
          ),
        ),
      );
      for (let y = b.top; y <= b.bottom; y++)
        for (let x = b.left; x <= b.right; x++)
          pixels[(y + dy) * cell.width + x + dx] =
            b.pixels[y * glyph.width + x];
    }
  }
  if (b && !pixels.some(Boolean))
    pixels[
      Math.floor(cell.height / 2) * cell.width + Math.floor(cell.width / 2)
    ] = 1;
  return {
    ...structuredClone(glyph),
    width: cell.width,
    height: cell.height,
    rowBytes: Math.ceil(cell.width / 8),
    advanceX: cell.advanceX,
    metrics: {
      ...glyph.metrics,
      leftBearing: 0,
      rightBearing: cell.advanceX - cell.width,
      shiftUp: cell.baseline - cell.height,
    },
    rows: pack(pixels, cell.width, cell.height),
  };
}
