# ukr-proverbs-corpus

Canonical, deduplicated, source-attributed corpus of Ukrainian proverbs and adages,
unified from digitized historical sources.

It is **enriched**: every entry carries a modern-spelling rendering and 1–3 thematic categories.

## Web app & API

A Cloudflare Worker serves a searchable, offline-capable PWA and a JSON REST API over the corpus
(in `app/`, mirroring the ua-bez-tabu stack). Live: **https://verbacorpus.org**

### Verba Corpus: каталог проєктів

Хендовер парасольки, стан публічних адрес і порядок завершення інтеграції:
[docs/CORPORA-HANDOVER.md](docs/CORPORA-HANDOVER.md) (перевірено 2026-11-01).

Головна `https://verbacorpus.org/` об’єднує п’ять погоджених напрямів:

| Напрям | Публічна адреса | Наповнення |
| --- | --- | --- |
| **pro.verba** | `https://pro.verbacorpus.org/` | 48 787 прислів’їв, пошук, наявний API і картки |
| **contra.verba** | `https://contra.verbacorpus.org/` | «Українська без табу»: 2 000 рядків, пошук, фільтри й граф |
| **re.verba** | `https://re.verbacorpus.org/` | Редакційний напрям із вже опублікованими статтями |
| **para.verba** | `https://para.verbacorpus.org/` | Nasinnia: перевірений український растровий зразок Cozette |
| **non.verba** | `https://non.verbacorpus.org/` | Повний UPA на `/upa/` і 12 авторських іконок 16×16 |

