# План 3: Бібліотека шрифтів UPA → Nasinnia

> **Ціль:** Зробити сервіс Nasinnia єдиним джерелом правди для всіх растрових шрифтів (2 266 записів, зокрема 319 з растрами, 22 шрифти рамок, 13 українських переглянутих гарнітур). Перемкнути `para.verbacorpus.org/fonts` на Nasinnia, зберегти старі ID UPA як псевдоніми (аліаси), відкрити для карток Verba нові українські гарнітури.

**Специфікація:** [docs/superpowers/specs/2026-11-25-verba-api-design.md](docs/superpowers/specs/2026-11-25-verba-api-design.md) (§5.3 права, §6 картки, §8, §9 крок 5).  
**Пов'язані документи:** [docs/TEXTED-FONTS.md](docs/TEXTED-FONTS.md) (в `upa-archive`), [nasinnia/README.md](https://github.com/dmytro-yemelianov/nasinnia).

---

## 1. Контекст і вихідні дані

1. **Поточний стан Nasinnia (`nasinnia`):**
   - 2 261 шрифт у каталозі:
     - 1 947 Hoard metadata-only записів (вже присутні).
     - 305 Oldschool CP437 OTB шрифтів.
     - 5 шрифтів з українською кирилицею: `cozette-13x15`, `spleen-6x12`, `spleen-8x16`, `spleen-12x24`, `spleen-16x32`.
   - Архітектура: Worker з прив'язками до D1 (`nasinnia-catalog`) та R2 (`nasinnia-fonts`), локальний статичний fallback у `src/catalog.js`.

2. **Поточний стан UPA Font Library (`upa-archive/data/font-library`):**
   - 2 266 записів в `index.json`. 313 з 319 доступних растрових файлів вже збігаються з Nasinnia за ID.
   - Відсутні в Nasinnia 6 специфічних Texted-шрифтів: `texted-bios_8x8`, `texted-ega_8x14`, `texted-vga_8x16`, `texted-spleen_6x12`, `texted-spleen_8x16`, `public-domain-8x8-demo`.
   - 13 переглянутих українських похідних гарнітур з повним набором українських літер (Є/є, Ї/ї, Ґ/ґ, Й/й тощо) у `data/font-reviews.json`:
     `amstrad-pc`, `creep-7x12`, `spleen-12x24`, `spleen-16x32`, `ibm-mda`, `master-512-m7-bold`, `compis`, `cl-eagleiii-8x16`, `toshibatxl1-8x16`, `tandy2k`, `wyse700a`, `nec-apc3-8x16`, `phoenixega-8x14`.
   - 2 переглянуті дисплейні гарнітури: `texted_square_8x16`, `texted_cut_8x16`.
   - 22 шрифти рамок із призначенням для оформлення документів.

3. **Обмеження та правила (§5.3, §8):**
   - **Єдине джерело:** `para.verbacorpus.org/fonts` обслуговується сервісом Nasinnia (замість UPA).
   - **Аліаси (псевдоніми):** Усі старі ID з UPA (наприклад `spleen_6x12`, `verba_amstrad-pc`, `bios_8x8`) мають прозоро резолвитися в Nasinnia, щоб збережені документи `upa:document:v1` не ламалися.
   - **Похідні шрифти:** Обов'язкове поле `derivedFrom: "<parent-id>"`, опис змін та ліцензія предка.
   - **Шрифти рамок:** Позначка призначення `tags: [..., "frames"]` або `purpose: "frames"`.
   - **Картки Verba:** Розширення списку доступних українських гарнітур у картках.

---

## 2. Завдання плану

### Task 1: Нормалізація та експорт відсутніх шрифтів з UPA в Nasinnia
- [ ] **1.1. Інструмент експорту:** Скрипт `scripts/export-upa-fonts-to-nasinnia.py` (або ts) для читання `.bin` шрифтів з `upa-archive/data/font-library/faces/` через декодер `decodeLibraryFont` і конвертації в формат JSON-записів Nasinnia.
- [ ] **1.2. Додавання 13 українських похідних гарнітур:**
  - Генерація записів з префіксом `verba-` (наприклад `verba-amstrad-pc`, `verba-creep-7x12`, `verba-tandy2k` тощо).
  - Зазначення `sourceType: "derivative"`, `derivedFrom`, збереження ліцензії та автора предка, фіксація змін у `modifications`.
