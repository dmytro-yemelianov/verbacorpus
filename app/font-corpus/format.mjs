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
      unicodeGlyphCount: 0,
      unmappedGlyphCount: 0,
      ukrainian: { required: 66, present: null, missing: null, complete: null },
    };
  const mapped = glyphs.filter((g) =>
    (g.labels ?? [{ kind: "unicode", value: g.character }]).some(
      (l) => l.kind === "unicode",
    ),
  );
  const ink = new Set(
    mapped
      .filter((g) => g.rows.some((r) => /[1-9A-F]/.test(r)))
      .flatMap((g) =>
        (g.labels ?? [{ kind: "unicode", value: g.character }])
          .filter((l) => l.kind === "unicode")
          .map((l) => l.value),
      ),
  );
  const missing = UKRAINIAN.filter((c) => !ink.has(c));
  return {
    glyphCount: glyphs.length,
    unicodeGlyphCount: mapped.length,
    unmappedGlyphCount: glyphs.length - mapped.length,
    ukrainian: {
      required: 66,
      present: mapped.length ? 66 - missing.length : null,
      missing: mapped.length ? missing : null,
      complete: mapped.length ? missing.length === 0 : null,
    },
  };
}

export function upgrade(font) {
  if (font.schemaVersion === "2.0.0") return font;
  font.schemaVersion = "2.0.0";
  font.bitmap = {
    encoding: "hex-rows",
    bitOrder: "msb-first",
    bitsPerPixel: 1,
  };
  font.license.status =
    font.license.redistributionAllowed === true ? "verified" : "unverified";
  font.glyphs =
    font.glyphs?.map((g, i) => ({
      ...g,
      id: "g" + String(i).padStart(6, "0"),
      labels: [{ kind: "unicode", value: g.character }],
      width: font.cell.width,
      height: font.cell.height,
      rowBytes: Math.ceil(font.cell.width / 8),
      metrics: {
        leftBearing: 0,
        rightBearing: 0,
        shiftUp: font.metrics.baseline - font.cell.height,
      },
    })) ?? null;
  font.coverage = coverage(font.glyphs);
  return font;
}

export function validateFont(font) {
  if (!validate(font))
    throw new Error(`${font.id}: ${JSON.stringify(validate.errors)}`);
  if (font.glyphs === null) return font;
  const expected = coverage(font.glyphs);
  for (const key of ["glyphCount", "unicodeGlyphCount", "unmappedGlyphCount"])
    if (font.coverage[key] !== expected[key])
      throw new Error(`${font.id}: invalid coverage`);
  for (const key of ["present", "missing", "complete"])
    if (
      JSON.stringify(font.coverage.ukrainian[key]) !==
      JSON.stringify(expected.ukrainian[key])
    )
      throw new Error(`${font.id}: invalid coverage`);
  const ids = new Set();
  for (let i = 0; i < font.glyphs.length; i++) {
    const g = font.glyphs[i];
    if (g.id !== "g" + String(i).padStart(6, "0") || ids.has(g.id))
      throw new Error(`${font.id}: invalid glyph ID`);
    ids.add(g.id);
    if (g.codepoint !== null) {
      const cp = parseInt(g.codepoint.slice(2), 16);
      if (
        cp > 0x10ffff ||
        (cp >= 0xd800 && cp <= 0xdfff) ||
        g.character !== String.fromCodePoint(cp)
      )
        throw new Error(`${font.id}: invalid Unicode scalar`);
    }
    if (
      g.rowBytes !== Math.ceil(g.width / 8) ||
      g.rows.length !== g.height ||
      g.rows.some((r) => r.length !== g.rowBytes * 2)
    )
      throw new Error(`${font.id}: invalid row dimensions`);
    const unused = g.rowBytes * 8 - g.width;
    if (
      unused &&
      g.rows.some((r) => parseInt(r.slice(-2), 16) & ((1 << unused) - 1))
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
  return upgrade({
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
