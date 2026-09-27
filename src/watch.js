/**
 * "🎬 មើលរឿង" (Watch) -- Anime / Donghua / Movie, sold one episode at a time
 * inside the bot.
 *
 * Reuses this backend's existing mirroring pieces instead of building a
 * second one: a `groups` row is a source Telegram group (the VIP group with
 * Topics, one per show), `topics` are its Telegram forum topics, and
 * `episodes` are the numbered video messages scanner.js already finds in
 * it -- the same tables and scanner the dashboard's Groups page uses. This
 * module only adds what that schema doesn't have yet: a show's genre,
 * poster, status and per-episode price, and who has bought which episode.
 * That extra bit is kept as JSON in Supabase Storage (bucket
 * "watch-catalog"), the same way botConfig.js keeps the bot's payment
 * settings -- the SaveIt database itself has no migration path open to this
 * service right now, so a new column isn't an option, but Storage always
 * has been.
 *
 * Delivery is exactly botDeliver.deliverEpisode's existing forward-copy (the
 * group never needs downloading to R2 first) unless the episode row already
 * has an r2_key from the dashboard's own pipeline, in which case that link
 * is sent instead -- so either source in the request works with no new
 * delivery code.
 *
 * Payment: a top-up buys Watch Credit, exactly like the bot's existing
 * "Add Credit" buys downloads (bot_packages rows, KHQR, botPay.grant) --
 * these just carry the "watch_" id prefix instead of none, and grant Watch
 * Credit instead of paid_downloads. One episode costs a show's own
 * ep_credits (default 1); the $1-for-4 tier prices that at $0.25 each, the
 * number asked for.
 */
import { mainKeyboard } from "./botText.js";
import { db, fetchAll, rows } from "./db.js";
import * as botDeliver from "./botDeliver.js";
import * as customEmoji from "./customEmoji.js";
import { call } from "./notifyBot.js";
import * as r2 from "./r2.js";
import { scanGroup } from "./scanner.js";
import { parseTelegramLink } from "./telegram.js";

const BUCKET = "watch-catalog";
const SHOWS_FILE = "shows.json";
const WALLET_FILE = "wallet.json";
const CACHE_MS = 20_000;

export const WATCH_PACKAGE_PREFIX = "watch_";
export const isWatchPackage = (id) => String(id ?? "").startsWith(WATCH_PACKAGE_PREFIX);

export const KINDS = ["anime", "donghua", "movie"];
const KIND_LABEL = {
  anime: { km: "🎌 Anime", en: "🎌 Anime" },
  donghua: { km: "🐉 Donghua", en: "🐉 Donghua" },
  movie: { km: "🎬 Movie", en: "🎬 Movie" },
};

const DEFAULT_PRICE_USD = 0.25;

const PACKAGES = [
  { id: "watch_1", title_km: "{:video:} 4 Ep — $1", title_en: "{:video:} 4 Ep — $1", price_usd: 1, downloads: 4, sort: 201 },
  { id: "watch_5", title_km: "{:video:} 22 Ep (+2 ឥតគិតថ្លៃ) — $5", title_en: "{:video:} 22 Ep (+2 free) — $5", price_usd: 5, downloads: 22, sort: 202 },
  { id: "watch_10", title_km: "{:video:} 46 Ep (+6 ឥតគិតថ្លៃ) — $10", title_en: "{:video:} 46 Ep (+6 free) — $10", price_usd: 10, downloads: 46, sort: 203 },
];

/** Upserts the top-up tiers, called once at startup like khInvoice.announce(). */
export async function announce() {
  await db()
    .from("bot_packages")
    .upsert(
      PACKAGES.map((p) => ({ ...p, days: null, active: true })),
      { onConflict: "id" }
    );
}

// ------------------------------------------------------------ storage JSON
// One small file per concern, cached briefly, written back in full on every
// change -- the exact pattern botConfig.js already uses for payments.json.

const cache = new Map();

