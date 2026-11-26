# Verba — картки й орнаменти через API: план реалізації

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Картка = рецепт (текст `pro`/`contra` + рамка-орнамент `non` + шрифт `para`), що рендериться PNG/GIF у Verba і віддається через `api.verbacorpus.org/v1/cards`; Verba бере орнаменти тільки з API UPA, шрифт — з Nasinnia; старі бордюри, архів `dyco` і піксельні іконки прибрано.

**Architecture:** Рендер лишається у Worker Verba (`app/`): новий конвеєр малює RGBA-кадр — бітмап-текст із гліфів Nasinnia (новий binding `FONTS`) і верхню/нижню смуги з `unitCell` орнаментів UPA (наявний binding `UPA`) — і кодує PNG/GIF наявними `upng-js`/`gifenc`. Шлюз (`gateway/`) додає `/v1/cards…`: валідує рецепт, віддає JSON або проксить бінарну відповідь Verba через `PRO`, і кешує GET-відповіді Cache API.

**Tech Stack:** Cloudflare Workers, TypeScript, wrangler 4, vitest (`@cloudflare/vitest-pool-workers` в `app/`, node в `gateway/`), `upng-js`, `gifenc`.

**Spec:** `docs/superpowers/specs/2026-11-25-verba-api-design.md` (§5.3 права, §6 картки, §8, §9 крок 4). План 1 — `docs/superpowers/plans/2026-11-26-verba-api-foundation.md` (виконано).

**Поза цим планом:** перехід браузерного клієнта й бота на дані прислів'їв через шлюз (§9 крок 6, окремий план 4); бібліотека шрифтів UPA → Nasinnia (план 3).

## Global Constraints

- Новинний cron Verba вимкнений; у `app/wrangler.jsonc` тільки `"0 6 * * *"`. Наявні bindings (`AI`, Vectorize `proverbs-bge-m3-v2`, `NEWS_KV`, `UPA`, `DIAGNOSTICS_LIMITER`, `ASSETS`) не змінюються; додається лише `FONTS` → `nasinnia`.
- Наявні `/card/<id>.png`, `/card/<id>.gif`, `/card/daily.png` (з `format`, `lang`, `minimal`, `nochrome`) відповідають 200 з тим самим `content-type`; вигляд оновлюється на новий конвеєр.
- Шрифт карток за замовчуванням — бітмап з Nasinnia `para:cozette-13x15` (єдиний з повною абеткою + `’` і MIT); PT Serif — параметром `font=pt-serif` і запасним, якщо Nasinnia недоступна. Відсутній гліф малюється явно (запасний гліф Nasinnia, `includeMissing=true`), не пропускається.
- Рамка — верхня й нижня смуги з `unitCell` орнаменту UPA, що повторюється по ширині (як нині `paintBorders`); бічних рамок немає.
- Палітра UPA (`A #DC143C`, `C #0047AB`, `D #0A0A0A`, `E #1E7A2E`, `F #E3C20B`, `G #D2691E`); фон `B` малюється кольором паперу картки `#f4f1e8`.
- Права за §5.3: на кожній картці атрибуція всіх трьох складників дрібним рядком унизу (текст / «Hough, 2025 / Габданк-Рогозинський» / автор шрифту); `contra` у картках — лише за явним `text=contra:…`; шрифти `metadata-only` → 422.
- `editorial/` не комітиться; жодних секретів у git.
- Коміти англійською з рядками атрибуції сесії; push/PR/злиття/розгортання — за погодженим порядком з Дмитром.

## Review Focus

1. **Текст довший за картку** (160 символів у `story` і в `sticker` 512²) — переноситься по словах, масштаб гліфа зменшується до мінімуму 2, решта обрізається з «…»; ніколи не виходить за смуги. → тест у Task 1.
2. **Nasinnia або UPA недоступні під час рендеру** — картка все одно 200: шрифт падає на PT Serif, рамка — на суцільну смугу кольору `A`; заголовок `x-verba-degraded: font|frame`. → тест у Task 3.
3. **Символи поза шрифтом** (емодзі в `contra`, лапки «», апостроф `ʼ` U+02BC) — малюється запасний гліф, рендер не падає. → тест у Task 1.
4. **Орнамент із `unitCell` 1×1 або вищий за смугу** — рапорт масштабується цілим кроком так, щоб висота ≤ смуги; 1×1 дає суцільну смугу. → тест у Task 2.
5. **Повторний той самий рецепт** — байт-у-байт однаковий PNG (детермінованість для кешу й `seed`). → тест у Task 3.

---

### Task 1: Бітмап-текст із гліфів Nasinnia

