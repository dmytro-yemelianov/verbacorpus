# Ukrainian Proverbs Corpus — Canonical Corpus + Ingestion Pipeline — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ingest two clean upstream sources (Franko 1901; Mlodzynskyi 2009 / Ilkevich 1841) into one canonical, deduplicated, source-attributed Ukrainian proverbs corpus via an extensible Python adapter pipeline.

**Architecture:** Modular source-adapters (`adapters/*.py`) each map one raw source → a list of `CanonicalRecord`. A shared `core/` does normalization → exact merge → variant linking → finalize (sort + stable ids) → export. `build.py` orchestrates; `fetch.py` snapshots upstream inputs.

**Tech Stack:** Python 3, pandas, rapidfuzz, pytest.

**Spec:** `docs/superpowers/specs/2026-06-21-ukr-proverbs-corpus-design.md`

## Global Constraints

- Python 3.10+ (uses `list[str]` builtin generics and `X | None`).
- Dependencies limited to: `pandas`, `rapidfuzz`, `pytest`. No others without cause.
- `text` (the verbatim proverb) is **never mutated**. Normalization produces a separate `normalized_text` for matching only.
- Dialectal letters (і / ї / є / ґ) are preserved in both `text` and `normalized_text`.
- Output is **deterministic**: records sorted by `normalized_text` (ties broken by `text`); ids derived from that order; same inputs ⇒ byte-identical `corpus.csv`.
- Explanation precedence when a proverb has several: `Franko1901` first, then `Mlodzynskyi2009`, then `Ilkevich1841`, then any remaining alphabetically.
- Variant-link threshold: rapidfuzz `token_set_ratio` ≥ 85.
- TDD: write the failing test first, watch it fail, implement minimally, watch it pass, commit.
- Commits in this repo use the local git identity `MurzikVasilyevich <vasilyevichmurzik@gmail.com>` (already configured). Append the session's required commit-message footer (Co-Authored-By + Claude-Session lines) to every commit.

---

### Task 1: Project scaffolding + canonical schema

**Files:**
- Create: `requirements.txt`
- Create: `core/__init__.py` (empty)
- Create: `adapters/__init__.py` (empty)
- Create: `core/schema.py`
- Create: `tests/__init__.py` (empty)
- Create: `tests/test_schema.py`
- Create: `.gitignore`

**Interfaces:**
- Produces:
  - `Annotation(source: str, ref: str = "", explanation: str = "")` — dataclass.
  - `CanonicalRecord(text: str, normalized_text: str = "", keyword: str = "", annotations: list[Annotation] = [], category: str = "", variant_group: str = "", id: str = "")` — dataclass.
  - `CanonicalRecord.csv_explanation() -> str` — returns the highest-priority non-empty explanation (per Global Constraints precedence), else `""`.
  - `CanonicalRecord.sources() -> list[str]` — `[a.source for a in annotations]`.
  - `CanonicalRecord.source_refs() -> list[str]` — `[a.ref for a in annotations]`.
  - `SOURCE_PRIORITY: dict[str, int]` — `{"Franko1901": 0, "Mlodzynskyi2009": 1, "Ilkevich1841": 2}`.

- [ ] **Step 1: Write `requirements.txt` and `.gitignore`**

`requirements.txt`:
```
pandas
rapidfuzz
pytest
```

`.gitignore`:
```
__pycache__/
*.pyc
.pytest_cache/
data/sources/.cache/
```

- [ ] **Step 2: Create empty package markers**

Create empty files: `core/__init__.py`, `adapters/__init__.py`, `tests/__init__.py`.

- [ ] **Step 3: Write the failing test**

`tests/test_schema.py`:
```python
from core.schema import Annotation, CanonicalRecord


def test_sources_and_refs_derive_from_annotations():
    rec = CanonicalRecord(
        text="Аби болото, а жаби будуть",
        annotations=[
            Annotation(source="Mlodzynskyi2009", ref="6"),
            Annotation(source="Franko1901", ref="Б", explanation="пояснення"),
        ],
    )
    assert rec.sources() == ["Mlodzynskyi2009", "Franko1901"]
    assert rec.source_refs() == ["6", "Б"]


def test_csv_explanation_prefers_franko():
    rec = CanonicalRecord(
        text="x",
        annotations=[
            Annotation(source="Mlodzynskyi2009", explanation="млодз"),
            Annotation(source="Franko1901", explanation="франко"),
        ],
    )
    assert rec.csv_explanation() == "франко"


def test_csv_explanation_empty_when_none():
    rec = CanonicalRecord(text="x", annotations=[Annotation(source="Franko1901")])
    assert rec.csv_explanation() == ""
```

- [ ] **Step 4: Run test to verify it fails**

Run: `python -m pytest tests/test_schema.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'core.schema'`.

- [ ] **Step 5: Write minimal implementation**

`core/schema.py`:
```python
from __future__ import annotations

from dataclasses import dataclass, field

SOURCE_PRIORITY: dict[str, int] = {
    "Franko1901": 0,
    "Mlodzynskyi2009": 1,
    "Ilkevich1841": 2,
}


@dataclass
class Annotation:
    source: str
    ref: str = ""
    explanation: str = ""


@dataclass
class CanonicalRecord:
    text: str
    normalized_text: str = ""
    keyword: str = ""
    annotations: list[Annotation] = field(default_factory=list)
    category: str = ""
    variant_group: str = ""
    id: str = ""

    def sources(self) -> list[str]:
        return [a.source for a in self.annotations]

    def source_refs(self) -> list[str]:
        return [a.ref for a in self.annotations]

    def csv_explanation(self) -> str:
        with_expl = [a for a in self.annotations if a.explanation]
        if not with_expl:
            return ""
        with_expl.sort(key=lambda a: SOURCE_PRIORITY.get(a.source, 99))
        return with_expl[0].explanation
```

