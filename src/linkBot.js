/**
 * The Telegram bot people actually talk to: a menu, a quota, referrals, and
 * one job -- send it a link, get the video back.
 *
 * Two kinds of link are handled, and the difference matters:
 *   - a Telegram post link (t.me/...) is fetched through the shared userbot
 *     (telegram.js), since only a real account can read a group's media;
 *   - anything else (YouTube, Facebook, TikTok, a direct .mp4/.m3u8, ...) is
 *     queued into the same url_list_items pipeline the web app uses, and
 *     botJobs.notifyFinishedJobs() sends the result back when it lands.
 *
 * Reuses the same bot token as the Login Widget / payment notifications
 * (config.telegramLoginBotToken) so there is only one bot to set up.
 */
import fs from "node:fs/promises";
import path from "node:path";

import { config } from "./config.js";
import { actionForLabel, languageKeyboard, mainKeyboard, texts } from "./botText.js";
import * as botDeliver from "./botDeliver.js";
import * as botJobs from "./botJobs.js";
import * as botPay from "./botPay.js";
import { db, nowIso, rows } from "./db.js";
import { withFloodRetry } from "./floodRetry.js";
import { call } from "./notifyBot.js";
import * as r2 from "./r2.js";
import { mediaInfo } from "./scanner.js";
import { getClientForChat, parseTelegramLink } from "./telegram.js";

// Telegram's own Bot API cap for a bot sending a file -- not configurable,
// and well below what the userbot itself can fetch, so this only limits the
// reply, not the download.
const BOT_UPLOAD_LIMIT_BYTES = 50 * 1024 * 1024;
const URL_PATTERN = /https?:\/\/\S+/i;

async function send(chatId, text, extra = {}) {
  return call("sendMessage", { chat_id: chatId, text, ...extra });
}

/** Uploads a local file to the chat via multipart/form-data -- sendMessage's JSON body can't carry bytes. */
async function sendFile(chatId, method, filePath) {
  if (!config.telegramLoginBotToken) return null;
  const buffer = await fs.readFile(filePath);
  const field = method === "sendVideo" ? "video" : method === "sendAudio" ? "audio" : "document";
  const form = new FormData();
  form.set("chat_id", String(chatId));
  form.set(field, new Blob([buffer]), path.basename(filePath));
  const res = await fetch(`https://api.telegram.org/bot${config.telegramLoginBotToken}/${method}`, {
    method: "POST",
    body: form,
  });
  const data = await res.json().catch(() => ({}));
  if (!data.ok) console.error(`Telegram ${method} failed:`, JSON.stringify(data));
  return data;
}

// --------------------------------------------------------------- bot users

/**
 * Finds or creates this person's row, and settles the referral on the very
 * first /start: referred_by is written once and never rewritten, so nobody
 * can re-enter through a second link to hand out another bonus.
 */
async function ensureUser(from, startPayload) {
  const id = from.id;
  const existing = rows(
    await db().from("bot_users").select("*").eq("telegram_user_id", id).limit(1)
  )[0];

  if (existing) {
    await db()
      .from("bot_users")
      .update({
        username: from.username ?? null,
        first_name: from.first_name ?? null,
        last_seen_at: nowIso(),
        updated_at: nowIso(),
      })
      .eq("telegram_user_id", id);
    return existing;
  }

  const referrer = await resolveReferrer(startPayload, id);
  const created = rows(
    await db()
      .from("bot_users")
      .insert({
        telegram_user_id: id,
        username: from.username ?? null,
        first_name: from.first_name ?? null,
        language: from.language_code === "en" ? "en" : "km",
        referred_by: referrer,
      })
      .select("*")
  )[0];

  if (referrer) await rewardReferrer(referrer, from);
  return created;
}

