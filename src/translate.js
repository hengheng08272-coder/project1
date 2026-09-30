/**
 * Text translation: tap "🌐 Translate", send a message, get it back in the
 * other language. Uses Google's public translate endpoint (the same one
 * translate.google.com's own web page calls) -- free, no API key, no
 * billing account to set up, unlike the official Cloud Translation API.
 *
 * Defaults to auto Khmer <-> English; the language picker under the prompt
 * pins a specific target instead. The picker shows once, when the flow
 * starts from the menu -- repeating it under every result buried the actual
 * translations. Each result carries only a "listen" button, which speaks it
 * through Google's matching TTS endpoint (Khmer included).
 */
import { call } from "./notifyBot.js";
import { config } from "./config.js";

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
    listen: "🔊 ស្ដាប់",
    // Plain text only -- these go into answerCallbackQuery's toast, which
    // can't render {:token:} custom emoji the way a sent message can.
    langSet: (name) => `🌐 ភាសាដែលនឹងបកប្រែទៅ៖ ${name}`,
    speaking: "🔊 កំពុងរៀបចំសំឡេង…",
    speakFailed: "អានជាសំឡេងមិនបានទេ សូមសាកម្ដងទៀត។",
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
    listen: "🔊 Listen",
    // Plain text only -- these go into answerCallbackQuery's toast, which
    // can't render {:token:} custom emoji the way a sent message can.
    langSet: (name) => `🌐 Now translating to: ${name}`,
    speaking: "🔊 Preparing audio…",
    speakFailed: "Couldn't read that out loud. Please try again.",
  },
};

// Waiting for the text to translate: `targetLang` is null for the default
// auto Khmer<->English behavior, or one of LANG_NAMES' keys once picked from
// the keyboard. In memory on purpose: a restart just means the person taps
// the button (or a language) again.
const waiting = new Map(); // chatId -> { at, targetLang }
const WAIT_MS = 10 * 60_000;

// Backs the "listen" button: callback_data caps at 64 bytes, far too small to
// carry the text itself, so each result parks its text here under a short id.
const spoken = new Map(); // id -> { at, text, lang }
const SPOKEN_MS = 30 * 60_000;
let spokenSeq = 0;

/** Parks a result's text for the listen button and returns its callback id. */
function rememberSpoken(text, lang) {
  for (const [id, entry] of spoken) if (Date.now() - entry.at > SPOKEN_MS) spoken.delete(id);
  const id = (spokenSeq++).toString(36);
  spoken.set(id, { at: Date.now(), text, lang });
  return id;
}

let botName = null;
async function botUsername() {
  if (!botName) botName = (await call("getMe", {}))?.result?.username ?? null;
  return botName;
}

/** The target-language picker. Shown once under the prompt -- to switch later, tap "Translate" in the menu again. */
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

/** What rides under a finished translation: just the listen button, so the result itself stays the thing you read. */
function resultKeyboard(id, language) {
  const t = TEXT[language] ?? TEXT.km;
  return { inline_keyboard: [[{ text: t.listen, callback_data: `tr:say:${id}` }]] };
}

// Google's TTS endpoint takes roughly 200 characters a call and wants a
// browser User-Agent, so longer text goes up in pieces; the MP3 frames that
// come back play as one clip when joined end to end.
const TTS_CHUNK = 190;
const MAX_TTS_CHARS = 1000;
const TTS_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

function chunkForTts(text) {
  const chunks = [];
  let rest = text.trim();
  while (rest.length > TTS_CHUNK) {
    // Khmer runs words together, so a usable space often isn't there to find.
    let cut = rest.lastIndexOf(" ", TTS_CHUNK);
    if (cut < TTS_CHUNK / 2) cut = TTS_CHUNK;
    chunks.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) chunks.push(rest);
  return chunks.filter(Boolean);
}

/** Speaks `text` in `lang`, returning one MP3 buffer. */
async function ttsAudio(text, lang) {
  const parts = [];
  for (const chunk of chunkForTts(text)) {
    const url =
      "https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob" +
      `&tl=${encodeURIComponent(lang)}&q=${encodeURIComponent(chunk)}`;
    const res = await fetch(url, { headers: { "User-Agent": TTS_UA } });
    if (!res.ok) throw new Error(`Google TTS returned ${res.status}`);
    parts.push(Buffer.from(await res.arrayBuffer()));
  }
  return Buffer.concat(parts);
}

