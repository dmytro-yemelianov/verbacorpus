// Create / refresh the verba Telegram sticker pack.
//
// Static stickers (512×512 PNG) are rendered by the live worker at
// /card/<id>.png?format=sticker and passed to Telegram as HTTP URLs, so no
// file upload is needed — createNewStickerSet fetches them directly.
//
// Usage:
//   node scripts/build-stickers.mjs            # create the set (errors if it exists)
//   node scripts/build-stickers.mjs --dry-run  # print the curated selection only
//
// Requires TELEGRAM_BOT_TOKEN (read from env or app/.dev.vars).

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const APP = join(__dir, "..");

const OWNER_USER_ID = 198155742;            // @dyemelianov
const BOT_USERNAME = "verbacorpus_bot";
const SET_NAME = `verba_by_${BOT_USERNAME}`;
const SET_TITLE = "verba — українські прислів'я";
const HOST = "verbacorpus.org";
const MAX_STICKERS = 40;                     // createNewStickerSet allows 1–50

// One emoji per taxonomy category (+ 🇺🇦 on every sticker).
const CATEGORY_EMOJI = {
  work_labor: "🛠", poverty_wealth: "💰", food_hunger: "🍞", drink_alcohol: "🍺",
  family_kinship: "👪", marriage_gender: "💍", speech_lying: "🗣", wisdom_folly: "🦉",
  fate_luck: "🍀", time_seasons: "⏳", death_illness: "🕯", religion_god: "🙏",
  social_relations: "🤝", class_power: "👑", justice_truth: "⚖", animals: "🐾",
  body_health: "💪", home_household: "🏡", conflict_enmity: "⚔", friendship_love: "❤",
  travel_distance: "🧭", trade_money: "🪙", ethnic_local: "🇺🇦", emotion_mood: "🙂",
  nature_weather: "🌦", appearance_reputation: "🪞", idiom_expressive: "💬",
};

function readToken() {
  if (process.env.TELEGRAM_BOT_TOKEN) return process.env.TELEGRAM_BOT_TOKEN;
  try {
    const dv = readFileSync(join(APP, ".dev.vars"), "utf8");
    const m = dv.match(/^TELEGRAM_BOT_TOKEN=(.+)$/m);
    if (m) return m[1].trim();
  } catch {}
  throw new Error("TELEGRAM_BOT_TOKEN not found (env or app/.dev.vars)");
}

// Words/roots that must never appear in a public pack: ethnic slurs and crude
// curses common in the historical Franko приповідки (the corpus preserves them
// verbatim; the sticker pack must not surface them).
const BLOCKLIST = /(жид|кацап|москал|лях\b|хохол|циган|курв|бляд|сук[ау]\b|чорт|дідьк|біс\b|гнив|здох|сказ|холер)/i;

// Curate: well-formed, wholesome proverbs from the curated Bobkova 1961 collection,
// of real saying length, one (then two) per category for a diverse pack.
function curate() {
  const proverbs = JSON.parse(readFileSync(join(APP, "public/data/proverbs.json"), "utf8"));
  const qualifies = (p) => {
    const t = (p.text || "").trim();
    const words = t.split(/\s+/).length;
    return (p.sources || []).includes("Bobkova") &&
      /^[А-ЯІЇЄҐ]/.test(t) && t.length >= 24 && t.length <= 60 &&
      words >= 4 && words <= 9 && /[.!?…]$/.test(t) && !BLOCKLIST.test(t);
  };
  const byCat = new Map();
  for (const p of proverbs) {
    if (!qualifies(p)) continue;
    const cat = (p.category && p.category[0]) || "idiom_expressive";
    (byCat.get(cat) || byCat.set(cat, []).get(cat)).push(p);
  }
  // shortest first; prefer standard spelling (text === modern_text or no modern)
  const score = (p) => (p.modern_text && p.modern_text.trim() !== p.text.trim() ? 1000 : 0) + p.text.length;
  const picks = [];
  for (const [, list] of byCat) {
    list.sort((a, b) => score(a) - score(b));
    if (list[0]) picks.push(list[0]);            // one per category first
  }
  // top up with second-best per category until MAX
  for (const [, list] of byCat) {
    if (picks.length >= MAX_STICKERS) break;
    if (list[1]) picks.push(list[1]);
  }
  return picks.slice(0, MAX_STICKERS);
}

function toSticker(p) {
  const cat = (p.category && p.category[0]) || "idiom_expressive";
  const emoji = CATEGORY_EMOJI[cat] || "📜";
  const emoji_list = emoji === "🇺🇦" ? ["🇺🇦"] : [emoji, "🇺🇦"];
  return {
    sticker: `https://${HOST}/card/${p.id}.png?format=sticker`,
    format: "static",
    emoji_list,
    keywords: [cat.replace(/_/g, " ")],
  };
}

async function tg(token, method, body) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(`${method} failed: ${json.error_code} ${json.description}`);
  return json.result;
}

const dryRun = process.argv.includes("--dry-run");
const picks = curate();
console.log(`Curated ${picks.length} stickers for ${SET_NAME}:`);
for (const p of picks) console.log(`  ${toSticker(p).emoji_list.join("")}  ${p.id}  ${p.text}`);

if (dryRun) {
  console.log("\n(dry run — nothing created)");
  process.exit(0);
}

const token = readToken();
const stickers = picks.map(toSticker);
console.log(`\nCreating sticker set ${SET_NAME} (owner ${OWNER_USER_ID})…`);
await tg(token, "createNewStickerSet", {
  user_id: OWNER_USER_ID,
  name: SET_NAME,
  title: SET_TITLE,
  stickers,
});
console.log(`✅ Done → https://t.me/addstickers/${SET_NAME}`);
