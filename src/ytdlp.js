/**
 * Downloads a video from (almost) any URL via yt-dlp -- not just HLS
 * playlists. yt-dlp's generic extractor covers 1800+ sites (pulling the real
 * media URL out of a webpage when the pasted link isn't a direct file), and
 * still handles a raw .m3u8/.mp4 link the same way a plain fetch would.
 * urlfetch.js only takes the fast plain-fetch path for a URL that is
 * obviously a direct file already; everything else comes through here.
 * Requires yt-dlp and ffmpeg on PATH (see the Dockerfile).
 *
 * A source URL is often short-lived, geofenced or behind a login, so a
 * failure here is usually "the link expired/blocked," not a bug -- this
 * retries the whole yt-dlp invocation several times with backoff
 * (--continue resumes from whatever fragments already landed) before giving
 * up, and always surfaces yt-dlp's own last error line rather than a
 * generic message.
 */
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

import { config } from "./config.js";

const MAX_ATTEMPTS = 6;
const BACKOFF_SECONDS = 15;
// A CDN can accept the connection and then just never send another byte --
// no error, no close, nothing -- and yt-dlp itself has no built-in ceiling
// for that (--socket-timeout only covers a single read/connect, not the
// whole process sitting idle). Without this, one bad request hangs the
// item, and the slot it holds, forever: the retry loop below never even
// gets a chance to run. Real activity (a fragment finishing, a retry
// message) resets this on every stdout/stderr byte, so an active-but-slow
// download is never penalized -- only true silence is.
const STALL_TIMEOUT_MS = 120_000;

const DIRECT_FILE_EXT = /\.(mp4|mkv|webm|mov|avi|flv|ts|m4v|mp3|m4a|wav|flac|aac|ogg)(\?|$)/i;

/**
 * True when the URL's own path already ends in a known media extension --
 * urlfetch.js takes the fast plain-fetch-and-stream path for these.
 * Everything else (an .m3u8 playlist, a DASH manifest, or a plain webpage
 * with a player embedded in it) goes through yt-dlp instead, since a plain
 * fetch of those would only ever save the HTML/manifest, not a video.
 */