async function readJson(file, fallback) {
  const hit = cache.get(file);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.data;
  let data = fallback;
  try {
    const { data: blob, error } = await db().storage.from(BUCKET).download(file);
    if (error || !blob) throw error ?? new Error("missing");
    data = { ...fallback, ...JSON.parse(await blob.text()) };
  } catch {
    data = fallback;
  }
  cache.set(file, { data, at: Date.now() });
  return data;
}

async function writeJson(file, data) {
  const storage = db().storage;
  const body = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  let { error } = await storage.from(BUCKET).upload(file, body, { upsert: true, contentType: "application/json" });
  if (error && /bucket not found|not found/i.test(String(error.message ?? error))) {
    await storage.createBucket(BUCKET, { public: false });
    ({ error } = await storage.from(BUCKET).upload(file, body, { upsert: true, contentType: "application/json" }));
  }
  if (error) throw new Error(`Could not save the watch catalog: ${error.message ?? error}`);
  cache.set(file, { data, at: Date.now() });
  return data;
}

/** topicId -> { kind, status, ep_credits, poster_emoji, on_sale } */
async function showMeta() {
  return readJson(SHOWS_FILE, {});
}
async function saveShowMeta(topicId, patch) {
  const all = await showMeta();
  const next = { ...all, [topicId]: { on_sale: true, ep_credits: 1, status: "ongoing", ...all[topicId], ...patch } };
  await writeJson(SHOWS_FILE, next);
  return next[topicId];
}

/** telegramUserId -> { credits, bought: { episodeId: true } } */
async function wallets() {
  return readJson(WALLET_FILE, {});
}
async function walletFor(userId) {
  const all = await wallets();
  return all[userId] ?? { credits: 0, bought: {} };
}
async function saveWallet(userId, entry) {
  const all = await wallets();
  const next = { ...all, [userId]: entry };
  await writeJson(WALLET_FILE, next);
  return entry;
}

/** Adds Watch Credit from a paid top-up. Called from botPay.grant(). */
export async function grantTopUp(userId, credits) {
  const w = await walletFor(userId);
  const next = { ...w, credits: (w.credits ?? 0) + credits };
  await saveWallet(userId, next);
  return next.credits;
}

// ------------------------------------------------------------ texts

const L = {
  km: {
    section: "🎬 មើលរឿង — ជ្រើសរើសប្រភេទ៖",
    noShows: "😔 មិនទាន់មានរឿងក្នុងប្រភេទនេះទេ។",
    showList: (kind) => `${KIND_LABEL[kind].km}`,
    epList: (title, credits) => `🎬 ${title}\n\nមួយភាគ = ${credits} Credit ($${(credits * DEFAULT_PRICE_USD).toFixed(2)})`,
    locked: (n) => `🔒 EP ${n}`,
    owned: (n) => `▶️ EP ${n}`,
    balance: (n) => `{:credit:} Watch Credit នៅសល់៖ ${n}`,
    needMore: (need, have) => `😔 អ្នកត្រូវការ ${need} Credit ប៉ុន្តែមាន ${have}។ សូមបន្ថែម Credit ខាងក្រោម៖`,
    delivering: "⏳ កំពុងផ្ញើវីដេអូ…",
    bought: (left) => `✅ បានទិញ EP នេះ! Watch Credit នៅសល់៖ ${left}`,
    deliverFailed: "⚠️ មិនអាចផ្ញើវីដេអូនេះបានទេ។ សូមទាក់ទងអ្នកគ្រប់គ្រង។",
    topUpTitle: "{:credit:} បន្ថែម Watch Credit — ជ្រើសរើសកញ្ចប់៖",
    granted: (n, left) => `🎉 ការទូទាត់បានបញ្ជាក់! +${n} Watch Credit\n{:credit:} Watch Credit នៅសល់៖ ${left}`,
    back: "⬅️ ត្រឡប់",
  },
  en: {
    section: "🎬 Watch — pick a genre:",
    noShows: "😔 No shows in this genre yet.",
    showList: (kind) => `${KIND_LABEL[kind].en}`,
    epList: (title, credits) => `🎬 ${title}\n\n1 episode = ${credits} Credit (${"$"}${(credits * DEFAULT_PRICE_USD).toFixed(2)})`,
    locked: (n) => `🔒 EP ${n}`,
    owned: (n) => `▶️ EP ${n}`,
    balance: (n) => `{:credit:} Watch Credit left: ${n}`,
    needMore: (need, have) => `😔 You need ${need} Credit but have ${have}. Top up below:`,
    delivering: "⏳ Sending the video…",
    bought: (left) => `✅ Bought this episode! Watch Credit left: ${left}`,
    deliverFailed: "⚠️ Could not send that video. Please contact the operator.",
    topUpTitle: "{:credit:} Add Watch Credit — choose a pack:",
    granted: (n, left) => `🎉 Payment confirmed! +${n} Watch Credit\n{:credit:} Watch Credit left: ${left}`,
    back: "⬅️ Back",
  },
};
const tx = (language) => L[language] ?? L.km;