- [ ] **Step 6: Run test to verify it passes**

Run: `python -m pytest tests/test_schema.py -v`
Expected: PASS (3 passed).

- [ ] **Step 7: Commit**

```bash
git add requirements.txt .gitignore core adapters tests
git commit -m "feat: project scaffold + canonical schema"
```

---

### Task 2: Text normalization

**Files:**
- Create: `core/normalize.py`
- Create: `tests/test_normalize.py`

**Interfaces:**
- Consumes: nothing.
- Produces: `normalize(text: str) -> str` — NFC → lowercase → unify apostrophes → punctuation/dashes to spaces → collapse whitespace → trim. Preserves і/ї/є/ґ.

- [ ] **Step 1: Write the failing test**

`tests/test_normalize.py`:
```python
from core.normalize import normalize


def test_lowercases_and_trims():
    assert normalize("  Аби Болото  ") == "аби болото"


def test_unifies_apostrophes():
    # right-single-quote, modifier-letter-apostrophe, backtick → straight '
    assert normalize("прислів’я") == "прислів'я"
    assert normalize("прислівʼя") == "прислів'я"


def test_punctuation_and_dashes_become_spaces():
    assert normalize("Аби болото, а жаби — будуть!") == "аби болото а жаби будуть"


def test_collapses_internal_whitespace():
    assert normalize("як   є –   мине  ся") == "як є мине ся"


def test_preserves_dialectal_letters():
    assert normalize("Їжак ґедзь єдність і ліс") == "їжак ґедзь єдність і ліс"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_normalize.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'core.normalize'`.

- [ ] **Step 3: Write minimal implementation**

`core/normalize.py`:
```python
from __future__ import annotations

import re
import unicodedata

_APOSTROPHES = "’ʼ`´‘"  # ’ ʼ ` ´ ‘
_PUNCT = re.compile(r"[^\w'\s]", flags=re.UNICODE)  # keep word chars, ' and whitespace
_WS = re.compile(r"\s+", flags=re.UNICODE)


def normalize(text: str) -> str:
    text = unicodedata.normalize("NFC", text)
    text = text.lower()
    for ch in _APOSTROPHES:
        text = text.replace(ch, "'")
    text = _PUNCT.sub(" ", text)   # dashes, commas, quotes, etc. → space
    text = text.replace("_", " ")  # underscore is a word char but unwanted
    text = _WS.sub(" ", text)
    return text.strip()
```

Note: `\w` under `re.UNICODE` matches Cyrillic letters and digits, so і/ї/є/ґ survive; `'` is explicitly whitelisted so contracted forms like `прислів'я` stay intact.

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_normalize.py -v`
Expected: PASS (5 passed).

- [ ] **Step 5: Commit**

```bash
git add core/normalize.py tests/test_normalize.py
git commit -m "feat: text normalization for matching"
```

---

### Task 3: Franko adapter

**Files:**
- Create: `adapters/franko.py`
- Create: `tests/fixtures/franko_sample.csv`
- Create: `tests/test_franko_adapter.py`

**Interfaces:**
- Consumes: `CanonicalRecord`, `Annotation` from `core.schema`.
- Produces: `load(path: str) -> list[CanonicalRecord]`. Maps each `franko.csv` row → one record: `text=prov_clean`, `keyword=term`, `annotations=[Annotation(source="Franko1901", ref=letter, explanation=description)]`. Skips rows with empty `prov_clean`. `normalized_text` left blank (build computes it).

- [ ] **Step 1: Create the fixture**

`tests/fixtures/franko_sample.csv` (header matches real `franko.csv`: `letter,term,prov_clean,description`):
```csv
letter,term,prov_clean,description
Є,"Є, єсть","В кого є, то все своє.",А я свого не маю і мені він не дасть.
Є,"Є, єсть","Що є, то моє.",Характеризують самолюбного чоловіка.
Б,Болото,"Аби болото, а жаби будуть.",
Б,Болото,"",Порожній рядок без приповідки.
```

- [ ] **Step 2: Write the failing test**

`tests/test_franko_adapter.py`:
```python
from adapters.franko import load


def test_maps_rows_to_records():
    recs = load("tests/fixtures/franko_sample.csv")
    # 3 valid rows; the empty-prov_clean row is skipped
    assert len(recs) == 3

    first = recs[0]
    assert first.text == "В кого є, то все своє."
    assert first.keyword == "Є, єсть"
    assert len(first.annotations) == 1
    ann = first.annotations[0]
    assert ann.source == "Franko1901"
    assert ann.ref == "Є"
    assert ann.explanation == "А я свого не маю і мені він не дасть."


def test_blank_description_yields_empty_explanation():
    recs = load("tests/fixtures/franko_sample.csv")
    bolото = [r for r in recs if r.text == "Аби болото, а жаби будуть."][0]
    assert bolото.annotations[0].explanation == ""
```

- [ ] **Step 3: Run test to verify it fails**

Run: `python -m pytest tests/test_franko_adapter.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'adapters.franko'`.

- [ ] **Step 4: Write minimal implementation**