/** The referrer id in a "ref_<id>" start payload, if it names a real, different user. */
async function resolveReferrer(startPayload, selfId) {
  const match = /^ref_(\d+)$/.exec(String(startPayload ?? "").trim());
  if (!match) return null;
  const referrer = Number(match[1]);
  if (!Number.isFinite(referrer) || referrer === selfId) return null;
  const found = rows(
    await db().from("bot_users").select("telegram_user_id").eq("telegram_user_id", referrer).limit(1)
  );
  return found[0] ? referrer : null;
}

async function rewardReferrer(referrerId, newUser) {
  const referrer = rows(
    await db().from("bot_users").select("*").eq("telegram_user_id", referrerId).limit(1)
  )[0];
  if (!referrer) return;

  await db()
    .from("bot_users")
    .update({
      bonus_downloads: referrer.bonus_downloads + config.botReferralBonus,
      updated_at: nowIso(),
    })
    .eq("telegram_user_id", referrerId);

  const t = texts(referrer.language);
  await send(referrerId, t.referralJoined(newUser.first_name || newUser.username || newUser.id));
}

// ------------------------------------------------------------------ quota

async function usageFor(telegramUserId) {
  const found = rows(
    await db().from("bot_link_downloads").select("*").eq("telegram_user_id", telegramUserId).limit(1)
  );
  return found[0] ?? null;
}

async function incrementUsage(telegramUserId, existing) {
  if (existing) {
    await db()
      .from("bot_link_downloads")
      .update({ free_used: existing.free_used + 1, updated_at: nowIso() })
      .eq("telegram_user_id", telegramUserId);
  } else {
    await db().from("bot_link_downloads").insert({ telegram_user_id: telegramUserId, free_used: 1 });
  }
}

/**
 * What this person may still download. Free allowance + referral bonus +
 * whatever they bought all pool into one number; a running VIP period
 * means no limit at all (left is Infinity, and nothing is counted down).
 */
async function quotaFor(user) {
  const usage = await usageFor(user.telegram_user_id);
  const used = usage?.free_used ?? 0;
  const total = config.botFreeDownloads + (user.bonus_downloads ?? 0) + (user.paid_downloads ?? 0);
  if (botPay.isPremium(user)) return { usage, total, used, left: Infinity, premium: true };
  return { usage, total, used, left: Math.max(total - used, 0), premium: false };
}

// ------------------------------------------------------------ menu screens

async function showAccount(chatId, user) {
  const t = texts(user.language);
  const quota = await quotaFor(user);
  // No parse_mode anywhere in the bot: a username like "Lyna_produ" is an
  // unclosed italic marker to Telegram's legacy Markdown, and it rejects the
  // whole message ("Can't find end of the entity") rather than the one word.
  // Nothing here needs formatting enough to risk a screen that never arrives.
  const lines = [
    `📋 ${t.accountTitle}`,
    "",
    `├ ${t.fieldId}: ${user.telegram_user_id}`,
    `├ ${t.fieldUsername}: ${user.username ? "@" + user.username : "—"}`,
    `├ ${t.fieldLanguage}: ${user.language === "en" ? "English" : "ភាសាខ្មែរ"}`,
    `├ ${t.fieldPlan}: ${quota.premium ? t.planVip(new Date(user.premium_until).toISOString().slice(0, 10)) : t.planFree}`,
    `├ ${t.fieldUsed}: ${quota.used}`,
    `└ ${t.fieldQuota}: ${quota.premium ? t.unlimited : `${quota.left} / ${quota.total}`}`,
  ];
  await send(chatId, lines.join("\n"));
}

async function showHistory(chatId, user) {
  const t = texts(user.language);
  const jobs = await botJobs.recentJobs(user.telegram_user_id, 10);
  if (jobs.length === 0) {
    await send(chatId, t.historyEmpty);
    return;
  }
  const icon = (status) =>
    status === "completed" ? "✅" : status === "failed" ? "❌" : status === "downloading" ? "⏳" : "🕐";
  const lines = jobs.map((job) => `${icon(job.item?.status)} ${job.source_url.slice(0, 60)}`);
  await send(chatId, `📜 ${t.historyTitle}\n\n${lines.join("\n")}`);
}

