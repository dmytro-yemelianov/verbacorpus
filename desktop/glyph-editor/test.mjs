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
      'export * from "./ui/model"; export * from "./ui/autofill"; export * from "./ui/raster-mutation"; export * from "./ui/regions"; export * from "./ui/pixel-regions"; export * from "./ui/guides"; export * from "./ui/pixel-stroke"; export * from "./ui/shortcuts"; export * from "./ui/font-guides"; export * from "./ui/comparison"; export * from "./ui/candidates"; export * from "./ui/style-plan"; export * from "./ui/font-profile"; export * from "./ui/auto-guides"; export * from "./ui/ascii-mapping"; export * from "./ui/group-selection"; export * from "./ui/monospace"; export * from "./ui/glyph-gallery";',
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
  assert.equal(m.characterLabel("A"), "A · лат. · велика");
  assert.equal(m.characterLabel("А"), "А · укр. · велика");
  assert.equal(m.characterLabel("Э"), "Э · кир. · велика");
  assert.equal(m.characterLabel("0"), "0");
  assert.equal(m.characterLabel(" "), "Пробіл");
  assert.equal(m.characterLabel("\u00a0"), "Нерозривний пробіл");
  assert.equal(m.characterLabel("\t"), "Табуляція");
  assert.equal(m.glyphCaption(undefined, letter("A")), "A · лат. · велика");
  assert.equal(m.glyphCaption("А", letter("A")), "А · укр. · велика");
});
test("captions never infer Unicode from numeric source labels or stale primary characters", () => {
  const g = structuredClone(letter("A"));
  g.labels = [{ kind: "codepoint", value: "65" }];
  assert.equal(m.mappedCharacter(g), undefined);
  assert.equal(m.glyphCaption(undefined, g), "код 0x41");
  g.sourceCode = null;
  assert.equal(m.glyphCaption(undefined, g), "Без Unicode");
});

