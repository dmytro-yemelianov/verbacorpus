---
title: "verba на Hugging Face: завантаження й використання корпусу"
slug: verba-na-hugging-face
date: 2026-06-24
lede: Корпус verba тепер опубліковано на Hugging Face як відкритий набір даних. Показуємо, як завантажити його через бібліотеку datasets, pandas, CLI hf чи DuckDB — і одразу почати працювати.
---
Корпус **verba** тепер доступний на [Hugging Face](https://huggingface.co/datasets/dmytro-yemelianov/verba) — найбільшому хабі наборів даних для машинного навчання та NLP. Це означає, що завантажити всі 48 787 прислів'їв і почати з ними працювати можна буквально одним рядком коду, без реєстрації, ключів чи ручного скачування файлів.

У цій статті — чотири способи дістати корпус (бібліотека `datasets`, `pandas`, CLI `hf` та SQL-запити через DuckDB) і кілька прикладів того, що з ним робити далі.

---

## Що опубліковано

Сторінка набору даних: **[huggingface.co/datasets/dmytro-yemelianov/verba](https://huggingface.co/datasets/dmytro-yemelianov/verba)**.

У репозиторії лежать чотири файли:

* `corpus.csv` — канонічний корпус: **48 787 записів, 10 колонок**. Це сплит `train`, який автоматично показує переглядач даних і завантажує бібліотека `datasets`.
* `sources.csv` — реєстр п'яти джерел (бібліографія).
* `croissant.json` — метадані у стандарті MLCommons Croissant для ML-пайплайнів.
* `README.md` — повна [карта даних](https://github.com/dmytro-yemelianov/verbacorpus/blob/main/DATACARD.md) (методологія, межі якості, ліцензія).

Набір **публічний** і поширюється на умовах **CC BY 4.0** (упорядкування та збагачення); історичні тексти — у суспільному надбанні. Жодних токенів для читання не потрібно.

---

## 1. Бібліотека `datasets` (Python)

Найпростіший спосіб для дослідників і ML-інженерів:

```python
from datasets import load_dataset

ds = load_dataset("dmytro-yemelianov/verba", split="train")
print(len(ds))                       # 48787
print(ds[0]["text"], "→", ds[0]["modern_text"])

# відібрати прислів'я певної теми
work = ds.filter(lambda r: "work_labor" in (r["category"] or ""))
print(len(work))
```

Для великих обсягів або обмеженої пам'яті вмикайте потокове читання — дані тоді не зберігаються на диск:

```python
ds = load_dataset("dmytro-yemelianov/verba", split="train", streaming=True)
for row in ds.take(5):
    print(row["modern_text"])
```

---

## 2. `pandas` напряму з Hub

Якщо звичніше працювати з таблицями, читайте CSV прямо з хабу через протокол `hf://` (потрібен встановлений пакет `huggingface_hub`):

```python
import pandas as pd

df = pd.read_csv("hf://datasets/dmytro-yemelianov/verba/corpus.csv")

# 10 найчастіших тем
df["category"].str.split(";").explode().value_counts().head(10)
```

---

## 3. CLI `hf` — локальна копія

Щоб завантажити набір даних на диск (наприклад, для офлайн-обробки чи навчання моделі), скористайтеся офіційним інструментом `hf`:

```bash
# встановлення CLI (один раз)
curl -LsSf https://hf.co/cli/install.sh | bash -s

# увесь репозиторій набору даних у теку ./verba
hf download dmytro-yemelianov/verba --repo-type dataset --local-dir ./verba

# або лише один файл
hf download dmytro-yemelianov/verba corpus.csv --repo-type dataset --local-dir ./verba
```

---

## 4. SQL без завантаження (DuckDB)

Hugging Face автоматично конвертує корпус у формат **Parquet**, тож можна виконувати аналітичні запити, не качаючи весь файл. Адресу Parquet-файлів підкаже команда:

```bash
hf datasets parquet dmytro-yemelianov/verba
```

А далі — звичайний SQL через DuckDB прямо з CLI:

```bash
hf datasets sql "SELECT category, COUNT(*) AS n
  FROM read_parquet('https://huggingface.co/api/datasets/dmytro-yemelianov/verba/parquet/default/train/0.parquet')
  GROUP BY category ORDER BY n DESC LIMIT 10"
```

---

## Схема та поля

Кожен рядок — одне прислів'я. Колонки `corpus.csv`:

| Колонка | Значення |
|---|---|
| `id` | Стабільний ідентифікатор (`pNNNNNN`) |
| `text` | Дослівний текст в оригінальному правописі джерела |
| `normalized_text` | Ключ для зіставлення (нижній регістр, без пунктуації) |
| `modern_text` | Сучасний стандартний правопис (згенеровано ШІ) |
| `keyword` | Лема/гасло (Франко), якщо є |
| `explanation` | Наукове пояснення (переважно з Франка), очищене |
| `category` | 1–3 теми з 27-темної таксономії, через `;`, головна — перша |
| `sources` | Ключі джерел, через `;` |
| `source_refs` | Покликання в межах джерела, через `;` |
| `variant_group` | Ідентифікатор групи ймовірних діалектних варіантів |

---

## Ліцензія та цитування

* **Упорядкування та збагачення** (структура, сучасне написання, теми, групи варіантів) — **CC BY 4.0**.
* **Історичні тексти** (Ількевич 1841, Номис 1864, Франко 1901) — суспільне надбання.
* **Сучасні збірки** (Бобкова, Млодзинський 2009) — під авторським правом упорядників; включені для наукового та освітнього використання з атрибуцією в полі `sources`.

Як цитувати:

> *Yemelianov, Dmytro (2026). verba — Ukrainian Proverbs Corpus (v1.0.2). URL: https://verbacorpus.org.*

---

## Що далі

* Інші формати, REST API та правила цитування — у статті [«Відкриті дані: як користуватися корпусом»](/blog/vidkryti-dani).
* Повна [документація API](/api.html) з прикладами `curl`.
* Вихідний код і релізи — на [GitHub](https://github.com/dmytro-yemelianov/verbacorpus).
