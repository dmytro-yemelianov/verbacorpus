# verba — SP10: Versioned releases, data card & on-site version

**Date:** 2026-06-24
**Status:** Approved (design)
**Sub-project:** 10 — version the corpus, publish citable GitHub Releases with a data card, and surface the version on the site
**Repo:** `verbacorpus` (MurzikVasilyevich/verbacorpus, + dmytro mirror); changes to repo root, `app/`
**Depends on:** the live corpus (48,787 entries, 5 sources) + the build pipeline (`build.py` → `corpus.{csv,json,xml}`; `app/build_data.py` → `app/public/data/*.json`).

---

## 1. Scope & motivation

Give the corpus a real **release identity**: a single version source-of-truth, **GitHub Releases** that bundle the data in every format plus a standard **data card**, and a **version label on the site** so anyone can tell which snapshot they're looking at and cite it. This is what turns "a repo with data" into a citable dataset.

**This release = v1.0.0** (mature, complete, live). SemVer-for-data: **MAJOR** = schema/breaking change; **MINOR** = new source or significant content additions; **PATCH** = corrections/fixes.

**Out of scope:** automated release-on-tag CI; publishing to HuggingFace/Kaggle (the Croissant file makes that easy later, but the upload itself is separate); changing the corpus content.

## 2. Version source-of-truth & propagation

- **`VERSION`** (repo root) holds the bare version, e.g. `1.0.0`. Single source of truth.
- `app/build_data.py` reads `VERSION` and writes `version` into `app/public/data/meta.json` (alongside `count`, `taxonomy`, `sources`, build date). Because the Worker's `/api/v1/meta` returns the loaded `meta.json`, the version then appears in **the site, the API, and the static data** from one change. (Verify the Worker's meta handler passes `version` through; add it if it constructs a subset.)
- `build.py` writes a top-level `version` (and `generated` date if not already present) into `corpus.json` so the data file is self-identifying.
- `CITATION.cff`, `croissant.json`, and `CHANGELOG.md` carry the version literally; `scripts/release.sh` asserts they match `VERSION` before releasing (guard against drift).

## 3. Data card & metadata files (repo root)