const { default: Ajv2020 } = require("ajv/dist/2020.js");
const regionSchema = JSON.parse(
  await readFile(
    join(root, "desktop/glyph-editor/pixel-region.schema.json"),
    "utf8",
  ),
);
const validateRegionSchema = new Ajv2020({ allErrors: true }).compile(
  regionSchema,
);
const regionExample = JSON.parse(
  await readFile(
    join(root, "desktop/glyph-editor/pixel-region.example.json"),
    "utf8",
  ),
);
const clipOrigin = {
  fontId: summary.id,
  glyphId: "g000065",
  sha256: summary.sha256,
  licenseId: summary.licenseId,
  char: "A",
  baseline: 7,
  advanceX: 8,
  draftRevision: 2,
};
test("rectangle selection includes reversed endpoints and clips safely at every edge", () => {
  const a = m.rectangleMask(5, 4, { x: 3, y: 2 }, { x: 1, y: 1 });
  assert.equal(
    a.reduce((a, b) => a + b, 0),
    6,
  );
  assert.deepEqual(m.maskBounds(a, 5), { x: 1, y: 1, width: 3, height: 2 });
  assert.equal(
    m.rectangleMask(5, 4, { x: -9, y: 0 }, { x: -2, y: 3 }).some(Boolean),
    false,
  );
  assert.equal(
    m.rectangleMask(5, 4, { x: 0, y: 9 }, { x: 3, y: 12 }).some(Boolean),
    false,
  );
  assert.equal(
    m
      .rectangleMask(5, 4, { x: -9, y: -9 }, { x: 9, y: 9 })
      .reduce((a, b) => a + b, 0),
    20,
  );
});
test("freehand selection supports concave shapes instead of filling the bounding box", () => {
  const mask = m.lassoMask(5, 5, [
    { x: 0, y: 0 },
    { x: 4, y: 0 },
    { x: 4, y: 1 },
    { x: 1, y: 1 },
    { x: 1, y: 4 },
    { x: 0, y: 4 },
  ]);
  assert.equal(mask[2 * 5 + 1], 1);
  assert.equal(mask[2 * 5 + 3], 0);
  assert.equal(mask[4 * 5], 1);
  assert.equal(mask[4 * 5 + 4], 0);
  assert.equal(m.lassoMask(5, 5, []).some(Boolean), false);
  assert.throws(() => m.lassoMask(5, 5, [{ x: NaN, y: 0 }]));
});
test("copy extracts a masked crop and never includes unselected pixels in the payload", () => {
  const g = raster("A", "g000065", [
    "#####",
    "#####",
    "#####",
    "#####",
    "#####",
  ]);
  const mask = m.lassoMask(5, 5, [
    { x: 0, y: 0 },
    { x: 4, y: 0 },
    { x: 4, y: 1 },
    { x: 1, y: 1 },
    { x: 1, y: 4 },
    { x: 0, y: 4 },
  ]);
  const before = JSON.stringify(g),
    extracted = m.extractRegion(g, mask, clipOrigin);
  assert.deepEqual(extracted.region.origin.rectangle, {
    x: 0,
    y: 0,
    width: 5,
    height: 5,
  });
  assert.equal(extracted.region.pixels[2 * 5 + 3], 0);
  assert.equal(extracted.region.mask[2 * 5 + 3], 0);
  assert.equal(extracted.region.pixels[2 * 5 + 1], 1);
  assert.equal(JSON.stringify(g), before);
  assert.throws(() => m.extractRegion(g, new Uint8Array(1)));
});
test("paste across glyphs preserves destination metrics, mapping and pixels outside the shape", () => {
  const region = m.parseRegion(JSON.stringify(regionExample));
  const g = raster("Б", "g000066", [
    "#####",
    "#####",
    "#####",
    "#####",
    "#####",
  ]);
  const opaque = m.placeRegion(g, region, 1, 1, false);
  assert.deepEqual({ ...opaque.glyph, rows: g.rows }, g);
  assert.equal(m.unpack(opaque.glyph)[1 * 5 + 1], 1); // outside cross mask
  const rectangle = { ...region, mask: new Uint8Array(9).fill(1) };
  const erased = m.placeRegion(g, rectangle, 1, 1, false);
  assert.equal(m.unpack(erased.glyph)[1 * 5 + 1], 0); // selected white corner erases
  assert.equal(
    m.unpack(m.placeRegion(g, rectangle, 1, 1, true).glyph)[1 * 5 + 1],
    1,
  );
});
test("moving a selected region clears only its source mask and copies keep the source intact", () => {
  const g = raster("A", "g000065", ["##...", "#....", ".....", "....."]);
  const mask = m.rectangleMask(5, 4, { x: 0, y: 0 }, { x: 1, y: 1 }),
    region = m.extractRegion(g, mask).region;
  const moved = m.placeRegion(g, region, 3, 2, true, mask);
  const copied = m.placeRegion(g, region, 3, 2, true);
  assert.deepEqual(
    moved.glyph.rows,
    raster("A", g.id, [".....", ".....", "...##", "...#."]).rows,
  );
  assert.equal(m.unpack(copied.glyph)[0], 1);
  assert.equal(m.unpack(copied.glyph)[2 * 5 + 3], 1);
  assert.equal(m.unpack(m.eraseRegion(g, mask)).some(Boolean), false);
});
test("selection scaling resamples the pixels and mask together with nearest pixels", () => {
  const region = m.parseRegion(JSON.stringify(regionExample));
  const scaled = m.scaledRegion(region, 6, 6);
  assert.equal(scaled.width, 6);
  assert.equal(scaled.height, 6);
  assert.equal(scaled.pixels[0], 0);
  assert.equal(scaled.mask[0], 0);
  assert.equal(scaled.pixels[2], 1);
  assert.equal(scaled.mask[2], 1);
  assert.equal(scaled.pixels[3 * 6 + 5], 1);
  assert.throws(() => m.scaledRegion(region, 1024, 1024));
});
test("pasting a larger crop into a smaller glyph clips data and masks to the destination", () => {
  const g = raster("A", "g000065", ["..", ".."]),
    region = m.parseRegion(JSON.stringify(regionExample));
  const result = m.placeRegion(g, region, -1, -1, true);
  assert.equal(result.pixels.length, 4);
  assert.equal(result.mask.length, 4);
  assert.deepEqual([...result.pixels], [1, 1, 1, 0]);
});
test("Para Glyph Region example validates against JSON Schema and semantic decoding", () => {
  assert.equal(
    validateRegionSchema(regionExample),
    true,
    JSON.stringify(validateRegionSchema.errors),
  );
  const region = m.parseRegion(JSON.stringify(regionExample));
  const text = m.serializeRegion({ ...region, origin: clipOrigin });
  assert.ok(text.includes('\n  "format"'));
  assert.equal(
    validateRegionSchema(JSON.parse(text)),
    true,
    JSON.stringify(validateRegionSchema.errors),
  );
  const decoded = m.parseRegion(text);
  const withSourceBounds = {
    ...region,
    origin: { ...clipOrigin, rectangle: { x: 0, y: 0, width: 3, height: 3 } },
  };
  assert.equal(
    m.parseRegion(m.serializeRegion(m.scaledRegion(withSourceBounds, 6, 6)))
      .width,
    6,
  );
  assert.deepEqual(decoded.pixels, region.pixels);
  assert.deepEqual(decoded.mask, region.mask);
  assert.deepEqual(decoded.origin, clipOrigin);
});
test("clipboard decoding rejects versions, malformed rows, padding, empty masks and hostile metadata", () => {
  for (const patch of [
    { schemaVersion: "2.0.0" },
    { width: 3.5 },
    { width: "3" },
    { height: 1025 },
    { rowBytes: 2 },
    { rows: ["E1", "E0", "E0"] },
    { rows: ["GG", "E0", "E0"] },
    { rows: ["E0"] },
    { maskRows: ["00", "00", "00"] },
    { origin: null },
    { origin: { ...clipOrigin, sha256: "bad" } },
    { oops: 1 },
    {
      bitmap: { encoding: "hex-rows", bitOrder: "lsb-first", bitsPerPixel: 1 },
    },
  ])
    assert.throws(
      () => m.parseRegion(JSON.stringify({ ...regionExample, ...patch })),
      /У буфері немає коректного/,
    );
  assert.throws(
    () => m.parseRegion("private clipboard text"),
    (error) => !error.message.includes("private"),
  );
  assert.throws(() => m.parseRegion(" ".repeat(512 * 1024 + 1)));
});
test("clipboard canonicalization removes data outside the mask without changing the source", () => {
  const region = m.parseRegion(JSON.stringify(regionExample));
  region.pixels.fill(1);
  const before = region.pixels.slice();
  const decoded = m.parseRegion(m.serializeRegion(region));
  assert.equal(decoded.pixels[0], 0);
  assert.equal(decoded.mask[0], 0);
  assert.deepEqual(region.pixels, before);
});
test("cross-font region provenance survives undo and does not remap a foreign glyph ID", () => {
  const state = m.newDraft(summary, catalog.snapshot),
    doc = new m.Document(state),
    g = letter("A");
  const added = m.blankGlyph(summary, "g000300", "Ґ");
  added.rows = [...g.rows];
  doc.commit(added.id, added, undefined);
  const after = m.transformed(g, "invert"),
    recipe = {
      kind: "geometry",
      transform: "region-paste",
      recipeVersion: 1,
      sourceFontId: "other-font",
      sourceGlyphId: "g000300",
      sourceSha256: summary.sha256,
      sourceLicenseId: "CC0-1.0",
      sourceChar: "B",
      targetChar: "A",
    };
  doc.commitBatch([{ id: g.id, glyph: after, source: g, derivation: recipe }]);
  const exported = m.exportRecord(source, state);
  validateFont(exported);
  assert.equal(
    exported.modifications.at(-1).derivations[0].sourceGlyphId,
    "g000300",
  );
  doc.undo();
  assert.equal(state.derivations[g.id], undefined);
  doc.redo();
  assert.deepEqual(state.derivations[g.id], recipe);
});
test("guides use actual baseline, bearings, advance, cell and measured reference glyphs", () => {
  const g = structuredClone(letter("A"));
  g.height = 8;
  g.metrics = { ...g.metrics, leftBearing: 2, rightBearing: 0, shiftUp: -1 };
  g.advanceX = 10;
  const guides = m.glyphGuides(g, summary, { cap: 7, x: 5 });
  const named = Object.fromEntries(guides.map((g) => [g.label, g.value]));
  assert.equal(named.Baseline, 7);
  assert.equal(named["Початок"], -2);
  assert.equal(named["Крок"], 8);
  assert.equal(named["Великі H/Н"], 0);
  assert.equal(named["Малі x/х"], 2);
  const h = letter("H"),
    b = m.createRasterMutation(h).bounds;
  assert.equal(m.referenceHeight(h), h.height + h.metrics.shiftUp - b.y);
  assert.equal(
    m.glyphGuides(g, summary).some((g) => g.label === "Малі x/х"),
    false,
  );
});

