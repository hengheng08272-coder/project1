/**
 * Real logos (YouTube, ABA, KHQR, ...) as Telegram custom emoji.
 *
 * Telegram shows custom emoji in a bot's own messages and on its buttons
 * when the bot's owner has Telegram Premium. The pack itself is made by the
 * bot from assets/emoji/*.png (100x100) with the operator's /makeemoji, and
 * the resulting emoji ids are kept in bot-config (see botConfig.js).
 *
 * Text anywhere in the bot can carry tokens like {:yt:}. notifyBot.call()
 * runs every payload through `decorate()`: a token becomes the pack's emoji
 * when there is one, or the plain fallback emoji otherwise. Buttons can say
 * `emoji: "aba"` and get the matching icon_custom_emoji_id the same way.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { paymentSettings, savePaymentSettings } from "./botConfig.js";
import { config } from "./config.js";

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "assets", "emoji");

// token -> [file in assets/emoji, fallback emoji]. The fallback is also the
// emoji the custom one is registered under, so search and previews match.
export const EMOJI = {
  yt: ["youtube", "▶️"],
  fb: ["facebook", "📘"],
  ig: ["instagram", "📸"],
  tt: ["tiktok", "🎵"],
  x: ["twitter", "✖️"],
  aba: ["aba", "🏦"],
  wing: ["wing", "🏦"],
  truemoney: ["truemoney", "💰"],
  bakong: ["bakong", "🏦"],
  bankc: ["bank_c", "🏦"],
  khqr: ["khqr", "💳"],
  // brand
  logo: ["logo", "⬇️"],
  brand: ["brand", "💎"],
  admin: ["admin", "🛡"],
  // main menu
  m_free: ["m_free", "🆓"],
  m_pro: ["m_pro", "👑"],
  m_account: ["m_account", "👤"],
  m_buy: ["m_buy", "💎"],
  m_history: ["m_history", "📜"],
  m_referral: ["m_referral", "👥"],
  m_language: ["m_language", "🌐"],
  m_help: ["m_help", "❓"],
  m_desktop: ["m_desktop", "🖥"],
  // KH Invoice section
  inv_app: ["inv_app", "📱"],
  inv_create: ["inv_create", "🧾"],
  inv_in: ["inv_in", "⬆️"],
  inv_out: ["inv_out", "⬇️"],
  inv_report: ["inv_report", "📊"],
  inv_stock: ["inv_stock", "📦"],
  inv_unpaid: ["inv_unpaid", "⏳"],
  inv_refresh: ["inv_refresh", "🔄"],
  inv_pro: ["inv_pro", "👑"],
  inv_summary: ["inv_summary", "📋"],
  inv_shop: ["inv_shop", "🏪"],
  inv_back: ["inv_back", "⬅️"],
};

const TOKEN = /\{:([a-z_]+):\}/g;

// Once Telegram refuses them (owner without Premium, or ids of a pack that
// was deleted), stop trying for a while instead of paying a failed request on
// every message. A rebuilt pack clears it at once.
const RETRY_MS = 10 * 60_000;
let refusedAt = 0;

async function emojiIds() {
  if (refusedAt && Date.now() - refusedAt < RETRY_MS) return {};
  return (await paymentSettings()).emoji ?? {};
}

/** Replaces tokens in `text`; returns the text and the custom_emoji entities. */
function resolve(text, ids, existing = []) {
  if (typeof text !== "string" || !text.includes("{:")) return { text, entities: existing };
  const entities = [];
  let out = "";
  let last = 0;
  for (const m of text.matchAll(TOKEN)) {
    const entry = EMOJI[m[1]];
    if (!entry) continue;
    out += text.slice(last, m.index);
    const fallback = entry[1];
    const id = ids[m[1]];
    // Offsets are UTF-16 code units -- exactly what JS string lengths count.
    if (id) entities.push({ type: "custom_emoji", offset: out.length, length: fallback.length, custom_emoji_id: id });
    out += fallback;
    last = m.index + m[0].length;
  }
  out += text.slice(last);
  return { text: out, entities: [...existing, ...entities] };
}

function decorateButtons(markup, ids) {
  const rows = markup?.inline_keyboard ?? markup?.keyboard;
  if (!Array.isArray(rows)) return markup;
  const mapped = rows.map((row) =>
    row.map((button) => {
      if (!button || typeof button !== "object") return button;
      const { emoji, ...rest } = button;
      if (typeof rest.text === "string") rest.text = resolve(rest.text, {}).text;
      if (emoji && ids[emoji]) {
        rest.icon_custom_emoji_id = ids[emoji];
        // The logo takes the place of the label's own leading emoji.
        if (typeof rest.text === "string") {
          const bare = rest.text.replace(/^\p{Extended_Pictographic}\uFE0F?\s*/u, "");
          if (bare) rest.text = bare; // an emoji-only label keeps its emoji
        }
      }
      return rest;
    })
  );
  return markup.inline_keyboard ? { ...markup, inline_keyboard: mapped } : { ...markup, keyboard: mapped };
}

