---
title: "Open Data: How to Reuse the Corpus"
slug: open-data
date: 2026-06-24
lede: For researchers and developers — explore download formats, REST API specifications, Croissant dataset metadata, and citation guidelines for the verba corpus.
---
The **verba** project is designed in the spirit of Open Science. We aim to make Ukrainian paremiology easily accessible for linguistic research, machine learning datasets, and digital humanities software.

This article outlines how to interact with the corpus metadata, use the REST API, download dumps, and cite the dataset in academic papers.

---

## 1. Public REST API (No Keys, CORS-open)

For online integrations, we host a public REST API under the base path:
`https://verbacorpus.org/api/v1`

**Key features of our API:**
* **Fully Public:** No API keys, sign-ups, or rate limits are required.
* **CORS enabled:** The API serves `Access-Control-Allow-Origin: *` headers, allowing direct client-side fetch calls from your frontend applications.
* **Multi-format Support:** Uses Content Negotiation. You can request specific file formats by setting the `Accept` HTTP header or appending a `?format=` parameter.

### Supported formats:
* **JSON** (`application/json`) — standard structured format.
* **JSONL** (`application/x-ndjson` or `application/jsonl`) — line-delimited JSON objects, ideal for processing files sequentially.
* **XML** (`application/xml`) — structured format for standard XML parsers.
* **CSV** (`text/csv`) & **TSV** (`text/tab-separated-values`) — flat tabular formats for easy loading into Excel, Google Sheets, R, or Python (Pandas).

Check out curl examples and parameter details in the [API Documentation](/api.html).

---

## 2. Dumps and ML Croissant Metadata

If you need the entire corpus for local processing or training machine learning models:

* **Release Dumps:** Every version release on GitHub packages the latest files (`corpus.json`, `corpus.csv`, and `corpus.xml`).
* **Croissant Spec:** For integration with machine learning platforms like Hugging Face or Google Dataset Search, we publish a `croissant.json` file. It adheres to the MLCommons Croissant metadata standard, enabling automated imports into training pipelines.

---

## 3. The Dual Licensing Model

Due to the varying copyright status of the source materials, verba uses a dual licensing model:
1. **Historical Source Texts (1841–1909):** The text of the Ilkevych, Nomys, and Franko collections is in the Public Domain due to copyright expiration. You are free to copy, modify, and redistribute these texts for any purpose.
2. **Modern Collections (1961 & 2009):** The original text of the Bobkova and Mlodzynskyi collections remains protected under their publishers' copyrights. They are included in the corpus solely for academic and research purposes under fair use guidelines, with attribution in the `sources` field.
3. **Curation and Enrichment:** The unified database schema, modern spelling adaptations, AI-generated thematic tags, and dialectal links are licensed under the **Creative Commons Attribution 4.0 International (CC BY 4.0)** license. When utilizing this metadata, please attribute the verba project.

---

## 4. Citation Guidelines

If you use the verba corpus in an academic paper, thesis, or scientific report, please cite it.

We provide bibliography references in **BibTeX** and **CSL-JSON** formats:
* Download [BibTeX](/references.bib)
* Download [CSL-JSON](/references.csl.json)

*(We plan to register a DOI identifier for the corpus in future data releases).*

### Citation string:
> *Yemelianov, Dmytro (2026). verba — Ukrainian Proverbs Corpus (v1.0.2). URL: https://verbacorpus.org.*

---

## Ideas for Reuse

What can you build with the verba dataset?
* **Messenger Bots:** a bot sending a themed "proverb of the day" card.
* **Website Widgets:** a simple script displaying random folk quotes on your website.
* **NLP Models:** fine-tuning language models to understand Ukrainian idioms, historic vocabulary, and metaphors.
* **Linguistic Research:** analyzing dialectal geography by comparing Galician vs. Central/Eastern Ukrainian variants.
