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
    contents:
      'export * from "./ui/model"; export * from "./ui/autofill"; export * from "./ui/raster-mutation"; export * from "./ui/regions";',
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

function raster(char, id, rows) {
  const width = rows[0].length,
    height = rows.length;
  const g = m.blankGlyph(summary, id, char);
  Object.assign(g, {
    width,
    height,
    rowBytes: Math.ceil(width / 8),
    advanceX: width,
    rows: m.pack(
      Uint8Array.from(rows.join(""), (c) => (c === "#" ? 1 : 0)),
      width,
      height,
    ),
    metrics: { leftBearing: 0, rightBearing: 0, shiftUp: -1 },
  });
  return g;
}
test("V/Л, U/П and h/ч suggest the requested flips/rotations in both directions", async () => {
  const state = m.newDraft(summary, catalog.snapshot),
    glyphs = [letter("V"), letter("U"), letter("h")];
  const plans = await m.propose(
    "geometry",
    unicodeIndex(glyphs),
    state,
    load(glyphs),
  );
  for (const [from, to] of [
    ["V", "Л"],
    ["U", "П"],
    ["h", "ч"],
  ]) {
    const p = plans.find(
      (p) => p.from === from && p.to === to && p.transform === "rotate180",
    );
    assert.ok(p);
    assert.deepEqual(p.image.rows, m.transformed(p.source, "rotate180").rows);
    const [edit] = m.materialize([p], state, source.glyphs.length);
    const reverse = await m.propose(
      "geometry",
      unicodeIndex([edit.glyph]),
      state,
      load([edit.glyph]),
    );
    assert.ok(
      reverse.some((p) => p.to === from && p.transform === "rotate180"),
    );
  }
  assert.ok(
    plans.some(
      (p) => p.from === "V" && p.to === "Л" && p.transform === "flip-y",
    ),
  );
  assert.ok(
    plans.some(
      (p) => p.from === "U" && p.to === "П" && p.transform === "flip-y",
    ),
  );
});
test("ж shares a stem between k and its mirror, trims the ascender and preserves cell/advance", async () => {
  const k = raster("к", "g999900", [
    ".#.......",
    ".#..#....",
    ".#.#.....",
    ".##......",
    ".#.#.....",
    ".#..#....",
    ".........",
  ]);
  const state = m.newDraft(summary, catalog.snapshot),
    before = structuredClone(k);
  const plans = await m.propose(
    "geometry",
    unicodeIndex([k]),
    state,
    load([k]),
  );
  const p = plans.find((p) => p.to === "ж");
  assert.ok(p);
  assert.equal(p.transform, "compose-zhe");
  const [edit] = m.materialize([p], state, source.glyphs.length);
  assert.deepEqual(edit.glyph.rows, p.image.rows);
  assert.deepEqual(
    [edit.glyph.width, edit.glyph.height, edit.glyph.advanceX],
    [9, 7, 9],
  );
  const pixels = m.unpack(edit.glyph);
  assert.ok(!pixels.slice(0, 9).some(Boolean));
  for (let y = 0; y < 7; y++)
    for (let x = 0; x < 9; x++)
      assert.equal(pixels[y * 9 + x], pixels[y * 9 + 8 - x]);
  assert.ok(pixels[1 * 9 + 4]);
  assert.deepEqual(
    edit.derivation.components.map((c) => c.transform),
    ["identity", "flip-x"],
  );
  assert.deepEqual(k, before);
});
test("ю uses н's stem/crossbar and о's bowl aligned to the same baseline", async () => {
  const n = raster("н", "g999900", [
    ".#....#.",
    ".#....#.",
    ".######.",
    ".#....#.",
    ".#....#.",
    "........",
  ]);
  const o = raster("о", "g999901", [
    ".###...",
    "#...#..",
    "#...#..",
    "#...#..",
    ".###...",
  ]);
  const state = m.newDraft(summary, catalog.snapshot),
    before = JSON.stringify([n, o]);
  const plans = await m.propose(
    "geometry",
    unicodeIndex([n, o]),
    state,
    load([n, o]),
  );
  const p = plans.find((p) => p.to === "ю");
  assert.ok(p);
  const [edit] = m.materialize([p], state, source.glyphs.length);
  const g = edit.glyph,
    pixels = m.unpack(g),
    pixel = (x, y) => pixels[y * g.width + x];
  assert.equal(g.width, n.width);
  assert.equal(g.advanceX, n.advanceX);
  assert.equal(g.height + g.metrics.shiftUp, n.height + n.metrics.shiftUp);
  assert.equal(pixel(1, 0), 1); // left stem
  assert.equal(pixel(2, 2), 1); // original crossbar row
  assert.equal(pixel(2, 1), 0);
  assert.equal(pixel(3, 2), 1); // bowl side
  assert.equal(pixel(7, 2), 1);
  assert.equal(pixel(4, 5), 1); // bowl's last row: baseline-aligned rather than top-aligned
  assert.deepEqual(g.rows, p.image.rows);
  assert.deepEqual(
    edit.derivation.components.map((c) => c.sourceGlyphId),
    [n.id, o.id],
  );
  assert.equal(JSON.stringify([n, o]), before);
});
test("compositions require all known nonempty sources and protect existing/manual targets", async () => {
  const state = m.newDraft(summary, catalog.snapshot);
  const n = raster("н", "g999900", ["#...#..", "#####..", "#...#.."]);
  const o = raster("о", "g999901", [".###...", "#...#..", ".###..."]);
  const available = async (glyphs) =>
    (
      await m.propose("geometry", unicodeIndex(glyphs), state, load(glyphs))
    ).filter((p) => p.to === "ю");
  assert.equal((await available([n])).length, 0);
  assert.equal((await available([o])).length, 0);
  assert.equal((await available([n, o])).length, 1);
  const target = raster("ю", "g999902", ["#......", ".......", "......."]);
  assert.equal((await available([n, o, target])).length, 0);
  target.rows = target.rows.map(() => "00");
  state.edits[target.id] = target;
  assert.equal((await available([n, o, target])).length, 0);
  const unmapped = structuredClone(o);
  unmapped.labels = [{ kind: "codepoint", value: "1086" }];
  assert.equal((await available([n, unmapped])).length, 0);
});
test("composite drafts undo as one batch and export remaps every source component ID", async () => {
  const state = m.newDraft(summary, catalog.snapshot),
    doc = new m.Document(state);
  const n = raster("н", "g000300", ["#...#...", "#####...", "#...#..."]);
  const o = raster("о", "g000310", [".###....", "#...#...", ".###...."]);
  doc.commitBatch([
    { id: n.id, glyph: n },
    { id: o.id, glyph: o },
  ]);
  const plans = await m.propose(
    "geometry",
    unicodeIndex([n, o]),
    state,
    load([n, o]),
  );
  const p = plans.find((p) => p.to === "ю");
  const edits = m.materialize([p], state, source.glyphs.length);
  doc.commitBatch(edits);
  assert.equal(state.created.length, 3);
  doc.undo();
  assert.equal(state.created.length, 2);
  assert.equal(state.edits[edits[0].id], undefined);
  doc.redo();
  const exported = m.exportRecord(source, state);
  validateFont(exported);
  const recipe = exported.modifications.at(-1).derivations[0];
  assert.equal(recipe.recipeVersion, 1);
  assert.equal(recipe.transform, "compose-yu");
  assert.equal(recipe.sourceGlyphId, exported.glyphs.at(-3).id);
  assert.deepEqual(
    recipe.components.map((p) => p.sourceGlyphId),
    exported.glyphs.slice(-3, -1).map((g) => g.id),
  );
  assert.equal(recipe.glyphId, exported.glyphs.at(-1).id);
  const restored = JSON.parse(JSON.stringify(state));
  assert.deepEqual(restored.derivations, state.derivations);
});

