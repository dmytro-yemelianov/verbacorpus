# verba — Marketing & Outreach Plan

**Project:** verba — Ukrainian Proverbs Corpus · https://verbacorpus.org
**Version of this plan:** 1.0 (2026-06-24)
**Strategy:** academic-led, then public. Lead with scholarly + cultural credibility (a rigorous, citable, open corpus), and convert that credibility into public reach (Ukrainians + diaspora). Rigor first, virality second — the corpus's moat is that it is *trustworthy*.

---

## 1. What we're marketing

A canonical, enriched, openly-licensed corpus of **48,787 Ukrainian proverbs** drawn from **five collections (1841–2009)** — Франко (1901), Номис (1864), Бобкова (1961), Ількевич (1841), Млодзинський (2009 reprint) — each with modern spelling, 27 thematic tags, full bibliographic references (BibTeX/CSL-JSON), semantic + keyword search, a multi-format REST API, a 10-language UI, versioned data releases (CC BY 4.0), Croissant + Datasheet metadata, and now **shareable short links + QR social cards**.

**One-line pitch (UA):** «verba — найбільший відкритий корпус українських прислів'їв: 48 787 одиниць із п'яти зібрань, із сучасним написанням, пошуком, API та цитуванням.»
**One-line pitch (EN):** "verba — the largest open corpus of Ukrainian proverbs: 48,787 entries from five collections, with modern spelling, search, an API, and proper citations."

## 2. Audiences (in priority order)

1. **Researchers & the GLAM/DH world** — paremiologists, folklorists, linguists, digital-humanities scholars, NLP/ML practitioners. Care about: provenance, license, citability, machine-readable formats, scale.
2. **Educators & students** — Ukrainian-language teachers (in Ukraine + diaspora schools «рідні школи»), university courses, olympiad/curriculum use. Care about: searchability by theme, modern spelling, shareable examples.
3. **Wikimedia / open-knowledge community** — Wikipedia (uk + en), Wikidata, Wikisource editors. Care about: a stable, citable source to link.
4. **Engaged public & diaspora** — Ukrainians worldwide who love the language and want to share «мудрість». Care about: beautiful, shareable proverb cards; a «прислів'я дня».
5. **Ukrainian cultural & tech press** — Chytomo, Texty.org.ua, Dou.ua, LinkedIn UA tech community. Care about: a notable open-data / Ukrainian-tech story.

## 3. Positioning & messages

- **Credibility:** "Not a meme list — a sourced, versioned, citable corpus." Every proverb traces to a real edition; the data card + BibTeX/CSL-JSON make it citable; releases are versioned (SemVer-for-data).
- **Openness:** CC BY 4.0 compilation; public-domain historical texts; an open API + downloadable dataset (JSON/JSONL/CSV/TSV/XML + Croissant). "Build on it."
- **Cultural stewardship:** consolidating scattered 19th–20th-c. collections into one searchable home — preservation + access. Especially resonant now (Ukrainian cultural assertion).
- **Craft:** the willow brand, the editorial cards, the 10-language UI — it *looks* trustworthy and is pleasant to use.

## 4. Channels & tactics

