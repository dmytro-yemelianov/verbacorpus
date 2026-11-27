import { CARD_VERSION } from "./shared/card-version";
import { Bot, InlineKeyboard, Keyboard } from "grammy";
import { type Proverb, randomProverb, searchProverbs, filterProverbs } from "./shared/corpus";
import { mapMatches } from "./shared/semantic";
import { srcLabel } from "./shared/sources";
import { prettify } from "./shared/text";
import { gatherNews, pickUnseen, matchProverbs, putDraft, markSeen, newsId, NEWS_BATCH, getDraft, delDraft, type Draft } from "./news";
import type { CardSize } from "./card/recipe";
import { crosspostProverbToInstagram } from "./instagram";

// Public Telegram channel for the corpus — surfaced as a tappable button on card replies.
const CHANNEL_URL = "https://t.me/VerbaCorpus";
// Static sticker pack (built by scripts/build-stickers.mjs).
const STICKER_PACK_URL = "https://t.me/addstickers/verba_by_verbacorpus_bot";
// Deep-link base for the bot — `${BOT_URL}?start=random` opens the bot and triggers a
// random card, so shared/forwarded cards (and the channel) carry working action buttons.
const BOT_URL = "https://t.me/verbacorpus_bot";
// Donations — non-commercial project; funds go to native-speaker audio + corpus growth.
// monobank jar takes card / Apple Pay / Google Pay. KOFI_URL stays empty until set up;
// the Ko-fi button only renders when it has a real URL.
const JAR_URL = "https://send.monobank.ua/jar/7mzPGnKyQr";
const KOFI_URL = "https://ko-fi.com/dmytroyemelianov";
const SUPPORT_URL = "https://verbacorpus.org/about#support";
// Only this Telegram user id can trigger admin commands (/news, etc).
const ADMIN_USER_ID = 198155742; // @dyemelianov

export interface TelegramEnv {
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_CHANNEL_ID: string;
  TELEGRAM_WEBHOOK_SECRET: string;
  AI?: { run: (model: string, inputs: { text: string[] }) => Promise<{ data: number[][] }> };
  VECTORIZE?: {
    query: (vector: number[], opts: { topK: number }) => Promise<{ matches: any[] }>;
    getByIds: (ids: string[]) => Promise<Array<{ id: string; values: number[] }>>;
  };
  NEWS_KV?: KVNamespace;
  VERBA_API_BASE?: string;
  INSTAGRAM_ACCOUNT_ID?: string;
  INSTAGRAM_ACCESS_TOKEN?: string;
}

// Card photos come from the Verba API gateway (which proxies to this Worker's /card/render.png).
export function cardPhotoUrl(env: { VERBA_API_BASE?: string }, proverbId: string, size: CardSize = "telegram"): string {
  const base = (env.VERBA_API_BASE ?? "https://api.verbacorpus.org").replace(/\/+$/, "");
  return `${base}/v1/cards/pro:${proverbId}.png?size=${size}`;
}

// Direct Verba card URL, used when the gateway URL cannot be fetched by Telegram.
export function directCardUrl(proverbId: string, size: CardSize = "telegram"): string {
  return `https://pro.verbacorpus.org/card/${proverbId}.png?format=${size}&v=${CARD_VERSION}`;
}

// Gateway URL first; if sending with it throws, retry once with the direct Verba URL; if that
// also fails, fall back to the text-only `sendText`. Used by every photo-sending site.
export async function sendCardWithFallback(
  env: { VERBA_API_BASE?: string },
  proverbId: string,
  sendPhoto: (url: string) => Promise<unknown>,
  sendText: () => Promise<unknown>,
  size: CardSize = "telegram",
): Promise<void> {
  try {
    await sendPhoto(cardPhotoUrl(env, proverbId, size));
    return;
  } catch (e) {
    console.warn("card photo (gateway) failed, retrying direct", e);
  }
  try {
    await sendPhoto(directCardUrl(proverbId, size));
    return;
  } catch (e) {
    console.warn("card photo (direct) failed, sending text", e);
  }
  await sendText();
}

