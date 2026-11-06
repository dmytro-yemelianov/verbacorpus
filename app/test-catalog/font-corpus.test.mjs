import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { verifyCorpus } from "../verify_fonts.mjs";
import { validateFont, fromNasinnia } from "../font-corpus/format.mjs";

const corpus = await verifyCorpus();
const record = async (id) =>
  JSON.parse(
    await readFile(
      "public" + corpus.fonts.find((f) => f.id === id).url,
      "utf8",
    ),
  );
test("complete intake is pinned, schema-valid and pixel-exact with eight equivalent aliases", async () => {
  assert.equal(corpus.counts.records, 2266);
  assert.equal(corpus.counts.raster, 319);
  assert.equal(corpus.counts.metadataOnly, 1947);
  assert.equal(corpus.counts.ukrainianComplete, 6);
  assert.equal(corpus.counts.fixtures, 1);
  let aliases = 0;
  for (const f of corpus.fonts) {
    const font = await record(f.id);
    aliases += font.source.equivalentInputs?.length ?? 0;
    if (font.availability === "metadata-only") {
      assert.equal(font.glyphs, null);
      assert.equal(font.coverage.ukrainian.complete, null);
      assert.equal(font.license.redistributionAllowed, false);
    }
  }
  assert.equal(aliases, 8);
});
test("wide native rows and glyph advances survive interchange without resampling", async () => {
  const font = await record("cozette-13x15");
  assert.equal(font.bitmap.rowBytes, 2);
  assert.equal(font.cell.width, 13);
  for (const char of "ҐґЄєІіЇїʼ₴") {
    const glyph = font.glyphs.find((g) => g.character === char);
    assert.equal(glyph.advanceX, 6);
    assert.equal(glyph.rows.length, 15);
    assert.ok(glyph.rows.some((r) => parseInt(r, 16) > 0));
  }
  const reordered = structuredClone(font);
  reordered.coverage = {
    ukrainian: reordered.coverage.ukrainian,
    glyphCount: reordered.coverage.glyphCount,
  };
  assert.doesNotThrow(() => validateFont(reordered));
  const broken = structuredClone(font);
  broken.glyphs[0].rows[0] = "0001";
  assert.throws(() => validateFont(broken), /ink outside cell/);
  const forbidden = structuredClone(font);
  forbidden.license.redistributionAllowed = false;
  assert.throws(() => validateFont(forbidden));
});
test("metadata intake never exposes gated source rasters and unknown coverage stays unknown", () => {
  const source = {
    id: "unverified-font",
    family: "Example",
    displayName: "Example",
    version: 1,
    availability: "metadata-only",
    downloadAllowed: false,
    cell: { width: 8, height: 8, monospace: true },
    metrics: { baseline: 7, advanceX: 8 },
    pixelAspectRatio: { x: 1, y: 1 },
    encodings: [],
    license: {
      id: "UNKNOWN",
      redistributionAllowed: false,
      attribution: "Source author",
    },
    source: { author: "Source author" },
    provenance: {},
    glyphData: [
      {
        codepoint: "U+0041",
        character: "A",
        advanceX: 8,
        rows: Array(8).fill("FF"),
      },
    ],
  };
  const font = fromNasinnia(source, {
    collection: "nasinnia",
    revision: "0".repeat(40),
    sha256: "0".repeat(64),
  });
  assert.equal(font.glyphs, null);
  assert.equal(font.coverage.ukrainian.present, null);
  assert.equal(font.coverage.ukrainian.missing, null);
});
