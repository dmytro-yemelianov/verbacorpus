# Хендовер: Verba API, картки й «гачки» — оновлено 2026-11-26 22:59 EET

Для наступного агента (Gemini / Codex). Читай цей файл повністю перед будь-якою дією.
Мова роботи з Дмитром — українська. Рішення, які змінюють продакшн (злиття, розгортання, DNS, нові репо),
— тільки після явного «так» Дмитра.

## 1. Навіщо все це

Verba Corpus — парасолька національних корпусів: `pro` прислів'я, `contra` «Українська без табу»,
`para` шрифти Nasinnia, `non` орнаменти UPA. Мета Дмитра — **догфудинг**: власні продукти (сайт, Telegram-бот,
картки для соцмереж) беруть дані тільки через публічне API, а не через знімки/копії. Пріоритети: публікації в
соцмережі, парасолька, сайт UPA.

Документи (у цьому репо, гілка `main`):
- Спека: `docs/superpowers/specs/2026-11-25-verba-api-design.md` (§5.3 права, §6 картки, §8, §9 порядок).
- План 1 (виконано): `docs/superpowers/plans/2026-11-26-verba-api-foundation.md`.
- План 2 (виконано): `docs/superpowers/plans/2026-11-26-verba-cards.md`.
- Експлуатація: розділ «Verba API» у `docs/CORPORA-HANDOVER.md`; `gateway/README.md`.
- Журнали виконання з усіма рішеннями й відкладеними дрібницями: `ledger-plan1.md`, `ledger-plan2.md` поруч із цим файлом.

## 2. Що живе зараз

| Що | Де | Як розгортається |
|---|---|---|
| Шлюз `verba-api` | `https://api.verbacorpus.org` (+ `verba-api.miwaniza.workers.dev`), код `gateway/` | **вручну**: `cd gateway && npm ci && npx vitest run && npx wrangler deploy`; відкат `npx wrangler rollback`. Остання версія `3a644087`. |
| Verba Worker `ukr-proverbs-corpus` | verbacorpus.org, pro./contra./re./para. | **CI при пуші в `main`** (`.github/workflows/ci.yml`, разом з UPA і non.verba) |
| UPA `upa-local-preview` | non.verbacorpus.org/upa | CI Verba (закріплена ревізія приватного UPA) |
| Nasinnia `nasinnia` | `nasinnia.miwaniza.workers.dev` | вручну з `~/github/nasinnia` (`npm run deploy`); приватний репо `dmytro-yemelianov/nasinnia` |

Шлюз: `/v1/corpora`, `/v1/{corpus}/meta|items|items/{id}|random`, `/v1/items/{globalId}`, `/v1/random?seed`,
`/v1/cards/{textId}.{png,gif,json}`, `/v1/cards/random.*`, `/v1/openapi.json`, `/v1/docs`. Глобальні ID `<корпус>:<id>`.
Картки рендерить Verba (`/card/render.*`), шлюз проксить через binding `PRO` на `https://pro.verbacorpus.org/card/render.*`.
Шрифт карток — бітмап `para:cozette-13x15` (єдиний з повною абеткою й MIT); рамки — 46 червоно-чорних смуг UPA
(`app/content/card-frames.json`, генерує `app/scripts/curate-card-frames.mjs`). Стібок рамки **не обмежувати** (рішення Дмитра).

## 3. Незмінні обмеження

- Cron Verba тільки `"0 6 * * *"` (новинний вимкнений). Bindings Verba: `AI`, Vectorize `proverbs-bge-m3-v2`, `NEWS_KV`, `UPA`, `FONTS`, `DIAGNOSTICS_LIMITER`, `ASSETS` — не чіпати без потреби.
- Ніяких секретів у git/доках. `editorial/` не комітити.
- Права (§5.3): `pro` CC BY 4.0; `non` і `contra` — `terms-pending` з атрибуцією («Hough, 2025 / Габданк-Рогозинський»; «Л. Ставицька, „Українська мова без табу“»); `contra` у змішаному random і картках — лише за явним запитом; шрифти `metadata-only` не віддають растрів.
- UPA: видимість GitHub, історія, DNS, реєстри пакетів — лише за рішенням Дмитра.

## 4. Над чим працювали, коли зупинились: стилі карток + «гачок»