async function showReferral(chatId, user, botUsername) {
  const t = texts(user.language);
  const count = rows(
    await db().from("bot_users").select("telegram_user_id").eq("referred_by", user.telegram_user_id)
  ).length;
  const link = `https://t.me/${botUsername}?start=ref_${user.telegram_user_id}`;
  await send(chatId, `👥 ${t.referralTitle}\n\n${t.referralBody(count, config.botReferralBonus, link)}`);
}

/**
 * The bot's own @username, needed to build a referral link. Asked once and
 * kept for the life of the process -- it cannot change under us.
 */
let cachedBotUsername = null;
async function botUsername() {
  if (cachedBotUsername) return cachedBotUsername;
  const me = await call("getMe", {});
  cachedBotUsername = me?.result?.username ?? "";
  return cachedBotUsername;
}

// ----------------------------------------------------------------- updates

/** Handles one incoming Telegram `message` update. */
export async function handleMessage(message) {
  const chatId = message?.chat?.id;
  const from = message?.from;
  const text = String(message?.text ?? "").trim();
  if (!chatId || !from?.id) return;

  const startPayload = /^\/start(?:\s+(\S+))?$/.exec(text)?.[1] ?? null;
  const user = await ensureUser(from, startPayload);
  const t = texts(user.language);

  // A photo is a payment screenshot, or -- from the operator, captioned
  // /setqr -- the bank QR orders are built from. Checked before the text
  // handling below, since a photo usually has no text at all.
  if (message.photo && (await botPay.handlePhoto(message, user))) return;

  // A message forwarded out of the storage channel names it, so the operator
  // never has to dig a raw -100... id out of Telegram.
  if (message.forward_from_chat && botPay.isAdminChat(chatId)) {
    await send(chatId, await botDeliver.setStorageFromForward(message));
    return;
  }

  if (/^\/start\b/.test(text) || text === "/help" || !text) {
    const name = from.first_name || from.username || "";
    await send(chatId, t.welcome(name), { reply_markup: mainKeyboard(user.language) });
    return;
  }

  if (await handleAdminCommand(chatId, text)) return;
  if (await botPay.handleAdminPayCommand(chatId, text)) return;

  switch (actionForLabel(text) ?? commandAction(text)) {
    case "account":
      return showAccount(chatId, user);
    case "history":
      return showHistory(chatId, user);
    case "referral":
      return showReferral(chatId, user, await botUsername());
    case "language":
      return send(chatId, t.languagePrompt, { reply_markup: languageKeyboard() });
    case "help":
      return send(chatId, t.help);
    case "download":
      return send(chatId, t.sendLink);
    case "buy": {
      const quota = await quotaFor(user);
      return botPay.showPackages(chatId, user, quota.left);
    }
    case "app":
      return send(chatId, config.webAppUrl ? t.openApp(config.webAppUrl) : t.openAppMissing);
    default:
      break;
  }

  const url = URL_PATTERN.exec(text)?.[0];
  if (!url) {
    await send(chatId, t.notALink, { reply_markup: mainKeyboard(user.language) });
    return;
  }

  const quota = await quotaFor(user);
  if (quota.left <= 0) {
    await send(chatId, t.quotaOver(quota.total));
    return;
  }

  // "…link audio" (or ជាសំឡេង) asks for the soundtrack only -- the same
  // audio_only quality the web app's quick-download box offers.
  const audioOnly = /\b(audio|mp3|សំឡេង)\b/i.test(text.replace(url, ""));

  if (/^https?:\/\/(t\.me|telegram\.me)\//i.test(url)) {
    await sendTelegramPost(chatId, user, url, quota);
    return;
  }

  try {
    await botJobs.createUrlJob({ telegramUserId: user.telegram_user_id, chatId, url, audioOnly });
    if (!quota.premium) await incrementUsage(user.telegram_user_id, quota.usage);
    await send(chatId, t.queued);
  } catch (err) {
    console.error("Bot URL job failed:", err?.message ?? err);
    await send(chatId, t.failed(String(err?.message ?? err).slice(0, 200)));
  }
}

