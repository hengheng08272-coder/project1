/**
 * The operator's own section, "🛡️ Admin": settings that used to be slash
 * commands to remember -- the menu's icons, the payment QRs, stats, the
 * emoji pack -- each behind a button, with the next photo taken as whatever
 * picture the last button asked for. Only ever answers in the operator's
 * chat (TELEGRAM_ADMIN_CHAT_ID), and every text command still works as it
 * did.
 */
import { call } from "./notifyBot.js";
import * as botPay from "./botPay.js";
import { mainKeyboard } from "./botText.js";
import { paymentSettings } from "./botConfig.js";
import { EMOJI, customEmojiTokens, resetCustomEmoji, setCustomEmoji } from "./customEmoji.js";

// The icons worth a button of their own: the main keyboard, the AI sub-menu,
// the brand marks. Any other token still works by name -- a photo captioned
// /setemoji <name>.
const ICONS = [
  ["free_all", "Free · ទាញយកវីដេអូ", "Free · Download videos"],
  ["dl", "Telegram Private Link", "Telegram Private Link"],
  ["inv_app", "គ្រប់គ្រងអាជីវកម្ម", "Manage Business"],
  ["m_emoji", "Emoji Maker", "Emoji Maker"],
  ["m_language", "បកប្រែ / ភាសា", "Translate / Language"],
  ["video", "រឿងនិយាយខ្មែរ", "Khmer-dubbed Shows"],
  ["sparkle", "SaveIt AI", "SaveIt AI"],
  ["m_camera", "AI · សួរអំពីរូបភាព", "AI · Ask about a photo"],
  ["m_summary", "AI · សង្ខេបវីដេអូ", "AI · Summarize a video"],
  ["m_ad", "AI · រូបភាព Ads", "AI · Ad image"],
  ["m_account", "គណនី", "Account"],
  ["credit", "បញ្ចូល Credit", "Add Credit"],
  ["invite", "ណែនាំមិត្ត", "Invite friends"],
  ["app_tg", "Open App", "Open App"],
  ["logo", "Logo", "Logo"],
  ["brand", "Brand", "Brand"],
];