export function buildCardInlineKeyboard(pId: string, currentSize: CardSize, host: string): InlineKeyboard {
  const kb = new InlineKeyboard();
  if (currentSize === "story") {
    kb.text("🎲 Інше сторіз", "story_shuffle")
      .text("🖼️ Пост (1080×1080)", `card_size:square:${pId}`)
      .row()
      .text("↩️ Звичайна картка", `card_size:telegram:${pId}`)
      .url("🔗 На сайті", `https://${host}/p/${pId}`)
      .row()
      .url("📣 @VerbaCorpus", CHANNEL_URL);
  } else if (currentSize === "square") {
    kb.text("🎲 Інший пост", "square_shuffle")
      .text("📱 Сторіз (1080×1920)", `card_size:story:${pId}`)
      .row()
      .text("↩️ Звичайна картка", `card_size:telegram:${pId}`)
      .url("🔗 На сайті", `https://${host}/p/${pId}`)
      .row()
      .url("📣 @VerbaCorpus", CHANNEL_URL);
  } else {
    kb.text("🎲 Ще одне", "random_shuffle")
      .url("🔗 На сайті", `https://${host}/p/${pId}`)
      .row()
      .text("📱 Сторіз", `card_size:story:${pId}`)
      .text("🖼️ Пост", `card_size:square:${pId}`)
      .row()
      .url("📣 @VerbaCorpus", CHANNEL_URL);
  }
  return kb;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// News-led channel caption: headline (linked) + source, proverb as the comment beneath.
export function newsCaption(d: Draft, proverbText: string, modern: string): string {
  const pm = modern && modern.trim() !== proverbText.trim() ? `\n<i>(${escapeHtml(modern)})</i>` : "";
  return `📰 <a href="${escapeHtml(d.link)}">${escapeHtml(d.newsTitle)}</a>\n<i>${escapeHtml(d.source)}</i>\n\n💬 <b>${escapeHtml(proverbText)}</b>${pm}`;
}

export type SourceMeta = { key: string; title?: string; author?: string; year?: string };

// Short bibliography reference for one source key: «Book title» — Author, Year.
// Falls back to the plain source label when the metadata isn't available.
function citeSource(key: string, sources?: SourceMeta[]): string {
  const s = sources?.find((x) => x.key === key);
  if (!s || (!s.title && !s.author && !s.year)) return escapeHtml(srcLabel(key));
  const head = s.title ? `«${escapeHtml(s.title)}»` : escapeHtml(srcLabel(key));
  const tail = [s.author, s.year].filter(Boolean).map((x) => escapeHtml(x!)).join(", ");
  return tail ? `${head} — ${tail}` : head;
}

export function formatProverbHtml(p: Proverb, explanation?: string | null, sources?: SourceMeta[]): string {
  const pt = escapeHtml(prettify(p.text));
  const pm = p.modern_text && p.modern_text.trim() !== p.text.trim() ? escapeHtml(prettify(p.modern_text)) : "";
  const srcs = p.sources.map((k) => citeSource(k, sources)).join("; ");

  let html = `<b>${pt}</b>\n`;
  if (pm) {
    html += `<i>(${pm})</i>\n`;
  }
  // Bibliography-style source, shown directly (unmasked) so the attribution is visible
  // on shared/forwarded cards without tapping.
  html += `\n📖 <b>Джерело:</b> ${srcs}`;
  if (explanation) {
    html += `\n💡 <b>Пояснення:</b> <tg-spoiler>${escapeHtml(explanation)}</tg-spoiler>`;
  }
  html += `\n\n📣 <a href="${CHANNEL_URL}">@VerbaCorpus</a>`;
  return html;
}

// Draft up to NEWS_BATCH unseen news items: match proverbs, store a draft, DM the admin.
// Returns the number of drafts sent. env carries AI/VECTORIZE/NEWS_KV/TELEGRAM_CHANNEL_ID.
export async function draftNews(api: any, env: any, byId: Map<string, Proverb>, host: string): Promise<number> {
  if (!env.AI || !env.VECTORIZE || !env.NEWS_KV) return 0;
  const items = await pickUnseen(await gatherNews((u) => fetch(u)), env.NEWS_KV, NEWS_BATCH);
  let sent = 0;
  for (const it of items) {
    let ids: string[];
    try {
      ids = await matchProverbs(env.AI, env.VECTORIZE, it.title, byId);
    } catch (e) {
      console.error("news match failed", it.id, e);
      continue; // transient — leave UNSEEN so it retries next tick; do NOT markSeen
    }
    if (!ids.length) { await markSeen(env.NEWS_KV, it.id); continue; } // genuine no-match: don't re-draft
    const draftId = newsId(it.link);
    await markSeen(env.NEWS_KV, it.id);
    await putDraft(env.NEWS_KV, draftId, { newsTitle: it.title, link: it.link, source: it.source, proverbIds: ids });
    const list = ids.map((id, i) => `${i + 1}. ${escapeHtml((byId.get(id)?.text || "").slice(0, 90))}`).join("\n");
    const kb = new InlineKeyboard();
    ids.forEach((_, i) => kb.text(String(i + 1), `news:${draftId}:${i}`));
    kb.row().text("⏭ Пропустити", `news:${draftId}:skip`);
    await api.sendMessage(ADMIN_USER_ID,
      `📰 <b>${escapeHtml(it.title)}</b>\n${escapeHtml(it.source)} · <a href="${escapeHtml(it.link)}">читати</a>\n\nПрислів'я-коментар — оберіть:\n${list}`,
      { parse_mode: "HTML", link_preview_options: { is_disabled: true }, reply_markup: kb });
    sent++;
  }
  return sent;
}

export function buildCategoriesKeyboard(taxonomy: Record<string, string>): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  const entries = Object.entries(taxonomy);
  for (let i = 0; i < entries.length; i += 2) {
    const [k1, v1] = entries[i];
    keyboard.text(v1, `cat:${k1}`);
    if (i + 1 < entries.length) {
      const [k2, v2] = entries[i + 1];
      keyboard.text(v2, `cat:${k2}`);
    }
    keyboard.row();
  }
  return keyboard;
}

