# Verba API — фундамент: план реалізації

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Шлюз `verba-api` говорить однією угодою (глобальні ID, обгортка, ліцензія) над `pro`, `non`, `para`, `contra`, з відтворюваним `random`, і розгорнутий наживо.

**Architecture:** Новий Worker `verba-api` у `verbacorpus/gateway/` ходить через service bindings до Verba (`pro`, `contra`), UPA (`non`) і Nasinnia (`para`). Кожен корпус має адаптер, що перекладає рідний формат джерела в угоду. Власного сховища шлюз не має. `contra` отримує API у Worker Verba зі стабільними ID.

**Tech Stack:** Cloudflare Workers, TypeScript, wrangler 4, vitest 3 (node-оточення, підроблені bindings), Python 3 unittest для синхронізації «Без табу».

**Spec:** `docs/superpowers/specs/2026-11-25-verba-api-design.md`

Це перший із трьох планів. Наступні: **2 — картки** (рецепт, рамки UPA, шрифти Nasinnia, прибрати старі орнаменти й піксельні іконки, догфудинг бота/сайту); **3 — бібліотека шрифтів UPA → Nasinnia** (псевдоніми, похідні, `para.verbacorpus.org/fonts`).

## Global Constraints

- Новинний cron Verba лишається вимкненим; у `app/wrangler.jsonc` тільки `"0 6 * * *"`.
- Bindings Verba не змінюються: `AI`, Vectorize `proverbs-bge-m3-v2`, `NEWS_KV` (`b9bcfa756c624727b2489f0faf7d3350`), `UPA` → `upa-local-preview`, `DIAGNOSTICS_LIMITER`.
- Жодних токенів і секретів у git чи документах.
- Наявні `/api/v1/*`, `/api/*`, `/p/*`, `/s/*`, `/card/*`, `/bez-tabu/*` відповідають як раніше.
- `editorial/` не комітиться.
- Права за §5.3 спеки: `pro` — `CC-BY-4.0`/`granted`; `non` — `null`/`terms-pending`, атрибуція «Hough, 2025 / Габданк-Рогозинський»; `contra` — `null`/`terms-pending`, атрибуція «Л. Ставицька, „Українська мова без табу“»; `para` — з запису Nasinnia, `granted` лише коли `availability === "downloadable"` і `license.redistributionAllowed === true`, інакше `metadata-only`.
- `contra` не потрапляє в наскрізний `random` без явного `corpus=contra`.
- Записи `metadata-only` не мають растрових посилань у `links`.
- Кожне розгортання — лише після окремого «так» Дмитра; перед ним `wrangler deploy --dry-run`.
- Коміти: англійською, з рядками атрибуції із сесії; push і PR — тільки після «так» Дмитра.

## Review Focus