`adapters/franko.py`:
```python
from __future__ import annotations

import pandas as pd

from core.schema import Annotation, CanonicalRecord

SOURCE = "Franko1901"


def load(path: str) -> list[CanonicalRecord]:
    df = pd.read_csv(path, dtype=str, keep_default_na=False)
    records: list[CanonicalRecord] = []
    for _, row in df.iterrows():
        text = row["prov_clean"].strip()
        if not text:
            continue
        records.append(
            CanonicalRecord(
                text=text,
                keyword=row["term"].strip(),
                annotations=[
                    Annotation(
                        source=SOURCE,
                        ref=row["letter"].strip(),
                        explanation=row["description"].strip(),
                    )
                ],
            )
        )
    return records
```

- [ ] **Step 5: Run test to verify it passes**

Run: `python -m pytest tests/test_franko_adapter.py -v`
Expected: PASS (2 passed).

- [ ] **Step 6: Commit**

```bash
git add adapters/franko.py tests/fixtures/franko_sample.csv tests/test_franko_adapter.py
git commit -m "feat: franko source adapter"
```

---

### Task 4: Mlodzynskyi/Ilkevich adapter

**Files:**
- Create: `adapters/mlodzynskyi.py`
- Create: `tests/fixtures/proverbs_sample.csv`
- Create: `tests/fixtures/proverbs_sources_sample.csv`
- Create: `tests/test_mlodzynskyi_adapter.py`

**Interfaces:**
- Consumes: `CanonicalRecord`, `Annotation` from `core.schema`.
- Produces: `load(proverbs_path: str, links_path: str) -> list[CanonicalRecord]`. Joins `proverbs.csv` (`id,text`) with `proverbs_sources.csv` (`Id,Proverb,Source`) on `proverbs.id == proverbs_sources.Proverb`. One record per proverb: `text=text`, `keyword=""`, `annotations=[Annotation(source=Source, ref=proverb id)]`. Skips empty `text`.

- [ ] **Step 1: Create the fixtures**

`tests/fixtures/proverbs_sample.csv` (header matches real file, note BOM-free here is fine):
```csv
id,text
1,"Аби болото, а жаби будуть"
2,Аби душа сита та тіло не наго
3,""
```

`tests/fixtures/proverbs_sources_sample.csv`:
```csv
Id,Proverb,Source
1,1,Mlodzynskyi2009
2,2,Ilkevich1841
3,3,Mlodzynskyi2009
```

- [ ] **Step 2: Write the failing test**

`tests/test_mlodzynskyi_adapter.py`:
```python
from adapters.mlodzynskyi import load


def test_joins_proverbs_to_sources():
    recs = load(
        "tests/fixtures/proverbs_sample.csv",
        "tests/fixtures/proverbs_sources_sample.csv",
    )
    # proverb 3 has empty text → skipped
    assert len(recs) == 2

    by_text = {r.text: r for r in recs}
    assert by_text["Аби болото, а жаби будуть"].annotations[0].source == "Mlodzynskyi2009"
    assert by_text["Аби болото, а жаби будуть"].annotations[0].ref == "1"
    assert by_text["Аби душа сита та тіло не наго"].annotations[0].source == "Ilkevich1841"


def test_keyword_is_blank():
    recs = load(
        "tests/fixtures/proverbs_sample.csv",
        "tests/fixtures/proverbs_sources_sample.csv",
    )
    assert all(r.keyword == "" for r in recs)
```

- [ ] **Step 3: Run test to verify it fails**

Run: `python -m pytest tests/test_mlodzynskyi_adapter.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'adapters.mlodzynskyi'`.

- [ ] **Step 4: Write minimal implementation**

`adapters/mlodzynskyi.py`:
```python
from __future__ import annotations

import pandas as pd

from core.schema import Annotation, CanonicalRecord


def load(proverbs_path: str, links_path: str) -> list[CanonicalRecord]:
    proverbs = pd.read_csv(proverbs_path, dtype=str, keep_default_na=False)
    links = pd.read_csv(links_path, dtype=str, keep_default_na=False)
    # normalise column names (real files ship a UTF-8 BOM on the first header)
    proverbs.columns = [c.lstrip("﻿").strip() for c in proverbs.columns]
    links.columns = [c.lstrip("﻿").strip() for c in links.columns]

    source_by_proverb = dict(zip(links["Proverb"], links["Source"]))

    records: list[CanonicalRecord] = []
    for _, row in proverbs.iterrows():
        text = row["text"].strip()
        if not text:
            continue
        pid = row["id"].strip()
        source = source_by_proverb.get(pid, "Mlodzynskyi2009")
        records.append(
            CanonicalRecord(
                text=text,
                keyword="",
                annotations=[Annotation(source=source, ref=pid)],
            )
        )
    return records
```

- [ ] **Step 5: Run test to verify it passes**

Run: `python -m pytest tests/test_mlodzynskyi_adapter.py -v`
Expected: PASS (2 passed).

- [ ] **Step 6: Commit**

```bash
git add adapters/mlodzynskyi.py tests/fixtures/proverbs_sample.csv tests/fixtures/proverbs_sources_sample.csv tests/test_mlodzynskyi_adapter.py
git commit -m "feat: mlodzynskyi/ilkevich source adapter"
```

---

### Task 5: Exact merge

**Files:**
- Create: `core/dedup.py`
- Create: `tests/test_dedup_merge.py`

**Interfaces:**
- Consumes: `CanonicalRecord`, `Annotation` from `core.schema`; `normalize` from `core.normalize`.
- Produces: `merge_exact(records: list[CanonicalRecord]) -> list[CanonicalRecord]`. Assumes each input record already has `normalized_text` set. Groups by `normalized_text`; collapses each group to one record: `text` = the group's lexicographically smallest `text` (deterministic); `keyword` = first non-empty; `annotations` = concatenation of all groups' annotations in input order; `category`/`variant_group` left blank.

