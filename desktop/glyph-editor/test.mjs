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
  stdin: {
    contents: 'export * from "./ui/model"; export * from "./ui/autofill";',
    resolveDir: join(root, "desktop/glyph-editor"),
    sourcefile: "model-tests.ts",
  },
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

function unicodeIndex(glyphs) {
  const index = new Map();
  for (const g of glyphs)
    for (const label of g.labels)
      if (label.kind === "unicode")
        index.set(label.value, [...(index.get(label.value) ?? []), g.id]);
  return index;
}
const letter = (char) =>
  source.glyphs.find((g) =>
    g.labels.some((l) => l.kind === "unicode" && l.value === char),
  );
const load = (glyphs) => async (id) => glyphs.find((g) => g.id === id);
test("homographs copy rasters and metrics in both directions, with one undo and canonical export", async () => {
  const state = m.newDraft(summary, catalog.snapshot),
    doc = new m.Document(state);
  const selected = [letter("A"), letter("B"), letter("p")];
  const plans = await m.propose(
    "homograph",
    unicodeIndex(selected),
    state,
    load(selected),
  );
  assert.deepEqual(
    plans.map((p) => p.to),
    ["А", "В", "р"],
  );
  const edits = m.materialize(plans, state, source.glyphs.length);
  doc.commitBatch(edits);
  assert.equal(state.revision, 1);
  assert.equal(state.created.length, 3);
  for (const [i, p] of plans.entries()) {
    const g = state.edits[edits[i].id];
    assert.deepEqual(g.rows, p.source.rows);
    assert.deepEqual(g.metrics, p.source.metrics);
    assert.deepEqual(g.labels, [{ kind: "unicode", value: p.to }]);
    assert.equal(g.sourceCode, null);
    assert.equal(state.derivations[g.id].sourceGlyphId, p.source.id);
  }
  const exported = m.exportRecord(source, state);
  validateFont(exported);
  assert.equal(exported.modifications.at(-1).derivations.length, 3);
  doc.undo();
  assert.deepEqual(state.created, []);
  assert.deepEqual(state.edits, {});
  assert.deepEqual(state.derivations, {});
  doc.redo();
  assert.equal(state.created.length, 3);
  const effective = unicodeIndex([...selected, ...Object.values(state.edits)]);
  assert.equal(
    (
      await m.propose(
        "homograph",
        effective,
        state,
        load([...selected, ...Object.values(state.edits)]),
      )
    ).length,
    0,
  );
  const cyrillic = Object.values(state.edits);
  const reverse = await m.propose(
    "homograph",
    unicodeIndex(cyrillic),
    state,
    load(cyrillic),
  );
  assert.deepEqual(
    reverse.map((p) => p.to),
    ["A", "B", "p"],
  );
});
test("autofill protects nonempty variants, manual blank edits and shared aliases", async () => {
  const a = letter("A"),
    state = m.newDraft(summary, catalog.snapshot);
  const target = m.blankGlyph(summary, "g999991", "А");
  const candidates = async (targets) =>
    m.propose(
      "homograph",
      unicodeIndex([a, ...targets]),
      state,
      load([a, ...targets]),
    );
  assert.equal((await candidates([target])).length, 1);
  target.rows = [...a.rows];
  assert.equal((await candidates([target])).length, 0);
  target.rows = m.pack(
    new Uint8Array(target.width * target.height),
    target.width,
    target.height,
  );
  state.edits[target.id] = structuredClone(target);
  assert.equal((await candidates([target])).length, 0);
  delete state.edits[target.id];
  target.labels.push({ kind: "unicode", value: "Б" });
  assert.equal((await candidates([target])).length, 0);
  target.labels.pop();
  assert.equal(
    (await candidates([target, { ...a, id: "g999992", labels: target.labels }]))
      .length,
    0,
  );
  assert.equal(
    (await candidates([target, { ...target, id: "g999993" }])).length,
    0,
  );
});
test("autofill uses explicit Unicode only and does not chain generated proposals", async () => {
  const state = m.newDraft(summary, catalog.snapshot),
    a = structuredClone(letter("A"));
  a.labels = [{ kind: "codepoint", value: "65" }];
  assert.equal(
    (await m.propose("homograph", unicodeIndex([a]), state, load([a]))).length,
    0,
  );
  // R->Я exists, but Я cannot then become a source in the same pass.
  const r = letter("R");
  const proposals = await m.propose(
    "geometry",
    unicodeIndex([r]),
    state,
    load([r]),
  );
  assert.deepEqual(
    proposals.map((p) => [p.from, p.to, p.transform]),
    [["R", "Я", "flip-x"]],
  );
  const missing = new Map([
    ["A", [letter("A").id]],
    ["А", ["g999999"]],
  ]);
  assert.equal(
    (await m.propose("homograph", missing, state, load([letter("A")]))).length,
    0,
  );
});
test("geometric suggestions include mirrored R/Я, flipped p/ь and alternative L/Г rotations", async () => {
  const state = m.newDraft(summary, catalog.snapshot),
    glyphs = [letter("R"), letter("p"), letter("L")];
  const proposals = await m.propose(
    "geometry",
    unicodeIndex(glyphs),
    state,
    load(glyphs),
  );
  for (const [from, to, transform] of [
    ["R", "Я", "flip-x"],
    ["p", "ь", "flip-y"],
    ["L", "Г", "rotate90"],
  ]) {
    const p = proposals.find(
      (p) => p.from === from && p.to === to && p.transform === transform,
    );
    assert.ok(p);
    const [edit] = m.materialize([p], state, source.glyphs.length);
    assert.deepEqual(edit.glyph.rows, m.transformed(p.source, transform).rows);
    assert.equal(edit.derivation.kind, "geometry");
  }
  assert.throws(
    () =>
      m.materialize(
        proposals.filter((p) => p.to === "Г"),
        state,
        source.glyphs.length,
      ),
    /один варіант/,
  );
});
test("rectangular rotations preserve every pixel, swap dimensions, and invert with metrics", () => {
  const g = {
    ...structuredClone(letter("A")),
    width: 3,
    height: 2,
    rowBytes: 1,
    rows: ["80", "60"],
    advanceX: 5,
    metrics: { leftBearing: 1, rightBearing: 1, shiftUp: -1 },
  };
  const cw = m.transformed(g, "rotate90");
  assert.deepEqual([cw.width, cw.height, cw.rowBytes], [2, 3, 1]);
  assert.deepEqual(cw.rows, ["40", "80", "80"]);
  assert.deepEqual(m.transformed(cw, "rotate270"), g);
  assert.deepEqual(
    m.transformed(m.transformed(g, "rotate180"), "rotate180"),
    g,
  );
  let full = g;
  for (let n = 0; n < 4; n++) full = m.transformed(full, "rotate90");
  assert.deepEqual(full, g);
  assert.deepEqual(m.transformed(g, "rotate180").rows, ["C0", "20"]);
});
test("batch validation is atomic and undo restores derivations and reviews are invalidated", () => {
  const state = m.newDraft(summary, catalog.snapshot),
    doc = new m.Document(state);
  const g = letter("A"),
    changed = m.transformed(g, "invert");
  doc.review(g.id);
  doc.review("U+0041");
  state.done = true;
  const before = structuredClone(state);
  assert.throws(() =>
    doc.commitBatch([
      { id: g.id, glyph: changed, source: g },
      { id: g.id, glyph: changed, source: g },
    ]),
  );
  assert.deepEqual(state, before);
  const recipe = {
    sourceGlyphId: "g000001",
    sourceChar: "А",
    targetChar: "A",
    transform: "identity",
    kind: "homograph",
  };
  doc.commitBatch([
    { id: g.id, glyph: changed, source: g, derivation: recipe },
  ]);
  assert.deepEqual(state.reviewed, []);
  assert.equal(state.done, false);
  doc.commit(g.id, g, g);
  assert.deepEqual(state.derivations, {});
  doc.undo();
  assert.deepEqual(state.derivations[g.id], recipe);
  doc.redo();
  assert.deepEqual(state.derivations, {});
});
test("export remaps created glyph IDs in recipes after deletion leaves an ID gap", () => {
  const state = m.newDraft(summary, catalog.snapshot),
    doc = new m.Document(state);
  const id = "g" + String(source.glyphs.length + 5).padStart(6, "0");
  const g = m.blankGlyph(summary, id, "Я");
  const recipe = {
    sourceGlyphId: letter("R").id,
    sourceChar: "R",
    targetChar: "Я",
    transform: "flip-x",
    kind: "geometry",
  };
  g.rows = [...letter("R").rows];
  doc.commitBatch([{ id, glyph: g, derivation: recipe }]);
  const record = m.exportRecord(source, state);
  validateFont(record);
  assert.equal(
    record.modifications.at(-1).derivations[0].glyphId,
    record.glyphs.at(-1).id,
  );
  assert.notEqual(record.glyphs.at(-1).id, id);
});
