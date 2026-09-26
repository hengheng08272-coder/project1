/**
 * Draws the familiar KHQR ticket around a generated QR.
 *
 * Ported from the telegrambot- app's KhqrCard component, which exists for a
 * good reason: a QR the owner uploads is usually a whole ticket graphic --
 * red KHQR band, name, amount -- while a payload we generate renders as a
 * bare black-and-white square. Same payment, but the bare square reads as
 * less trustworthy at exactly the moment somebody is handing over money.
 *
 * That component draws its chrome in CSS, which is no use for a photo a bot
 * sends, so this composes the same ticket as pixels: the red band with its
 * clipped corner, the real KHQR mark (the repo's own artwork, recoloured
 * white, so no font is needed for the one word that must look official), and
 * the QR beneath a dashed rule. The merchant name and amount ride in the
 * message caption, where Telegram renders them in the reader's own font.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { PNG } from "pngjs";
import QRCode from "qrcode";

const LOGO_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "assets", "khqr-logo.png");
const RED = [225, 27, 36];
const WHITE = [255, 255, 255];
const DASH = [220, 220, 220];

// undefined = not tried yet; null = tried and unavailable.
let logoCache;
/**
 * The KHQR mark, or null when it cannot be read. A missing decoration must
 * never stop someone paying: without the file, the ticket is drawn with a
 * plain red band and the QR still works.
 */
function khqrLogo() {
  if (logoCache === undefined) {
    try {
      logoCache = PNG.sync.read(fs.readFileSync(LOGO_PATH));
    } catch (err) {
      console.error("KHQR logo unavailable, drawing the ticket without it:", err?.message ?? err);
      logoCache = null;
    }
  }
  return logoCache;
}

function setPixel(png, x, y, [r, g, b], alpha = 255) {
  if (x < 0 || y < 0 || x >= png.width || y >= png.height) return;
  const i = (png.width * y + x) << 2;
  if (alpha >= 255) {
    png.data[i] = r;
    png.data[i + 1] = g;
    png.data[i + 2] = b;
    png.data[i + 3] = 255;
    return;
  }
  // Source-over onto whatever is already there, so edges land softly
  // instead of showing the jagged step a hard test would leave.
  const a = alpha / 255;
  const base = png.data[i + 3] ? 1 : 0;
  png.data[i] = Math.round(r * a + png.data[i] * base * (1 - a));
  png.data[i + 1] = Math.round(g * a + png.data[i + 1] * base * (1 - a));
  png.data[i + 2] = Math.round(b * a + png.data[i + 2] * base * (1 - a));
  png.data[i + 3] = Math.max(png.data[i + 3], Math.round(255 * a));
}

/** Rounded rectangle, anti-aliased on the curves. */
function fillRoundedRect(png, x0, y0, w, h, radius, colour) {
  for (let y = y0; y < y0 + h; y += 1) {
    for (let x = x0; x < x0 + w; x += 1) {
      // Distance past the corner circle, measured per corner.
      const dx = Math.max(x0 + radius - x, x - (x0 + w - 1 - radius), 0);
      const dy = Math.max(y0 + radius - y, y - (y0 + h - 1 - radius), 0);
      if (dx === 0 || dy === 0) {
        setPixel(png, x, y, colour);
        continue;
      }
      const d = Math.hypot(dx, dy);
      if (d <= radius - 0.5) setPixel(png, x, y, colour);
      else if (d < radius + 0.5) setPixel(png, x, y, colour, Math.round((radius + 0.5 - d) * 255));
    }
  }
}

/** Box-filter downscale -- a QR or a logo shrunk by nearest-neighbour turns to mush. */
function resample(src, outW, outH) {
  const out = new PNG({ width: outW, height: outH });
  const sx = src.width / outW;
  const sy = src.height / outH;
  for (let y = 0; y < outH; y += 1) {
    for (let x = 0; x < outW; x += 1) {
      const x0 = Math.floor(x * sx);
      const x1 = Math.max(Math.ceil((x + 1) * sx), x0 + 1);
      const y0 = Math.floor(y * sy);
      const y1 = Math.max(Math.ceil((y + 1) * sy), y0 + 1);
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let yy = y0; yy < y1 && yy < src.height; yy += 1) {
        for (let xx = x0; xx < x1 && xx < src.width; xx += 1) {
          const i = (src.width * yy + xx) << 2;
          r += src.data[i];
          g += src.data[i + 1];
          b += src.data[i + 2];
          a += src.data[i + 3];
          n += 1;
        }
      }
      const o = (outW * y + x) << 2;
      out.data[o] = Math.round(r / n);
      out.data[o + 1] = Math.round(g / n);
      out.data[o + 2] = Math.round(b / n);
      out.data[o + 3] = Math.round(a / n);
    }
  }
  return out;
}