- [ ] **Step 1: Write the failing test**

`tests/test_dedup_merge.py`:
```python
from core.dedup import merge_exact
from core.schema import Annotation, CanonicalRecord


def _rec(text, norm, source, ref="", expl="", keyword=""):
    return CanonicalRecord(
        text=text,
        normalized_text=norm,
        keyword=keyword,
        annotations=[Annotation(source=source, ref=ref, explanation=expl)],
    )


def test_merges_same_normalized_text():
    recs = [
        _rec("Аби болото, а жаби будуть.", "аби болото а жаби будуть", "Franko1901", "Б", "поясн", "болото"),
        _rec("Аби болото, а жаби будуть", "аби болото а жаби будуть", "Mlodzynskyi2009", "6"),
    ]
    merged = merge_exact(recs)
    assert len(merged) == 1
    m = merged[0]
    assert m.sources() == ["Franko1901", "Mlodzynskyi2009"]
    assert m.keyword == "болото"            # first non-empty
    assert m.text == "Аби болото, а жаби будуть"  # lexicographically smallest


def test_distinct_normalized_text_not_merged():
    recs = [
        _rec("a", "a", "Franko1901"),
        _rec("b", "b", "Franko1901"),
    ]
    assert len(merge_exact(recs)) == 2
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_dedup_merge.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'core.dedup'`.

- [ ] **Step 3: Write minimal implementation**

`core/dedup.py`:
```python
from __future__ import annotations

from core.schema import CanonicalRecord


def merge_exact(records: list[CanonicalRecord]) -> list[CanonicalRecord]:
    groups: dict[str, list[CanonicalRecord]] = {}
    order: list[str] = []
    for rec in records:
        key = rec.normalized_text
        if key not in groups:
            groups[key] = []
            order.append(key)
        groups[key].append(rec)

    merged: list[CanonicalRecord] = []
    for key in order:
        group = groups[key]
        annotations = [a for rec in group for a in rec.annotations]
        keyword = next((rec.keyword for rec in group if rec.keyword), "")
        text = min(rec.text for rec in group)
        merged.append(
            CanonicalRecord(
                text=text,
                normalized_text=key,
                keyword=keyword,
                annotations=annotations,
            )
        )
    return merged
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_dedup_merge.py -v`
Expected: PASS (2 passed).

- [ ] **Step 5: Commit**

```bash
git add core/dedup.py tests/test_dedup_merge.py
git commit -m "feat: exact-merge dedup"
```

---

### Task 6: Variant linking

**Files:**
- Modify: `core/dedup.py` (add `link_variants`)
- Create: `tests/test_dedup_variants.py`

**Interfaces:**
- Consumes: `CanonicalRecord` (with `normalized_text` set).
- Produces: `link_variants(records: list[CanonicalRecord], threshold: int = 85, rare_df_cap: int = 40) -> list[CanonicalRecord]`. Mutates and returns the same records with `variant_group` populated. Algorithm: build a token→records index (tokens of len ≥ 3 from `normalized_text`); candidate pairs share at least one token whose document frequency ≤ `rare_df_cap`; for each candidate pair, if `rapidfuzz.fuzz.token_set_ratio(a, b) >= threshold`, union them (union-find). Groups of size ≥ 2 get ids `v0001`, `v0002`, … assigned by sorting groups on their smallest `normalized_text`. Singletons keep `variant_group = ""`.

- [ ] **Step 1: Write the failing test**

`tests/test_dedup_variants.py`:
```python
from core.dedup import link_variants
from core.schema import CanonicalRecord


def _rec(text, norm):
    return CanonicalRecord(text=text, normalized_text=norm)


def test_links_dialectal_variants():
    recs = [
        _rec("Як є – мине ся", "як є мине ся"),
        _rec("Як є мине сі", "як є мине сі"),
        _rec("Зовсім інша приповідка про море", "зовсім інша приповідка про море"),
    ]
    out = link_variants(recs, threshold=80)
    groups = {r.text: r.variant_group for r in out}
    assert groups["Як є – мине ся"] != ""
    assert groups["Як є – мине ся"] == groups["Як є мине сі"]
    assert groups["Зовсім інша приповідка про море"] == ""


def test_group_ids_are_deterministic_and_padded():
    recs = [
        _rec("баба з воза", "баба з воза"),
        _rec("баба із воза", "баба із воза"),
    ]
    out = link_variants(recs, threshold=80)
    assert out[0].variant_group == "v0001"
    assert out[1].variant_group == "v0001"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_dedup_variants.py -v`
Expected: FAIL with `ImportError: cannot import name 'link_variants'`.

- [ ] **Step 3: Write minimal implementation**

