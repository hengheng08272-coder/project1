/**
 * Text translation: tap "🌐 Translate", send a message, get it back in the
 * other language. Uses Google's public translate endpoint (the same one
 * translate.google.com's own web page calls) -- free, no API key, no
 * billing account to set up, unlike the official Cloud Translation API.
 *
 * Defaults to auto Khmer <-> English, but the inline keyboard under the
 * prompt (and under every translated result, so switching mid-conversation
 * never needs a trip back to the menu) lets someone pin a specific target
 * language instead -- useful for a group that isn't just Khmer/English.
 */
import { call } from "./notifyBot.js";

const LANG_NAMES = { km: "🇰🇭 ខ្មែរ", en: "🇬🇧 English", zh: "🇨🇳 中文", th: "🇹🇭 ไทย", vi: "🇻🇳 Tiếng Việt" };

const TEXT = {
  km: {
    ask:
      "{:m_language:} បកប្រែភាសា\n\n" +
      "ជ្រើសរើសភាសាខាងក្រោម (ឬទុកស្វ័យប្រវត្តិ) រួចផ្ញើអត្ថបទមកខ្ញុំ។",
    working: "{:wait:} កំពុងបកប្រែ…",
    failed: "{:fail:} បកប្រែមិនបានទេ សូមសាកម្ដងទៀត។",
    inlineHint:
      "\n\n{:bulb:} ថ្មី! បកប្រែក្នុង chat ណាក៏បាន — វាយ {bot} រួចអត្ថបទ ក្នុងប្រអប់សារ ហើយចុចលទ្ធផលដើម្បីផ្ញើ។",
    inlineButton: "🌐 បកប្រែក្នុង chat ផ្សេង",
    autoLabel: "🔄 ស្វ័យប្រវត្តិ (ខ្មែរ⇄English)",
    // Plain text only -- this goes into answerCallbackQuery's toast, which
    // can't render {:token:} custom emoji the way a sent message can.
    langSet: (name) => `🌐 ភាសាដែលនឹងបកប្រែទៅ៖ ${name}`,
  },
  en: {
    ask:
      "{:m_language:} Translate\n\n" +
      "Pick a language below (or leave it on auto), then send me the text.",
    working: "{:wait:} Translating…",
    failed: "{:fail:} Couldn't translate that. Please try again.",
    inlineHint:
      "\n\n{:bulb:} New! Translate in any chat — type {bot} followed by your text in the message box, then tap a result to send it.",
    inlineButton: "🌐 Translate in another chat",
    autoLabel: "🔄 Auto (Khmer⇄English)",
    // Plain text only -- this goes into answerCallbackQuery's toast, which
    // can't render {:token:} custom emoji the way a sent message can.
    langSet: (name) => `🌐 Now translating to: ${name}`,
  },
};

// Waiting for the text to translate: `targetLang` is null for the default
// auto Khmer<->English behavior, or one of LANG_NAMES' keys once picked from
// the keyboard. In memory on purpose: a restart just means the person taps
// the button (or a language) again.
const waiting = new Map(); // chatId -> { at, targetLang }
const WAIT_MS = 10 * 60_000;

let botName = null;
async function botUsername() {
  if (!botName) botName = (await call("getMe", {}))?.result?.username ?? null;
  return botName;
}

/** The target-language picker, reused under both the initial prompt and every translated result so switching languages never needs the main menu. */
function languageKeyboard(language) {
  const t = TEXT[language] ?? TEXT.km;
  return {
    inline_keyboard: [
      [{ text: t.autoLabel, callback_data: "tr:auto" }],
      [
        { text: LANG_NAMES.km, callback_data: "tr:km" },
        { text: LANG_NAMES.en, callback_data: "tr:en" },
      ],
      [
        { text: LANG_NAMES.zh, callback_data: "tr:zh" },
        { text: LANG_NAMES.th, callback_data: "tr:th" },
        { text: LANG_NAMES.vi, callback_data: "tr:vi" },
      ],
      [{ text: t.inlineButton, style: "primary", switch_inline_query: "" }],
    ],
  };
}