// Telegram refuses a reply_markup past a certain size ("reply markup is too
// long") -- a group with dozens of shows, or a show with hundreds of
// episodes, hit this the first time (67 shows in one list, one row each).
// Paging keeps every screen well under that regardless of catalog size.
const SHOWS_PER_PAGE = 10;
const EPS_PER_PAGE = 40; // 10 rows of 4

/** A [prev, next] row, only the buttons that actually apply. */
function pageNav(prefix, page, hasMore, t) {
  const row = [];
  if (page > 0) row.push({ text: "◀️", callback_data: `${prefix}:${page - 1}` });
  if (hasMore) row.push({ text: "▶️", callback_data: `${prefix}:${page + 1}` });
  return row.length ? [row] : [];
}

// ------------------------------------------------------------ browse

async function showsInKind(kind) {
  const meta = await showMeta();
  const topicIds = Object.entries(meta)
    .filter(([, m]) => m.kind === kind && m.on_sale !== false)
    .map(([id]) => id);
  if (!topicIds.length) return [];
  const topics = rows(await db().from("topics").select("*").in("id", topicIds));
  return topics.map((topic) => ({ topic, meta: meta[topic.id] })).sort((a, b) => a.topic.title.localeCompare(b.topic.title));
}

/** The genre picker -- the Watch section's home screen. */
export async function showGenres(chatId, language) {
  const t = tx(language);
  await call("sendMessage", {
    chat_id: chatId,
    text: t.section,
    reply_markup: {
      inline_keyboard: [
        KINDS.map((k) => ({ text: KIND_LABEL[k][language] ?? KIND_LABEL[k].km, callback_data: `watch:kind:${k}:0` })),
        [{ text: t.back, emoji: "inv_back", callback_data: "watch:exit" }],
      ],
    },
  });
}

async function showKindList(chatId, language, kind, page = 0) {
  const t = tx(language);
  const all = await showsInKind(kind);
  if (!all.length) {
    await call("sendMessage", { chat_id: chatId, text: t.noShows });
    return;
  }
  const start = page * SHOWS_PER_PAGE;
  const list = all.slice(start, start + SHOWS_PER_PAGE);
  const rowsOut = list.map(({ topic, meta }) => [
    {
      text: `${meta.poster_emoji ? `{:${meta.poster_emoji}:} ` : ""}${topic.title}${meta.status === "completed" ? " ✅" : " 🔴"}`,
      callback_data: `watch:show:${topic.id}:0`,
    },
  ]);
  rowsOut.push(...pageNav(`watch:kind:${kind}`, page, start + SHOWS_PER_PAGE < all.length, t));
  rowsOut.push([{ text: t.back, emoji: "inv_back", callback_data: "watch:home" }]); // one level up: the genre picker
  const pageNote = all.length > SHOWS_PER_PAGE ? ` (${start + 1}-${Math.min(start + SHOWS_PER_PAGE, all.length)}/${all.length})` : "";
  await call("sendMessage", { chat_id: chatId, text: t.showList(kind) + pageNote, reply_markup: { inline_keyboard: rowsOut } });
}