Append to `core/dedup.py`:
```python
from collections import Counter, defaultdict

from rapidfuzz import fuzz


def _tokens(norm: str) -> list[str]:
    return [t for t in norm.split() if len(t) >= 3]


class _UnionFind:
    def __init__(self, n: int) -> None:
        self.parent = list(range(n))

    def find(self, x: int) -> int:
        while self.parent[x] != x:
            self.parent[x] = self.parent[self.parent[x]]
            x = self.parent[x]
        return x

    def union(self, a: int, b: int) -> None:
        ra, rb = self.find(a), self.find(b)
        if ra != rb:
            self.parent[max(ra, rb)] = min(ra, rb)


def link_variants(
    records: list[CanonicalRecord],
    threshold: int = 85,
    rare_df_cap: int = 40,
) -> list[CanonicalRecord]:
    n = len(records)
    token_df: Counter[str] = Counter()
    rec_tokens: list[list[str]] = []
    for rec in records:
        toks = _tokens(rec.normalized_text)
        rec_tokens.append(toks)
        for t in set(toks):
            token_df[t] += 1

    index: dict[str, list[int]] = defaultdict(list)
    for i, toks in enumerate(rec_tokens):
        for t in set(toks):
            if token_df[t] <= rare_df_cap:
                index[t].append(i)

    uf = _UnionFind(n)
    seen_pairs: set[tuple[int, int]] = set()
    for members in index.values():
        for a_idx in range(len(members)):
            for b_idx in range(a_idx + 1, len(members)):
                i, j = members[a_idx], members[b_idx]
                pair = (i, j)
                if pair in seen_pairs:
                    continue
                seen_pairs.add(pair)
                if fuzz.token_set_ratio(
                    records[i].normalized_text, records[j].normalized_text
                ) >= threshold:
                    uf.union(i, j)

    members_by_root: dict[int, list[int]] = defaultdict(list)
    for i in range(n):
        members_by_root[uf.find(i)].append(i)

    multi = [m for m in members_by_root.values() if len(m) >= 2]
    multi.sort(key=lambda m: min(records[i].normalized_text for i in m))
    for gid, m in enumerate(multi, start=1):
        label = f"v{gid:04d}"
        for i in m:
            records[i].variant_group = label
    return records
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_dedup_variants.py -v`
Expected: PASS (2 passed).

- [ ] **Step 5: Commit**

```bash
git add core/dedup.py tests/test_dedup_variants.py
git commit -m "feat: variant linking via blocking + rapidfuzz"
```

---

### Task 7: Finalize + export

**Files:**
- Create: `core/export.py`
- Create: `tests/test_export.py`

**Interfaces:**
- Consumes: `CanonicalRecord`.
- Produces:
  - `finalize(records: list[CanonicalRecord]) -> list[CanonicalRecord]` — sort by `(normalized_text, text)`, assign `id = f"p{n:06d}"` (1-based), return the same list reordered.
  - `write_csv(records: list[CanonicalRecord], path: str) -> None` — columns: `id,text,normalized_text,keyword,explanation,category,sources,source_refs,variant_group`; list columns semicolon-joined; `explanation` via `csv_explanation()`; UTF-8.
  - `write_json(records: list[CanonicalRecord], path: str) -> None` — list of objects `{id, text, normalized_text, keyword, category (null if ""), variant_group (null if ""), annotations: [{source, ref, explanation (null if "")}]}`; `ensure_ascii=False`, `indent=2`.

- [ ] **Step 1: Write the failing test**

`tests/test_export.py`:
```python
import csv
import json

from core.export import finalize, write_csv, write_json
from core.schema import Annotation, CanonicalRecord


def _recs():
    return [
        CanonicalRecord(text="Ббб", normalized_text="ббб",
                        annotations=[Annotation("Franko1901", "Б", "поясн")]),
        CanonicalRecord(text="Ааа", normalized_text="ааа", keyword="к",
                        annotations=[Annotation("Mlodzynskyi2009", "1"),
                                     Annotation("Franko1901", "А", "ф")]),
    ]


def test_finalize_sorts_and_assigns_ids():
    out = finalize(_recs())
    assert [r.id for r in out] == ["p000001", "p000002"]
    assert out[0].text == "Ааа"   # sorted by normalized_text
    assert out[1].text == "Ббб"


def test_write_csv(tmp_path):
    out = finalize(_recs())
    p = tmp_path / "corpus.csv"
    write_csv(out, str(p))
    rows = list(csv.DictReader(p.open(encoding="utf-8")))
    assert rows[0]["id"] == "p000001"
    assert rows[0]["sources"] == "Mlodzynskyi2009;Franko1901"
    assert rows[0]["source_refs"] == "1;А"
    assert rows[0]["explanation"] == "ф"        # Franko preferred
    assert rows[1]["explanation"] == "поясн"


def test_write_json(tmp_path):
    out = finalize(_recs())
    p = tmp_path / "corpus.json"
    write_json(out, str(p))
    data = json.loads(p.read_text(encoding="utf-8"))
    assert data[0]["annotations"][0]["source"] == "Mlodzynskyi2009"
    assert data[0]["annotations"][0]["explanation"] is None
    assert data[0]["category"] is None
    assert data[1]["annotations"][0]["explanation"] == "поясн"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_export.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'core.export'`.

- [ ] **Step 3: Write minimal implementation**

`core/export.py`:
```python
from __future__ import annotations

import csv
import json

from core.schema import CanonicalRecord


def finalize(records: list[CanonicalRecord]) -> list[CanonicalRecord]:
    records.sort(key=lambda r: (r.normalized_text, r.text))
    for n, rec in enumerate(records, start=1):
        rec.id = f"p{n:06d}"
    return records


def write_csv(records: list[CanonicalRecord], path: str) -> None:
    fields = [
        "id", "text", "normalized_text", "keyword",
        "explanation", "category", "sources", "source_refs", "variant_group",
    ]
    with open(path, "w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fields)
        writer.writeheader()
        for r in records:
            writer.writerow({
                "id": r.id,
                "text": r.text,
                "normalized_text": r.normalized_text,
                "keyword": r.keyword,
                "explanation": r.csv_explanation(),
                "category": r.category,
                "sources": ";".join(r.sources()),
                "source_refs": ";".join(r.source_refs()),
                "variant_group": r.variant_group,
            })


def _or_none(value: str) -> str | None:
    return value if value else None


def write_json(records: list[CanonicalRecord], path: str) -> None:
    payload = [
        {
            "id": r.id,
            "text": r.text,
            "normalized_text": r.normalized_text,
            "keyword": _or_none(r.keyword),
            "category": _or_none(r.category),
            "variant_group": _or_none(r.variant_group),
            "annotations": [
                {
                    "source": a.source,
                    "ref": _or_none(a.ref),
                    "explanation": _or_none(a.explanation),
                }
                for a in r.annotations
            ],
        }
        for r in records
    ]
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
        f.write("\n")
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_export.py -v`
Expected: PASS (3 passed).