test("raster pan moves ink inside the fixed cell without changing mapping or metrics", () => {
  const g = raster("А", "g999900", [
      "......",
      ".##...",
      ".#....",
      "......",
      "......",
    ]),
    before = structuredClone(g);
  const moved = m.mutatedRaster(g, {
    dx: 2,
    dy: 1,
    width: 2,
    height: 2,
    anchor: "top-left",
  });
  const expected = raster("А", g.id, [
    "......",
    "......",
    "...##.",
    "...#..",
    "......",
  ]);
  assert.deepEqual(moved.rows, expected.rows);
  assert.deepEqual({ ...moved, rows: g.rows }, g);
  assert.deepEqual(g, before);
});
test("raster zoom uses nearest pixels and supports separate horizontal/vertical scale", () => {
  const g = raster("А", "g999900", [
    "........",
    ".#......",
    "..#.....",
    "........",
    "........",
    "........",
  ]);
  const scaled = m.mutatedRaster(g, {
    dx: 0,
    dy: 0,
    width: 4,
    height: 4,
    anchor: "top-left",
  });
  const expected = raster("А", g.id, [
    "........",
    ".##.....",
    ".##.....",
    "...##...",
    "...##...",
    "........",
  ]);
  assert.deepEqual(scaled.rows, expected.rows);
  const wide = m.mutatedRaster(g, {
    dx: 0,
    dy: 0,
    width: 4,
    height: 2,
    anchor: "top-left",
  });
  assert.deepEqual(
    wide.rows,
    raster("А", g.id, [
      "........",
      ".##.....",
      "...##...",
      "........",
      "........",
      "........",
    ]).rows,
  );
});
test("raster anchors preserve center, top-left or baseline before translating", () => {
  const g = raster("А", "g999900", [
    "........",
    "........",
    "........",
    "........",
    "..##....",
    "..##....",
    "........",
    "........",
  ]);
  g.metrics.shiftUp = -2;
  const session = m.createRasterMutation(g),
    size = { dx: 0, dy: 0, width: 4, height: 4 };
  assert.deepEqual(session.render({ ...size, anchor: "top-left" }).bounds, {
    x: 2,
    y: 4,
    width: 4,
    height: 4,
  });
  assert.deepEqual(session.render({ ...size, anchor: "center" }).bounds, {
    x: 1,
    y: 3,
    width: 4,
    height: 4,
  });
  assert.deepEqual(session.render({ ...size, anchor: "baseline" }).bounds, {
    x: 1,
    y: 2,
    width: 4,
    height: 4,
  });
  assert.deepEqual(
    session.render({ ...size, dx: 1, dy: -1, anchor: "baseline" }).bounds,
    { x: 2, y: 1, width: 4, height: 4 },
  );
});
test("drag previews recover pixels when dragged off canvas and back, without resampling prior previews", () => {
  const g = letter("A"),
    session = m.createRasterMutation(g),
    b = session.bounds;
  const identity = {
    dx: 0,
    dy: 0,
    width: b.width,
    height: b.height,
    anchor: "center",
  };
  const outside = session.render({ ...identity, dx: 16384 });
  assert.equal(outside.clipped, true);
  assert.ok(!outside.pixels.some(Boolean));
  session.render({ ...identity, width: Math.max(1, Math.round(b.width / 2)) });
  const restored = session.render(identity);
  assert.equal(restored.clipped, false);
  assert.deepEqual(restored.pixels, m.unpack(g));
});
test("mutation validation rejects invalid geometry and virtual scaled previews stay cell-bounded", () => {
  const g = letter("A"),
    session = m.createRasterMutation(g),
    b = session.bounds;
  const valid = {
    dx: 0,
    dy: 0,
    width: b.width,
    height: b.height,
    anchor: "center",
  };
  for (const invalid of [
    { dx: 0.5 },
    { dy: NaN },
    { width: 0 },
    { height: 8193 },
    { dx: 16385 },
    { anchor: "bogus" },
  ])
    assert.throws(() => session.render({ ...valid, ...invalid }));
  const large = session.render({ ...valid, width: 8192, height: 8192 });
  assert.equal(large.pixels.length, g.width * g.height);
  assert.equal(large.clipped, true);
  const empty = m.blankGlyph(summary, "g999999", " ");
  assert.equal(m.createRasterMutation(empty).bounds, undefined);
  assert.deepEqual(m.mutatedRaster(empty, valid), empty);
});
test("a raster mutation is one undo step and exports a canonical glyph with original metrics", () => {
  const state = m.newDraft(summary, catalog.snapshot),
    doc = new m.Document(state),
    g = letter("A");
  const b = m.createRasterMutation(g).bounds;
  const after = m.mutatedRaster(g, {
    dx: 1,
    dy: -1,
    width: Math.max(1, b.width - 1),
    height: b.height,
    anchor: "baseline",
  });
  doc.commit(g.id, after, g);
  assert.equal(state.revision, 1);
  assert.deepEqual(state.edits[g.id].metrics, g.metrics);
  validateFont(m.exportRecord(source, state));
  doc.undo();
  assert.deepEqual(state.edits, {});
  doc.redo();
  assert.deepEqual(state.edits[g.id].rows, after.rows);
});