- **`DATACARD.md`** — follows *Datasheets for Datasets* (Gebru et al.) + the HuggingFace dataset-card structure. Sections: **Motivation** · **Composition** (instances = proverbs; 48,787; the 10-column schema; per-source counts; language `uk`; no splits; enrichment is LLM-generated/best-effort) · **Collection process** (digitized historical texts; tesseract OCR for Bobkova/Nomis; LLM extraction + enrichment) · **Preprocessing/cleaning** (normalization, `modern_text`, 27-theme categories, cleaned explanations, non-destructive variant linking) · **Uses** (NLP, linguistics, education, cultural preservation; cautions) · **Distribution** (GitHub Releases + REST API + verbacorpus.org; formats; **licensing** — see §6) · **Maintenance** (maintainer, versioning policy, how to report issues) · **Limitations** (Nomis OCR ~75–80%; category audit ~85%; modern_text ~95%; from the existing audits). Consolidates the scattered README / `enrich/REPORT.md` / `expand/REPORT.md` content; links to them for depth.
- **`CITATION.cff`** — Citation File Format 1.2.0 (GitHub renders a "Cite this repository" button). Title, **author** (`given-names: Dmytro`, `family-names: Yemelianov`, `orcid: https://orcid.org/0009-0002-9244-7426`), version `1.0.0`, date-released `2026-06-24`, repository/url, `license: CC-BY-4.0`, keywords, type `dataset`.
- **`croissant.json`** — [MLCommons Croissant](https://mlcommons.org/croissant/) JSON-LD (schema.org-based): dataset name/description/license/url/version/citation; a `distribution` (FileObject) pointing at the release CSV + its `sha256`; a `recordSet` describing the 10 columns with `dataType`s. Makes the dataset machine-readable for HuggingFace/Kaggle ingestion later. Must be valid JSON.
- **`CHANGELOG.md`** — Keep-a-Changelog style; `## [1.0.0] — 2026-06-24` initial entry: the 5 sources + counts, the feature set (search/semantic/multi-format API), and the known-limitations summary.

## 4. GitHub Releases & `scripts/release.sh`

- **`scripts/release.sh`** (bash): reads `VERSION`; asserts `CITATION.cff`/`croissant.json` versions match; (re)generates `corpus.jsonl` from `corpus.json`; assembles a staging dir with `corpus.csv`, `corpus.json`, `corpus.jsonl`, `corpus.xml`, `DATACARD.md`, `croissant.json`; zips it to `verba-corpus-v<VERSION>.zip`; computes sha256s; prints the planned `gh release create` command and the asset list. By default it **stops before publishing** (prints the command); with `--publish` it runs `gh release create v<VERSION> --title "verba corpus v<VERSION>" --notes-file <notes> <zip> corpus.csv corpus.json croissant.json DATACARD.md`. Publishing is **outward — the controller runs `--publish` only after user confirmation**, on the MurzikVasilyevich account (the public repo).
- **Release notes** (generated from CHANGELOG's top entry): headline stats, per-source counts, formats included, links to the live site + API + data card, and the licensing note.
- The release is created on `MurzikVasilyevich/verbacorpus`. (The dmytro mirror is a private backup; no release needed there.)

## 5. Site version display

- The colophon (`renderColophon` in `app/src/client/main.ts`) shows the version: append **«· версія vX.Y.Z»** to the stat line, linked to `https://github.com/MurzikVasilyevich/verbacorpus/releases/tag/vX.Y.Z`. Rendered only when `meta.version` is present (graceful if absent). A new `#colVersion` span (or appended to `#colStat`). Themed, keyboard-focusable link.

## 6. Licensing statement (DATACARD / CITATION / croissant)

Layered, stated honestly (not a single blanket claim):
- **Compilation + enrichment** (the unified corpus structure, `modern_text`, `category`, cleaned `explanation`, `variant_group`): **CC BY 4.0** (confirmed). Author/attribution: **Dmytro Yemelianov** (ORCID `0009-0002-9244-7426`).
- **Historical source texts** (Franko 1901, Nomis 1864, Ilkevich 1841): public domain.
- **Modern collections** (Bobkova, Mlodzynskyi 2009): texts remain under their original publishers' rights; included for research/education; attributed per entry's `sources`; removed on request.
`CITATION.cff` `license:` and `croissant.json` `license:` use the compilation license (CC-BY-4.0); the layered detail lives in DATACARD.md §Distribution.

## 7. Components / files

- `VERSION` (NEW, root) — `1.0.0`.
- `DATACARD.md`, `CITATION.cff`, `croissant.json`, `CHANGELOG.md` (NEW, root).
- `scripts/release.sh` (NEW) — build assets + (gated) `gh release create`.
- `app/build_data.py` (MODIFY) — read `VERSION`, stamp `meta.json.version`.
- `build.py` (MODIFY) — stamp `corpus.json` top-level `version`.
- `app/src/client/main.ts` + `app/public/index.html` (MODIFY) — colophon version link; `app/public/styles.css` if needed.
- `app/src/index.ts` (VERIFY/MODIFY) — `/api/v1/meta` returns `version`.
- Possibly `README.md` (MODIFY) — a short "Releases & citation" note + the data-card link.

## 8. Testing

- **pytest** (`build_data.py`): given a `VERSION` file, the emitted `meta.json` contains the exact `version` string; absent/edge handled. If `build.py` stamps `corpus.json`, assert the field.
- **Validation:** `croissant.json` is valid JSON (a test or a `python -m json.tool` check); `CITATION.cff` parses as YAML; `release.sh` consistency-check (version match) exercised in dry-run.
- **Site:** preview shows «версія v1.0.0» linking to the release; `/api/v1/meta` returns `version`. (Manual/preview.)
- **Content review:** DATACARD/CHANGELOG/CITATION accuracy (counts, sources, limitations) checked against the live `meta.json` and the audits.

## 9. Deploy & release (outward — confirm with user)

Order: build + commit all files → `wrangler deploy` (site shows the version) → run `scripts/release.sh` (dry-run) → review → `scripts/release.sh --publish` to create the **v1.0.0** GitHub Release. Both the deploy and the release publish are outward — confirm before each. Merge `feat/releases` → main, push both remotes.

## 10. Risks / open items

- **Version drift** across VERSION / CITATION.cff / croissant.json / CHANGELOG → `release.sh` asserts they match before publishing; documented as the bump checklist in CHANGELOG.
- **Croissant correctness:** the spec is evolving; target the stable schema.org-based core (name, description, license, distribution+sha256, recordSet+fields). Validate JSON; full Croissant-validator conformance is a nice-to-have, not a gate.
- **Licensing:** confirmed — CC BY 4.0 compilation + PD historical + upstream-rights modern. Getting this right matters for the corpus's reputation; the layered statement in DATACARD §Distribution must stay accurate.
- **sha256 in croissant/release:** computed at release time from the actual asset; if the data changes, the version must bump and the hash regenerate (release.sh does this).
- **Release asset size:** corpus.json/xml are a few MB each; the zip is well within GitHub's release-asset limits.
