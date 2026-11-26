// OpenAPI 3.1 description of the verba-api gateway, plus the Swagger UI page.

const corpusParam = {
  name: "corpus",
  in: "path",
  required: true,
  schema: { $ref: "#/components/schemas/Corpus" },
};

const filterParams = [
  { name: "category", in: "query", schema: { type: "string" }, description: "pro: категорія." },
  { name: "source", in: "query", schema: { type: "string" }, description: "pro: джерело." },
  { name: "group", in: "query", schema: { type: "string" }, description: "contra: група." },
  { name: "term", in: "query", schema: { type: "string" }, description: "contra: термін." },
  { name: "kind", in: "query", schema: { type: "string" }, description: "non: вид об'єкта." },
  { name: "color", in: "query", schema: { type: "string" }, description: "non: колір." },
  { name: "frieze", in: "query", schema: { type: "string" }, description: "non: фриз." },
  { name: "include", in: "query", schema: { type: "string" }, description: "non: додаткові поля." },
  { name: "q", in: "query", schema: { type: "string" }, description: "non, para: пошуковий рядок." },
  { name: "width", in: "query", schema: { type: "string" }, description: "para: ширина." },
  { name: "height", in: "query", schema: { type: "string" }, description: "para: висота." },
  { name: "license", in: "query", schema: { type: "string" }, description: "para: ліцензія." },
];

const seedParam = {
  name: "seed",
  in: "query",
  schema: { type: "string", maxLength: 128 },
  description:
    "Довільний Unicode-рядок до 128 символів. Той самий seed дає ту саму вибірку — " +
    "стабільний, доки не змінюється total корпусу. Без seed генерується випадковий UUID, " +
    "а відповідь не кешується (`cache-control: no-store`); з seed — `public, max-age=86400`. " +
    "Використаний seed повертається в полі `seed` тіла та в заголовку `x-verba-seed` " +
    "(значення закодоване через `encodeURIComponent`).",
};

const nParam = {
  name: "n",
  in: "query",
  schema: { type: "integer", minimum: 1, maximum: 20, default: 1 },
  description:
    "Кількість елементів (1–20). Якщо n не менше за total корпусу, повертаються всі елементи в порядку, визначеному seed.",
};

const randomHeaders = {
  "x-verba-seed": {
    description: "encodeURIComponent(seed), використаного для вибірки.",
    schema: { type: "string" },
  },
  "cache-control": {
    description: "`no-store` без seed; `public, max-age=86400` із seed.",
    schema: { type: "string" },
  },
};

const errorRef = (description: string) => ({
  description,
  content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
});

const errors = {
  "400": errorRef("invalid_request: некоректний параметр."),
  "404": errorRef("not_found: немає такого маршруту чи елемента."),
  "405": errorRef("method_not_allowed: підтримуються лише GET, HEAD, OPTIONS."),
  "502": errorRef("upstream_error: джерело повернуло некоректну відповідь або неочікувану 4xx."),
  "503": errorRef("unavailable: джерело недоступне (немає binding, мережева помилка, 5xx, таймаут)."),
};

const itemListResponse = (description: string, headers?: object) => ({
  description,
  ...(headers ? { headers } : {}),
  content: { "application/json": { schema: { $ref: "#/components/schemas/ItemList" } } },
});

const itemResponse = {
  description: "Елемент корпусу.",
  content: { "application/json": { schema: { $ref: "#/components/schemas/Item" } } },
};

