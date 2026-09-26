/**
 * Free + paid use of the menu bot.
 *
 *   💎 Buy  →  pick a package  →  a KHQR for that exact amount arrives
 *   →  pay in ABA / any Bakong bank  →  confirmed one of two ways:
 *        - automatically, when BAKONG_API_TOKEN is set: the worker asks
 *          Bakong whether that exact QR (by md5) has been paid, for the
 *          right amount;
 *        - by the operator, who gets the payer's screenshot with
 *          Approve / Reject buttons.
 *
 * The QR is the owner's own bank QR with only the amount rewritten (see
 * khqr.js), set once by the operator sending it to the bot with /setqr.
 */
import jpeg from "jpeg-js";
import jsQR from "jsqr";
import { PNG } from "pngjs";

import { config } from "./config.js";
import { db, nowIso, rows } from "./db.js";
import { applyKhqrTemplate, khqrMd5, validateKhqrTemplate } from "./khqr.js";
import { renderKhqrCard } from "./khqrCard.js";
import * as khInvoice from "./khInvoice.js";
import { call } from "./notifyBot.js";

// A payer has this long to pay one QR before the order lapses. Bakong
// payments land in seconds, so this is only generous for the screenshot path.
const ORDER_TTL_MS = 60 * 60 * 1000;
const BAKONG_BASE = (process.env.BAKONG_API_BASE || "https://api-bakong.nbc.gov.kh").replace(/\/+$/, "");

export function isAdminChat(chatId) {
  return Boolean(config.telegramAdminChatId) && String(chatId) === String(config.telegramAdminChatId);
}

const L = {
  km: {
    choose: "💎 ជ្រើសរើសកញ្ចប់៖",
    freeLine: (left) => `🆓 ឥតគិតថ្លៃនៅសល់៖ ${left} ដង`,
    premiumLine: (until) => `👑 VIP រហូតដល់ ${until}`,
    notReady: "ការទូទាត់មិនទាន់បានរៀបចំនៅឡើយទេ។ សូមទាក់ទងអ្នកគ្រប់គ្រង។",
    qrCaption: (pkg, amount, ticket) =>
      `💳 ${pkg} — $${amount}\n🎫 ${ticket}\n\n` +
      `📷 ស្កេន QR ដោយ ABA, ACLEDA, Wing ឬ App ធនាគារណាក៏បាន\n` +
      `💡 នៅលើទូរស័ព្ទតែមួយ៖ ចុចសង្កត់រូប → រក្សាទុក → បើកក្នុង App ធនាគារ\n` +
      `✅ បង់រួច ផ្ញើ screenshot វិក្កយបត្រមកទីនេះ`,
    cancel: "❌ បោះបង់",
    cancelled: "បានបោះបង់ការបញ្ជាទិញ។",
    screenshotReceived: "✅ ទទួលបាន screenshot។ កំពុងរង់ចាំការបញ្ជាក់ — ជាធម្មតាតិចជាងពីរបីនាទី។",
    noPendingOrder: "មិនមានការបញ្ជាទិញកំពុងរង់ចាំទេ។ ចុច 💎 ទិញ ដើម្បីចាប់ផ្ដើម។",
    granted: (pkg) => `🎉 ការទូទាត់បានបញ្ជាក់! បានបន្ថែម៖ ${pkg}។ អរគុណ!`,
    rejected: "❌ ការទូទាត់មិនត្រូវបានបញ្ជាក់ទេ។ បើអ្នកបានបង់ពិតប្រាកដ សូមទាក់ទងអ្នកគ្រប់គ្រង។",
  },
  en: {
    choose: "💎 Choose a package:",
    freeLine: (left) => `🆓 Free downloads left: ${left}`,
    premiumLine: (until) => `👑 VIP until ${until}`,
    notReady: "Payments aren't set up yet. Please contact the operator.",
    qrCaption: (pkg, amount, ticket) =>
      `💳 ${pkg} — $${amount}\n🎫 ${ticket}\n\n` +
      `📷 Scan with ABA, ACLEDA, Wing or any KHQR bank app\n` +
      `💡 Same phone: long-press the picture → save → open it in your bank app\n` +
      `✅ Paid? Send the receipt screenshot here`,
    cancel: "❌ Cancel",
    cancelled: "Order cancelled.",
    screenshotReceived: "✅ Screenshot received. Waiting for confirmation — usually a few minutes.",
    noPendingOrder: "You have no pending order. Tap 💎 Buy to start.",
    granted: (pkg) => `🎉 Payment confirmed! Added: ${pkg}. Thank you!`,
    rejected: "❌ The payment couldn't be confirmed. If you really paid, please contact the operator.",
  },
};
const t = (language) => L[language] ?? L.km;