test("canonical regions order digits, Latin and Ukrainian by alphabet instead of source ordinals", () => {
  const index = new Map([
    ["0", ["g000099"]],
    ["A", ["g000003"]],
    ["Ґ", ["g000010"]],
  ]);
  const digits = m.canonicalSlots("digits", index);
  assert.equal(digits.map((s) => s.char).join(""), "0123456789");
  assert.equal(digits[0].id, "g000099");
  const latin = m.canonicalSlots("latin", index);
  assert.equal(
    latin.map((s) => s.char).join(""),
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",
  );
  assert.equal(latin[0].id, "g000003");
  const ua = m.canonicalSlots("ukrainian", index);
  assert.equal(ua.length, 66);
  assert.equal(ua.map((s) => s.char).join(""), m.UKRAINIAN.join(""));
  assert.equal(ua[4].char, "Ґ");
  assert.equal(ua[4].id, "g000010");
  assert.notEqual(ua[0].section, ua[33].section);
});
test("canonical slots preserve missing symbols and distinct slots for shared glyph aliases", () => {
  const index = new Map([
    ["A", ["g000001"]],
    ["А", ["g000001"]],
  ]);
  const before = [...index].map(([c, ids]) => [c, [...ids]]);
  const all = m.canonicalSlots("canonical", index);
  assert.equal(all.find((s) => s.char === "A").id, "g000001");
  assert.equal(all.find((s) => s.char === "А").id, "g000001");
  assert.notEqual(
    all.find((s) => s.char === "A").key,
    all.find((s) => s.char === "А").key,
  );
  assert.equal(all.find((s) => s.char === "Ґ").id, undefined);
  assert.deepEqual([...index], before);
  assert.equal(m.canonicalSlots("all", index), undefined);
  assert.equal(m.canonicalSlots("unmapped", index), undefined);
});
test("named regions have unique codepoint slots and useful headings for every character", () => {
  const all = m.canonicalSlots("canonical", new Map());
  assert.equal(new Set(all.map((s) => s.key)).size, all.length);
  for (const s of all) {
    assert.ok(s.section);
    assert.equal(s.key, m.codepoint(s.char));
    assert.equal([...s.char].length, 1);
  }
  assert.equal(m.regionFor("9").id, "digits");
  assert.equal(m.regionFor("ї").id, "ukrainian");
  assert.equal(m.regionFor("’").id, "punctuation");
  assert.equal(m.regionFor("₴").id, "symbols");
  assert.equal(m.regionFor("┌").id, "drawing");
  assert.equal(m.regionFor("😀"), undefined);
});
test("human glyph captions distinguish Latin/Cyrillic and name invisible characters", () => {
  assert.equal(m.characterLabel("A"), "A · лат.");
  assert.equal(m.characterLabel("А"), "А · укр.");
  assert.equal(m.characterLabel("Э"), "Э · кир.");
  assert.equal(m.characterLabel("0"), "0");
  assert.equal(m.characterLabel(" "), "Пробіл");
  assert.equal(m.characterLabel("\u00a0"), "Нерозривний пробіл");
  assert.equal(m.characterLabel("\t"), "Табуляція");
  assert.equal(m.glyphCaption(undefined, letter("A")), "A · лат.");
  assert.equal(m.glyphCaption("А", letter("A")), "А · укр.");
});
test("captions never infer Unicode from numeric source labels or stale primary characters", () => {
  const g = structuredClone(letter("A"));
  g.labels = [{ kind: "codepoint", value: "65" }];
  assert.equal(m.mappedCharacter(g), undefined);
  assert.equal(m.glyphCaption(undefined, g), "код 0x41");
  g.sourceCode = null;
  assert.equal(m.glyphCaption(undefined, g), "Без Unicode");
});
