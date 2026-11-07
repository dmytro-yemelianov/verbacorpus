import { line, pack, unpack, type Glyph } from "./model";
export interface Point {
  x: number;
  y: number;
}
export interface RegionOrigin {
  fontId: string;
  glyphId: string;
  sha256: string;
  licenseId: string;
  char?: string;
  rectangle?: { x: number; y: number; width: number; height: number };
  baseline?: number;
  advanceX?: number;
  draftRevision?: number;
}
export interface PixelRegion {
  width: number;
  height: number;
  pixels: Uint8Array;
  mask: Uint8Array;
  origin?: RegionOrigin;
}
export function maskBounds(mask: Uint8Array, width: number) {
  let x0 = width,
    y0 = Infinity,
    x1 = -1,
    y1 = -1;
  for (let i = 0; i < mask.length; i++)
    if (mask[i]) {
      const x = i % width,
        y = Math.floor(i / width);
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
  return x1 < x0
    ? undefined
    : { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
}
export function rectangleMask(
  width: number,
  height: number,
  a: Point,
  b: Point,
) {
  const mask = new Uint8Array(width * height);
  const left = Math.max(0, Math.min(a.x, b.x)),
    right = Math.min(width - 1, Math.max(a.x, b.x));
  const top = Math.max(0, Math.min(a.y, b.y)),
    bottom = Math.min(height - 1, Math.max(a.y, b.y));
  if (right < left || bottom < top) return mask;
  for (let y = top; y <= bottom; y++)
    mask.fill(1, y * width + left, y * width + right + 1);
  return mask;
}
/** Even/odd scanline fill plus pixel boundaries; concave lassos retain their shape. */
export function lassoMask(width: number, height: number, points: Point[]) {
  const mask = new Uint8Array(width * height);
  if (points.some((p) => ![p.x, p.y].every(Number.isInteger)))
    throw new Error("Некоректний контур виділення");
  points = points.map((p) => ({
    x: Math.max(0, Math.min(width - 1, p.x)),
    y: Math.max(0, Math.min(height - 1, p.y)),
  }));
  if (!points.length) return mask;
  if (points.length > 8192) throw new Error("Завеликий контур виділення");
  const set = (x: number, y: number) => {
    if (x >= 0 && x < width && y >= 0 && y < height) mask[y * width + x] = 1;
  };
  for (let y = 0; y < height; y++) {
    const hits: number[] = [];
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const a = points[i],
        b = points[j];
      if (a.y > y !== b.y > y)
        hits.push(a.x + ((y - a.y) * (b.x - a.x)) / (b.y - a.y));
    }
    hits.sort((a, b) => a - b);
    for (let i = 0; i + 1 < hits.length; i += 2)
      for (
        let x = Math.max(0, Math.ceil(hits[i]));
        x <= Math.min(width - 1, Math.floor(hits[i + 1]));
        x++
      )
        set(x, y);
  }
  for (let i = 0; i < points.length; i++) {
    const a = points[i],
      b = points[(i + 1) % points.length];
    line(a.x, a.y, b.x, b.y, set);
  }
  return mask;
}
export function extractRegion(
  glyph: Glyph,
  mask: Uint8Array,
  origin?: RegionOrigin,
) {
  if (mask.length !== glyph.width * glyph.height)
    throw new Error("Розмір виділення не відповідає гліфу");
  const b = maskBounds(mask, glyph.width);
  if (!b) return;
  const source = unpack(glyph),
    pixels = new Uint8Array(b.width * b.height),
    selection = new Uint8Array(pixels.length);
  for (let y = 0; y < b.height; y++)
    for (let x = 0; x < b.width; x++) {
      const from = (y + b.y) * glyph.width + x + b.x,
        to = y * b.width + x;
      pixels[to] = mask[from] ? source[from] : 0;
      selection[to] = mask[from];
    }
  return {
    x: b.x,
    y: b.y,
    region: {
      width: b.width,
      height: b.height,
      pixels,
      mask: selection,
      origin: origin
        ? {
            ...origin,
            rectangle: { x: b.x, y: b.y, width: b.width, height: b.height },
          }
        : undefined,
    } satisfies PixelRegion,
  };
}
export function placeRegion(
  glyph: Glyph,
  region: PixelRegion,
  x: number,
  y: number,
  transparent: boolean,
  clear?: Uint8Array,
) {
  if (!Number.isInteger(x) || !Number.isInteger(y))
    throw new Error("Зсув виділення має бути цілим");
  const pixels = unpack(glyph),
    mask = new Uint8Array(pixels.length);
  if (clear) {
    if (clear.length !== pixels.length)
      throw new Error("Невірна маска виділення");
    for (let i = 0; i < pixels.length; i++) if (clear[i]) pixels[i] = 0;
  }
  for (
    let py = Math.max(0, y);
    py < Math.min(glyph.height, y + region.height);
    py++
  )
    for (
      let px = Math.max(0, x);
      px < Math.min(glyph.width, x + region.width);
      px++
    ) {
      const from = (py - y) * region.width + px - x,
        to = py * glyph.width + px;
      if (!region.mask[from]) continue;
      mask[to] = 1;
      if (region.pixels[from] || !transparent) pixels[to] = region.pixels[from];
    }
  return {
    glyph: {
      ...structuredClone(glyph),
      rows: pack(pixels, glyph.width, glyph.height),
    },
    mask,
    pixels,
  };
}
export function eraseRegion(glyph: Glyph, mask: Uint8Array): Glyph {
  const pixels = unpack(glyph);
  if (mask.length !== pixels.length) throw new Error("Невірна маска виділення");
  for (let i = 0; i < pixels.length; i++) if (mask[i]) pixels[i] = 0;
  return {
    ...structuredClone(glyph),
    rows: pack(pixels, glyph.width, glyph.height),
  };
}
export function scaledRegion(
  region: PixelRegion,
  width: number,
  height: number,
): PixelRegion {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > 1024 ||
    height > 1024 ||
    width * height > 262144
  )
    throw new Error("Завеликий растр виділення");
  const pixels = new Uint8Array(width * height),
    mask = new Uint8Array(pixels.length);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const source =
          Math.floor((y * region.height) / height) * region.width +
          Math.floor((x * region.width) / width),
        to = y * width + x;
      pixels[to] = region.pixels[source];
      mask[to] = region.mask[source];
    }
  return { ...region, width, height, pixels, mask };
}
export function serializeRegion(region: PixelRegion) {
  const pixels = region.pixels.map((value, i) => (region.mask[i] ? value : 0));
  return (
    JSON.stringify(
      {
        format: "para-glyph-region",
        schemaVersion: "1.0.0",
        bitmap: {
          encoding: "hex-rows",
          bitOrder: "msb-first",
          bitsPerPixel: 1,
        },
        width: region.width,
        height: region.height,
        rowBytes: Math.ceil(region.width / 8),
        rows: pack(pixels, region.width, region.height),
        maskRows: pack(region.mask, region.width, region.height),
        origin: region.origin,
      },
      null,
      2,
    ) + "\n"
  );
}
export function parseRegion(text: string): PixelRegion {
  const fail = () =>
    new Error("У буфері немає коректного растрового виділення Verba");
  if (text.length > 512 * 1024) throw fail();
  let value: Record<string, unknown>;
  try {
    value = JSON.parse(text);
  } catch {
    throw fail();
  }
  if (
    !value ||
    value.format !== "para-glyph-region" ||
    value.schemaVersion !== "1.0.0" ||
    Object.keys(value).some(
      (key) =>
        ![
          "$schema",
          "format",
          "schemaVersion",
          "bitmap",
          "width",
          "height",
          "rowBytes",
          "rows",
          "maskRows",
          "origin",
        ].includes(key),
    )
  )
    throw fail();
  if (value.$schema !== undefined && typeof value.$schema !== "string")
    throw fail();
  const bitmap = value.bitmap as Record<string, unknown> | undefined;
  if (
    !bitmap ||
    bitmap.encoding !== "hex-rows" ||
    bitmap.bitOrder !== "msb-first" ||
    bitmap.bitsPerPixel !== 1 ||
    Object.keys(bitmap).length !== 3
  )
    throw fail();
  const w = Number(value.width),
    h = Number(value.height),
    rowBytes = Math.ceil(w / 8);
  if (
    typeof value.width !== "number" ||
    typeof value.height !== "number" ||
    !Number.isInteger(w) ||
    !Number.isInteger(h) ||
    w < 1 ||
    h < 1 ||
    w > 1024 ||
    h > 1024 ||
    w * h > 262144 ||
    value.rowBytes !== rowBytes
  )
    throw fail();
  const read = (rows: unknown) => {
    if (
      !Array.isArray(rows) ||
      rows.length !== h ||
      rows.some(
        (row) =>
          typeof row !== "string" ||
          row.length !== rowBytes * 2 ||
          !/^[0-9a-f]+$/i.test(row),
      )
    )
      throw fail();
    if (
      w % 8 &&
      rows.some(
        (row) => parseInt(row.slice(-2), 16) & ((1 << (8 - (w % 8))) - 1),
      )
    )
      throw fail();
    return unpack({ width: w, height: h, rowBytes, rows } as Glyph);
  };
  const pixels = read(value.rows),
    mask = read(value.maskRows);
  if (!mask.some(Boolean)) throw fail();
  const origin = value.origin as RegionOrigin | undefined;
  if (value.origin !== undefined) {
    if (
      !origin ||
      typeof origin !== "object" ||
      Array.isArray(origin) ||
      Object.keys(origin).some(
        (key) =>
          ![
            "fontId",
            "glyphId",
            "sha256",
            "licenseId",
            "char",
            "rectangle",
            "baseline",
            "advanceX",
            "draftRevision",
          ].includes(key),
      ) ||
      ![origin.fontId, origin.glyphId, origin.sha256, origin.licenseId].every(
        (x) => typeof x === "string" && x.length > 0 && x.length <= 256,
      ) ||
      !/^[a-f0-9]{64}$/.test(origin.sha256) ||
      !/^g[0-9]{6}$/.test(origin.glyphId) ||
      (origin.char !== undefined &&
        (typeof origin.char !== "string" || [...origin.char].length !== 1)) ||
      [origin.baseline, origin.advanceX].some(
        (x) =>
          x !== undefined &&
          (typeof x !== "number" || !Number.isFinite(x) || Math.abs(x) > 16384),
      ) ||
      (origin.draftRevision !== undefined &&
        (!Number.isInteger(origin.draftRevision) || origin.draftRevision < 0))
    )
      throw fail();
    if (origin.rectangle !== undefined) {
      const r = origin.rectangle;
      if (
        !r ||
        Array.isArray(r) ||
        typeof r !== "object" ||
        Object.keys(r).some(
          (k) => !["x", "y", "width", "height"].includes(k),
        ) ||
        ![r.x, r.y, r.width, r.height].every(Number.isInteger) ||
        r.x < 0 ||
        r.y < 0 ||
        r.x > 1023 ||
        r.y > 1023 ||
        r.width < 1 ||
        r.height < 1 ||
        r.width > 1024 ||
        r.height > 1024 ||
        r.width * r.height > 262144
      )
        throw fail();
    }
  }
  for (let i = 0; i < pixels.length; i++) if (!mask[i]) pixels[i] = 0;
  return { width: w, height: h, pixels, mask, ...(origin ? { origin } : {}) };
}
