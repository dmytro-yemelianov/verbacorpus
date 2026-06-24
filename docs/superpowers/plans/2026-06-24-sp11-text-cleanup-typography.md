# verba — SP11: Text cleanup + plain-canonical / pretty-display typography — Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scrub OCR leading-junk + homoglyphs from ~210 entries, canonicalize all corpus text to plain ASCII punctuation, render Ukrainian typography at display via a shared `prettify()`, and ship as **v1.0.1**.

**Architecture:** Pure Python `clean_text`/`to_plain` (`core/clean.py`) + a curated `corrections.csv` are applied **by id to the existing enriched `corpus.csv`/`corpus.json`** (so enrichment columns are preserved), via `expand/apply_cleanup.py`. `to_plain` is `normalized_text`-invariant, so dedup/enrichment are undisturbed. A pure TS `prettify()` (`app/src/shared/text.ts`) renders Ukrainian typography at display in the PWA, `/p/:id` pages, and cards.

**Tech Stack:** Python (pytest), TypeScript (vitest), the existing build/embed pipeline.

**Spec:** `docs/superpowers/specs/2026-06-24-sp11-leading-char-cleanup-design.md`

## Global Constraints

- **Canonical data = plain ASCII punctuation:** straight `"` quotes, ASCII `'` (U+0027) apostrophe, space-padded ` - ` for тире / unspaced `-` for дефіс, `...` for ellipsis. No `« » „ " " ’ – — …` in `corpus.csv`/`corpus.json`/`app/public/data`/exports.
- **Display = Ukrainian typography** via `prettify()` only: `"…"`→`«…»`, ` - `→` — `, `'`→`’`, `...`→`…`.
- **`normalized_text` invariance:** `to_plain` must satisfy `normalize(to_plain(t)) == normalize(t)` (it only touches punctuation that `core/normalize.py` already strips/folds) — this is what protects dedup + enrichment re-attach.
- **Letter-level fixes are applied by `id`** on the already-enriched `corpus.csv` (never re-running the enrichment pipeline), so `modern_text`/`category`/`explanation` are preserved.
- **Preserve:** archaic words/orthography and `Ѣ` entries; balanced quotes (don't strip a leading `«`/`„`/`"`); word-internal hyphens (`будь-що`).
- `clean_text`/`to_plain`/`prettify` are **idempotent**. The cleanup operates on the committed `corpus.csv`/`corpus.json` (not a from-scratch rebuild).
- Ship **v1.0.1** (VERSION + CHANGELOG + CITATION.cff + croissant.json); deploy; cut the release. Commit identity MurzikVasilyevich; session footer. Branch `feat/text-cleanup`. Deploy + release are **outward — confirm with user**.
- **Task types:** `[IMPL]` TDD · `[CONTROLLER-RUN]` controller (LLM corrections, data regen, re-embed, deploy, release).

---

### Task 1 [IMPL]: `core/clean.py` — `clean_text` + `to_plain`

**Files:** Create `core/clean.py`, `tests/test_clean.py`.

**Interfaces — Produces:** `clean_text(text: str) -> str` (leading-junk strip + recapitalize); `to_plain(text: str) -> str` (ASCII punctuation canonicalization).

- [ ] **Step 1: Write the failing test** — `tests/test_clean.py`:
```python
from core.clean import clean_text, to_plain
from core.normalize import normalize

def test_clean_text_strips_leading_junk_and_recaps():
    assert clean_text("' По парі пізнати, чим серце кипить.") == "По парі пізнати, чим серце кипить."
    assert clean_text("1 старі люде всього не знают.") == "Старі люде всього не знают."
    assert clean_text("(1 граб, і дуб.") == "Граб, і дуб."
    assert clean_text("| Якесь там.") == "Якесь там."

def test_clean_text_preserves_quotes_archaic_and_clean():
    assert clean_text("«А ви з віхті?» – «А здуло би ті!»") == "«А ви з віхті?» – «А здуло би ті!»"
    assert clean_text("Ѣсти хоче.") == "Ѣсти хоче."
    assert clean_text("Без труда нема плода.") == "Без труда нема плода."
    assert clean_text(clean_text("' По парі.")) == clean_text("' По парі.")  # idempotent

def test_to_plain_canonicalizes_punct():
    assert to_plain("«А?» — «Б!»") == '"А?" - "Б!"'
    assert to_plain('„цитата"') == '"цитата"'
    assert to_plain("нап’є") == "нап'є"        # U+2019 -> U+0027
    assert to_plain("будь-що") == "будь-що"          # word hyphen unchanged
    assert to_plain("ой…") == "ой..."
    assert to_plain(to_plain("«А?» — «Б!»")) == to_plain("«А?» — «Б!»")  # idempotent

def test_to_plain_is_normalized_text_invariant():
    for s in ["«А?» — «Б!»", "нап’є", "Не плюй у криницю — згодиться.", "„цит“"]:
        assert normalize(to_plain(s)) == normalize(s)
```

- [ ] **Step 2: Run, verify fail** — `.venv/bin/python -m pytest tests/test_clean.py -q` → FAIL (no module).

- [ ] **Step 3: Implement** — `core/clean.py`:
```python
from __future__ import annotations
import re
import unicodedata

_LIST_NUM = re.compile(r"^\(?\d+[.)]?\s+")          # "1 ", "1. ", "(1) ", "(1 "
_LEAD_JUNK = re.compile(r"^[\s|.:,!/'()]+")          # stray leading punct/space (NOT « „ " or letters)
_LOWER_UA = re.compile(r"[а-яіїєґ]")
_QUOTES = {"«": '"', "»": '"', "„": '"', "“": '"', "”": '"', "‹": '"', "›": '"'}
_APOS = "’ʼ`´‘"                        # ’ ʼ ` ´ ‘  -> '
_WS = re.compile(r"\s+")

def clean_text(text: str) -> str:
    t = _LIST_NUM.sub("", text, count=1)
    t = _LEAD_JUNK.sub("", t).strip()
    if t and _LOWER_UA.match(t[0]):
        t = t[0].upper() + t[1:]
    return t

def to_plain(text: str) -> str:
    t = unicodedata.normalize("NFC", text)
    for q, a in _QUOTES.items():
        t = t.replace(q, a)
    for ch in _APOS:
        t = t.replace(ch, "'")
    t = t.replace("…", "...")
    t = t.replace("—", "-").replace("–", "-")        # em/en dash -> hyphen; spacing kept distinguishes тире/дефіс
    t = _WS.sub(" ", t).strip()
    return t
```

- [ ] **Step 4: Run, verify pass** — `.venv/bin/python -m pytest tests/test_clean.py -q` → PASS.

- [ ] **Step 5: Commit**
```bash
git add core/clean.py tests/test_clean.py
git commit -m "feat(cleanup): clean_text (leading-junk) + to_plain (ASCII canonicalization)"
```

---

### Task 2 [IMPL]: `prettify()` display layer + wiring

**Files:** Create `app/src/shared/text.ts`, `app/test/text.test.ts`; Modify `app/src/client/main.ts`, `app/src/shared/meta.ts`, `app/src/card.ts`.

**Interfaces — Produces:** `prettify(text: string): string` — renders plain-ASCII canonical text as Ukrainian typography.

- [ ] **Step 1: Write the failing test** — `app/test/text.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { prettify } from "../src/shared/text";

describe("prettify", () => {
  it("straight quotes → « »", () => expect(prettify('"А?" - "Б!"')).toBe("«А?» — «Б!»"));
  it("apostrophe → typographic", () => expect(prettify("нап'є")).toBe("нап’є"));
  it("ellipsis → …", () => expect(prettify("ой...")).toBe("ой…"));
  it("word hyphen untouched", () => expect(prettify("будь-що")).toBe("будь-що"));
  it("idempotent on already-pretty", () => expect(prettify("«А» — «Б»")).toBe("«А» — «Б»"));
});
```

- [ ] **Step 2: Run, verify fail** — from `app/`: `npx vitest run test/text.test.ts` → FAIL.

- [ ] **Step 3: Implement** — `app/src/shared/text.ts`:
```typescript
// Render plain-ASCII canonical corpus text as Ukrainian typography (display only).
export function prettify(text: string): string {
  let t = text.replace(/\.\.\./g, "…");          // ... → …
  t = t.replace(/ - /g, " — ");                  // space-padded hyphen (тире) → em-dash
  let open = false;
  t = t.replace(/"/g, () => { open = !open; return open ? "«" : "»"; }); // " → « »
  t = t.replace(/'/g, "’");                       // ' → ’
  return t;
}
```

- [ ] **Step 4: Run, verify pass** — `npx vitest run test/text.test.ts` → PASS.

- [ ] **Step 5: Wire prettify into the render paths** — import `prettify` and apply it to proverb `text`/`modern_text` wherever they are shown (never to ids/categories/sources):
  - `app/src/client/main.ts`: `import { prettify } from "../shared/text";`. In `renderPage` entries (`esc(p.text)`→`esc(prettify(p.text))`, `esc(p.modern_text)`→`esc(prettify(p.modern_text))`), in `renderHero`, in `openDetail` (`detail-text`, `detail-modern`, variants `v.text`, similar `s.text`), in `renderSwipeCard` (`sw-text`, `sw-modern`). (Leave `entry-tags`, sources, categories, ids untouched.)
  - `app/src/shared/meta.ts`: in `buildProverbPage`, wrap the displayed `p.text`/`p.modern_text` in the body + the `<title>`/`og:*` with `prettify(...)` before `escapeHtml` (so the page + its OG meta show Ukrainian typography). In `cardModel`, prettify `text` and `modern` before returning (the card renders them).
  - `app/src/card.ts`: no change if `cardModel` already prettifies; otherwise prettify there.
  - Import path inside `meta.ts`/`card.ts` is `./text` / `./shared/text` as appropriate.

- [ ] **Step 6: Build + verify** — from `app/`: `node build.mjs` → "Built public/app.js"; `npx vitest run` → all green (text.test + existing).

- [ ] **Step 7: Commit**
```bash
git add app/src/shared/text.ts app/test/text.test.ts app/src/client/main.ts app/src/shared/meta.ts app/src/card.ts
git commit -m "feat(cleanup): prettify() display typography in PWA + /p/:id + cards"
```

---

### Task 3 [IMPL]: `expand/scan_leading.py` — classifier + report

**Files:** Create `expand/scan_leading.py`, `tests/test_scan_leading.py`.

**Interfaces — Produces:** `classify(text: str) -> str` (one of `"upper"`, `"quote"`, `"yat"`, `"lower"`, `"latin"`, `"digit"`, `"punct"`, `"empty"`); `scan(rows: list[dict]) -> dict[str, list[dict]]` grouping rows by class; a `main()` that prints counts for a corpus.csv path.

- [ ] **Step 1: Write the failing test** — `tests/test_scan_leading.py`:
```python
from expand.scan_leading import classify
def test_classify():
    assert classify("Без труда.") == "upper"
    assert classify("«А ви з віхті?»") == "quote"
    assert classify('"А?"') == "quote"
    assert classify("Ѣсти.") == "yat"
    assert classify("старі люде.") == "lower"
    assert classify("Tото має.") == "latin"      # leading Latin T
    assert classify("1 старі.") == "digit"
    assert classify("| якесь.") == "punct"
    assert classify("") == "empty"
```

- [ ] **Step 2: Run, verify fail** — `.venv/bin/python -m pytest tests/test_scan_leading.py -q` → FAIL.

- [ ] **Step 3: Implement** — `expand/scan_leading.py`:
```python
from __future__ import annotations
import csv, re, sys, collections

def classify(text: str) -> str:
    t = text.strip()
    if not t:
        return "empty"
    c = t[0]
    if c in "Ѣѣ":
        return "yat"
    if re.match(r"[А-ЯІЇЄҐ]", c):
        return "upper"
    if re.match(r"[а-яіїєґ]", c):
        return "lower"
    if c in '«»"„“”':
        return "quote"
    if c.isdigit():
        return "digit"
    if re.match(r"[A-Za-zͰ-Ͽ]", c):     # Latin or Greek
        return "latin"
    return "punct"

def scan(rows: list[dict]) -> dict[str, list[dict]]:
    out: dict[str, list[dict]] = collections.defaultdict(list)
    for r in rows:
        out[classify(r["text"])].append(r)
    return out

def main() -> None:
    path = sys.argv[1] if len(sys.argv) > 1 else "corpus.csv"
    rows = list(csv.DictReader(open(path, encoding="utf-8")))
    groups = scan(rows)
    for k in sorted(groups, key=lambda k: -len(groups[k])):
        print(f"{k}: {len(groups[k])}")

if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run, verify pass** — `.venv/bin/python -m pytest tests/test_scan_leading.py -q` → PASS; then `.venv/bin/python -m expand.scan_leading corpus.csv` prints the class counts.

- [ ] **Step 5: Commit**
```bash
git add expand/scan_leading.py tests/test_scan_leading.py
git commit -m "feat(cleanup): scan_leading classifier + report"
```

---

### Task 4 [IMPL]: `expand/apply_cleanup.py` — transform corpus.csv + corpus.json by id

**Files:** Create `expand/apply_cleanup.py`, `tests/test_apply_cleanup.py`.

**Interfaces:** Consumes `clean_text`/`to_plain` (Task 1), `normalize` (`core/normalize`). Produces `apply_row(row: dict, corrections: dict[str, dict]) -> dict` (returns the row with corrected `text`/`modern_text`/`normalized_text`) and `apply_csv(in_path, out_path, corrections_path)`.

- [ ] **Step 1: Write the failing test** — `tests/test_apply_cleanup.py`:
```python
from expand.apply_cleanup import apply_row
from core.normalize import normalize

BASE = {"id": "p000001", "text": "' По парі пізнати.", "normalized_text": "old",
        "modern_text": "' По парі пізнати.", "category": "wisdom_folly", "explanation": "нота"}

def test_apply_row_cleans_recomputes_and_preserves_enrichment():
    out = apply_row(dict(BASE), {})
    assert out["text"] == "По парі пізнати."                 # leading junk stripped
    assert out["modern_text"] == "По парі пізнати."
    assert out["normalized_text"] == normalize(out["text"])  # recomputed
    assert out["category"] == "wisdom_folly"                 # enrichment preserved
    assert out["explanation"] == "нота"

def test_apply_row_canonicalizes_punct_to_ascii():
    out = apply_row({"id": "p2", "text": "«А?» — «Б!»", "normalized_text": "x", "modern_text": "«А?» — «Б!»"}, {})
    assert out["text"] == '"А?" - "Б!"'

def test_corrections_override_by_id():
    out = apply_row(dict(BASE), {"p000001": {"text": "Тото має добрий ґуст.", "modern_text": ""}})
    assert out["text"] == "Тото має добрий ґуст."            # homoglyph repair from corrections.csv (then to_plain)
```

- [ ] **Step 2: Run, verify fail** — `.venv/bin/python -m pytest tests/test_apply_cleanup.py -q` → FAIL.

- [ ] **Step 3: Implement** — `expand/apply_cleanup.py`:
```python
from __future__ import annotations
import csv, json, collections
from core.clean import clean_text, to_plain
from core.normalize import normalize

def apply_row(row: dict, corrections: dict[str, dict]) -> dict:
    r = dict(row)
    corr = corrections.get(r.get("id", ""))
    # 1. curated correction (homoglyph/judgment) overrides text; else deterministic clean_text
    text = corr["text"] if corr and corr.get("text") else clean_text(r.get("text", ""))
    text = to_plain(text)                                 # 2. ASCII canonicalize
    r["text"] = text
    # modern_text: curated override if given, else clean+plain the existing modern (fallback to text)
    modern_src = corr["modern_text"] if corr and corr.get("modern_text") else r.get("modern_text", "")
    r["modern_text"] = to_plain(clean_text(modern_src)) if modern_src else text
    r["normalized_text"] = normalize(text)                # 3. recompute key
    return r

def load_corrections(path: str) -> dict[str, dict]:
    try:
        return {x["id"]: x for x in csv.DictReader(open(path, encoding="utf-8"))}
    except FileNotFoundError:
        return {}

def apply_csv(in_path: str, out_path: str, corrections_path: str = "corrections.csv") -> dict:
    corrections = load_corrections(corrections_path)
    rows = list(csv.DictReader(open(in_path, encoding="utf-8")))
    fields = rows[0].keys() if rows else []
    out = [apply_row(r, corrections) for r in rows]
    # dup-check: new exact-duplicate normalized_text
    seen = collections.Counter(r["normalized_text"] for r in out)
    dups = [n for n, c in seen.items() if c > 1]
    with open(out_path, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(fields)); w.writeheader(); w.writerows(out)
    return {"rows": len(out), "dup_norm_keys": len(dups)}
```
  (For `corpus.json`, the controller (Task 5) applies the same `clean_text`/`to_plain`/corrections to its text fields by id — see Task 5; the JSON shape differs so it is handled there with a small inline transform rather than this CSV writer.)

- [ ] **Step 4: Run, verify pass** — `.venv/bin/python -m pytest tests/test_apply_cleanup.py -q` → PASS.

- [ ] **Step 5: Commit**
```bash
git add expand/apply_cleanup.py tests/test_apply_cleanup.py
git commit -m "feat(cleanup): apply_cleanup — clean+correct+plain by id, recompute normalized_text, preserve enrichment"
```

---

### Task 5 [CONTROLLER-RUN]: corrections, regen, re-embed, v1.0.1, deploy, release

Controller-run (LLM judgment + outward actions). Deploy + release **confirm with user**.

- [ ] **Step 1: Generate `corrections.csv`** — run `scan_leading.py` to list the judgment/homoglyph entries (lower/latin/digit/punct classes minus the deterministic-only ones). Dispatch a batched LLM pass (subagents or Workflow, like the original enrichment) over those ~210 entries: for each, propose corrected `text` (+ `modern_text` if it changes) — repair OCR confusables to Cyrillic, fix case/leading errors, **preserve archaic words**, omit if unsure. Write `corrections.csv` (`id,text,modern_text,reason`). **Review a sample** for over-correction before proceeding.
- [ ] **Step 2: Apply to corpus.csv** — `.venv/bin/python -m expand.apply_cleanup corpus.csv corpus.csv` (in place); note the dup-check count. Apply the same `clean_text`/`to_plain`/corrections (by id) to `corpus.json`'s text fields with a short script. Spot-check `p000001` → `По парі пізнати…` and a dialogue entry → `"…" - "…"` (plain).
- [ ] **Step 2b: Post-cleanup assertions** — re-run `scan_leading.py corpus.csv` → only `quote` (≈455) + `yat` (9) remain non-`upper`; assert no `« » „ " " ’ – — …` chars remain in `text`/`modern_text` (grep); assert **every row that had a `category` still has one** (enrichment-preservation guard) and the row count is unchanged (or note merges).
- [ ] **Step 3: Regenerate app data** — from `app/`: `.venv/bin/python build_data.py ../corpus.csv ../enrich/taxonomy.csv ../sources.csv public/data ../corpus.xml` → refreshes `proverbs.json`/`explanations.json`/`meta.json`/`corpus.xml` (all plain-ASCII). `node build.mjs`.
- [ ] **Step 4: Re-embed** — `CLOUDFLARE_ACCOUNT_ID=<acct> .venv/bin/python -m embed.run` (incremental; the corpus-wide text change re-embeds most entries — a one-time, semantically-neutral pass; acceptable on the paid plan). Confirm it completes.
- [ ] **Step 5: Bump v1.0.1** — `VERSION`→`1.0.1`; `CHANGELOG.md` `## [1.0.1]` (leading-junk + homoglyph fixes count, ASCII canonicalization, display typography); `CITATION.cff` + `croissant.json` version → 1.0.1. Rebuild app data so `meta.json.version` = 1.0.1.
- [ ] **Step 6: Preview + verify** (then deploy, confirm with user) — `npx wrangler versions upload`; verify on preview: `/p/p000001` reads `По парі пізнати…`; a dialogue `/p/:id` + card render `«…» — «…»` with `’` (fetch the card PNG + read it); `/api/v1/export` + the release CSV are plain ASCII `" ' -`. Then `npx wrangler deploy`.
- [ ] **Step 7: Release v1.0.1** (confirm with user) — `scripts/release.sh --publish`. Merge `feat/text-cleanup` → main, push both remotes, update memory.

---

## Self-Review

**1. Spec coverage:** §1 letter-level fixes → Tasks 1 (`clean_text`), 4 (`apply_cleanup` + corrections), 5 (LLM corrections). §2A by-id post-attach enrichment-safety → Task 4 (`apply_row` recomputes normalized_text, preserves columns) + its test. §2B `to_plain` corpus-wide + normalized_text-invariant → Task 1 (`to_plain` + the invariant test). §2C `prettify` display → Task 2 (+ wiring into PWA/`/p`/cards). §3 curated corrections (LLM + review) → Task 5 Step 1. §4 v1.0.1 ship (rebuild + re-embed + release) → Task 5. §5 components → Tasks 1–4. §6 testing (clean_text/to_plain/prettify/apply_cleanup units + invariant + enrichment guard + post-build scan) → Tasks 1–4 + Task 5 Step 2b. §7 risks (enrichment loss, ASCII round-trip, re-embed scope) → Task 4 + Task 5 notes.

**2. Placeholder scan:** complete code for `clean_text`/`to_plain`/`prettify`/`classify`/`apply_row`/`apply_csv` + tests. The LLM corrections pass + corpus.json transform + data regen + re-embed are controller-run orchestration steps with concrete commands (Task 5), not code stubs. No TBD/vague-error-handling (storage/missing-file handled via `load_corrections` try/except).

**3. Type/name consistency:** `clean_text`/`to_plain` defined in Task 1, used in Task 4. `prettify` defined in Task 2, used in its own wiring. `classify`/`scan` in Task 3, used in Task 5. `apply_row(row, corrections)`/`apply_csv(in,out,corrections)` in Task 4, invoked in Task 5. The `normalize(to_plain(t)) == normalize(t)` invariant (Task 1 test) is the contract Task 4 relies on to preserve enrichment.

**Note (Task 2 wiring):** apply `prettify` ONLY to `text`/`modern_text` display, never to ids/category keys/source keys; the `og:image`/`og:url` URLs use `p.id` (not prettified). **Note (Task 5):** the re-embed is a one-time fuller pass because the corpus-wide punctuation change alters `compose_embed_text`; semantically neutral, acceptable — do not try to suppress it.
