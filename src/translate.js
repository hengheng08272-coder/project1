/**
 * Text translation: tap "🌐 Translate", send a message, get it back in the
 * other language. Uses Google's public translate endpoint (the same one
 * translate.google.com's own web page calls) -- free, no API key, no
 * billing account to set up, unlike the official Cloud Translation API.
 */
import { call } from "./notifyBot.js";

const TEXT = {
  km: {
    ask:
      "{:m_language:} បកប្រែភាសា\n\n" +
      "ផ្ញើអត្ថបទដែលចង់បកប្រែមកខ្ញុំ — ខ្ញុំនឹងស្គាល់ភាសា ហើយបកអោយភ្លាម (ខ្មែរ ⇄ អង់គ្លេស ស្វ័យប្រវត្តិ)។",
    working: "{:wait:} កំពុងបកប្រែ…",
    failed: "{:fail:} បកប្រែមិនបានទេ សូមសាកម្ដងទៀត។",
  },
  en: {
    ask:
      "{:m_language:} Translate\n\n" +
      "Send me the text you want translated — I'll detect the language and translate it automatically (Khmer ⇄ English).",
    working: "{:wait:} Translating…",
    failed: "{:fail:} Couldn't translate that. Please try again.",
  },
};

// Waiting for the text to translate. In memory on purpose: a restart just
// means the person taps the button again.
const waiting = new Map();
const WAIT_MS = 10 * 60_000;

export function ask(chatId, user) {
  waiting.set(chatId, { at: Date.now() });
  return call("sendMessage", { chat_id: chatId, text: (TEXT[user.language] ?? TEXT.km).ask });
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
 * A message while waiting for text to translate. Khmer goes to English;
 * anything else detected goes to Khmer. Returns true when it handled it.
 */
export async function handleText(chatId, user, text) {
  if (!isWaiting(chatId)) return false;
  waiting.delete(chatId);
  const t = TEXT[user.language] ?? TEXT.km;
  await call("sendMessage", { chat_id: chatId, text: t.working });
  try {
    const toKm = await translateText(text, "km");
    const result = toKm.detected === "km" ? await translateText(text, "en") : toKm;
    await call("sendMessage", { chat_id: chatId, text: result.translated || t.failed });
  } catch (err) {
    console.error("Translate failed:", err?.message ?? err);
    await call("sendMessage", { chat_id: chatId, text: t.failed });
  }
  return true;
}