test("H scaling changes width only, ignoring vertical drag and aspect lock", () => {
  const base = { width: 6, height: 4 };
  for (const locked of [true, false]) {
    assert.deepEqual(
      m.dragScaledSize(
        base,
        { x: 2, y: 50 },
        { axis: "h", anchor: "center", locked },
      ),
      { width: 10, height: 4 },
    );
    assert.deepEqual(
      m.dragScaledSize(
        base,
        { x: 0, y: 50 },
        { axis: "h", anchor: "center", locked },
      ),
      base,
    );
  }
});
test("V scaling changes height only, ignoring horizontal drag and aspect lock", () => {
  const base = { width: 6, height: 4 };
  for (const locked of [true, false]) {
    assert.deepEqual(
      m.dragScaledSize(
        base,
        { x: 50, y: 2 },
        { axis: "v", anchor: "center", locked },
      ),
      { width: 6, height: 8 },
    );
    assert.deepEqual(
      m.dragScaledSize(
        base,
        { x: 50, y: 0 },
        { axis: "v", anchor: "center", locked },
      ),
      base,
    );
  }
});
test("combined scaling retains proportional/free behavior and anchor sensitivity", () => {
  const base = { width: 6, height: 4 };
  assert.deepEqual(
    m.dragScaledSize(
      base,
      { x: 3, y: 0 },
      { axis: "both", anchor: "center", locked: true },
    ),
    { width: 12, height: 8 },
  );
  assert.deepEqual(
    m.dragScaledSize(
      base,
      { x: 3, y: 0 },
      { axis: "both", anchor: "center", locked: false },
    ),
    { width: 12, height: 4 },
  );
  assert.deepEqual(
    m.dragScaledSize(
      base,
      { x: 3, y: 0 },
      { axis: "h", anchor: "top-left", locked: true },
    ),
    { width: 9, height: 4 },
  );
  assert.deepEqual(
    m.dragScaledSize(
      base,
      { x: -100, y: 0 },
      { axis: "h", anchor: "center", locked: true },
    ),
    { width: 1, height: 4 },
  );
});
test("axis-constrained selection bounds retain the frozen dimension, including oversized pasted clips", () => {
  assert.deepEqual(
    m.dragScaledSize(
      { width: 6, height: 20 },
      { x: 50, y: -50 },
      {
        axis: "h",
        anchor: "center",
        locked: true,
        maxWidth: 8,
        maxHeight: 8,
        maxArea: 262144,
      },
    ),
    { width: 8, height: 20 },
  );
  assert.deepEqual(
    m.dragScaledSize(
      { width: 20, height: 6 },
      { x: -50, y: 50 },
      {
        axis: "v",
        anchor: "center",
        locked: true,
        maxWidth: 8,
        maxHeight: 8,
        maxArea: 262144,
      },
    ),
    { width: 20, height: 8 },
  );
  assert.throws(() =>
    m.dragScaledSize(
      { width: 3, height: 3 },
      { x: NaN, y: 0 },
      { axis: "h", anchor: "center", locked: true },
    ),
  );
});
test("mirrors reflect both the arbitrary shape mask and pixels without changing origin", () => {
  const region = {
    width: 3,
    height: 2,
    pixels: Uint8Array.from([1, 0, 0, 1, 1, 0]),
    mask: Uint8Array.from([1, 0, 0, 1, 1, 0]),
    origin: clipOrigin,
  };
  const before = structuredClone(region),
    h = m.mirroredRegion(region, "h"),
    v = m.mirroredRegion(region, "v");
  assert.deepEqual([...h.pixels], [0, 0, 1, 0, 1, 1]);
  assert.deepEqual(h.mask, h.pixels);
  assert.deepEqual([...v.pixels], [1, 1, 0, 1, 0, 0]);
  assert.deepEqual(v.mask, v.pixels);
  assert.deepEqual(m.mirroredRegion(h, "h"), region);
  assert.deepEqual(m.mirroredRegion(v, "v"), region);
  assert.deepEqual(region, before);
  assert.deepEqual(h.origin, clipOrigin);
  assert.deepEqual(m.parseRegion(m.serializeRegion(h)).mask, h.mask);
});
test("mirroring a lifted region preserves target metrics and unselected pixels", () => {
  const g = raster("A", "g000065", ["#...#", ".##..", ".....", "#...#"]);
  const mask = m.rectangleMask(5, 4, { x: 1, y: 0 }, { x: 3, y: 2 }),
    region = m.extractRegion(g, mask).region;
  const result = m.placeRegion(
    g,
    m.mirroredRegion(region, "h"),
    1,
    0,
    true,
    mask,
  ).glyph;
  assert.deepEqual(
    result.rows,
    raster("A", g.id, ["#...#", "..##.", ".....", "#...#"]).rows,
  );
  assert.deepEqual({ ...result, rows: g.rows }, g);
});

