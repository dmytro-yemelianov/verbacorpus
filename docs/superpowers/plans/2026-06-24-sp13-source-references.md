# verba — SP13: Proper bibliographic references — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the 5 corpus sources full academic references — rendered citations + a generated `references.bib` (BibTeX) and `references.csl.json` (CSL-JSON) — surfaced on the site, with researched (never fabricated) bibliographic data.

**Architecture:** `sources.csv` (enriched) is the single source of truth; pure `core/references.py` renders citations + emits BibTeX/CSL-JSON; `build.py` writes the two reference files, `build_data.py` injects a `citation` into `meta.json.sources` + copies the files to `public/`; the About page renders a bibliography (with downloads), the `/p` detail + DATACARD/croissant/CITATION use the full references. The real bibliographic data is gathered in a controller research phase.

**Tech Stack:** Python (pytest) + the TS Worker/PWA; no new deps.

## Global Constraints

- Sources: **Franko1901, Nomis1864, Bobkova, Ilkevich1841, Mlodzynskyi2009**. `sources.csv` is the single source of truth; `references.bib`/`references.csl.json`/`meta.citation` are **generated**, never hand-edited.
- `sources.csv` columns: `Citationkey,Author,Title,Year,Place,Publisher,Volume,ISBN,URL,Note`.
- **No fabrication:** all bib data is researched + verified; the three 19th-c. works (Franko 1901, Nomis 1864, Ilkevich 1841) carry **no ISBN/DOI** (correct); modern editions get a **verified ISBN or blank**; unverifiable fields stay blank; cite the **edition actually digitized**, noted in `Note`.
- Citations are **language-neutral data** (in `meta.json`), not i18n catalog keys; only the bibliography heading + download labels are i18n'd.
- Ships as **v1.0.2** (PATCH; no corpus content change). origin = dmytro-yemelianov. Branch `feat/references`. Deploy + release **outward — confirm with user**. Commit identity MurzikVasilyevich; session footer.
- **Task types:** `[IMPL]` TDD · `[CONTENT]` · `[CONTROLLER-RUN]` (research, deploy, release).

---

### Task 1 [IMPL]: `core/references.py` + `sources.csv` schema

**Files:** Create `core/references.py`, `tests/test_references.py`; Modify `sources.csv`.

**Interfaces — Produces:** `render_citation(row: dict) -> str`, `to_bibtex(rows: list[dict]) -> str`, `to_csl(rows: list[dict]) -> list[dict]` (row keys = the `sources.csv` columns).

- [ ] **Step 1: Add the columns to `sources.csv`** — rewrite the header to `Citationkey,Author,Title,Year,Place,Publisher,Volume,ISBN,URL,Note` and keep each existing row's current values, leaving the new columns blank for now (the controller fills them in Task 5). Example rows (blanks preserved):
```
Citationkey,Author,Title,Year,Place,Publisher,Volume,ISBN,URL,Note
Franko1901,Іван Франко,Галицько-руські народні приповідки,1901,,,,,,
Nomis1864,Матвій Номис,"Українські приказки, прислів'я і таке інше",1864,,,,,,
Bobkova,Бобкова В.І. (упоряд.),Українські народні прислів'я та приказки,,,,,,,
Ilkevich1841,Григорій Ількевич,Галицкіи приповѣдки и загадки,1841,,,,,,
Mlodzynskyi2009,,Практичний російсько-український словник приказок,2009,,,,,,
```

