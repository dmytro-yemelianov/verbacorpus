# verba — SP13: Proper bibliographic references for the corpus sources

**Date:** 2026-06-24
**Status:** Approved (design)
**Sub-project:** 13 — turn the 5 corpus source entries into full academic references (BibTeX + CSL-JSON + rendered citations, with ISBN where it genuinely exists)
**Repo:** `dmytro-yemelianov/verbacorpus`; build pipeline + `app/`
**Depends on:** the live app; `sources.csv` (the source registry), `build_data.py` → `meta.json.sources`, the About page, `/p/:id` citation, DATACARD, croissant, CITATION.cff.

---

## 1. Scope & motivation

The 5 source collections are currently thin (`key, title, year, author`). The README even notes BibTeX was omitted for lack of metadata. This sub-project gives each source a **proper, paper-grade reference** — full bibliographic data, exported as **BibTeX (`references.bib`)** and **CSL-JSON (`references.csl.json`)** and rendered as human-readable citations across the site — closing that gap and making the corpus properly citable + traceable to its sources.

**In scope:** the 5 sources (Franko 1901, Nomis 1864, Bobkova, Ilkevich 1841, Mlodzynskyi 2009). **Out of scope:** per-proverb source-page references (a `source_refs` field already exists); changing the corpus content; the verbacorpus *dataset's own* citation (that's `CITATION.cff`, already done — though it gains a `references:` list of these sources).

**Hard constraint — accuracy, no fabrication:** all bibliographic data is **researched** (web) and verified. The three 19th-century public-domain works (Franko 1901, Nomis 1864, Ilkevich 1841) **predate ISBN/DOI** — they get a complete citation (author, title, place, publisher/society, year, volumes) **without** ISBN/DOI, which is correct. The modern editions (the Bobkova reprint, Mlodzynskyi 2009) get a **verified ISBN only if one genuinely exists**; unverifiable identifiers are **left blank**, never invented. Each entry gets a stable URL to a digital copy/archive where one exists. Uncertain details are flagged, not guessed.

## 2. Data model — one source of truth

Enrich **`sources.csv`** (the existing registry) with bibliographic columns, keeping it the single source of truth:

`Citationkey, Author, Title, Year, Place, Publisher, Volume, ISBN, URL, Note`

(existing rows keep their values; new columns filled by research; `Volume`/`Note` capture e.g. Franko's multi-volume Етнографічний збірник series; blank where genuinely unavailable).

From this, a generator produces the derived artifacts (so they never drift):
- **`references.bib`** — one `@book{<key>, …}` per source (author, title, year, address, publisher, volume, isbn, url, note).
- **`references.csl.json`** — CSL-JSON array (type `book`, author, title, issued, publisher-place, publisher, ISBN, URL) for Zotero/citation managers.
- A **rendered citation string** per source (e.g. `Франко, Іван. Галицько-руські народні приповідки. Львів: НТШ, 1901–1910. (Етнографічний збірник, тт. X, XVI, XXIII, XXVII, XXVIII).`) injected into `meta.json.sources[].citation` for the UI.

## 3. Components / files

- `sources.csv` (MODIFY) — add the bibliographic columns + researched values.
- `core/references.py` (NEW) — pure functions: `to_bibtex(rows) -> str`, `to_csl(rows) -> list[dict]`, `render_citation(row) -> str` (a clean full reference; omits ISBN/URL cleanly when blank). [pytest]
- `build.py` (MODIFY) — write `references.bib` + `references.csl.json` (root) from `sources.csv` during the build.
- `app/build_data.py` (MODIFY) — add `citation` (+ the bib fields the UI needs: isbn, url) to each `meta.json.sources` entry via `render_citation`; copy `references.bib` + `references.csl.json` into `app/public/` so they're downloadable.
- `app/public/about.html` + i18n (MODIFY) — the «Джерела» section becomes a **bibliography**: render each source's full citation (from `meta.sources[].citation`, fetched client-side like the count/version) with its ISBN/URL, plus **«Завантажити: BibTeX · CSL-JSON»** download links. The section heading + the download labels are i18n catalog keys; the citations themselves are bibliographic data (language-neutral), not translated.
- `app/src/shared/meta.ts` (`buildProverbPage` citation) + `app/src/client/main.ts` (`openDetail` citation) (MODIFY) — show the source's **full citation** (from `meta.sources[].citation`) instead of the current `author, title (year)` snippet.
- `DATACARD.md` §Sources (MODIFY) — replace the source list with the proper references (+ ISBNs/URLs).
- `croissant.json` (MODIFY) — add a `citation`/`isBasedOn` referencing the source works; `CITATION.cff` (MODIFY) — add a `references:` list (one `type: book` reference per source, with author/title/year/isbn).
- `references.bib`, `references.csl.json` (NEW, generated at repo root; copies served from `app/public/`).

## 4. Research phase (controller)

Before generating, **research and verify** each source's bibliographic details (web): exact place, publisher/society, volumes/series, the modern critical edition + its ISBN where applicable, and a stable digital-archive URL (Chtyvo, archive.org, Diasporiana, etc.). Record findings + uncertainty per source. The three pre-1920 works: full citation, no ISBN/DOI, link the digital scan. The modern editions: verified ISBN or blank. **No invented identifiers.** A short provenance note per source goes in `sources.csv`'s `Note` and/or `expand/REPORT.md`.

## 5. Testing

- **pytest** `core/references.py`: `render_citation` formats a full entry (author. title. place: publisher, year. ISBN. URL.) and **omits blank ISBN/URL cleanly** (no dangling punctuation); `to_bibtex` emits a valid `@book` with the present fields only (no empty `isbn = {}`); `to_csl` emits valid CSL-JSON (type book, issued date-parts). Round-trip: a source with no ISBN produces a citation/bib/csl with no ISBN field.
- **Validation:** `references.bib` parses (a BibTeX sanity check / no empty required fields); `references.csl.json` is valid JSON; both served files match the root ones.
- **Build:** `meta.json.sources` each have a non-empty `citation`; the About fetch renders them.
- **Manual (preview):** About shows the 5 full references + working BibTeX/CSL-JSON download links; a `/p/:id` detail shows the full citation; DATACARD references render.
- **Accuracy review:** a human/second-pass check of the researched data (the reputation-critical part) before publishing — esp. any ISBN.

## 6. Deploy & version

Bibliographic metadata is a data refinement → ship as a **PATCH (v1.0.2)** (no corpus content change): bump VERSION/CHANGELOG/CITATION/croissant, regenerate, deploy, cut the release with the updated assets (+ `references.bib`/`references.csl.json` as release assets). Outward steps confirmed with the user.

## 7. Risks / open items

- **Fabrication (the key risk):** mitigated by the research+verify phase + the accuracy review; blanks over guesses; 19th-c. works correctly carry no ISBN/DOI.
- **Edition ambiguity:** the corpus was built from specific digitizations; the reference should cite the **edition actually used** (note the digital source URL), not a random reprint — record which in `Note`. If the exact edition of the Bobkova/Mlodzynskyi text used isn't certain, cite the most likely + flag it.
- **Drift:** `sources.csv` is the single source of truth; `.bib`/`.csl.json`/`meta.citation` are all generated — never hand-edited.
- **i18n:** citations are language-neutral data (not catalog keys); only the surrounding labels (heading, "Download") are translated — keeps the bibliography consistent across the 10 UI languages.
- **CSL-JSON/BibTeX validity:** generated programmatically with a unit test; not a full CSL processor (a clean subset is enough).