- [ ] **1.3. Додавання Texted IBM & Spleen модифікацій:**
  - `texted-bios-8x8`, `texted-ega-8x14`, `texted-vga-8x16`, `texted-square-8x16`, `texted-cut-8x16`.
- [ ] **1.4. Позначення рамочних шрифтів:**
  - Додати тег `"frames"` до 22 рамочних гарнітур.
- [ ] **1.5. Тести валідації:** Запуск `npm run validate` у `nasinnia` для перевірки всіх нових записів.

### Task 2: Система псевдонімів (Aliases) в API Nasinnia
- [ ] **2.1. Реєстр псевдонімів:** Створення `nasinnia/data/aliases.json`:
  - `spleen_6x12` → `spleen-6x12`
  - `spleen_8x16` → `spleen-8x16`
  - `cozette` → `cozette-13x15`
  - `cozette_full` → `cozette-13x15`
  - `bios_8x8` → `texted-bios-8x8`
  - `ega_8x14` → `texted-ega-8x14`
  - `vga_8x16` → `texted-vga-8x16`
  - `verba_<name>` → `verba-<name>`
  - `texted_<name>` → `texted-<name>`
- [ ] **2.2. Підтримка в роутері Nasinnia:**
  - Оновлення `findFont()` у `nasinnia/src/api.js`: якщо ID є в мапі аліасів, автоматично резолвити до канонічного шрифту.
  - Оновлення `GET /v1/fonts/{id}` та `GET /v1/fonts/{id}/glyphs`.
- [ ] **2.3. Тести аліасів:** Тест, що запит за старим UPA ID повертає коректні гліфи та метадані.

### Task 3: Перемикання `para.verbacorpus.org/fonts` на Nasinnia
- [ ] **3.1. Роутинг у Verba Worker:**
  - В `app/src/index.ts` та `app/src/upa.ts`: перенаправити запити до `para.verbacorpus.org/fonts` та `para.verbacorpus.org/font.json` на сервісний binding `FONTS` (`nasinnia`).
- [ ] **3.2. Синхронізація адреси в каталозі:**
  - Переконатися, що `para.verbacorpus.org/fonts` використовує UI експлорера Nasinnia або проксує каталог Nasinnia.
- [ ] **3.3. Тести інтеграції:**
  - Тести в `app/test/site-addresses.test.ts` та `app/test/upa.test.ts`.

### Task 4: Розширення шрифтів для карток у Verba і Gateway
- [ ] **4.1. Підтримка нових гарнітур у рендері карток:**
  - У `app/src/card/recipe.ts`: задокументувати перелік перевірених гарнітур з повною кирилицею (`cozette-13x15`, `spleen-8x16`, `verba-amstrad-pc`, `verba-creep-7x12`, `verba-tandy2k`, `verba-ibm-mda` тощо).
  - `resolveFont()` у `app/src/card/render.ts` вже універсальний, але додати перевірку наявності необхідних гліфів або деградацію.
- [ ] **4.2. Gateway оновлення:**
  - Додати параметри гарнітур у схему OpenAPI в `gateway/src/openapi.ts`.
  - Можливість детермінованого вибору гарнітури у випадкових картках `/v1/cards/random.*` за `seed` або через явний параметр `?font=...`.
- [ ] **4.3. Тести карток:**
  - Нові тести рендерингу карток з новими гарнітурами (наприклад Spleen, Amstrad, Creep).

### Task 5: Оновлення UPA (`upa-archive`) для читання з Nasinnia
- [ ] **5.1. Читання шрифтів через API:**
  - UPA редактор читає гліфи та переліки гарнітур з Nasinnia замість локальних статичних бінарників.
- [ ] **5.2. Збереження зворотної сумісності:**
  - Перевірка відкриття наявних документів `upa:document:v1`.

### Task 6: Реліз і розгортання
- [ ] **6.1. Деплой Nasinnia:** `npm run catalog:sync && npm run deploy` у `nasinnia`.
- [ ] **6.2. Деплой Verba:** CI при мерджі в `main`.
- [ ] **6.3. Деплой Gateway:** `wrangler deploy` у `gateway/`.
- [ ] **6.4. Фінальна перевірка живих карток і шрифтів.**