// ------------------------------------------------------------- telegram io

/** sendPhoto with bytes (multipart) -- JSON can't carry a generated PNG. */
async function sendPhotoBuffer(chatId, buffer, caption, replyMarkup) {
  const form = new FormData();
  form.set("chat_id", String(chatId));
  form.set("photo", new Blob([buffer], { type: "image/png" }), "khqr.png");
  if (caption) form.set("caption", caption);
  if (replyMarkup) form.set("reply_markup", JSON.stringify(replyMarkup));
  const res = await fetch(`https://api.telegram.org/bot${config.telegramLoginBotToken}/sendPhoto`, {
    method: "POST",
    body: form,
  });
  const data = await res.json().catch(() => ({}));
  if (!data.ok) console.error("Telegram sendPhoto failed:", JSON.stringify(data));
  return data;
}

/** Downloads a photo the bot was sent, as raw bytes. */
async function fetchTelegramFile(fileId) {
  const info = await call("getFile", { file_id: fileId });
  const filePath = info?.result?.file_path;
  if (!filePath) throw new Error("Telegram did not return the file.");
  const res = await fetch(`https://api.telegram.org/file/bot${config.telegramLoginBotToken}/${filePath}`);
  if (!res.ok) throw new Error(`Downloading the photo failed (${res.status}).`);
  return Buffer.from(await res.arrayBuffer());
}

/** Reads a QR code out of a JPEG/PNG. Null when none is found. */
function decodeQr(buffer) {
  const isPng = buffer.subarray(0, 4).toString("hex") === "89504e47";
  const image = isPng ? PNG.sync.read(buffer) : jpeg.decode(buffer, { useTArray: true });
  const code = jsQR(new Uint8ClampedArray(image.data), image.width, image.height, {
    inversionAttempts: "attemptBoth",
  });
  return code?.data ?? null;
}

// ----------------------------------------------------------------- quota

/** True while a VIP period is running. */
export function isPremium(user) {
  return Boolean(user?.premium_until) && new Date(user.premium_until).getTime() > Date.now();
}

function formatDate(iso) {
  return new Date(iso).toISOString().slice(0, 10);
}

/** SaveIt's own packs. KH Invoice plans live in the same table but have their own screen. */
async function packages() {
  const all = rows(await db().from("bot_packages").select("*").eq("active", true).order("sort"));
  return all.filter((pkg) => !khInvoice.isInvoicePackage(pkg.id));
}

function packageTitle(pkg, language) {
  return language === "en" ? pkg.title_en : pkg.title_km;
}

// ----------------------------------------------------------------- flows

/** "💎 Buy": the user's standing, then one button per package. */
export async function showPackages(chatId, user, freeLeft) {
  const s = t(user.language);
  const list = await packages();
  const standing = isPremium(user) ? s.premiumLine(formatDate(user.premium_until)) : s.freeLine(freeLeft);
  await call("sendMessage", {
    chat_id: chatId,
    text: `${standing}\n\n${s.choose}`,
    reply_markup: {
      inline_keyboard: list.map((pkg) => [
        { text: `${packageTitle(pkg, user.language)} — $${Number(pkg.price_usd).toFixed(2)}`, callback_data: `bot:buy:${pkg.id}` },
      ]),
    },
  });
}

function newTicket() {
  return `KH${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 36 ** 2).toString(36).toUpperCase().padStart(2, "0")}`;
}

