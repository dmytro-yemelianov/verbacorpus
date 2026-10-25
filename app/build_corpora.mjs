import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const readJson = async path => JSON.parse(await readFile(path, "utf8"));
const escape = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const corpora = await readJson("content/corpora.json");
const proverbs = await readJson("public/data/meta.json");
const provenance = await readJson("public/bez-tabu/data/provenance.json");
await Promise.all(Object.entries(provenance.files).map(async ([name, digest]) => {
  const raw = await readFile(`public/bez-tabu/data/${name}`);
  if (createHash("sha256").update(raw).digest("hex") !== digest) {
    throw new Error(`Invalid ua-bez-tabu snapshot: ${name}; rerun sync-bez-tabu`);
  }
}));
const tabu = await readJson("public/bez-tabu/data/entries.json");
const counts = {
  slovo: `${Number(proverbs.count).toLocaleString("uk")} записів`,
  "bez-tabu": `${tabu.stats.rows.toLocaleString("uk")} рядків · ${tabu.stats.terms} термінів · ${tabu.stats.groups} груп`,
  upa: "167 орнаментів · 38 сторінок схем",
};
const registry = corpora.map(c => ({ ...c, stats: counts[c.id] }));
const cards = registry.map(c => `<article class="corpus-card" data-corpus="${escape(c.id)}"><p class="eyebrow">${escape(c.eyebrow)}</p><h2>${escape(c.title)}</h2><p>${escape(c.description)}</p><p class="corpus-meta">${escape(c.stats)}</p><p class="corpus-meta">${escape(c.status)}</p><div class="corpus-actions">${c.href ? `<a href="${escape(c.href)}">Відкрити корпус →</a>` : ""}${c.repository ? `<a href="${escape(c.repository)}">GitHub</a>` : ""}</div></article>`).join("\n");
const template = await readFile("content/corpora.html", "utf8");
await writeFile("public/corpora.html", template.replace("{{CARDS}}", cards));
await writeFile("public/data/corpora.json", JSON.stringify(registry, null, 2) + "\n");
console.log("Built corpus directory (3 projects)");