export function isDirectFileUrl(url) {
  try {
    return DIRECT_FILE_EXT.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

function originOf(refererUrl) {
  try {
    const parsed = new URL(refererUrl);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return "";
  }
}

const PROGRESS_RE = /\[download\]\s+(\d+(?:\.\d+)?)%/;

/** Runs yt-dlp once, resolving with its outcome instead of throwing, so the caller can decide whether to retry. */
function runOnce(sourceUrl, referer, outputPath, onProgress) {
  return new Promise((resolve) => {
    const args = [
      "--no-check-certificate",
      "--continue",
      // One progress line per update instead of the default single
      // carriage-return-rewritten line -- onProgress below reads whichever
      // one arrived most recently, but a raw \r-only stream can arrive
      // split across chunk boundaries in a way that hides the percentage
      // entirely until the next write.
      "--newline",
      "-N", "1",
      "--socket-timeout", "60",
      "--retries", "20",
      "--fragment-retries", "20",
      "--retry-sleep", "fragment:exp=1:30",
      "--retry-sleep", "http:exp=1:30",
      // yt-dlp's own default for HLS is to skip a fragment it can't fetch
      // after retries and still exit 0 -- so a mid-download token expiry or
      // a flaky CDN silently hands back a shorter, truncated video with no
      // error at all. Turning that off makes a lost fragment abort the run
      // instead, so downloadWithYtdlp's retry loop below (with --continue,
      // which resumes from the fragments already on disk) actually gets a
      // chance to finish the file, rather than the caller mistaking a
      // partial merge for a completed download.
      "--no-skip-unavailable-fragments",
      // Some Cloudflare-fronted CDNs wave a cached manifest through but bot-
      // check every uncached request past it by TLS/HTTP fingerprint, not
      // just headers -- so segment fetches 403 even with a correct Referer
      // and User-Agent. --impersonate makes yt-dlp's requests (via
      // curl_cffi, installed in the Dockerfile) look like an actual Chrome
      // TLS handshake instead of Python's, which such checks accept.
      "--impersonate", "chrome",
      // --impersonate covers the page/manifest fetch (curl_cffi), but
      // confirmed live against tk12000real.com: yt-dlp's native HLS
      // fragment downloader doesn't carry that same impersonated TLS
      // handshake over to individual .ts segment requests, so they still
      // 403/404 ("fragment 1 not found") even with it on. Routing HLS
      // segment fetches through ffmpeg instead gives them ffmpeg's own
      // TLS stack, which is a different fingerprint than yt-dlp/Python's
      // default and isn't caught by the same check.
      "--downloader", "m3u8:ffmpeg",
      // ffmpeg has its own reconnect logic (yt-dlp's --retries/--fragment-
      // retries/--no-skip-unavailable-fragments above are native-downloader
      // options and don't reach ffmpeg once it's doing the fetching) -- ask
      // for the same "keep trying on a dropped connection" behavior here.
      "--downloader-args", "ffmpeg:-reconnect 1 -reconnect_streamed 1 -reconnect_delay_max 5",
      "--format", "bestvideo+bestaudio/best",
      "--merge-output-format", "mp4",
      "-o", outputPath,
      sourceUrl,
    ];
    if (config.ytdlpCookiesFile) {
      args.unshift("--cookies", config.ytdlpCookiesFile);
    }
    if (referer) {
      args.unshift("--add-header", `Origin: ${originOf(referer)}`);
      args.unshift("--add-header", `User-Agent: ${config.m3u8UserAgent}`);
      args.unshift("--referer", referer);
    }

    // yt-dlp is Python, and Python fully block-buffers stdout (not just
    // line-buffers it) whenever it isn't a TTY -- which a Node child_process
    // pipe never is. Without this, --newline's progress lines sit in an
    // internal buffer for minutes (often until the whole run ends) instead
    // of reaching onProgress as they're printed.
    const child = spawn("yt-dlp", args, { env: { ...process.env, PYTHONUNBUFFERED: "1" } });
    let lastErrLine = "";
    let settled = false;

    let stallTimer = setTimeout(onStall, STALL_TIMEOUT_MS);
    function bumpStallTimer() {
      clearTimeout(stallTimer);
      stallTimer = setTimeout(onStall, STALL_TIMEOUT_MS);
    }
    function onStall() {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      resolve({
        ok: false,
        error: `yt-dlp produced no output for ${STALL_TIMEOUT_MS / 1000}s and was killed -- likely the CDN accepted the connection and then went silent.`,
      });
    }

    child.stderr.on("data", (chunk) => {
      bumpStallTimer();
      const lines = chunk.toString("utf8").split(/\r?\n/).filter(Boolean);
      if (lines.length) lastErrLine = lines[lines.length - 1].slice(0, 400);
    });
    child.stdout.on("data", (chunk) => {
      bumpStallTimer();
      if (!onProgress) return;
      const match = PROGRESS_RE.exec(chunk.toString("utf8"));
      if (match) onProgress(Math.min(99, Math.round(Number.parseFloat(match[1]))));
    });
    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(stallTimer);
      resolve({ ok: false, error: `Could not start yt-dlp: ${err.message}` });
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(stallTimer);
      if (code === 0) resolve({ ok: true });
      else resolve({ ok: false, error: lastErrLine || `yt-dlp exited with code ${code}.` });
    });
  });
}

/**
 * Downloads the source to a local temp file, retrying the whole run on
 * failure. The caller uploads that file to R2 and is responsible for
 * deleting it afterward (same contract as downloader.js/linkBot.js).
 */
export async function downloadWithYtdlp(sourceUrl, referer, fileNameHint, onProgress) {
  await fs.mkdir(config.downloadDir, { recursive: true });
  const localPath = path.join(config.downloadDir, `ytdlp-${Date.now()}-${fileNameHint || "video.mp4"}`);

  let lastError = "Unknown error.";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const result = await runOnce(sourceUrl, referer, localPath, onProgress);
    if (result.ok) {
      const stat = await fs.stat(localPath).catch(() => null);
      if (stat && stat.size > 0) return localPath;
      lastError = "The downloaded file is empty.";
    } else {
      lastError = result.error;
    }

    if (attempt < MAX_ATTEMPTS) {
      console.error(
        `yt-dlp download attempt ${attempt}/${MAX_ATTEMPTS} failed (${lastError}); retrying in ${BACKOFF_SECONDS * attempt}s...`
      );
      await new Promise((resolve) => setTimeout(resolve, BACKOFF_SECONDS * attempt * 1000));
    }
  }

  await fs.rm(localPath, { force: true }).catch(() => {});
  throw new Error(`yt-dlp failed after ${MAX_ATTEMPTS} attempts: ${lastError}`);
}