- [ ] **Step 5: Commit**

```bash
git add core/export.py tests/test_export.py
git commit -m "feat: finalize + csv/json export"
```

---

### Task 8: Upstream fetch script

**Files:**
- Create: `fetch.py`
- Create: `tests/test_fetch.py`

**Interfaces:**
- Consumes: nothing internal.
- Produces:
  - `SOURCES: dict[str, str]` — local relative path → raw GitHub URL, for the three upstream files (`franko.csv`, `proverbs.csv`, `proverbs_sources.csv`, and `sources.csv` registry inputs).
  - `raw_url(repo: str, path: str) -> str` — returns `https://raw.githubusercontent.com/MurzikVasilyevich/{repo}/HEAD/{path}`.
  - `fetch_all(dest_dir: str = "data/sources", fetcher=...) -> list[str]` — downloads each source to `dest_dir`, returns written paths. `fetcher(url) -> bytes` is injectable for testing (default uses `urllib.request`).

- [ ] **Step 1: Write the failing test**

`tests/test_fetch.py`:
```python
from fetch import fetch_all, raw_url


def test_raw_url():
    assert raw_url("ukr-proverbs-franko", "franko.csv") == (
        "https://raw.githubusercontent.com/MurzikVasilyevich/"
        "ukr-proverbs-franko/HEAD/franko.csv"
    )


def test_fetch_all_writes_files(tmp_path):
    calls = []

    def fake_fetcher(url: str) -> bytes:
        calls.append(url)
        return b"col\nval\n"

    written = fetch_all(dest_dir=str(tmp_path), fetcher=fake_fetcher)
    assert len(written) == len(calls) == 4
    for p in written:
        assert (tmp_path / p.split("/")[-1]).read_bytes() == b"col\nval\n"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_fetch.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'fetch'`.

- [ ] **Step 3: Write minimal implementation**

`fetch.py`:
```python
from __future__ import annotations

import os
import urllib.request

OWNER = "MurzikVasilyevich"


def raw_url(repo: str, path: str) -> str:
    return f"https://raw.githubusercontent.com/{OWNER}/{repo}/HEAD/{path}"


# local filename -> (repo, path-in-repo)
SOURCES: dict[str, tuple[str, str]] = {
    "franko.csv": ("ukr-proverbs-franko", "franko.csv"),
    "proverbs.csv": ("ukr-proverbs", "proverbs.csv"),
    "proverbs_sources.csv": ("ukr-proverbs", "proverbs_sources.csv"),
    "sources.csv": ("ukr-proverbs", "sources.csv"),
}


def _default_fetcher(url: str) -> bytes:
    with urllib.request.urlopen(url) as resp:  # noqa: S310 (trusted host)
        return resp.read()


def fetch_all(dest_dir: str = "data/sources", fetcher=_default_fetcher) -> list[str]:
    os.makedirs(dest_dir, exist_ok=True)
    written: list[str] = []
    for local_name, (repo, path) in SOURCES.items():
        data = fetcher(raw_url(repo, path))
        out_path = os.path.join(dest_dir, local_name)
        with open(out_path, "wb") as f:
            f.write(data)
        written.append(out_path)
    return written


if __name__ == "__main__":
    for p in fetch_all():
        print("wrote", p)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_fetch.py -v`
Expected: PASS (2 passed).

- [ ] **Step 5: Commit**

```bash
git add fetch.py tests/test_fetch.py
git commit -m "feat: upstream fetch script with injectable fetcher"
```

---

### Task 9: Build orchestration + golden end-to-end test

**Files:**
- Create: `build.py`
- Create: `tests/fixtures/golden/franko.csv`
- Create: `tests/fixtures/golden/proverbs.csv`
- Create: `tests/fixtures/golden/proverbs_sources.csv`
- Create: `tests/fixtures/golden/expected_corpus.csv`
- Create: `tests/test_build_golden.py`

**Interfaces:**
- Consumes: `adapters.franko.load`, `adapters.mlodzynskyi.load`, `core.normalize.normalize`, `core.dedup.merge_exact`, `core.dedup.link_variants`, `core.export.finalize`/`write_csv`/`write_json`.
- Produces:
  - `build_records(sources_dir: str) -> list[CanonicalRecord]` — load both adapters from `{sources_dir}/...`, set `normalized_text` on every record, `merge_exact`, `link_variants`, `finalize`. Returns finalized records.
  - `build(sources_dir: str = "data/sources", out_dir: str = ".") -> dict` — calls `build_records`, writes `corpus.csv` + `corpus.json` to `out_dir`, returns a stats dict `{total, with_explanation, variant_groups, per_source}`.
  - `main()` — run `build()` and print the stats report.

- [ ] **Step 1: Create golden fixtures**

