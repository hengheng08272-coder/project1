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
// A video transcript is much longer than a question, but still cut well
// short of the model's own context window -- a summary only needs the gist,
// not every word, and a shorter prompt is a cheaper, faster call against a
// quota this bot doesn't own.
const MAX_TRANSCRIPT_CHARS = 6_000;

const PER_USER_DAILY_LIMIT = 8;
const GLOBAL_DAILY_LIMIT = 300;

// Image generation costs far more compute per call than a chat or vision
// reply, and a free/shared key's image-model credits run out much faster
// than its chat ones -- so this gets its own, much smaller budget rather
// than sharing the text caps above.
const IMAGE_GEN_PER_USER_DAILY_LIMIT = 3;
const IMAGE_GEN_GLOBAL_DAILY_LIMIT = 30;

function today() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Builds an independent per-user + global daily cap, each with its own
 * counters -- in memory on purpose, like notifyBot.js's screen cache: a
 * restart only loosens the caps for a moment, never jams them shut, and
 * nothing here needs to survive a deploy.
 */
function makeDailyCap(perUserLimit, globalLimit) {
  const usage = new Map(); // telegram_user_id -> { day, count }
  let globalDay = "";
  let globalCount = 0;

  /** True if this call is still within both the per-user and global daily caps -- and counts it if so. */
  return function withinCap(userId) {
    const day = today();
    if (globalDay !== day) {
      globalDay = day;
      globalCount = 0;
    }
    if (globalCount >= globalLimit) return false;

    const entry = usage.get(userId);
    const count = entry?.day === day ? entry.count : 0;
    if (count >= perUserLimit) return false;

    usage.set(userId, { day, count: count + 1 });
    globalCount += 1;
    return true;
  };
}

const withinDailyCap = makeDailyCap(PER_USER_DAILY_LIMIT, GLOBAL_DAILY_LIMIT);
const withinImageGenDailyCap = makeDailyCap(IMAGE_GEN_PER_USER_DAILY_LIMIT, IMAGE_GEN_GLOBAL_DAILY_LIMIT);

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

const VISION_SYSTEM_PROMPT = {
  km:
    "អ្នកកំពុងមើលរូបភាពមួយសន្លឹកដែលអ្នកប្រើប្រាស់ផ្ញើមក Telegram bot ។ ឆ្លើយសំណួររបស់គេអំពីរូបភាពនេះឲ្យខ្លី ច្បាស់លាស់ ជាភាសាខ្មែរ ។ " +
    "បើគ្មានសំណួរច្បាស់លាស់ សូមពណ៌នារូបភាពនេះខ្លីៗ ។ បើមើលមិនច្បាស់ ឬមិនប្រាកដ សូមនិយាយត្រង់ៗ កុំស្មាន ។",
  en:
    "You are looking at a photo a user sent to a Telegram bot. Answer their question about the photo briefly and clearly in English. " +
    "If there's no specific question, briefly describe the photo. If something isn't clear or you're not sure, say so plainly instead of guessing.",
};

const DEFAULT_IMAGE_QUESTION = {
  km: "រូបភាពនេះជាអ្វី? សូមពណ៌នាខ្លីៗ។",
  en: "What is this photo? Please describe it briefly.",
};

const SUMMARY_SYSTEM_PROMPT = {
  km:
    "ខាងក្រោមជា caption ស្វ័យប្រវត្តិរបស់វីដេអូមួយ (អាចមានកំហុសខ្លះ ព្រោះជាកម្មវិធីស្គាល់សំឡេងស្វ័យប្រវត្តិ ហើយអាចជាភាសាអង់គ្លេស) ។ " +
    "សូមសង្ខេបខ្លឹមសារសំខាន់ៗខ្លីៗជាភាសាខ្មែរ ជាចំណុចៗ ។ បើអត្ថបទមិនច្បាស់ ឬខ្លីពេក សូមនិយាយត្រង់ៗថាសង្ខេបមិនបាន កុំស្មាន ។",
  en:
    "Below is a video's auto-generated captions (may have errors -- it's automatic speech recognition, and may be in English). " +
    "Summarize the key points briefly in English, as a short list. If the text is unclear or too short to summarize, say so plainly instead of guessing.",
};

/** POSTs one chat-completions call and returns the trimmed, length-capped reply, or null on any failure. Never throws. */
async function callChat(messages) {
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
        messages,
      }),
    });
    if (!res.ok) {
      console.error(`AI reply failed: HTTP ${res.status} ${await res.text().catch(() => "")}`.slice(0, 300));
      return null;
    }
    const data = await res.json();
    const reply = String(data?.choices?.[0]?.message?.content ?? "").trim();
    if (!reply) return null;
    return reply.length > MAX_REPLY_CHARS ? `${reply.slice(0, MAX_REPLY_CHARS)}…` : reply;
  } catch (err) {
    console.error("AI reply failed:", err?.message ?? err);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

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

  return callChat([
    { role: "system", content: SYSTEM_PROMPT[language] ?? SYSTEM_PROMPT.en },
    { role: "user", content: trimmed.slice(0, MAX_QUESTION_CHARS) },
  ]);
}

/**
 * Answers a question about a photo (image Q&A -- see imageQa.js), or returns
 * null under the same conditions as answerFaq, which it shares a daily cap
 * with: off, no key, cap reached, or the call failed. Never throws.
 *
 * `imageBuffer` must already be a JPEG under NVIDIA's ~180,000-character
 * inline base64 limit -- imageQa.js picks a small enough Telegram photo size
 * before calling this, so nothing here needs to resize or re-encode it.
 */
