/**
 * Optional AI FAQ reply: when a message to the bot is plain text that isn't
 * a link, a command, or a known menu button, this tries one LLM call before
 * falling back to "that's not a link" -- so a real question about the bot
 * gets a real answer instead of a canned error.
 *
 * Entirely off unless NVIDIA_API_KEY is set (see config.js). That matters
 * because a key like this is often a free/shared one (a school's trial
 * allotment handed to a class, say) rather than the operator's own paid
 * account: it can be revoked, run dry, or get rate-limited with no notice,
 * and every call here is wrapped so none of that ever reaches the person
 * asking -- they just silently get the ordinary fallback message instead.
 *
 * The daily caps below exist for the same reason, from the other direction:
 * a bot with real traffic can burn through a free/shared quota in minutes,
 * which both breaks it for every other student it was handed to and reads
 * to the provider as abuse of a trial meant for individual experiments, not
 * a production service. Keeping this bot's calls modest is the difference
 * between "a student trying the API" and "the reason the class lost access".
 */
import { config } from "./config.js";

const ENDPOINT = "https://integrate.api.nvidia.com/v1/chat/completions";
const TIMEOUT_MS = 15_000;
// Telegram's own text limit is 4096 UTF-16 units; a FAQ answer has no
// business being anywhere near that, and a short reply is also a cheaper,
// faster one against a quota this bot doesn't own.
const MAX_REPLY_CHARS = 900;
const MAX_QUESTION_CHARS = 500;

const PER_USER_DAILY_LIMIT = 8;
const GLOBAL_DAILY_LIMIT = 300;

// In-memory on purpose, like notifyBot.js's screen cache: resets on a
// restart, which only means the caps loosen for a moment, never that they
// jam shut. Nothing here needs to survive a deploy.
const usage = new Map(); // telegram_user_id -> { day, count }
let globalDay = "";
let globalCount = 0;

function today() {
  return new Date().toISOString().slice(0, 10);
}

/** True if this call is still within both the per-user and global daily caps -- and counts it if so. */
function withinDailyCap(userId) {
  const day = today();
  if (globalDay !== day) {
    globalDay = day;
    globalCount = 0;
  }
  if (globalCount >= GLOBAL_DAILY_LIMIT) return false;

  const entry = usage.get(userId);
  const count = entry?.day === day ? entry.count : 0;
  if (count >= PER_USER_DAILY_LIMIT) return false;

  usage.set(userId, { day, count: count + 1 });
  globalCount += 1;
  return true;
}

const SYSTEM_PROMPT = {
  km:
    "អ្នកជា assistant ជំនួយសម្រាប់ SaveIt KH ដែលជា Telegram bot ទាញយកវីដេអូ/បទចម្រៀងពី YouTube, Facebook, TikTok, Instagram, X និង Telegram ។ " +
    "SaveIt Free ឥតគិតថ្លៃ មិនកំណត់ ។ SaveIt Pro សម្រាប់ក្រុម/channel ឯកជននៅ Telegram ប្រើ Credit ។ " +
    "Bot ក៏មាន Translate, Khmer-dubbed Shows, និង KH Invoice (កម្មវិធីគ្រប់គ្រងវិក្កយបត្រ) ។ " +
    "ឆ្លើយខ្លីៗ ច្បាស់លាស់ ជាភាសាខ្មែរ ។ បើសំណួរមិនទាក់ទងនឹង bot នេះទេ ឬអ្នកមិនដឹងចម្លើយច្បាស់លាស់ សូមនិយាយត្រង់ៗថាមិនដឹង ហើយណែនាំឲ្យទាក់ទងអ្នកគ្រប់គ្រង ជំនួសការស្មានចម្លើយ ។",
  en:
    "You are a help assistant for SaveIt KH, a Telegram bot that downloads videos/songs from YouTube, Facebook, TikTok, Instagram, X and Telegram. " +
    "SaveIt Free is free and unlimited. SaveIt Pro is for private Telegram groups/channels and uses Credit. " +
    "The bot also has Translate, Khmer-dubbed Shows, and KH Invoice (an invoicing tool). " +
    "Answer briefly and clearly in English. If the question isn't about this bot, or you're not sure of the answer, say so plainly and suggest contacting the operator instead of guessing.",
};

/**
 * Answers a free-form question about the bot, or returns null when the
 * feature is off, the question was skipped, the call failed, or the daily
 * cap was reached -- every case the caller treats the same way: fall back
 * to the ordinary "not a link" message. Never throws.
 */
export async function answerFaq(userId, question, language) {
  if (!config.nvidiaApiKey) return null;

  const trimmed = String(question ?? "").trim();
  // A bare word or two ("hi", "ok") is rarely an actual question, and not
  // worth spending a shared quota's call on.
  if (trimmed.length < 4) return null;
  if (!withinDailyCap(userId)) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${config.nvidiaApiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        model: config.nvidiaApiModel,
        stream: false,
        temperature: 0.4,
        max_tokens: 400,
        messages: [
          { role: "system", content: SYSTEM_PROMPT[language] ?? SYSTEM_PROMPT.en },
          { role: "user", content: trimmed.slice(0, MAX_QUESTION_CHARS) },
        ],
      }),
    });
    if (!res.ok) {
      console.error(`AI FAQ reply failed: HTTP ${res.status} ${await res.text().catch(() => "")}`.slice(0, 300));
      return null;
    }
    const data = await res.json();
    const reply = String(data?.choices?.[0]?.message?.content ?? "").trim();
    if (!reply) return null;
    return reply.length > MAX_REPLY_CHARS ? `${reply.slice(0, MAX_REPLY_CHARS)}…` : reply;
  } catch (err) {
    console.error("AI FAQ reply failed:", err?.message ?? err);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