`tests/fixtures/golden/franko.csv`:
```csv
letter,term,prov_clean,description
Б,Болото,"Аби болото, а жаби будуть.",Сатира на лінивих.
Я,Як,"Як є – мине ся.",Про мінливість статків.
```

`tests/fixtures/golden/proverbs.csv`:
```csv
id,text
1,"Аби болото, а жаби будуть"
2,Як є мине сі
3,Аби хліб а зуби найдуться
```

`tests/fixtures/golden/proverbs_sources.csv`:
```csv
Id,Proverb,Source
1,1,Mlodzynskyi2009
2,2,Mlodzynskyi2009
3,3,Ilkevich1841
```

`tests/fixtures/golden/expected_corpus.csv` — generate in Step 4 once the build is implemented (it is the locked expected output), then paste its exact contents here. After generating, the file must contain (verify ordering by normalized_text):
```csv
id,text,normalized_text,keyword,explanation,category,sources,source_refs,variant_group
p000001,"Аби болото, а жаби будуть",аби болото а жаби будуть,Болото,Сатира на лінивих.,,Franko1901;Mlodzynskyi2009,Б;1,
p000002,Аби хліб а зуби найдуться,аби хліб а зуби найдуться,,,,Ilkevich1841,3,
p000003,Як є мине сі,як є мине сі,,,,Mlodzynskyi2009,2,v0001
p000004,Як є – мине ся,як є мине ся,Як,Про мінливість статків.,,Franko1901,Я,v0001
```
(Note: `p000001` merges the Franko + Mlodzynskyi exact duplicate; `p000003`/`p000004` are variant-linked, not merged, since their normalized forms differ by `сі`/`ся`.)

- [ ] **Step 2: Write the failing test**

`tests/test_build_golden.py`:
```python
import filecmp

from build import build, build_records


def test_golden_corpus(tmp_path):
    stats = build(sources_dir="tests/fixtures/golden", out_dir=str(tmp_path))
    produced = tmp_path / "corpus.csv"
    assert filecmp.cmp(
        str(produced), "tests/fixtures/golden/expected_corpus.csv", shallow=False
    )
    assert stats["total"] == 4
    assert stats["variant_groups"] == 1
    assert stats["per_source"]["Franko1901"] == 2


def test_build_is_deterministic(tmp_path):
    a = build_records("tests/fixtures/golden")
    b = build_records("tests/fixtures/golden")
    assert [r.id for r in a] == [r.id for r in b]
    assert [r.text for r in a] == [r.text for r in b]
```

- [ ] **Step 3: Run test to verify it fails**

Run: `python -m pytest tests/test_build_golden.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'build'`.

- [ ] **Step 4: Write minimal implementation**

`build.py`:
```python
from __future__ import annotations

import os
from collections import Counter

from adapters import franko, mlodzynskyi
from core.dedup import link_variants, merge_exact
from core.export import finalize, write_csv, write_json
from core.normalize import normalize
from core.schema import CanonicalRecord


def build_records(sources_dir: str) -> list[CanonicalRecord]:
    records = franko.load(os.path.join(sources_dir, "franko.csv"))
    records += mlodzynskyi.load(
        os.path.join(sources_dir, "proverbs.csv"),
        os.path.join(sources_dir, "proverbs_sources.csv"),
    )
    for rec in records:
        rec.normalized_text = normalize(rec.text)
    records = merge_exact(records)
    records = link_variants(records)
    records = finalize(records)
    return records


def _stats(records: list[CanonicalRecord]) -> dict:
    per_source: Counter[str] = Counter()
    for r in records:
        for s in r.sources():
            per_source[s] += 1
    return {
        "total": len(records),
        "with_explanation": sum(1 for r in records if r.csv_explanation()),
        "variant_groups": len({r.variant_group for r in records if r.variant_group}),
        "per_source": dict(per_source),
    }


def build(sources_dir: str = "data/sources", out_dir: str = ".") -> dict:
    records = build_records(sources_dir)
    write_csv(records, os.path.join(out_dir, "corpus.csv"))
    write_json(records, os.path.join(out_dir, "corpus.json"))
    return _stats(records)


def main() -> None:
    stats = build()
    print("Corpus build complete:")
    print(f"  total entries:      {stats['total']}")
    print(f"  with explanation:   {stats['with_explanation']}")
    print(f"  variant groups:     {stats['variant_groups']}")
    print("  per source:")
    for src, n in sorted(stats["per_source"].items()):
        print(f"    {src}: {n}")


if __name__ == "__main__":
    main()
```

Then generate the expected golden file and confirm it matches the Step 1 contents:
```bash
python -c "from build import build; build(sources_dir='tests/fixtures/golden', out_dir='tests/fixtures/golden'); import os; os.replace('tests/fixtures/golden/corpus.csv','tests/fixtures/golden/expected_corpus.csv'); os.remove('tests/fixtures/golden/corpus.json')"
```
Open `tests/fixtures/golden/expected_corpus.csv` and verify it matches the table in Step 1. If a cell differs, the discrepancy is a real behavior bug — investigate via superpowers:systematic-debugging before proceeding.

- [ ] **Step 5: Run test to verify it passes**

Run: `python -m pytest tests/test_build_golden.py -v`
Expected: PASS (2 passed).

- [ ] **Step 6: Run the full suite**