test("flipper toggles both bit values exactly once when a stroke backtracks", () => {
  const g = raster("A", "g000065", ["#.#", ".#."]),
    before = structuredClone(g);
  const brush = m.createPixelStroke(g, "flip");
  brush.moveTo(0, 0);
  brush.moveTo(2, 0);
  brush.moveTo(0, 0);
  brush.moveTo(0, 0);
  assert.deepEqual([...brush.pixels], [0, 1, 0, 0, 1, 0]);
  assert.deepEqual(g, before);
});
test("flipper bridges fast pointer samples and preserves row padding across separate strokes", () => {
  const g = raster("A", "g000065", [".........", ".........", "........."]),
    brush = m.createPixelStroke(g, "flip");
  brush.moveTo(-2, 1);
  brush.moveTo(12, 1);
  brush.moveTo(-2, 1);
  const rows = m.pack(brush.pixels, 9, 3);
  assert.deepEqual(rows, ["0000", "FF80", "0000"]);
  const after = { ...g, rows },
    second = m.createPixelStroke(after, "flip");
  second.moveTo(-2, 1);
  second.moveTo(12, 1);
  assert.deepEqual(m.pack(second.pixels, 9, 3), g.rows);
});
test("shared stroke handling keeps pencil and eraser continuous and idempotent", () => {
  const g = raster("A", "g000065", [".....", "....."]),
    pencil = m.createPixelStroke(g, "pencil");
  pencil.moveTo(0, 0);
  pencil.moveTo(4, 0);
  pencil.moveTo(0, 0);
  assert.deepEqual([...pencil.pixels], [1, 1, 1, 1, 1, 0, 0, 0, 0, 0]);
  const erased = m.createPixelStroke(
    { ...g, rows: m.pack(pencil.pixels, 5, 2) },
    "eraser",
  );
  erased.moveTo(1, 0);
  erased.moveTo(3, 0);
  erased.moveTo(1, 0);
  assert.deepEqual([...erased.pixels], [1, 0, 0, 0, 1, 0, 0, 0, 0, 0]);
});
test("a flipper stroke is one undo step and a second stroke can restore the original", () => {
  const g = letter("A"),
    state = m.newDraft(summary, catalog.snapshot),
    doc = new m.Document(state);
  const apply = (glyph) => {
    const brush = m.createPixelStroke(glyph, "flip");
    brush.moveTo(0, 0);
    brush.moveTo(4, 2);
    brush.moveTo(0, 0);
    return { ...glyph, rows: m.pack(brush.pixels, glyph.width, glyph.height) };
  };
  const after = apply(g);
  doc.commit(g.id, after, g);
  assert.equal(state.revision, 1);
  validateFont(m.exportRecord(source, state));
  doc.undo();
  assert.deepEqual(state.edits, {});
  doc.redo();
  assert.deepEqual(state.edits[g.id].rows, after.rows);
  doc.commit(g.id, apply(after), g);
  assert.deepEqual(state.edits, {});
  doc.undo();
  assert.deepEqual(state.edits[g.id].rows, after.rows);
});

test("physical shortcut keys stay the same for Ukrainian, Latin and dead-key layouts", () => {
  for (const [code, key, expected] of [
    ["KeyB", "и", "b"],
    ["KeyE", "у", "e"],
    ["KeyF", "а", "f"],
    ["KeyM", "ь", "m"],
    ["KeyS", "і", "s"],
    ["KeyR", "к", "r"],
    ["KeyL", "д", "l"],
    ["KeyC", "с", "c"],
    ["KeyX", "ч", "x"],
    ["KeyV", "м", "v"],
    ["KeyZ", "я", "z"],
    ["KeyA", "ф", "a"],
    ["KeyD", "в", "d"],
    ["BracketLeft", "х", "["],
    ["BracketRight", "ї", "]"],
    ["KeyE", "Dead", "e"],
    ["KeyZ", "y", "z"],
  ])
    assert.equal(m.shortcutKey({ code, key }), expected);
});
test("shortcut resolution preserves editing/navigation keys and does not guess letters without a physical code", () => {
  assert.equal(m.shortcutKey({ code: "NumpadEnter", key: "Enter" }), "Enter");
  assert.equal(
    m.shortcutKey({ code: "ArrowLeft", key: "ArrowLeft" }),
    "ArrowLeft",
  );
  assert.equal(m.shortcutKey({ code: "", key: "Escape" }), "Escape");
  assert.equal(m.shortcutKey({ code: "", key: "f" }), "");
  assert.equal(m.shortcutKey({ code: "KeyF", key: "s" }), "f");
});

test("comparison aligns the baseline and pen origin across unequal rasters", () => {
  const a = {
    ...letter("A"),
    width: 9,
    height: 13,
    metrics: { leftBearing: 2, rightBearing: 0, shiftUp: -3 },
  };
  const b = {
    ...letter("H"),
    width: 5,
    height: 7,
    metrics: { leftBearing: -1, rightBearing: 4, shiftUp: 2 },
  };
  const before = JSON.stringify([a, b]);
  assert.deepEqual(m.comparisonOffset(a, b, "baseline"), { x: -3, y: 1 });
  assert.deepEqual(m.comparisonOffset(a, b, "baseline", 4, -2), {
    x: 1,
    y: -1,
  });
  assert.deepEqual(m.comparisonOffset(a, b, "raster", 4, -2), { x: 4, y: -2 });
  assert.equal(JSON.stringify([a, b]), before);
});

test("font guides are an undoable font-wide transaction and keep glyph pixels intact", () => {
  const state = m.newDraft(summary, catalog.snapshot),
    doc = new m.Document(state);
  doc.review("U+0041");
  state.done = true;
  const original = letter("A"),
    changed = m.transformed(original, "invert");
  doc.commit(original.id, changed, original);
  const edits = JSON.stringify(state.edits);
  assert.equal(
    doc.commitFontGuides({
      baseline: 6,
      capHeight: 5,
      xHeight: 3,
      ascent: 7,
      descent: 2,
      lineGap: 1,
    }),
    true,
  );
  assert.equal(state.done, false);
  assert.deepEqual(state.reviewed, []);
  assert.equal(doc.undo(), "$font");
  assert.equal(state.fontGuides, undefined);
  assert.equal(JSON.stringify(state.edits), edits);
  assert.equal(doc.redo(), "$font");
  assert.equal(state.fontGuides.baseline, 6);
  doc.undo();
  assert.equal(doc.undo(), original.id);
  assert.deepEqual(state.edits, {});
  doc.redo();
  doc.redo();
  assert.equal(state.fontGuides.capHeight, 5);
});