### 4.1 Рішення Дмитра (зафіксовані)
- **Гачок** (частина тексту, що чіпляє увагу) обирає **модель**, а не правило і не вручну.
- Спершу був макет — зроблено: `styles.html` (відкривається з диска; тим самим шрифтом Nasinnia і рамками UPA).
  Лишаються **8 стилів**: базовий, гачок кольором (A червоний), гачок більший (зачин дрібніше, гачок окремим рядком ×1,6),
  тінь коротка (D на пів пікселя гліфа вниз-праворуч), тінь униз, хрестик (кожен піксель гачка — стібок «х»),
  інверсія (поле D, текст папером, гачок жовтим F), маркер (гачок на червоній смузі, літери папером).
- **Прибрано** (погано): дизеринг (нечитабельно), тінь на 2 пікселі («месиво»), об'ємна тінь, обидва контури.
- **Вирівнювання** — 5 варіантів: по лівому, по центру, по правому, драбинкою вправо, драбинкою вліво.
- Розділові знаки завжди приклеєні до слова; фінальна крапка **прибирається за замовчуванням**.
- Кольори — лише палітра UPA: `A #DC143C`, `C #0047AB`, `D #0A0A0A`, `E #1E7A2E`, `F #E3C20B`, `G #D2691E`, папір `#f4f1e8`, чорнило `#232520`.
- Гарнітури: зараз лише `cozette-13x15`; більше з'явиться після плану 3 (бібліотека шрифтів UPA → Nasinnia).

### 4.2 Дизайн-документ
Дизайн-документ створено й погоджено: `docs/superpowers/specs/2026-11-26-card-styles-and-hooks-design.md`.
У ньому зафіксовані правила валідації, стилі, параметри API та дозвіл на порожній `hook` із `hook_source: "rule"`,
коли в тексті немає жодного фрагмента, який відповідає обмеженням.

### 4.3 Pass C — **завершено для `pro`**
- Усі **488/488 батчів** (`enrich/pass_c/done/`) оброблено: 48 787 записів із `corpus.csv`.
- Використаний безкоштовний Gemini API; остаточна модель — **Gemini 3.1 Flash-Lite**. Ключ читається з macOS Keychain
  (`VerbaCorpus Pass C Gemini`) або `GEMINI_API_KEY`; секрет не зберігати в репозиторії чи логах.
- Gemini 4 Hydrogen не був обмежений квотою: квота в AI Studio була доступна, але API повертав HTTP 503 через завантаження
  сервера; одна відповідь GenerateContent мала невалідний JSON. Gemini 3.5 Flash-Lite також повернув HTTP 503.
  Gemini 2.5 Flash-Lite повернув 404 як недоступна новим користувачам. На 3.1 Flash-Lite прогін завершився.
- 1 001 невалідний hook у 277 пакетах пройшов груповий ремонт. Після ремонту — **0 порушень**; джерела: 48 647 `model`,
  140 `rule`, включно з одним порожнім hook, для якого валідного фрагмента не знайшлося.
- Дані вже злиті у `corpus.csv`, `corpus.json` та `app/public/data/proverbs.json`. Скрипт злиття:
  `enrich/merge_pass_c.py`. Перевірка цілісності підтвердила по 48 787 записів у кожному експорті, однакові поля й відсутність
  проблем аудиту. Не запускати Pass C повторно з початку; runner має відновлюватися з наявних checkpoint-ів.
- Neon і Carbon — платні API-моделі; Argon не доступний на Free tier. Для безкоштовного продовження не перемикати модель
  на них без окремого погодження витрат. Квоти на скриншоті Дмитра: Gemini 3.1 Flash Lite — 15 RPM / 500 RPD,
  Hydrogen — 5 RPM / 20 RPD, Flash Lite 3.5 — 15 RPM / 500 RPD.
- `contra` в цьому Pass C **не збагачувався**.

### 4.4 Реалізація стилів карток і API — **код готовий, реліз не робився**
- Verba `app/src/card/`: 8 стилів (`base`, `color`, `big`, `shadowS`, `shadowD`, `stitch`, `invert`, `marker`),
  5 вирівнювань (`left`, `center`, `right`, `stairR`, `stairL`), `hook=auto|none|<рядок>`, перевірка `invalid_hook`,
  нерозривне `\u00A0—` і приховування фінальної крапки.
- Gateway: `style`, `align`, `hook` прокидаються до Verba; для випадкових карток стиль та вирівнювання детерміновані за
  `seed`; OpenAPI оновлено.