const TEXT = {
  km: {
    home: "{:admin:} {b}Admin{/b}\n\nកំណត់ bot ពីទីនេះ — ជ្រើសខាងក្រោម។",
    btnEmoji: "🎨 កែ Emoji",
    btnQr: "💳 QR ទូទាត់",
    btnStats: "📊 ស្ថិតិ",
    btnPack: "🔄 សាងសង់ Emoji Pack ឡើងវិញ",
    btnCmds: "📖 ពាក្យបញ្ជាទាំងអស់",
    back: "⬅️ ត្រឡប់",
    emojiList:
      "{:admin:} {b}កែ Emoji{/b}\n\n" +
      "ជ្រើស icon ដែលចង់ប្ដូរ។ ✏️ = កំពុងប្រើរូបដែល admin ដាក់។\n\n" +
      "{:bulb:} Icon ផ្សេងទៀត៖ ផ្ញើរូបដោយដាក់ caption /setemoji <ឈ្មោះ>",
    askPhoto: (token, label) =>
      `{:${token}:} {b}${label}{/b}\n\n` +
      "ផ្ញើរូបថ្មីសម្រាប់ icon នេះមកឥឡូវ (Photo ឬ File)។\n" +
      "{:bulb:} រូបការ៉េ ផ្ទៃថ្លា (PNG ផ្ញើជា File) មើលទៅល្អបំផុត។",
    reset: "↩️ ប្រើរូបដើមវិញ",
    working: "{:wait:} កំពុងដាក់ icon…",
    emojiSaved: (token) =>
      `{:ok:} Icon ថ្មីដាក់រួចហើយ៖ {:${token}:}\n\n` +
      "Menu របស់បងធ្វើបច្ចុប្បន្នភាពភ្លាម។ អ្នកប្រើផ្សេងឃើញពេលគេបើក menu ម្ដងទៀត (/start)។\n" +
      "ចុច 🛡️ Admin ដើម្បីកែបន្ត។",
    emojiReset: (token) => `{:ok:} ត្រឡប់ទៅរូបដើមវិញហើយ៖ {:${token}:}`,
    emojiFailed: (why) => `{:fail:} ដាក់ icon មិនបានទេ៖ ${why}`,
    unknownToken: (name) => `{:fail:} គ្មាន icon ឈ្មោះ "${name}" ទេ។ វាយ /setemoji ដើម្បីមើលបញ្ជី។`,
    qrHint: "ជ្រើសធនាគារ រួចផ្ញើរូប KHQR មក។",
    setQr: (bank) => `💳 ដាក់ QR ${bank}`,
    dropQr: (bank) => `🗑 លុប QR ${bank}`,
    askQr: (bank) =>
      `💳 ផ្ញើរូប KHQR របស់ ${bank} មកឥឡូវ (screenshot ច្បាស់ មិនកាត់)។\n\n` +
      "{:bulb:} ត្រូវជា QR ដែលបង្កើត {b}មានចំនួនទឹកប្រាក់{/b} (ប៉ុន្មានក៏បាន ឧ. $1) — bot ប្ដូរចំនួនតាមការបញ្ជាទិញនីមួយៗ។",
    commands:
      "{:admin:} {b}ពាក្យបញ្ជា Admin{/b}\n\n" +
      "{b}ទូទៅ{/b}\n" +
      "/admin — បើកផ្ទាំង Admin\n" +
      "/stats — ស្ថិតិអ្នកប្រើ និងការទាញយក\n" +
      "/broadcast <សារ> — ផ្ញើសារទៅអ្នកប្រើទាំងអស់\n\n" +
      "{b}Emoji{/b}\n" +
      "/setemoji — ជ្រើស icon ដើម្បីប្ដូរ\n" +
      "រូប + caption /setemoji <ឈ្មោះ> — ប្ដូរ icon តាមឈ្មោះ\n" +
      "/makeemoji — សាងសង់ Emoji Pack ឡើងវិញ\n\n" +
      "{b}ការទូទាត់{/b}\n" +
      "/qrstatus — មើល QR ទាំងពីរ\n" +
      "/setqr · /setqr2 — ដាក់ QR ធនាគារ ១ · ២ (រូប + caption)\n" +
      "/setqr2 off — លុប QR ធនាគារ ២\n" +
      "/invactivate <ticket> — បើក KH Invoice ដោយដៃ\n\n" +
      "{b}រឿង{/b}\n" +
      "/shows — បញ្ជីរឿងទាំងអស់\n" +
      "/watchgroup <group> — scan Group\n" +
      "/setshow · /setgroup — កំណត់រឿង · Group\n\n" +
      "{b}ផ្សេងៗ{/b}\n" +
      "/setstorage — Channel ផ្ទុកវីដេអូ\n" +
      "/setbotpic — រូប profile របស់ bot\n" +
      "/dlspeed — តេស្តល្បឿនទាញយក",
  },
  en: {
    home: "{:admin:} {b}Admin{/b}\n\nSet the bot up from here — pick below.",
    btnEmoji: "🎨 Edit Emoji",
    btnQr: "💳 Payment QR",
    btnStats: "📊 Stats",
    btnPack: "🔄 Rebuild Emoji Pack",
    btnCmds: "📖 All commands",
    back: "⬅️ Back",
    emojiList:
      "{:admin:} {b}Edit Emoji{/b}\n\n" +
      "Pick the icon to change. ✏️ = using a picture set by the admin.\n\n" +
      "{:bulb:} Any other icon: send a picture captioned /setemoji <name>",
    askPhoto: (token, label) =>
      `{:${token}:} {b}${label}{/b}\n\n` +
      "Send the new picture for this icon now (as a Photo or a File).\n" +
      "{:bulb:} A square picture with a transparent background (a PNG sent as a File) looks best.",
    reset: "↩️ Use the original picture",
    working: "{:wait:} Setting the icon…",
    emojiSaved: (token) =>
      `{:ok:} New icon set: {:${token}:}\n\n` +
      "Your menu is updated now. Everyone else sees it the next time their menu opens (/start).\n" +
      "Tap 🛡️ Admin to keep editing.",
    emojiReset: (token) => `{:ok:} Back to the original picture: {:${token}:}`,
    emojiFailed: (why) => `{:fail:} Couldn't set that icon: ${why}`,
    unknownToken: (name) => `{:fail:} There's no icon called "${name}". Type /setemoji to see the list.`,
    qrHint: "Pick a bank, then send its KHQR picture.",
    setQr: (bank) => `💳 Set ${bank} QR`,
    dropQr: (bank) => `🗑 Remove ${bank} QR`,
    askQr: (bank) =>
      `💳 Send ${bank}'s KHQR picture now (a clear, uncropped screenshot).\n\n` +
      "{:bulb:} It has to be a QR created {b}with an amount{/b} (any amount, e.g. $1) — the bot swaps in each order's own amount.",
    commands:
      "{:admin:} {b}Admin commands{/b}\n\n" +
      "{b}General{/b}\n" +
      "/admin — open the Admin section\n" +
      "/stats — users and downloads\n" +
      "/broadcast <message> — message every user\n\n" +
      "{b}Emoji{/b}\n" +
      "/setemoji — pick an icon to change\n" +
      "picture + caption /setemoji <name> — change an icon by name\n" +
      "/makeemoji — rebuild the emoji pack\n\n" +
      "{b}Payments{/b}\n" +
      "/qrstatus — both QRs\n" +
      "/setqr · /setqr2 — set bank 1 · 2 QR (picture + caption)\n" +
      "/setqr2 off — remove bank 2\n" +
      "/invactivate <ticket> — activate KH Invoice by hand\n\n" +
      "{b}Shows{/b}\n" +
      "/shows — every show\n" +
      "/watchgroup <group> — scan a group\n" +
      "/setshow · /setgroup — set a show · group\n\n" +
      "{b}Other{/b}\n" +
      "/setstorage — video storage channel\n" +
      "/setbotpic — the bot's profile picture\n" +
      "/dlspeed — download speed test",
  },
};