test("font-only edits persist and export metrics and attribution without adding glyphs", () => {
  const state = m.newDraft(summary, catalog.snapshot),
    doc = new m.Document(state),
    before = JSON.stringify(source);
  doc.commitFontGuides({
    baseline: 6,
    capHeight: 5,
    xHeight: 3,
    ascent: 7,
    descent: 2,
    lineGap: 1,
  });
  const restored = JSON.parse(JSON.stringify(state));
  const exported = m.exportRecord(source, restored);
  validateFont(exported);
  assert.equal(exported.metrics.baseline, 6);
  assert.equal(exported.metrics.lineHeight, 10);
  assert.equal(exported.metrics.capHeight, 5);
  assert.equal(exported.metrics.xHeight, 3);
  assert.deepEqual(exported.glyphs, source.glyphs);
  assert.deepEqual(exported.modifications.at(-1).fontGuides, state.fontGuides);
  assert.equal(JSON.stringify(source), before);
  assert.equal(doc.commitFontGuides({}), true);
  assert.equal(state.fontGuides, undefined);
  doc.undo();
  assert.equal(state.fontGuides.baseline, 6);
});

test("guide overrides reject invalid values and preserve source extensions", () => {
  for (const value of [
    { baseline: NaN },
    { xHeight: -1 },
    { baseline: Infinity },
    { ascent: 16385 },
    { unknown: 1 },
    { capHeight: "5" },
  ])
    assert.throws(() => m.validateFontGuides(value));
  assert.deepEqual(m.validateFontGuides({ baseline: -1.5, xHeight: 0 }), {
    baseline: -1.5,
    xHeight: 0,
  });
  const f = {
    ...summary,
    metrics: { ...summary.metrics, customMetric: 42, lineHeight: 20 },
  };
  assert.equal(m.fontWithGuides(f, { capHeight: 6 }).metrics.lineHeight, 20);
  assert.equal(
    m.fontWithGuides(f, { ascent: 7, descent: 2, lineGap: 1 }).metrics
      .lineHeight,
    10,
  );
  assert.equal(m.fontWithGuides(f, { baseline: 6 }).metrics.customMetric, 42);
  assert.throws(() =>
    m.fontWithGuides(f, { ascent: 0, descent: 0, lineGap: 0 }),
  );
});

test("explicit cap and x guides override measurements and signed source descent is normalized", () => {
  const f = m.fontWithGuides(
    { ...summary, metrics: { ...summary.metrics, descent: -2 } },
    { capHeight: 4, xHeight: 2 },
  );
  const g = letter("A"),
    baseline = g.height + g.metrics.shiftUp;
  const named = Object.fromEntries(
    m.glyphGuides(g, f, { cap: 7, x: 5 }).map((g) => [g.label, g.value]),
  );
  assert.equal(named["Великі H/Н"], baseline - 4);
  assert.equal(named["Малі x/х"], baseline - 2);
  assert.equal(named.Descent, baseline + 2);
  assert.equal(m.fontGuideValues(f).descent, 2);
  assert.ok(m.glyphGuides(g, f).every((g) => g.help.length > 10));
});

test("font guide reset and unchanged values do not create spurious history", () => {
  const state = m.newDraft(summary, catalog.snapshot),
    doc = new m.Document(state);
  assert.equal(doc.commitFontGuides({}), false);
  assert.equal(doc.canUndo, false);
  doc.commitFontGuides({ baseline: 6 });
  const revision = state.revision;
  assert.equal(doc.commitFontGuides({ baseline: 6 }), false);
  assert.equal(state.revision, revision);
  const restored = new m.Document(JSON.parse(JSON.stringify(state)));
  assert.equal(restored.state.fontGuides.baseline, 6);
  assert.equal(restored.canUndo, false);
});

function generatedCandidate(target) {
  return {
    id: "candidate",
    method: "cnn",
    model: "para-style-cnn-v1",
    checkpointSha256: "a".repeat(64),
    width: target.width,
    height: target.height,
    rowBytes: target.rowBytes,
    rows: m.transformed(target, "invert").rows,
    styleDistance: 0.1,
    sourceGlyphId: "g000123",
    sourceFontId: "cozette-13x15",
    sourceSha256: "b".repeat(64),
    sourceLicenseId: "MIT",
    sourceLicense: { id: "MIT", attribution: "test" },
    source: { collection: "test" },
    references: ["g000072", "g000120"],
  };
}
test("candidate application changes only bitmap and preserves mapping, metrics and source codes", () => {
  const target = letter("A"),
    candidate = generatedCandidate(target),
    before = structuredClone(target);
  const after = m.candidateGlyph(target, candidate);
  assert.deepEqual({ ...after, rows: target.rows }, target);
  assert.deepEqual(target, before);
  assert.notDeepEqual(after.rows, target.rows);
  assert.deepEqual(
    m.hiddenTarget(target).rows,
    Array(target.height).fill("00".repeat(target.rowBytes)),
  );
  assert.equal(m.glyphSignature(target), m.glyphSignature(before));
  assert.notEqual(m.glyphSignature(after), m.glyphSignature(target));
  candidate.sourceChar = "A";
  const recipe = m.candidateDerivation(target, candidate, "А");
  assert.equal(recipe.sourceChar, "A");
  assert.equal(recipe.targetChar, "А");
});
test("candidate data rejects mismatched dimensions, invalid rows, padding and absent provenance", () => {
  const target = m.resized(letter("A"), 5, 8),
    valid = generatedCandidate(target);
  for (const change of [
    { width: 6 },
    { rows: ["00"] },
    { rows: Array(8).fill("ZZ") },
    { rows: Array(8).fill("01") },
    { sourceFontId: "../escape" },
    { checkpointSha256: null },
    { references: ["bad"] },
    { sourceSha256: "wrong" },
  ])
    assert.throws(() => m.candidateGlyph(target, { ...valid, ...change }));
});
test("generated glyph is one undo step and carries donor/model provenance through export", () => {
  const state = m.newDraft(summary, catalog.snapshot),
    doc = new m.Document(state),
    target = letter("A"),
    candidate = generatedCandidate(target);
  const after = m.candidateGlyph(target, candidate);
  doc.commitBatch([
    {
      id: target.id,
      glyph: after,
      source: target,
      derivation: m.candidateDerivation(target, candidate),
    },
  ]);
  assert.equal(state.revision, 1);
  assert.equal(doc.undo(), target.id);
  assert.deepEqual(state.edits, {});
  assert.deepEqual(state.derivations, {});
  doc.redo();
  const exported = m.exportRecord(source, state);
  validateFont(exported);
  const recipe = exported.modifications.at(-1).derivations[0];
  assert.equal(recipe.kind, "generation");
  assert.equal(recipe.sourceGlyphId, "g000123");
  assert.equal(recipe.generation.model, "para-style-cnn-v1");
  assert.equal(recipe.generation.sourceLicense.id, "MIT");
});
test("new glyph and generated reference IDs are remapped locally while foreign donor IDs survive", () => {
  const state = m.newDraft(summary, catalog.snapshot),
    doc = new m.Document(state),
    target = m.blankGlyph(summary, "g000300", "Ґ"),
    ref = m.blankGlyph(summary, "g000301", "Є"),
    candidate = generatedCandidate(target);
  candidate.references = [ref.id];
  doc.commit(ref.id, ref, undefined);
  doc.commitBatch([
    {
      id: target.id,
      glyph: m.candidateGlyph(target, candidate),
      derivation: m.candidateDerivation(target, candidate),
    },
  ]);
  const exported = m.exportRecord(source, state);
  validateFont(exported);
  const recipe = exported.modifications.at(-1).derivations[0];
  assert.equal(recipe.sourceGlyphId, "g000123");
  assert.deepEqual(recipe.generation.styleReferenceGlyphIds, ["g000256"]);
  assert.equal(recipe.glyphId, "g000257");
});

