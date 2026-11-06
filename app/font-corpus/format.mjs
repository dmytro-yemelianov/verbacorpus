import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import Ajv2020 from "ajv/dist/2020.js";

export const UKRAINIAN = [
  ..."АБВГҐДЕЄЖЗИІЇЙКЛМНОПРСТУФХЦЧШЩЬЮЯабвгґдеєжзиіїйклмнопрстуфхцчшщьюя",
];
export const sha256 = (bytes) =>
  createHash("sha256").update(bytes).digest("hex");
export const json = (data) => JSON.stringify(data) + "\n";
const schema = JSON.parse(
  await readFile(new URL("./schema.json", import.meta.url), "utf8"),
);
const validate = new Ajv2020({
  allErrors: true,
  allowUnionTypes: true,
}).compile(schema);

export function coverage(glyphs) {
  if (glyphs === null)
    return {
      glyphCount: 0,
      ukrainian: { required: 66, present: null, missing: null, complete: null },
    };
  const ink = new Set(
    glyphs
      .filter((g) => g.rows.some((r) => /[1-9A-F]/.test(r)))
      .map((g) => g.character),
  );
  const missing = UKRAINIAN.filter((char) => !ink.has(char));
  return {
    glyphCount: glyphs.length,
    ukrainian: {
      required: 66,
      present: 66 - missing.length,
      missing,
      complete: missing.length === 0,
    },
  };
}

export function validateFont(font) {
  if (!validate(font))
    throw new Error(`${font.id}: ${JSON.stringify(validate.errors)}`);
  const { width, height } = font.cell;
  if (font.bitmap.rowBytes !== Math.ceil(width / 8))
    throw new Error(`${font.id}: invalid rowBytes`);
  const expected = coverage(font.glyphs);
  if (
    font.coverage.glyphCount !== expected.glyphCount ||
    font.coverage.ukrainian.present !== expected.ukrainian.present ||
    font.coverage.ukrainian.complete !== expected.ukrainian.complete ||
    JSON.stringify(font.coverage.ukrainian.missing) !==
      JSON.stringify(expected.ukrainian.missing)
  )
    throw new Error(`${font.id}: invalid coverage`);
  if (font.glyphs === null) return font;
  let previous = -1;
  for (const glyph of font.glyphs) {
    const cp = parseInt(glyph.codepoint.slice(2), 16);
    if (
      cp <= previous ||
      cp > 0x10ffff ||
      (cp >= 0xd800 && cp <= 0xdfff) ||
      glyph.character !== String.fromCodePoint(cp)
    )
      throw new Error(
        `${font.id}: invalid/duplicate scalar ${glyph.codepoint}`,
      );
    previous = cp;
    if (
      glyph.rows.length !== height ||
      glyph.rows.some((r) => r.length !== font.bitmap.rowBytes * 2)
    )
      throw new Error(`${font.id}: invalid row dimensions`);
    const unused = font.bitmap.rowBytes * 8 - width;
    if (
      unused &&
      glyph.rows.some(
        (row) => parseInt(row.slice(-2), 16) & ((1 << unused) - 1),
      )
    )
      throw new Error(`${font.id}: ink outside cell`);
  }
  return font;
}

export function fromNasinnia(font, source) {
  const raster =
    font.availability === "downloadable" &&
    font.downloadAllowed !== false &&
    font.license.redistributionAllowed === true &&
    font.glyphData.length > 0;
  const glyphs = raster
    ? font.glyphData
        .map((g) => ({
          codepoint: g.codepoint.toUpperCase(),
          character:
            g.character ??
            String.fromCodePoint(parseInt(g.codepoint.slice(2), 16)),
          advanceX: g.advanceX ?? font.metrics.advanceX,
          rows: g.rows.map((row) => row.toUpperCase()),
          sourceCode: g.sourceCode ?? null,
        }))
        .sort(
          (a, b) =>
            parseInt(a.codepoint.slice(2), 16) -
            parseInt(b.codepoint.slice(2), 16),
        )
    : null;
  return validateFont({
    format: "para-font",
    schemaVersion: "1.0.0",
    id: font.id,
    name: font.displayName,
    family: font.family,
    version: font.version,
    kind: raster
      ? font.id === "public-domain-8x8-demo"
        ? "fixture"
        : font.sourceType === "derivative"
          ? "derived"
          : "native"
      : "metadata-only",
    availability: raster ? "raster" : "metadata-only",
    cell: {
      width: font.cell.width,
      height: font.cell.height,
      monospace: font.cell.monospace,
      pixelAspectRatio: font.pixelAspectRatio,
    },
    metrics: font.metrics,
    bitmap: {
      encoding: "hex-rows",
      bitOrder: "msb-first",
      rowBytes: Math.ceil(font.cell.width / 8),
    },
    encodings: font.encodings,
    license: {
      ...font.license,
      attribution:
        font.license.attribution ?? font.source.author ?? font.family,
    },
    source: { ...source, recordId: font.id, upstream: font.source },
    provenance: font.provenance,
    modifications: [],
    coverage: coverage(glyphs),
    glyphs,
  });
}