export async function answerImageQuestion(userId, imageBuffer, question, language) {
  if (!config.nvidiaApiKey) return null;
  if (!withinDailyCap(userId)) return null;

  const trimmed = String(question ?? "").trim();
  const prompt = trimmed ? trimmed.slice(0, MAX_QUESTION_CHARS) : DEFAULT_IMAGE_QUESTION[language] ?? DEFAULT_IMAGE_QUESTION.en;
  const dataUri = `data:image/jpeg;base64,${imageBuffer.toString("base64")}`;

  return callChat([
    { role: "system", content: VISION_SYSTEM_PROMPT[language] ?? VISION_SYSTEM_PROMPT.en },
    {
      role: "user",
      content: [
        { type: "text", text: prompt },
        { type: "image_url", image_url: { url: dataUri } },
      ],
    },
  ]);
}

/**
 * Summarizes a video's transcript (its own captions, or auto-generated ones
 * when that's all the site provides -- see videoSummary.js), or returns null
 * under the same conditions as answerFaq, which it shares a daily cap with:
 * off, no key, an empty/too-short transcript, cap reached, or the call
 * failed. Never throws.
 */
export async function summarizeTranscript(userId, transcript, language) {
  if (!config.nvidiaApiKey) return null;

  const trimmed = String(transcript ?? "").trim();
  // A few words of captions is rarely a real transcript worth summarizing.
  if (trimmed.length < 30) return null;
  if (!withinDailyCap(userId)) return null;

  return callChat([
    { role: "system", content: SUMMARY_SYSTEM_PROMPT[language] ?? SUMMARY_SYSTEM_PROMPT.en },
    { role: "user", content: trimmed.slice(0, MAX_TRANSCRIPT_CHARS) },
  ]);
}

// A separate NVIDIA "Visual GenAI" endpoint and calling convention from the
// OpenAI-style chat/completions one ENDPOINT above -- images generation
// NIMs (FLUX, Stable Diffusion, ...) are invoked per-model at their own
// path, and don't take a `messages` array.
const IMAGE_GEN_ENDPOINT_BASE = "https://ai.api.nvidia.com/v1/genai";
// Image generation is much slower than a chat or vision reply.
const IMAGE_GEN_TIMEOUT_MS = 60_000;

const AD_PROMPT_SYSTEM = {
  km:
    "អ្នកជា prompt engineer ជំនួយសម្រាប់ AI បង្កើតរូបភាព។ អ្នកប្រើប្រាស់សរសេរអធិប្បាយ (ជាភាសាខ្មែរ ឬអង់គ្លេស) នៃរូបភាពផ្សាយពាណិជ្ជកម្មដែលគេចង់បាន។ " +
    "សរសេរ prompt ជាភាសាអង់គ្លេសមួយ លម្អិត (subject, style, colors, lighting, composition) សម្រាប់ AI បង្កើតរូបភាព។ ចេញតែ prompt ភាសាអង់គ្លេសប៉ុណ្ណោះ កុំពន្យល់អ្វីបន្ថែម។",
  en:
    "You are a prompt-engineering assistant for an AI image generator. The user describes an ad image they want, in Khmer or English. " +
    "Write ONE detailed English text-to-image prompt (subject, style, colors, lighting, composition). Output ONLY that English prompt, nothing else.",
};

/** Turns a short, possibly-Khmer description into one detailed English image prompt -- the step that lets imageGen.js take a request in the user's own language. Returns null on any failure. */
async function expandAdPrompt(description, language) {
  return callChat([
    { role: "system", content: AD_PROMPT_SYSTEM[language] ?? AD_PROMPT_SYSTEM.en },
    { role: "user", content: description.slice(0, MAX_QUESTION_CHARS) },
  ]);
}

/** POSTs one image-generation call and returns the raw base64 image, or null on any failure. Never throws. */
async function requestGeneratedImage(prompt) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), IMAGE_GEN_TIMEOUT_MS);
  try {
    const res = await fetch(`${IMAGE_GEN_ENDPOINT_BASE}/${config.nvidiaImageModel}`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${config.nvidiaApiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      // flux.1-schnell is the fast, distilled FLUX variant -- a handful of
      // steps is its own intended range, not a shortcut taken here; the
      // higher-quality flux.1-dev instead wants ~50 and would need a
      // different NVIDIA_IMAGE_MODEL, not just a bigger `steps`.
      body: JSON.stringify({ prompt, mode: "base", seed: 0, steps: 4 }),
    });
    if (!res.ok) {
      console.error(`AI image generation failed: HTTP ${res.status} ${await res.text().catch(() => "")}`.slice(0, 300));
      return null;
    }
    const data = await res.json();
    // Exact response shape isn't the same across every NVIDIA Visual GenAI
    // model -- these are the shapes seen across FLUX/Stable-Diffusion NIMs.
    const base64 = data?.artifacts?.[0]?.base64 ?? data?.image ?? data?.data?.[0]?.b64_json ?? null;
    return base64 || null;
  } catch (err) {
    console.error("AI image generation failed:", err?.message ?? err);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Generates an ad image from a short description (Khmer or English) -- see
 * imageGen.js. Two calls happen here: the text model turns the description
 * into a detailed English prompt, then the image model renders it. Returns
 * `{ imageBase64, prompt }`, or null when the feature is off, the
 * description was skipped, either call failed, or the (much stricter, see
 * IMAGE_GEN_PER_USER_DAILY_LIMIT) daily cap was reached. Never throws.
 */
export async function generateAdImage(userId, description, language) {
  if (!config.nvidiaApiKey) return null;

  const trimmed = String(description ?? "").trim();
  if (trimmed.length < 4) return null;
  if (!withinImageGenDailyCap(userId)) return null;

  const prompt = await expandAdPrompt(trimmed, language);
  if (!prompt) return null;
  const imageBase64 = await requestGeneratedImage(prompt);
  if (!imageBase64) return null;
  return { imageBase64, prompt };
}
