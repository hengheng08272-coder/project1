/**
 * Image Q&A: tap "📷 សួរអំពីរូបភាព", send a photo (a caption is the
 * question), get an AI answer about it. Also works the short way -- any
 * photo sent with a caption is answered directly, the same "just ask"
 * shortcut aiReply.js gives plain text, without tapping the button first.
 *
 * Uses the same NVIDIA key and model as aiReply.js -- nemotron-3-nano-omni
 * genuinely reads images, not just text -- so this is off by exactly the
 * same switch (no key, no feature) and shares its daily caps.
 */
import { call } from "./notifyBot.js";
import { config } from "./config.js";
import * as aiReply from "./aiReply.js";

const TEXT = {
  km: {
    ask: "{:m_camera:} សួរអំពីរូបភាព\n\nផ្ញើរូបភាពមកខ្ញុំ (អាចដាក់សំណួរជា caption ជាមួយក៏បាន) ខ្ញុំនឹងមើល ហើយឆ្លើយអោយ។",
    working: "{:wait:} កំពុងមើលរូបភាព…",
    off: "{:fail:} មុខងារនេះមិនទាន់បើកនៅឡើយទេ។",
    failed: "{:fail:} មើលរូបភាពនេះមិនបានទេ សូមសាកម្ដងទៀត។",
  },
  en: {
    ask: "{:m_camera:} Ask about a photo\n\nSend me a photo -- you can add your question as its caption -- and I'll take a look.",
    working: "{:wait:} Looking at the photo…",
    off: "{:fail:} This feature isn't turned on yet.",
    failed: "{:fail:} Couldn't read that photo. Please try again.",
  },
};

// In-memory on purpose, like translate.js's own wait state: a restart just
// means the person taps the button again.
const waiting = new Map(); // chatId -> { at }
const WAIT_MS = 10 * 60_000;

// Keeps the base64 encoding (~4/3 larger) under NVIDIA's ~180,000-character
// inline-image limit, with headroom for a bigger limit shrinking slightly.
const MAX_IMAGE_BYTES = 130_000;

export function ask(chatId, user) {
  const t = TEXT[user.language] ?? TEXT.km;
  if (!config.nvidiaApiKey) return call("sendMessage", { chat_id: chatId, text: t.off });
  waiting.set(chatId, { at: Date.now() });
  return call("sendMessage", { chat_id: chatId, text: t.ask });
}

export function cancel(chatId) {
  waiting.delete(chatId);
}

function isWaiting(chatId) {
  const w = waiting.get(chatId);
  if (!w) return false;
  if (Date.now() - w.at > WAIT_MS) {
    waiting.delete(chatId);
    return false;
  }
  return true;
}

async function fetchPhotoBytes(fileId) {
  const info = await call("getFile", { file_id: fileId });
  const filePath = info?.result?.file_path;
  if (!filePath) throw new Error("Telegram did not return the file.");
  const res = await fetch(`https://api.telegram.org/file/bot${config.telegramLoginBotToken}/${filePath}`);
  if (!res.ok) throw new Error(`Downloading the photo failed (${res.status}).`);
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Telegram's `photo` sizes are ordered smallest to largest. Tries the
 * biggest ones first (skipping the tiny thumbnail, which is rarely useful
 * for a real question) and keeps the first that fits under the inline
 * base64 limit, so most photos cost exactly one download.
 */
async function fetchSizedPhoto(sizes) {
  const byWidth = [...sizes].sort((a, b) => (a.width ?? 0) - (b.width ?? 0));
  const candidates = byWidth.length > 1 ? byWidth.slice(1).reverse() : byWidth;
  let smallestSoFar = null;
  for (const size of candidates) {
    const buffer = await fetchPhotoBytes(size.file_id);
    if (buffer.length <= MAX_IMAGE_BYTES) return buffer;
    if (!smallestSoFar || buffer.length < smallestSoFar.length) smallestSoFar = buffer;
  }
  return smallestSoFar;
}

/**
 * Handles an incoming photo as an image question, either because the button
 * put this chat in a waiting state or because the photo itself carries a
 * caption to answer. Returns true when it handled the message, so the
 * caller's other photo handlers (payment screenshots, admin posters, ...)
 * still get first refusal and an unrelated bare photo still falls through
 * unchanged.
 */
export async function handleMessage(message, user) {
  const chatId = message?.chat?.id;
  if (!message?.photo?.length || !chatId) return false;
  const caption = String(message.caption ?? "").trim();
  const wasWaiting = isWaiting(chatId);
  if (!wasWaiting && !caption) return false;
  waiting.delete(chatId);

  const t = TEXT[user.language] ?? TEXT.km;
  if (!config.nvidiaApiKey) {
    if (wasWaiting) await call("sendMessage", { chat_id: chatId, text: t.off });
    return wasWaiting;
  }

  await call("sendMessage", { chat_id: chatId, text: t.working });
  try {
    const buffer = await fetchSizedPhoto(message.photo);
    const answer = await aiReply.answerImageQuestion(user.telegram_user_id, buffer, caption, user.language);
    await call("sendMessage", { chat_id: chatId, text: answer ?? t.failed });
  } catch (err) {
    console.error("Image Q&A failed:", err?.message ?? err);
    await call("sendMessage", { chat_id: chatId, text: t.failed });
  }
  return true;
}