async function showEpisodeList(chatId, user, topicId, page = 0) {
  const t = tx(user.language);
  const [topic] = rows(await db().from("topics").select("*").eq("id", topicId).limit(1));
  if (!topic) return;
  const meta = (await showMeta())[topicId] ?? {};
  const allEpisodes = await fetchAll(() =>
    db().from("episodes").select("id, ep_number").eq("topic_id", topicId).order("ep_number")
  );
  const w = await walletFor(user.telegram_user_id);
  const credits = meta.ep_credits ?? 1;

  const start = page * EPS_PER_PAGE;
  const episodes = allEpisodes.slice(start, start + EPS_PER_PAGE);
  const buttons = [];
  let row = [];
  for (const ep of episodes) {
    const owned = Boolean(w.bought?.[ep.id]);
    row.push({ text: owned ? t.owned(ep.ep_number ?? "?") : t.locked(ep.ep_number ?? "?"), callback_data: `watch:ep:${ep.id}` });
    if (row.length === 4) {
      buttons.push(row);
      row = [];
    }
  }
  if (row.length) buttons.push(row);
  buttons.push(...pageNav(`watch:show:${topicId}`, page, start + EPS_PER_PAGE < allEpisodes.length, t));
  buttons.push([{ text: t.back, emoji: "inv_back", callback_data: `watch:kind:${meta.kind}:0` }]);

  const pageNote =
    allEpisodes.length > EPS_PER_PAGE ? ` (${start + 1}-${Math.min(start + EPS_PER_PAGE, allEpisodes.length)}/${allEpisodes.length})` : "";
  await call("sendMessage", {
    chat_id: chatId,
    text: `${t.epList(topic.title, credits)}${pageNote}\n\n${t.balance(w.credits ?? 0)}`,
    reply_markup: { inline_keyboard: buttons },
  });
}

async function buyEpisode(chatId, cq, user, episodeId) {
  const t = tx(user.language);
  const [episode] = rows(
    await db().from("episodes").select("id, topic_id, ep_number, r2_key").eq("id", episodeId).limit(1)
  );
  if (!episode) return;
  const meta = (await showMeta())[episode.topic_id] ?? {};
  const credits = meta.ep_credits ?? 1;
  const w = await walletFor(user.telegram_user_id);
  const already = Boolean(w.bought?.[episodeId]);

  if (!already) {
    if ((w.credits ?? 0) < credits) {
      await call("answerCallbackQuery", { callback_query_id: cq.id });
      await call("sendMessage", { chat_id: chatId, text: t.needMore(credits, w.credits ?? 0) });
      await showTopUps(chatId, user.language);
      return;
    }
    await saveWallet(user.telegram_user_id, {
      ...w,
      credits: w.credits - credits,
      bought: { ...w.bought, [episodeId]: true },
    });
  }
  await call("answerCallbackQuery", { callback_query_id: cq.id, text: t.delivering });

  let delivered = { ok: false };
  if (episode.r2_key) {
    const url = await r2.urlForKey(episode.r2_key).catch(() => null);
    if (url) {
      await call("sendMessage", { chat_id: chatId, text: `🎬 EP ${episode.ep_number}\n${url}` });
      delivered = { ok: true };
    }
  }
  if (!delivered.ok) {
    delivered = await botDeliver.deliverEpisode({ userChatId: chatId, episodeId: episode.id, caption: `🎬 EP ${episode.ep_number}` });
  }

  if (!delivered.ok) {
    // Refund: the credit was spent for nothing.
    if (!already) {
      const fresh = await walletFor(user.telegram_user_id);
      await saveWallet(user.telegram_user_id, { ...fresh, credits: (fresh.credits ?? 0) + credits });
    }
    await call("sendMessage", { chat_id: chatId, text: t.deliverFailed });
    return;
  }
  if (!already) {
    const fresh = await walletFor(user.telegram_user_id);
    await call("sendMessage", { chat_id: chatId, text: t.bought(fresh.credits ?? 0) });
  }
}

