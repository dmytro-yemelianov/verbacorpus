import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { verifyCorpus } from "../verify_fonts.mjs";
import { validateFont, sha256, json } from "../font-corpus/format.mjs";
const corpus = await verifyCorpus();
const record = async (id) =>
  JSON.parse(
    await readFile(
      "public" + corpus.fonts.find((f) => f.id === id).url,
      "utf8",
    ),
  );
test("every catalog record has actual native glyphs with complete source lineage", async () => {
  assert.equal(corpus.counts.records, 2266);
  assert.equal(corpus.counts.raster, 2266);
  assert.equal(corpus.counts.metadataOnly, 0);
  assert.equal(corpus.counts.glyphs, 583824);
  assert.equal(corpus.counts.unmappedGlyphs, 88773);
  assert.equal(corpus.counts.ukrainianComplete, 62);
  let aliases = 0,
    hoardGlyphs = 0,
    unmapped = 0,
    sequences = 0,
    hoardFonts = 0;
  for (const f of corpus.fonts) {
    const font = await record(f.id);
    aliases += font.source.equivalentInputs?.length ?? 0;
    assert.ok(font.glyphs.length > 0);
    if (font.source.collection === "hoard") {
      hoardFonts++;
      hoardGlyphs += font.glyphs.length;
      unmapped += font.coverage.unmappedGlyphCount;
      assert.equal(font.license.status, "unverified");
      assert.equal(font.license.redistributionAllowed, null);
      assert.ok(
        font.license.sourceNotices.some((n) => n.path === "LICENSE.md"),
      );
      assert.equal(sha256(json(font.glyphs)), font.provenance.rasterSha256);
      sequences += font.glyphs.filter((g) =>
        g.labels.some((l) => l.kind === "unicode" && [...l.value].length > 1),
      ).length;
    }
  }
  assert.equal(aliases, 8);
  assert.equal(hoardFonts, 1947);
  assert.equal(hoardGlyphs, 490940);
  assert.equal(unmapped, 88773);
  assert.equal(sequences, 152);
});
test("interchange preserves native variable dimensions, bearings, unmapped IDs and multi-byte rows", async () => {
  const font = await record("cozette-13x15");
  assert.equal(font.bitmap.bitsPerPixel, 1);
  for (const char of "ҐґЄєІіЇїʼ₴") {
    const g = font.glyphs.find((g) => g.character === char);
    assert.equal(g.advanceX, 6);
    assert.equal(g.rowBytes, 2);
    assert.equal(g.rows.length, 15);
    assert.ok(g.rows.some((r) => parseInt(r, 16)));
  }
  const reordered = structuredClone(font);
  reordered.coverage = {
    ukrainian: reordered.coverage.ukrainian,
    glyphCount: reordered.coverage.glyphCount,
    unicodeGlyphCount: reordered.coverage.unicodeGlyphCount,
    unmappedGlyphCount: reordered.coverage.unmappedGlyphCount,
  };
  assert.doesNotThrow(() => validateFont(reordered));
  const broken = structuredClone(font);
  broken.glyphs[0].rows[0] = "0001";
  assert.throws(() => validateFont(broken), /ink outside cell/);
  const native = await record("hoard-oberon-letterhead-300dpi");
  assert.ok(native.glyphs.some((g) => g.width === 770));
  assert.ok(native.glyphs.some((g) => g.metrics.shiftUp < 0));
  assert.ok(
    native.glyphs.every((g) => g.codepoint === null && g.character === null),
  );
  assert.equal(native.coverage.ukrainian.present, null);
});
test("export shards stay bounded and every glyph is independently addressable", async () => {
  assert.ok(corpus.export.shards.length > 1);
  assert.ok(corpus.export.shards.every((s) => s.bytes <= 8 * 1024 * 1024));
  const native = await record("hoard-nec-pc-nec-pc9821-kanji-16x16");
  assert.equal(native.glyphs.length, 8832);
  assert.equal(new Set(native.glyphs.map((g) => g.id)).size, 8832);
  assert.ok(
    native.glyphs.every((g, i) => g.id === "g" + String(i).padStart(6, "0")),
  );
});
