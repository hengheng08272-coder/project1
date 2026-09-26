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
  {
    action: "free",
    km: "🆓 Free ♾ · YT · FB · IG · TikTok",
    en: "🆓 Free ♾ · YT · FB · IG · TikTok",
    aliases: ["🆓 ទាញយក · FB · IG · YT · TikTok", "🆓 Free · FB · IG · YT · TikTok", "📥 ទាញយកតំណ", "📥 Download"],
  },
  {
    action: "premium",
    km: "👑 Pro · Telegram · 10 ឥតគិតថ្លៃ",
    en: "👑 Pro · Telegram · 10 free",
    aliases: ["👑 Premium · Telegram ឯកជន", "👑 Premium · private Telegram"],
  },
  { action: "buy", km: "💎 ទិញ / VIP", en: "💎 Buy / VIP" },
  { action: "history", km: "📜 ប្រវត្តិ", en: "📜 History" },
  { action: "referral", km: "👥 ណែនាំមិត្ត", en: "👥 Referral" },
  { action: "language", km: "🌐 ភាសា", en: "🌐 Language" },
  { action: "help", km: "❓ របៀបប្រើ", en: "❓ How to use" },
  { action: "app", km: "🖥 បើកកម្មវិធី", en: "🖥 Open app" },
];

const LABEL_TO_ACTION = new Map();
for (const item of MENU) {
  for (const label of [item.km, item.en, ...(item.aliases ?? [])]) {
    LABEL_TO_ACTION.set(label, item.action);
  }
}

