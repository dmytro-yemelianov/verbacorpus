import { searchProverbs, randomProverb, queryProverbs, type Proverb } from "./shared/corpus";
import { mapMatches, type Match } from "./shared/semantic";
import { negotiate, serialize, type Format, type Rec } from "./shared/serialize";
import openapiDoc from "./openapi.json";
import { buildProverbPage, cardModel, dailyIndex } from "./shared/meta";
import { makeVyshyvankaGif, makeVyshyvankaPng } from "./card-gif";
import { parseLang, t, hreflangLinks, DEFAULT_LANG } from "./shared/i18n";
import { fromShort } from "./shared/shortlink";
import { initBot, formatProverbHtml, draftNews } from "./telegram";
import { webhookCallback, InlineKeyboard } from "grammy";
import uk from "../public/i18n/uk.json";
import en from "../public/i18n/en.json";
import de from "../public/i18n/de.json";
import fr from "../public/i18n/fr.json";
import es from "../public/i18n/es.json";
import pl from "../public/i18n/pl.json";
import it from "../public/i18n/it.json";
import pt from "../public/i18n/pt.json";
import ja from "../public/i18n/ja.json";
import zh from "../public/i18n/zh.json";

const CATALOGS: Record<string, Record<string, string>> = { uk, en, de, fr, es, pl, it, pt, ja, zh };
function catalogFor(lang: string) { return CATALOGS[lang] ?? CATALOGS[DEFAULT_LANG]; }

interface Env {
  ASSETS: { fetch: (req: Request | string) => Promise<Response> };
  AI: { run: (model: string, inputs: { text: string[] }) => Promise<{ data: number[][] }> };
  VECTORIZE: {
    query: (vector: number[], opts: { topK: number }) => Promise<{ matches: Match[] }>;
    getByIds: (ids: string[]) => Promise<Array<{ id: string; values: number[] }>>;
  };
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHANNEL_ID?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
  NEWS_KV: KVNamespace;
}

const SEMANTIC_MIN_SCORE = 0.4;
const CORS = { "access-control-allow-origin": "*" };

let cache: Promise<{ proverbs: Proverb[]; explanations: Record<string, string>; meta: any; byId: Map<string, Proverb> }> | null = null;
function load(env: Env) {
  if (!cache) {
    cache = (async () => {
      const get = async (p: string) => {
        const res = await env.ASSETS.fetch("https://assets" + p);
        if (!res.ok) throw new Error(`Failed to fetch ${p}: ${res.status}`);
        return res.json();
      };
      const [proverbs, explanations, meta] = await Promise.all([
        get("/data/proverbs.json") as Promise<Proverb[]>,
        get("/data/explanations.json") as Promise<Record<string, string>>,
        get("/data/meta.json") as Promise<any>,
      ]);
      return { proverbs, explanations, meta, byId: new Map(proverbs.map((p) => [p.id, p])) };
    })().catch((err) => { cache = null; throw err; });
  }
  return cache;
}

const J = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", ...CORS } });

const finiteOrUndef = (n: number): number | undefined => (Number.isFinite(n) ? n : undefined);

/** Render a record set in the negotiated format with the right headers. */
function respond(
  fmt: Format, records: Rec[],
  o: { single?: boolean; total?: number; limit?: number; offset?: number; withExplanation?: boolean; name?: string },
): Response {
  const { body, contentType, filename } = serialize(records, fmt, o);
  const headers: Record<string, string> = { "content-type": contentType, ...CORS };
  if (!o.single && o.total !== undefined) headers["x-total-count"] = String(o.total);
  if (filename) headers["content-disposition"] = `attachment; filename="${filename}"`;
  return new Response(body, { headers });
}