/** A package was tapped: build its QR and send it. */
async function startOrder(chatId, user, packageId) {
  const s = t(user.language);
  const [pkg] = rows(await db().from("bot_packages").select("*").eq("id", packageId).eq("active", true).limit(1));
  const [settings] = rows(await db().from("bot_settings").select("khqr_template").eq("id", 1).limit(1));
  if (!pkg || !settings?.khqr_template) {
    await call("sendMessage", { chat_id: chatId, text: s.notReady });
    return;
  }

  const amount = Number(pkg.price_usd);
  const built = applyKhqrTemplate(settings.khqr_template, amount);
  if (!built.ok) {
    console.error("Bot KHQR build failed:", built.reason);
    await call("sendMessage", { chat_id: chatId, text: s.notReady });
    return;
  }

  // One live order per person: a new QR replaces an unpaid one rather than
  // leaving two open that could both be screenshotted.
  await db()
    .from("bot_orders")
    .update({ status: "expired" })
    .eq("telegram_user_id", user.telegram_user_id)
    .eq("status", "pending");

  const ticket = newTicket();
  const [order] = rows(
    await db()
      .from("bot_orders")
      .insert({
        ticket,
        telegram_user_id: user.telegram_user_id,
        chat_id: chatId,
        package_id: pkg.id,
        amount_usd: amount,
        khqr: built.payload,
        khqr_md5: khqrMd5(built.payload),
      })
      .select("*")
  );

  const title = packageTitle(pkg, user.language);
  const png = await renderKhqrCard(built.payload, {
    title: khInvoice.isInvoicePackage(pkg.id) ? "KH Invoice Pro" : "SaveIt Pro",
    subtitle: `${title} · $${amount.toFixed(2)}`,
    ticket,
  });
  const keyboard = [[{ text: s.cancel, callback_data: `bot:cancel:${order.id}` }]];

  await sendPhotoBuffer(chatId, png, s.qrCaption(packageTitle(pkg, user.language), amount.toFixed(2), ticket), {
    inline_keyboard: keyboard,
  });
}

/** Adds what a paid order bought, and tells the payer. */
async function grant(order, confirmedBy, bankHash = null) {
  // Conditional on still being pending, so a double tap (or Bakong and the
  // operator confirming at the same moment) can only grant once.
  const updated = rows(
    await db()
      .from("bot_orders")
      .update({ status: "paid", paid_at: nowIso(), confirmed_by: confirmedBy, bank_hash: bankHash })
      .eq("id", order.id)
      .eq("status", "pending")
      .select("*")
  );
  if (updated.length === 0) return false;

  const [pkg] = rows(await db().from("bot_packages").select("*").eq("id", order.package_id).limit(1));
  const [user] = rows(
    await db().from("bot_users").select("*").eq("telegram_user_id", order.telegram_user_id).limit(1)
  );
  if (!pkg || !user) return false;

  if (khInvoice.isInvoicePackage(pkg.id)) {
    // Paid for KH Invoice, not for downloads: the order is already marked
    // paid, so if the app can't be reached the operator is told and can
    // retry by hand -- the payer is never charged twice.
    try {
      const until = await khInvoice.activatePlan(order, user);
      await call("sendMessage", { chat_id: order.chat_id, text: khInvoice.grantedText(user.language, until) });
    } catch (err) {
      console.error(`KH Invoice activation for ${order.ticket} failed:`, err?.message ?? err);
      if (config.telegramAdminChatId) {
        await call("sendMessage", {
          chat_id: config.telegramAdminChatId,
          text: `⚠️ KH Invoice activation failed for paid order ${order.ticket} (user ${order.telegram_user_id}): ${String(err?.message ?? err).slice(0, 300)}\nRetry with /invactivate ${order.ticket}`,
        });
      }
    }
    return true;
  }

  const patch = { updated_at: nowIso() };
  if (pkg.downloads) {
    patch.paid_downloads = (user.paid_downloads ?? 0) + pkg.downloads;
  } else {
    // A renewal before the old period ends stacks on top of it.
    const from = isPremium(user) ? new Date(user.premium_until).getTime() : Date.now();
    patch.premium_until = new Date(from + pkg.days * 24 * 60 * 60 * 1000).toISOString();
  }
  await db().from("bot_users").update(patch).eq("telegram_user_id", user.telegram_user_id);

  await call("sendMessage", {
    chat_id: order.chat_id,
    text: t(user.language).granted(packageTitle(pkg, user.language)),
  });
  return true;
}

/**
 * A photo arrived. From the operator after /setqr it's the bank QR to build
 * orders from; from anyone else it's a payment screenshot for their pending
 * order. Returns true when it handled the message.
 */
