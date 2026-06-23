# Ukrainian Proverbs Corpus — Expansion 3b (full Bobkova via tesseract) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** OCR the full Bobkova book with tesseract, clean it **deterministically** (rule segmentation + dictionary spell-check, zero LLM tokens), LLM-fix only the flagged residuals, replace `data/sources/bobkova.csv` with the full book, and re-ingest via the SP3a pattern (enrichment preserved; only net-new categorized).

**Architecture:** 3 small TDD modules (`expand/segment.py`, `expand/spellcheck.py`, `expand/consolidate_pages.py`). OCR (pdftoppm+tesseract), the LLM verify-residuals pass, and re-ingest are controller-run, reusing SP3a's `adapters/bobkova.py`, `build.py` hook, and `expand/reattach.py` unchanged.

**Tech Stack:** pdftoppm + tesseract-ocr(ukr) + hunspell-uk; Python 3 (pandas, rapidfuzz, pytest); Workflow tool (haiku) for verify-residuals + net-new categorize.

**Spec:** `docs/superpowers/specs/2026-06-23-ukr-proverbs-expansion-bobkova-full.md`

## Global Constraints

- Python 3.10+; deps limited to pandas, rapidfuzz, pytest (stdlib csv/re/glob/os fine). Use `.venv/bin/python`.
- Cleanup is **token-free** (tesseract + rules + dictionary). The LLM touches only dictionary-flagged residuals and net-new categorization (haiku).
- `data/sources/bobkova.csv` (`ref,text`) is REPLACED with the full book; `ref` = PDF page number; cleaned text is the source `text`.
- Re-ingest reuses SP3a: enriched 10-col order `id, text, normalized_text, modern_text, keyword, explanation, category, sources, source_refs, variant_group`; enrichment preserved by re-attaching on `normalized_text`; `modern_text` = text for Bobkova; variant tuning `recompute_variant_groups(rows, 85, 8)`.
- Verbatim `text` never mutated by normalization; Bobkova entries carry `Annotation(source="Bobkova", ref=page)`.
- Commits use local identity `MurzikVasilyevich <vasilyevichmurzik@gmail.com>`; append the session footer (Co-Authored-By + Claude-Session). Branch `feat/expand-bobkova-full`.
- Push: `origin` (public) needs `gh auth switch --user MurzikVasilyevich` then HTTPS; `dmytro` (private) is SSH.
- **Task types:** `[IMPL]` = TDD implementer subagent. `[CONTROLLER-RUN]` = executed by the controller (OCR/Workflow); not dispatched to an implementer.

---

### Task 1 [IMPL]: expand/segment.py — rule-based page segmentation

**Files:**
- Create: `expand/segment.py`
- Create: `tests/test_expand_segment.py`

**Interfaces:**
- Produces: `segment_page(raw_text: str) -> list[str]` — split one page's raw OCR text into proverbs.
  A line is a **boundary** (separates/drops) if blank, pure digits (page number), has fewer than 4
  Cyrillic letters (separator junk like «ж»/«»»/«.о»), or is an ALL-CAPS header (every Cyrillic letter
  uppercase). Consecutive non-boundary (content) lines are joined with a space into one proverb;
  whitespace collapsed; leading/trailing standalone digit tokens stripped. Returns non-empty proverbs.

- [ ] **Step 1: Write the failing test** — `tests/test_expand_segment.py`:
```python
from expand.segment import segment_page

RAW = """Горе не задавить, а з ніг звалить.
ж
Іржа їсть залізо, а горе -- серце.
.о
ТЯЖКЕ СОЦІАЛЬНЕ СТАНОВИЩЕ
Лихо не по дереву ходить,
а по людях.
25
"""


def test_segments_drops_junk_joins_wraps():
    out = segment_page(RAW)
    assert out == [
        "Горе не задавить, а з ніг звалить.",
        "Іржа їсть залізо, а горе -- серце.",
        "Лихо не по дереву ходить, а по людях.",
    ]


def test_empty_page():
    assert segment_page("\n\n12\nж\n") == []
```

- [ ] **Step 2: Run test, verify fail** — `.venv/bin/python -m pytest tests/test_expand_segment.py -v` → FAIL (ModuleNotFoundError).

