/**
 * Sends the operator a Telegram DM when a payment needs a look, with
 * Approve/Reject buttons attached. Plain Bot API over fetch -- no MTProto,
 * no session -- reusing the same bot already set up for the Login Widget
 * (see telegramLogin.js / config.telegramLoginBotToken), since one bot can
 * do both jobs and the operator has to set up only one.
 */
import { config } from "./config.js";
import { decorate, refusedEmoji } from "./customEmoji.js";

async function post(method, body) {
  const res = await fetch(`https://api.telegram.org/bot${config.telegramLoginBotToken}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json().catch(() => ({}));
}

/**
 * One Bot API call. Text and buttons may carry custom emoji tokens
 * ({:yt:}, `emoji: "aba"` -- see customEmoji.js); if Telegram refuses the
 * custom emoji, the same message goes out once more with plain emoji, so a
 * logo problem can never swallow a message.
 */
export async function call(method, body) {
  if (!config.telegramLoginBotToken) return null;
  let data = await post(method, await decorate(body));
  if (!data.ok && refusedEmoji(data)) data = await post(method, await decorate(body, { plain: true }));
  if (!data.ok) console.error(`Telegram ${method} failed:`, JSON.stringify(data));
  return data;
}

/** DMs the operator about a new payment claim, with Approve/Reject inline buttons. */
export async function notifyAdminOfSubmission(submission, tierLabel) {
  if (!config.telegramAdminChatId) return;
  const text =
    `💳 New payment claim\n` +
    `From: ${submission.email || submission.user_id}\n` +
    `Plan: ${tierLabel} ($${submission.amount})\n` +
    `Submission: ${submission.id}`;
  const keyboard = {
    inline_keyboard: [[
      { text: "✅ Approve", callback_data: `pay_approve:${submission.id}` },
      { text: "❌ Reject", callback_data: `pay_reject:${submission.id}` },
    ]],
  };
  if (submission.screenshot_url) {
    await call("sendPhoto", {
      chat_id: config.telegramAdminChatId,
      photo: submission.screenshot_url,
      caption: text,
      reply_markup: keyboard,
    });
  } else {
    await call("sendMessage", {
      chat_id: config.telegramAdminChatId,
      text,
      reply_markup: keyboard,
    });
  }
}

/** Informational-only ping for a payment the ABA auto-confirm path already granted. */
export async function notifyAdminOfAutoApproval(submission, tierLabel) {
  if (!config.telegramAdminChatId) return;
  await call("sendMessage", {
    chat_id: config.telegramAdminChatId,
    text:
      `✅ Auto-confirmed via ABA\n` +
      `From: ${submission.email || submission.user_id}\n` +
      `Plan: ${tierLabel} ($${submission.amount})\n` +
      `Submission: ${submission.id}`,
  });
}

/** Stamps the admin's message with the decision, so a tapped button doesn't look like a no-op. */
export async function stampDecision(message, verdict) {
  if (!message?.chat?.id || !message?.message_id) return;
  const isPhoto = typeof message.caption === "string";
  const original = message.caption ?? message.text ?? "";
  await call(isPhoto ? "editMessageCaption" : "editMessageText", {
    chat_id: message.chat.id,
    message_id: message.message_id,
    ...(isPhoto ? { caption: `${original}\n\n${verdict}` } : { text: `${original}\n\n${verdict}` }),
  });
}

/** Closes the loading spinner on the tapped button with a short toast. */
export async function answerCallbackQuery(callbackQueryId, text) {
  await call("answerCallbackQuery", { callback_query_id: callbackQueryId, text });
}
