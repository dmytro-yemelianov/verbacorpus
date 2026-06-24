---
title: What is verba
slug: what-is-verba
date: 2026-06-24
lede: What is verba — an open corpus of Ukrainian proverbs and sayings. Learn about its scope, sources, search capabilities, and license.
---
**verba** is an open, unified corpus of Ukrainian proverbs, sayings, and folk adages. It gathers and structures the rich heritage of Ukrainian paremiology compiled over the past 180 years—spanning from the first printed Galician collections of 1841 to modern lexicographical editions of the 21st century.

Currently, the corpus comprises **48,787 entries**, sourced from five landmark publications.

## Why verba was created

For decades, Ukrainian proverbs remained scattered across multiple printed and scanned editions. Each source used different historical or dialectal orthographies and lacked a uniform machine-readable format. This made it difficult for casual readers to search, and nearly impossible for linguists or developers to analyze the datasets programmatically.

The **verba** project solves this by:
1. **Unifying the data format:** all proverbs are structured under a single schema.
2. **Preserving original orthographies:** the verbatim historical spelling of each source is preserved untouched for linguistic research.
3. **Enhancing discoverability:** each entry is enriched with a modern-spelling Ukrainian rendering and thematic tags.
4. **Linking variant forms:** close semantic or syntactic dialectal variants are linked together into groups.

## The Five Collections

The corpus aggregates five major historic and contemporary paremiological works:
* **Hryhoriy Ilkevych's Collection (1841):** published in Vienna, one of the earliest efforts to record Galician Ukrainian proverbs.
* **Matviy Nomys's Collection (1864):** the foundational monument of Ukrainian paremiology, containing over 14,000 entries.
* **Ivan Franko's Collection (1901–1909):** a monumental three-volume academic work published by the Shevchenko Scientific Society in Lviv, containing extensive ethnographic commentary.
* **V. Bobkova's Collection (ed. M. Rylsky, 1961):** the primary mid-20th-century academic compilation reflecting Soviet-era paremiology.
* **Valeriy Mlodzynskyi's Collection (2009):** a modern reprint of a major 1929 comparative dictionary compiled during the golden age of Ukrainian lexicography.

You can learn more about these editions in our deep-dive article [«Five Collections: Where the Proverbs Come From»](/en/blog/sources).

## Search Capabilities

The verba web application offers several ways to explore the dataset:
* **Lexical Search:** search by keyword matching both original historical spellings and modern spelling adaptations.
* **Source and Thematic Filters:** filter records by selecting any of the 27 themes or 5 source registries.
* **Semantic Search («by meaning»):** powered by the BGE-M3 text-embedding model, you can search for proverbs using natural language descriptions of a situation or concept—even if the proverb does not share any vocabulary with your query.
* **Swipe Mode:** swipe through randomly sampled proverb cards for daily inspiration.

Try exploring using these quick share links:
* [Proverb №1](/s/1) — "By matching pair, one knows what boils in the heart" (from the Bobkova collection).
* [Proverb №126](/s/126) — "Appetite comes with eating" (a classic proverb with Franko's historical notes).

## Open Data and Reuse

The verba project is fully open-source. The database structure, modern spelling adaptations, thematic tags, and variant group mappings are distributed under the **Creative Commons Attribution 4.0 (CC BY 4.0)** license.

For developers and researchers, we provide a full REST API and complete dataset downloads in popular formats (JSON, CSV, and Hugging Face Croissant). Read more about reusing our data in [«Open Data: How to Reuse the Corpus»](/en/blog/open-data) or read our [API Documentation](/api.html).