- [ ] **Step 3: Implement** — `expand/segment.py`:
```python
from __future__ import annotations

import re

_CYR = re.compile(r"[а-яіїєґА-ЯІЇЄҐ]")


def _is_boundary(line: str) -> bool:
    s = line.strip()
    if not s or s.isdigit():
        return True
    letters = _CYR.findall(s)
    if len(letters) < 4:
        return True
    if all(c.isupper() for c in letters):
        return True
    return False


def _finish(buf: list[str]) -> str:
    text = re.sub(r"\s+", " ", " ".join(buf)).strip()
    text = re.sub(r"^\d+\s+", "", text)
    text = re.sub(r"\s+\d+$", "", text)
    return text.strip()


def segment_page(raw_text: str) -> list[str]:
    proverbs: list[str] = []
    buf: list[str] = []
    for line in raw_text.split("\n"):
        if _is_boundary(line):
            if buf:
                proverbs.append(_finish(buf))
                buf = []
        else:
            buf.append(line.strip())
    if buf:
        proverbs.append(_finish(buf))
    return [p for p in proverbs if p]
```

- [ ] **Step 4: Run test, verify pass** — PASS (2 passed).

- [ ] **Step 5: Commit**
```bash
git add expand/segment.py tests/test_expand_segment.py
git commit -m "feat(expand): rule-based OCR page segmentation"
```

---

### Task 2 [IMPL]: expand/spellcheck.py — vocab + flagging

**Files:**
- Create: `expand/spellcheck.py`
- Create: `tests/fixtures/spellcheck_corpus.csv`
- Create: `tests/test_expand_spellcheck.py`

**Interfaces:**
- Produces:
  - `tokens(text: str) -> list[str]` — lowercased Cyrillic word tokens (`[а-яіїєґ'’]+`), each stripped of edge apostrophes.
  - `load_vocab(corpus_path: str, hunspell_path: str | None = None) -> set[str]` — word set from the corpus `text` column plus, if `hunspell_path` exists, the hunspell `.dic` stems (token before `/`, Cyrillic only).
  - `flag_unknown(text: str, vocab: set[str]) -> list[str]` — tokens not in `vocab`.
  - `is_clean(text: str, vocab: set[str]) -> bool` — `flag_unknown(...)` is empty.

- [ ] **Step 1: Create fixture** — `tests/fixtures/spellcheck_corpus.csv`:
```csv
id,text
p1,Горе не задавить
p2,"Іржа їсть залізо"
```

- [ ] **Step 2: Write the failing test** — `tests/test_expand_spellcheck.py`:
```python
from expand.spellcheck import tokens, load_vocab, flag_unknown, is_clean


def test_tokens():
    assert tokens("Горе, не задавить!") == ["горе", "не", "задавить"]


def test_vocab_and_flagging():
    v = load_vocab("tests/fixtures/spellcheck_corpus.csv")
    assert "горе" in v and "залізо" in v
    assert is_clean("Горе не задавить", v)
    # a fabricated OCR-mangled non-word is flagged
    assert flag_unknown("Горе ззазавить", v) == ["ззазавить"]
    assert not is_clean("Горе ззазавить", v)
```

- [ ] **Step 3: Run test, verify fail** — FAIL (ModuleNotFoundError).

- [ ] **Step 4: Implement** — `expand/spellcheck.py`:
```python
from __future__ import annotations

import csv
import os
import re

_WORD = re.compile(r"[а-яіїєґ'’]+")
_CYR_WORD = re.compile(r"^[а-яіїєґ'’-]+$")


def tokens(text: str) -> list[str]:
    return [w.strip("'’") for w in _WORD.findall(text.lower()) if w.strip("'’")]


def load_vocab(corpus_path: str, hunspell_path: str | None = None) -> set[str]:
    vocab: set[str] = set()
    with open(corpus_path, encoding="utf-8") as f:
        for row in csv.DictReader(f):
            vocab.update(tokens(row.get("text", "")))
    if hunspell_path and os.path.exists(hunspell_path):
        with open(hunspell_path, encoding="utf-8", errors="ignore") as f:
            for line in f:
                word = line.split("/", 1)[0].strip().lower()
                if word and _CYR_WORD.match(word):
                    vocab.add(word.strip("'’"))
    return vocab


def flag_unknown(text: str, vocab: set[str]) -> list[str]:
    return [t for t in tokens(text) if t not in vocab]


def is_clean(text: str, vocab: set[str]) -> bool:
    return not flag_unknown(text, vocab)
```

- [ ] **Step 5: Run test, verify pass** — PASS (2 passed).

- [ ] **Step 6: Commit**
```bash
git add expand/spellcheck.py tests/fixtures/spellcheck_corpus.csv tests/test_expand_spellcheck.py
git commit -m "feat(expand): Ukrainian vocab + OCR spell-check flagging"
```

---

### Task 3 [IMPL]: expand/consolidate_pages.py — apply corrections

**Files:**
- Create: `expand/consolidate_pages.py`
- Create: `tests/test_expand_consolidate_pages.py`