/**
 * Operator-only commands, answered only in the operator's own chat
 * (TELEGRAM_ADMIN_CHAT_ID). Returns true when it handled the message, so an
 * ordinary user typing /stats just falls through to the link handling.
 */
async function handleAdminCommand(chatId, text) {
  if (!config.telegramAdminChatId || String(chatId) !== String(config.telegramAdminChatId)) return false;

  if (text === "/stats") {
    const users = rows(await db().from("bot_users").select("telegram_user_id, created_at"));
    const jobs = rows(await db().from("bot_jobs").select("id, created_at"));
    const since = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const recent = (list) => list.filter((r) => new Date(r.created_at).getTime() >= since).length;
    await send(
      chatId,
      `📊 Bot stats\n\n` +
        `Users: ${users.length} (+${recent(users)} this week)\n` +
        `Link downloads: ${jobs.length} (+${recent(jobs)} this week)`
    );
    return true;
  }

  const setStorage = /^\/setstorage(?:\s+(-?\d+))?$/i.exec(text);
  if (setStorage) {
    await send(
      chatId,
      setStorage[1]
        ? await botDeliver.saveStorageChat(setStorage[1], null)
        : await botDeliver.setStorageFromForward(null)
    );
    return true;
  }

  const broadcast = /^\/broadcast\s+([\s\S]+)$/.exec(text);
  if (broadcast) {
    const message = broadcast[1];
    const users = rows(await db().from("bot_users").select("telegram_user_id").eq("blocked", false));
    let delivered = 0;
    for (const user of users) {
      const result = await send(user.telegram_user_id, message);
      if (result?.ok) delivered += 1;
      // Telegram throttles a bot to ~30 messages a second; a small gap keeps a
      // broadcast to a few thousand people from tripping it.
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    await send(chatId, `📣 Sent to ${delivered}/${users.length}.`);
    return true;
  }

  return false;
}

/** Slash commands, for anyone who prefers typing to tapping. */
function commandAction(text) {
  switch (text.split(/\s+/)[0].toLowerCase()) {
    case "/account": return "account";
    case "/history": return "history";
    case "/referral": return "referral";
    case "/language": return "language";
    case "/app": return "app";
    case "/buy": return "buy";
    default: return null;
  }
}

/** The language buttons under "🌐 ភាសា". Returns true when it handled the tap. */
export async function handleCallback(cq) {
  const data = String(cq?.data ?? "");
  if (!data.startsWith("bot:")) return false;

  const [, kind, value] = data.split(":");
  const chatId = cq.message?.chat?.id;
  const userId = cq.from?.id;
  if (!chatId || !userId) return false;

  if (kind !== "lang") {
    const user = await ensureUser(cq.from, null);
    return botPay.handlePayCallback(cq, user);
  }

  const language = value === "en" ? "en" : "km";
  await db()
    .from("bot_users")
    .update({ language, updated_at: nowIso() })
    .eq("telegram_user_id", userId);

  await call("answerCallbackQuery", { callback_query_id: cq.id });
  await send(chatId, texts(language).languageSet, { reply_markup: mainKeyboard(language) });
  return true;
}

const isAdminChat = (chatId) =>
  Boolean(config.telegramAdminChatId) && String(chatId) === String(config.telegramAdminChatId);

function mayUsePrivateLinks(chatId, quota) {
  if (isAdminChat(chatId)) return true;
  if (config.botPrivateLinks === "all") return true;
  if (config.botPrivateLinks === "admin") return false;
  return quota.premium;
}

/**
 * The original flow: one Telegram post link in, its media back. Runs through
 * the shared userbot, since a bot cannot read a group it isn't in.
 */
async function sendTelegramPost(chatId, user, url, quota) {
  const t = texts(user.language);

  if (/t\.me\/(\+|joinchat\/)/i.test(url)) {
    await send(chatId, t.inviteLink);
    return;
  }

  let parsed;
  try {
    parsed = parseTelegramLink(url);
  } catch {
    await send(chatId, t.notALink);
    return;
  }
  if (!parsed.messageId) {
    await send(chatId, t.notALink);
    return;
  }

  // A numeric chat id is a t.me/c/... link: a private group or channel that
  // only the operator's accounts can read. See config.botPrivateLinks.
  if (typeof parsed.chatId === "number" && !mayUsePrivateLinks(chatId, quota)) {
    await send(chatId, t.privateVipOnly);
    return;
  }

  let client;
  let entity;
  try {
    ({ client, entity } = await getClientForChat(parsed.chatId));
  } catch {
    await send(chatId, t.privateNoAccess);
    return;
  }

  await send(chatId, t.working);

  // Fastest and best path: have the userbot forward the post into the storage
  // channel and let the bot copy it from there. Telegram moves its own file,
  // so the person gets a real, playable video of any size in seconds -- no
  // download here, and none of the Bot API's 50MB upload limit. Everything
  // below is the fallback for when that isn't set up (or the source group
  // forbids forwarding).
  const delivered = await botDeliver.deliverTelegramPost({
    userChatId: chatId,
    sourceChatId: parsed.chatId,
    messageId: parsed.messageId,
  });
  if (delivered.ok) {
    if (!quota.premium) await incrementUsage(user.telegram_user_id, quota.usage);
    return;
  }
  if (delivered.reason === "bot-not-in-storage" && isAdminChat(chatId)) {
    await send(chatId, "⚠️ Storage channel is set, but I'm not an admin of it — add me and try again.");
  }

  let localPath = null;
  try {
    const found = await withFloodRetry(() => client.getMessages(entity, { ids: parsed.messageId }), {
      label: `bot link fetch ${parsed.chatId}/${parsed.messageId}`,
    });
    const msg = Array.isArray(found) ? found[0] : found;
    const info = msg?.media ? mediaInfo(msg) : null;
    if (!info) {
      await send(chatId, t.noMedia);
      return;
    }

    await fs.mkdir(config.downloadDir, { recursive: true });
    localPath = path.join(config.downloadDir, `bot-${user.telegram_user_id}-${Date.now()}-${info.fileName}`);
    await withFloodRetry(() => client.downloadMedia(msg, { outputFile: localPath }), {
      label: `bot link download ${parsed.chatId}/${parsed.messageId}`,
    });

    const { size } = await fs.stat(localPath);
    if (size > BOT_UPLOAD_LIMIT_BYTES) {
      // Over the Bot API's 50MB send limit -- which is every full episode --
      // so it goes to R2 and comes back as a link instead of being refused.
      const key = r2.buildUploadKey(`bot/${user.telegram_user_id}`, info.fileName);
      const link = await r2.upload(localPath, key, info.mimeType);
      const mb = Math.round(size / (1024 * 1024));
      await send(chatId, `${t.tooBig(mb)}\n\n${t.doneWithLink(info.fileName, link)}`);
      if (!quota.premium) await incrementUsage(user.telegram_user_id, quota.usage);
      return;
    }

    await sendFile(chatId, info.mediaType === "audio" ? "sendAudio" : "sendVideo", localPath);
    if (!quota.premium) await incrementUsage(user.telegram_user_id, quota.usage);
  } catch (err) {
    console.error("Bot link download failed:", err?.message ?? err);
    await send(chatId, t.failed(String(err?.message ?? err).slice(0, 200)));
  } finally {
    if (localPath) await fs.unlink(localPath).catch(() => {});
  }
}