/** "▰▰▰▱▱▱▱▱▱▱" -- how much of a quota is spent, readable at a glance. */
export function progressBar(used, total, width = 10) {
  if (!total) return "▱".repeat(width);
  const filled = Math.min(width, Math.round((Math.min(used, total) / total) * width));
  return "▰".repeat(filled) + "▱".repeat(width - filled);
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
      `👋 សួស្តី ${name}! នេះជា SaveIt KH\n\n` +
      `ខ្ញុំជួយទាញយកវីដេអូ និងបទចម្រៀង៖\n\n` +
      `🆓 SaveIt Free — ឥតគិតថ្លៃ មិនកំណត់ ♾\n` +
      `      YouTube · Facebook · Instagram · TikTok · X\n\n` +
      `👑 SaveIt Pro — Telegram (ក្រុម/channel ឯកជន)\n` +
      `      🎁 សាកល្បងឥតគិតថ្លៃ 10 វីដេអូ\n` +
      `      🎬 វីដេអូពេញទំហំ គ្មានកម្រិត 50MB\n\n` +
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
    freeScreen: () =>
      `🆓 SaveIt Free — ឥតគិតថ្លៃ មិនកំណត់\n\n` +
      `▶️ YouTube     📘 Facebook\n` +
      `📸 Instagram   🎵 TikTok\n` +
      `✖️ X (Twitter)  🎮 Twitch\n` +
      `🔗 .mp4 · .m3u8 · .mp3\n` +
      `➕ គេហទំព័រជាង ១៨០០ ផ្សេងទៀត\n\n` +
      `♾ ទាញយកប៉ុន្មានក៏បាន — មិនគិតលុយ មិនកំណត់ចំនួន\n\n` +
      `👉 ផ្ញើតំណមកបានឥឡូវនេះ\n` +
      `💡 ចង់យកតែសំឡេង? សរសេរ audio បន្ទាប់ពីតំណ`,
    proScreenTrial: (bar, used, total, left) =>
      `👑 SaveIt Pro — Telegram\n\n` +
      `🎁 សាកល្បងឥតគិតថ្លៃ ${total} វីដេអូ\n` +
      `${bar}  ${used}/${total}\n` +
      `✅ នៅសល់ ${left} វីដេអូ\n\n` +
      `ទាញយកបានពី៖\n` +
      `🔒 ក្រុម / channel ឯកជន (t.me/c/...)\n` +
      `📢 channel សាធារណៈ (t.me/...)\n` +
      `🎬 វីដេអូពេញទំហំ — គ្មានកម្រិត 50MB\n` +
      `⚡ ផ្ញើមកវិញភ្លាម\n\n` +
      `👉 បើក post វីដេអូ → ចុចលើវា → Copy Link → ផ្ញើមកទីនេះ`,
    proScreenVip: (until) =>
      `👑 SaveIt Pro — VIP\n\n` +
      `♾ មិនកំណត់ រហូតដល់ ${until}\n\n` +
      `🔒 ក្រុម / channel ឯកជន (t.me/c/...)\n` +
      `🎬 វីដេអូពេញទំហំ — គ្មានកម្រិត 50MB\n` +
      `⚡ ផ្ញើមកវិញភ្លាម\n\n` +
      `👉 បើក post វីដេអូ → ចុចលើវា → Copy Link → ផ្ញើមកទីនេះ`,
    proScreenEmpty: (bar, total) =>
      `👑 SaveIt Pro — Telegram\n\n` +
      `${bar}  ${total}/${total}\n` +
      `⛔ អ្នកប្រើអស់វីដេអូឥតគិតថ្លៃហើយ\n\n` +
      `ដើម្បីបន្ត៖\n` +
      `💎 ទិញកញ្ចប់វីដេអូ ឬ VIP មិនកំណត់\n` +
      `👥 ណែនាំមិត្ត ១ នាក់ = +5 វីដេអូឥតគិតថ្លៃ\n\n` +
      `💡 YouTube · FB · IG · TikTok នៅតែ ឥតគិតថ្លៃ មិនកំណត់ ♾`,
    proOwnAccount:
      `\n\n➕ ចង់ទាញពីក្រុមឯកជនរបស់អ្នកផ្ទាល់? ភ្ជាប់គណនី Telegram\n` +
      `      ក្នុង 🖥 បើកកម្មវិធី → ការកំណត់ → Telegram (ស្ម័គ្រចិត្ត)`,
    notALink: "នោះមិនមែនជាតំណទេ។ សូមផ្ញើតំណដែលចាប់ផ្ដើមដោយ http:// ឬ https://។",
    working: "⏳ កំពុងដំណើរការ… ខ្ញុំនឹងផ្ញើមកវិញពេលរួច។",
    queued: "✅ បានបញ្ចូលក្នុងជួរ។ ខ្ញុំនឹងផ្ញើមកវិញពេលទាញយករួច (អាចចំណាយពេលពីរបីនាទីសម្រាប់វីដេអូវែង)។",
    quotaOver: (total) =>
      `⛔ អ្នកប្រើអស់ ${total} វីដេអូ Telegram ឥតគិតថ្លៃហើយ។\n\n` +
      `💎 ទិញ / VIP ដើម្បីបន្ត ឬ 👥 ណែនាំមិត្ត = +5 វីដេអូ\n` +
      `💡 YouTube · FB · IG · TikTok នៅតែ ឥតគិតថ្លៃ មិនកំណត់ ♾`,
    doneWithLink: (name, url) => `✅ រួចរាល់៖ ${name}\n\n🔗 ${url}`,
    doneNoLink: (name) => `✅ រួចរាល់៖ ${name}`,
    failed: (reason) => `❌ ទាញយកមិនបាន៖ ${reason}`,
    tooBig: (mb) => `ឯកសារនេះ ${mb}MB ធំជាងកំណត់ 50MB របស់ Telegram សម្រាប់ bot — ខ្ញុំផ្ញើជាតំណជំនួស។`,
    noMedia: "សាររបស់តំណនោះគ្មានវីដេអូ ឬសំឡេងទេ។",
    privateVipOnly: "🔒 តំណ Telegram បិទជាបណ្ដោះអាសន្នដោយអ្នកគ្រប់គ្រង។",
    privateNoAccess: "🔒 មិនអាចចូលមើល chat ឯកជននោះបានទេ — គណនីរបស់ bot មិនមែនជាសមាជិកនៅក្នុងនោះទេ។",
    inviteLink: "នោះជាតំណអញ្ជើញ (t.me/+...) មិនមែនតំណទៅកាន់ post ទេ។ សូមចូលក្នុង post វីដេអូ → ចុចលើវា → Copy Link រួចផ្ញើតំណនោះមក។",
    sendingVideo: "📤 កំពុងផ្ញើវីដេអូ…",
  },
  en: {
    welcome: (name) =>
      `👋 Hi ${name}! This is SaveIt KH\n\n` +
      `I download videos and songs:\n\n` +
      `🆓 SaveIt Free — free & unlimited ♾\n` +
      `      YouTube · Facebook · Instagram · TikTok · X\n\n` +
      `👑 SaveIt Pro — Telegram (private groups/channels)\n` +
      `      🎁 10 videos free to try\n` +
      `      🎬 Full-size video, no 50MB limit\n\n` +
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
    freeScreen: () =>
      `🆓 SaveIt Free — free & unlimited\n\n` +
      `▶️ YouTube     📘 Facebook\n` +
      `📸 Instagram   🎵 TikTok\n` +
      `✖️ X (Twitter)  🎮 Twitch\n` +
      `🔗 .mp4 · .m3u8 · .mp3\n` +
      `➕ ~1800 more sites\n\n` +
      `♾ As many as you like — no charge, no limit\n\n` +
      `👉 Send a link now\n` +
      `💡 Want audio only? Write audio after the link`,
    proScreenTrial: (bar, used, total, left) =>
      `👑 SaveIt Pro — Telegram\n\n` +
      `🎁 Free trial: ${total} videos\n` +
      `${bar}  ${used}/${total}\n` +
      `✅ ${left} left\n\n` +
      `Download from:\n` +
      `🔒 Private groups / channels (t.me/c/...)\n` +
      `📢 Public channels (t.me/...)\n` +
      `🎬 Full-size video — no 50MB limit\n` +
      `⚡ Delivered instantly\n\n` +
      `👉 Open the video post → tap it → Copy Link → send it here`,
    proScreenVip: (until) =>
      `👑 SaveIt Pro — VIP\n\n` +
      `♾ Unlimited until ${until}\n\n` +
      `🔒 Private groups / channels (t.me/c/...)\n` +
      `🎬 Full-size video — no 50MB limit\n` +
      `⚡ Delivered instantly\n\n` +
      `👉 Open the video post → tap it → Copy Link → send it here`,
    proScreenEmpty: (bar, total) =>
      `👑 SaveIt Pro — Telegram\n\n` +
      `${bar}  ${total}/${total}\n` +
      `⛔ Your free videos are used up\n\n` +
      `To keep going:\n` +
      `💎 Buy a video pack, or VIP unlimited\n` +
      `👥 Refer a friend = +5 free videos\n\n` +
      `💡 YouTube · FB · IG · TikTok stay free and unlimited ♾`,
    proOwnAccount:
      `\n\n➕ Want your own private groups? Link your Telegram account\n` +
      `      in 🖥 Open app → Settings → Telegram (optional)`,
    notALink: "That isn't a link. Send something starting with http:// or https://.",
    working: "⏳ Working on it… I'll send it back when it's ready.",
    queued: "✅ Queued. I'll send it back once it's downloaded (a long video can take a few minutes).",
    quotaOver: (total) =>
      `⛔ You've used all ${total} free Telegram videos.\n\n` +
      `💎 Buy / VIP to keep going, or 👥 refer a friend = +5 videos\n` +
      `💡 YouTube · FB · IG · TikTok stay free and unlimited ♾`,
    doneWithLink: (name, url) => `✅ Done: ${name}\n\n🔗 ${url}`,
    doneNoLink: (name) => `✅ Done: ${name}`,
    failed: (reason) => `❌ Download failed: ${reason}`,
    tooBig: (mb) => `That file is ${mb}MB, over Telegram's 50MB bot upload limit — here's a link instead.`,
    noMedia: "That message has no video or audio in it.",
    privateVipOnly: "🔒 Telegram links are switched off by the operator for now.",
    privateNoAccess: "🔒 Can't open that private chat — the bot's account isn't a member of it.",
    inviteLink: "That's an invite link (t.me/+...), not a link to a post. Open the video post → tap it → Copy Link, and send that.",
    sendingVideo: "📤 Sending the video…",
  },
};

/** The string table for a language, falling back to Khmer (the default audience). */
export function texts(language) {
  return TEXT[language] ?? TEXT.km;
}
