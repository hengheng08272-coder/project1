/**
 * AI ad image generator: tap "🎨 បង្កើតរូបភាព Ads (AI)", describe what you
 * want (Khmer is fine), get a generated image back. aiReply.js first turns
 * the description into a detailed English prompt -- diffusion models
 * respond far better to a rich English prompt than a short Khmer one, so
 * this is the step that makes "just describe it in Khmer" actually work --
 * then renders that prompt with NVIDIA's FLUX image model.
 *
 * Off unless NVIDIA_API_KEY is set, same switch as the rest of aiReply.js's
 * features, but with its own, much smaller daily cap: image generation
 * costs far more of a shared/free key's quota per call than a chat or
 * vision reply does.
 *
 * Current AI image models still aren't reliable at rendering exact text or
 * a specific logo -- that's said up front in the ask() prompt so a blurry
 * word in the result isn't mistaken for a bug.
 */
import { call } from "./notifyBot.js";
import { config } from "./config.js";
import * as aiReply from "./aiReply.js";

const TEXT = {
  km: {
    ask:
      "{:m_ad:} បង្កើតរូបភាព Ads (AI)\n\n" +
      "សរសេរអធិប្បាយរូបភាពដែលចង់បាន (ជាភាសាខ្មែរក៏បាន) ខ្ញុំនឹងបង្កើតជូន។\n" +
      "{:bulb:} AI នៅតែមិនសូវពូកែសរសេរអក្សរ ឬឡូហ្គោច្បាស់ៗក្នុងរូបភាពនៅឡើយទេ សមស្របសម្រាប់គំនិត/background ជាដំបូង មិនមែនរូបផ្សាយពាណិជ្ជកម្មចុងក្រោយភ្លាមៗនោះទេ។",
    off: "{:fail:} មុខងារនេះមិនទាន់បើកនៅឡើយទេ។",
    generating: "{:wait:} កំពុងបង្កើតរូបភាព… (អាចចំណាយពេលបន្តិច)",
    failed: "{:fail:} បង្កើតរូបភាពនេះមិនបានទេ សូមសាកម្ដងទៀត ឬសាកល្បងអធិប្បាយផ្សេង។",
  },
  en: {
    ask:
      "{:m_ad:} Generate an Ad Image (AI)\n\n" +
      "Describe the image you want -- Khmer is fine -- and I'll generate it.\n" +
      "{:bulb:} AI image models still aren't reliable at rendering exact text or a specific logo, so treat this as a first concept/background, not a finished ad.",
    off: "{:fail:} This feature isn't turned on yet.",
    generating: "{:wait:} Generating your image… (this can take a little while)",
    failed: "{:fail:} Couldn't generate that. Please try again, or describe it differently.",
  },
};

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

/** Uploads a generated image straight from its base64 bytes -- bypasses notifyBot.call() (JSON-only) since Telegram wants this one as multipart/form-data. */
async function sendGeneratedPhoto(chatId, base64, caption) {
  const buffer = Buffer.from(base64, "base64");
  const form = new FormData();
  form.set("chat_id", String(chatId));
  if (caption) form.set("caption", caption.slice(0, 1024));
  form.set("photo", new Blob([buffer], { type: "image/jpeg" }), "ad.jpg");
  const res = await fetch(`https://api.telegram.org/bot${config.telegramLoginBotToken}/sendPhoto`, {
    method: "POST",
    body: form,
  });
  const data = await res.json().catch(() => ({}));
  if (!data.ok) console.error("Telegram sendPhoto (generated image) failed:", JSON.stringify(data));
  return data.ok === true;
}

/**
 * Handles a message while this chat is waiting for an image description.
 * Returns true when it handled it (whether or not an image came back).
 */
export async function handleText(chatId, user, text) {
  if (!isWaiting(chatId)) return false;
  waiting.delete(chatId);
  const t = TEXT[user.language] ?? TEXT.km;

  await call("sendMessage", { chat_id: chatId, text: t.generating });
  try {
    const result = await aiReply.generateAdImage(user.telegram_user_id, text, user.language);
    if (!result) {
      await call("sendMessage", { chat_id: chatId, text: t.failed });
      return true;
    }
    const sent = await sendGeneratedPhoto(chatId, result.imageBase64, result.prompt.slice(0, 1000));
    if (!sent) await call("sendMessage", { chat_id: chatId, text: t.failed });
  } catch (err) {
    console.error("Ad image generation failed:", err?.message ?? err);
    await call("sendMessage", { chat_id: chatId, text: t.failed });
  }
  return true;
}