test("style target strings normalize Ukrainian letters and deduplicate without guessing unknown scripts", () => {
  assert.deepEqual(m.styleCharacters("Ґ, Є І Ї Ґ і\u0308"), [
    "Ґ",
    "Є",
    "І",
    "Ї",
    "ї",
  ]);
  assert.throws(() => m.styleCharacters("Ω"));
  assert.deepEqual(m.styleCharacters("ΩЖ", true), ["Ω", "Ж"]);
});
test("batch planning skips existing ink and reserves missing glyph IDs without touching the draft", async () => {
  const state = m.newDraft(summary, catalog.snapshot),
    before = JSON.stringify(state),
    a = letter("A");
  const plan = await m.planStyleTargets({
    font: summary,
    state,
    index: new Map([["A", [a.id]]]),
    characters: ["A", "Ґ", "Є"],
    onlyMissing: true,
    load: async (id) => source.glyphs.find((g) => g.id === id),
    source: async (id) => source.glyphs.find((g) => g.id === id),
  });
  assert.deepEqual(plan.skipped, ["A"]);
  assert.deepEqual(
    plan.targets.map((t) => t.target.id),
    ["g000256", "g000257"],
  );
  assert.equal(JSON.stringify(state), before);
  assert.equal(m.styleTargetRequest(plan.targets[0]).character, "Ґ");
});
test("chosen style candidates apply as one batch undo and preserve existing glyph metrics", async () => {
  const state = m.newDraft(summary, catalog.snapshot),
    doc = new m.Document(state),
    a = letter("A");
  const plan = await m.planStyleTargets({
    font: summary,
    state,
    index: new Map([["A", [a.id]]]),
    characters: ["A", "Ґ"],
    onlyMissing: false,
    load: async () => a,
    source: async () => a,
  });
  doc.commitBatch(
    plan.targets.map((t) => {
      const candidate = generatedCandidate(t.target);
      return {
        id: t.target.id,
        glyph: m.candidateGlyph(t.target, candidate),
        source: t.source,
        derivation: m.candidateDerivation(t.target, candidate, t.character),
      };
    }),
  );
  assert.equal(state.revision, 1);
  assert.equal(Object.keys(state.edits).length, 2);
  doc.undo();
  assert.deepEqual(state.edits, {});
  assert.deepEqual(state.created, []);
  doc.redo();
  validateFont(m.exportRecord(source, state));
});
test("style planning refuses ambiguous aliases and reference provenance never remaps foreign IDs", async () => {
  const state = m.newDraft(summary, catalog.snapshot),
    a = letter("A");
  await assert.rejects(() =>
    m.planStyleTargets({
      font: summary,
      state,
      index: new Map([
        ["A", [a.id]],
        ["А", [a.id]],
      ]),
      characters: ["A", "А"],
      onlyMissing: false,
      load: async () => a,
      source: async () => a,
    }),
  );
  const doc = new m.Document(state),
    g = m.blankGlyph(summary, "g000300", "Ґ"),
    candidate = generatedCandidate(g);
  candidate.styleReferenceFont = {
    fontId: "reference-1234",
    sha256: "c".repeat(64),
    name: "Reference",
    licenseId: "MIT",
  };
  candidate.references = ["g000300"];
  doc.commitBatch([
    {
      id: g.id,
      glyph: m.candidateGlyph(g, candidate),
      derivation: m.candidateDerivation(g, candidate),
    },
  ]);
  const exported = m.exportRecord(source, state);
  validateFont(exported);
  const recipe = exported.modifications.at(-1).derivations[0];
  assert.equal(recipe.glyphId, "g000256");
  assert.deepEqual(recipe.generation.styleReferenceGlyphIds, ["g000300"]);
  assert.equal(recipe.generation.styleReferenceFont.name, "Reference");
});