**Files:**
- Create: `app/src/card/bitmap-text.ts`, `app/src/card/glyphs.ts`
- Modify: `app/wrangler.jsonc`, `app/wrangler.non.jsonc`, `app/wrangler.preview.jsonc` (лише додати `{ "binding": "FONTS", "service": "nasinnia" }` у `services`), `app/worker-configuration.d.ts` / `Env` (поле `FONTS?: Fetcher`)
- Test: `app/test/bitmap-text.test.ts`, `app/test/fixtures/glyphs-cozette.json` (знімок реальної відповіді для «Горе море, а без табу ’…?» + запасний гліф)

**Interfaces:**
- Produces:
  - `interface GlyphSet { fontId: string; cell: { width: number; height: number }; glyphs: Map<string, { advanceX: number; rows: string[] /* bit-matrix "0101…" */ }>; fallback: { advanceX: number; rows: string[] } }`
  - `fetchGlyphs(fonts: Fetcher, fontId: string, text: string): Promise<GlyphSet>` — один запит `GET https://upstream/v1/fonts/{id}/glyphs?chars=<унікальні символи тексту>&representation=bit-matrix&includeMissing=true`; відповідь 403 `LICENSE_RESTRICTED` → `ApiError`-подібна помилка `font_restricted`; мережа/5xx → `font_unavailable`.
  - `layoutText(text: string, g: GlyphSet, box: { width: number; height: number }, opts: { maxScale: number; minScale: 2; lineGap: number }): { scale: number; lines: string[]; truncated: boolean }` — перенос по пробілах, найбільший цілий масштаб ≤ `maxScale`, що вміщує текст; якщо не вміщується на `minScale` — обрізати з «…».
  - `paintText(rgba: Uint8Array, W: number, H: number, layout, g: GlyphSet, origin: { x: number; y: number }, align: "left" | "center", rgb: [number, number, number]): void`

- [ ] **Step 1: Failing tests** — `layoutText` для 160-символьного прислів'я в box 920×600 дає `scale ≥ 3` і всі рядки ≤ ширини; той самий текст у box 440×300 дає `scale === 2` і `truncated === true`, останній рядок закінчується «…»; символ `🍆` і `ʼ` використовують `fallback` (paintText не кидає, пікселі fallback намальовані); порожній текст → 0 рядків. `fetchGlyphs` з фейковим `Fetcher`: один запит, `chars` містить кожен символ рівно раз; 403 → помилка з кодом `font_restricted`.
- [ ] **Step 2: Run** `cd app && npx vitest run test/bitmap-text.test.ts` → FAIL.
- [ ] **Step 3: Implement** за інтерфейсами; фікстуру зняти з `https://nasinnia.miwaniza.workers.dev/v1/fonts/cozette-13x15/glyphs?chars=…&representation=bit-matrix&includeMissing=true`.
- [ ] **Step 4: Run** → PASS; `npm test` зелений; `npx wrangler deploy --dry-run` показує binding `env.FONTS (nasinnia)` і cron `0 6 * * *`.
- [ ] **Step 5: Commit** `feat(cards): bitmap text from Nasinnia glyphs`.

### Task 2: Смуги-орнаменти з UPA і курований список рамок

**Files:**
- Create: `app/src/card/ornament.ts`, `app/content/card-frames.json`, `app/scripts/curate-card-frames.mjs`
- Test: `app/test/ornament.test.ts`, `app/test/fixtures/upa-band.json` (реальна відповідь `/api/v1/patterns/{id}` для 2 смуг)

**Interfaces:**
- Produces:
  - `const UPA_PALETTE: Record<"A"|"C"|"D"|"E"|"F"|"G", [number,number,number]>` (hex з Global Constraints); `B` → колір паперу, що передається в painter.
  - `fetchBand(upa: Fetcher, patternId: string): Promise<{ id: string; unit: string[][] /* A–G */ }>` — `GET https://upstream/api/v1/patterns/{encodeURIComponent(id)}`, бере `geometry.unitCell`; 404 → `frame_not_found`; не `kind: "band"` → `frame_not_band`; мережа/5xx → `frame_unavailable`.
  - `paintBand(rgba, W, H, y0: number, band: number, unit: string[][], paper: [number,number,number], phase: number): void` — стібок = `floor(band / unit.length)` (мінімум 1); якщо `unit.length > band` — бере кожен k-й рядок, щоб влізти; рапорт тайлиться по ширині зі зсувом `phase` (як нинішній `paintBorders`).
  - `app/content/card-frames.json`: `{ "version": 1, "frames": ["non:<patternId>", …] }`; `pickFrame(seedKey: string): string` — FNV-1a по `frames`.
  - `scripts/curate-card-frames.mjs` — разовий скрипт (мережа дозволена): бере `https://api.verbacorpus.org/v1/non/items?kind=band&include=geometry` усіма сторінками, відбирає `3 ≤ висота unitCell ≤ 12`, `2 ≤ ширина ≤ 40`, `colors ⊆ {A, D}`, сортує за ID і пише файл. Запустити один раз і закомітити результат.