- Раніше прогнані результати: Verba `card-render.test.ts` — 48/48; gateway — 103/103 локальних, 8 live-тестів пропущено.
  **У цій сесії після завершення злиття не запускати тестовий набір автоматично**; окремо перевірити його перед наступним
  релізним кроком, якщо Дмитро попросить.
- Зразки карток: `/Users/dmytro/.gemini/antigravity-cli/brain/2c49ae0c-9337-4089-a85c-a3650f2bfeca/`
  (`sample-color-left.png`, `sample-big-center.png`, `sample-shadowS-left.png`, `sample-stitch-stairR.png`,
  `sample-invert-center.png`, `sample-marker-right.png`; `card-samples.md` у тій самій теці).
- Код і дані поки локальні/незакомічені. **Не робити push, PR, merge чи deploy без окремого явного рішення Дмитра.**

### 4.5 Наступні кроки
1. Продовжити з локального стану; не повторювати вже завершений Pass C.
2. Якщо Дмитро попросить іти до релізу — переглянути diff та свіжі результати тестів для `app/` і `gateway/`, після чого
   підготувати конкретний PR/деплой-крок. Gateway розгортається вручну, Verba — через CI.
3. Окремими майбутніми роботами лишаються план 3 (бібліотека шрифтів UPA → Nasinnia) і план 4 (сайт та бот читають
   прислів'я через шлюз замість локальних JSON snapshot-ів).

## 5. Відомі проблеми й відкладене

- Нестабільні тести CI (перезапуск проходив): WebKit-тест рамки з reduced motion в UPA (`e2e/verba/integration.e2e.ts:232`).
  `app/test/corpus-loading.test.ts` полагоджено (ледачий імпорт contra + 20 с), але стежити.
- Бот: помилка `editMessageMedia` (напр. «not modified», 429) запускає запасний шлях → можливий дубль повідомлення.
  Inline-мініатюри (`thumb_url`) без запасного шляху.
- Якщо одночасно впали Nasinnia і запасний рендер PT Serif — картка 500.
- Seed-кеш шлюзу (Cache API) тримає seeded `random` добу — після зміни рендера старі seed'и показують старе.
- Описані вище код та збагачені експорти ще не пройшли окремий релізний цикл; статус публікації не змінювався.
- Повний список дрібниць — у `ledger-plan1.md` / `ledger-plan2.md` (рядки «minor (deferred)» і «Parked»).

## 6. Пастки середовища (Мак Дмитра)

- Локальний DNS може кешувати NXDOMAIN для `api.verbacorpus.org` → `curl --resolve api.verbacorpus.org:443:104.21.88.29 …`
  (у zsh масив аргументів не розбивається — писати такі виклики в bash-скрипт).
- `ls` — аліас без виводу в non-tty → `/bin/ls`.
- GitHub: `gh auth switch -u dmytro-yemelianov` перед `gh` для цього репо.
- Vitest (pool-workers) не стартує, коли накопичились старі `workerd` — вбивати лише свої зависші процеси.
- `npm run build` в `app/` переписує `app/public/chrome.js` — не комітити цей шум.
- Хаб `stos` (MCP): журнал у `.stos/journal.md`, `.stos/` у git exclude.

## 7. Вміст цієї теки та інструменти Pass C

| Файл | Що |
|---|---|
| `docs/superpowers/specs/2026-11-26-card-styles-and-hooks-design.md` | погоджена специфікація Pass C та стилів карток |
| `enrich/pass_c.py`, `enrich/pass_c_gemini_api.py` | resumable runner і Gemini API transport |
| `enrich/pass_c/` | збережені batch checkpoints і ремонти; не видаляти для повторного запуску |
| `enrich/merge_pass_c.py` | злиття hook-полів у три corpus exports |
| `styles.html`, `hooks-compare.html`, `frames-preview.html` | макети й порівняння попередніх експериментів |
| `ledger-plan1.md`, `ledger-plan2.md` | журнали реалізації планів Verba API та карток |

`docs/handover/` та поточні зміни репозиторію ще не закомічені. `.stos/` уже додано до `.git/info/exclude`;
`.gitignore` не змінювати. У цій сесії MCP/CLI `stos` не був доступний, тож `whereami` і вхідну скриньку перевірити
не вдалося; `.stos/journal.md` оновлено вручну.
