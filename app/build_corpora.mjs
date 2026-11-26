import { readFile, writeFile, mkdir } from "node:fs/promises";
import { escape as esc, sha256, validateRegistry } from "./catalog.mjs";
const readJson = async path => JSON.parse(await readFile(path, "utf8"));
const json = value => JSON.stringify(value, null, 2) + "\n";
const num = n => Number(n).toLocaleString("uk");

async function verify(directory, manifest) {
  for (const [name, digest] of Object.entries(manifest.files)) {
    if (!/^[a-zA-Z0-9._-]+$/.test(name) || sha256(await readFile(`${directory}/${name}`)) !== digest) throw new Error(`Invalid corpus snapshot: ${directory}/${name}`);
  }
}
await verify("public/bez-tabu/data", await readJson("public/bez-tabu/data/provenance.json"));
await verify("content/snapshots", await readJson("content/snapshots/manifest.json"));
const directions = validateRegistry(await readJson("content/corpora.json"));
const proverbs = await readJson("public/data/meta.json");
const tabu = await readJson("public/bez-tabu/data/entries.json");
const projects = await readJson("content/snapshots/projects.json");
const font = await readJson("content/snapshots/font-specimen.json");
const showcase = await readJson("content/snapshots/upa-showcase.json");
const articles = await readJson("public/blog/latest.json");
for (const article of articles) {
  if (!/^[a-z0-9-]+$/.test(article.slug)) throw new Error("Invalid article slug");
  await readFile(`public/blog/${article.slug}.html`);
}
const stats = {
  pro: `${num(proverbs.count)} записів · ${proverbs.sources.length} джерел`,
  contra: `${num(tabu.stats.rows)} рядків · ${tabu.stats.terms} термінів · ${tabu.stats.groups} груп`,
  re: `${articles.length} опубліковані історії`,
  para: `${num(projects.nasinnia.rasterRecords)} растровий набір у Nasinnia · ${projects.nasinnia.ukrainianRedistributableRecords} з повною українською абеткою`,
  non: `${projects.upa.patterns} візерунків UPA · схеми, повтори й композиції`,
};
const registry = directions.map(c => ({ ...c, stats: stats[c.prefix] }));
const brand = prefix => `<span class="prefix">${esc(prefix)}.</span>verba`;
const nav = active => `<a class="skip-link" href="#main">До вмісту</a><nav class="topbar" aria-label="Головна навігація"><div class="wrap topbar-inner"><a class="topbar-brand" href="/corpora"><img class="brandmark" src="/logo-willow.svg" alt=""><span>verba</span></a><div class="direction-nav"><a href="/corpora"${active === "" ? ' aria-current="page"' : ""}>Усі напрями</a>${directions.map(c => `<a href="${c.href}"${active === c.prefix ? ' aria-current="page"' : ""}>${c.prefix}.verba</a>`).join("")}</div><button id="umbrella-theme" type="button" aria-label="Змінити тему">◐</button></div></nav>`;
const footer = `<footer class="colophon"><div class="wrap"><p>Verba Corpus · Мова, письмо й візуальна спадщина</p><p><a href="/corpora">Усі напрями</a> · <a href="/about">Про проєкт</a> · <a href="/about#support">Підтримати</a> · <a href="/data/corpora.json">Реєстр напрямів JSON</a></p></div></footer>`;
const layout = (prefix, title, description, body) => `<!DOCTYPE html><html lang="uk"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} — Verba Corpus</title><meta name="description" content="${esc(description)}"><meta name="theme-color" content="#f4f1e8"><link rel="icon" href="/favicon.svg"><link rel="stylesheet" href="/fonts/spectral.css"><link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/corpora.css"><script>try{const t=localStorage.getItem('theme');if(t==='dark'||t==='light')document.documentElement.dataset.theme=t}catch{}</script><script type="module" src="/umbrella.js"></script></head><body class="umbrella-page">${nav(prefix)}<main id="main" class="wrap">${body}</main>${footer}</body></html>`;
const masthead = (prefix, eyebrow, title, description) => `<header class="direction-mast"><p class="eyebrow">${esc(eyebrow)}</p><h1>${prefix ? brand(prefix) : "verba<span class=brand-period>.</span>"}</h1><h2>${esc(title)}</h2><p class="standfirst">${esc(description)}</p></header>`;
const cards = registry.map(c => `<article class="corpus-card direction-${c.prefix}" data-corpus="${c.id}"><p class="eyebrow">${esc(c.eyebrow)}</p><h2><a href="${c.href}">${brand(c.prefix)}</a></h2><h3>${esc(c.title)}</h3><p>${esc(c.description)}</p><p class="corpus-meta">${esc(c.stats)}</p><p class="direction-status">${esc(c.status)}</p><a class="direction-open" href="${c.href}">Відкрити ${esc(c.prefix)}.verba <span aria-hidden="true">↗</span></a></article>`).join("");
const template = await readFile("content/corpora.html", "utf8");
const hub = layout("", "Українська культурна спадщина в даних", "П’ять напрямів Verba Corpus: прислів’я, словник, історії, шрифти та візуальні знаки.", template.replace("{{MASTHEAD}}", masthead("", "Мова · письмо · візуальні знаки", "Українська культурна спадщина в даних", "Від народного вислову до пікселя. Збираємо джерела, зберігаємо їхній контекст і даємо інструменти для дослідження та творчості.")).replace("{{CARDS}}", cards));