const textsFor = (user) => TEXT[user?.language] ?? TEXT.km;
const iconLabel = (token, user) => {
  const row = ICONS.find(([t]) => t === token);
  return row ? (user?.language === "en" ? row[2] : row[1]) : token;
};

// The picture the last button asked for. In memory on purpose, like the
// other sections' wait states: a restart just means tapping the button again.
const pending = new Map(); // chatId -> { at, kind: "emoji", token } | { at, kind: "qr", slot }
const PENDING_MS = 10 * 60_000;

export function cancel(chatId) {
  pending.delete(String(chatId));
}

function pendingFor(chatId) {
  const job = pending.get(String(chatId));
  if (!job) return null;
  if (Date.now() - job.at > PENDING_MS) {
    pending.delete(String(chatId));
    return null;
  }
  return job;
}

/** Edits the panel in place when there's one to edit, so moving between screens doesn't stack messages. */
async function render(chatId, messageId, text, inlineKeyboard) {
  const reply_markup = { inline_keyboard: inlineKeyboard };
  if (messageId) {
    const edited = await call("editMessageText", { chat_id: chatId, message_id: messageId, text, reply_markup });
    if (edited?.ok) return edited;
  }
  return call("sendMessage", { chat_id: chatId, text, reply_markup });
}

const backTo = (t, where = "home") => [{ text: t.back, callback_data: `adm:${where}` }];

/** The Admin section's home screen. False outside the operator's chat. */
export async function show(chatId, user, messageId = null) {
  if (!botPay.isAdminChat(chatId)) return false;
  cancel(chatId);
  const t = textsFor(user);
  return render(chatId, messageId, t.home, [
    [
      { text: t.btnEmoji, callback_data: "adm:emoji" },
      { text: t.btnQr, callback_data: "adm:qr" },
    ],
    [
      { text: t.btnStats, callback_data: "adm:stats" },
      { text: t.btnPack, callback_data: "adm:pack" },
    ],
    [{ text: t.btnCmds, callback_data: "adm:cmds" }],
  ]);
}

async function emojiScreen(chatId, user, messageId) {
  cancel(chatId);
  const t = textsFor(user);
  const custom = new Set(await customEmojiTokens());
  // `emoji` puts each icon's current picture on its own button.
  const buttons = ICONS.map(([token]) => ({
    text: `${EMOJI[token][1]} ${iconLabel(token, user)}${custom.has(token) ? " ✏️" : ""}`,
    emoji: token,
    callback_data: `adm:emo:${token}`,
  }));
  const rows = [];
  for (let i = 0; i < buttons.length; i += 2) rows.push(buttons.slice(i, i + 2));
  rows.push(backTo(t));
  return render(chatId, messageId, t.emojiList, rows);
}

async function emojiAsk(chatId, user, token, messageId) {
  const t = textsFor(user);
  if (!EMOJI[token]) return call("sendMessage", { chat_id: chatId, text: t.unknownToken(token) });
  pending.set(String(chatId), { at: Date.now(), kind: "emoji", token });
  const hasCustom = (await customEmojiTokens()).includes(token);
  return render(chatId, messageId, t.askPhoto(token, iconLabel(token, user)), [
    ...(hasCustom ? [[{ text: t.reset, callback_data: `adm:emoreset:${token}` }]] : []),
    backTo(t, "emoji"),
  ]);
}

async function qrScreen(chatId, user, messageId) {
  cancel(chatId);
  const t = textsFor(user);
  const { primary_label: bank1, alt_label: bank2, alt_template: hasBank2 } = await paymentSettings();
  const text = `${await botPay.qrStatusText({ withCommands: false })}\n\n${t.qrHint}`;
  return render(chatId, messageId, text, [
    [{ text: t.setQr(bank1), callback_data: "adm:qr1" }],
    [{ text: t.setQr(bank2), callback_data: "adm:qr2" }],
    ...(hasBank2 ? [[{ text: t.dropQr(bank2), callback_data: "adm:qr2off" }]] : []),
    backTo(t),
  ]);
}