test("PolarSmall uses a shared monospace frame for every Latin and Ukrainian letter", async () => {
  const font = catalog.fonts.find(
    (f) => f.id === "hoard-custom-amiga-nudelfonts-polarsmall-prop",
  );
  const raw = await readFile(join(app, "public", font.url), "utf8"),
    record = JSON.parse(raw),
    cell = m.fixedCell(font, record.glyphs);
  assert.equal(font.cell.width, 98);
  assert.ok(cell.width <= 12);
  const a = m.normalizeCell(
      record.glyphs.find((g) => g.character === "A"),
      cell,
    ),
    i = m.normalizeCell(
      record.glyphs.find((g) => g.character === "I"),
      cell,
    ),
    ua = m.profiledBlank(font, record.glyphs, "g000226", "А");
  assert.deepEqual(
    [a.width, a.height, a.advanceX],
    [i.width, i.height, i.advanceX],
  );
  assert.deepEqual(
    [ua.width, ua.height, ua.advanceX],
    [a.width, a.height, a.advanceX],
  );
  assert.equal(
    a.rows.reduce(
      (n, r) =>
        n +
        [...r].reduce(
          (s, h) => s + parseInt(h, 16).toString(2).replace(/0/g, "").length,
          0,
        ),
      0,
    ),
    record.glyphs
      .find((g) => g.character === "A")
      .rows.reduce(
        (n, r) =>
          n +
          [...r].reduce(
            (s, h) => s + parseInt(h, 16).toString(2).replace(/0/g, "").length,
            0,
          ),
        0,
      ),
  );
  assert.equal(JSON.stringify(record), JSON.stringify(JSON.parse(raw)));
});

test("Classic's existing glyphs become visible and explicit ASCII mapping preserves every bitmap", async () => {
  const font = catalog.fonts.find(
    (f) => f.id === "hoard-apple-lisa-classic-18pt",
  );
  const record = JSON.parse(
    await readFile(join(app, "public", font.url), "utf8"),
  );
  assert.equal(
    record.glyphs.filter((g) => g.rows.some((r) => /[1-9a-f]/i.test(r))).length,
    192,
  );
  const index = new Map();
  assert.equal(m.initialQueue("ukrainian", index), "all");
  const edits = m.asciiMapping(record.glyphs, index);
  assert.equal(edits.length, 95);
  assert.ok(edits.some((e) => e.glyph.character === "A"));
  for (const edit of edits) {
    assert.deepEqual(edit.glyph.rows, edit.source.rows);
    assert.deepEqual(edit.glyph.metrics, edit.source.metrics);
    assert.deepEqual(edit.glyph.sourceCode, edit.source.sourceCode);
  }
  const state = m.newDraft(font, catalog.snapshot),
    doc = new m.Document(state);
  doc.commitBatch(edits);
  const mapped = m.effectiveIndex({}, state);
  assert.equal(m.initialQueue("ukrainian", mapped), "latin");
  assert.equal(mapped.get("A").length, 1);
  const profile = m.editingProfile(font, Object.values(state.edits));
  assert.ok(profile.metrics.capHeight > profile.metrics.xHeight);
  assert.ok(profile.metrics.descent > 0);
  doc.undo();
  assert.equal(Object.keys(state.edits).length, 0);
  doc.redo();
  const exported = m.exportRecord(record, state);
  validateFont(exported);
  assert.equal(exported.glyphs.length, record.glyphs.length);
});

test("automatic guides measure ink in baseline coordinates and manual overrides win", () => {
  const g = (char, rows, shiftUp = -1) => ({
    ...source.glyphs[0],
    id: "g000001",
    width: 5,
    height: rows.length,
    rowBytes: 1,
    rows,
    metrics: { leftBearing: 0, rightBearing: 1, shiftUp },
    labels: [{ kind: "unicode", value: char }],
  });
  const f = {
    ...summary,
    cell: { ...summary.cell, width: 5, height: 8 },
    metrics: {
      ...summary.metrics,
      baseline: 7,
      ascent: 0,
      descent: 0,
      capHeight: 0,
      xHeight: 0,
      lineHeight: 10,
      lineGap: 0,
    },
  };
  const samples = [
    g("H", ["00", "88", "88", "F8", "88", "88", "88", "00"]),
    g("x", ["00", "00", "00", "88", "50", "20", "88", "00"]),
    g("p", ["00", "00", "F0", "88", "F0", "80", "80", "80"]),
  ];
  const guides = m.detectFontGuides(f, samples);
  assert.deepEqual(guides, {
    baseline: 7,
    capHeight: 6,
    xHeight: 4,
    ascent: 6,
    descent: 1,
    lineGap: 3,
  });
  const effective = m.fontWithGuides(m.editingProfile(f, samples), {
    capHeight: 5,
    descent: 2,
  });
  assert.equal(effective.metrics.capHeight, 5);
  assert.equal(effective.metrics.descent, 2);
});

test("ASCII mapping skips conflicting, duplicate, and non-ASCII source labels", () => {
  const raw = (id, code) => ({
    ...source.glyphs[0],
    id,
    character: null,
    codepoint: null,
    labels: [{ kind: "codepoint", value: code }],
  });
  assert.equal(
    m.asciiMapping(
      [raw("g000001", "0x41"), raw("g000002", "0x41"), raw("g000003", "0x80")],
      new Map(),
    ).length,
    0,
  );
  assert.equal(
    m.asciiMapping([raw("g000001", "0x41")], new Map([["A", ["g000004"]]]))
      .length,
    0,
  );
});

test("fixed-cell normalization is idempotent, preserves ordinary ink and fits large graphics", () => {
  const a = source.glyphs.find((g) => g.character === "A"),
    cell = m.fixedCell(summary, source.glyphs);
  const normalized = m.normalizeCell(a, cell);
  assert.deepEqual(m.normalizeCell(normalized, cell), normalized);
  const big = {
    ...a,
    width: 98,
    rowBytes: 13,
    rows: Array(a.height).fill("F".repeat(24) + "C0"),
  };
  assert.equal(m.cellNeedsFit(big, cell), true);
  const fitted = m.normalizeCell(big, cell);
  assert.equal(fitted.width, cell.width);
  assert.equal(fitted.height, cell.height);
  assert.ok(m.unpack(fitted).some(Boolean));
  assert.equal(big.width, 98);
});