await mkdir("public/non", { recursive: true });
await mkdir("public/para", { recursive: true });
await mkdir("public/re", { recursive: true });
await mkdir("public/contra", { recursive: true });
await writeFile("public/corpora.html", hub);
await writeFile("public/data/corpora.json", json(registry));
await writeFile("public/data/projects.json", json(projects));
await writeFile("public/para/font.json", json(font));
await writeFile("public/para/LICENSE.txt", await readFile("content/snapshots/Cozette-LICENSE.txt"));
const publicFiles = {};
for (const path of ["/data/projects.json", "/para/font.json", "/para/LICENSE.txt"]) publicFiles[path] = sha256(await readFile(`public${path}`));
await writeFile("public/data/corpora-provenance.json", json({ schemaVersion: 1, files: publicFiles }));
const non = directions.find(c => c.prefix === "non");
const patternName = pattern => `Візерунок №${String(pattern.number).padStart(3, "0")}`;
const patternKind = pattern => pattern.kind === "medallion" ? "Медальйон" : pattern.width === pattern.height ? "Орнаментальна композиція" : "Орнаментальна смуга";
const patternImage = (pattern, eager = false) => `<img src="/upa/patterns/${esc(pattern.id)}/preview.svg" width="${pattern.width * 14}" height="${pattern.height * 14}" alt="${esc(patternName(pattern))} — схема української вишивки" ${eager ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async">`;
const [heroPattern, ...galleryPatterns] = showcase.patterns;
const patternCards = galleryPatterns.map(pattern => `<article class="non-pattern-card"><a href="/upa/p/${esc(pattern.id)}" aria-label="${esc(patternName(pattern))}: відкрити схему"><div class="non-pattern-stage">${patternImage(pattern)}</div><div class="non-pattern-caption"><h3>${esc(patternName(pattern))}</h3><span aria-hidden="true">↗</span><p>${patternKind(pattern)} · ${pattern.width} × ${pattern.height} · с. ${pattern.page}</p></div></a></article>`).join("");
await writeFile("public/non/index.html", layout("non", "non.verba — візерунки української вишивки", non.description, `
  <header class="non-showcase-hero">
    <p class="eyebrow"><span class="prefix">non.</span>verba · UPA Archive</p>
    <h1>Візерунки української вишивки</h1>
    <p class="standfirst">Смуги, розетки, медальйони. ${projects.upa.patterns} оцифрованих взорів — від сторінки джерела до схеми, повтору та нової композиції.</p>
    <div class="corpus-actions"><a class="non-primary-link" href="/upa/">Відкрити каталог UPA →</a><a href="#patterns">Роздивитися візерунки ↓</a></div>
    <figure class="non-hero-pattern"><a href="/upa/p/${esc(heroPattern.id)}" aria-label="${esc(patternName(heroPattern))}: відкрити схему">${patternImage(heroPattern, true)}</a><figcaption><span>${esc(patternName(heroPattern))} · ${heroPattern.width} × ${heroPattern.height} · с. ${heroPattern.page}</span><a href="/upa/p/${esc(heroPattern.id)}">Розглянути схему ↗</a></figcaption></figure>
  </header>
  <section id="patterns" class="non-showcase" aria-labelledby="non-patterns-title">
    <div class="section-heading"><div><p class="eyebrow">З архіву UPA</p><h2 id="non-patterns-title">У кожного взору свій ритм</h2></div><a href="/upa/#browse">Усі ${projects.upa.patterns} візерунків ↗</a></div>
    <p class="non-section-intro">Добірка з колекції. Відкрийте взір, щоб побачити джерельну сторінку, структуру стібків і геометрію повтору.</p>
    <div class="non-pattern-grid">${patternCards}</div>
  </section>
  <section class="non-tools" aria-labelledby="non-tools-title"><div class="section-heading"><div><p class="eyebrow">Працювати з орнаментом</p><h2 id="non-tools-title">Від взору до власної композиції</h2></div></div><div class="non-tool-grid">
    <a href="/upa/page-frames"><span class="eyebrow">01 · Компонувати</span><h3>Рамки для сторінок ↗</h3><p>Обрамлення з орнаментів UPA, власний текст і готова сторінка для друку.</p></a>
    <a href="/upa/generate"><span class="eyebrow">02 · Варіювати</span><h3>Генератор візерунків ↗</h3><p>Нові композиції на основі взорів колекції. Досліджуйте ритм, колір і повтор.</p></a>
    <a href="/upa/developers"><span class="eyebrow">03 · Досліджувати</span><h3>Дані та API ↗</h3><p>Структура каталогу, геометрія схем і програмний доступ до архіву.</p></a>
  </div></section>
  <section class="corpus-source"><h2>Джерело колекції</h2><p>Helen Hough, <cite>Ukrainian Folk Embroidery Patterns</cite>, 2025; взори, зібрані K. B. Habdank-Rohozynskyj. Кожен візерунок у каталозі зберігає посилання на сторінку джерела.</p><p class="corpus-meta">Умови повторного використання UPA ще не визначені. <a href="/upa/about">Про архів і джерела</a> · <a href="/data/projects.json">Метадані джерела</a></p></section>
`));
const para = directions.find(c => c.prefix === "para");
await writeFile("public/para/index.html", layout("para", "para.verba — шрифти та літери", para.description,
  masthead("para", "Nasinnia · форма слова", para.title, para.description) + `<section class="project-note"><div><h2>Nasinnia</h2><p>${num(projects.nasinnia.rasterRecords)} растровий набір у локальному каталозі. Перевірка знайшла ${projects.nasinnia.ukrainianRedistributableRecords} дозволений до поширення набір з усіма 33 великими та 33 малими українськими літерами.</p><p>Тут доступний перевірений зразок. Повний каталог, API та шрифтова лабораторія розвиваються в проєкті Nasinnia.</p></div><p class="large-figure" aria-hidden="true">Її<span>Єє Іі Ґґ</span></p></section><section class="font-lab" data-font-specimen><p class="eyebrow">Точний растровий зразок</p><h2>${esc(font.displayName)}</h2><label for="font-text">Спробуйте український текст</label><input id="font-text" type="text" maxlength="80" value="Їжак, ґанок і піксельна Україна" autocomplete="off"><label for="font-scale">Масштаб <input id="font-scale" type="range" min="2" max="6" step="2" value="4" aria-label="Масштаб шрифту від 2 до 6"></label><div class="font-preview"><canvas id="font-canvas" role="img" aria-label="Растровий зразок шрифту"></canvas></div><p id="font-status" role="status" aria-live="polite">Завантаження растрових гліфів…</p><noscript>Завантажте JSON-зразок для перегляду точних растрових даних.</noscript><p class="alphabet">АБВГҐДЕЄЖЗИІЇЙКЛМНОПРСТУФХЦЧШЩЬЮЯ<br>абвгґдеєжзиіїйклмнопрстуфхцчшщьюя</p><p>Є Ґґ, Єє, Іі, Її, апостроф ʼ та знак гривні ₴. Символи поза зразком явно позначаються.</p><div class="corpus-actions"><a href="https://para.verbacorpus.org/fonts">Каталог усіх шрифтів</a><a href="/upa/page-frames">Редактор рамок</a><a href="https://para.verbacorpus.org/letters-lab">Лабораторія абетки</a><a href="/para/font.json" download>JSON растрового зразка</a><a href="${esc(font.source.url)}">Джерельний реліз Cozette</a><a href="/data/projects.json">Походження знімка</a></div><p class="corpus-meta">${esc(font.license.attribution)} · ${esc(font.license.id)} · <a href="/para/LICENSE.txt">Текст ліцензії</a>. Гліфи показані з вихідних рядків без згладжування.</p></section>`));