- [ ] **Step 2: Write the failing test** — `tests/test_references.py`:
```python
from core.references import render_citation, to_bibtex, to_csl

FULL = {"Citationkey": "X", "Author": "Іван Франко", "Title": "Назва", "Year": "1901",
        "Place": "Львів", "Publisher": "НТШ", "Volume": "Етнографічний збірник, тт. X, XVI",
        "ISBN": "", "URL": "https://example.org/x", "Note": ""}
MODERN = {"Citationkey": "M", "Author": "А. Б.", "Title": "Словник", "Year": "2009",
          "Place": "Київ", "Publisher": "Освіта", "Volume": "", "ISBN": "978-966-00-0000-0", "URL": "", "Note": ""}

def test_render_citation_full_no_isbn():
    c = render_citation(FULL)
    assert c == "Іван Франко. Назва. Етнографічний збірник, тт. X, XVI. Львів: НТШ, 1901. https://example.org/x"
    assert "ISBN" not in c  # blank ISBN omitted cleanly

def test_render_citation_modern_with_isbn():
    c = render_citation(MODERN)
    assert c == "А. Б. Словник. Київ: Освіта, 2009. ISBN 978-966-00-0000-0."

def test_render_citation_omits_blanks_no_dangling_punct():
    minimal = {"Citationkey": "Z", "Author": "", "Title": "Заголовок", "Year": "1864", "Place": "СПб.",
               "Publisher": "", "Volume": "", "ISBN": "", "URL": "", "Note": ""}
    assert render_citation(minimal) == "Заголовок. СПб., 1864."

def test_to_bibtex_omits_empty_fields():
    bib = to_bibtex([FULL])
    assert bib.startswith("@book{X,")
    assert "title = {Назва}" in bib and "address = {Львів}" in bib and "publisher = {НТШ}" in bib
    assert "isbn" not in bib  # empty ISBN not emitted
    bibm = to_bibtex([MODERN])
    assert "isbn = {978-966-00-0000-0}" in bibm

def test_to_csl_shape():
    csl = to_csl([FULL, MODERN])
    assert csl[0]["id"] == "X" and csl[0]["type"] == "book"
    assert csl[0]["issued"]["date-parts"] == [[1901]]
    assert "ISBN" not in csl[0] and csl[1]["ISBN"] == "978-966-00-0000-0"
```

- [ ] **Step 3: Run, verify fail** — `.venv/bin/python -m pytest tests/test_references.py -q` → FAIL.

- [ ] **Step 4: Implement** — `core/references.py`:
```python
from __future__ import annotations

def render_citation(r: dict) -> str:
    g = lambda k: (r.get(k) or "").strip()
    bits: list[str] = []
    if g("Author"): bits.append(g("Author").rstrip(".") + ".")
    if g("Title"): bits.append(g("Title").rstrip(".") + ".")
    if g("Volume"): bits.append(g("Volume").rstrip(".") + ".")
    place, pub, year = g("Place"), g("Publisher"), g("Year")
    loc = f"{place}: {pub}" if place and pub else (place or pub)
    seg = f"{loc}, {year}" if loc and year else (loc or year)
    if seg: bits.append(seg.rstrip(".") + ".")
    if g("ISBN"): bits.append(f"ISBN {g('ISBN')}.")
    if g("URL"): bits.append(g("URL"))
    return " ".join(bits)

def to_bibtex(rows: list[dict]) -> str:
    fieldmap = [("author", "Author"), ("title", "Title"), ("year", "Year"),
                ("address", "Place"), ("publisher", "Publisher"), ("volume", "Volume"),
                ("isbn", "ISBN"), ("url", "URL"), ("note", "Note")]
    out = []
    for r in rows:
        lines = [f"@book{{{r['Citationkey']},"]
        for bib, col in fieldmap:
            v = (r.get(col) or "").strip()
            if v:
                lines.append(f"  {bib} = {{{v}}},")
        lines.append("}")
        out.append("\n".join(lines))
    return "\n\n".join(out) + "\n"

def to_csl(rows: list[dict]) -> list[dict]:
    out = []
    for r in rows:
        g = lambda k: (r.get(k) or "").strip()
        e: dict = {"id": r["Citationkey"], "type": "book"}
        if g("Author"): e["author"] = [{"literal": g("Author")}]
        if g("Title"): e["title"] = g("Title")
        if g("Year").isdigit(): e["issued"] = {"date-parts": [[int(g("Year"))]]}
        if g("Place"): e["publisher-place"] = g("Place")
        if g("Publisher"): e["publisher"] = g("Publisher")
        if g("Volume"): e["volume"] = g("Volume")
        if g("ISBN"): e["ISBN"] = g("ISBN")
        if g("URL"): e["URL"] = g("URL")
        out.append(e)
    return out
```