- [ ] **Step 1: Failing tests** — `fetchBand` з фікстури повертає `unit` з символами лише A–G; не-band → `frame_not_band`; `paintBand` з `unit=[["D"]]` заливає всю смугу `#0A0A0A`; unit висотою 12 у band 8 вміщується (жоден піксель поза `[y0, y0+band)`); `phase` зсуває рапорт; `B`-клітинки = колір паперу; `pickFrame` детермінований і повертає елемент списку.
- [ ] **Step 2: Run** `npx vitest run test/ornament.test.ts` → FAIL.
- [ ] **Step 3: Implement**; запустити `node scripts/curate-card-frames.mjs`; у файлі ≥ 20 рамок.
- [ ] **Step 4: Run** → PASS; `npm test` зелений.
- [ ] **Step 5: Commit** `feat(cards): UPA band ornaments and curated frame list`.

### Task 3: Конвеєр картки за рецептом і маршрути Verba

**Files:**
- Create: `app/src/card/recipe.ts`, `app/src/card/render.ts`
- Modify: `app/src/card-gif.ts` (перейти на `render.ts`; `compositeOver` для PT Serif-запасу лишається), `app/src/index.ts` (маршрути `/card/*`), `app/src/telegram.ts` і `scheduled()` у `index.ts` (URL фото)
- Test: `app/test/card-render.test.ts`; оновити `app/test/cards-api.test.ts`, `app/test/telegram.test.ts`

**Interfaces:**
- Consumes: Task 1 (`fetchGlyphs`, `layoutText`, `paintText`), Task 2 (`fetchBand`, `paintBand`, `pickFrame`).
- Produces:
  - `interface Recipe { text: string /* "pro:<id>" | "contra:<id>" */; frame: string /* "non:<id>" */; font: string /* "para:<id>" | "pt-serif" */; size: "fb" | "square" | "story" | "yt" | "sticker" | "telegram"; lang: "uk" | "en" }`
  - `parseRecipe(qp: URLSearchParams, defaults: { seedKey: string }): Recipe` — `text` обов'язковий; `frame` за замовчуванням `pickFrame(seedKey)`; `font` за замовчуванням `para:cozette-13x15`; `size` за замовчуванням `fb`; невідомі значення → 400 `invalid_request`.
  - `renderCard(recipe: Recipe, env, host: string, out: { format: "png" | "gif" | "json"; minimal?: boolean; nochrome?: boolean }): Promise<Response>` — `json` повертає `{ recipe, attribution: string[], degraded: string[] }`; PNG/GIF — зображення з атрибуцією рядком унизу; деградація за Review Focus 2 із заголовком `x-verba-degraded`.
  - Маршрути: `GET /card/render.{png,gif,json}?text&frame&font&size&lang` (новий); `GET /card/<id>.{png,gif}` і `/card/daily.png` будують `Recipe` з `text: "pro:<id>"`, `size` з `format` і далі через `renderCard`. `contra:` у `text` — дозволено (явний запит); дані запису беруться з наявного `contra-api.ts`.
  - Telegram: `scheduled()` і `sendRandomCard` беруть фото з `${env.VERBA_API_BASE ?? "https://api.verbacorpus.org"}/v1/cards/pro:<id>.png?size=telegram`.

