import { Bot, InlineKeyboard } from "grammy";
import { type Proverb, randomProverb, searchProverbs, filterProverbs } from "./shared/corpus";
import { mapMatches } from "./shared/semantic";
import { srcLabel } from "./shared/sources";
import { prettify } from "./shared/text";
import { gatherNews, pickUnseen, matchProverbs, putDraft, markSeen, newsId, NEWS_BATCH } from "./news";

// Public Telegram channel for the corpus — surfaced as a tappable button on card replies.
const CHANNEL_URL = "https://t.me/VerbaCorpus";
// Static sticker pack (built by scripts/build-stickers.mjs).
const STICKER_PACK_URL = "https://t.me/addstickers/verba_by_verbacorpus_bot";
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
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
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
  // Bibliography-style source, collapsed (tap to expand) so the caption stays compact.
  html += `\n📖 <b>Джерело:</b> <tg-spoiler>${srcs}</tg-spoiler>`;
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
    const ids = await matchProverbs(env.AI, env.VECTORIZE, it.title, byId).catch(() => [] as string[]);
    if (!ids.length) { await markSeen(env.NEWS_KV, it.id); continue; }
    const draftId = newsId(it.link);
    await markSeen(env.NEWS_KV, it.id);
    await putDraft(env.NEWS_KV, draftId, { newsTitle: it.title, link: it.link, source: it.source, proverbIds: ids });
    const list = ids.map((id, i) => `${i + 1}. ${escapeHtml((byId.get(id)?.text || "").slice(0, 90))}`).join("\n");
    const kb = new InlineKeyboard();
    ids.forEach((_, i) => kb.text(String(i + 1), `news:${draftId}:${i}`));
    kb.row().text("⏭ Пропустити", `news:${draftId}:skip`);
    await api.sendMessage(ADMIN_USER_ID,
      `📰 <b>${escapeHtml(it.title)}</b>\n${escapeHtml(it.source)} · <a href="${it.link}">читати</a>\n\nПрислів'я-коментар — оберіть:\n${list}`,
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
    }
  });
  const taxonomy = meta.taxonomy || {};
  const byId = new Map(corpus.map((p) => [p.id, p]));
  // Animated рушник card (GIF) shared via sendAnimation — same telegram-format design as the PNG.
  const cardAnim = (id: string) => `https://${host}/card/${id}.gif?format=telegram&lang=uk&v=5`;

  bot.command("start", async (ctx) => {
    const welcome =
      `🇺🇦 <b>Вітаємо у verba bot!</b>\n\n` +
      `Це офіційний бот корпусу українських прислів'їв та приказок (<a href="https://verbacorpus.org">verbacorpus.org</a>).\n\n` +
      `Користуйтеся командами для пошуку народної мудрості:\n` +
      `🎲 /random — випадкове прислів'я\n` +
      `🏷️ /categories — переглянути за темами\n` +
      `🔍 /search &lt;запит&gt; — швидкий текстовий пошук\n` +
      `🧠 /semantic &lt;запит&gt; — семантичний пошук за змістом (AI)\n` +
      `🎨 /stickers — набір стікерів verba\n\n` +
      `💡 <i>Ви також можете використовувати мене в будь-якому чаті! Просто введіть <code>@${ctx.me.username} &lt;запит&gt;</code>, щоб поділитися карткою з прислів'ям.</i>`;
    await ctx.reply(welcome, { parse_mode: "HTML", link_preview_options: { is_disabled: true } });
  });

  bot.command("help", async (ctx) => {
    const helpText =
      `📖 <b>Довідка бота verba</b>\n\n` +
      `• /random — випадкове прислів'я з усього корпусу.\n` +
      `• /categories — список з 27 тематичних категорій. Виберіть будь-яку, щоб отримати прислів'я на цю тему.\n` +
      `• /search <code>&lt;слово&gt;</code> — пошук за ключовим словом або фразою.\n` +
      `• /semantic <code>&lt;фраза&gt;</code> — штучний інтелект знайде прислів'я, схожі за змістом (навіть якщо слова відрізняються).\n\n` +
      `• /stickers — набір стікерів з прислів'ями для будь-яких чатів.\n\n` +
      `Бот містить 48,787 унікальних народних висловів.`;
    await ctx.reply(helpText, { parse_mode: "HTML" });
  });

  bot.command("stickers", async (ctx) => {
    await ctx.reply("🎨 <b>Стікери verba</b>\n\nНабір стікерів з українськими прислів'ями — додайте й діліться ними в будь-якому чаті:", {
      parse_mode: "HTML",
      reply_markup: new InlineKeyboard().url("➕ Додати стікерпак", STICKER_PACK_URL),
    });
  });

  bot.command("news", async (ctx) => {
    if (ctx.from?.id !== ADMIN_USER_ID) return ctx.reply("⛔ Команда лише для адміністратора.");
    const n = await draftNews(bot.api, env, byId, host);
    await ctx.reply(n ? `📨 Надіслано чернеток: ${n}.` : "Немає свіжих новин.");
  });

  bot.command("random", async (ctx) => {
    const p = randomProverb(corpus, {});
    if (!p) {
      return ctx.reply("❌ Не вдалося знайти прислів'я.");
    }
    const explanation = explanations[p.id] || null;
    const formatted = formatProverbHtml(p, explanation, meta.sources);
    const animUrl = cardAnim(p.id);

    const keyboard = new InlineKeyboard()
      .text("🎲 Ще одне", "random_shuffle")
      .url("🔗 На сайті", `https://${host}/p/${p.id}`)
      .row()
      .url("📣 @VerbaCorpus", CHANNEL_URL);

    await ctx.replyWithAnimation(animUrl, {
      caption: formatted,
      parse_mode: "HTML",
      reply_markup: keyboard,
    });
  });

  bot.command("categories", async (ctx) => {
    const keyboard = buildCategoriesKeyboard(taxonomy);
    await ctx.reply("🏷️ <b>Оберіть тему для пошуку прислів'їв:</b>", {
      parse_mode: "HTML",
      reply_markup: keyboard,
    });
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
    const animUrl = cardAnim(p.id);

    const keyboard = new InlineKeyboard()
      .text("🎲 Ще одне", "random_shuffle")
      .url("🔗 На сайті", `https://${host}/p/${p.id}`)
      .row()
      .url("📣 @VerbaCorpus", CHANNEL_URL);

    await ctx.editMessageMedia(
      {
        type: "animation",
        media: animUrl,
        caption: formatted,
        parse_mode: "HTML",
      },
      { reply_markup: keyboard }
    );
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
    const animUrl = cardAnim(p.id);

    const keyboard = new InlineKeyboard()
      .text("🎲 Ще з цієї теми", `cat:${categoryKey}`)
      .text("🏷️ Всі теми", "cats_list")
      .url("🔗 На сайті", `https://${host}/p/${p.id}`)
      .row()
      .url("📣 @VerbaCorpus", CHANNEL_URL);

    // Edit in place when the message already carries a media card (animation/photo);
    // otherwise (e.g. the /categories text list) delete it and send a fresh animation.
    const msg = ctx.callbackQuery.message;
    if (msg && ("animation" in msg || "photo" in msg)) {
      await ctx.editMessageMedia(
        {
          type: "animation",
          media: animUrl,
          caption: `📂 <b>Тема: ${escapeHtml(categoryName)}</b>\n\n${formatted}`,
          parse_mode: "HTML",
        },
        { reply_markup: keyboard }
      );
    } else {
      if (msg) {
        try {
          await ctx.deleteMessage();
        } catch {}
      }
      await ctx.replyWithAnimation(animUrl, {
        caption: `📂 <b>Тема: ${escapeHtml(categoryName)}</b>\n\n${formatted}`,
        parse_mode: "HTML",
        reply_markup: keyboard,
      });
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
        thumb_url: `https://${host}/card/${p.id}.png?format=telegram&lang=uk&v=5`,
        input_message_content: {
          message_text: formatted,
          parse_mode: "HTML" as const,
          link_preview_options: { is_disabled: false },
        },
        reply_markup: new InlineKeyboard()
          .url("🔗 Читати на сайті", `https://${host}/p/${p.id}`)
          .switchInline("🔍 Шукати ще", "")
          .row()
          .url("📣 @VerbaCorpus", CHANNEL_URL),
      };
    });

    await ctx.answerInlineQuery(results, {
      cache_time: 300, // 5 minutes cache
      is_personal: false,
    });
  });

  return bot;
}