**Interfaces:**
- Produces: `apply_corrections(proverbs: list[dict], corrections: dict[str, str]) -> list[dict]` —
  `proverbs` are `{"rid","ref","text"}` in order; `corrections` maps `rid -> corrected text` for the
  flagged subset. Returns new `{"ref","text"}` dicts in the same order, with `text` replaced by the
  correction where the `rid` is present, original otherwise. Raises `ValueError` if a `corrections`
  key is not among the proverbs' rids (coverage guard).

- [ ] **Step 1: Write the failing test** — `tests/test_expand_consolidate_pages.py`:
```python
import pytest
from expand.consolidate_pages import apply_corrections


def test_apply_corrections_replaces_and_preserves_order():
    proverbs = [
        {"rid": "r0", "ref": "025", "text": "Іржа їсть залізо"},
        {"rid": "r1", "ref": "025", "text": "Горе ззазавить"},
    ]
    out = apply_corrections(proverbs, {"r1": "Горе задавить"})
    assert out == [
        {"ref": "025", "text": "Іржа їсть залізо"},
        {"ref": "025", "text": "Горе задавить"},
    ]


def test_unknown_correction_rid_raises():
    proverbs = [{"rid": "r0", "ref": "1", "text": "x"}]
    with pytest.raises(ValueError):
        apply_corrections(proverbs, {"rZ": "y"})
```

- [ ] **Step 2: Run test, verify fail** — FAIL (ModuleNotFoundError).

- [ ] **Step 3: Implement** — `expand/consolidate_pages.py`:
```python
from __future__ import annotations


def apply_corrections(proverbs: list[dict], corrections: dict[str, str]) -> list[dict]:
    rids = {p["rid"] for p in proverbs}
    extra = set(corrections) - rids
    if extra:
        raise ValueError(f"corrections for unknown rids: {sorted(extra)[:5]}")
    out = []
    for p in proverbs:
        text = corrections.get(p["rid"], p["text"])
        out.append({"ref": p["ref"], "text": text})
    return out
```

- [ ] **Step 4: Run test, verify pass** — PASS (2 passed).

- [ ] **Step 5: Run full suite** — `.venv/bin/python -m pytest -q` → all pass.

- [ ] **Step 6: Commit**
```bash
git add expand/consolidate_pages.py tests/test_expand_consolidate_pages.py
git commit -m "feat(expand): apply OCR corrections, preserve order"
```

---

### Task 4 [CONTROLLER-RUN]: OCR the full book (token-free)

Controller-run.

- [ ] **Step 1: Install hunspell-uk** non-interactively (the plain install hangs on a debconf dialog):
  `sudo -n DEBIAN_FRONTEND=noninteractive apt-get install -y hunspell-uk`. Confirm
  `/usr/share/hunspell/uk_UA.dic` exists (else fall back to corpus-only vocab — spec §10).
- [ ] **Step 2: Download PDF** from the Dropbox URL in the WIP `sources.csv` → `data/sources/bobkova.pdf`
  (the working copy at `/tmp/bobkova.pdf` may already exist; copy it).
- [ ] **Step 3: OCR pp.19–516**, page by page to bound disk: for each page `n`,
  `pdftoppm -f n -l n -r 300 -png data/sources/bobkova.pdf <tmp>/pg` then
  `tesseract <tmp>/pg-*.png stdout -l ukr` → write `expand/work/ocr/<n>.txt`; delete the PNG.
  (Color-profile `Syntax Warning`s from pdftoppm are harmless.)
- [ ] **Step 4: Sanity** — ~498 page text files; spot-check 3 against the rendered pages.

---

### Task 5 [CONTROLLER-RUN]: Segment + spell-check + LLM-verify → data/sources/bobkova.csv

Controller-run.

- [ ] **Step 1: Segment** every `expand/work/ocr/<n>.txt` via `segment_page`; assign each proverb a
  unique `rid` and `ref=<n>`. Build the ordered list `proverbs=[{rid,ref,text}]`.
- [ ] **Step 2: Flag** — `vocab = load_vocab("corpus.csv", "/usr/share/hunspell/uk_UA.dic")`; partition
  proverbs into clean (`is_clean`) and flagged (`flag_unknown` non-empty). Log the flag rate. If it is
  unexpectedly high (> ~40%), tighten the flag policy to only proverbs whose unknown tokens look like
  OCR damage (contain Latin chars, or length ≥ 12, or mixed case mid-word) before the LLM pass.
- [ ] **Step 3: LLM-verify residuals** — batch the flagged proverbs (size ~100) and run a haiku Workflow:
  each agent reads its batch (`rid,text`) and returns `{rid, text_fixed}` correcting OCR errors,
  preserving meaning, no modernization. File-based with the SP2/SP3a safeguards (coverage, repair,
  line-salvage). Build `corrections = {rid: text_fixed}` for the flagged set.