export const openapi = {
  openapi: "3.1.0",
  info: {
    title: "verba-api",
    version: "1.0.0",
    summary: "Єдиний read-only шлюз до корпусів екосистеми Verba.",
    description:
      "Шлюз об'єднує корпуси pro (прислів'я), contra (без табу), para (шрифти Nasinnia) і non (орнаменти) " +
      "за єдиним контрактом. Усі відповіді — JSON; CORS відкритий. Права на дані різні за корпусами — див. поле `licence`.",
  },
  servers: [{ url: "/" }],
  paths: {
    "/v1/corpora": {
      get: {
        operationId: "listCorpora",
        summary: "Перелік корпусів",
        description:
          "Якщо джерело корпусу недоступне, відповідь усе одно 200, а для нього `total: null, available: false`. Кеш 5 хв.",
        responses: {
          "200": {
            description: "Корпуси.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["apiVersion", "corpora"],
                  properties: {
                    apiVersion: { const: "v1" },
                    corpora: {
                      type: "array",
                      items: {
                        type: "object",
                        required: ["corpus", "total", "available", "licence"],
                        properties: {
                          corpus: { $ref: "#/components/schemas/Corpus" },
                          id: { type: "string" },
                          title: { type: "string" },
                          description: { type: "string" },
                          domain: { type: "string" },
                          total: { type: ["integer", "null"] },
                          available: { type: "boolean" },
                          licence: { oneOf: [{ $ref: "#/components/schemas/Licence" }, { type: "null" }] },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/v1/{corpus}/meta": {
      get: {
        operationId: "corpusMeta",
        summary: "Метадані корпусу",
        parameters: [corpusParam],
        responses: {
          "200": {
            description: "Кількість елементів і права. Для para `licence` = null (права — на рівні елемента).",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["apiVersion", "corpus", "total", "licence"],
                  properties: {
                    apiVersion: { const: "v1" },
                    corpus: { $ref: "#/components/schemas/Corpus" },
                    total: { type: "integer" },
                    licence: { oneOf: [{ $ref: "#/components/schemas/Licence" }, { type: "null" }] },
                  },
                },
              },
            },
          },
          ...errors,
        },
      },
    },
    "/v1/{corpus}/items": {
      get: {
        operationId: "listItems",
        summary: "Елементи корпусу зі сторінками",
        description: "Фільтри передаються лише ті, що підтримує корпус; решта ігнорується. Кеш 1 год.",
        parameters: [
          corpusParam,
          { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100, default: 50 } },
          { name: "offset", in: "query", schema: { type: "integer", minimum: 0, default: 0 } },
          ...filterParams,
        ],
        responses: { "200": itemListResponse("Сторінка елементів."), ...errors },
      },
    },
    "/v1/{corpus}/items/{localId}": {
      get: {
        operationId: "getItem",
        summary: "Елемент за локальним id",
        parameters: [corpusParam, { name: "localId", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": itemResponse, ...errors },
      },
    },
    "/v1/items/{globalId}": {
      get: {
        operationId: "getItemByGlobalId",
        summary: "Елемент за глобальним id",
        description: "Глобальний id має вигляд `<corpus>:<localId>`; локальний id може містити двокрапки та «/».",
        parameters: [
          { name: "globalId", in: "path", required: true, schema: { type: "string" }, example: "pro:abc" },
        ],
        responses: { "200": itemResponse, ...errors },
      },
    },
    "/v1/{corpus}/random": {
      get: {
        operationId: "randomInCorpus",
        summary: "Випадкові елементи одного корпусу",
        description: "`total` у відповіді — кількість повернених елементів, а не розмір корпусу.",
        parameters: [corpusParam, nParam, seedParam, ...filterParams],
        responses: { "200": itemListResponse("Вибірка.", randomHeaders), ...errors },
      },
    },
    "/v1/random": {
      get: {
        operationId: "randomMixed",
        summary: "Випадкові елементи з кількох корпусів",
        description:
          "Без `corpus` змішуються доступні з pro, non, para; contra — лише явно через `corpus=contra`. " +
          "`total` — кількість повернених елементів.",
        parameters: [
          {
            name: "corpus",
            in: "query",
            schema: { type: "string" },
            description: "Список корпусів через кому, напр. `pro,non`.",
          },
          nParam,
          seedParam,
        ],
        responses: { "200": itemListResponse("Змішана вибірка (`corpus: \"mixed\"`).", randomHeaders), ...errors },
      },
    },
    "/v1/cards/{textId}.{ext}": {
      get: {
        operationId: "card",
        summary: "Картка за рецептом (PNG, GIF або JSON)",
        description:
          "`textId` — глобальний id `pro:<id>` або `contra:<id>` (двокрапку можна кодувати як `%3A`). " +
          "`frame` — `non:<id>`, `font` — `para:<id>` або `pt-serif`; шрифт із ліцензією metadata-only дає 422 `font_restricted`. " +
          "Деградована картка має заголовок `x-verba-degraded` і `cache-control: no-store`.",
        parameters: [
          { name: "textId", in: "path", required: true, schema: { type: "string" }, example: "pro:p037464" },
          { name: "ext", in: "path", required: true, schema: { type: "string", enum: ["png", "gif", "json"] } },
          { name: "frame", in: "query", schema: { type: "string" }, description: "`non:<patternId>`; за замовчуванням добирається автоматично." },
          { name: "font", in: "query", schema: { type: "string" }, description: "`para:<fontId>` або `pt-serif`." },
          { name: "size", in: "query", schema: { type: "string", enum: ["fb", "square", "story", "yt", "sticker", "telegram"], default: "fb" } },
          { name: "lang", in: "query", schema: { type: "string", enum: ["uk", "en"], default: "uk" } },
          { name: "style", in: "query", schema: { type: "string", enum: ["base", "color", "big", "shadowS", "shadowD", "stitch", "invert", "marker"], default: "color" } },
          { name: "align", in: "query", schema: { type: "string", enum: ["left", "center", "right", "stairR", "stairL"] } },
          { name: "hook", in: "query", schema: { type: "string" }, description: "`auto`, `none`, або точний підрядок тексту." },
        ],
        responses: {
          "200": {
            description: "Картка.",
            headers: { "x-verba-degraded": { description: "Список пропущених частин, якщо картку деградовано.", schema: { type: "string" } } },
            content: {
              "image/png": { schema: { type: "string", format: "binary" } },
              "image/gif": { schema: { type: "string", format: "binary" } },
              "application/json": { schema: { type: "object" } },
            },
          },
          ...errors,
        },
      },
    },
    "/v1/cards/random.{ext}": {
      get: {
        operationId: "randomCard",
        summary: "Картка з випадковим текстом",
        description:
          "Обирає запис із `pro` (типово) або `contra` (лише явно через `corpus=contra`) за `seed`. Відповідь має `x-verba-seed`.",
        parameters: [
          { name: "ext", in: "path", required: true, schema: { type: "string", enum: ["png", "gif", "json"] } },
          seedParam,
          { name: "corpus", in: "query", schema: { type: "string", enum: ["pro", "contra"], default: "pro" } },
          { name: "size", in: "query", schema: { type: "string", enum: ["fb", "square", "story", "yt", "sticker", "telegram"], default: "fb" } },
          { name: "frame", in: "query", schema: { type: "string" } },
          { name: "font", in: "query", schema: { type: "string" } },
          { name: "lang", in: "query", schema: { type: "string", enum: ["uk", "en"] } },
          { name: "style", in: "query", schema: { type: "string", enum: ["base", "color", "big", "shadowS", "shadowD", "stitch", "invert", "marker"] } },
          { name: "align", in: "query", schema: { type: "string", enum: ["left", "center", "right", "stairR", "stairL"] } },
          { name: "hook", in: "query", schema: { type: "string" } },
        ],
        responses: {
          "200": {
            description: "Картка.",
            headers: randomHeaders,
            content: {
              "image/png": { schema: { type: "string", format: "binary" } },
              "image/gif": { schema: { type: "string", format: "binary" } },
              "application/json": { schema: { type: "object" } },
            },
          },
          ...errors,
        },
      },
    },
  },
  components: {
    schemas: {
      Corpus: { type: "string", enum: ["pro", "contra", "para", "non"] },
      Licence: {
        type: "object",
        required: ["id", "status", "attribution", "url"],
        properties: {
          id: { type: ["string", "null"] },
          status: { type: "string", enum: ["granted", "terms-pending", "metadata-only"] },
          attribution: { type: "string" },
          url: { type: ["string", "null"] },
        },
      },
      Item: {
        type: "object",
        required: ["id", "corpus", "title", "licence", "links", "data"],
        properties: {
          id: { type: "string", description: "Глобальний id `<corpus>:<localId>`." },
          corpus: { $ref: "#/components/schemas/Corpus" },
          title: { type: "string" },
          licence: { $ref: "#/components/schemas/Licence" },
          links: {
            type: "object",
            required: ["self", "html"],
            properties: { self: { type: "string" }, html: { type: ["string", "null"] } },
          },
          data: { description: "Специфічні для корпусу поля." },
        },
      },
      ItemList: {
        type: "object",
        required: ["apiVersion", "corpus", "total", "limit", "offset", "nextOffset", "items"],
        properties: {
          apiVersion: { const: "v1" },
          corpus: { oneOf: [{ $ref: "#/components/schemas/Corpus" }, { const: "mixed" }] },
          seed: { type: "string", description: "Лише у відповідях random; seed дослівно." },
          total: { type: "integer" },
          limit: { type: "integer" },
          offset: { type: "integer" },
          nextOffset: { type: ["integer", "null"] },
          items: { type: "array", items: { $ref: "#/components/schemas/Item" } },
        },
      },
      Error: {
        type: "object",
        required: ["error"],
        properties: {
          error: {
            type: "object",
            required: ["code", "message"],
            properties: {
              code: {
                type: "string",
                enum: ["invalid_request", "not_found", "method_not_allowed", "unavailable", "upstream_error"],
              },
              message: { type: "string" },
            },
          },
        },
      },
    },
  },
} as const;

const SWAGGER = "https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.17.14";

export const docsHtml = `<!doctype html>
<html lang="uk">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>verba-api</title>
<link rel="stylesheet" href="${SWAGGER}/swagger-ui.css">
</head>
<body>
<div id="swagger-ui"></div>
<script src="${SWAGGER}/swagger-ui-bundle.js"></script>
<script>
window.ui = SwaggerUIBundle({ url: "/v1/openapi.json", dom_id: "#swagger-ui" });
</script>
</body>
</html>
`;
