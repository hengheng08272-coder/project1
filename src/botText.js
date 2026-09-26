/**
 * Everything the menu bot says, in Khmer and English, plus the keyboards it
 * shows. Kept apart from the bot's logic so a wording change never means
 * touching a flow, and so the two languages stay side by side where a missing
 * translation is obvious.
 */
import { config } from "./config.js";

export const LANGUAGES = ["km", "en"];

/**
 * The buttons of the main keyboard. `action` is what the bot dispatches on --
 * the label the user tapped arrives as ordinary message text, so both
 * languages' labels have to map back to the same action (see actionForLabel).
 */
const MENU = [
  { action: "account", km: "👤 គណនី", en: "👤 Account" },
  // Two doors instead of one: the public sites anyone may use, and the
  // private-Telegram path that needs VIP. Splitting them means nobody pastes
  // a VIP link only to be told no -- the label says which is which up front.
  { action: "free", km: "🆓 ទាញយក · FB · IG · YT · TikTok", en: "🆓 Free · FB · IG · YT · TikTok" },
  { action: "premium", km: "👑 Premium · Telegram ឯកជន", en: "👑 Premium · private Telegram" },
  { action: "buy", km: "💎 ទិញ / VIP", en: "💎 Buy / VIP" },
  { action: "history", km: "📜 ប្រវត្តិ", en: "📜 History" },
  { action: "referral", km: "👥 ណែនាំមិត្ត", en: "👥 Referral" },
  { action: "language", km: "🌐 ភាសា", en: "🌐 Language" },
  { action: "help", km: "❓ របៀបប្រើ", en: "❓ How to use" },
  { action: "app", km: "🖥 បើកកម្មវិធី", en: "🖥 Open app" },
];

const LABEL_TO_ACTION = new Map();
for (const item of MENU) {
  LABEL_TO_ACTION.set(item.km, item.action);
  LABEL_TO_ACTION.set(item.en, item.action);
}

/** Which menu action a tapped button (arriving as plain text) means, or null. */
export function actionForLabel(text) {
  return LABEL_TO_ACTION.get(String(text ?? "").trim()) ?? null;
}

/**
 * The persistent keyboard under the message box. The "open the app" button is
 * a real Mini App button when WEB_APP_URL is set -- Telegram then opens the
 * web UI inside the chat instead of a browser -- and is left out entirely
 * when it isn't, rather than showing a button that does nothing.
 */
export function mainKeyboard(language) {
  const label = (action) => {
    const item = MENU.find((m) => m.action === action);
    return item[language] ?? item.en;
  };
  const rows = [
    [{ text: label("free") }],
    [{ text: label("premium") }],
    [{ text: label("account") }, { text: label("buy") }],
    [{ text: label("history") }, { text: label("referral") }],
    [{ text: label("language") }, { text: label("help") }],
  ];
  if (config.webAppUrl) {
    rows.push([{ text: label("app"), web_app: { url: config.webAppUrl } }]);
  }
  return { keyboard: rows, resize_keyboard: true, is_persistent: true };
}

export function languageKeyboard() {
  return {
    inline_keyboard: [[
      { text: "🇰🇭 ភាសាខ្មែរ", callback_data: "bot:lang:km" },
      { text: "🇬🇧 English", callback_data: "bot:lang:en" },
    ]],
  };
}