export async function ask(chatId, user) {
  waiting.set(chatId, { at: Date.now(), targetLang: null });
  const t = TEXT[user.language] ?? TEXT.km;
  const name = await botUsername().catch(() => null);
  return call("sendMessage", {
    chat_id: chatId,
    text: t.ask + t.inlineHint.replace("{bot}", name ? `@${name}` : "@bot"),
    reply_markup: languageKeyboard(user.language),
  });
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

/**
 * A tap on the language picker (under the prompt or a past result). Sticks
 * around (not one-shot) so the same choice covers every message sent until
 * changed again, the flow is cancelled, or the 10-minute idle window lapses.
 * Returns true when it handled the tap.
 */
export async function handleCallback(cq, user) {
  const chatId = cq.message?.chat?.id;
  if (!chatId) return false;
  const [, target] = String(cq.data ?? "").split(":");
  const targetLang = target === "auto" ? null : target;
  const t = TEXT[user.language] ?? TEXT.km;
  waiting.set(chatId, { at: Date.now(), targetLang });
  await call("answerCallbackQuery", {
    callback_query_id: cq.id,
    text: t.langSet(targetLang ? LANG_NAMES[targetLang] ?? targetLang : t.autoLabel),
  });
  return true;
}

/**
 * Calls Google's public translate endpoint, auto-detecting the source
 * language. Returns the translated text and the language Google detected.
 */
export async function translateText(text, targetLang) {
  const url =
    "https://translate.googleapis.com/translate_a/single" +
    `?client=gtx&sl=auto&tl=${encodeURIComponent(targetLang)}&dt=t&q=${encodeURIComponent(text)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Google Translate returned ${res.status}`);
  const data = await res.json();
  const translated = (data?.[0] ?? []).map((chunk) => chunk[0]).join("");
  const detected = data?.[2] ?? null;
  return { translated, detected };
}

/**
 * Inline mode: "@bot some text" typed in any chat. Offers the text in Khmer
 * and English (minus whichever it already is), plus Chinese / Thai /
 * Vietnamese; tapping one sends the translation into that chat. Needs inline
 * mode switched on once in BotFather (/setinline).
 */
export async function handleInlineQuery(iq) {
  const text = String(iq?.query ?? "").trim();
  if (text.length < 2) {
    return call("answerInlineQuery", { inline_query_id: iq.id, results: [], cache_time: 5 });
  }
  const targets = ["km", "en", "zh", "th", "vi"];
  const settled = await Promise.allSettled(targets.map((lang) => translateText(text, lang)));
  const detected = settled.find((s) => s.status === "fulfilled")?.value.detected;
  const results = [];
  settled.forEach((s, i) => {
    const lang = targets[i];
    if (s.status !== "fulfilled" || !s.value.translated || lang === detected) return;
    results.push({
      type: "article",
      id: `${lang}-${iq.id}`.slice(0, 64),
      title: LANG_NAMES[lang],
      description: s.value.translated.slice(0, 200),
      input_message_content: { message_text: s.value.translated },
    });
  });
  return call("answerInlineQuery", { inline_query_id: iq.id, results, cache_time: 300, is_personal: false });
}

/**
 * A message while waiting for text to translate. With no language pinned,
 * Khmer goes to English and anything else detected goes to Khmer; with one
 * picked from the keyboard, every message goes straight to it. Stays open
 * (not one-shot) so several messages in a row all use the same choice, and
 * the result carries the same keyboard in case the next one should go
 * somewhere else. Returns true when it handled it.
 */
export async function handleText(chatId, user, text) {
  if (!isWaiting(chatId)) return false;
  const current = waiting.get(chatId);
  waiting.set(chatId, { ...current, at: Date.now() }); // keep the session open
  const t = TEXT[user.language] ?? TEXT.km;
  await call("sendMessage", { chat_id: chatId, text: t.working });
  try {
    let result;
    if (current.targetLang) {
      result = await translateText(text, current.targetLang);
    } else {
      const toKm = await translateText(text, "km");
      result = toKm.detected === "km" ? await translateText(text, "en") : toKm;
    }
    await call("sendMessage", {
      chat_id: chatId,
      text: result.translated || t.failed,
      reply_markup: languageKeyboard(user.language),
    });
  } catch (err) {
    console.error("Translate failed:", err?.message ?? err);
    await call("sendMessage", { chat_id: chatId, text: t.failed });
  }
  return true;
}