- [ ] **Step 5: Run, verify pass** — `.venv/bin/python -m pytest tests/test_references.py -q` → PASS.

- [ ] **Step 6: Commit**
```bash
git add core/references.py tests/test_references.py sources.csv
git commit -m "feat(refs): sources.csv bibliographic schema + render_citation/to_bibtex/to_csl"
```

---

### Task 2 [IMPL]: build wiring — emit reference files + meta citations

**Files:** Modify `build.py`, `app/build_data.py`; Test: `tests/test_build_data.py` (extend).

**Interfaces:** Consumes `core.references`. Produces `references.bib`/`references.csl.json` (root + `app/public/`); `meta.json.sources[]` gains `citation`, `isbn`, `url`.

- [ ] **Step 1: build.py writes the reference files** — in `build.py`, after writing corpus.csv/json, add:
```python
import csv, json as _json
from core.references import to_bibtex, to_csl

def _write_references(sources_csv: str = "sources.csv", out_dir: str = ".") -> None:
    rows = list(csv.DictReader(open(sources_csv, encoding="utf-8")))
    with open(os.path.join(out_dir, "references.bib"), "w", encoding="utf-8") as f:
        f.write(to_bibtex(rows))
    with open(os.path.join(out_dir, "references.csl.json"), "w", encoding="utf-8") as f:
        _json.dump(to_csl(rows), f, ensure_ascii=False, indent=2)
```
  and call `_write_references()` in `build()`.

- [ ] **Step 2: build_data.py injects citation + copies the files** — in `app/build_data.py`, where `meta["sources"]` is built (via `_load_sources`), enrich each source dict with `citation`, `isbn`, `url` using `core.references.render_citation`; and copy `references.bib` + `references.csl.json` from the repo root into `out_dir`'s parent `public/`. Concretely, update `_load_sources` to read ALL columns and add the rendered citation:
```python
from core.references import render_citation  # add import (adjust sys.path as the file already does for core)
# in _load_sources, per row r:
#   {"key": r["Citationkey"], "title": r["Title"], "year": r["Year"], "author": r["Author"],
#    "citation": render_citation(r), "isbn": (r.get("ISBN") or ""), "url": (r.get("URL") or "")}
```
  and after writing meta.json, copy the two reference files into the public data root's parent (the `public/` dir, i.e. `os.path.dirname(out_dir)` when out_dir is `public/data`) — or simplest: write them directly into `public/` next to where `build_data.py` is invoked. (The README invocation is `build_data.py ../corpus.csv ../enrich/taxonomy.csv ../sources.csv public/data ../corpus.xml`; the sources path is arg 3, `public/` is `os.path.dirname(out_dir)`.) Use `core.references.to_bibtex/to_csl` on the sources rows to write `public/references.bib` + `public/references.csl.json` directly (DRY with build.py's logic via the shared functions).

- [ ] **Step 3: Test** — add to `tests/test_build_data.py` (match its import style): after running `build()` on a fixture (or assert against the generated meta), every `meta["sources"]` entry has a non-empty `citation`; `references.bib` exists at root and starts with `@book{`; `references.csl.json` is valid JSON with one entry per source.

- [ ] **Step 4: Regenerate + verify** — from repo root: `.venv/bin/python build.py` (writes references.bib/csl.json); from `app/`: `../.venv/bin/python build_data.py ../corpus.csv ../enrich/taxonomy.csv ../sources.csv public/data ../corpus.xml` → `public/data/meta.json` sources have `citation`; `public/references.bib` + `public/references.csl.json` exist. `npx vitest run` stays green.

- [ ] **Step 5: Commit**
```bash
git add build.py app/build_data.py tests/test_build_data.py references.bib references.csl.json app/public/references.bib app/public/references.csl.json app/public/data/meta.json
git commit -m "feat(refs): generate references.bib + references.csl.json + meta.sources citations"
```

---

### Task 3 [IMPL]: display — About bibliography + /p detail citation

