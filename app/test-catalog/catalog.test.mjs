import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { validateRegistry, sha256 } from "../catalog.mjs";

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
