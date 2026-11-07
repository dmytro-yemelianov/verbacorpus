import { pack, unpack, type Glyph } from "./model";

export type Composition = "compose-zhe" | "compose-yu";
type Bounds = { left: number; right: number; top: number; bottom: number };
function bounds(g: Glyph, pixels: Uint8Array): Bounds | undefined {
  let left = g.width,
    right = -1,
    top = g.height,
    bottom = -1;
  for (let y = 0; y < g.height; y++)
    for (let x = 0; x < g.width; x++)
      if (pixels[y * g.width + x]) {
        left = Math.min(left, x);
        right = Math.max(right, x);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
  return right >= left ? { left, right, top, bottom } : undefined;
}
/** Find the dominant left stem, ignoring sparse serifs and the right-hand bowl. */
function stem(g: Glyph, pixels: Uint8Array, b: Bounds) {
  const counts = Array.from({ length: g.width }, (_, x) => {
    let count = 0;
    for (let y = b.top; y <= b.bottom; y++) count += pixels[y * g.width + x];
    return count;
  });
  const middle = Math.floor((b.left + b.right) / 2);
  let left = b.left;
  for (let x = b.left; x <= middle; x++) if (counts[x] > counts[left]) left = x;
  let right = left;
  while (right < middle && counts[right + 1] === counts[left]) right++;
  return { left, right, width: right - left + 1 };
}
/** Endpoint-aligned nearest pixels; preserve a thin stroke if a row would disappear. */
function fitRow(row: Uint8Array, width: number) {
  const result = new Uint8Array(width);
  if (!row.length || !width) return result;
  for (let x = 0; x < width; x++)
    result[x] =
      row[
        Math.round(
          width === 1
            ? (row.length - 1) / 2
            : (x * (row.length - 1)) / (width - 1),
        )
      ];
  if (!result.some(Boolean))
    for (let x = 0; x < row.length; x++)
      if (row[x])
        result[
          Math.round(
            row.length === 1 ? 0 : (x * (width - 1)) / (row.length - 1),
          )
        ] = 1;
  return result;
}
function output(
  base: Glyph,
  pixels: Uint8Array,
  height = base.height,
  top = 0,
): Glyph {
  return {
    ...structuredClone(base),
    height,
    rows: pack(pixels, base.width, height),
    metrics: {
      ...base.metrics,
      shiftUp: base.height + base.metrics.shiftUp - top - height,
    },
  };
}

/** Share k's stem; place mirrored branches on the left and original branches on the right. */
function zhe(base: Glyph): Glyph | undefined {
  const source = unpack(base),
    b = bounds(base, source);
  if (!b) return;
  const s = stem(base, source, b);
  const wing = b.right - s.right;
  // Keep the normal advance/cell width. Horizontal fitting never interpolates shades.
  const side = Math.floor((base.width - s.width) / 2);
  if (wing < 1 || side < 1) return;
  const start = Math.floor((base.width - (side * 2 + s.width)) / 2);
  const pixels = new Uint8Array(source.length);
  // A Latin k may have an ascender: only keep the height occupied by its branches.
  let top = base.height,
    bottom = -1;
  for (let y = b.top; y <= b.bottom; y++)
    for (let x = s.right + 1; x <= b.right; x++)
      if (source[y * base.width + x]) {
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
  if (bottom < top) return;
  for (let y = top; y <= bottom; y++) {
    const row = fitRow(
      source.slice(y * base.width + s.right + 1, y * base.width + b.right + 1),
      side,
    );
    for (let x = 0; x < side; x++) {
      pixels[y * base.width + start + side - 1 - x] = row[x];
      pixels[y * base.width + start + side + s.width + x] = row[x];
    }
    for (let x = 0; x < s.width; x++)
      pixels[y * base.width + start + side + x] =
        source[y * base.width + s.left + x];
  }
  return output(base, pixels);
}

/** Keep н's left stem and crossbar, replacing its right stem with о's bowl. */
function yu(base: Glyph, ring: Glyph): Glyph | undefined {
  const source = unpack(base),
    circle = unpack(ring),
    b = bounds(base, source),
    o = bounds(ring, circle);
  if (!b || !o) return;
  const s = stem(base, source, b);
  // Require an actual connector between two stems, rather than inventing a row.
  const connector = Math.floor((s.right + b.right) / 2);
  if (
    connector <= s.right ||
    connector >= b.right ||
    !Array.from(
      { length: base.height },
      (_, y) => source[y * base.width + connector],
    ).some(Boolean)
  )
    return;
  const gap = Math.max(1, Math.floor(s.width / 2));
  const available = base.width - b.left - s.width - gap;
  if (available < 3) return;
  const ringWidth = Math.min(available, o.right - o.left + 1);
  if (ringWidth < 3) return;
  const dy = Math.round(
    base.height + base.metrics.shiftUp - ring.height - ring.metrics.shiftUp,
  );
  const top = Math.min(0, dy + o.top),
    bottom = Math.max(base.height, dy + o.bottom + 1);
  const height = bottom - top;
  if (height > 1024 || base.width * height > 262144) return;
  const pixels = new Uint8Array(base.width * height);
  for (let y = b.top; y <= b.bottom; y++) {
    const row = (y - top) * base.width;
    for (let x = 0; x < s.width; x++)
      pixels[row + b.left + x] = source[y * base.width + s.left + x];
    for (let x = 0; x < gap; x++)
      pixels[row + b.left + s.width + x] = source[y * base.width + connector];
  }
  for (let y = o.top; y <= o.bottom; y++) {
    const row = fitRow(
      circle.slice(y * ring.width + o.left, y * ring.width + o.right + 1),
      ringWidth,
    );
    for (let x = 0; x < ringWidth; x++)
      pixels[(y + dy - top) * base.width + b.left + s.width + gap + x] = row[x];
  }
  return output(base, pixels, height, top);
}
export function compose(
  operation: Composition,
  sources: Glyph[],
): Glyph | undefined {
  if (!sources[0]) return;
  return operation === "compose-zhe"
    ? zhe(sources[0])
    : sources[1]
      ? yu(sources[0], sources[1])
      : undefined;
}