Для іконок доступні SVG, PNG, JSON-матриці та SVG-спрайт. Шрифтовий зразок
зберігає MIT-ліцензію й точні вихідні растри, невідомі символи показує явно.
UPA підключається окремим Worker через service binding `UPA`: каталог, скани,
генератор, друк та API доступні на `/upa/`. Його PDF, скани й матриці не
копіюються до збірки Verba. Візуальний напрям опубліковано на
[non.verbacorpus.org](https://non.verbacorpus.org); повний
[каталог UPA](https://non.verbacorpus.org/upa/) працює без авторизації.
Публікація — через CI; ручний запуск дозволяє вибрати `all`, `root` або `non`.
Генератор [рамок для сторінок](https://non.verbacorpus.org/upa/page-frames)
підтримує A4/A5/Letter, seed, поля, орнаменти, палітри, процедурні кути,
SVG, прозорий PNG 200 dpi та друк/PDF на одному аркуші.
Редактор додає заголовок, текст, дату й підпис, шаблони документів і збереження
в браузері. Шрифти Spleen із Texted та Cozette з Verba підтримують українську;
в експорті використовуються самодостатні контури пікселів.
Після злиття в `main` [CI узгоджено публікує головну амбрелу та non.verba](docs/DEPLOYMENT.md) з точно
зафіксованою ревізією UPA. Головний домен відкриває амбрелу п’яти напрямів,
а прислів’я доступні на `pro.verbacorpus.org`. Назви напрямів у шляхах не дублюються. Спільна навігація, шрифти інтерфейсу й тема
діють у всіх напрямах, редакційних сторінках та інструментах UPA.
Редактор містить дев’ятнадцять готових гарнітур. [Повний каталог шрифтів](https://para.verbacorpus.org/fonts)
показує 2 287 записів і 340 растрових зразків із завантаженням BDF/OTB; вибір картки відкриває перегляд на місці. Кандидатні абетки
розміщені окремо в лабораторії `https://para.verbacorpus.org/letters-lab`.

Старі `/bez-tabu/`, `/blog/*`, `/p/*`, `/s/*`, `/card/*` та `/api/*` підтримуються.
Кореневі URL з параметрами пошуку переспрямовуються на `pro.verbacorpus.org/` зі збереженням
фільтрів; мови прислів’їв доступні під `https://pro.verbacorpus.org/<lang>/`. Парасолька наразі українська.
Імпорт словника: [BEZ-TABU.md](docs/BEZ-TABU.md).
Реалізація: [специфікація](docs/superpowers/specs/2026-11-02-verba-umbrella.md)
та [план і перевірки](docs/superpowers/plans/2026-11-02-verba-umbrella.md).

```sh
cd app
python3 sync_bez_tabu.py ../../ua-bez-tabu  # лише для оновлення знімка
python3 sync_corpora.py                   # явне оновлення метаданих UPA/Nasinnia
npm run build                            # звичайна збірка не потребує сусіднього репо
npm run typecheck                        # типи клієнта, Worker і тестів
npm test                                 # каталог, растри, маршрути й наявний API
npm run dev:integrated                   # зібрати й запустити Verba + UPA на localhost:8793
```

Інтегроване прев’ю потребує встановлених залежностей обох репозиторіїв і сусідньої
теки `../upa-archive`. Інший шлях задається через `UPA_REPO`, порт — через
`VERBA_PORT`, каталог стану — через `VERBA_STATE_DIR`. Команда використовує
Wrangler з UPA та окремий локальний стан `.wrangler/integrated`. Звичайні збірка й тести Verba не потребують сусіднього
репозиторію. API прислів’їв лишається на `/api/v1`, API орнаментів доступний
на `/upa/api/v1`; Swagger — `/upa/api/v1/docs`.
Повна браузерна перевірка зв’язки запускається командою `pnpm test:verba`
з кореня UPA: вона сама піднімає обидва Worker на окремому порту 8794.

### REST API (`/api/v1`, multi-format)

Versioned, content-negotiated API — every data endpoint serves **JSON · JSONL · XML · CSV · TSV** via
`?format=` (default `json`) or the `Accept` header. Docs + curl examples at **[/api.html](https://pro.verbacorpus.org/api.html)**; OpenAPI 3 at `/api/v1/openapi.json`.

- `GET /api/v1/search?q=&category=&source=&limit=&offset=&format=` — lexical
- `GET /api/v1/semantic?q=&category=&source=&minScore=&limit=&format=` — meaning-based (see below)
- `GET /api/v1/random?n=&category=&source=&format=` — N random
- `GET /api/v1/query?category=&source=&variant_group=&has_explanation=&limit=&offset=&format=` — flexible filter
- `GET /api/v1/proverb/:id?format=` — single proverb + explanation
- `GET /api/v1/export?category=&source=&format=` — whole corpus (or filtered), incl. explanations
- `GET /api/v1/categories` · `GET /api/v1/meta` · `GET /api/v1/similar/:id`

Collections return `{total, limit, offset, results}` (+ `X-Total-Count`); file formats download with a filename.
The unversioned `/api/*` paths remain as back-compatible aliases. Example:
```bash
curl 'https://pro.verbacorpus.org/api/v1/search?q=гроші&format=csv'
curl -H 'Accept: application/x-ndjson' 'https://pro.verbacorpus.org/api/v1/export'
```

### Semantic search (embeddings + Vectorize)

The PWA's **«за змістом»** toggle and the **«Схожі прислів'я»** detail section are powered by
Workers AI `@cf/baai/bge-m3` embeddings stored in a Cloudflare **Vectorize** index (`proverbs-bge-m3-v2`).
Lexical search stays the offline default; semantic search is opt-in and network-only.

Build/refresh the index (incremental — embeds only new/changed entries; **requires the Workers Paid plan**
plus an API token with `Vectorize:Edit` + `Workers AI:Read`):
```bash
CLOUDFLARE_ACCOUNT_ID=<acct> python -m embed.run   # uses embed/manifest.json as incremental state
```

Run locally:
```bash
cd app
npm install
.venv/bin/python build_data.py ../corpus.csv ../enrich/taxonomy.csv ../sources.csv public/data ../corpus.xml
.venv/bin/python build_blog.py content/blog public/blog
node build.mjs
npx wrangler dev        # http://127.0.0.1:8787
npx vitest run          # API + search tests

```

## Releases & citation

The corpus is versioned (SemVer-for-data) and published as **[GitHub Releases](https://github.com/dmytro-yemelianov/verbacorpus/releases)** — each tag bundles `corpus.csv/json/jsonl/xml`, the data card, and the Croissant metadata. The current version (`VERSION`) is also stamped into `meta.json`, so the site (verbacorpus.org) and the API (`/api/v1/meta`) report which snapshot they serve.

- **Hugging Face:** [`datasets/dmytro-yemelianov/verba`](https://huggingface.co/datasets/dmytro-yemelianov/verba) — load with `datasets`/`pandas` or the `hf` CLI; the `train` split is `corpus.csv` (48787 rows), shipped alongside `sources.csv`, `croissant.json`, and the data card as the dataset README.
- **Data card:** [`DATACARD.md`](DATACARD.md) (Datasheets-for-Datasets) · **machine-readable:** [`croissant.json`](croissant.json) (MLCommons Croissant) · **changes:** [`CHANGELOG.md`](CHANGELOG.md)
- **Cite:** see [`CITATION.cff`](CITATION.cff) (GitHub's "Cite this repository") — Yemelianov, Dmytro (2026). *verba — Ukrainian Proverbs Corpus* (v1.0.0).
- **License:** compilation + enrichment **CC BY 4.0**; historical source texts public domain; modern-collection texts under their publishers' rights (see the data card).

## Contents
- `corpus.csv` — canonical source-of-truth (48787 entries).
- `corpus.json` — richer export (categories as arrays, per-source annotations).
- `sources.csv` — source registry.
- `enrich/taxonomy.csv` — the fixed 27-theme category vocabulary.
- `enrich/REPORT.md` — enrichment coverage, distribution, and quality audit.
- `enrich/pass_a.json`, `enrich/pass_b.json` — enrichment provenance (raw LLM pass outputs).
- `data/sources/` — committed snapshots of upstream inputs.

## Schema (`corpus.csv`)
| column | meaning |
|---|---|
| id | stable id (`pNNNNNN`) |
| text | verbatim proverb (1901 orthography preserved, never modified) |
| normalized_text | lowercased, punctuation-stripped match key |
| modern_text | modern standard Ukrainian spelling (LLM-generated) |
| keyword | lemma/term (Franko), if any |
| explanation | scholarly note (Franko preferred), cleaned |
| category | 1–3 theme keys from `enrich/taxonomy.csv`, `;`-joined, primary first |
| sources | `;`-joined source citation keys |
| source_refs | `;`-joined per-source references |
| variant_group | id linking probable dialectal variants |

## Categories (taxonomy)
27 fixed themes (see `enrich/taxonomy.csv`): work_labor, poverty_wealth, food_hunger,
drink_alcohol, family_kinship, marriage_gender, speech_lying, wisdom_folly, fate_luck,
time_seasons, death_illness, religion_god, social_relations, class_power, justice_truth,
animals, body_health, home_household, conflict_enmity, friendship_love, travel_distance,
trade_money, ethnic_local, emotion_mood, nature_weather, appearance_reputation, idiom_expressive.

## Enrichment
`category`, `modern_text`, cleaned `explanation`, and the tuned `variant_group` are **LLM-generated
data artifacts** (produced by batched Claude Code agents — not a deterministic build).
Regenerating them requires Claude Code. See `enrich/REPORT.md` for the coverage and quality audit.

## Sources
- **Franko 1901** — Іван Франко, *Галицько-руські народні приповідки* (~30906 entries, with explanations).
- **Mlodzynskyi 2009** — *Практичний російсько-український словник приказок*.
- **Ilkevich 1841** — Григорій Ількевич, *Галицкіи приповѣдки и загадки*.
- **Bobkova** — В.І. Бобкова та ін. (упоряд.), *Українські народні прислів'я та приказки* (modern Ukrainian; full book, 5,613 proverbs, tesseract-OCR'd from the source PDF). Modern collection, so `modern_text` = `text`. See `expand/REPORT.md`.
- **Nomis 1864** — Матвій Номис, *Українські приказки, прислів'я і таке інше* (1864; public-domain; 9,785 proverbs). The foundational 19th-c. collection, OCR'd (per-column crop + tesseract) from the scan and LLM-extracted from its critical apparatus. `text` preserves the original 1864 orthography; `modern_text` is the modernized form. **Best-effort (~75–80%):** OCR character errors persist in `text` and a small fraction may be LLM-normalized toward familiar forms (measured ~95%+ faithful-to-OCR; see `expand/REPORT.md`). The source PDF is not vendored (29 MB; re-fetchable — provenance in `expand/REPORT.md`).

## Rebuild
```bash
pip install -r requirements.txt
python fetch.py      # refresh data/sources snapshots
python build.py      # regenerate corpus.csv + corpus.json
python -m pytest     # run the test suite
```

## Known limitations
- Variant groups are link-only (non-destructive): records are grouped by fuzzy similarity (rapidfuzz `token_set_ratio` ≥ 85), never merged; groups larger than 8 are dissolved to curb over-linking. Final: 5064 groups.
- Categorization is best-effort, single-pass: a quality audit (n=40) found modern_text ~95% acceptable and category tags ~85% acceptable (~15% debatable/wrong, usually secondary tags or themes outside the 27-key vocabulary). The primary category tag is the most reliable.

## Support

verba is a non-commercial, open-data project — the site, API, and Telegram bot are free. Donations fund its growth: native-speaker audio for the proverbs, new sources, and dialectal variants.

- 🌾 **monobank** (card / Apple Pay / Google Pay): https://send.monobank.ua/jar/7mzPGnKyQr
- ☕ **Ko-fi:** https://ko-fi.com/dmytroyemelianov
- See [verbacorpus.org/about#support](https://verbacorpus.org/about#support).

## Stats (last build)
- Total entries: 48787 (100% categorized; Nomis 1864 ingested)
- With explanation: 30532
- With modern_text: 48787
- Variant groups: 5064 (2638 contain Nomis variants linked to other sources)
- Per source: Franko1901 30906, Nomis1864 9785, Bobkova 5613, Ilkevich1841 2702, Mlodzynskyi2009 2261
- Top categories: emotion_mood, idiom_expressive, wisdom_folly, work_labor, animals