1. **Джерело недоступне** (binding відсутній, 5xx, таймаут) — `/v1/corpora` усе одно відповідає з `total: null, available: false` для цього корпусу; інші ендпоїнти дають `503 unavailable`, не 500. → тест у Task 3.
2. **Неприйнятні `limit`/`offset`/`n`** (0, від'ємні, нечисла, `limit=1000`) — `400 invalid_request`, без звернень до джерела. → тест у Task 3.
3. **`offset` за межами `total`** — порожній `items`, `nextOffset: null`, статус 200. → тест у Task 2 (para, де offset перекладається на сторінки).
4. **Той самий `seed` після зміни даних** — відповідь детермінована для незмінного `total`; при зміні `total` може змінитися (задокументовано в OpenAPI). → тест у Task 4.
5. **ID з `/`, `%`, кирилицею** у `/v1/items/{globalId}` і `/v1/{corpus}/items/{localId}` — коректно декодуються й кодуються в запит до джерела; некоректне кодування → 400. → тест у Task 3.

---

### Task 0: Гігієна репозиторіїв

**Files:** лише git-операції у `~/github/verbacorpus` і `~/github/nasinnia`.

- [ ] **Step 1: Verba — інвентаризація.** `cd ~/github/verbacorpus && git status --porcelain && git diff --stat`. Очікувано ≈72 записи; гілка `integrate/bez-tabu` не має комітів поверх `main` (`git log main..HEAD` порожній).
- [ ] **Step 2: Verba — тести перед комітами.** `cd app && npm ci && npm run build && npm test && python3 -m unittest discover -s test -p 'test_*.py'`. Очікувано: усе зелене. Якщо ні — зупинитись і доповісти Дмитру, нічого не комітити.
- [ ] **Step 3: Verba — логічні коміти.** Прочитати диф кожної групи й закомітити окремо (орієнтовні групи; остаточний поділ — за дифом): інтеграція «Без табу» (`app/sync_bez_tabu.py`, `app/public/bez-tabu/`, тести); non.verba/UPA binding (`app/src/upa.ts`, `app/wrangler.non.jsonc`, `site-addresses`); надійність/діагностика (`diagnostics.ts`, `docs/SITE-RELIABILITY.md`, `playwright.health.config.ts`); CI (`.github/workflows/`); документація (`README.md`, `docs/*.md`, спека й план Verba API). Не додавати `editorial/` і `.DS_Store`.
- [ ] **Step 4: Verba — перевірка.** `git status --porcelain` показує тільки `editorial/` і `.DS_Store`; `cd app && npm test` зелений.
- [ ] **Step 5: Verba — PR.** Після «так» Дмитра: `gh auth switch -u dmytro-yemelianov`, `git push -u origin integrate/bez-tabu`, `gh pr create --base main` з переліком комітів. Злиття — Дмитро.
- [ ] **Step 6: Nasinnia — коміт.** `cd ~/github/nasinnia && npm test` (зелений), `git add` змінених `ml/` і `docs/` файлів та нових `ml/src/nasinnia_font_factory/{graph_deformation,outline}.py`, `ml/tests/test_{graph_deformation,outline}.py`; `baseline_d_colab_repro.py` перенести в `ml/scripts/` перед комітом. Коміт `ml: add graph deformation and outline experiments`.
- [ ] **Step 7: Nasinnia — перевірка перед remote.** `git ls-files | xargs grep -lE "(api[_-]?key|secret|token)\s*[:=]" ` — порожньо або лише безпечні збіги; `du -sh .git` < 100 MB.
- [ ] **Step 8: Nasinnia — remote.** Після «так» Дмитра: `gh repo create dmytro-yemelianov/nasinnia --private --source . --push`. Перевірка: `gh repo view dmytro-yemelianov/nasinnia --json visibility` → `"PRIVATE"`.

### Task 1: Угода — типи, ID, обгортка, права

**Files:**
- Create: `gateway/package.json`, `gateway/tsconfig.json`, `gateway/vitest.config.ts` (environment `node`)
- Create: `gateway/src/contract.ts`
- Test: `gateway/test/contract.test.ts`

**Interfaces:**
- Produces (у `gateway/src/contract.ts`):
  - `type Corpus = "pro" | "contra" | "para" | "non"`; `const CORPORA: readonly Corpus[]`
  - `type LicenceStatus = "granted" | "terms-pending" | "metadata-only"`
  - `interface Licence { id: string | null; status: LicenceStatus; attribution: string; url: string | null }`
  - `interface Item { id: string; corpus: Corpus; title: string; licence: Licence; links: { self: string; html: string | null }; data: unknown }`
  - `interface ItemList { apiVersion: "v1"; corpus: Corpus | "mixed"; total: number; limit: number; offset: number; nextOffset: number | null; items: Item[] }`
  - `parseGlobalId(id: string): { corpus: Corpus; localId: string } | null`
  - `globalId(corpus: Corpus, localId: string): string`
  - `LICENCES: { pro: Licence; non: Licence; contra: Licence }` — точні значення з Global Constraints
  - `class ApiError extends Error { constructor(status: number, code: string, message: string) }`
  - `errorResponse(e: ApiError): Response`, `json(body: unknown, init?: { status?: number; cache?: string }): Response` — завжди `access-control-allow-origin: *`, `content-type: application/json; charset=utf-8`
  - `const API_BASE = "https://api.verbacorpus.org"`

- [ ] **Step 1: Failing tests**

```ts
it("parses and builds global ids", () => {
  expect(parseGlobalId("pro:p037464")).toEqual({ corpus: "pro", localId: "p037464" });
  expect(parseGlobalId("non:p15_-_b02")).toEqual({ corpus: "non", localId: "p15_-_b02" });
  expect(parseGlobalId("para:cozette-6x13/U+0456")).toEqual({ corpus: "para", localId: "cozette-6x13/U+0456" });
  expect(parseGlobalId("re:x")).toBeNull();
  expect(parseGlobalId("pro:")).toBeNull();
  expect(globalId("contra", "3f2a9c01de")).toBe("contra:3f2a9c01de");
});
it("licences follow spec §5.3", () => {
  expect(LICENCES.pro).toMatchObject({ id: "CC-BY-4.0", status: "granted" });
  expect(LICENCES.non).toMatchObject({ id: null, status: "terms-pending", attribution: "Hough, 2025 / Габданк-Рогозинський" });
  expect(LICENCES.contra).toMatchObject({ id: null, status: "terms-pending" });
  expect(LICENCES.contra.attribution).toContain("Ставицька");
});
it("errors use the shared envelope", async () => {
  const r = errorResponse(new ApiError(404, "not_found", "nope"));
  expect(r.status).toBe(404);
  expect(r.headers.get("access-control-allow-origin")).toBe("*");
  expect(await r.json()).toEqual({ error: { code: "not_found", message: "nope" } });
});
```

- [ ] **Step 2: Run** `cd gateway && npm i && npx vitest run test/contract.test.ts` → FAIL (module not found).
- [ ] **Step 3: Implement** `gateway/src/contract.ts` з інтерфейсами вище; `pro.attribution` взяти з наявного тексту атрибуції Verba (`app/src/openapi.json` або `README.md`).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(gateway): add shared API contract`.

### Task 2: Адаптери `pro`, `non`, `para`

**Files:**
- Create: `gateway/src/adapters/types.ts`, `gateway/src/adapters/pro.ts`, `gateway/src/adapters/non.ts`, `gateway/src/adapters/para.ts`
- Create: `gateway/test/fakes.ts` (фейкові `Fetcher` з фікстур), `gateway/test/fixtures/{pro,non,para}/*.json` (знімки реальних відповідей, по 3 записи)
- Test: `gateway/test/adapters.test.ts`, `gateway/test/contract-suite.ts`

**Interfaces:**
- Consumes: усе з Task 1.
- Produces (`adapters/types.ts`):
  - `interface Upstream { fetch(input: Request | string): Promise<Response> }`
  - `interface Adapter { corpus: Corpus; meta(): Promise<{ total: number }>; list(limit: number, offset: number, filters: URLSearchParams): Promise<{ total: number; items: Item[] }>; get(localId: string): Promise<Item | null> }`
  - `makeProAdapter(up: Upstream): Adapter`, `makeNonAdapter(up: Upstream): Adapter`, `makeParaAdapter(up: Upstream): Adapter`
  - `runContractSuite(name: string, make: () => Adapter, knownLocalId: string)` у `test/contract-suite.ts` — однаковий набір для кожного корпусу (використовує і Task 5).
- Рідні запити (хост у URL довільний, напр. `https://upstream`):
  - pro: `GET /api/v1/query?limit&offset` (`{ total, results }`), `GET /api/v1/proverb/{id}`, `GET /api/v1/meta` (`count`). `title` = `text`; `html` = `https://pro.verbacorpus.org/p/{id}`.
  - non: `GET /api/v1/patterns?limit&offset` (`{ total, items }`, ID у `patternId`), `GET /api/v1/patterns/{id}`, `GET /api/v1` (`corpus.patterns`). `title` = `name`; `html` = `https://non.verbacorpus.org/upa/catalog?page={catalogPage}#{patternId}`. `data` без змін (геометрію додає `include=geometry`, коли переданий у `filters`).
  - para: `GET /v1/fonts?page&perPage` (`{ data, pagination: { total } }`), `GET /v1/fonts/{id}`. `offset/limit` → сторінки: `perPage = limit`, тягнути сторінку `floor(offset/limit)+1` і, якщо `offset % limit ≠ 0`, ще наступну; зрізати `[offset % limit, offset % limit + limit)`. `limit` для para ≤ 100. `title` = `displayName`; `html` = `null`; ліцензія за Global Constraints.
  - Усі: невідомі фільтри не пересилати — лише білий список (pro: `category`, `source`; non: `kind`, `color`, `frieze`, `q`, `include`; para: `q`, `width`, `height`, `license`). 404 джерела → `null` у `get`; інший не-2xx або виняток → `ApiError(502, "upstream_error", …)`.

- [ ] **Step 1: Failing tests** — `runContractSuite` перевіряє для кожного адаптера: `list(2,0)` дає 2 записи з `id` вигляду `^{corpus}:.+`, `corpus`, непорожнім `title`, `licence.status`, `links.self === API_BASE + "/v1/{corpus}/items/" + encodeURIComponent(localId)`; `get(knownLocalId)` не `null`; `get("no-such")` → `null`; `meta().total > 0`. Окремо:

```ts
it("para translates offset into pages", async () => {
  const up = fakeNasinnia(fonts(7));          // 7 шрифтів
  const r = await makeParaAdapter(up).list(3, 4, new URLSearchParams());
  expect(r.items.map(i => i.id)).toEqual(["para:f4", "para:f5", "para:f6"]);
  expect((await makeParaAdapter(up).list(3, 9, new URLSearchParams())).items).toEqual([]);
});
it("para marks non-redistributable fonts metadata-only", async () => {
  const up = fakeNasinnia([{ id: "h1", availability: "metadata-only", license: { id: "x", redistributionAllowed: false } }]);
  expect((await makeParaAdapter(up).get("h1"))!.licence.status).toBe("metadata-only");
});
it("non applies spec licence and keeps native data", async () => {
  const item = (await makeNonAdapter(fakeUpa()).get("p07_L_b00"))!;
  expect(item.licence.status).toBe("terms-pending");
  expect((item.data as any).symmetry.frieze).toBe("p2mm");
});
it("upstream 500 becomes 502 upstream_error", async () => {
  await expect(makeProAdapter(failing(500)).list(1, 0, new URLSearchParams())).rejects.toMatchObject({ status: 502, code: "upstream_error" });
});
```

- [ ] **Step 2: Run** `npx vitest run test/adapters.test.ts` → FAIL.
- [ ] **Step 3: Implement** три адаптери за описом вище. Фікстури взяти з реальних відповідей: `curl https://verbacorpus.org/api/v1/query?limit=3`, `curl https://non.verbacorpus.org/upa/api/v1/patterns?limit=3`, Nasinnia — з `wrangler dev` у `~/github/nasinnia` (`/v1/fonts?perPage=3`).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(gateway): add pro, non and para adapters`.

### Task 3: Worker шлюзу — маршрути

**Files:**
- Create: `gateway/src/index.ts`, `gateway/src/router.ts`, `gateway/wrangler.jsonc`
- Test: `gateway/test/router.test.ts`

**Interfaces:**
- Consumes: Task 1, Task 2.
- Produces:
  - `interface Env { PRO?: Fetcher; UPA?: Fetcher; FONTS?: Fetcher }`
  - `adaptersFor(env: Env): Partial<Record<Corpus, Adapter>>` — `contra` додає Task 5
  - `handle(request: Request, env: Env): Promise<Response>` у `router.ts`; `index.ts` — `export default { fetch: handle }`
- `wrangler.jsonc`: `name: "verba-api"`, `main: "src/index.ts"`, `compatibility_date: "2025-10-11"`, `workers_dev: true`, `services: [{binding:"PRO",service:"ukr-proverbs-corpus"},{binding:"UPA",service:"upa-local-preview"},{binding:"FONTS",service:"nasinnia"}]`, без `routes` (домен — Task 7).
- Маршрути (лише `GET`/`HEAD`/`OPTIONS`; інше → 405):
  - `/v1/corpora` → `{ apiVersion, corpora: [{ corpus, id, title, description, domain, total, available, licence }] }` з `../app/content/corpora.json` (лише `prefix` ∈ CORPORA); `total` з `meta()`, при збої `total: null, available: false`. Кеш `public, max-age=300`.
  - `/v1/{corpus}/meta` → `{ apiVersion, corpus, total, licence }`.
  - `/v1/{corpus}/items?limit&offset&…` → `ItemList`; `limit` 1–100 (за замовч. 50), `offset` ≥ 0; `nextOffset = offset+limit < total ? offset+limit : null`. Кеш `public, max-age=3600`.
  - `/v1/{corpus}/items/{localId}` і `/v1/items/{globalId}` → `Item` або 404.
  - Невідомий корпус або шлях → 404 `not_found`; відсутній binding → 503 `unavailable`.

- [ ] **Step 1: Failing tests** — серед них (Review Focus 1, 2, 5):

```ts
it("corpora survives a dead upstream", async () => {
  const r = await handle(req("/v1/corpora"), { PRO: fakeVerba(), FONTS: fakeNasinnia(fonts(3)) }); // UPA відсутній
  const b = await r.json() as any;
  expect(r.status).toBe(200);
  expect(b.corpora.find((c: any) => c.corpus === "non")).toMatchObject({ total: null, available: false });
});
it.each(["limit=0", "limit=101", "limit=abc", "offset=-1"])("rejects %s without calling upstream", async (q) => {
  const spy = countingVerba();
  const r = await handle(req("/v1/pro/items?" + q), { PRO: spy });
  expect(r.status).toBe(400); expect(spy.calls).toBe(0);
});
it("missing binding is 503", async () => {
  expect((await handle(req("/v1/non/items"), {})).status).toBe(503);
});
it("decodes ids with slash and cyrillic", async () => {
  const up = recordingUpa();
  await handle(req("/v1/items/" + encodeURIComponent("non:p15_-_b02")), { UPA: up });
  expect(up.lastPath).toBe("/api/v1/patterns/p15_-_b02");
  expect((await handle(req("/v1/items/%E0%A4%A"), { UPA: up })).status).toBe(400);
});
it("CORS preflight", async () => {
  const r = await handle(new Request("https://api/v1/corpora", { method: "OPTIONS" }), {});
  expect(r.headers.get("access-control-allow-origin")).toBe("*");
});
```

- [ ] **Step 2: Run** `npx vitest run test/router.test.ts` → FAIL.
- [ ] **Step 3: Implement** `router.ts` і `index.ts`; `wrangler.jsonc` за описом.
- [ ] **Step 4: Run** `npx vitest run && npx wrangler deploy --dry-run` → PASS, dry-run показує 3 bindings.
- [ ] **Step 5: Commit** `feat(gateway): route corpora, meta and items`.

### Task 4: Відтворюваний `random`

**Files:**
- Create: `gateway/src/random.ts`
- Modify: `gateway/src/router.ts`
- Test: `gateway/test/random.test.ts`

**Interfaces:**
- Produces:
  - `rng(seed: string): () => number` — FNV-1a 32-bit від рядка → mulberry32; повертає [0,1).
  - `pickRandom(adapter: Adapter, n: number, next: () => number, filters: URLSearchParams): Promise<Item[]>` — `total` з `list(1,0,filters)`, далі `n` різних offset'ів `floor(next()*total)` (повтор → наступне значення; максимум `n*5` спроб), кожен через `list(1, offset, filters)`.
  - `pickMixed(adapters: Partial<Record<Corpus, Adapter>>, corpora: Corpus[], n: number, next: () => number): Promise<Item[]>` — для кожного з `n` записів корпус = `corpora[floor(next()*corpora.length)]`, далі `pickRandom(…, 1, …)`.
- Маршрути: `/v1/{corpus}/random?n&seed&…` (n 1–50, за замовч. 1) і `/v1/random?corpus=a,b&n&seed`. Без `corpus` — `["pro","non","para"]` (без `contra`). Відповідь — `ItemList` з `corpus` = корпус або `"mixed"`, `offset: 0`, `nextOffset: null`. Без `seed` — `seed = crypto.randomUUID()`, заголовок `cache-control: no-store`; з `seed` — `public, max-age=86400`. Використаний seed — у заголовку `x-verba-seed`.

- [ ] **Step 1: Failing tests**

```ts
it("same seed, same picks", async () => {
  const a = await (await handle(req("/v1/random?seed=2026-11-26&n=5"), env)).json() as any;
  const b = await (await handle(req("/v1/random?seed=2026-11-26&n=5"), env)).json() as any;
  expect(a.items.map((i: any) => i.id)).toEqual(b.items.map((i: any) => i.id));
});
it("default mix never includes contra", async () => {
  for (const s of ["a", "b", "c", "d", "e"]) {
    const b = await (await handle(req(`/v1/random?seed=${s}&n=20`), envWithContra)).json() as any;
    expect(b.items.every((i: any) => i.corpus !== "contra")).toBe(true);
  }
});
it("explicit contra is allowed", async () => {
  const b = await (await handle(req("/v1/random?corpus=contra&seed=x"), envWithContra)).json() as any;
  expect(b.items[0].corpus).toBe("contra");
});
it("unseeded random is not cached and reports its seed", async () => {
  const r = await handle(req("/v1/pro/random"), env);
  expect(r.headers.get("cache-control")).toBe("no-store");
  expect(r.headers.get("x-verba-seed")).toBeTruthy();
});
it("n out of range is 400", async () => {
  expect((await handle(req("/v1/pro/random?n=51"), env)).status).toBe(400);
});
```

`envWithContra` у цьому тесті — фейковий `contra`-адаптер, інжектований через `adaptersFor`; справжній з'являється в Task 5.

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** `random.ts` і маршрути.
- [ ] **Step 4: Run** `npx vitest run` → PASS.
- [ ] **Step 5: Commit** `feat(gateway): add seeded random per corpus and mixed`.

### Task 5: API «Без табу» (`contra`) у Verba + адаптер

**Files:**
- Modify: `app/sync_bez_tabu.py` — функція `assign_ids(entries, table) -> dict[str, str]`, запис `app/content/bez-tabu-ids.json`
- Create: `app/content/bez-tabu-ids.json` (згенерований), `app/src/contra-api.ts`
- Modify: `app/src/index.ts` — маршрути `/api/contra…` (через наявну канонізацію `/api/v1/…` → `/api/…`)
- Modify: `app/src/openapi.json` — нові шляхи
- Create: `gateway/src/adapters/contra.ts`; Modify: `gateway/src/router.ts` (`adaptersFor` додає `contra` через `PRO`)
- Test: `app/test/test_sync_bez_tabu.py` (новий клас), `app/test/contra-api.test.ts`, `app/test/fixtures-site/bez-tabu/data/entries.json` (5 записів, з одним дублікатом), `gateway/test/adapters.test.ts` (`runContractSuite("contra", …)`)

**Interfaces:**
- ID: `key = "\x1f".join(NFC(strip(v)) for v in (group, term, synonym)) + "\x1f" + ("1" if isWord else "0")`; `id = sha256(key).hexdigest()[:10]`; при колізії префікса з іншим ключем — подовжувати до 12, 14… символів. Таблиця `{ "version": 1, "ids": { key: id } }`: наявні ключі зберігають свій ID; ключі, яких більше нема в джерелі, лишаються в таблиці (ID не перевикористовуються). `entries.json` **не змінюється** (його хеш закріплений у `provenance.json`).
- `app/src/contra-api.ts`: `contraRoute(path: string, qp: URLSearchParams, env: Env): Promise<Response | null>`:
  - `/api/contra` → `{ apiVersion: "v1", total, groups: string[] }`
  - `/api/contra/items?limit&offset&group&term` → `{ apiVersion: "v1", total, limit, offset, items: ContraEntry[] }`, `limit` 1–200 (50)
  - `/api/contra/items/{id}` → `ContraEntry` або 404 `{ error: { code: "not_found", … } }`
  - `ContraEntry = { id: string; group: string; term: string; synonym: string; isWord: boolean; emoji: string | null; sourceRows: number[] }` — унікальні записи (дублікати джерела зливаються, `sourceRows` усіх входжень), порядок — за першим `sourceRow`.
  - Дані: `entries.json` з `ASSETS` (`/bez-tabu/data/entries.json`) + `bez-tabu-ids.json` (імпорт JSON у бандл).
- `makeContraAdapter(up: Upstream): Adapter` — `title` = `"{synonym} — {term}"`; `html` = `https://contra.verbacorpus.org/?q={encodeURIComponent(synonym)}`; ліцензія `LICENCES.contra`.

- [ ] **Step 1: Failing tests (Python)**

```python
def test_ids_are_stable_unique_and_keep_old_assignments(self):
    entries = [e("Г", "т", "а"), e("Г", "т", "б"), e("Г", "т", "а")]      # третій — дублікат першого
    table = module.assign_ids(entries, {"version": 1, "ids": {}})
    self.assertEqual(len(set(table["ids"].values())), 2)
    again = module.assign_ids(entries[:1], table)                         # джерело скоротилось
    self.assertEqual(again["ids"], table["ids"])                          # нічого не втрачено й не змінено
def test_vendored_table_covers_every_entry(self):
    # усі записи public/bez-tabu/data/entries.json мають ID у app/content/bez-tabu-ids.json
```

- [ ] **Step 2: Run** `cd app && python3 -m unittest test.test_sync_bez_tabu -v` → FAIL.
- [ ] **Step 3: Implement** `assign_ids` і виклик у `sync()`; згенерувати таблицю для наявного знімка окремою командою `python3 sync_bez_tabu.py --ids-only` (без доступу до сусіднього репо: читає `public/bez-tabu/data/entries.json`).
- [ ] **Step 4: Run** → PASS; `bez-tabu-ids.json` має 1995 ID.
- [ ] **Step 5: Failing tests (Worker)** у `app/test/contra-api.test.ts`: `/api/v1/contra/items?limit=10` дає 4 унікальні записи з фікстури (5 рядків, 1 дублікат), дублікат має `sourceRows` довжини 2; `/api/v1/contra/items/{id}` повертає запис; невідомий ID → 404; `limit=0` → 400; старий `/bez-tabu/` і `/api/v1/random` відповідають як раніше.
- [ ] **Step 6: Run** `cd app && npx vitest run test/contra-api.test.ts` → FAIL.
- [ ] **Step 7: Implement** `contra-api.ts`, підключення в `index.ts` перед `return J({ error: "unknown endpoint" }, 404)`, шляхи в `openapi.json`.
- [ ] **Step 8: Run** `npm test` → усе зелене (включно з наявними 173+ тестами).
- [ ] **Step 9: Adapter** — `runContractSuite("contra", () => makeContraAdapter(fakeVerbaContra()), "<id з фікстури>")` → FAIL → implement → PASS.
- [ ] **Step 10: Commit** у двох комітах: `feat(contra): stable ids and read API for bez-tabu` (app/), `feat(gateway): add contra adapter` (gateway/).

### Task 6: OpenAPI і документація шлюзу

**Files:**
- Create: `gateway/src/openapi.ts`; Modify: `gateway/src/router.ts` (`/v1/openapi.json`, `/v1/docs`, `/v1` → опис)
- Create: `gateway/README.md`
- Test: `gateway/test/openapi.test.ts`

- [ ] **Step 1: Failing test** — кожен маршрут, який обробляє `router.ts`, присутній у `paths` OpenAPI 3.1 (`/v1/corpora`, `/v1/{corpus}/meta`, `/v1/{corpus}/items`, `/v1/{corpus}/items/{localId}`, `/v1/items/{globalId}`, `/v1/{corpus}/random`, `/v1/random`); опис `seed` містить фразу «стабільний, доки не змінюється total корпусу» (Review Focus 4); `/v1/docs` повертає HTML зі Swagger UI з `cdn.jsdelivr.net/npm/swagger-ui-dist@5`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5:** `gateway/README.md`: призначення, локальний запуск (`npx wrangler dev` з `--local` і заглушками bindings недоступний — описати запуск з `wrangler dev --remote` після розгортання джерел), приклади `curl`, права за корпусами.
- [ ] **Step 6: Commit** `docs(gateway): OpenAPI, Swagger and README`.

### Task 7: Розгортання

Кожен крок — тільки після окремого «так» Дмитра. Перед кожним — `--dry-run`; відкат — `npx wrangler rollback` на попередню версію.

- [ ] **Step 1: Nasinnia.** `cd ~/github/nasinnia && npx wrangler deployments list` — з'ясувати, чи розгорнутий. `npm run deploy:dry-run` → після «так» `npm run deploy`. Перевірка: `curl https://nasinnia.<акаунт>.workers.dev/v1/fonts?perPage=1` → 200, `pagination.total > 0`.
- [ ] **Step 2: Verba.** `cd app && npm run build && npm test && npx wrangler deploy --dry-run` — у виводі ті самі bindings і cron `0 6 * * *`. Після «так» `npm run deploy`. Перевірка: `curl https://verbacorpus.org/api/v1/contra/items?limit=1` → 200; `curl https://verbacorpus.org/api/v1/random` → 200 як раніше.
- [ ] **Step 3: Шлюз на workers.dev.** `cd gateway && npx wrangler deploy` після «так». Прогнати контрактний набір наживо: `GATEWAY=https://verba-api.<акаунт>.workers.dev npx vitest run test/live.test.ts` (створити `test/live.test.ts`, що пропускається без `GATEWAY`; перевіряє `/v1/corpora` — 4 корпуси з `available: true`, по одному `items` і `random?seed=live` для кожного).
- [ ] **Step 4: Домен.** Після «так» додати в `gateway/wrangler.jsonc` `routes: [{ pattern: "api.verbacorpus.org", custom_domain: true }]`, `npx wrangler deploy`, повторити Step 3 з `GATEWAY=https://api.verbacorpus.org`.
- [ ] **Step 5: Commit** `chore(gateway): serve on api.verbacorpus.org`; оновити `docs/CORPORA-HANDOVER.md` розділом «Verba API» (адреса, bindings, як розгортати, права).