test("Latin and Ukrainian groups can be viewed together, separately and by case", () => {
  const index = new Map([
    ["A", ["g000001"]],
    ["А", ["g000002"]],
  ]);
  const both = { groups: ["latin", "ukrainian"], upper: true, lower: true };
  const slots = m.selectedGroupSlots(both, index);
  assert.equal(slots.length, 118);
  assert.equal(slots.find((s) => s.char === "A").id, "g000001");
  assert.equal(slots.find((s) => s.char === "А").id, "g000002");
  assert.equal(new Set(slots.map((s) => s.key)).size, 118);
  const upper = m.selectedGroupSlots({ ...both, lower: false }, index);
  assert.equal(upper.length, 59);
  assert.ok(upper.every((s) => s.char === s.char.toUpperCase()));
  assert.equal(m.selectedGroupSlots({ ...both, groups: [] }, index).length, 0);
  assert.equal(
    m.selectedGroupSlots({ ...both, upper: false, lower: false }, index).length,
    0,
  );
  assert.equal(
    m.selectedGroupSlots(
      { groups: ["digits"], upper: false, lower: false },
      index,
    ).length,
    10,
  );
  assert.match(m.characterLabel("a"), /мала/);
  assert.match(m.characterLabel("а"), /мала/);
  assert.match(m.characterLabel("Ї"), /велика/);
});

test("gallery row windowing preserves every glyph index and section boundary at any width", () => {
  const slots = m.selectedGroupSlots(
    { groups: ["latin", "ukrainian"], upper: true, lower: true },
    new Map(),
  );
  for (const columns of [1, 7, 20]) {
    const plan = m.galleryRows(slots, columns);
    assert.deepEqual(
      plan.rows.flatMap((r) => r.indices),
      slots.map((_, i) => i),
    );
    assert.equal(plan.rows.filter((r) => r.section).length, 4);
    assert.equal(
      plan.height,
      plan.rows.reduce((n, r) => n + r.height, 0),
    );
    for (let i = 1; i < plan.rows.length; i++)
      assert.equal(
        plan.rows[i].top,
        plan.rows[i - 1].top + plan.rows[i - 1].height,
      );
  }
  const huge = Array.from({ length: 20000 }, (_, i) => ({ key: String(i) }));
  const plan = m.galleryRows(huge, 12);
  const shown = plan.rows.filter(
    (r) => r.top + r.height > 50000 && r.top < 51000,
  );
  assert.ok(shown.flatMap((r) => r.indices).length < 160);
});

test("parallel script lanes keep Latin and Ukrainian visible at the same vertical origin", () => {
  const slots = m.selectedGroupSlots(
    { groups: ["latin", "ukrainian"], upper: true, lower: true },
    new Map(),
  );
  const plan = m.galleryRows(slots, 12, true);
  const headings = plan.rows.filter((r) => r.section && r.top === 0);
  assert.equal(headings.length, 2);
  assert.equal(headings[0].left, 0);
  assert.equal(headings[1].left, 6);
  assert.equal(headings[0].columns, 6);
  assert.deepEqual(
    plan.rows.flatMap((r) => r.indices).sort((a, b) => a - b),
    slots.map((_, i) => i),
  );
  for (const row of plan.rows)
    for (const i of row.indices)
      assert.equal(slots[i].group, row.left === 0 ? "latin" : "ukrainian");
});

test("OCR observations are preserved in exported derivation without changing glyph pixels", () => {
  const state = m.newDraft(summary, catalog.snapshot),
    doc = new m.Document(state),
    original = source.glyphs.find((g) => g.character === "A");
  const candidate = generatedCandidate(original);
  candidate.ocr = {
    text: "A",
    confidence: 91,
    status: "compatible",
    calibrated: true,
    engine: "tesseract-lstm",
  };
  doc.commitBatch([
    {
      id: original.id,
      source: original,
      glyph: m.candidateGlyph(original, candidate),
      derivation: m.candidateDerivation(original, candidate),
    },
  ]);
  const exported = m.exportRecord(source, state);
  validateFont(exported);
  assert.deepEqual(
    state.derivations[original.id].generation.recognition,
    candidate.ocr,
  );
});

test("font-wide cell changes have one undo, survive persistence and normalize every exported glyph", async () => {
  const font = catalog.fonts.find(
      (f) => f.id === "hoard-apple-lisa-classic-18pt",
    ),
    record = JSON.parse(await readFile(join(app, "public", font.url), "utf8"));
  const draft = m.newDraft(font, catalog.snapshot),
    doc = new m.Document(draft),
    cell = { width: 32, height: 24, advanceX: 32, baseline: 20 };
  draft.reviewed = ["U+0041"];
  doc.commitFontCell(cell);
  assert.equal(draft.reviewed.length, 0);
  assert.deepEqual(draft.fontCell, cell);
  assert.equal(doc.undo(), "$font");
  assert.equal(draft.fontCell, undefined);
  assert.equal(doc.redo(), "$font");
  const state = JSON.parse(JSON.stringify(draft)),
    exported = m.exportRecord(record, state);
  validateFont(exported);
  assert.equal(exported.cell.monospace, true);
  assert.equal(exported.metrics.advanceX, 32);
  assert.equal(
    new Set(exported.glyphs.map((g) => `${g.width}x${g.height}:${g.advanceX}`))
      .size,
    1,
  );
  assert.ok(
    exported.glyphs.every(
      (g) => g.width === 32 && g.height === 24 && g.advanceX === 32,
    ),
  );
  assert.deepEqual(exported.license, record.license);
  assert.deepEqual(exported.source, record.source);
  assert.throws(() => doc.commitFontCell({ ...cell, width: 0 }));
  assert.throws(() => doc.commitFontCell({ ...cell, baseline: 25 }));
});

test("baseline alignment and centering use padding instead of per-letter raster dimensions", () => {
  const frame = { width: 9, height: 9, advanceX: 9, baseline: 7 };
  const narrow = {
    ...source.glyphs[0],
    width: 3,
    height: 5,
    rowBytes: 1,
    advanceX: 5,
    rows: ["E0", "40", "40", "40", "E0"],
    metrics: { leftBearing: 1, rightBearing: 1, shiftUp: 0 },
  };
  const normalized = m.normalizeCell(narrow, frame),
    bits = m.unpack(normalized);
  assert.equal(normalized.metrics.shiftUp, -2);
  assert.equal(normalized.metrics.leftBearing, 0);
  assert.equal(bits[2 * 9 + 3], 1);
  assert.equal(bits[6 * 9 + 5], 1);
  assert.equal(
    bits.reduce((n, v) => n + v, 0),
    9,
  );
});