/** Uploads the spoken translation -- bypasses notifyBot.call() (JSON-only) since Telegram wants this one as multipart/form-data. */
async function sendVoice(chatId, mp3) {
  const form = new FormData();
  form.set("chat_id", String(chatId));
  form.set("voice", new Blob([mp3], { type: "audio/mpeg" }), "translation.mp3");
  const res = await fetch(`https://api.telegram.org/bot${config.telegramLoginBotToken}/sendVoice`, {
    method: "POST",
    body: form,
  });
  const data = await res.json().catch(() => ({}));
  if (!data.ok) console.error("Telegram sendVoice (translation) failed:", JSON.stringify(data));
  return data.ok === true;
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
 * A tap on the language picker, or on a result's listen button. A picked
 * language sticks around (not one-shot) so the same choice covers every
 * message sent until changed again, the flow is cancelled, or the 10-minute
 * idle window lapses. Returns true when it handled the tap.
 */
export async function handleCallback(cq, user) {
  const chatId = cq.message?.chat?.id;
  if (!chatId) return false;
  const t = TEXT[user.language] ?? TEXT.km;
  const [, target, spokenId] = String(cq.data ?? "").split(":");

  if (target === "say") {
    const entry = spoken.get(spokenId);
    // Gone means the bot restarted or the 30 minutes lapsed -- the text is
    // still right there on screen, so say so rather than guessing at it.
    if (!entry) {
      await call("answerCallbackQuery", { callback_query_id: cq.id, text: t.speakFailed });
      return true;
    }
    await call("answerCallbackQuery", { callback_query_id: cq.id, text: t.speaking });
    try {
      await sendVoice(chatId, await ttsAudio(entry.text, entry.lang));
    } catch (err) {
      console.error("Translate TTS failed:", err?.message ?? err);
      await call("sendMessage", { chat_id: chatId, text: t.speakFailed });
    }
    return true;
  }

  const targetLang = target === "auto" ? null : target;
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
  const query = `?client=gtx&sl=auto&tl=${encodeURIComponent(targetLang)}&dt=t&q=${encodeURIComponent(text)}`;
  let res = await fetch(`https://translate.googleapis.com/translate_a/single${query}`);
  // A 429 here is Google throttling Railway's shared outbound IP for a
  // moment, not anything about this request -- one short wait and a go at
  // the same service's other hostname usually gets through.
  if (res.status === 429) {
    await new Promise((resolve) => setTimeout(resolve, 1_200));
    res = await fetch(`https://translate.google.com/translate_a/single${query}`);
  }
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
 * (not one-shot) so several messages in a row all use the same choice.
 * Returns true when it handled it.
 */
export async function handleText(chatId, user, text) {
  if (!isWaiting(chatId)) return false;
  const current = waiting.get(chatId);
  waiting.set(chatId, { ...current, at: Date.now() }); // keep the session open
  const t = TEXT[user.language] ?? TEXT.km;
  await call("sendMessage", { chat_id: chatId, text: t.working });
  try {
    let result;
    let resultLang = current.targetLang;
    if (current.targetLang) {
      result = await translateText(text, current.targetLang);
    } else {
      const toKm = await translateText(text, "km");
      const toEnglish = toKm.detected === "km";
      result = toEnglish ? await translateText(text, "en") : toKm;
      resultLang = toEnglish ? "en" : "km";
    }
    // No listen button past the TTS ceiling: a clip stitched from that many
    // chunks is slow to build and nobody sits through it anyway.
    const speakable = result.translated && result.translated.length <= MAX_TTS_CHARS;
    await call("sendMessage", {
      chat_id: chatId,
      text: result.translated || t.failed,
      ...(speakable
        ? { reply_markup: resultKeyboard(rememberSpoken(result.translated, resultLang), user.language) }
        : {}),
    });
  } catch (err) {
    console.error("Translate failed:", err?.message ?? err);
    await call("sendMessage", { chat_id: chatId, text: t.failed });
  }
  return true;
}
