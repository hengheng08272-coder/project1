/**
 * Downloads an HLS (.m3u8) stream via yt-dlp instead of a plain fetch --
 * urlfetch.js's normal path can't stitch fragments together or attach the
 * Referer/Origin headers many drama-streaming CDNs require. Requires yt-dlp
 * and ffmpeg on PATH (see the Dockerfile).
 *
 * A source's .m3u8 URL is often short-lived, so failures here are usually
 * "the link expired mid-download," not a bug -- this retries the whole
 * yt-dlp invocation several times with backoff (--continue resumes from
 * whatever fragments already landed) before giving up, and always surfaces
 * yt-dlp's own last error line rather than a generic message.
 */
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

import { config } from "./config.js";

const MAX_ATTEMPTS = 6;
const BACKOFF_SECONDS = 15;

/** True for a URL that looks like an HLS playlist, the only thing this module handles. */
export function isM3u8Url(url) {
  try {
    return /\.m3u8(\?|$)/i.test(new URL(url).pathname + new URL(url).search);
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
function runOnce(m3u8Url, referer, outputPath) {
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
      "-o", outputPath,
      m3u8Url,
    ];
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
 * Downloads the stream to a local temp file, retrying the whole run on
 * failure. The caller uploads that file to R2 and is responsible for
 * deleting it afterward (same contract as downloader.js/linkBot.js).
 */
export async function downloadM3u8(m3u8Url, referer, fileNameHint) {
  await fs.mkdir(config.downloadDir, { recursive: true });
  const localPath = path.join(config.downloadDir, `m3u8-${Date.now()}-${fileNameHint || "video.mp4"}`);

  let lastError = "Unknown error.";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const result = await runOnce(m3u8Url, referer, localPath);
    if (result.ok) {
      const stat = await fs.stat(localPath).catch(() => null);
      if (stat && stat.size > 0) return localPath;
      lastError = "The downloaded file is empty.";
    } else {
      lastError = result.error;
    }

    if (attempt < MAX_ATTEMPTS) {
      console.error(
        `m3u8 download attempt ${attempt}/${MAX_ATTEMPTS} failed (${lastError}); retrying in ${BACKOFF_SECONDS * attempt}s...`
      );
      await new Promise((resolve) => setTimeout(resolve, BACKOFF_SECONDS * attempt * 1000));
    }
  }

  await fs.rm(localPath, { force: true }).catch(() => {});
  throw new Error(`yt-dlp failed after ${MAX_ATTEMPTS} attempts: ${lastError}`);
}
