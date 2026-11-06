import { escape as esc } from "./catalog.mjs";
export function paraBody(manifest) {
  const counts = manifest.counts,
    num = (n) => n.toLocaleString("uk");
  const options = (key, label = (value) => value) => {
    const values = new Map();
    for (const font of manifest.fonts) {
      const value = key(font);
      values.set(value, (values.get(value) ?? 0) + 1);
    }
    return [...values]
      .sort(([a], [b]) =>
        typeof a === "number" ? a - b : String(a).localeCompare(String(b)),
      )
      .map(
        ([value, count]) =>
          `<option value="${esc(String(value))}">${esc(String(label(value)))} (${num(count)})</option>`,
      )
      .join("");
  };
  return `<section data-font-corpus aria-labelledby="font-catalog-title">
    <div class="section-heading"><div><p class="eyebrow">Nasinnia · Para Font Interchange 2.0</p><h2 id="font-catalog-title">Корпус растрових шрифтів</h2></div></div>
    <p class="font-corpus-summary"><strong>${num(counts.records)}</strong> записи · <strong>${num(counts.glyphs)}</strong> гліфи · <strong>${counts.ukrainianComplete}</strong> з повною українською абеткою. Включно з ${num(counts.unmappedGlyphs)} знаками без Unicode та ${counts.fixtures} тестовим зразком.</p>
    <form id="font-filter" class="font-filter-panel">
      <div class="font-filters">
        <label class="font-search-label">Знайти шрифт<input id="font-search" name="q" type="search" maxlength="200" placeholder="IBM CGA, Amiga, Cozette…" autocomplete="off"></label>
        <label>Колекція<select id="font-collection" name="collection"><option value="">Усі колекції</option>${options(
          (f) => f.collection,
          (v) =>
            ({ nasinnia: "Nasinnia", texted: "Texted", hoard: "Hoard" })[v] ??
            v,
        )}</select></label>
        <label>Українська абетка<select id="font-coverage" name="ukrainian"><option value="">Будь-яке покриття</option><option value="complete">Повна · 66 літер</option><option value="partial">Часткова</option><option value="none">Відсутня</option><option value="unknown">Немає Unicode-мапи</option></select></label>
        <label>Порядок<select id="font-sort" name="sort"><option value="ukrainian">Українське покриття ↓</option><option value="name">За назвою</option><option value="height">За висотою ↑</option><option value="width">За шириною ↑</option><option value="glyphs">Кількість гліфів ↓</option><option value="id">За ID</option></select></label>
      </div>
      <details class="font-extra-filters"><summary>Розміри, крок і ліцензія</summary><div class="font-filters">
        <label>Ширина комірки<select id="font-width" name="width"><option value="">Будь-яка</option>${options(
          (f) => f.cell.width,
          (v) => v + " px",
        )}</select></label>
        <label>Висота комірки<select id="font-height" name="height"><option value="">Будь-яка</option>${options(
          (f) => f.cell.height,
          (v) => v + " px",
        )}</select></label>
        <label>Крок<select id="font-spacing" name="spacing"><option value="">Будь-який</option><option value="monospace">Моноширинний</option><option value="proportional">Пропорційний</option></select></label>
        <label>Ліцензія<select id="font-license" name="license"><option value="">Усі статуси</option>${options(
          (f) => f.licenseId,
          (v) => (v === "NOASSERTION" ? "Умови не підтверджено" : v),
        )}</select></label>
      </div></details>
      <div class="corpus-actions font-filter-actions"><button type="submit">Знайти</button><button id="font-reset" type="button">Скинути фільтри</button><span id="font-active-filters" class="corpus-meta"></span></div>
    </form>
    <div class="font-results-bar"><p id="font-count" role="status" aria-live="polite">Завантаження каталогу…</p><label>На сторінці<select id="font-page-size"><option>25</option><option selected>50</option><option>100</option></select></label></div>
    <label class="font-choice">Шрифт<select id="font-select" disabled></select></label>
    <div class="corpus-actions"><button id="font-first" type="button" disabled>На початок</button><button id="font-prev" type="button" disabled>Назад</button><button id="font-next" type="button" disabled>Далі</button><button id="font-last" type="button" disabled>У кінець</button><a id="font-share" href="/para/">Посилання на цей шрифт</a></div>
    <article class="font-workbench" aria-labelledby="font-name"><header><p class="eyebrow">Зразок шрифту</p><h3 id="font-name">Виберіть шрифт</h3><p id="font-details" class="corpus-meta"></p><p id="font-missing" class="corpus-meta"></p></header>
      <div class="specimen-presets corpus-actions" aria-label="Зразки тексту"><button type="button" data-specimen="ukrainian">Українська</button><button type="button" data-specimen="latin">Latin</button><button type="button" data-specimen="numbers">Цифри й знаки</button></div>
      <div class="specimen-controls"><label class="specimen-text">Ваш текст<textarea id="font-text" rows="2" maxlength="160">Ґава, їжак і єнот. Україна — 123 ₴.</textarea></label><label>Масштаб <output id="font-scale-value">3×</output><input id="font-scale" type="range" min="1" max="8" value="3"></label></div>
      <div id="font-preview-stage" class="font-preview"><canvas id="font-canvas" width="1" height="1" role="img" aria-label="Растровий зразок"></canvas></div><p id="font-status" role="status"></p>
    </article>
    <section class="native-glyph-section" aria-labelledby="native-glyph-title"><div class="section-heading"><div><p class="eyebrow">Оригінальні пікселі</p><h3 id="native-glyph-title">Гліфи й метрики</h3></div></div>
      <div class="glyph-toolbar"><label>Показати<select id="glyph-mode"><option value="all">Усі вихідні гліфи</option><option value="mapped">З Unicode</option><option value="unmapped">Без Unicode</option></select></label><label>На сторінці<select id="glyph-page-size"><option selected>32</option><option>64</option><option>128</option></select></label>
      <form id="glyph-jump"><label>Перейти до гліфа<input id="glyph-lookup" type="search" maxlength="24" placeholder="Ґ, U+0490, g000123" autocomplete="off"></label><button type="submit">Перейти</button></form></div>
      <p id="glyph-count" role="status" aria-live="polite"></p><div id="glyph-grid" class="native-glyph-grid" role="group" aria-label="Вибір гліфа"></div>
      <div class="corpus-actions glyph-pagination"><button id="glyph-first" type="button" disabled>На початок</button><button id="glyph-prev" type="button" disabled>Назад</button><button id="glyph-next" type="button" disabled>Далі</button><button id="glyph-last" type="button" disabled>У кінець</button></div>
      <div class="glyph-inspector"><div class="glyph-inspector-header"><p id="glyph-selection" role="status">Гліф не вибрано</p><div class="corpus-actions"><button id="glyph-before" type="button" disabled aria-label="Попередній гліф">←</button><button id="glyph-after" type="button" disabled aria-label="Наступний гліф">→</button><button id="glyph-fit" type="button">Умістити</button><a id="glyph-download">JSON гліфа</a></div></div>
      <div class="glyph-display-controls"><label>Масштаб<input id="glyph-zoom" type="range" min="1" max="16" value="4"></label><label class="glyph-checkbox"><input id="glyph-pixel-grid" type="checkbox"> Піксельна сітка</label></div>
      <div class="glyph-detail-stage"><canvas id="glyph-detail-canvas" width="1" height="1" role="img" aria-label="Вибраний вихідний гліф"></canvas></div>
      <details id="glyph-json"><summary>Рядки пікселів, мітки та метрики JSON</summary><pre id="glyph-details"></pre></details></div>
    </section>
    <details class="font-api-details"><summary>Завантаження та API</summary><div class="corpus-actions"><a id="font-download">Завантажити шрифт JSON</a><a href="/para/api/v2/export">Увесь корпус NDJSON</a><a href="/para/api/v2/schema.json">Схема формату</a><a href="/para/api/v2/openapi.json">OpenAPI</a><a href="/para/graphql/schema.graphql">Схема GraphQL</a><a href="/para/licenses/NOTICE.md">Авторство й ліцензії</a></div><p>REST: <code>/para/api/v2/fonts?ukrainian=complete&amp;spacing=monospace</code></p><p>Гліф: <code>/para/api/v2/fonts/texted-bios_8x8/glyphs/U+0490</code></p><p>Фільтри: <code>/para/api/v2/facets</code>. GraphQL: <code>POST /para/api/v2/graphql</code>.</p><p>Збережено точні пікселі, розміри, крок та вихідні мітки. Немає штучних Unicode-відповідників, згладжування або заміни відсутніх літер іншим шрифтом. Ліцензійний статус відділено від наявності растра.</p></details>
  </section><script type="module" src="/para.js"></script>`;
}