const TEXT = {
  km: {
    welcome: (name) =>
      `👋 សួស្តី ${name}!\n\n` +
      `ខ្ញុំជួយទាញយកវីដេអូ និងបទចម្រៀង៖\n\n` +
      `🆓 ឥតគិតថ្លៃ — YouTube · Facebook · TikTok ·\n` +
      `      Instagram · X និងគេហទំព័រជាង ១៨០០\n\n` +
      `👑 Premium — ក្រុម/channel Telegram ឯកជន\n` +
      `      វីដេអូពេញទំហំ គ្មានកម្រិត 50MB\n\n` +
      `គ្រាន់តែ ផ្ញើតំណមក ខ្ញុំធ្វើនៅសល់។`,
    help:
      `📘 របៀបប្រើ\n\n` +
      `1️⃣ ចម្លងតំណវីដេអូ (YouTube, Facebook, TikTok, Telegram…)\n` +
      `2️⃣ ផ្ញើវាមកក្នុងការសន្ទនានេះ\n` +
      `3️⃣ រង់ចាំបន្តិច — ខ្ញុំផ្ញើឯកសារ ឬ តំណទាញយកមកវិញ\n\n` +
      `💡 ឯកសារធំជាង 50MB ខ្ញុំផ្ញើជា តំណ ជំនួស (កំណត់របស់ Telegram សម្រាប់ bot)។\n` +
      `💡 ចង់យកតែសំឡេង? ផ្ញើតំណរួចសរសេរ audio នៅខាងក្រោយ។`,
    accountTitle: "ព័ត៌មានគណនី",
    fieldId: "ID",
    fieldUsername: "Username",
    fieldLanguage: "ភាសា",
    fieldQuota: "ទាញយកនៅសល់",
    fieldPlan: "គម្រោង",
    planFree: "ឥតគិតថ្លៃ",
    planVip: (until) => `👑 VIP ដល់ ${until}`,
    fieldUsed: "បានទាញយក",
    unlimited: "មិនកំណត់",
    historyTitle: "ប្រវត្តិទាញយក",
    historyEmpty: "មិនទាន់មានការទាញយកទេ។ ផ្ញើតំណមកដើម្បីចាប់ផ្ដើម។",
    referralTitle: "កម្មវិធីណែនាំ",
    referralBody: (count, bonus, link) =>
      `🎁 ណែនាំមិត្តម្នាក់ ទទួលបាន ${bonus} ការទាញយកបន្ថែម!\n\n` +
      `📊 អ្នកបានណែនាំ៖ ${count} នាក់\n\n` +
      `🔗 តំណណែនាំរបស់អ្នក៖\n${link}\n\n` +
      `➡️ ចែករំលែកតំណនេះ — ពេលមិត្តចុច និងចាប់ផ្ដើមប្រើ អ្នកទទួលបានភ្លាម។`,
    referralJoined: (name) => `🎉 ${name} បានចូលរួមតាមតំណណែនាំរបស់អ្នក! អ្នកទទួលបានការទាញយកបន្ថែម។`,
    languagePrompt: "🌐 ជ្រើសរើសភាសា៖",
    languageSet: "✅ បានប្ដូរទៅភាសាខ្មែរ។",
    openApp: (url) => `🖥 បើកកម្មវិធីពេញលេញ៖\n${url}`,
    openAppMissing: "🖥 កម្មវិធីលើបណ្ដាញមិនទាន់បានកំណត់ទេ។",
    sendLink: "📥 ផ្ញើតំណវីដេអូមកទីនេះ (YouTube, Facebook, TikTok, Telegram, .mp4, .m3u8…)។",
    freeScreen: (left) =>
      `🆓 ទាញយកឥតគិតថ្លៃ\n\n` +
      `▶️ YouTube    📘 Facebook\n` +
      `📸 Instagram  🎵 TikTok\n` +
      `✖️ X (Twitter)  🎮 Twitch\n` +
      `🔗 តំណផ្ទាល់ .mp4 · .m3u8 · .mp3\n` +
      `➕ គេហទំព័រជាង ១៨០០ ផ្សេងទៀត\n\n` +
      `📊 នៅសល់៖ ${left}\n\n` +
      `👉 ផ្ញើតំណមកបានឥឡូវនេះ\n` +
      `💡 ចង់យកតែសំឡេង? សរសេរ audio បន្ទាប់ពីតំណ`,
    premiumScreenOpen: () =>
      `👑 Premium — Telegram ឯកជន\n\n` +
      `✅ គណនីរបស់អ្នកបានភ្ជាប់រួចហើយ\n\n` +
      `អ្នកអាចទាញយកពី៖\n` +
      `🔒 ក្រុម / channel ឯកជន (t.me/c/...)\n` +
      `🎬 វីដេអូពេញទំហំ — គ្មានកម្រិត 50MB\n` +
      `⚡ ផ្ញើមកវិញភ្លាម (មិនបាច់រង់ចាំទាញយក)\n\n` +
      `👉 បើក post វីដេអូ → ចុចលើវា → Copy Link → ផ្ញើមកទីនេះ\n\n` +
      `➕ ចង់ទាញពីក្រុមឯកជនរបស់អ្នកផ្ទាល់? ភ្ជាប់គណនី Telegram\n` +
      `      របស់អ្នកក្នុង 🖥 បើកកម្មវិធី → ការកំណត់ → Telegram\n` +
      `      (ស្ម័គ្រចិត្ត — មិនភ្ជាប់ក៏ប្រើក្រុមរបស់យើងបានដែរ)`,
    premiumScreenLocked: () =>
      `👑 Premium — Telegram ឯកជន\n\n` +
      `🔒 មុខងារនេះត្រូវការគណនីភ្ជាប់ (VIP)\n\n` +
      `អ្វីដែលអ្នកទទួលបាន៖\n` +
      `🔓 ទាញយកពីក្រុម / channel ឯកជន\n` +
      `🎬 វីដេអូពេញទំហំ ទោះ 1.5GB ក៏បាន\n` +
      `♾ ទាញយកមិនកំណត់ចំនួន\n` +
      `⚡ លឿនជាង — ផ្ញើចេញភ្លាម\n\n` +
      `👉 ចុច 💎 ទិញ / VIP ដើម្បីបើក`,
    notALink: "នោះមិនមែនជាតំណទេ។ សូមផ្ញើតំណដែលចាប់ផ្ដើមដោយ http:// ឬ https://។",
    working: "⏳ កំពុងដំណើរការ… ខ្ញុំនឹងផ្ញើមកវិញពេលរួច។",
    queued: "✅ បានបញ្ចូលក្នុងជួរ។ ខ្ញុំនឹងផ្ញើមកវិញពេលទាញយករួច (អាចចំណាយពេលពីរបីនាទីសម្រាប់វីដេអូវែង)។",
    quotaOver: (total) => `អ្នកបានប្រើអស់ ${total} ដងហើយ។ ចុច 💎 ទិញ ដើម្បីបន្ថែម ឬណែនាំមិត្តដើម្បីទទួលឥតគិតថ្លៃ។`,
    doneWithLink: (name, url) => `✅ រួចរាល់៖ ${name}\n\n🔗 ${url}`,
    doneNoLink: (name) => `✅ រួចរាល់៖ ${name}`,
    failed: (reason) => `❌ ទាញយកមិនបាន៖ ${reason}`,
    tooBig: (mb) => `ឯកសារនេះ ${mb}MB ធំជាងកំណត់ 50MB របស់ Telegram សម្រាប់ bot — ខ្ញុំផ្ញើជាតំណជំនួស។`,
    noMedia: "សាររបស់តំណនោះគ្មានវីដេអូ ឬសំឡេងទេ។",
    privateVipOnly: "🔒 នេះជាតំណ Telegram ឯកជន — ជាមុខងារ 👑 Premium។ ចុច 💎 ទិញ / VIP ដើម្បីបើក។",
    privateNoAccess: "🔒 មិនអាចចូលមើល chat ឯកជននោះបានទេ — គណនីរបស់ bot មិនមែនជាសមាជិកនៅក្នុងនោះទេ។",
    inviteLink: "នោះជាតំណអញ្ជើញ (t.me/+...) មិនមែនតំណទៅកាន់ post ទេ។ សូមចូលក្នុង post វីដេអូ → ចុចលើវា → Copy Link រួចផ្ញើតំណនោះមក។",
    sendingVideo: "📤 កំពុងផ្ញើវីដេអូ…",
  },
  en: {
    welcome: (name) =>
      `👋 Hi ${name}!\n\n` +
      `I download videos and songs:\n\n` +
      `🆓 Free — YouTube · Facebook · TikTok ·\n` +
      `      Instagram · X and ~1800 more sites\n\n` +
      `👑 Premium — private Telegram groups/channels,\n` +
      `      full-size video with no 50MB limit\n\n` +
      `Just send me a link and I'll do the rest.`,
    help:
      `📘 How to use\n\n` +
      `1️⃣ Copy a video link (YouTube, Facebook, TikTok, Telegram…)\n` +
      `2️⃣ Send it to this chat\n` +
      `3️⃣ Wait a moment — I send back the file, or a download link\n\n` +
      `💡 Files over 50MB come back as a link instead (Telegram's own limit for bots).\n` +
      `💡 Want audio only? Send the link followed by: audio`,
    accountTitle: "Account",
    fieldId: "ID",
    fieldUsername: "Username",
    fieldLanguage: "Language",
    fieldQuota: "Downloads left",
    fieldPlan: "Plan",
    planFree: "Free",
    planVip: (until) => `👑 VIP until ${until}`,
    fieldUsed: "Downloaded",
    unlimited: "unlimited",
    historyTitle: "Download history",
    historyEmpty: "Nothing downloaded yet. Send a link to start.",
    referralTitle: "Referral programme",
    referralBody: (count, bonus, link) =>
      `🎁 Get ${bonus} extra downloads for every friend you bring!\n\n` +
      `📊 You have referred: ${count}\n\n` +
      `🔗 Your referral link:\n${link}\n\n` +
      `➡️ Share it — you're credited as soon as they start the bot.`,
    referralJoined: (name) => `🎉 ${name} joined through your referral link! Extra downloads added.`,
    languagePrompt: "🌐 Choose a language:",
    languageSet: "✅ Switched to English.",
    openApp: (url) => `🖥 Open the full app:\n${url}`,
    openAppMissing: "🖥 The web app URL isn't configured yet.",
    sendLink: "📥 Send a video link here (YouTube, Facebook, TikTok, Telegram, .mp4, .m3u8…).",
    freeScreen: (left) =>
      `🆓 Free download\n\n` +
      `▶️ YouTube    📘 Facebook\n` +
      `📸 Instagram  🎵 TikTok\n` +
      `✖️ X (Twitter)  🎮 Twitch\n` +
      `🔗 Direct .mp4 · .m3u8 · .mp3 links\n` +
      `➕ ~1800 more sites\n\n` +
      `📊 Downloads left: ${left}\n\n` +
      `👉 Send a link now\n` +
      `💡 Want audio only? Write audio after the link`,
    premiumScreenOpen: () =>
      `👑 Premium — private Telegram\n\n` +
      `✅ Your account is linked\n\n` +
      `You can download from:\n` +
      `🔒 Private groups / channels (t.me/c/...)\n` +
      `🎬 Full-size video — no 50MB limit\n` +
      `⚡ Delivered instantly, nothing to wait for\n\n` +
      `👉 Open the video post → tap it → Copy Link → send it here\n\n` +
      `➕ Want your own private groups? Link your Telegram account\n` +
      `      in 🖥 Open app → Settings → Telegram\n` +
      `      (optional — our groups work without it)`,
    premiumScreenLocked: () =>
      `👑 Premium — private Telegram\n\n` +
      `🔒 This needs a linked (VIP) account\n\n` +
      `What you get:\n` +
      `🔓 Downloads from private groups / channels\n` +
      `🎬 Full-size video, even 1.5GB\n` +
      `♾ Unlimited downloads\n` +
      `⚡ Faster — delivered straight away\n\n` +
      `👉 Tap 💎 Buy / VIP to unlock`,
    notALink: "That isn't a link. Send something starting with http:// or https://.",
    working: "⏳ Working on it… I'll send it back when it's ready.",
    queued: "✅ Queued. I'll send it back once it's downloaded (a long video can take a few minutes).",
    quotaOver: (total) => `You've used all ${total} downloads. Tap 💎 Buy for more, or refer a friend for free ones.`,
    doneWithLink: (name, url) => `✅ Done: ${name}\n\n🔗 ${url}`,
    doneNoLink: (name) => `✅ Done: ${name}`,
    failed: (reason) => `❌ Download failed: ${reason}`,
    tooBig: (mb) => `That file is ${mb}MB, over Telegram's 50MB bot upload limit — here's a link instead.`,
    noMedia: "That message has no video or audio in it.",
    privateVipOnly: "🔒 That's a private Telegram link — a 👑 Premium feature. Tap 💎 Buy / VIP to unlock it.",
    privateNoAccess: "🔒 Can't open that private chat — the bot's account isn't a member of it.",
    inviteLink: "That's an invite link (t.me/+...), not a link to a post. Open the video post → tap it → Copy Link, and send that.",
    sendingVideo: "📤 Sending the video…",
  },
};

/** The string table for a language, falling back to Khmer (the default audience). */
export function texts(language) {
  return TEXT[language] ?? TEXT.km;
}