export async function handlePhoto(message, user) {
  const photo = message.photo?.[message.photo.length - 1];
  if (!photo) return false;
  const chatId = message.chat.id;
  const caption = String(message.caption ?? "").trim();

  if (isAdminChat(chatId) && /^\/setqr\b/i.test(caption)) {
    await saveQrFromPhoto(chatId, photo.file_id);
    return true;
  }

  const s = t(user.language);
  const [order] = rows(
    await db()
      .from("bot_orders")
      .select("*, package:bot_packages(title_en, title_km)")
      .eq("telegram_user_id", user.telegram_user_id)
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(1)
  );
  if (!order) {
    await call("sendMessage", { chat_id: chatId, text: s.noPendingOrder });
    return true;
  }

  await db().from("bot_orders").update({ screenshot_file_id: photo.file_id }).eq("id", order.id);
  await call("sendMessage", { chat_id: chatId, text: s.screenshotReceived });

  if (config.telegramAdminChatId) {
    const who = user.username ? `@${user.username}` : user.first_name || user.telegram_user_id;
    await call("sendPhoto", {
      chat_id: config.telegramAdminChatId,
      photo: photo.file_id,
      caption:
        `💳 Payment screenshot\n` +
        `From: ${who} (${user.telegram_user_id})\n` +
        `Package: ${order.package?.title_en ?? order.package_id} — $${Number(order.amount_usd).toFixed(2)}\n` +
        `Ticket: ${order.ticket}`,
      reply_markup: {
        inline_keyboard: [[
          { text: "✅ Approve", callback_data: `bot:pay_ok:${order.id}` },
          { text: "❌ Reject", callback_data: `bot:pay_no:${order.id}` },
        ]],
      },
    });
  }
  return true;
}

async function saveQrFromPhoto(chatId, fileId) {
  try {
    const payload = decodeQr(await fetchTelegramFile(fileId));
    if (!payload) {
      await call("sendMessage", { chat_id: chatId, text: "❌ No QR code found in that photo. Send a clear, uncropped screenshot of your KHQR." });
      return;
    }
    await saveTemplate(chatId, payload);
  } catch (err) {
    await call("sendMessage", { chat_id: chatId, text: `❌ Couldn't read that photo: ${String(err?.message ?? err).slice(0, 200)}` });
  }
}

const TEMPLATE_PROBLEMS = {
  unparseable: "that isn't a KHQR payload.",
  "bad-checksum": "the checksum doesn't match -- it looks cut off or altered.",
  "no-amount-field":
    "it's a static QR (no amount). In ABA, create a QR *with an amount* (any amount, e.g. $1) and send that one -- the bot replaces the amount per order.",
};

async function saveTemplate(chatId, payload) {
  const valid = validateKhqrTemplate(payload);
  if (!valid.ok) {
    await call("sendMessage", { chat_id: chatId, text: `❌ Can't use this QR: ${TEMPLATE_PROBLEMS[valid.reason] ?? valid.reason}` });
    return;
  }
  await db().from("bot_settings").update({ khqr_template: valid.payload, updated_at: nowIso() }).eq("id", 1);
  await call("sendMessage", {
    chat_id: chatId,
    text: "✅ Payment QR saved. Every order now gets this QR with its own exact amount. Tap 💎 to try it.",
  });
}

/** Operator text commands for payments. Returns true when handled. */
export async function handleAdminPayCommand(chatId, text) {
  if (!isAdminChat(chatId)) return false;
  const setKhqr = /^\/setqr\s+(\S+)$/i.exec(text);
  if (setKhqr) {
    await saveTemplate(chatId, setKhqr[1]);
    return true;
  }
  const retry = /^\/invactivate\s+(\S+)$/i.exec(text);
  if (retry) {
    const [order] = rows(await db().from("bot_orders").select("*").eq("ticket", retry[1]).limit(1));
    if (!order || order.status !== "paid" || !khInvoice.isInvoicePackage(order.package_id)) {
      await call("sendMessage", { chat_id: chatId, text: "No paid KH Invoice order with that ticket." });
      return true;
    }
    const [user] = rows(await db().from("bot_users").select("*").eq("telegram_user_id", order.telegram_user_id).limit(1));
    try {
      const until = await khInvoice.activatePlan(order, user ?? { telegram_user_id: order.telegram_user_id });
      await call("sendMessage", { chat_id: order.chat_id, text: khInvoice.grantedText(user?.language, until) });
      await call("sendMessage", { chat_id: chatId, text: `✅ Activated until ${String(until).slice(0, 10)}.` });
    } catch (err) {
      await call("sendMessage", { chat_id: chatId, text: `❌ ${String(err?.message ?? err).slice(0, 300)}` });
    }
    return true;
  }
  if (/^\/setqr$/i.test(text)) {
    await call("sendMessage", {
      chat_id: chatId,
      text: "Send your ABA KHQR screenshot as a photo with the caption /setqr (or /setqr <KHQR text>).",
    });
    return true;
  }
  return false;
}

