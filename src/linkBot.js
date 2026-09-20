/**
 * The "paste a Telegram link, get the file back" bot flow -- a lighter-weight
 * companion to the web app's own group scanning: no account, no login, just
 * DM the bot a link to one message and it downloads that message's media
 * through the shared userbot and sends it straight back.
 *
 * Reuses the same bot token as the Login Widget / payment notifications
 * (config.telegramLoginBotToken) so there is only one bot to set up, and the
 * same shared userbot (telegram.js) the web app already uses for scanning
 * and downloading -- no second Telegram login.
 */
import fs from "node:fs/promises";
import path from "node:path";

import { config } from "./config.js";
import { db, nowIso, rows } from "./db.js";
import { withFloodRetry } from "./floodRetry.js";
import { call } from "./notifyBot.js";
import { mediaInfo } from "./scanner.js";
import { getClient, parseTelegramLink } from "./telegram.js";

const FREE_DOWNLOADS = 10;
// Telegram's own Bot API cap for a bot sending a file -- not configurable,
// and well below what the userbot itself can fetch, so this only limits the
// reply, not the download.
const BOT_UPLOAD_LIMIT_BYTES = 50 * 1024 * 1024;

async function sendText(chatId, text) {
  return call("sendMessage", { chat_id: chatId, text });
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

/** Handles one incoming Telegram `message` update for the link-paste flow. */
export async function handleMessage(message) {
  const chatId = message?.chat?.id;
  const telegramUserId = message?.from?.id;
  const text = String(message?.text ?? "").trim();
  if (!chatId || !telegramUserId) return;

  if (!text || text === "/start" || text === "/help") {
    await sendText(
      chatId,
      "👋 Paste a link to one Telegram post (e.g. https://t.me/c/123456789/42 or https://t.me/channelname/42) " +
        `and I'll send the video or song back to you here.\n\nYou get ${FREE_DOWNLOADS} free downloads.`
    );
    return;
  }

  let parsed;
  try {
    parsed = parseTelegramLink(text);
  } catch {
    await sendText(chatId, "That doesn't look like a Telegram link. Paste a link to the exact post, like https://t.me/c/123456789/42.");
    return;
  }
  if (!parsed.messageId) {
    await sendText(chatId, "That link points at a whole chat, not one post. Paste the link to the specific video/song message.");
    return;
  }

  const usage = await usageFor(telegramUserId);
  const used = usage?.free_used ?? 0;
  if (used >= FREE_DOWNLOADS) {
    await sendText(chatId, `You've used all ${FREE_DOWNLOADS} free downloads. Contact the admin to keep going.`);
    return;
  }

  await sendText(chatId, "⏳ Fetching that for you...");

  let localPath = null;
  try {
    const client = await getClient();
    const entity = await client.getEntity(parsed.chatId);
    const found = await withFloodRetry(() => client.getMessages(entity, { ids: parsed.messageId }), {
      label: `bot link fetch ${parsed.chatId}/${parsed.messageId}`,
    });
    const msg = Array.isArray(found) ? found[0] : found;
    if (!msg?.media) {
      await sendText(chatId, "That message has no video, audio, or downloadable file.");
      return;
    }

    const info = mediaInfo(msg);
    if (!info) {
      await sendText(chatId, "That message isn't a video or a song -- only those can be sent back right now.");
      return;
    }

    await fs.mkdir(config.downloadDir, { recursive: true });
    localPath = path.join(config.downloadDir, `bot-${telegramUserId}-${Date.now()}-${info.fileName}`);
    await withFloodRetry(() => client.downloadMedia(msg, { outputFile: localPath }), {
      label: `bot link download ${parsed.chatId}/${parsed.messageId}`,
    });

    const { size } = await fs.stat(localPath);
    if (size > BOT_UPLOAD_LIMIT_BYTES) {
      await sendText(
        chatId,
        `That file is ${(size / (1024 * 1024)).toFixed(0)}MB, over Telegram's 50MB bot upload limit -- too large for me to send back in this version.`
      );
      return;
    }

    await sendFile(chatId, info.mediaType === "audio" ? "sendAudio" : "sendVideo", localPath);
    await incrementUsage(telegramUserId, usage);

    const remaining = FREE_DOWNLOADS - (used + 1);
    if (remaining <= 3) {
      await sendText(chatId, `You have ${Math.max(remaining, 0)} free download${remaining === 1 ? "" : "s"} left.`);
    }
  } catch (err) {
    console.error("Bot link download failed:", err?.message ?? err);
    await sendText(chatId, `Couldn't fetch that: ${String(err?.message ?? err).slice(0, 200)}`);
  } finally {
    if (localPath) await fs.unlink(localPath).catch(() => {});
  }
}