Run: `python -m pytest -v`
Expected: all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add build.py tests/fixtures/golden tests/test_build_golden.py
git commit -m "feat: build orchestration + golden end-to-end test"
```

---

### Task 10: Real build + README + GitHub remote

**Files:**
- Create: `data/sources/` (committed snapshots)
- Create: `corpus.csv`, `corpus.json` (real outputs)
- Create: `sources.csv` (merged source registry)
- Create: `README.md`

**Interfaces:** none new — uses `fetch.py` and `build.py`.

- [ ] **Step 1: Fetch real upstream data**

Run: `python fetch.py`
Expected: `wrote data/sources/franko.csv` … (4 files). Verify sizes: `ls -la data/sources` (franko.csv ≈ 6 MB, proverbs.csv ≈ 340 KB).

- [ ] **Step 2: Build the real corpus**

Run: `python build.py`
Expected: prints stats. Sanity-check: `total` is roughly 33–35K; `Franko1901` ≈ 31K; `with_explanation` ≈ 31K; `variant_groups` > 0.

- [ ] **Step 3: Build the merged source registry**

Create `sources.csv` by combining the upstream `data/sources/sources.csv` (Mlodzynskyi2009, Ilkevich1841) with a Franko1901 row. Exact contents:
```csv
Citationkey,Title,Year,Author
Franko1901,Галицько-руські народні приповідки,1901,Іван Франко
Mlodzynskyi2009,Практичний російсько-український словник приказок,2009,
Ilkevich1841,Галицкіи приповѣдки и загадки,1841,Григорій Ількевич
```

- [ ] **Step 4: Write README.md**

`README.md` (fill the bracketed counts from Step 2's actual output):
```markdown
# ukr-proverbs-corpus

Canonical, deduplicated, source-attributed corpus of Ukrainian proverbs and adages,
unified from digitized historical sources.

## Contents
- `corpus.csv` — canonical source-of-truth ([N] entries).
- `corpus.json` — richer export preserving per-source annotations.
- `sources.csv` — source registry.
- `data/sources/` — committed snapshots of upstream inputs.

## Schema (`corpus.csv`)
| column | meaning |
|---|---|
| id | stable id (`pNNNNNN`) |
| text | verbatim proverb |
| normalized_text | lowercased, punctuation-stripped match key |
| keyword | lemma/term (Franko), if any |
| explanation | scholarly note (Franko preferred), if any |
| category | thematic category (reserved; populated later) |
| sources | `;`-joined source citation keys |
| source_refs | `;`-joined per-source references |
| variant_group | id linking probable dialectal variants |

## Sources
- **Franko 1901** — Іван Франко, *Галицько-руські народні приповідки* (~[N] entries, with explanations).
- **Mlodzynskyi 2009** — *Практичний російсько-український словник приказок*.
- **Ilkevich 1841** — Григорій Ількевич, *Галицкіи приповѣдки и загадки*.

## Rebuild
```bash
pip install -r requirements.txt
python fetch.py      # refresh data/sources snapshots
python build.py      # regenerate corpus.csv + corpus.json
python -m pytest     # run the test suite
```

## Stats (last build)
- Total entries: [N]
- With explanation: [N]
- Variant groups: [N]
- Per source: Franko1901 [N], Mlodzynskyi2009 [N], Ilkevich1841 [N]
```

- [ ] **Step 5: Commit data + outputs**

```bash
git add data/sources corpus.csv corpus.json sources.csv README.md
git commit -m "feat: build real corpus from upstream sources + docs"
```

- [ ] **Step 6: Create the GitHub remote (confirm with the user first)**

This is an outward action — confirm with the user before running. The active `gh` account must be `MurzikVasilyevich` (verify with `gh auth status`).
```bash
gh repo create MurzikVasilyevich/ukr-proverbs-corpus --public --source=. --remote=origin --push \
  --description "Canonical, deduplicated corpus of Ukrainian proverbs and adages"
```
Expected: repo created and `main` pushed. Verify: `gh repo view MurzikVasilyevich/ukr-proverbs-corpus --web`.

---

## Self-Review

**1. Spec coverage:**
- §1 Scope (two clean sources only) → Tasks 3, 4, 8 (only the two sources fetched/ingested). ✓
- §2 Inputs + field mapping → Tasks 3 (Franko), 4 (Mlodzynskyi/Ilkevich), 8 (fetch). ✓
- §3.1 CSV schema (9 columns) → Task 7 `write_csv`. ✓
- §3.2 JSON annotations shape → Task 7 `write_json`. ✓
- §3.3 source registry → Task 10 Step 3. ✓
- §4 Normalization rules → Task 2. ✓
- §5 Pass 1 exact merge → Task 5; Pass 2 variant linking (blocking + rapidfuzz ≥ 0.85) → Task 6. ✓
- §6 Architecture (adapters/core/build/fetch layout) → Tasks 1–9. ✓
- §7 Testing (normalize, adapters, dedup, export, golden e2e) → Tasks 2–9. ✓
- §8 Tech stack → Task 1 requirements.txt. ✓
- §9 Expected output (~33–35K) → Task 10 Step 2 sanity check. ✓
- §10 GitHub remote deferred + confirm → Task 10 Step 6. ✓

**2. Placeholder scan:** Bracketed `[N]` in the README (Task 10 Step 4) are real values filled from the actual build output, not plan placeholders; the `expected_corpus.csv` contents in Task 9 are concretely specified and verified by generation. No "TBD/implement later/add error handling" steps. ✓

**3. Type consistency:** `CanonicalRecord` / `Annotation` field names and methods (`sources()`, `source_refs()`, `csv_explanation()`) used consistently across Tasks 1, 5, 6, 7, 9. `load()` signatures match between adapters and `build_records`. `merge_exact` / `link_variants` / `finalize` signatures consistent between Tasks 5–7 and 9. ✓

No issues found.