**Files:** Modify `app/public/about.html` (+ i18n catalogs), `app/src/shared/meta.ts`, `app/src/client/main.ts`.

- [ ] **Step 1: About bibliography** — replace the `about.s2.*` source `<li>` list with a bibliography rendered from `meta.sources` (the citations are data, not catalog). Give the `<ul>` an id `aboutRefs`; in about.html's inline script (which already fetches `/api/v1/meta`), render one `<li>` per source = its `citation` (with the `url` as a link when present, the ISBN shown). Add a download line: **«Завантажити: <a href="/references.bib">BibTeX</a> · <a href="/references.csl.json">CSL-JSON</a>»** — keyed `about.refs.download` (uk "Завантажити", en "Download"). The «Джерела» heading stays `about.s2.h2`. Remove the now-dead `about.s2.li1..5` keys from uk.json + en.json (keep key sets identical).
```javascript
    // in the about inline script, after fetching meta `m`:
    var refs = document.getElementById("aboutRefs");
    if (refs && m.sources) refs.innerHTML = m.sources.map(function (s) {
      var cit = s.citation || (s.author ? s.author + ". " : "") + s.title;
      return "<li>" + cit.replace(/(https?:\/\/\S+)/, '<a href="$1" rel="noopener">$1</a>') + "</li>";
    }).join("");
```

- [ ] **Step 2: /p detail + PWA detail citation** — in `app/src/shared/meta.ts` `buildProverbPage`, build the source citation from the source's full reference. Since `buildProverbPage` only gets the proverb (not meta.sources), pass the rendered citations in: simplest — the Worker's `load(env)` already has `meta`; have the `/p` handler build a `srcCite(key)` lookup from `meta.sources` and pass the joined citations to `buildProverbPage` (extend its signature with `sourceCitations: string[]`), OR map `p.sources` → `srcLabel` (already readable) for the inline tag and add a "Джерела:" full-citation block from `meta.sources`. Keep it simple: in `main.ts` `openDetail`, the existing `cite` builder already reads `meta.sources.find(...)`; change it to use that source's `.citation` (full reference) instead of the `author, title (year)` snippet. For the Worker `/p` page, pass the matching `meta.sources[].citation` strings into `buildProverbPage` and render them in the `.detail-meta`/cite area.

- [ ] **Step 3: Styles** — minor: a `.about-refs li { margin:.5rem 0; line-height:1.5; }` and `.refs-download { font-size:.85rem; margin-top:1rem; }` in styles.css (theme vars).

- [ ] **Step 4: Build + verify** — from `app/`: `node build.mjs` → clean; `npx vitest run` → green (update the i18n-complete test expectations if the about.s2.li* keys were removed — keep uk/en in sync). Manually: About shows the citations + download links resolve (`/references.bib`, `/references.csl.json` served from public).

- [ ] **Step 5: Commit**
```bash
git add app/public/about.html app/public/i18n/uk.json app/public/i18n/en.json app/src/shared/meta.ts app/src/client/main.ts app/public/styles.css
git commit -m "feat(refs): About bibliography + downloads + full-citation detail"
```

---

### Task 4 [CONTENT]: DATACARD + croissant + CITATION references

**Files:** Modify `DATACARD.md`, `croissant.json`, `CITATION.cff`.