function translateHtml(res: Response, lang: string, rest: string, host: string): Response {
  const cat = catalogFor(lang);
  const inject =
    `<script>window.__LANG__=${JSON.stringify(lang)}</script>\n` +
    hreflangLinks(rest, host) + `\n` +
    `<link rel="canonical" href="https://${host}${lang === DEFAULT_LANG ? "" : "/" + lang}${rest === "/" ? "/" : rest}" />\n` +
    `<meta property="og:locale" content="${lang}" />`;
  return new HTMLRewriter()
    .on("html", { element(el) { el.setAttribute("lang", lang); } })
    .on("[data-i18n]", { element(el) { const k = el.getAttribute("data-i18n"); if (k) el.setInnerContent(t(cat, k), { html: false }); } })
    .on("[data-i18n-html]", { element(el) { const k = el.getAttribute("data-i18n-html"); if (k) el.setInnerContent(t(cat, k), { html: true }); } })
    .on("[data-i18n-attr]", { element(el) {
        const spec = el.getAttribute("data-i18n-attr") || "";
        const [attr, key] = spec.split(":");
        if (attr && key) el.setAttribute(attr, t(cat, key));
      } })
    .on("head", { element(el) { el.append(inject, { html: true }); } })
    .transform(res);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const url = new URL(request.url);
      const { lang, rest } = parseLang(url.pathname);
      // /uk or /uk/... → 301 canonical (unprefixed)
      if (/^\/uk(\/|$)/.test(url.pathname)) {
        return Response.redirect(`https://${url.host}${rest}${url.search}`, 301);
      }
      const raw0 = url.pathname;
      // short-link route: /s/<n> → 301 /p/p000NNN
      const sMatch = rest.match(/^\/s\/(.+)$/);
      if (sMatch) {
        const { meta } = await load(env);
        const id = fromShort(sMatch[1], meta.count);
        if (!id) return new Response("Not found", { status: 404 });
        return Response.redirect(`https://${url.host}/p/${id}`, 301);
      }
      // social-card routes (need the corpus) — match on rest for /p/, raw0 for /card/
      if (rest.startsWith("/p/") || raw0.startsWith("/card/")) {
        const { proverbs, byId, meta } = await load(env);
        const host = url.host;
        const HTML = (body: string, status = 200) =>
          new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8", "access-control-allow-origin": "*" } });

        const pm = rest.match(/^\/p\/(.+)$/);
        if (pm) {
          const p = byId.get(decodeURIComponent(pm[1]));
          const cat = catalogFor(lang);
          if (!p) return HTML(`<!DOCTYPE html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Не знайдено — verba</title><link rel="stylesheet" href="/styles.css"></head><body><main class="wrap" style="padding-block:4rem;"><p class="empty">Прислів'я не знайдено. <a href="/">На головну</a></p></main></body></html>`, 404);
          const srcCites = (p.sources as string[]).map((k: string) => {
            const s = (meta.sources as Array<{ key: string; citation?: string; author?: string; title?: string; year?: string }>).find((x) => x.key === k);
            return s ? (s.citation || (s.author ? s.author + ". " : "") + (s.title || k) + (s.year ? " (" + s.year + ")" : "")) : k;
          });
          return HTML(buildProverbPage(p, host, cat, lang, srcCites));
        }
        const cmGif = raw0.match(/^\/card\/(.+)\.gif$/);
        if (cmGif) {
          const key = decodeURIComponent(cmGif[1]);
          const cacheable = (resp: Response, maxAge: number) => {
            const r = new Response(resp.body, resp);
            r.headers.set("cache-control", `public, max-age=${maxAge}${maxAge > 86400 ? ", immutable" : ""}`);
            r.headers.set("access-control-allow-origin", "*");
            return r;
          };
          const qp = url.searchParams;
          const format = qp.get("format") || "fb";
          const cardLang = qp.get("lang") || "uk";

          let p: Proverb | undefined;
          if (key === "daily") {
            const pool = proverbs.filter((p) => { const t = p.text.trim(); return /^[А-ЯІЇЄҐ]/.test(t) && t.length >= 18 && t.length <= 90 && t.split(/\s+/).length >= 4; });
            p = pool[dailyIndex(new Date().toISOString().slice(0, 10), pool.length)] ?? proverbs[0];
          } else {
            p = byId.get(key);
          }

          if (!p) return new Response("not found", { status: 404, headers: { "access-control-allow-origin": "*" } });

          const model = cardModel(p, { host: url.host, lang: cardLang, sources: meta.sources });
          const gifBytes = await makeVyshyvankaGif(model, format, p.id);

          const gifResp = new Response(gifBytes, {
            headers: { "content-type": "image/gif" }
          });
          return cacheable(gifResp, key === "daily" ? 86400 : 31536000);
        }
        const cm = raw0.match(/^\/card\/(.+)\.png$/);
        if (cm) {
          const key = decodeURIComponent(cm[1]);
          const cacheable = (resp: Response, maxAge: number) => {
            const r = new Response(resp.body, resp);
            r.headers.set("cache-control", `public, max-age=${maxAge}${maxAge > 86400 ? ", immutable" : ""}`);
            r.headers.set("access-control-allow-origin", "*");
            return r;
          };
          const qp = url.searchParams;
          const format = qp.get("format") || "fb";
          const cardLang = qp.get("lang") || "uk";
          const minimal = qp.get("minimal") === "1";
          const nochrome = qp.get("nochrome") === "1";

          const pngResp = async (pick: Proverb, maxAge: number) => {
            const bytes = await makeVyshyvankaPng(cardModel(pick, { host: url.host, lang: cardLang, sources: meta.sources }), format, pick.id, { minimal, nochrome });
            return cacheable(new Response(bytes, { headers: { "content-type": "image/png" } }), maxAge);
          };
          if (key === "daily") {
            const pool = proverbs.filter((p) => { const t = p.text.trim(); return /^[А-ЯІЇЄҐ]/.test(t) && t.length >= 18 && t.length <= 90 && t.split(/\s+/).length >= 4; });
            const pick = pool[dailyIndex(new Date().toISOString().slice(0, 10), pool.length)] ?? proverbs[0];
            return pngResp(pick, 86400);
          }
          const p = byId.get(key);
          if (!p) return new Response("not found", { status: 404, headers: { "access-control-allow-origin": "*" } });
          return pngResp(p, 31536000);
        }
        return new Response("not found", { status: 404, headers: { "access-control-allow-origin": "*" } });
      }
      if (rest === "/blog/latest.json") {
        let assetRes = await env.ASSETS.fetch(new Request(`https://${url.host}${lang === "uk" ? "" : "/" + lang}/blog/latest.json`, request));
        if (!assetRes.ok && lang !== "uk") {
          if (lang !== "en") {
            assetRes = await env.ASSETS.fetch(new Request(`https://${url.host}/en/blog/latest.json`, request));
          }
          if (!assetRes.ok) {
            assetRes = await env.ASSETS.fetch(new Request(`https://${url.host}/blog/latest.json`, request));
          }
        }
        return assetRes;
      }

      // Static assets + API bypass the translation layer (rest has no lang prefix for them)
      const htmlPage = rest === "/" || rest === "/about" || rest === "/about.html" || rest === "/api.html" || rest === "/blog" || rest.startsWith("/blog/");
      if (!rest.startsWith("/api/") && !htmlPage) {
        const assetReq = rest === url.pathname ? request : new Request(`https://${url.host}${rest}${url.search}`, request);
        return env.ASSETS.fetch(assetReq);
      }
      if (htmlPage) {
        let assetPath = rest;
        if (rest === "/") {
          assetPath = "/index.html";
        } else if (rest === "/about") {
          assetPath = "/about.html";
        } else if (rest === "/blog") {
          assetPath = "/blog/index.html";
        } else if (rest.startsWith("/blog/") && !rest.endsWith(".html")) {
          assetPath = `${rest}.html`;
        }

        let assetRes: Response;
        if (lang !== DEFAULT_LANG) {
          // Attempt to load the language-specific static asset
          assetRes = await env.ASSETS.fetch(new Request(`https://${url.host}/${lang}${assetPath}`));
          if (!assetRes.ok) {
            // Fall back to English static asset if available
            if (lang !== "en") {
              assetRes = await env.ASSETS.fetch(new Request(`https://${url.host}/en${assetPath}`));
            }
            // Fall back to default (Ukrainian) static asset
            if (!assetRes.ok) {
              assetRes = await env.ASSETS.fetch(new Request(`https://${url.host}${assetPath}`));
            }
          }
        } else {
          // Default (Ukrainian) static asset
          assetRes = await env.ASSETS.fetch(new Request(`https://${url.host}${assetPath}`));
        }

        if (lang === DEFAULT_LANG && assetRes.ok) return assetRes;
        return translateHtml(assetRes, lang, rest, url.host);
      }
      // strip optional /v1 -> reuse canonical handlers; aliases keep working
      const raw = rest;
      const path = raw.startsWith("/api/v1/") ? "/api/" + raw.slice("/api/v1/".length) : (raw === "/api/v1" ? "/api" : raw);
      const qp = url.searchParams;

      if (path === "/api/telegram-webhook") {
        if (!env.TELEGRAM_BOT_TOKEN) {
          return new Response("Telegram Bot Token is not configured", { status: 500 });
        }
        if (env.TELEGRAM_WEBHOOK_SECRET) {
          const secretHeader = request.headers.get("x-telegram-bot-api-secret-token");
          if (secretHeader !== env.TELEGRAM_WEBHOOK_SECRET) {
            return new Response("Unauthorized", { status: 403 });
          }
        }
        const { proverbs, explanations, meta } = await load(env);
        const bot = initBot(env as any, proverbs, explanations, meta, url.host);
        return webhookCallback(bot, "cloudflare-mod")(request);
      }

      // docs pointer (static — not subject to format negotiation)
      if (path === "/api") return J({ api: "ukr-proverbs", version: "v1", docs: "/api.html", openapi: "/api/v1/openapi.json",
        endpoints: ["/api/v1/search", "/api/v1/semantic", "/api/v1/random", "/api/v1/query", "/api/v1/proverb/:id", "/api/v1/export", "/api/v1/categories", "/api/v1/meta"] });
      if (path === "/api/openapi.json") return J(openapiDoc);

      // format negotiation (data endpoints); null => bad ?format
      const fmt = negotiate(qp.get("format"), request.headers.get("accept"));
      if (fmt === null) return J({ error: `unknown format '${qp.get("format")}'; use json|jsonl|xml|csv|tsv` }, 400);

      const { proverbs, explanations, meta, byId } = await load(env);
      const lim = () => finiteOrUndef(Number(qp.get("limit")));
      const off = () => finiteOrUndef(Number(qp.get("offset")));
      const eff = (l?: number, o?: number) => ({ limit: Math.min(Math.max(l ?? 50, 1), 200), offset: Math.max(o ?? 0, 0) });

      if (path === "/api/search") {
        const r = searchProverbs(proverbs, { q: qp.get("q") ?? undefined, category: qp.get("category") ?? undefined, source: qp.get("source") ?? undefined, limit: lim(), offset: off() });
        const e = eff(lim(), off());
        return respond(fmt, r.results as Rec[], { total: r.total, limit: e.limit, offset: e.offset, name: "search" });
      }
      if (path === "/api/query") {
        const has = qp.get("has_explanation");
        const r = queryProverbs(proverbs, {
          category: qp.get("category") ?? undefined, source: qp.get("source") ?? undefined,
          variant_group: qp.get("variant_group") ?? undefined,
          has_explanation: has === null ? undefined : has === "true",
          explanationIds: new Set(Object.keys(explanations)),
          limit: lim(), offset: off(),
        });
        const e = eff(lim(), off());
        return respond(fmt, r.results as Rec[], { total: r.total, limit: e.limit, offset: e.offset, name: "query" });
      }
      if (path === "/api/random") {
        const n = Math.min(Math.max(finiteOrUndef(Number(qp.get("n"))) ?? 1, 1), 50);
        const picked: Proverb[] = [];
        const seen = new Set<string>();
        for (let i = 0; i < n * 5 && picked.length < n; i++) {
          const p = randomProverb(proverbs, { category: qp.get("category") ?? undefined, source: qp.get("source") ?? undefined });
          if (p && !seen.has(p.id)) { seen.add(p.id); picked.push(p); }
          if (!p) break;
        }
        return respond(fmt, picked as Rec[], { total: picked.length, limit: n, offset: 0, name: "random" });
      }
      if (path === "/api/export") {
        const r = queryProverbs(proverbs, { category: qp.get("category") ?? undefined, source: qp.get("source") ?? undefined, unbounded: true });
        const withExpl = r.results.map((p) => ({ ...p, explanation: explanations[p.id] ?? "" })) as Rec[];
        return respond(fmt, withExpl, { total: r.total, withExplanation: true, name: "export" });
      }
      if (path === "/api/categories") {
        const counts = meta.per_category ?? {};
        return J(Object.entries(meta.taxonomy as Record<string, string>).map(([key, label]) => ({ key, label, count: counts[key] ?? 0 })));
      }
      if (path === "/api/meta") return J(meta);
      const m = path.match(/^\/api\/proverb\/(.+)$/);
      if (m) {
        const p = proverbs.find((x) => x.id === decodeURIComponent(m[1]));
        if (!p) return J({ error: "not found" }, 404);
        return respond(fmt, [{ ...p, explanation: explanations[p.id] ?? null }] as Rec[], { single: true, withExplanation: true, name: "proverb" });
      }
      if (path === "/api/semantic") {
        const q = (qp.get("q") ?? "").trim();
        if (!q) return J({ error: "missing q" }, 400);
        if (!env.AI || !env.VECTORIZE) return J({ error: "semantic search unavailable" }, 503);
        try {
          const { data } = await env.AI.run("@cf/baai/bge-m3", { text: [q] });
          const { matches } = await env.VECTORIZE.query(data[0], { topK: 100 });
          const minScore = qp.get("minScore") ? Number(qp.get("minScore")) : SEMANTIC_MIN_SCORE;
          const r = mapMatches(matches, byId, { category: qp.get("category") ?? undefined, source: qp.get("source") ?? undefined, minScore: Number.isFinite(minScore) ? minScore : SEMANTIC_MIN_SCORE, limit: lim() });
          const e = eff(lim(), 0);
          // score lives on the Scored records; csv/xml/tsv drop it (fixed cols)
          return respond(fmt, r.results as Rec[], { total: r.total, limit: e.limit, offset: 0, name: "semantic" });
        } catch { return J({ error: "semantic search failed" }, 502); }
      }
      const sim = path.match(/^\/api\/similar\/(.+)$/);
      if (sim) {
        if (!env.VECTORIZE) return J({ error: "semantic search unavailable" }, 503);
        const id = decodeURIComponent(sim[1]);
        try {
          const recs = await env.VECTORIZE.getByIds([id]);
          if (!recs.length) return J({ error: "not indexed" }, 404);
          const l = finiteOrUndef(Number(qp.get("limit"))) ?? 6;
          const { matches } = await env.VECTORIZE.query(recs[0].values, { topK: Math.min(l + 1, 100) });
          const r = mapMatches(matches, byId, { excludeId: id, limit: l });
          return respond(fmt, r.results as Rec[], { total: r.total, limit: l, offset: 0, name: "similar" });
        } catch { return J({ error: "similar lookup failed" }, 502); }
      }
      return J({ error: "unknown endpoint" }, 404);
    } catch (err: any) {
      console.error("Internal error:", err);
      return J({ error: "internal error" }, 500);
    }
  },

  async scheduled(event: any, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil((async () => {
      if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHANNEL_ID) {
        console.error("Telegram credentials missing for scheduled posting");
        return;
      }

      const get = async (p: string) => {
        const res = await env.ASSETS.fetch("https://assets" + p);
        if (!res.ok) throw new Error(`Failed to fetch ${p}: ${res.status}`);
        return res.json();
      };

      const [proverbs, explanations, meta] = await Promise.all([
        get("/data/proverbs.json") as Promise<Proverb[]>,
        get("/data/explanations.json") as Promise<Record<string, string>>,
        get("/data/meta.json") as Promise<any>,
      ]);

      const host = "verbacorpus.org";
      const byId = new Map(proverbs.map((p) => [p.id, p]));
      const bot = initBot(env as any, proverbs, explanations, meta, host);

      if (event.cron !== "0 6 * * *") {
        const n = await draftNews(bot.api, env, byId, host);
        console.log(`news cron: drafted ${n}`);
        return;
      }

      const pool = proverbs.filter((p) => {
        const t = p.text.trim();
        return /^[А-ЯІЇЄҐ]/.test(t) && t.length >= 18 && t.length <= 90 && t.split(/\s+/).length >= 4;
      });

      const pick = pool[dailyIndex(new Date().toISOString().slice(0, 10), pool.length)] ?? proverbs[0];
      const explanation = explanations[pick.id] || null;
      const formatted = formatProverbHtml(pick, explanation, meta.sources);
      const photoUrl = `https://${host}/card/${pick.id}.png?format=telegram&lang=uk&v=5`;

      const keyboard = new InlineKeyboard()
        .url("🔗 Читати на сайті", `https://${host}/p/${pick.id}`);

      await bot.api.sendPhoto(env.TELEGRAM_CHANNEL_ID, photoUrl, {
        caption: `🎲 <b>Прислів'я дня</b>\n\n${formatted}`,
        parse_mode: "HTML",
        reply_markup: keyboard,
      });

      console.log(`Successfully posted daily proverb ${pick.id} to Telegram`);
    })());
  }
};
