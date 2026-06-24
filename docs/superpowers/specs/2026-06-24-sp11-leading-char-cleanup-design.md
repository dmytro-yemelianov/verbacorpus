# verba — SP11: Leading-character & homoglyph cleanup → v1.0.1

**Date:** 2026-06-24
**Status:** Approved (design)
**Sub-project:** 11 — scrub OCR leading-junk + mixed-script homoglyphs + normalize dialogue typography (Ukrainian quote/dash styling) in `text`; ship as corpus **v1.0.1**
**Repo:** `verbacorpus`; build pipeline + `app/`
**Depends on:** the live corpus v1.0.0 + the build pipeline (`build.py` → base records; `expand/reattach.py` attaches enrichment by `normalized_text`; `embed/run.py` incremental embeddings; SP10 versioning/release).

---

## 1. Problem & scope

48,787 entries; 686 (~1.4%) do not start with an uppercase Ukrainian letter. Measured breakdown:

| class | count | verdict |
|---|---|---|
| `«` `"` `„` quoted **dialogue** proverbs | ~455 | **normalize typography** → « » / „ " quotes + «—» тире; words/orthography preserved |
| `Ѣ` (archaic yat) words | 9 | **preserve** (real orthography) |

Measured dialogue styling (to normalize): inter-turn separator is en-dash `–` (491), em-dash `—` (21), hyphen `-` (15) → all should be the Ukrainian тире **em-dash `—`**; opening glyph is `«` (373), straight `"` (62), low `„` (20) → primary quotes should be **« »** (`„ "` reserved for nested). These entries still *start* with `«` after normalization (correct — that's the Ukrainian opening quote), so they remain in the "preserve the leading char" set; only the internal punctuation glyphs/spacing change.
| leading `\|` | 22 | OCR junk → strip |
| stray leading `.` `:` `,` `!` `/` `'` `(` and list-numbers (`(1`, `1 `, `1.`) + 1 digit | ~46 | OCR junk → strip + recapitalize |
| Latin/Greek homoglyphs (`Τοτο`→`Тото`, leading `P`/`H`/`C`… → Cyrillic) | ~70 | mixed-script OCR → repair (word-wide) |
| lowercase start | 74 | case error or fragment → judge |
| leading `-`/`—` | 30 | dialogue dash vs junk → judge |

**Root cause:** the pipeline's `isPresentable` check only kept fragments out of the hero/swipe/daily *display*; it never scrubbed the `text` field. The fidelity rule (preserve archaic orthography) was over-applied to OCR punctuation, which is not orthography. `p000001` = `' По парі пізнати…` is the canonical first entry, so this is highly visible.

**In scope:** ~210 genuine leading-junk/homoglyph/judgment defects **plus** the ~455 quoted-dialogue proverbs (typographic normalization to Ukrainian quote/dash styling — words preserved). **Out of scope:** the 9 `Ѣ` archaic-letter entries (untouched); a full corpus-wide mixed-script audit beyond the flagged entries (separate future work); converting inline dialogue into multi-line «—»-prefixed direct speech (we keep the one-line proverb form, only fixing glyphs/spacing); changing the schema.

## 2. Architecture — corrections as a reproducible, auditable build layer

Corrections are NOT hand-edits to `corpus.csv` (lost on rebuild) nor edits to `data/sources/*.csv` (muddies provenance). Two mechanisms, both applied during the build:

1. **`clean_text(text) -> text`** (NEW, `core/clean.py`, deterministic, unit-tested): strips the *unambiguous* leading garbage and recapitalizes the new first letter. Rules:
   - Strip a leading run of `| . : , ! / ( ' " ”` **only when** it is stray (e.g. a lone leading `'`/`(`/`|` not opening a balanced quote); strip leading list-number patterns `^\(?\d+[.)]?\s+`.
   - **Never** strip a leading `«`/`„`/`"` that opens a balanced quoted span (dialogue); **never** alter `Ѣ` or any letter.
   - After stripping, if the new first character is a lowercase Ukrainian letter, uppercase it.
   - Idempotent; a clean uppercase-Ukrainian-starting text is returned unchanged.
   This bakes into the pipeline (applied in `build.py`/export to every record's `text`) so **future** source ingestions are cleaned too.

1b. **`normalize_punct(text) -> text`** (NEW, in `core/clean.py`, deterministic, unit-tested): normalizes punctuation to Ukrainian styling, glyphs only — never words:
   - **Dialogue тире:** an en-dash/hyphen acting as a turn separator — i.e. between a closing and opening quote, pattern `([»"”])\s*[–-]\s*([«"„])` — becomes `» — «` (em-dash `—` U+2014, single space each side). Only inter-turn dashes are touched; a hyphen inside a word (`будь-що`, `по-нашому`) or a grammatical dash not between quotes is left alone.
   - **Primary quotes:** outer straight `"…"` and low-high `„…"` quote spans become `«…»` when the quotes are balanced (alternate open/close across the string). Nested quotes (a quote inside a quote) use `„ "`.
   - Collapse doubled spaces introduced by the above; trim.
   Unbalanced/irregular cases (odd quote counts, stray period outside a quote like `«…».»`, mixed nesting) are NOT guessed here — they are flagged for the curated `corrections.csv` pass.

2. **`corrections.csv`** (NEW, repo root: `id, text, modern_text, reason`): a curated override file for the *judgment* cases a rule cannot safely decide — Latin/Greek homoglyph repair (word-wide for the flagged entries), lowercase→uppercase that isn't a clean leading-strip, dash cases. Generated by an LLM pass over ONLY the ~210 flagged entries (the deterministic ones can be left to `clean_text`; the file carries the rest), then **spot-reviewed** (reputation). Each row is one auditable before→after with a short `reason`.

**Application order (critical for not losing enrichment):** the enrichment (`modern_text`/`category`/`explanation`) is attached by `normalized_text` (`expand/reattach.py`). Changing `text` changes `normalize(text)`, which would break that match. Therefore corrections are applied **keyed by `id`, AFTER enrichment is attached**, as a final step (`expand/apply_corrections.py`): for each affected `id`, set the corrected `text`, recompute `normalized_text = normalize(text)`, and set `modern_text` from `corrections.csv` when provided (else leave the existing enriched value). `clean_text` likewise runs post-attach by id. A final `merge_exact`-style check flags (and optionally merges) any new exact-duplicate a correction creates; if it can't safely merge, it logs the pair for review rather than silently leaving a dup.

## 3. Producing the curated corrections

- A script (`expand/scan_leading.py`) emits the flagged entries (id, text, first-char class) — the deterministic ones (handled by `clean_text`) and the judgment/homoglyph ones (need `corrections.csv`).
- An LLM pass (batched, like the original enrichment) reads each judgment/homoglyph entry **and each dialogue entry the deterministic `normalize_punct` couldn't fully resolve** (unbalanced quotes, stray punctuation), and proposes the corrected `text` (and `modern_text` if it changes), with the rule: repair OCR confusables to Cyrillic, fix obvious case/leading errors, **apply Ukrainian quote/dash styling** (« » primary, „ " nested, «—» тире) to dialogue, **preserve the archaic words/orthography**, and when unsure **leave unchanged** (omit the row). Output → `corrections.csv`.
- A reviewer (LLM or spot human) checks a sample for over-correction (no archaic form "modernized", no meaning changed).

## 4. Ship as v1.0.1

- Rebuild (`build.py` + reattach + apply_corrections) → corrected `corpus.csv`/`corpus.json`; rebuild `app/public/data/*`.
- **Re-embed** only the changed texts: `embed/run.py` is incremental (manifest by text) → only the ~210 corrected entries re-embed into Vectorize.
- Bump **VERSION → 1.0.1**, add a `## [1.0.1]` CHANGELOG entry (what was fixed + counts), bump `CITATION.cff` + `croissant.json` version.
- Deploy the Worker; cut the **v1.0.1** GitHub Release via `scripts/release.sh --publish`.

## 5. Components / files

- `core/clean.py` (NEW) — `clean_text()` (leading-junk + recapitalize) + `normalize_punct()` (Ukrainian quote/dash styling). [pytest]
- `expand/scan_leading.py` (NEW) — flag/report leading-char classes (also the verification scanner).
- `corrections.csv` (NEW, root) — curated id→correction overrides.
- `expand/apply_corrections.py` (NEW) — apply `clean_text` + `corrections.csv` by id post-attach, recompute `normalized_text`, dup-check. [pytest]
- `build.py` / the enrichment build path (MODIFY) — wire `clean_text` + `apply_corrections` as the final step; regenerate corpus.csv/json + `app/public/data`.
- `VERSION`, `CHANGELOG.md`, `CITATION.cff`, `croissant.json` (MODIFY) → 1.0.1.
- No app/UI code changes (the fixes flow through the data + meta).

## 6. Testing

- **pytest** `clean_text`: strips leading `|`/stray punct/list-numbers + recapitalizes; **leaves** `«…»`/`Ѣ…`/clean-uppercase unchanged; idempotent.
- **pytest** `normalize_punct`: `«А?» – «Б!»` → `«А?» — «Б!»` (en-dash→em-dash тире); `"А" - "Б"` → `«А» — «Б»` (straight→guillemet + em-dash); leaves `будь-що`/`по-нашому` (word hyphens) and a non-inter-turn grammatical dash untouched; idempotent; balanced-quote check (odd counts left for the curated pass).
- **pytest** `apply_corrections`: applies a correction by id, recomputes `normalized_text`, preserves the row's `category`/`explanation` (the enrichment-loss guard); a `corrections.csv` row with `modern_text` updates it.
- **Post-build assertions:** re-run `scan_leading.py` on the rebuilt corpus → the ONLY remaining non-uppercase-start entries are `«`-opening dialogue (≈455) + `Ѣ` (9); **no entry opens with a straight `"` or low `„`** (all primary quotes normalized to «); **no `»`-`«` turn boundary uses an en-dash/hyphen** (all тире are em-dash `—`). **Zero** entries lost `category`/`modern_text` vs before; total count unchanged (or reduced only by intentional merges, logged).
- **Audit:** review a sample of `corrections.csv` before→after for over-correction.
- **Manual (preview):** `/p/p000001` now reads `По парі пізнати…`; its `/card/p000001.png` renders without the stray `'`.

## 7. Risks / open items

- **Enrichment loss (the main risk):** mitigated by applying corrections **by `id` after** the `normalized_text`-keyed reattach, never before — with a test asserting no corrected entry lost its enrichment.
- **Over-correction damaging archaic forms / fidelity:** the LLM pass is instructed to preserve archaic orthography and omit uncertain rows; a review sample gates it. `clean_text` only touches leading non-letter junk, never letters.
- **New exact-duplicates after correction:** the dup-check step logs/merges; net count change is reported in the CHANGELOG, not silent.
- **`«`/`"` strip false-positives:** `clean_text` only strips a leading quote when it is unbalanced/stray; balanced dialogue quotes are preserved (verified by the post-build scan keeping ~455 quote entries).
- **Over-normalizing punctuation:** `normalize_punct` converts a dash to em-dash тире ONLY between a closing-and-opening quote boundary, and converts quote glyphs only when balanced — so word-internal hyphens (`будь-що`), grammatical dashes, and the archaic *words* are never altered; unbalanced/irregular cases defer to the reviewed `corrections.csv`. The change is glyph-only typography, explicitly requested as Ukrainian styling, not an orthography edit.
- **Re-embed scope:** incremental manifest re-embeds only changed texts; verify the manifest detects the ~210 changes (not a full re-embed).