- [ ] **Step 1: DATACARD §Sources** — replace the source bullet list with the proper rendered references (one per source, incl. ISBN/URL where present). [authoring from the generated citations]
- [ ] **Step 2: croissant.json** — add a top-level `citation` (the dataset citation, unchanged) and an `isBasedOn` array referencing the 5 source works (each `{"@type":"Book","name":…,"author":…,"datePublished":…,"isbn"?:…,"url"?:…}`). Valid JSON.
- [ ] **Step 3: CITATION.cff** — add a `references:` list: one entry per source `- type: book` with `authors`, `title`, `year`, and `isbn` where present. Valid YAML (CFF 1.2.0).
- [ ] **Step 4: Validate + commit** — `python3 -c "import json;json.load(open('croissant.json'))"`; `python3 -c "import yaml;yaml.safe_load(open('CITATION.cff'))"` (if pyyaml). Commit:
```bash
git add DATACARD.md croissant.json CITATION.cff
git commit -m "docs(refs): proper source references in DATACARD + croissant isBasedOn + CITATION references"
```
(Final values are finalized after Task 5's research; this task wires the structure.)

---

### Task 5 [CONTROLLER-RUN]: research, fill, verify, ship v1.0.2

Controller-run. **Accuracy is reputation-critical; no fabrication.** Deploy + release outward — confirm with user.

- [ ] **Step 1: Research** — for each of the 5 sources, gather + verify (web): exact Author, Place, Publisher/society, Year(s), Volume/series, the **edition actually digitized** + its stable URL (Chtyvo / archive.org / Diasporiana), and a **verified ISBN** for the modern editions (Bobkova reprint, Mlodzynskyi 2009) — or leave ISBN blank if none/unverifiable. The three pre-1920 works carry no ISBN. Record a one-line provenance + any uncertainty in each row's `Note`. Fill `sources.csv`.
- [ ] **Step 2: Accuracy review** — re-read each filled row against the research; confirm no invented ISBN/identifier; confirm the cited edition matches what the corpus was built from (flag in `Note` if uncertain). A second-pass (or human) check.
- [ ] **Step 3: Regenerate** — `.venv/bin/python build.py` (references.bib/csl.json) + the `build_data.py` invocation (meta citations + public copies); `cd app && node build.mjs`. Finalize DATACARD/croissant/CITATION from the now-real data (Task 4 structure + real values).
- [ ] **Step 4: v1.0.2** — bump VERSION→1.0.2, CHANGELOG (`## [1.0.2]` — proper source references + BibTeX/CSL-JSON), CITATION.cff + croissant version. Bump `sw.js`. Rebuild app data.
- [ ] **Step 5: Preview + verify** — `npx wrangler versions upload`; About shows the 5 full references + working BibTeX/CSL-JSON downloads; `/p/:id` detail shows the full citation; `/references.bib` + `/references.csl.json` serve.
- [ ] **Step 6: Deploy + release** (confirm with user) — `npx wrangler deploy`; `scripts/release.sh --publish` (v1.0.2; the release bundles + the new reference files). Merge `feat/references` → main; push origin; update memory.

---

## Self-Review

**1. Spec coverage:** §1 scope (5 sources, refs) → all tasks. §2 data model (sources.csv source-of-truth → generated .bib/.csl/meta.citation) → T1 (schema+generator), T2 (wiring). §3 components → T1–T4. §4 research phase (verify, no fabrication, edition-used) → T5 Steps 1–2. §5 testing (render_citation omit-blanks, bibtex no-empty, csl shape; meta citation; validity) → T1, T2, T3. §6 deploy v1.0.2 → T5. §7 risks (fabrication→research+review; drift→single-source generated; i18n→citations are data) → constraints + T1/T3/T5.

**2. Placeholder scan:** complete code for `core/references.py` + tests, the build wiring, the About render snippet. T4 is content authoring (structure now, real values after T5's research) — explicitly noted, not a stub. T5 is the controller research/ship with concrete steps. The `sources.csv` real values are intentionally deferred to T5 (the research phase) — T1 sets the schema with current+blank values so the machinery is testable immediately.

**3. Type/name consistency:** `render_citation(row)`, `to_bibtex(rows)`, `to_csl(rows)` defined in T1, consumed in T2 (build.py + build_data.py) and T3 (via meta.citation). `meta.json.sources[].citation/isbn/url` produced in T2, consumed in T3 (About render + detail). The `sources.csv` column names are fixed in T1 and used by the generator + `_load_sources`. The reference files `references.bib`/`references.csl.json` named consistently across T2 (generate), T3 (download links), T5 (release assets).

**Note (T3):** removing the `about.s2.li1..5` catalog keys must keep uk.json/en.json key sets identical and update the i18n-complete test if it pins a count — keep both catalogs in lockstep.