/** Stamps an image, treating its alpha as coverage, optionally recoloured. */
function composite(png, src, atX, atY, tint = null) {
  for (let y = 0; y < src.height; y += 1) {
    for (let x = 0; x < src.width; x += 1) {
      const i = (src.width * y + x) << 2;
      const alpha = src.data[i + 3];
      if (!alpha) continue;
      const colour = tint ?? [src.data[i], src.data[i + 1], src.data[i + 2]];
      setPixel(png, atX + x, atY + y, colour, alpha);
    }
  }
}

/**
 * Renders the ticket. `width` is the whole card; 360 suits a Telegram photo,
 * which is shown small in the chat and only enlarged on a tap -- the old
 * 720px bare QR was wallpaper by comparison.
 */
export async function renderKhqrCard(payload, { width = 360 } = {}) {
  const pad = Math.round(width * 0.055);
  const headerH = Math.round(width * 0.145);
  const qrSize = width - pad * 2;
  const dividerY = headerH + Math.round(pad * 0.9);
  const height = dividerY + pad + qrSize + pad;
  const radius = Math.round(width * 0.05);

  const card = new PNG({ width, height, fill: true });
  card.data.fill(0);
  fillRoundedRect(card, 0, 0, width, height, radius, WHITE);

  // Header band, with the KHQR ticket's own clipped bottom-right corner --
  // the shape is part of how the ticket is recognised, and being a shape it
  // needs no artwork.
  // clipPath: polygon(0 0, 100% 0, 100% 55%, 88% 100%, 0 100%) -- the band
  // keeps its full width until 55% of the way down, then its right edge runs
  // diagonally in to 88% at the bottom.
  const notchX = width * 0.88;
  const notchY = headerH * 0.55;
  for (let y = 0; y < headerH; y += 1) {
    const rightEdge =
      y <= notchY ? width : width - ((y - notchY) / (headerH - notchY)) * (width - notchX);
    for (let x = 0; x < width; x += 1) {
      if (x >= rightEdge) {
        // Feather the diagonal itself so it does not come out as a staircase.
        if (x < rightEdge + 1) setPixel(card, x, y, RED, Math.round((rightEdge + 1 - x) * 255));
        continue;
      }
      const dx = Math.max(radius - x, x - (width - 1 - radius), 0);
      const dy = Math.max(radius - y, 0);
      if (dx > 0 && dy > 0) {
        const d = Math.hypot(dx, dy);
        if (d > radius + 0.5) continue;
        if (d > radius - 0.5) {
          setPixel(card, x, y, RED, Math.round((radius + 0.5 - d) * 255));
          continue;
        }
      }
      setPixel(card, x, y, RED);
    }
  }

  // The KHQR mark, recoloured white so it reads on the red band.
  const logo = khqrLogo();
  if (logo) {
    const logoW = Math.round(width * 0.3);
    const logoH = Math.max(1, Math.round((logo.height / logo.width) * logoW));
    composite(card, resample(logo, logoW, logoH), Math.round((width - logoW) / 2), Math.round((headerH - logoH) / 2), WHITE);
  }

  // Dashed rule, exactly as the ticket prints it.
  for (let x = pad; x < width - pad; x += 1) {
    if (Math.floor(x / 5) % 2 === 0) setPixel(card, x, dividerY, DASH);
  }

  const qrPng = PNG.sync.read(
    await QRCode.toBuffer(payload, { type: "png", width: qrSize, margin: 1, errorCorrectionLevel: "M" })
  );
  composite(card, qrPng.width === qrSize ? qrPng : resample(qrPng, qrSize, qrSize), pad, dividerY + pad);

  return PNG.sync.write(card);
}
