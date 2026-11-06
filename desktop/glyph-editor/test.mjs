import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve, dirname, join } from "node:path";
import { validateFont } from "../../app/font-corpus/format.mjs";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../.."),
  app = join(root, "app");
const require = createRequire(join(app, "package.json")),
  { build } = require("esbuild");
const compiled = await build({
  entryPoints: [join(root, "desktop/glyph-editor/ui/model.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  write: false,
});
const m = await import(
  "data:text/javascript;base64," +
    Buffer.from(compiled.outputFiles[0].text).toString("base64")
);
const catalog = JSON.parse(
  await readFile(join(app, "font-corpus/catalog.json"), "utf8"),
);
const summary = catalog.fonts.find((f) => f.id === "acer-vga-8x8"),
  source = JSON.parse(await readFile(join(app, "public", summary.url), "utf8"));
test("bitmaps preserve wide rows and zero right-hand padding", () => {
  const pixels = new Uint8Array(770 * 3);
  for (const i of [0, 31, 32, 767, 768, 769, 770, 2309]) pixels[i] = 1;
  const rows = m.pack(pixels, 770, 3);
  assert.equal(rows[0].length, 194);
  assert.equal(parseInt(rows[0].slice(-2), 16) & 63, 0);
  assert.deepEqual(
    m.unpack({ width: 770, height: 3, rowBytes: 97, rows }),
    pixels,
  );
});
test("continuous strokes bridge fast pointer samples in both directions", () => {
  const a = [],
    b = [];
  m.line(0, 0, 9, 7, (x, y) => a.push([x, y]));
  m.line(9, 7, 0, 0, (x, y) => b.push([x, y]));
  assert.equal(a.length, 10);
  assert.deepEqual(a[0], [0, 0]);
  assert.deepEqual(a.at(-1), [9, 7]);
  assert.equal(b.length, 10);
  for (let i = 1; i < a.length; i++) {
    assert.ok(Math.abs(a[i][0] - a[i - 1][0]) <= 1);
    assert.ok(Math.abs(a[i][1] - a[i - 1][1]) <= 1);
  }
});
test("one stroke is one undo transaction; restoring source removes the patch", () => {
  const state = m.newDraft(summary, catalog.snapshot),
    doc = new m.Document(state),
    original = source.glyphs.find((g) => g.character === "A");
  const changed = m.transformed(original, "invert");
  doc.commit(original.id, changed, original);
  assert.equal(Object.keys(state.edits).length, 1);
  doc.undo();
  assert.equal(Object.keys(state.edits).length, 0);
  doc.redo();
  assert.deepEqual(state.edits[original.id].rows, changed.rows);
  doc.commit(original.id, original, original);
  assert.equal(Object.keys(state.edits).length, 0);
  assert.ok(state.revision >= 4);
});
test("new Ukrainian glyphs can be created, undone and exported without changing sources", () => {
  const raw = JSON.stringify(source),
    state = m.newDraft(summary, catalog.snapshot),
    doc = new m.Document(state),
    id = doc.nextID(source.glyphs.length);
  const glyph = m.blankGlyph(summary, id, "Ґ");
  glyph.rows[0] = "80".padEnd(glyph.rowBytes * 2, "0");
  doc.commit(id, glyph, undefined);
  assert.ok(state.created.includes(id));
  doc.undo();
  assert.equal(state.created.length, 0);
  doc.redo();
  const exported = m.exportRecord(source, state);
  validateFont(exported);
  assert.equal(exported.glyphs.length, source.glyphs.length + 1);
  assert.equal(exported.glyphs.at(-1).character, "Ґ");
  assert.deepEqual(exported.license, source.license);
  assert.deepEqual(exported.source, source.source);
  assert.equal(JSON.stringify(source), raw);
  assert.equal(exported.kind, "derived");
  assert.notEqual(exported.id, source.id);
});
test("Unicode aliases preserve numeric labels and update effective mapping", () => {
  const state = m.newDraft(summary, catalog.snapshot),
    doc = new m.Document(state),
    g = structuredClone(source.glyphs[0]);
  g.labels.push({ kind: "unicode", value: "Ґ" });
  doc.commit(g.id, g, source.glyphs[0]);
  const index = m.effectiveIndex({ A: [0] }, state);
  assert.deepEqual(index.get("Ґ"), [g.id]);
  assert.deepEqual(index.get("A"), []);
  assert.deepEqual(state.edits[g.id].sourceCode, source.glyphs[0].sourceCode);
});
test("resize, clipping transforms and whitespace remain valid", () => {
  const glyph = source.glyphs.find((g) => g.character === "A");
  const resized = m.resized(glyph, 9, 11);
  assert.equal(resized.rows.length, 11);
  assert.equal(resized.rowBytes, 2);
  assert.deepEqual(
    m.transformed(m.transformed(glyph, "flip-x"), "flip-x").rows,
    glyph.rows,
  );
  assert.deepEqual(
    m.transformed(m.transformed(glyph, "invert"), "invert").rows,
    glyph.rows,
  );
  assert.throws(() => m.resized(glyph, 1024, 1024));
  assert.equal(m.resized(glyph, 0, 0).rows.length, 0);
});
test("review progress and draft serialization are independent of source coverage", () => {
  const state = m.newDraft(summary, catalog.snapshot),
    doc = new m.Document(state);
  doc.review("U+0490");
  doc.review("U+0490");
  assert.deepEqual(state.reviewed, ["U+0490"]);
  assert.deepEqual(m.coverage(source.glyphs), source.coverage);
  const restored = JSON.parse(JSON.stringify(state));
  assert.deepEqual(restored, state);
  assert.equal(restored.baseSha256, summary.sha256);
  const blank = m.blankGlyph(summary, "g999999", "Ґ");
  assert.equal(m.coverage([blank]).ukrainian.present, 0);
});

test("editing invalidates review marks for the glyph and its Unicode slots", () => {
  const state = m.newDraft(summary, catalog.snapshot),
    doc = new m.Document(state),
    g = m.blankGlyph(summary, "g000256", "Ґ");
  doc.commit(g.id, g, undefined);
  doc.review(g.id);
  doc.review("U+0490");
  state.done = true;
  const changed = m.transformed(g, "invert");
  doc.commit(g.id, changed, undefined);
  assert.equal(state.reviewed.length, 0);
  assert.equal(state.done, false);
});