async function showTopUps(chatId, language) {
  const t = tx(language);
  const list = rows(await db().from("bot_packages").select("*").like("id", `${WATCH_PACKAGE_PREFIX}%`).eq("active", true).order("sort"));
  await call("sendMessage", {
    chat_id: chatId,
    text: t.topUpTitle,
    reply_markup: {
      inline_keyboard: list.map((pkg) => [
        { text: language === "en" ? pkg.title_en : pkg.title_km, emoji: "credit", callback_data: `bot:buy:${pkg.id}` },
      ]),
    },
  });
}

/** botPay.grant() calls this once a watch_* order is paid. */
export async function grantedText(language, credits, user) {
  const left = await grantTopUp(user.telegram_user_id, credits);
  return tx(language).granted(credits, left);
}

/** `watch:...` callback data. Returns true when it handled the tap. */
export async function handleCallback(cq, user) {
  const data = String(cq?.data ?? "");
  if (!data.startsWith("watch:")) return false;
  const chatId = cq.message?.chat?.id;
  if (!chatId) return true;
  const [, kind, value, pageStr] = data.split(":");
  const page = Number(pageStr) || 0;

  if (kind === "home") {
    await call("answerCallbackQuery", { callback_query_id: cq.id });
    await showGenres(chatId, user.language);
    return true;
  }
  if (kind === "exit") {
    await call("answerCallbackQuery", { callback_query_id: cq.id });
    await call("sendMessage", {
      chat_id: chatId,
      text: user.language === "en" ? "⬅️ Main menu" : "⬅️ ម៉ឺនុយដើម",
      reply_markup: mainKeyboard(user.language),
    });
    return true;
  }
  if (kind === "kind") {
    await call("answerCallbackQuery", { callback_query_id: cq.id });
    await showKindList(chatId, user.language, value, page);
    return true;
  }
  if (kind === "show") {
    await call("answerCallbackQuery", { callback_query_id: cq.id });
    await showEpisodeList(chatId, user, value, page);
    return true;
  }
  if (kind === "ep") {
    await buyEpisode(chatId, cq, user, value);
    return true;
  }
  await call("answerCallbackQuery", { callback_query_id: cq.id }).catch(() => {});
  return true;
}

// ------------------------------------------------------------ admin tooling

/**
 * Registers (or re-scans) a VIP source group by chat id, and lists its
 * topics with a #index for /setshow to reference. One-time setup per group.
 */
export async function addOrScanGroup(chatId) {
  // A -100… id, an @username, or any message link copied out of the group
  // (t.me/c/…/…) all name the same chat; store the plain id so the group
  // isn't registered twice under two spellings.
  const id = String(parseTelegramLink(chatId).chatId);
  let [group] = rows(await db().from("groups").select("*").eq("chat_id", id).limit(1));
  if (!group) {
    [group] = rows(await db().from("groups").insert({ chat_id: id, title: id }).select("*"));
  }
  const result = await scanGroup(group.id);
  const topics = rows(await db().from("topics").select("id, title, total_episodes").eq("group_id", group.id).order("title"));
  const lines = topics.map((topic, i) => `${i + 1}. ${topic.title} (${topic.total_episodes} ep) — ${topic.id}`);
  return (
    `✅ Scanned: ${result.new_episodes} new episode(s), ${result.topics} topic(s).\n\n` +
    (lines.length ? lines.join("\n") : "No topics found (is it a forum group?).")
  );
}

/**
 * /setshow <topic id> <anime|donghua|movie> [ongoing|completed] [credits]
 * A poster attached to the same command (photo, or forwarded from anywhere)
 * is converted into a custom emoji and stored on the show.
 */
export async function setShow(topicId, kind, status, credits, posterBuffer) {
  if (!KINDS.includes(kind)) throw new Error(`kind must be one of ${KINDS.join(", ")}`);
  const patch = { kind };
  if (status) patch.status = status;
  if (credits) patch.ep_credits = Math.max(1, Math.round(Number(credits)));
  if (posterBuffer) {
    patch.poster_emoji = await customEmoji.addPosterEmoji(posterBuffer);
  }
  const saved = await saveShowMeta(topicId, patch);
  return `✅ Show set: kind=${saved.kind} status=${saved.status} ep_credits=${saved.ep_credits}${posterBuffer ? " (poster emoji added)" : ""}`;
}