- [ ] **Step 1: Failing tests** — `renderCard` з фейковими `FONTS`/`UPA` і фікстурами: PNG декодується `UPNG`, розмір 1200×630 для `fb`, 1080×1920 для `story`, 512×512 для `sticker`; пікселі верхньої смуги мають колір з `UPA_PALETTE`; два виклики з тим самим рецептом дають однакові байти (RF5); `FONTS` кидає → 200, `x-verba-degraded: font`; `UPA` кидає → 200, `x-verba-degraded: frame`; `format=json` містить 3 рядки атрибуції, серед них «Hough, 2025 / Габданк-Рогозинський»; `font=para:<metadata-only>` → 422. Старі `/card/p1.png?format=square` і `/card/daily.png` → 200 `image/png`. Telegram: URL фото починається з `https://api.verbacorpus.org/v1/cards/pro:`.
- [ ] **Step 2: Run** `npx vitest run test/card-render.test.ts test/cards-api.test.ts test/telegram.test.ts` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test` → PASS; `npx wrangler deploy --dry-run` — bindings і cron без змін, крім `FONTS`.
- [ ] **Step 5: Commit** `feat(cards): recipe pipeline with Nasinnia text and UPA frames`.

### Task 4: Прибрати старі орнаменти; CSS і мотиви — з API

**Files:**
- Delete: `app/public/data/embroidery-archive.json`, `app/scripts/build-embroidery-archive.mjs`; з `app/src/shader/embroidery.ts` — масив `BORDERS`, `pickBorder`, `paintBorders` (файл видалити, якщо нічого не лишилось); з `app/src/shader/vyshyvanka.ts` лишити тільки `compositeOver` (і те, що він потребує)
- Modify: `app/src/embroidery-css.ts` → генерує CSS з UPA-смуг за `TOKENS` (`a`, `b`, `c` → ID з `card-frames.json`, перші три) і віддається Worker'ом `GET /embroidery.css` (через `UPA` binding, `cache-control: public, max-age=86400`; при недоступності UPA — мінімальний CSS без орнаментів, 200); прибрати запис `public/embroidery.css` з `app/build.mjs` і сам файл; `public/sw.js` — не кешувати `/embroidery.css` як статичний ассет назавжди (мережа-спершу)
- Modify: `app/src/client/main.ts:503-520` — `loadMotifs()` бере `https://api.verbacorpus.org/v1/non/random?n=20&kind=band&include=geometry&seed=<дата>` і будує SVG з `data.geometry.unitCell` у палітрі UPA; збій мережі → без мотивів
- Test: оновити/замінити `app/test/embroidery.test.ts`, `app/test/embroidery-css.test.ts`, `app/test/vyshyvanka.test.ts`, `app/test/octagrams.test.ts`

