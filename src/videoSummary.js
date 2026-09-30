/**
 * AI video summary: tap "📝 សង្ខេបវីដេអូ (AI)", send a video link, get its
 * captions summarized. Reads the source's own captions -- or, when a site
 * only has auto-generated ones (most YouTube videos), those -- without
 * downloading the video itself, so this costs one small subtitle fetch, not
 * a full download job.
 *
 * Uses the same NVIDIA key, model, and daily caps as aiReply.js -- off
 * unless NVIDIA_API_KEY is set. Most sites SaveIt KH downloads from
 * (Facebook, TikTok, Instagram) don't expose captions at all, so this only
 * really works for YouTube; that's stated up front rather than discovered
 * as a silent failure.
 */
import { call } from "./notifyBot.js";
import { config } from "./config.js";
import * as aiReply from "./aiReply.js";
import * as ytdlp from "./ytdlp.js";

const TEXT = {
  km: {
    ask:
      "{:m_summary:} សង្ខេបវីដេអូ (AI)\n\n" +
      "ផ្ញើតំណវីដេអូ YouTube មកខ្ញុំ -- ខ្ញុំនឹងអានពី caption របស់វា ហើយសង្ខេបជូន។\n" +
      "{:bulb:} ដំណើរការល្អបំផុតជាមួយ YouTube ដែលមាន caption/subtitle ។ គេហទំព័រផ្សេងទៀត (Facebook, TikTok, Instagram) ជាទូទៅគ្មាន caption ទេ។",
    off: "{:fail:} មុខងារនេះមិនទាន់បើកនៅឡើយទេ។",
    notAUrl: "{:fail:} សូមផ្ញើជាតំណវីដេអូ (URL) មួយ។",
    fetching: "{:wait:} កំពុងទាញ caption របស់វីដេអូ…",
    noCaptions: "{:fail:} វីដេអូនេះគ្មាន caption ទេ (ឬគេហទំព័រនេះមិនគាំទ្រ) ។ សាកល្បងជាមួយ YouTube វិញមើល។",
    summarizing: "{:wait:} កំពុងសង្ខេប…",
    failed: "{:fail:} សង្ខេបមិនបានទេ សូមសាកម្ដងទៀត។",
  },
  en: {
    ask:
      "{:m_summary:} Summarize a Video (AI)\n\n" +
      "Send me a YouTube video link -- I'll read its captions and summarize it.\n" +
      "{:bulb:} Works best with YouTube videos that have captions/subtitles. Other sites (Facebook, TikTok, Instagram) usually don't expose any.",
    off: "{:fail:} This feature isn't turned on yet.",
    notAUrl: "{:fail:} Please send a video link (URL).",
    fetching: "{:wait:} Fetching the video's captions…",
    noCaptions: "{:fail:} This video has no captions (or this site isn't supported). Try a YouTube link instead.",
    summarizing: "{:wait:} Summarizing…",
    failed: "{:fail:} Couldn't summarize that. Please try again.",
  },
};

const URL_PATTERN = /https?:\/\/\S+/i;

// In-memory on purpose, like translate.js's own wait state: a restart just
// means the person taps the button again.
const waiting = new Map(); // chatId -> { at }
const WAIT_MS = 10 * 60_000;

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

/**
 * Handles a message while this chat is waiting for a video link. Returns
 * true when it handled it (whether or not a summary came back), so the
 * caller's own URL/download handling never runs on the same message.
 */
export async function handleText(chatId, user, text) {
  if (!isWaiting(chatId)) return false;
  waiting.delete(chatId);
  const t = TEXT[user.language] ?? TEXT.km;

  const url = URL_PATTERN.exec(String(text ?? ""))?.[0];
  if (!url) {
    await call("sendMessage", { chat_id: chatId, text: t.notAUrl });
    return true;
  }

  await call("sendMessage", { chat_id: chatId, text: t.fetching });
  try {
    const transcript = await ytdlp.fetchAutoCaptions(url, user.language);
    if (!transcript) {
      await call("sendMessage", { chat_id: chatId, text: t.noCaptions });
      return true;
    }
    await call("sendMessage", { chat_id: chatId, text: t.summarizing });
    const summary = await aiReply.summarizeTranscript(user.telegram_user_id, transcript, user.language);
    await call("sendMessage", { chat_id: chatId, text: summary ?? t.failed });
  } catch (err) {
    console.error("Video summary failed:", err?.message ?? err);
    await call("sendMessage", { chat_id: chatId, text: t.failed });
  }
  return true;
}
