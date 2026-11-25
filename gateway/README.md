# verba-api

Read-only шлюз Cloudflare Workers до корпусів екосистеми Verba за єдиним контрактом: `pro` (прислів'я), `contra` (без табу), `para` (шрифти Nasinnia), `non` (орнаменти). Корпуси читаються через service bindings `PRO` (contra живе в тому ж Worker), `UPA` і `FONTS`.

Опис API: OpenAPI 3.1 на `/v1/openapi.json` (те саме віддає `/v1`), Swagger UI на `/v1/docs`.

## Локальний запуск

`npx wrangler dev --local` не підходить: service bindings потребують справжніх Workers-джерел, а заглушок для них немає. Спершу розгорни джерела (`ukr-proverbs-corpus`, `upa-local-preview`, `nasinnia`), потім:

```sh
npm install
npx wrangler dev --remote
```

Перевірки: `npx vitest run`, `npx tsc --noEmit`, `npx wrangler deploy --dry-run`. Розгортання — лише свідомо.

## Приклади

Домен `api.verbacorpus.org` запрацює лише після розгортання.

```sh
curl https://api.verbacorpus.org/v1/corpora
curl https://api.verbacorpus.org/v1/pro/meta
curl 'https://api.verbacorpus.org/v1/pro/items?limit=5&offset=10'
curl 'https://api.verbacorpus.org/v1/items/pro:<localId>'
curl 'https://api.verbacorpus.org/v1/pro/random?n=3&seed=%D0%B7%D0%B8%D0%BC%D0%B0'
curl 'https://api.verbacorpus.org/v1/random?corpus=pro,non&n=5'
```

Random: `n` від 1 до 20; `seed` до 128 символів, довільний Unicode. Той самий seed дає ту саму вибірку, доки не змінюється total корпусу. Seed повертається в полі `seed` та в заголовку `x-verba-seed` (`encodeURIComponent`). Без seed відповідь `no-store`, із seed `public, max-age=86400`. `total` у random-відповіді — кількість повернених елементів. Без `corpus` змішуються доступні з pro, non, para; contra лише через `corpus=contra`.

## Помилки

`400 invalid_request`, `404 not_found`, `405 method_not_allowed`, `503 unavailable` (немає binding, мережева помилка, 5xx чи таймаут джерела), `502 upstream_error` (некоректна відповідь або неочікувана 4xx джерела). `/v1/corpora` переживає мертві джерела: для них `total: null, available: false`.

## Права за корпусами

| Корпус | Ліцензія | Статус | Атрибуція |
|---|---|---|---|
| pro | CC-BY-4.0 | granted | Yemelianov, Dmytro (2026). verba — Ukrainian Proverbs Corpus |
| non | немає | terms-pending | Hough, 2025 / Габданк-Рогозинський |
| contra | немає | terms-pending | Л. Ставицька, „Українська мова без табу“ |
| para | із запису Nasinnia | granted лише якщо шрифт downloadable і redistributionAllowed, інакше metadata-only | з запису шрифту |

`licence` у `/v1/para/meta` та `/v1/corpora` для para — `null`: права вказано на рівні кожного елемента.