### A. Academic / open-data (credibility engine — do first)
- **HuggingFace Datasets** — publish `verba` with the Croissant metadata + data card; tag `language:uk`, `task:text`, `paremiology`. (Croissant is already generated.)
- **Kaggle Datasets** — mirror; Kaggle's audience finds it via search + competitions.
- **Zenodo** — deposit a versioned release for a **DOI** (the one identifier the corpus currently lacks; closes the citation loop). Link the DOI from CITATION.cff + the About page.
- **Wikidata** — create an item for the corpus (instance of: linguistic corpus); link the five source works (some already have items). **Wikipedia** uk/en — add verba as an external link / source on «Українські прислів'я», paremiology, and the authors' (Франко, Номис) pages where appropriate (follow each wiki's sourcing norms; no spam).
- **Papers With Code / arXiv (optional, later)** — a short data-descriptor preprint ("verba: an open corpus of Ukrainian proverbs") → durable academic citation + Papers-With-Code listing. Cite the five sources (references.bib is ready).
- **Mailing lists / communities** — Corpora-List, the SIGHUM/DH-UA + Ukrainian-NLP communities, r/Ukrainian, r/languagelearning, r/datasets.

### B. Public / cultural (reach engine — ride the credibility)
- **The on-site /blog** (being built) — 3 cornerstone Ukrainian articles at launch (see §6), then a steady «прислів'я тижня» cadence. SEO-compounding + owned.
- **Telegram «прислів'я дня»** — a daily-card bot (the daily card + short link already exist; the bot posts the card image + the `/s/<n>` link). Highest-fit channel for the diaspora. *(Deferred build; high ROI.)*
- **Social shareable cards** — the QR/short-link cards (now live) are the core shareable unit. Seed Instagram/Facebook/X/Threads/LinkedIn with themed sets (праця, доля, тварини…) + the daily card. Each card carries the QR → traffic loop.
- **Diaspora orgs & «рідні школи»** — offer the corpus + cards as a free classroom resource (Ukrainian Saturday schools, Plast, UCC/UWC networks).
- **Ukrainian tech/culture press** — pitch Chytomo / Texty / Dou.ua / LinkedIn: "an open, citable corpus of 48k Ukrainian proverbs."

### C. Owned SEO
- The /blog + the per-proverb `/p/:id` pages (card-first, indexable) + `llms.txt` + the sitemap (**add a sitemap.xml** — quick win) + hreflang (already live) compound organic discovery in 10 languages.

## 5. Phased rollout

- **Phase 0 — Foundation (mostly done):** site, API, releases, references, short links + QR cards. **Remaining quick wins:** a **Zenodo DOI**, a **sitemap.xml**, the **/blog**.
- **Phase 1 — Academic seeding (weeks 1–2):** HuggingFace + Kaggle + Zenodo DOI; Wikidata item; Wikipedia source links; post to Corpora-List + Ukrainian-NLP. Goal: indexable + citable everywhere a researcher looks.
- **Phase 2 — Public launch (weeks 2–4):** publish the 3 cornerstone /blog articles; «Запускаємо verba» posts on LinkedIn + the UA communities; seed social with themed card sets; pitch Chytomo/Texty.
- **Phase 3 — Sustain (ongoing):** Telegram «прислів'я дня» bot; weekly «прислів'я тижня» blog post + card set; respond to academic/educator interest; cut new data releases as the corpus grows.

## 6. Content calendar — launch articles (Ukrainian, on /blog)

1. **«Що таке verba»** — what the corpus is, the five sources, how to search (theme/source/semantic), the API + downloads + license. The anchor / "start here" piece.
2. **Джерела deep-dive** — the story of the collections (Франко's Етнографічний збірник; Номис 1864; Ількевич 1841) with vivid example proverbs (linking `/p/:id` + cards), and an honest note on the OCR/AI-enrichment limits.
3. **«Відкриті дані: як користуватися корпусом»** — for researchers/developers: the API, formats, Croissant, citing verba (BibTeX/CSL-JSON/DOI), reuse ideas. Establishes the academic credibility.

(Then ongoing: themed «прислів'я тижня» explorations — праця, доля, тварини, мова — each a short post + a shareable card set.)

## 7. Metrics

- **Credibility:** dataset downloads (HF/Kaggle), Zenodo DOI resolutions + citations, Wikipedia/Wikidata backlinks.
- **Reach:** site sessions (Cloudflare analytics), `/s/<n>` short-link clicks, card shares, Telegram subscribers, /blog organic traffic + ranking for «українські прислів'я».
- **Engagement:** saved proverbs, API usage (`/api/v1` hits), inbound press/educator contact.

## 8. Assets ready vs to-build

| Ready | To build / do |
|---|---|
| Site, 10-lang UI, REST API, llms.txt | **sitemap.xml** (SEO) |
| Versioned CC BY 4.0 releases + data card | **Zenodo DOI** deposit |
| BibTeX + CSL-JSON references, Croissant | **/blog** + the 3 articles (in progress) |
| Short links + QR social cards, daily card | **Telegram «прислів'я дня» bot** |
| Semantic + keyword search | HuggingFace + Kaggle + Wikidata listings |

## 9. Guardrails

- **No fabrication / overclaiming.** State scale + limits honestly (OCR caveats, AI-generated modern spelling/themes are approximate). The corpus's value is trust — don't spend it on hype.
- **Respect platform norms.** Wikipedia/Wikidata edits follow sourcing + notability rules; no link-spam. Community posts are genuine, not astroturf.
- **Attribution.** Always credit the five source collections (the references are built for this); modern collections (Бобкова, Млодзинський) remain under their publishers' rights — frame as research/education use with attribution.
- **License clarity.** CC BY 4.0 for the compilation/enrichment; public domain for the historical texts — say so wherever the dataset is listed.