async function qrAsk(chatId, user, slot, messageId) {
  const t = textsFor(user);
  const { primary_label: bank1, alt_label: bank2 } = await paymentSettings();
  pending.set(String(chatId), { at: Date.now(), kind: "qr", slot });
  return render(chatId, messageId, t.askQr(slot === "alt" ? bank2 : bank1), [backTo(t, "qr")]);
}

/** Text from the operator: /setemoji alone (the picker) or /setemoji <name>. Returns true when handled. */
export async function handleText(chatId, user, text) {
  if (!botPay.isAdminChat(chatId)) return false;
  const named = /^\/setemoji(?:\s+(\S+))?$/i.exec(text);
  if (!named) return false;
  if (named[1]) await emojiAsk(chatId, user, named[1].toLowerCase(), null);
  else await emojiScreen(chatId, user, null);
  return true;
}

/**
 * A picture from the operator: one captioned /setemoji <name>, or the one
 * the last Admin button asked for (an icon, or a bank's QR). A picture
 * captioned with any other command (/setqr, /setshow) is left for its own
 * handler, even mid-wait. Returns true when handled.
 */
export async function handleMedia(message, user) {
  const chatId = message?.chat?.id;
  if (!botPay.isAdminChat(chatId)) return false;
  const isImageFile = String(message.document?.mime_type ?? "").startsWith("image/");
  const file = message.photo?.[message.photo.length - 1] ?? (isImageFile ? message.document : null);
  if (!file) return false;

  const t = textsFor(user);
  const caption = String(message.caption ?? "").trim();
  const named = /^\/setemoji(?:\s+(\S+))?/i.exec(caption);
  if (caption.startsWith("/") && !named) return false;

  const job = named?.[1] ? { kind: "emoji", token: named[1].toLowerCase() } : pendingFor(chatId);
  if (!job) {
    if (!named) return false;
    await emojiScreen(chatId, user, null); // "/setemoji" with no name: show what the names are
    return true;
  }
  cancel(chatId);

  if (job.kind === "qr") {
    await botPay.saveQrFromPhoto(chatId, file.file_id, job.slot);
    return true;
  }
  if (!EMOJI[job.token]) {
    await call("sendMessage", { chat_id: chatId, text: t.unknownToken(job.token) });
    return true;
  }
  await call("sendMessage", { chat_id: chatId, text: t.working });
  try {
    await setCustomEmoji(job.token, await botPay.fetchTelegramFile(file.file_id));
    // Reply keyboards keep the icons they were sent with, so the operator's
    // own menu is re-sent to show the new one straight away.
    await call("sendMessage", {
      chat_id: chatId,
      text: t.emojiSaved(job.token),
      reply_markup: mainKeyboard(user?.language, chatId),
    });
  } catch (err) {
    await call("sendMessage", { chat_id: chatId, text: t.emojiFailed(String(err?.message ?? err).slice(0, 200)) });
  }
  return true;
}

/**
 * The Admin section's buttons (callback_data "adm:..."). `runAdminCommand`
 * runs one of the existing text commands (/stats, /makeemoji, ...) exactly
 * as if the operator had typed it, so each keeps a single implementation.
 */
export async function handleCallback(cq, user, runAdminCommand) {
  const chatId = cq.message?.chat?.id;
  const messageId = cq.message?.message_id;
  await call("answerCallbackQuery", { callback_query_id: cq.id });
  if (!botPay.isAdminChat(chatId)) return true;

  const t = textsFor(user);
  const [, action, arg] = String(cq.data ?? "").split(":");
  switch (action) {
    case "home":
      return show(chatId, user, messageId);
    case "emoji":
      return emojiScreen(chatId, user, messageId);
    case "emo":
      return emojiAsk(chatId, user, arg, messageId);
    case "emoreset": {
      cancel(chatId);
      if (await resetCustomEmoji(arg)) {
        await call("sendMessage", { chat_id: chatId, text: t.emojiReset(arg), reply_markup: mainKeyboard(user?.language, chatId) });
      }
      return emojiScreen(chatId, user, messageId);
    }
    case "qr":
      return qrScreen(chatId, user, messageId);
    case "qr1":
      return qrAsk(chatId, user, "primary", messageId);
    case "qr2":
      return qrAsk(chatId, user, "alt", messageId);
    case "qr2off":
      await runAdminCommand("/setqr2 off");
      return qrScreen(chatId, user, messageId);
    case "stats":
      return runAdminCommand("/stats");
    case "pack":
      return runAdminCommand("/makeemoji");
    case "cmds":
      return render(chatId, messageId, t.commands, [backTo(t)]);
    default:
      return true;
  }
}
