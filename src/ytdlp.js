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

/** Runs yt-dlp once, resolving with its outcome instead of throwing, so the caller can decide whether to retry. */
function runOnce(sourceUrl, referer, outputPath) {
  return new Promise((resolve) => {
    const args = [
      "--no-check-certificate",
      "--continue",
      "-N", "1",
      "--socket-timeout", "60",
      "--retries", "20",
      "--fragment-retries", "20",
      "--retry-sleep", "fragment:exp=1:30",
      "--retry-sleep", "http:exp=1:30",
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

    const child = spawn("yt-dlp", args);
    let lastErrLine = "";
    child.stderr.on("data", (chunk) => {
      const lines = chunk.toString("utf8").split(/\r?\n/).filter(Boolean);
      if (lines.length) lastErrLine = lines[lines.length - 1].slice(0, 400);
    });
    child.on("error", (err) => resolve({ ok: false, error: `Could not start yt-dlp: ${err.message}` }));
    child.on("close", (code) => {
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
export async function downloadWithYtdlp(sourceUrl, referer, fileNameHint) {
  await fs.mkdir(config.downloadDir, { recursive: true });
  const localPath = path.join(config.downloadDir, `ytdlp-${Date.now()}-${fileNameHint || "video.mp4"}`);

  let lastError = "Unknown error.";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const result = await runOnce(sourceUrl, referer, localPath);
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