/** The payload with tokens and button emoji resolved (plain ones when `plain`). */
export async function decorate(body, { plain = false } = {}) {
  if (!body || typeof body !== "object") return body;
  const ids = plain ? {} : await emojiIds();
  const next = { ...body };
  if (typeof next.text === "string") {
    const r = resolve(next.text, ids, next.entities ?? []);
    next.text = r.text;
    if (r.entities.length) next.entities = r.entities;
  }
  if (typeof next.caption === "string") {
    const r = resolve(next.caption, ids, next.caption_entities ?? []);
    next.caption = r.text;
    if (r.entities.length) next.caption_entities = r.entities;
  }
  if (next.reply_markup) next.reply_markup = decorateButtons(next.reply_markup, ids);
  return next;
}

/** True when a failed call looks like Telegram refusing the custom emoji. */
export function refusedEmoji(data) {
  const reason = String(data?.description ?? "");
  const hit = /custom emoji|custom_emoji|icon_custom_emoji|ENTITY|DOCUMENT_INVALID|STICKER/i.test(reason);
  if (hit) {
    refusedAt = Date.now();
    console.error("Telegram refused custom emoji -- falling back to plain emoji:", reason);
  }
  return hit;
}

// ------------------------------------------------------------ the pack

async function botApiForm(method, form) {
  const res = await fetch(`https://api.telegram.org/bot${config.telegramLoginBotToken}/${method}`, { method: "POST", body: form });
  return res.json().catch(() => ({}));
}

async function botApi(method, body) {
  const res = await fetch(`https://api.telegram.org/bot${config.telegramLoginBotToken}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json().catch(() => ({}));
}

/** The multipart request that creates `name` from the icons (stills only when `still`). */
async function packForm(ownerId, name, tokens, still) {
  const form = new FormData();
  form.set("user_id", String(ownerId));
  form.set("name", name);
  form.set("title", "SaveIt KH Icons");
  form.set("sticker_type", "custom_emoji");
  const stickers = [];
  for (const [i, token] of tokens.entries()) {
    const [file, fallback] = EMOJI[token];
    // A moving version (.webm, VP9) wins over the still one when there is one.
    const video = still ? null : await fs.readFile(path.join(DIR, `${file}.webm`)).catch(() => null);
    const bytes = video ?? (await fs.readFile(path.join(DIR, `${file}.png`)));
    const ext = video ? "webm" : "png";
    form.set(`s${i}`, new Blob([bytes], { type: video ? "video/webm" : "image/png" }), `${file}.${ext}`);
    stickers.push({ sticker: `attach://s${i}`, format: video ? "video" : "static", emoji_list: [fallback], keywords: [token, file] });
  }
  form.set("stickers", JSON.stringify(stickers));
  return form;
}

/**
 * Builds (or rebuilds) the bot's custom emoji pack, owned by `ownerId` --
 * the operator, who must have started the bot. Returns a report line.
 *
 * Each build is a new set; the ids in use are only replaced (and the old set
 * deleted) once the new one exists, so a failed build never leaves the bot
 * pointing at emoji that are gone.
 */
export async function buildPack(ownerId) {
  const me = await botApi("getMe", {});
  const username = me?.result?.username;
  if (!username) return "❌ Could not read the bot's username.";
  const tokens = Object.keys(EMOJI);
  const name = `saveit_v${Date.now().toString(36)}_by_${username}`;

  let created = await botApiForm("createNewStickerSet", await packForm(ownerId, name, tokens, false));
  let note = "";
  if (!created.ok) {
    // The moving ones are the likelier to be refused; the stills always fit.
    const why = created.description ?? "unknown error";
    created = await botApiForm("createNewStickerSet", await packForm(ownerId, name, tokens, true));
    if (!created.ok) return `❌ Telegram refused the pack: ${created.description ?? why}`;
    note = `\n(Moving icons were refused -- "${why}" -- so this pack is still images.)`;
  }

  const set = await botApi("getStickerSet", { name });
  const list = set?.result?.stickers ?? [];
  const ids = {};
  tokens.forEach((token, i) => {
    if (list[i]?.custom_emoji_id) ids[token] = list[i].custom_emoji_id;
  });
  const previous = (await paymentSettings()).emoji_set;
  try {
    await savePaymentSettings({ emoji: ids, emoji_set: name });
  } catch (err) {
    return `❌ The pack was made (https://t.me/addemoji/${name}) but could not be saved: ${err?.message ?? err}`;
  }
  refusedAt = 0;
  for (const old of [previous, `saveit_icons_by_${username}`]) {
    if (old && old !== name) await botApi("deleteStickerSet", { name: old }).catch(() => null);
  }
  return (
    `✅ Custom emoji pack ready: ${Object.keys(ids).length}/${tokens.length} icons.${note}\n` +
    `https://t.me/addemoji/${name}\n\n` +
    `Test: {:logo:} {:brand:} {:admin:} · {:m_free:} {:m_pro:} {:m_buy:} {:m_account:} {:m_help:} · {:inv_in:} {:inv_out:} {:inv_create:}\n` +
    `{:yt:} {:fb:} {:ig:} {:tt:} {:x:} · {:aba:} {:wing:} {:truemoney:} {:bakong:} {:khqr:}\n\n` +
    `If these show as normal emoji, the bot's owner account (the one that created it in @BotFather) needs Telegram Premium.`
  );
}
