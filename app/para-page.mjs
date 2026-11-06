import { escape as esc } from "./catalog.mjs";
export function paraBody(manifest) {
  const counts = manifest.counts,
    num = (n) => n.toLocaleString("uk");
  return `<section data-font-corpus aria-labelledby="font-catalog-title">
    <div class="section-heading"><div><p class="eyebrow">Nasinnia · Para Font Interchange 1.0</p><h2 id="font-catalog-title">Корпус растрових шрифтів</h2></div></div>
    <p>${num(counts.records)} унікальних записів: ${num(counts.raster)} з растровими даними, зокрема ${counts.fixtures} тестовий зразок, і ${num(counts.metadataOnly)} лише з метаданими. ${counts.ukrainianComplete} наборів містять усі 66 українських літер. Відсутні гліфи не замінюються іншим шрифтом.</p>
    <form id="font-filter" class="font-filters"><label>Пошук<input id="font-search" name="q" type="search" maxlength="200" placeholder="IBM, Spleen, Cozette…"></label><label>Дані<select id="font-availability"><option value="raster">Растрові шрифти</option><option value="">Усі записи</option><option value="metadata-only">Лише метадані</option></select></label><label>Українська абетка<select id="font-coverage"><option value="complete">Повна</option><option value="">Будь-яке покриття</option><option value="partial">Часткова</option><option value="none">Відсутня</option><option value="unknown">Невідоме покриття</option></select></label><button type="submit">Знайти</button></form>
    <p id="font-count" role="status">Завантаження каталогу…</p><label>Шрифт<select id="font-select" disabled></select></label>
    <div class="corpus-actions"><button id="font-prev" type="button" disabled>Попередні 50</button><button id="font-next" type="button" disabled>Наступні 50</button></div>
    <p id="font-details" class="corpus-meta"></p>
    <div class="specimen-controls"><label>Ваш текст<input id="font-text" maxlength="160" value="Ґава, їжак і єнот. Україна — 123 ₴."></label><label>Масштаб пікселів<input id="font-scale" type="range" min="1" max="8" value="3"></label></div>
    <div class="font-preview"><canvas id="font-canvas" width="1" height="1" role="img" aria-label="Растровий зразок"></canvas></div><p id="font-status" role="status"></p>
    <div class="corpus-actions"><a id="font-download">Завантажити запис JSON</a><a href="/para/api/v1/export">Увесь корпус NDJSON</a><a href="/para/api/v1/schema.json">Схема формату</a><a href="/para/api/v1/openapi.json">OpenAPI</a><a href="/para/graphql/schema.graphql">Схема GraphQL</a><a href="/para/licenses/NOTICE.md">Авторство й ліцензії</a></div>
    <details><summary>Як отримати гліфи через API</summary><p>REST: <code>/para/api/v1/fonts?ukrainian=complete</code></p><p>Гліф: <code>/para/api/v1/fonts/texted-bios_8x8/glyphs/U+0490</code></p><p>GraphQL: <code>POST /para/api/v1/graphql</code></p><pre><code>${esc('{"query":"{ fonts(limit: 5, ukrainian: \\"complete\\") { total nodes { id name } } }"}')}</code></pre><p>JSON зберігає розміри, базову лінію, крок кожного гліфа й точні рядки бітів. Ліцензія вказана для кожного запису; метадані не означають дозволу на поширення растрового шрифту.</p></details>
  </section><script type="module" src="/para.js"></script>`;
}
