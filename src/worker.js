/** Background loop: auto rules, the download queue, and auto-following forwards. */
import { db, rows } from "./db.js";
import { config } from "./config.js";
import * as botJobs from "./botJobs.js";
import { applyAutoRules, processQueue } from "./downloader.js";
import * as forwarder from "./forwarder.js";
import * as mirror from "./mirror.js";
import { scanGroup } from "./scanner.js";
import { isAuthorized } from "./telegram.js";
import * as urlfetch from "./urlfetch.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Runs one pass every WORKER_INTERVAL seconds until the process stops. */
export async function loop() {
  for (;;) {
    try {
      // Saving list URLs into R2 is plain HTTP: it must keep working while the
      // userbot is signed out, so it runs outside the Telegram-only pass.
      const savingUrls = await urlfetch.processQueue();
      if (savingUrls) console.log(`Started saving ${savingUrls} URL(s) to R2`);

      // Bot downloads ride that same queue, so this is where a finished one
      // gets sent back to whoever asked for it in Telegram.
      const botReplies = await botJobs.notifyFinishedJobs();
      if (botReplies) console.log(`Sent ${botReplies} finished download(s) back to the bot`);

      if (await isAuthorized()) await onePass();
    } catch (err) {
      // A bad pass must never kill the loop.
      console.error("Worker pass failed:", err?.message ?? err);
    }
    await sleep(config.workerInterval * 1000);
  }
}

// scanGroup's own default is a full, unbounded history walk -- right for a
// manual "Scan" click, since the user is waiting for a complete result. This
// job instead runs unattended every few minutes, so it caps each pass to
// recent messages: new episodes land near the top of the history anyway, and
// re-walking the entire history on every tick would only add load and flood
// risk for a large group without finding anything a previous full scan (or
// the next manual one) hasn't already.
const AUTO_RESCAN_MESSAGE_LIMIT = 3000;

/**
 * Re-scans any group with auto_rescan on whose last scan is older than
 * config.autoRescanMinutes -- a lighter, recent-only pass (see
 * AUTO_RESCAN_MESSAGE_LIMIT above), not the full history walk a manual
 * "Scan" click does. A manual/URL-list group (chat_id "manual:...") is never
 * a real Telegram chat, so it's excluded rather than left to fail.
 */
async function autoRescanGroups() {
  const cutoff = new Date(Date.now() - config.autoRescanMinutes * 60 * 1000).toISOString();
  const groups = rows(
    await db()
      .from("groups")
      .select("id, chat_id, last_scanned_at")
      .eq("auto_rescan", true)
      .not("chat_id", "like", "manual:%")
  );
  const due = groups.filter((g) => !g.last_scanned_at || g.last_scanned_at < cutoff);

  let rescanned = 0;
  for (const group of due) {
    try {
      await scanGroup(group.id, AUTO_RESCAN_MESSAGE_LIMIT);
      rescanned += 1;
    } catch (err) {
      console.error(`Auto-rescan of group ${group.id} failed:`, err?.message ?? err);
    }
  }
  return rescanned;
}

async function onePass() {
  const rescanned = await autoRescanGroups();
  if (rescanned) console.log(`Auto-rescan refreshed ${rescanned} group(s)`);

  const { queued } = await applyAutoRules();
  if (queued) console.log(`Auto rules queued ${queued} episode(s)`);

  const started = await processQueue();
  if (started) console.log(`Started ${started} download(s)`);

  const added = await forwarder.syncAutoFollowJobs();
  if (added) console.log(`Auto-follow added ${added} video(s) to forward jobs`);

  const pending = rows(
    await db().from("forward_jobs").select("id, mirror_id").eq("status", "queued").limit(3)
  );
  for (const job of pending) {
    try {
      await forwarder.runJob(job.id);
    } catch (err) {
      console.error(`Forward job ${job.id} failed:`, err?.message ?? err);
    }
    if (job.mirror_id) await mirror.refreshStatus(job.mirror_id).catch(() => {});
  }
}