- [ ] **Step 1: Failing tests** — `GET /embroidery.css` з фейковим `UPA` → 200 `text/css`, містить три токени й 8 UI-іконок (`heart, link, image, moon, sun, search, check, leaf`); без `UPA` → 200 `text/css` без `--embroidery-` смуг; у репо немає `embroidery-archive.json` і жодного `upa_[0-9a-f]{16}` у `app/src` (тест-сканер по дереву файлів не потрібен — достатньо `git grep` у Step 4).
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test` → PASS; `npm run build` без мережі успішний; `git grep -nE "upa_[0-9a-f]{16}|embroidery-archive|/home/dmytro/github/dyco" -- app` → порожньо.
- [ ] **Step 5: Commit** `refactor(ornaments): take ornaments only from the UPA API`.

### Task 5: Прибрати піксельні іконки

**Files:** (повний перелік з розвідки)
- Delete: `app/content/pixel-icons.json`, `app/public/non/icons.json`, `app/public/non/icons.svg`, `app/public/non/icons/*`
- Modify: `app/build_corpora.mjs` (рядки імпорту `validateIcon, iconSvg, iconPng`, завантаження/валідація, `mkdir public/non/icons`, запис файлів, лог кількості), `app/catalog.mjs` (`validateIcon`, `iconSvg`, `crc32`/`chunk`, `iconPng` — якщо більше ніде не використовуються), `app/test-catalog/catalog.test.mjs` (тести іконок), `app/src/shared/directions.ts:9` (правило `/icons`), `app/test/directions.test.ts:31`, `app/test/site-addresses.test.ts:45` (+ відповідне правило в `site-addresses.ts`, якщо є), `docs/umbrella-http.json:58-63`, `docs/CORPORA-HANDOVER.md` (згадки іконок → «прибрано 2026-11-26, повернемось окремим проєктом»)
- Не чіпати: `app/public/icons/*` і `manifest.webmanifest` (іконки застосунку), UI-іконки в `embroidery-css.ts`.

- [ ] **Step 1:** `git grep -nE "pixel-icons|non/icons|iconPng|iconSvg|validateIcon"` — зафіксувати перелік у звіті.
- [ ] **Step 2:** Видалити/змінити за переліком.
- [ ] **Step 3: Run** `npm run build && npm test` (включно з `test:catalog`) → PASS; повторний `git grep` → порожньо (крім історичних згадок у `docs/superpowers/`).
- [ ] **Step 4: Commit** `chore(non): remove pixel icons for now`.

### Task 6: Картки в шлюзі й Cache API

**Files:**
- Create: `gateway/src/cards.ts`, `gateway/src/cache.ts`
- Modify: `gateway/src/router.ts`, `gateway/src/index.ts` (передати `ctx` у кеш, **не** як третій аргумент `handle`), `gateway/src/random.ts` (позначати деградацію), `gateway/src/openapi.ts`, `gateway/README.md`
- Test: `gateway/test/cards.test.ts`, `gateway/test/cache.test.ts`, доповнити `gateway/test/openapi.test.ts`, `gateway/test/entry.test.ts`

**Interfaces:**
- Consumes: Verba `GET /card/render.{png,gif,json}` (Task 3); `parseGlobalId`, `LICENCES`, адаптери.
- Produces:
  - Маршрути: `GET /v1/cards/{textId}.{png,gif,json}?frame&font&size&lang` і `GET /v1/cards/random.{png,gif,json}?seed&size&corpus` (`corpus` ∈ `pro`, `contra`; за замовчуванням `pro`; `contra` — лише явно).
  - Валідація до апстріму: `textId` корпусу `pro|contra`, `frame` — `non:*`, `font` — `para:*` або `pt-serif`, `size` з переліку Task 3; інакше 400. Шрифт `metadata-only` (через para-адаптер) → 422 `font_restricted`.
  - Проксі: `env.PRO.fetch(new Request("https://verbacorpus.org/card/render.<ext>?…"))` (хост `verbacorpus.org` — для QR і короткого посилання), тіло й `content-type` без змін, плюс CORS, `x-verba-degraded` прокидається; таймаут 15 с → 503.
  - `random.*`: обирає запис через наявний `pickRandom` з `seed`, далі як звичайна картка; відповідь має `x-verba-seed`.
  - `cache.ts`: `withCache(request: Request, ctx: ExecutionContext, fn: () => Promise<Response>): Promise<Response>` — лише GET, лише 200, лише якщо відповідь має `cache-control: public…` і **не** має `x-verba-degraded`; ключ — повний URL. `index.ts`: `fetch(request, env, ctx) { return withCache(request, ctx, () => handle(request, env)); }`.
  - Закриті запаркованi пункти плану 1: деградований змішаний `random` (пропущений корпус) → `cache-control: no-store` і `x-verba-degraded: <corpus>`; у змішаному `random` толерувати будь-яку помилку корпусу, не лише `ApiError`.

- [ ] **Step 1: Failing tests** — `cards.test.ts`: `/v1/cards/pro:p1.png?size=square` проксить на `https://verbacorpus.org/card/render.png?text=pro%3Ap1&size=square…` і віддає `image/png` + CORS; `/v1/cards/contra:x.json` дозволено; `/v1/cards/random.png` без `corpus` ніколи не дає `contra` (5 seed'ів); `font=para:<metadata-only>` → 422; `frame=pro:1` → 400; апстрім висить → 503. `cache.test.ts` (фейковий `caches.default`): друга однакова GET-відповідь іде з кешу; відповідь з `x-verba-degraded` або `no-store` не кешується; POST не кешується. `entry.test.ts`: експорт з `ctx` усе ще будує адаптери (регресія плану 1). OpenAPI містить шляхи карток.
- [ ] **Step 2: Run** `cd gateway && npx vitest run` → FAIL. **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run && npx tsc --noEmit && npx wrangler deploy --dry-run` → PASS.
- [ ] **Step 5: Commit** `feat(gateway): card recipes, Cache API, degraded-mix fixes`.

### Task 7: Розгортання й перевірка наживо

- [ ] **Step 1:** PR `feat/verba-cards` → `main`; після зеленого CI злиття розгортає Verba (з binding `FONTS`) і UPA. Перевірка: `/card/p037464.png?format=square` → 200 PNG з бітмап-текстом і рамкою UPA (переглянути зображення); `/card/render.json?text=pro:p037464` → 3 атрибуції; `/embroidery.css` → 200 `text/css`.
- [ ] **Step 2:** Шлюз: `cd gateway && npx wrangler deploy`; `GATEWAY=https://api.verbacorpus.org npx vitest run test/live.test.ts` (доповнити живим тестом `/v1/cards/random.json?seed=live` і `/v1/cards/pro:p037464.png` → `image/png`).
- [ ] **Step 3:** Зберегти по одній картці кожного розміру в `docs/cards-samples/` (PNG) для перегляду Дмитром; оновити розділ «Verba API» у `docs/CORPORA-HANDOVER.md` (картки, `FONTS`, кураторський список рамок і як його перегенерувати).
- [ ] **Step 4:** Наступний ранковий пост Telegram (06:00 UTC) — перевірити, що фото прийшло з `api.verbacorpus.org` (лог Worker'а `ukr-proverbs-corpus`), нічого вручну в канал не надсилати.