/** Buy / cancel / approve / reject buttons. Returns true when handled. */
export async function handlePayCallback(cq, user) {
  const [, kind, value] = String(cq.data ?? "").split(":");
  const chatId = cq.message?.chat?.id;

  if (kind === "buy") {
    await call("answerCallbackQuery", { callback_query_id: cq.id });
    await startOrder(chatId, user, value);
    return true;
  }

  if (kind === "cancel") {
    await db()
      .from("bot_orders")
      .update({ status: "expired" })
      .eq("id", value)
      .eq("telegram_user_id", cq.from.id)
      .eq("status", "pending");
    await call("answerCallbackQuery", { callback_query_id: cq.id, text: t(user.language).cancelled });
    return true;
  }

  if (kind === "pay_ok" || kind === "pay_no") {
    if (!isAdminChat(chatId)) {
      await call("answerCallbackQuery", { callback_query_id: cq.id, text: "Not authorized." });
      return true;
    }
    const [order] = rows(await db().from("bot_orders").select("*").eq("id", value).limit(1));
    if (!order || order.status !== "pending") {
      await call("answerCallbackQuery", { callback_query_id: cq.id, text: `Already ${order?.status ?? "gone"}.` });
      return true;
    }
    let verdict;
    if (kind === "pay_ok") {
      await grant(order, "operator");
      verdict = "✅ APPROVED";
    } else {
      await db().from("bot_orders").update({ status: "rejected", confirmed_by: "operator" }).eq("id", order.id).eq("status", "pending");
      const [payer] = rows(await db().from("bot_users").select("language").eq("telegram_user_id", order.telegram_user_id).limit(1));
      await call("sendMessage", { chat_id: order.chat_id, text: t(payer?.language).rejected });
      verdict = "❌ REJECTED";
    }
    await call("answerCallbackQuery", { callback_query_id: cq.id, text: verdict });
    await call("editMessageCaption", {
      chat_id: chatId,
      message_id: cq.message.message_id,
      caption: `${cq.message.caption ?? ""}\n\n${verdict}`,
    });
    return true;
  }
  return false;
}

// ----------------------------------------------------------- worker pass

/**
 * Asks Bakong about every open order (when BAKONG_API_TOKEN is set), and
 * lapses the ones past their window. Approval needs Bakong to report the
 * exact QR paid, for the exact amount, in USD, with a transaction hash no
 * other order has used (bank_hash is unique).
 */
export async function checkPendingOrders() {
  if (!config.telegramLoginBotToken) return 0;

  const cutoff = new Date(Date.now() - ORDER_TTL_MS).toISOString();
  await db().from("bot_orders").update({ status: "expired" }).eq("status", "pending").lt("created_at", cutoff);

  const token = process.env.BAKONG_API_TOKEN;
  if (!token) return 0;

  const open = rows(
    await db().from("bot_orders").select("*").eq("status", "pending").order("created_at").limit(25)
  );
  let confirmed = 0;
  for (const order of open) {
    try {
      const res = await fetch(`${BAKONG_BASE}/v1/check_transaction_by_md5`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ md5: order.khqr_md5 }),
      });
      const envelope = await res.json().catch(() => ({}));
      const tx = envelope?.responseCode === 0 ? envelope.data : null;
      if (!tx) continue;
      if (Math.abs(Number(tx.amount) - Number(order.amount_usd)) > 0.001) continue;
      if (tx.currency && String(tx.currency).toUpperCase() !== "USD") continue;
      if (await grant(order, "bakong", tx.hash ?? null)) confirmed += 1;
    } catch (err) {
      // A unique-violation on bank_hash lands here too: that payment already
      // confirmed a different order, so this one must not be granted.
      console.error(`Bakong check for order ${order.ticket} failed:`, err?.message ?? err);
    }
  }
  return confirmed;
}