/** /shows -- topic index for /setshow, across every registered group. */
export async function listAllTopics() {
  const topics = await fetchAll(() => db().from("topics").select("id, title, total_episodes").order("title"));
  const meta = await showMeta();
  if (!topics.length) return "No topics yet. Use /watchgroup <chat id> first.";
  return topics
    .map((topic) => {
      const m = meta[topic.id];
      const tag = m ? `[${m.kind}/${m.status}/${m.ep_credits}cr]` : "[unset]";
      return `${topic.title} (${topic.total_episodes} ep) ${tag}\n${topic.id}`;
    })
    .join("\n\n");
}

/** What /watchgroup and /setshow say when sent without (valid) arguments. */
export const ADMIN_HELP =
  "🎬 ការរៀបចំផ្នែក មើលរឿង (Admin)\n\n" +
  "1️⃣ /watchgroup <link ឬ chat id>\n" +
  "   ចុចសង្កត់សារណាមួយក្នុង Group VIP → Copy Link → ផ្ញើ៖\n" +
  "   /watchgroup https://t.me/c/1234567890/55\n" +
  "   (ឬ /watchgroup -1001234567890)\n" +
  "   Bot នឹង scan Topic និង EP ទាំងអស់ដោយស្វ័យប្រវត្តិ។\n" +
  "   ⚠️ គណនី userbot ត្រូវតែជាសមាជិក Group នោះ ហើយ Group ត្រូវបើក Topics។\n\n" +
  "2️⃣ /setgroup <link ឬ chat id> <anime|donghua|movie> [ongoing|completed] [credit]\n" +
  "   ដាក់លក់រឿងទាំងអស់ក្នុង Group ក្នុងពេលតែមួយ ឧ. /setgroup -1004468850700 donghua\n\n" +
  "   /shows — បង្ហាញរឿង (Topic) ទាំងអស់ ជាមួយ id របស់វា\n\n" +
  "3️⃣ /setshow <topic id> <anime|donghua|movie> [ongoing|completed] [credit]\n" +
  "   ផ្ញើជា caption លើរូប poster (forward ពី @AnimetioMini_bot ក៏បាន)\n" +
  "   → poster ក្លាយជា emoji របស់រឿងនោះ\n" +
  "   ឧ. /setshow 9f2c…e1 anime ongoing\n\n" +
  "ចំណាំ៖ ដើម្បីផ្ញើ EP ពី Group ត្រូវកំណត់ storage channel (/setstorage) ជាមុនសិន។";

/**
 * /setgroup <link|chat id> <anime|donghua|movie> [ongoing|completed] [credits]
 * Puts every topic of one registered group on sale at once, keeping any
 * poster a show already has. One write for the whole group.
 */
export async function setGroupKind(chatId, kind, status, credits) {
  if (!KINDS.includes(kind)) throw new Error(`kind must be one of ${KINDS.join(", ")}`);
  const id = String(parseTelegramLink(chatId).chatId);
  const [group] = rows(await db().from("groups").select("id, title").eq("chat_id", id).limit(1));
  if (!group) throw new Error("Group not registered yet -- send /watchgroup with it first.");
  const topics = await fetchAll(() => db().from("topics").select("id").eq("group_id", group.id).order("id"));
  if (!topics.length) throw new Error("That group has no topics yet -- run /watchgroup on it.");

  const all = await showMeta();
  const next = { ...all };
  for (const topic of topics) {
    next[topic.id] = {
      on_sale: true,
      ep_credits: 1,
      status: "ongoing",
      ...all[topic.id],
      kind,
      ...(status ? { status } : {}),
      ...(credits ? { ep_credits: Math.max(1, Math.round(Number(credits))) } : {}),
    };
  }
  await writeJson(SHOWS_FILE, next);
  return `✅ ${topics.length} រឿងក្នុង «${group.title}» ដាក់លក់ជា ${kind}${status ? ` (${status})` : ""}${credits ? `, ${credits} Credit/EP` : ""}។\nអ្នកប្រើឃើញភ្លាមក្នុង 🎬 មើលរឿង។`;
}
