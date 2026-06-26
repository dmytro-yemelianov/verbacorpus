---
title: "verba on Hugging Face: Load and Use the Corpus"
slug: verba-on-hugging-face
date: 2026-06-24
lede: The verba corpus is now published on Hugging Face as an open dataset. Here is how to load it with the datasets library, pandas, the hf CLI, or DuckDB — and start working with it right away.
---
The **verba** corpus is now available on [Hugging Face](https://huggingface.co/datasets/dmytro-yemelianov/verba), the largest hub for machine-learning and NLP datasets. That means you can pull all 48,787 proverbs and start working with them in a single line of code — no sign-up, no API keys, no manual file downloads.

This article covers four ways to get the corpus (the `datasets` library, `pandas`, the `hf` CLI, and SQL via DuckDB), plus a few examples of what to do with it next.

---

## What's published

Dataset page: **[huggingface.co/datasets/dmytro-yemelianov/verba](https://huggingface.co/datasets/dmytro-yemelianov/verba)**.

The repository holds four files:

* `corpus.csv` — the canonical corpus: **48,787 records, 10 columns**. This is the `train` split that the dataset viewer renders and the `datasets` library loads.
* `sources.csv` — the registry of the five source collections (bibliography).
* `croissant.json` — MLCommons Croissant metadata for ML pipelines.
* `README.md` — the full [data card](https://github.com/dmytro-yemelianov/verbacorpus/blob/main/DATACARD.md) (methodology, quality limits, licensing).

The dataset is **public** and licensed **CC BY 4.0** (compilation and enrichment); the historical texts are in the public domain. No token is required to read it.

---

## 1. The `datasets` library (Python)

The simplest path for researchers and ML engineers:

```python
from datasets import load_dataset

ds = load_dataset("dmytro-yemelianov/verba", split="train")
print(len(ds))                       # 48787
print(ds[0]["text"], "→", ds[0]["modern_text"])

# keep only proverbs of a given theme
work = ds.filter(lambda r: "work_labor" in (r["category"] or ""))
print(len(work))
```

For large workloads or limited memory, turn on streaming — nothing is written to disk:

```python
ds = load_dataset("dmytro-yemelianov/verba", split="train", streaming=True)
for row in ds.take(5):
    print(row["modern_text"])
```

---

## 2. `pandas` straight from the Hub

If you'd rather work in tables, read the CSV directly from the Hub over the `hf://` protocol (requires the `huggingface_hub` package):

```python
import pandas as pd

df = pd.read_csv("hf://datasets/dmytro-yemelianov/verba/corpus.csv")

# top 10 themes
df["category"].str.split(";").explode().value_counts().head(10)
```

---

## 3. The `hf` CLI — a local copy

To download the dataset to disk (for offline processing or model training), use the official `hf` tool:

```bash
# install the CLI (once)
curl -LsSf https://hf.co/cli/install.sh | bash -s

# the whole dataset repo into ./verba
hf download dmytro-yemelianov/verba --repo-type dataset --local-dir ./verba

# or just a single file
hf download dmytro-yemelianov/verba corpus.csv --repo-type dataset --local-dir ./verba
```

---

## 4. SQL without downloading (DuckDB)

Hugging Face auto-converts the corpus to **Parquet**, so you can run analytical queries without fetching the whole file. Find the Parquet URLs with:

```bash
hf datasets parquet dmytro-yemelianov/verba
```

Then run plain SQL through DuckDB, straight from the CLI:

```bash
hf datasets sql "SELECT category, COUNT(*) AS n
  FROM read_parquet('https://huggingface.co/api/datasets/dmytro-yemelianov/verba/parquet/default/train/0.parquet')
  GROUP BY category ORDER BY n DESC LIMIT 10"
```

---

## Schema and fields

One row per proverb. Columns in `corpus.csv`:

| Column | Meaning |
|---|---|
| `id` | Stable identifier (`pNNNNNN`) |
| `text` | Verbatim proverb in its source orthography |
| `normalized_text` | Lowercased, punctuation-stripped match key |
| `modern_text` | Modern standard Ukrainian spelling (AI-generated) |
| `keyword` | Lemma/term (Franko), if any |
| `explanation` | Scholarly note (Franko-preferred), cleaned |
| `category` | 1–3 themes from the 27-theme taxonomy, `;`-joined, primary first |
| `sources` | `;`-joined source keys |
| `source_refs` | `;`-joined per-source references |
| `variant_group` | Id linking probable dialectal variants |

---

## License and citation

* **Curation and enrichment** (schema, modern spelling, themes, variant groups) — **CC BY 4.0**.
* **Historical texts** (Ilkevych 1841, Nomys 1864, Franko 1901) — public domain.
* **Modern collections** (Bobkova, Mlodzynskyi 2009) — under their compilers' copyright; included for research and education with attribution in the `sources` field.

Citation string:

> *Yemelianov, Dmytro (2026). verba — Ukrainian Proverbs Corpus (v1.0.2). URL: https://verbacorpus.org.*

---

## What's next

* Other formats, the REST API, and citation guidelines — in [“Open Data: How to Reuse the Corpus”](/en/blog/open-data).
* The full [API documentation](/api.html) with `curl` examples.
* Source code and releases — on [GitHub](https://github.com/dmytro-yemelianov/verbacorpus).