export function initBot(
  env: TelegramEnv,
  corpus: Proverb[],
  explanations: Record<string, string>,
  meta: any,
  host: string
) {
  const bot = new Bot(env.TELEGRAM_BOT_TOKEN, {
    botInfo: {
      id: 123456,
      is_bot: true,
      first_name: "verba",
      username: "verbacorpus_bot",
      can_join_groups: true,
      can_read_all_group_messages: false,
      supports_inline_queries: true,
      can_connect_to_business: false,
      has_main_web_app: false,
      has_topics_enabled: false,
      allows_users_to_create_topics: false,
      can_manage_bots: false,
      supports_join_request_queries: false,
    }
  });
  const taxonomy = meta.taxonomy || {};
  const byId = new Map(corpus.map((p) => [p.id, p]));

  // Persistent reply-keyboard menu — users tap instead of typing commands.
  const mainKeyboard = new Keyboard()
    .text("🎲 Випадкове").text("📱 Сторіз").row()
    .text("🏷️ Категорії").text("🎨 Стікери").row()
    .text("ℹ️ Довідка").text("❤️ Підтримати")
    .resized().persistent();

  // Card-sending helpers reused by /commands, the reply keyboard (hears), and ?start deep links.
  const sendRandomCard = async (ctx: any) => {
    const p = randomProverb(corpus, {});
    if (!p) return ctx.reply("❌ Не вдалося знайти прислів'я.");
    const explanation = explanations[p.id] || null;
    const keyboard = buildCardInlineKeyboard(p.id, "telegram", host);
    const caption = formatProverbHtml(p, explanation, meta.sources);
    await sendCardWithFallback(env, p.id,
      (url) => ctx.replyWithPhoto(url, { caption, parse_mode: "HTML", reply_markup: keyboard }),
      () => ctx.reply(caption, { parse_mode: "HTML", reply_markup: keyboard }),
      "telegram");
  };
  const sendStoryCard = async (ctx: any, targetId?: string) => {
    const p = targetId ? byId.get(targetId) : randomProverb(corpus, {});
    if (!p) return ctx.reply("❌ Не вдалося знайти прислів'я.");
    const explanation = explanations[p.id] || null;
    const keyboard = buildCardInlineKeyboard(p.id, "story", host);
    const caption = `📱 <b>Картка для Instagram Story (1080×1920)</b>\n\n${formatProverbHtml(p, explanation, meta.sources)}`;
    await sendCardWithFallback(env, p.id,
      (url) => ctx.replyWithPhoto(url, { caption, parse_mode: "HTML", reply_markup: keyboard }),
      () => ctx.reply(caption, { parse_mode: "HTML", reply_markup: keyboard }),
      "story");
  };
  const sendSquareCard = async (ctx: any, targetId?: string) => {
    const p = targetId ? byId.get(targetId) : randomProverb(corpus, {});
    if (!p) return ctx.reply("❌ Не вдалося знайти прислів'я.");
    const explanation = explanations[p.id] || null;
    const keyboard = buildCardInlineKeyboard(p.id, "square", host);
    const caption = `🖼️ <b>Картка для Instagram Post (1080×1080)</b>\n\n${formatProverbHtml(p, explanation, meta.sources)}`;
    await sendCardWithFallback(env, p.id,
      (url) => ctx.replyWithPhoto(url, { caption, parse_mode: "HTML", reply_markup: keyboard }),
      () => ctx.reply(caption, { parse_mode: "HTML", reply_markup: keyboard }),
      "square");
  };
  const sendCategories = (ctx: any) =>
    ctx.reply("🏷️ <b>Оберіть тему для пошуку прислів'їв:</b>", { parse_mode: "HTML", reply_markup: buildCategoriesKeyboard(taxonomy) });
  const sendStickers = (ctx: any) =>
    ctx.reply("🎨 <b>Стікери verba</b>\n\nНабір стікерів з українськими прислів'ями — додайте й діліться ними в будь-якому чаті:", {
      parse_mode: "HTML",
      reply_markup: new InlineKeyboard().url("➕ Додати стікерпак", STICKER_PACK_URL),
    });
  const sendDonate = (ctx: any) => {
    const keyboard = new InlineKeyboard().url("🌾 monobank банка", JAR_URL);
    if (KOFI_URL) keyboard.url("☕ Ko-fi", KOFI_URL);
    keyboard.row().url("ℹ️ Про підтримку", SUPPORT_URL);
    return ctx.reply(
      `🌾 <b>Підтримати verba</b>\n\n` +
        `verba — некомерційний проєкт із відкритими даними. Сайт і бот безкоштовні; ` +
        `донати йдуть на розвиток: озвучення прислів'їв носіями та розширення корпусу.\n\n` +
        `Дякую, що бережемо живе слово разом! 🇺🇦`,
      { parse_mode: "HTML", link_preview_options: { is_disabled: true }, reply_markup: keyboard },
    );
  };
  const sendHelp = (ctx: any) =>
    ctx.reply(
      `📖 <b>Довідка бота verba</b>\n\n` +
        `• /random — випадкове прислів'я з усього корпусу.\n` +
        `• /story [номер] — вертикальна картка для Instagram Story (1080×1920).\n` +
        `• /post [номер] — квадратна картка для Instagram Post (1080×1080).\n` +
        `• /categories — 27 тематичних категорій.\n` +
        `• /search <code>&lt;слово&gt;</code> — пошук за словом або фразою.\n` +
        `• /semantic <code>&lt;фраза&gt;</code> — пошук за змістом (AI).\n` +
        `• /stickers — набір стікерів.\n` +
        `• /donate — підтримати проєкт.\n\n` +
        `Бот містить 48,787 унікальних народних висловів.`,
      { parse_mode: "HTML" },
    );

  bot.command("start", async (ctx) => {
    if (ctx.match === "random") return sendRandomCard(ctx);   // deep link t.me/<bot>?start=random
    if (ctx.match === "story") return sendStoryCard(ctx);
    const welcome =
      `🇺🇦 <b>Вітаємо у verba bot!</b>\n\n` +
      `Це офіційний бот корпусу українських прислів'їв та приказок (<a href="https://verbacorpus.org">verbacorpus.org</a>).\n\n` +
      `Користуйтеся кнопками нижче або командами:\n` +
      `🎲 /random · 📱 /story · 🖼️ /post · 🏷️ /categories · 🔍 /search · 🧠 /semantic · 🎨 /stickers · ❤️ /donate\n\n` +
      `💡 <i>Мене можна використовувати в будь-якому чаті — введіть <code>@${ctx.me.username} &lt;запит&gt;</code>, щоб поділитися карткою.</i>`;
    await ctx.reply(welcome, { parse_mode: "HTML", link_preview_options: { is_disabled: true }, reply_markup: mainKeyboard });
  });

  bot.command("help", (ctx) => sendHelp(ctx));
  bot.command("stickers", (ctx) => sendStickers(ctx));
  bot.command("random", (ctx) => sendRandomCard(ctx));
  bot.command("story", (ctx) => sendStoryCard(ctx, ctx.match?.trim() || undefined));
  bot.command("post", (ctx) => sendSquareCard(ctx, ctx.match?.trim() || undefined));
  bot.command("categories", (ctx) => sendCategories(ctx));
  bot.command("donate", (ctx) => sendDonate(ctx));

  // Reply-keyboard buttons send their label as text → route to the same actions.
  bot.hears("🎲 Випадкове", (ctx) => sendRandomCard(ctx));
  bot.hears("📱 Сторіз", (ctx) => sendStoryCard(ctx));
  bot.hears("🏷️ Категорії", (ctx) => sendCategories(ctx));
  bot.hears("🎨 Стікери", (ctx) => sendStickers(ctx));
  bot.hears("❤️ Підтримати", (ctx) => sendDonate(ctx));
  bot.hears("ℹ️ Довідка", (ctx) => sendHelp(ctx));

  bot.command("news", async (ctx) => {
    if (ctx.from?.id !== ADMIN_USER_ID) return ctx.reply("⛔ Команда лише для адміністратора.");
    const n = await draftNews(bot.api, env, byId, host);
    await ctx.reply(n ? `📨 Надіслано чернеток: ${n}.` : "Немає свіжих новин.");
  });

  bot.command("search", async (ctx) => {
    const q = ctx.match?.trim();
    if (!q) {
      return ctx.reply("💡 Будь ласка, вкажіть слово для пошуку, наприклад:\n<code>/search гроші</code>", { parse_mode: "HTML" });
    }

    const { results, total } = searchProverbs(corpus, { q, limit: 5 });
    if (results.length === 0) {
      return ctx.reply(`❌ За запитом «${escapeHtml(q)}» нічого не знайдено.`);
    }

    let response = `🔍 <b>Результати пошуку для «${escapeHtml(q)}» (знайдено ${total}):</b>\n\n`;
    for (let i = 0; i < results.length; i++) {
      const p = results[i];
      const pt = prettify(p.text);
      response += `${i + 1}. <b>${escapeHtml(pt)}</b>\n<i>Джерело: ${p.sources.map(srcLabel).join(", ")}</i> — <a href="https://${host}/p/${p.id}">Читати</a>\n\n`;
    }

    if (total > 5) {
      response += `<i>Показано перші 5 результатів. Більше на <a href="https://${host}/?q=${encodeURIComponent(q)}">вебсайті</a>.</i>`;
    }

    await ctx.reply(response, { parse_mode: "HTML", link_preview_options: { is_disabled: true } });
  });

  bot.command("semantic", async (ctx) => {
    const q = ctx.match?.trim();
    if (!q) {
      return ctx.reply("💡 Будь ласка, вкажіть фразу чи опис для семантичного пошуку, наприклад:\n<code>/semantic бідні люди</code>", { parse_mode: "HTML" });
    }

    if (!env.AI || !env.VECTORIZE) {
      return ctx.reply("❌ Семантичний пошук тимчасово недоступний (відсутнє підключення до AI/Vectorize).");
    }

    const loadingMsg = await ctx.reply("🧠 <i>Аналізую зміст запиту...</i>", { parse_mode: "HTML" });

    try {
      const { data } = await env.AI.run("@cf/baai/bge-m3", { text: [q] });
      const { matches } = await env.VECTORIZE.query(data[0], { topK: 5 });
      const { results } = mapMatches(matches, byId, { minScore: 0.35, limit: 5 });

      if (results.length === 0) {
        await bot.api.editMessageText(ctx.chat.id, loadingMsg.message_id, `❌ За запитом «${escapeHtml(q)}» не знайдено схожих за змістом прислів'їв.`);
        return;
      }

      let response = `🧠 <b>Семантичний пошук для «${escapeHtml(q)}»:</b>\n\n`;
      for (let i = 0; i < results.length; i++) {
        const p = results[i];
        const pt = prettify(p.text);
        const pct = Math.round(p.score * 100);
        response += `${i + 1}. <b>${escapeHtml(pt)}</b> [схожість: ${pct}%]\n— <a href="https://${host}/p/${p.id}">Деталі</a>\n\n`;
      }

      await bot.api.editMessageText(ctx.chat.id, loadingMsg.message_id, response, {
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
      });
    } catch (err) {
      console.error("Telegram semantic search failed:", err);
      await bot.api.editMessageText(ctx.chat.id, loadingMsg.message_id, "❌ Помилка під час семантичного пошуку. Будь ласка, спробуйте пізніше або скористайтеся звичайним /search.");
    }
  });

  // Handle inline callbacks
  bot.callbackQuery("random_shuffle", async (ctx) => {
    const p = randomProverb(corpus, {});
    if (!p) return ctx.answerCallbackQuery("Помилка");

    const explanation = explanations[p.id] || null;
    const formatted = formatProverbHtml(p, explanation, meta.sources);
    const keyboard = buildCardInlineKeyboard(p.id, "telegram", host);

    await sendCardWithFallback(env, p.id,
      (url) => ctx.editMessageMedia({ type: "photo", media: url, caption: formatted, parse_mode: "HTML" }, { reply_markup: keyboard }),
      () => ctx.reply(formatted, { parse_mode: "HTML", reply_markup: keyboard }),
      "telegram");
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery("story_shuffle", async (ctx) => {
    const p = randomProverb(corpus, {});
    if (!p) return ctx.answerCallbackQuery("Помилка");

    const explanation = explanations[p.id] || null;
    const formatted = `📱 <b>Картка для Instagram Story (1080×1920)</b>\n\n${formatProverbHtml(p, explanation, meta.sources)}`;
    const keyboard = buildCardInlineKeyboard(p.id, "story", host);

    await sendCardWithFallback(env, p.id,
      (url) => ctx.editMessageMedia({ type: "photo", media: url, caption: formatted, parse_mode: "HTML" }, { reply_markup: keyboard }),
      () => ctx.reply(formatted, { parse_mode: "HTML", reply_markup: keyboard }),
      "story");
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery("square_shuffle", async (ctx) => {
    const p = randomProverb(corpus, {});
    if (!p) return ctx.answerCallbackQuery("Помилка");

    const explanation = explanations[p.id] || null;
    const formatted = `🖼️ <b>Картка для Instagram Post (1080×1080)</b>\n\n${formatProverbHtml(p, explanation, meta.sources)}`;
    const keyboard = buildCardInlineKeyboard(p.id, "square", host);

    await sendCardWithFallback(env, p.id,
      (url) => ctx.editMessageMedia({ type: "photo", media: url, caption: formatted, parse_mode: "HTML" }, { reply_markup: keyboard }),
      () => ctx.reply(formatted, { parse_mode: "HTML", reply_markup: keyboard }),
      "square");
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery(/^card_size:(story|square|telegram):(.+)$/, async (ctx) => {
    const [, size, pId] = ctx.match as [unknown, CardSize, string];
    const p = byId.get(pId);
    if (!p) return ctx.answerCallbackQuery("Прислів'я не знайдено");

    const explanation = explanations[p.id] || null;
    const baseFormatted = formatProverbHtml(p, explanation, meta.sources);
    const caption = size === "story"
      ? `📱 <b>Картка для Instagram Story (1080×1920)</b>\n\n${baseFormatted}`
      : size === "square"
      ? `🖼️ <b>Картка для Instagram Post (1080×1080)</b>\n\n${baseFormatted}`
      : baseFormatted;
    const keyboard = buildCardInlineKeyboard(p.id, size, host);

    if (ctx.callbackQuery.message && "photo" in ctx.callbackQuery.message) {
      await sendCardWithFallback(env, p.id,
        (url) => ctx.editMessageMedia({ type: "photo", media: url, caption, parse_mode: "HTML" }, { reply_markup: keyboard }),
        () => ctx.reply(caption, { parse_mode: "HTML", reply_markup: keyboard }),
        size);
    } else {
      await sendCardWithFallback(env, p.id,
        (url) => ctx.replyWithPhoto(url, { caption, parse_mode: "HTML", reply_markup: keyboard }),
        () => ctx.reply(caption, { parse_mode: "HTML", reply_markup: keyboard }),
        size);
    }
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery("cats_list", async (ctx) => {
    const keyboard = buildCategoriesKeyboard(taxonomy);
    await ctx.editMessageText("🏷️ <b>Оберіть тему для пошуку прислів'їв:</b>", {
      parse_mode: "HTML",
      reply_markup: keyboard,
    });
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery(/^cat:(.+)$/, async (ctx) => {
    const categoryKey = ctx.match[1];
    const categoryName = taxonomy[categoryKey] || categoryKey;

    const p = randomProverb(corpus, { category: categoryKey });
    if (!p) {
      return ctx.answerCallbackQuery("Не знайдено прислів'їв у цій темі");
    }

    const explanation = explanations[p.id] || null;
    const formatted = formatProverbHtml(p, explanation, meta.sources);
    const caption = `📂 <b>Тема: ${escapeHtml(categoryName)}</b>\n\n${formatted}`;

    const keyboard = new InlineKeyboard()
      .text("🎲 Ще з цієї теми", `cat:${categoryKey}`)
      .text("🏷️ Всі теми", "cats_list")
      .url("🔗 На сайті", `https://${host}/p/${p.id}`)
      .row()
      .url("📣 @VerbaCorpus", CHANNEL_URL);

    // If callback came from a text message (like /categories list) we need to reply with a photo message
    // If it came from a photo message, we edit media
    const text = () => ctx.reply(caption, { parse_mode: "HTML", reply_markup: keyboard });
    if (ctx.callbackQuery.message && "photo" in ctx.callbackQuery.message) {
      await sendCardWithFallback(env, p.id,
        (url) => ctx.editMessageMedia({ type: "photo", media: url, caption, parse_mode: "HTML" }, { reply_markup: keyboard }),
        text);
    } else {
      // Delete selection message and reply with photo
      if (ctx.callbackQuery.message) {
        try {
          await ctx.deleteMessage();
        } catch {}
      }
      await sendCardWithFallback(env, p.id,
        (url) => ctx.replyWithPhoto(url, { caption, parse_mode: "HTML", reply_markup: keyboard }),
        text);
    }
    await ctx.answerCallbackQuery();
  });

  // Admin approval: post or skip a news-matched proverb to the channel.
  bot.callbackQuery(/^news:(.+):(\d+|skip)$/, async (ctx) => {
    if (ctx.from?.id !== ADMIN_USER_ID) return ctx.answerCallbackQuery("⛔");
    const newsKv = env.NEWS_KV;
    if (!newsKv) return ctx.answerCallbackQuery("Новинні чернетки недоступні");
    const [, draftId, action] = ctx.match as RegExpMatchArray;
    const d = await getDraft(newsKv, draftId);
    if (!d) { await ctx.answerCallbackQuery("Чернетка застаріла"); return; }
    if (action === "skip") {
      await delDraft(newsKv, draftId);
      await ctx.editMessageText("⏭ Пропущено.", { reply_markup: undefined });
      return ctx.answerCallbackQuery();
    }
    const p = byId.get(d.proverbIds[Number(action)]);
    if (!p) { await ctx.answerCallbackQuery("Прислів'я не знайдено"); return; }
    const modern = p.modern_text && p.modern_text.trim() !== p.text.trim() ? prettify(p.modern_text) : "";
    try {
      const caption = newsCaption(d, prettify(p.text), modern);
      await sendCardWithFallback(env, p.id,
        (url) => bot.api.sendPhoto(env.TELEGRAM_CHANNEL_ID, url, { caption, parse_mode: "HTML" }),
        () => bot.api.sendMessage(env.TELEGRAM_CHANNEL_ID, caption, { parse_mode: "HTML" }));
      await delDraft(newsKv, draftId);

      let igNotice = "";
      if (env.INSTAGRAM_ACCOUNT_ID && env.INSTAGRAM_ACCESS_TOKEN) {
        try {
          const ig = await crosspostProverbToInstagram(env, p, {
            newsSource: { title: d.newsTitle, source: d.source },
          });
          if (ig.id) {
            igNotice = " та Instagram";
          } else if (ig.error) {
            igNotice = ` (Instagram: ${ig.error})`;
          }
        } catch (e: any) {
          igNotice = ` (Instagram: ${e?.message || e})`;
        }
      }

      await ctx.editMessageText(`✅ Опубліковано: ${escapeHtml(prettify(p.text)).slice(0, 80)}${igNotice}`, { reply_markup: undefined });
    } catch (e) {
      console.error("news post failed", e);
      await ctx.answerCallbackQuery("Помилка публікації, спробуйте ще раз");
      return; // keep the draft for a retry
    }
    await ctx.answerCallbackQuery();
  });

  // Inline query handler (when typed `@bot_name query` anywhere)
  bot.on("inline_query", async (ctx) => {
    const q = ctx.inlineQuery.query.trim();
    let matches: Proverb[] = [];

    if (!q) {
      // Return 8 random proverbs if query is empty
      for (let i = 0; i < 15 && matches.length < 8; i++) {
        const p = randomProverb(corpus, {});
        if (p && !matches.some((m) => m.id === p.id)) {
          matches.push(p);
        }
      }
    } else {
      // Find up to 10 lexical matches
      matches = filterProverbs(corpus, { q }).slice(0, 10);
    }

    const results = matches.map((p) => {
      const explanation = explanations[p.id] || null;
      const formatted = formatProverbHtml(p, explanation, meta.sources);
      const pt = prettify(p.text);

      return {
        type: "article" as const,
        id: p.id,
        title: pt,
        description: p.modern_text && p.modern_text !== p.text ? `(${prettify(p.modern_text)})` : p.category.map((c) => taxonomy[c] || c).join(", "),
        thumb_url: cardPhotoUrl(env, p.id),
        input_message_content: {
          message_text: formatted,
          parse_mode: "HTML" as const,
          link_preview_options: { is_disabled: false },
        },
        reply_markup: new InlineKeyboard()
          .url("🔗 Читати на сайті", `https://${host}/p/${p.id}`)
          .switchInline("🔍 Шукати ще", "")
          .row()
          .url("🎲 Випадкове", `${BOT_URL}?start=random`)   // deep link works for any recipient
          .url("📣 @VerbaCorpus", CHANNEL_URL),
      };
    });

    await ctx.answerInlineQuery(results, {
      cache_time: 10, // short cache so keyboard/caption changes show up on re-share
      is_personal: false,
    });
  });

  return bot;
}
