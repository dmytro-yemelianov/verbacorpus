import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { inflateSync } from "node:zlib";
import { validateRegistry, validateIcon, iconPng, iconSvg, sha256 } from "../catalog.mjs";

const json = async path => JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));
test("registry keeps stable corpus IDs and all approved prefixes", async () => {
  const entries = validateRegistry(await json("../content/corpora.json"));
  assert.equal(entries.find(e => e.prefix === "non").id, "upa");
  assert.equal(entries.find(e => e.prefix === "re").kind, "editorial");
  assert.throws(() => validateRegistry([...entries, entries[0]]));
  assert.throws(() => validateRegistry(entries.map(e => e.prefix === "non" ? { ...e, href: "https://unverified.example" } : e)));
});
test("vendored snapshots retain exact reviewed bytes and complete Ukrainian coverage", async () => {
  const manifest = await json("../content/snapshots/manifest.json");
  for (const [name, hash] of Object.entries(manifest.files)) assert.equal(sha256(await readFile(new URL(`../content/snapshots/${name}`, import.meta.url))), hash);
  const font = await json("../content/snapshots/font-specimen.json");
  const chars = new Set(font.glyphData.map(g => g.character));
  const alphabet = "АБВГҐДЕЄЖЗИІЇЙКЛМНОПРСТУФХЦЧШЩЬЮЯ";
  for (const char of alphabet + alphabet.toLowerCase() + "ʼ₴") assert.ok(chars.has(char), char);
  assert.equal(font.license.redistributionAllowed, true);
  assert.equal(font.license.id, "MIT");
});
test("icons have independent IDs and valid 16 by 16 source matrices", async () => {
  const { icons } = await json("../content/pixel-icons.json");
  assert.equal(new Set(icons.map(i => i.id)).size, icons.length);
  for (const icon of icons) { validateIcon(icon); assert.equal(icon.source, "original"); assert.match(iconSvg(icon), /shape-rendering="crispEdges"/); }
  assert.throws(() => validateIcon({ id: "bad", rows: ["<script>"] }));
});
test("PNG exports preserve transparent and colored matrix cells at integer scale", async () => {
  const { icons } = await json("../content/pixel-icons.json");
  const icon = icons[0], png = iconPng(icon, 2);
  assert.equal(png.readUInt32BE(16), 32); assert.equal(png.readUInt32BE(20), 32);
  const compressed = [];
  for (let offset = 8; offset < png.length;) {
    const length = png.readUInt32BE(offset), type = png.subarray(offset + 4, offset + 8).toString();
    if (type === "IDAT") compressed.push(png.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
  }
  const raw = inflateSync(Buffer.concat(compressed));
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
    const symbol = icon.rows[Math.floor(y / 2)][Math.floor(x / 2)];
    assert.deepEqual([...raw.subarray(y * 129 + 1 + x * 4, y * 129 + 5 + x * 4)], symbol === "." ? [0,0,0,0] : symbol === "R" ? [180,35,42,255] : [41,43,38,255]);
  }
});