const articleCards = articles.map(a => `<article class="story-card"><p class="eyebrow">${esc(a.date)}</p><h2><a href="/blog/${a.slug}">${esc(a.title)}</a></h2><p>${esc(a.lede)}</p><a href="/blog/${a.slug}">Читати історію ↗</a></article>`).join("");
await writeFile("public/re/index.html", layout("re", "re.verba — історії та переосмислення", "Редакція Verba Corpus: історії про джерела, слова, літери та знаки.", masthead("re", "Редакція Verba Corpus", "Історії та переосмислення", "Придивляємось до знайомого. Читаємо джерела, пояснюємо знахідки й показуємо, як культурна спадщина стає даними.") + `<p class="section-intro">Редакційний напрям об’єднує історії з корпусів. Нижче — вже опубліковані матеріали; нові історії про Nasinnia та UPA додаватимуться разом із розвитком проєктів.</p><div class="story-grid">${articleCards}</div><div class="corpus-actions"><a href="/blog">Увесь блог</a><a href="https://t.me/verbacorpus">Verba у Telegram</a></div>`));
const contra = (await readFile("public/bez-tabu/index.html", "utf8")).replace("Українська без табу — Verba Corpus", "contra.verba — Українська без табу").replace("Verba Corpus <span", "contra.verba <span").replaceAll('href="/corpora.html"', 'href="/corpora"');
await writeFile("public/contra/index.html", contra.replace(/<nav class="topbar">[\s\S]*?<\/nav>/, nav("contra")).replace('class="tabu-page"', 'class="tabu-page umbrella-page"').replace("</head>", '<script type="module" src="/umbrella.js"></script></head>'));
console.log(`Built Verba umbrella: ${registry.length} directions, ${font.glyphData.length} specimen glyphs`);