- [ ] **Step 4: Assemble** — `rows = apply_corrections(proverbs, corrections)`; write
  `data/sources/bobkova.csv` (`ref,text`), **replacing** the SP3a file. Drop any row whose text is empty.
- [ ] **Step 5: Audit** — sample ~30 rows (mix of clean + verified) for OCR quality; note in `expand/REPORT.md`.

---

### Task 6 [CONTROLLER-RUN]: Re-ingest (reuses SP3a) + export + report

Controller-run, identical to SP3a Task 6 with the larger `bobkova.csv`.

- [ ] **Step 1: Build expanded base** to a temp dir: `from build import build; build(sources_dir="data/sources", out_dir="/tmp/expand_base2")`.
- [ ] **Step 2: Reattach** — `attached, new_ids = reattach(read /tmp/expand_base2/corpus.csv, read current corpus.csv)`. Record net-new and merged counts.
- [ ] **Step 3: Categorize net-new** — haiku Workflow over `new_ids` reusing `enrich.prompts.pass_a_prompt` + taxonomy; drop-invalid-key normalization; fill `category`; `modern_text` already = text.
- [ ] **Step 4: Tune variants** — `recompute_variant_groups(attached, 85, 8)`.
- [ ] **Step 5: Export** — `write_enriched_csv(attached, "corpus.csv")`; `enrich_json(/tmp/expand_base2/corpus.json, {id:row})` → `write_json(..., "corpus.json")`.
- [ ] **Step 6: Hard checks** — `corpus.csv` 10 cols; row count = 35,865 + net-new; every `category` non-empty, keys ∈ taxonomy; every row has `modern_text`; `corpus.json` parses with same count.
- [ ] **Step 7: REPORT** — rewrite `expand/REPORT.md` for the full-book run: OCR pages, segmented count, % flagged / LLM-fixed, total Bobkova, merged-into-existing, net-new, new corpus total, variant groups, audit.
- [ ] **Step 8: Commit** (gitignore already has `expand/work/`; commit the vendored PDF):
```bash
git add corpus.csv corpus.json data/sources/bobkova.csv data/sources/bobkova.pdf expand/REPORT.md
git commit -m "feat(expand): full Bobkova via tesseract OCR (~4k proverbs)"
```

---

### Task 7 [IMPL]: README + full suite + finish

**Files:**
- Modify: `README.md`

- [ ] **Step 1:** Update `README.md`: update the **Bobkova** Sources line (now full book, ~N proverbs) and the stats block (new total, Bobkova count, variant groups) from `expand/REPORT.md`; note tesseract-OCR provenance.
- [ ] **Step 2:** Full suite — `.venv/bin/python -m pytest -q` → all pass.
- [ ] **Step 3: Commit & finish** (controller merges `feat/expand-bobkova-full` → main and pushes origin + dmytro via finishing-a-development-branch):
```bash
git add README.md
git commit -m "docs(expand): document full Bobkova (tesseract) + refreshed stats"
```

---

## Self-Review

**1. Spec coverage:**
- §1/§3 OCR via tesseract (no text layer) → Task 4. ✓
- §4a rule segmentation → Task 1; §4b dictionary spell-check/flag → Task 2; §4c LLM-verify residuals → Task 5 Step 3; §4d assemble/replace bobkova.csv → Task 3 + Task 5 Step 4. ✓
- §5 re-ingest (reattach, categorize net-new, variants, export) → Task 6. ✓
- §6 components (segment, spellcheck, consolidate_pages; reuse reattach/adapter/build) → Tasks 1–3, 6. ✓
- §7 testing → Tasks 1–3 TDD; re-ingest inherits SP3a tests; LLM audit Task 5/6. ✓
- §8 tech (pdftoppm/tesseract/hunspell; haiku) → Tasks 4–6. ✓
- §2 replace bobkova.csv → Task 5 Step 4. ✓

**2. Placeholder scan:** README "~N" in Task 7 is filled from `expand/REPORT.md` real counts. Flag-rate threshold (40%) and batch sizes are operational parameters with explicit fallback (Task 5 Step 2), not unfilled placeholders. Code steps contain complete code.

**3. Type consistency:** `segment_page(raw)->list[str]` (Task 1) feeds Task 5's proverb build; `load_vocab/flag_unknown/is_clean` (Task 2) used in Task 5 Step 2; `apply_corrections(proverbs, corrections)` (Task 3) used in Task 5 Step 4 — signatures match. `reattach`, `recompute_variant_groups(rows,85,8)`, `enrich.export.*`, `build` reused with their SP3a/SP2 signatures. `bobkova.csv` columns `ref,text` consistent with `adapters/bobkova.py`.

No issues found.
