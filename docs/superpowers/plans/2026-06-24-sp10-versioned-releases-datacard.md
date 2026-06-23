# verba — SP10: Versioned releases, data card & on-site version — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Version the corpus (single source-of-truth → meta → site/API), publish a citable v1.0.0 GitHub Release with a data card + Croissant + CITATION, and show the version on the site.

**Architecture:** A root `VERSION` file feeds `app/build_data.py`, which stamps `meta.json.version`; the client renders it in the colophon and the Worker's `/api/v1/meta` returns it unchanged. Standalone metadata files (`DATACARD.md`, `CITATION.cff`, `croissant.json`, `CHANGELOG.md`) describe the dataset; `scripts/release.sh` bundles the data + card into release assets and (only with `--publish`) runs `gh release create`.

**Tech Stack:** Python (build pipeline + pytest), TypeScript PWA, bash + `gh` CLI, JSON-LD (Croissant), Citation File Format (YAML). No new runtime deps.

## Global Constraints

- **Version = `1.0.0`**, in a root `VERSION` file (bare string, single source of truth). SemVer-for-data: MAJOR=schema/breaking, MINOR=new source/significant additions, PATCH=fixes.
- Author/attribution: **Dmytro Yemelianov**, ORCID **`0009-0002-9244-7426`** (https://orcid.org/0009-0002-9244-7426). Repo: `MurzikVasilyevich/verbacorpus`; site `https://verbacorpus.org`.
- **License (confirmed):** compilation + enrichment = **CC BY 4.0**; historical texts (Franko 1901, Nomis 1864, Ilkevich 1841) = public domain; modern collections (Bobkova, Mlodzynskyi 2009) = texts under their publishers' rights, included for research/education, attributed, removed on request. `CITATION.cff`/`croissant.json` `license` = `CC-BY-4.0`; the layered detail lives in DATACARD §Distribution.
- **Do NOT change `corpus.json`'s structure** — it is a bare JSON array; version lives in `meta.json` / `VERSION` / `croissant.json`, not inside `corpus.json`.
- Corpus facts (verbatim, for the card/changelog/croissant): **48,787** entries; **30,532** with explanation; **48,787** with modern_text; **5 sources** — Franko1901 30,906 · Nomis1864 9,785 · Bobkova 5,613 · Ilkevich1841 2,702 · Mlodzynskyi2009 2,261; **27** categories; 10-column schema (id, text, normalized_text, modern_text, keyword, explanation, category, sources, source_refs, variant_group). Quality: Nomis OCR best-effort ~75–80%; category audit ~85% acceptable; modern_text ~95%.
- `gh release create` and `wrangler deploy` are **outward — controller runs only after user confirmation**, on the MurzikVasilyevich account. Branch `feat/releases` (already created; spec committed there). Commit identity MurzikVasilyevich; session footer. Do not push from implementer subagents.
- **Task types:** `[IMPL]` TDD · `[CONTENT]` authoring + validity checks · `[CONTROLLER-RUN]` controller (deploy, release).

---

### Task 1 [IMPL]: `VERSION` + stamp `meta.json.version`

**Files:** Create `VERSION`; Modify `app/build_data.py`; Modify `tests/test_build_data.py`.

**Interfaces — Produces:** `_read_version(corpus_path) -> str | None` in `build_data.py`; `meta.json` gains a `"version"` key.

- [ ] **Step 1: Create the VERSION file**
```bash
printf '1.0.0\n' > /home/dmytro/github/ukr-proverbs-corpus/VERSION
```

- [ ] **Step 2: Write the failing test** — read `tests/test_build_data.py` first and match its import style for `build_data` (the app/ module). Append:
```python
def test_read_version(tmp_path):
    from build_data import _read_version
    (tmp_path / "VERSION").write_text("1.0.0\n", encoding="utf-8")
    corpus = tmp_path / "corpus.csv"
    corpus.write_text("id,text\n", encoding="utf-8")
    assert _read_version(str(corpus)) == "1.0.0"

def test_read_version_missing(tmp_path):
    from build_data import _read_version
    corpus = tmp_path / "corpus.csv"
    corpus.write_text("x", encoding="utf-8")
    assert _read_version(str(corpus)) is None
```

- [ ] **Step 3: Run, verify fail** — from repo root: `.venv/bin/python -m pytest tests/test_build_data.py -k read_version -q` → FAIL (no `_read_version`).

- [ ] **Step 4: Implement** — in `app/build_data.py`, add the helper (near the other `_load_*` helpers):
```python
def _read_version(corpus_path):
    vpath = os.path.join(os.path.dirname(os.path.abspath(corpus_path)), "VERSION")
    try:
        with open(vpath, encoding="utf-8") as f:
            return f.read().strip()
    except FileNotFoundError:
        return None
```
  and add `version` as the first key of the `meta` dict (line ~49):
```python
    meta = {
        "version": _read_version(corpus_path),
        "count": len(proverbs),
        "with_explanation": len(explanations),
        "taxonomy": _load_taxonomy(taxonomy_path),
        "sources": _load_sources(sources_path),
        "per_category": dict(per_cat.most_common()),
    }
```

- [ ] **Step 5: Run, verify pass** — `.venv/bin/python -m pytest tests/test_build_data.py -k read_version -q` → PASS. Then the full file: `.venv/bin/python -m pytest tests/test_build_data.py -q` → green.

- [ ] **Step 6: Regenerate the app's data so meta.json carries the version** — from `app/`:
```bash
.venv/bin/python build_data.py ../corpus.csv ../enrich/taxonomy.csv ../sources.csv public/data ../corpus.xml
```
  Confirm: `python -c "import json;print(json.load(open('public/data/meta.json'))['version'])"` prints `1.0.0`.

- [ ] **Step 7: Commit**
```bash
git add VERSION app/build_data.py tests/test_build_data.py app/public/data/meta.json app/public/data/corpus.xml
git commit -m "feat(release): VERSION source-of-truth, stamp meta.json.version"
```
(If regeneration changed `proverbs.json`/`explanations.json` byte-for-byte, include them too; if unchanged, fine.)

---

### Task 2 [IMPL]: Show the version in the colophon

**Files:** Modify `app/src/client/main.ts`, `app/public/index.html`, `app/public/styles.css`.

**Interfaces:** Consumes `meta.version` (Task 1). The `meta` type in main.ts (line ~7) needs `version?: string`.

- [ ] **Step 1: Add `version` to the meta type** — in `main.ts`, the `meta` declaration:
```typescript
let meta: { version?: string; count: number; taxonomy: Record<string, string>; sources: Array<{ key: string; title: string; year: string; author: string }> };
```

- [ ] **Step 2: Markup** — in `app/public/index.html`, in the `.colophon` block, add right after `<p class="col-stat" id="colStat"></p>`:
```html
      <p class="col-version" id="colVersion"></p>
```

- [ ] **Step 3: Render it** — in `renderColophon` (after the `colStat` assignment), add:
```typescript
  if (meta.version) {
    $("colVersion").innerHTML =
      `Версія даних <a href="https://github.com/MurzikVasilyevich/verbacorpus/releases/tag/v${esc(meta.version)}" rel="noopener">v${esc(meta.version)}</a>`;
  }
```

- [ ] **Step 4: Styles** — append to `app/public/styles.css`:
```css
.col-version { font-family: var(--mono); font-size: .74rem; color: var(--faint); margin: -.4rem 0 .8rem; }
```

- [ ] **Step 5: Build + verify** — from `app/`: `node build.mjs` → "Built public/app.js"; `npx vitest run` → green (no test touches this). (The Worker `/api/v1/meta` returns `meta` wholesale, so `version` already flows to the API — no Worker change.)

- [ ] **Step 6: Commit**
```bash
git add app/src/client/main.ts app/public/index.html app/public/styles.css
git commit -m "feat(release): show «Версія даних v1.0.0» in the colophon, linked to the release"
```

---

### Task 3 [CONTENT]: Data card, citation, Croissant, changelog

**Files:** Create `DATACARD.md`, `CITATION.cff`, `croissant.json`, `CHANGELOG.md` (all repo root).

This is authoring with validity checks (no TDD). Use the verbatim corpus facts + license + author from Global Constraints. Source material to draw from (read for accuracy): `README.md` (Sources, Schema, Categories, Known limitations, Stats), `enrich/REPORT.md`, `expand/REPORT.md`, `app/public/data/meta.json`.

- [ ] **Step 1: `CITATION.cff`** (Citation File Format 1.2.0 — must be valid YAML):
```yaml
cff-version: 1.2.0
title: "verba — Ukrainian Proverbs Corpus"
message: "If you use this dataset, please cite it as below."
type: dataset
authors:
  - given-names: Dmytro
    family-names: Yemelianov
    orcid: "https://orcid.org/0009-0002-9244-7426"
version: 1.0.0
date-released: "2026-06-24"
url: "https://verbacorpus.org"
repository-code: "https://github.com/MurzikVasilyevich/verbacorpus"
license: CC-BY-4.0
keywords:
  - Ukrainian
  - proverbs
  - paremiology
  - folklore
  - NLP
  - corpus
  - "prysliv'ya"
```

- [ ] **Step 2: `croissant.json`** (MLCommons Croissant / schema.org JSON-LD — must be valid JSON):
```json
{
  "@context": {
    "@language": "en",
    "@vocab": "https://schema.org/",
    "cr": "http://mlcommons.org/croissant/",
    "data": { "@id": "cr:data", "@type": "@json" },
    "dataType": { "@id": "cr:dataType", "@type": "@vocab" },
    "field": "cr:field",
    "fileProperty": "cr:fileProperty",
    "format": "cr:format",
    "includes": "cr:includes",
    "recordSet": "cr:recordSet",
    "source": "cr:source"
  },
  "@type": "Dataset",
  "conformsTo": "http://mlcommons.org/croissant/1.0",
  "name": "verba-ukrainian-proverbs-corpus",
  "description": "A canonical, deduplicated, source-attributed corpus of 48,787 Ukrainian proverbs and adages unified from five digitized collections (1841–present). Each entry carries a modern-spelling rendering and 1–3 thematic categories; ~30,500 include scholarly explanations.",
  "version": "1.0.0",
  "datePublished": "2026-06-24",
  "license": "https://creativecommons.org/licenses/by/4.0/",
  "url": "https://verbacorpus.org",
  "citation": "Yemelianov, Dmytro (2026). verba — Ukrainian Proverbs Corpus (v1.0.0). https://verbacorpus.org",
  "creator": {
    "@type": "Person",
    "name": "Dmytro Yemelianov",
    "sameAs": "https://orcid.org/0009-0002-9244-7426"
  },
  "keywords": ["Ukrainian", "proverbs", "paremiology", "folklore", "NLP"],
  "inLanguage": "uk",
  "distribution": [
    {
      "@type": "cr:FileObject",
      "@id": "corpus.csv",
      "name": "corpus.csv",
      "description": "The full corpus as CSV (one row per proverb, 10 columns).",
      "contentUrl": "https://github.com/MurzikVasilyevich/verbacorpus/releases/download/v1.0.0/corpus.csv",
      "encodingFormat": "text/csv",
      "sha256": "PLACEHOLDER_SHA256"
    }
  ],
  "recordSet": [
    {
      "@type": "cr:RecordSet",
      "@id": "proverbs",
      "name": "proverbs",
      "description": "One record per proverb.",
      "field": [
        { "@type": "cr:Field", "@id": "proverbs/id", "name": "id", "description": "Stable identifier (pNNNNNN).", "dataType": "sc:Text", "source": { "fileObject": { "@id": "corpus.csv" }, "extract": { "column": "id" } } },
        { "@type": "cr:Field", "@id": "proverbs/text", "name": "text", "description": "Verbatim proverb in its source orthography.", "dataType": "sc:Text", "source": { "fileObject": { "@id": "corpus.csv" }, "extract": { "column": "text" } } },
        { "@type": "cr:Field", "@id": "proverbs/modern_text", "name": "modern_text", "description": "Modern standard Ukrainian spelling (LLM-generated).", "dataType": "sc:Text", "source": { "fileObject": { "@id": "corpus.csv" }, "extract": { "column": "modern_text" } } },
        { "@type": "cr:Field", "@id": "proverbs/category", "name": "category", "description": "1–3 theme keys, ;-joined.", "dataType": "sc:Text", "source": { "fileObject": { "@id": "corpus.csv" }, "extract": { "column": "category" } } },
        { "@type": "cr:Field", "@id": "proverbs/explanation", "name": "explanation", "description": "Scholarly note (Franko-preferred), cleaned.", "dataType": "sc:Text", "source": { "fileObject": { "@id": "corpus.csv" }, "extract": { "column": "explanation" } } },
        { "@type": "cr:Field", "@id": "proverbs/sources", "name": "sources", "description": "Source citation keys, ;-joined.", "dataType": "sc:Text", "source": { "fileObject": { "@id": "corpus.csv" }, "extract": { "column": "sources" } } },
        { "@type": "cr:Field", "@id": "proverbs/variant_group", "name": "variant_group", "description": "Id linking probable dialectal variants.", "dataType": "sc:Text", "source": { "fileObject": { "@id": "corpus.csv" }, "extract": { "column": "variant_group" } } }
      ]
    }
  ]
}
```
  (The `sha256` stays `PLACEHOLDER_SHA256` here; `scripts/release.sh` fills it from the actual asset at release time — Task 4.)

- [ ] **Step 3: `CHANGELOG.md`** (Keep a Changelog style):
```markdown
# Changelog

All notable changes to the verba Ukrainian proverbs corpus are documented here.
This project adheres to semantic versioning for datasets (MAJOR = schema/breaking,
MINOR = new source or significant additions, PATCH = corrections).

## [1.0.0] — 2026-06-24

Initial public release.

- **48,787** proverbs and adages from **5 sources**: Франко 1901 (30,906),
  Номис 1864 (9,785), Бобкова (5,613), Ількевич 1841 (2,702), Млодзинський 2009 (2,261).
- Every entry enriched with a modern-spelling rendering (`modern_text`) and 1–3 of 27
  thematic categories; **30,532** carry scholarly explanations.
- Non-destructive variant linking across sources; 10-column schema.
- Distributed as CSV, JSON, JSONL, XML; live at https://verbacorpus.org with a
  multi-format REST API and semantic search.
- **Known limitations:** Nomis 1864 is best-effort OCR (~75–80% character fidelity);
  category tags ~85% acceptable; `modern_text` ~95% acceptable. Enrichment is LLM-generated.
```

- [ ] **Step 4: `DATACARD.md`** — author a *Datasheets for Datasets* card with these sections, using the verbatim facts + the layered license. Keep it accurate and link the deeper reports. Skeleton (fill each section with real content from README/REPORTs):
```markdown
# Data Card — verba: Ukrainian Proverbs Corpus

**Version:** 1.0.0 · **Released:** 2026-06-24 · **Author:** Dmytro Yemelianov ([ORCID](https://orcid.org/0009-0002-9244-7426))
**Home:** https://verbacorpus.org · **Repo:** https://github.com/MurzikVasilyevich/verbacorpus

## Motivation
Why the dataset was created; the gap it fills (a unified, attributed, machine-readable corpus of Ukrainian proverbs); who built/maintains it.

## Composition
48,787 instances (proverbs/adages); language `uk`; the 10-column schema (list each column + meaning); per-source counts (the 5 sources); no train/test splits; ~30,500 explanations; enrichment is LLM-generated and best-effort.

## Collection process
Digitized historical collections; tesseract OCR (Bobkova, Nomis); LLM extraction from critical apparatus; exact-merge + fuzzy variant linking. Link `expand/REPORT.md`, `enrich/REPORT.md`.

## Preprocessing / cleaning / labeling
Normalization (`normalized_text`), `modern_text`, the 27-theme taxonomy, cleaned explanations, variant groups — note which are LLM artifacts.

## Uses
Suitable: NLP/paremiology/linguistics, education, cultural preservation, search. Cautions: OCR noise in 19th-c. sources; LLM-labeled fields are orientational, not gold.

## Distribution
GitHub Releases (CSV/JSON/JSONL/XML + this card), the REST API, and verbacorpus.org.
**Licensing (layered):** compilation + enrichment (`modern_text`, `category`, cleaned `explanation`, `variant_group`, the unified structure) — **CC BY 4.0**; historical texts (Franko 1901, Nomis 1864, Ilkevich 1841) — public domain; modern collections (Bobkova, Mlodzynskyi 2009) — texts remain under their publishers' rights, included for research/education, attributed per `sources`, removed on request.

## Maintenance
Maintainer + ORCID; semantic-version policy (MAJOR/MINOR/PATCH); how to report issues (GitHub issues); cadence (as sources are added/corrected).

## Known limitations
Nomis 1864 OCR ~75–80%; category audit ~85% acceptable; `modern_text` ~95%; variant groups are link-only. See `enrich/REPORT.md`.

## Citation
Provide the `CITATION.cff`-derived citation string.
```

- [ ] **Step 5: Validate** — from repo root:
```bash
.venv/bin/python -c "import json; json.load(open('croissant.json')); print('croissant OK')"
python3 -c "import yaml,sys" 2>/dev/null && python3 -c "import yaml; yaml.safe_load(open('CITATION.cff')); print('cff OK')" || echo "cff: yaml not available, skip (visual check)"
```
  Both must succeed (croissant valid JSON; cff valid YAML if pyyaml present). Visually confirm counts/sources match the Global Constraints.

- [ ] **Step 6: Commit**
```bash
git add DATACARD.md CITATION.cff croissant.json CHANGELOG.md
git commit -m "docs(release): data card (Datasheets) + CITATION.cff + Croissant + CHANGELOG"
```

---

### Task 4 [IMPL]: `scripts/release.sh` — bundle assets + gated publish

**Files:** Create `scripts/release.sh` (executable).

- [ ] **Step 1: Write the script**
```bash
#!/usr/bin/env bash
# Build verba corpus release assets and (with --publish) create the GitHub Release.
# Usage: scripts/release.sh [--publish]
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
VERSION="$(cat VERSION)"
TAG="v${VERSION}"
REPO="MurzikVasilyevich/verbacorpus"

# 1. Consistency guard: VERSION must match CITATION.cff + croissant.json
cff_v="$(grep -E '^version:' CITATION.cff | head -1 | sed -E 's/version:[[:space:]]*//; s/["'\'' ]//g')"
cro_v="$(grep -oE '"version"[[:space:]]*:[[:space:]]*"[^"]+"' croissant.json | head -1 | sed -E 's/.*"version"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/')"
if [ "$cff_v" != "$VERSION" ] || [ "$cro_v" != "$VERSION" ]; then
  echo "ERROR: version mismatch — VERSION=$VERSION CITATION.cff=$cff_v croissant.json=$cro_v" >&2
  exit 1
fi

# 2. Stage assets
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
cp corpus.csv corpus.json corpus.xml DATACARD.md croissant.json "$STAGE/"
# corpus.jsonl from the array corpus.json
python3 -c "import json,sys; [sys.stdout.write(json.dumps(r,ensure_ascii=False)+'\n') for r in json.load(open('corpus.json'))]" > "$STAGE/corpus.jsonl"

# 3. sha256s + fill croissant's CSV hash
CSV_SHA="$(sha256sum "$STAGE/corpus.csv" | cut -d' ' -f1)"
sed "s/PLACEHOLDER_SHA256/${CSV_SHA}/" croissant.json > "$STAGE/croissant.json"

# 4. zip bundle
ZIP="verba-corpus-${TAG}.zip"
( cd "$STAGE" && zip -q "$ROOT/$ZIP" corpus.csv corpus.json corpus.jsonl corpus.xml croissant.json DATACARD.md )

# 5. release notes from CHANGELOG's top section
NOTES="$STAGE/notes.md"
awk '/^## \[/{c++} c==1{print} c==2{exit}' CHANGELOG.md > "$NOTES"
{ echo; echo "**SHA256** \`corpus.csv\`: \`${CSV_SHA}\`"; echo; echo "Live: https://verbacorpus.org · API: https://verbacorpus.org/api.html · License: CC BY 4.0 (compilation)"; } >> "$NOTES"

echo "== Release $TAG =="
echo "Assets: $ZIP, corpus.csv, corpus.json, croissant.json, DATACARD.md"
echo "corpus.csv sha256: $CSV_SHA"
echo "--- notes ---"; cat "$NOTES"; echo "-------------"

if [ "${1:-}" = "--publish" ]; then
  gh release create "$TAG" --repo "$REPO" --title "verba corpus ${TAG}" --notes-file "$NOTES" \
    "$ZIP" corpus.csv corpus.json "$STAGE/croissant.json#croissant.json" DATACARD.md
  echo "Published: https://github.com/$REPO/releases/tag/$TAG"
else
  echo "(dry run — re-run with --publish to create the GitHub Release)"
fi
```

- [ ] **Step 2: Make executable + dry-run**
```bash
chmod +x scripts/release.sh
scripts/release.sh
```
  Expected: prints `== Release v1.0.0 ==`, the asset list, the corpus.csv sha256, the notes (the 1.0.0 changelog section), and `(dry run …)`. It must NOT call `gh`. Confirm `verba-corpus-v1.0.0.zip` was produced at repo root and contains the 6 files (`unzip -l verba-corpus-v1.0.0.zip`).

- [ ] **Step 3: Clean the local zip (it's a build artifact, not committed)**
```bash
rm -f verba-corpus-v1.0.0.zip
echo "verba-corpus-*.zip" >> .gitignore
```

- [ ] **Step 4: Commit**
```bash
git add scripts/release.sh .gitignore
git commit -m "feat(release): scripts/release.sh — bundle assets + gated gh release create"
```

---

### Task 5 [CONTROLLER-RUN]: deploy, release, finish

Controller-run. `wrangler deploy` and `gh release --publish` are **outward — confirm with the user before each**.

- [ ] **Step 1:** Bump `app/public/sw.js` `CACHE` (v8 → v9) so returning users get the colophon version line. Build: `cd app && node build.mjs`.
- [ ] **Step 2: Preview** — `npx wrangler versions upload`; confirm the colophon shows «Версія даних v1.0.0» linking to the (soon-to-exist) release tag, and `/api/v1/meta` returns `"version":"1.0.0"`.
- [ ] **Step 3: Deploy** (confirm with user) — `npx wrangler deploy`; verify on verbacorpus.org.
- [ ] **Step 4: Release dry-run** — from repo root `scripts/release.sh`; review the asset list + notes + sha256.
- [ ] **Step 5: Publish the release** (confirm with user) — `gh auth switch --user MurzikVasilyevich` then `scripts/release.sh --publish`; verify the release page + that the colophon link resolves (no longer 404).
- [ ] **Step 6: Finish** — README gets a short "Releases & citation" section (link the latest release, `DATACARD.md`, `CITATION.cff`); merge `feat/releases` → main; push both remotes; update memory (SP10 + v1.0.0 released).

---

## Self-Review

**1. Spec coverage:** §2 VERSION→meta→site/API → Tasks 1 (VERSION + build_data + regen meta), 2 (colophon + API-flows-free). §3 DATACARD/CITATION/croissant/CHANGELOG → Task 3. §4 release.sh + gated publish → Tasks 4, 5. §5 site version display → Task 2. §6 licensing → Global Constraints + Task 3 content. §7 components → Tasks 1–4. §8 testing (build_data version test; croissant JSON / cff YAML validity; release dry-run; site preview) → Tasks 1, 3, 4, 5. §9 deploy & release order → Task 5. §10 risks (version drift → release.sh guard; croissant validity → JSON check; sha256 at release time; license accuracy) → Tasks 3, 4. The spec's "build.py stamps corpus.json" is intentionally DROPPED (corpus.json is a bare array; wrapping it would break consumers) — noted in Global Constraints; version lives in meta/VERSION/croissant instead.

**2. Placeholder scan:** complete code/content for VERSION, build_data, the colophon, CITATION.cff, croissant.json, CHANGELOG.md, release.sh. `DATACARD.md` is given as a section skeleton with explicit per-section content instructions + the verbatim facts to use (authoring task, not boilerplate). The croissant `sha256` is an intentional `PLACEHOLDER_SHA256` filled by release.sh (documented). No TBD/vague-error-handling.

**3. Type/name consistency:** `_read_version(corpus_path)` defined in Task 1, used there; `meta.version` produced in Task 1, consumed in Task 2 (type updated) and flows to the API unchanged. `VERSION` value `1.0.0`, the tag `v1.0.0`, `CITATION.cff version`, `croissant.json version`, and the colophon link all use the same `1.0.0` (release.sh asserts the match). Release-asset filenames (`corpus.csv/json/jsonl/xml`, `croissant.json`, `DATACARD.md`, `verba-corpus-v1.0.0.zip`) consistent between Task 4's script and Task 5.

**Note (Task 1):** the implementer must match how `tests/test_build_data.py` already imports the `build_data` module (sys.path / conftest) when adding the new tests.
**Note (Task 3):** `DATACARD.md` is authoring — the reviewer checks factual accuracy against the Global Constraints + that counts match `meta.json`, not byte-exact text.
