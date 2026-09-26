/**
 * The payment ticket the bot sends as a photo, modelled on the telegrambot-
 * app's pay screen: a dark "pass" with a blue band (what is being bought and
 * the ticket number), and inside it the familiar white KHQR card -- red
 * band, payee, amount, QR with the Bakong mark in the middle -- then the
 * banks that can scan it.
 *
 * Drawn with @napi-rs/canvas and fonts shipped in assets/fonts, so it needs
 * nothing from the system. The payee and amount are read from the payload
 * itself, so the picture can never disagree with what the bank will show.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createCanvas, GlobalFonts, loadImage } from "@napi-rs/canvas";
import QRCode from "qrcode";

import { parseKhqr } from "./khqr.js";

const ASSETS = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "assets");

let fontsReady = false;
function registerFonts() {
  if (fontsReady) return;
  fontsReady = true;
  const fonts = [
    ["Inter_600SemiBold.ttf", "Inter"],
    ["Inter_800ExtraBold.ttf", "Inter"],
    ["Battambang_400Regular.ttf", "Battambang"],
    ["Battambang_700Bold.ttf", "Battambang"],
  ];
  for (const [file, family] of fonts) {
    try {
      GlobalFonts.registerFromPath(path.join(ASSETS, "fonts", file), family);
    } catch (err) {
      console.error(`Font ${file} unavailable:`, err?.message ?? err);
    }
  }
}

// Decorations are cached and optional: a missing file just leaves a gap,
// it never stops someone paying.
const imageCache = new Map();
async function asset(relative) {
  if (!imageCache.has(relative)) {
    imageCache.set(
      relative,
      loadImage(path.join(ASSETS, relative)).catch((err) => {
        console.error(`KHQR ticket asset ${relative} unavailable:`, err?.message ?? err);
        return null;
      })
    );
  }
  return imageCache.get(relative);
}

const C = {
  page: "#0B1224",
  panel: "#111A2E",
  panelEdge: "#1F2B47",
  bandFrom: "#1D3FAE",
  bandTo: "#2563EB",
  red: "#E11B24",
  ink: "#111111",
  muted: "#8A8A8A",
  soft: "#94A3B8",
  dash: "#DCDCDC",
};

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/** Text with letter spacing, drawn a glyph at a time (canvas spacing support varies). */
function spaced(g, text, x, y, spacing, align = "left") {
  const widths = [...text].map((ch) => g.measureText(ch).width);
  const total = widths.reduce((a, w) => a + w, 0) + spacing * (widths.length - 1);
  let cx = align === "center" ? x - total / 2 : align === "right" ? x - total : x;
  const saved = g.textAlign;
  g.textAlign = "left";
  [...text].forEach((ch, i) => {
    g.fillText(ch, cx, y);
    cx += widths[i] + spacing;
  });
  g.textAlign = saved;
}

function ellipsize(g, text, maxWidth) {
  if (g.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && g.measureText(`${t}…`).width > maxWidth) t = t.slice(0, -1);
  return `${t}…`;
}

function dashedLine(g, x0, x1, y, colour, dash = 5, gap = 4) {
  g.save();
  g.strokeStyle = colour;
  g.lineWidth = 1;
  g.setLineDash([dash, gap]);
  g.beginPath();
  g.moveTo(x0, y + 0.5);
  g.lineTo(x1, y + 0.5);
  g.stroke();
  g.restore();
}

function payloadFacts(payload) {
  const fields = parseKhqr(payload) ?? [];
  const get = (tag) => fields.find((f) => f.tag === tag)?.value ?? null;
  const currency = get("53") === "116" ? "KHR" : "USD";
  const amount = Number(get("54") ?? 0);
  const value =
    currency === "KHR"
      ? Math.round(amount).toLocaleString("en-US")
      : amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return { name: get("59") ?? "", value, currency };
}

/** Draws the QR modules crisply at an exact pixel size. */
function drawQr(g, payload, x, y, size) {
  // H: survives the ~20% the centre mark covers, with room to spare.
  const qr = QRCode.create(payload, { errorCorrectionLevel: "H" });
  const n = qr.modules.size;
  const quiet = 1;
  const cell = size / (n + quiet * 2);
  g.fillStyle = "#FFFFFF";
  g.fillRect(x, y, size, size);
  g.fillStyle = "#0A101E";
  for (let r = 0; r < n; r += 1) {
    for (let c = 0; c < n; c += 1) {
      if (qr.modules.get(r, c)) {
        const px = x + (c + quiet) * cell;
        const py = y + (r + quiet) * cell;
        // Rounded out to whole pixels so neighbouring modules meet without hairlines.
        g.fillRect(Math.floor(px), Math.floor(py), Math.ceil(px + cell) - Math.floor(px), Math.ceil(py + cell) - Math.floor(py));
      }
    }
  }
}

async function drawCentreMark(g, cx, cy, qrSize) {
  const outer = qrSize * 0.1;
  g.fillStyle = "rgba(0,0,0,0.16)";
  g.beginPath();
  g.arc(cx, cy + outer * 0.05, outer * 1.04, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#FFFFFF";
  g.beginPath();
  g.arc(cx, cy, outer, 0, Math.PI * 2);
  g.fill();
  const mark = await asset("bakong-mark.png");
  const size = outer * 1.55;
  if (mark) {
    g.drawImage(mark, cx - size / 2, cy - size / 2, size, size);
  } else {
    g.fillStyle = C.red;
    g.beginPath();
    g.arc(cx, cy, outer * 0.86, 0, Math.PI * 2);
    g.fill();
  }
}

/**
 * Renders the ticket as a PNG buffer.
 *   title    -- the band's left label, e.g. "SAVEIT PRO"
 *   subtitle -- what is being bought, e.g. "VIP 30 ថ្ងៃ"
 *   ticket   -- the order's ticket number, top right
 * Drawn at 2x a 320-point layout: small in the chat, sharp when opened.
 */
export async function renderKhqrCard(payload, { title = "SAVEIT KH", subtitle = "", ticket = "", scale = 2 } = {}) {
  registerFonts();
  const facts = payloadFacts(payload);
  // The ticket fonts have no emoji; package titles often start with one.
  const plain = (text) => String(text).replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu, "").replace(/\s+/g, " ").trim();
  title = plain(title);
  subtitle = plain(subtitle);

  const W = 320;
  const pad = 14;
  const bandH = 40;
  const cardW = 200;
  const cardPad = 12;
  const redH = 28;
  const qrSize = cardW - cardPad * 2;
  const cardH = redH + 8 + 16 + 26 + 10 + qrSize + cardPad;
  const headTop = pad + bandH;
  const perfY = headTop + 58;
  const cardY = perfY + 16;
  const banksY = cardY + cardH + 16;
  const H = banksY + 26 + 30 + pad;

  const canvas = createCanvas(W * scale, H * scale);
  const g = canvas.getContext("2d");
  g.scale(scale, scale);
  g.textBaseline = "alphabetic";

  // Page and pass.
  g.fillStyle = C.page;
  g.fillRect(0, 0, W, H);
  roundRect(g, pad - 6, pad - 6, W - (pad - 6) * 2, H - (pad - 6) * 2, 20);
  g.fillStyle = C.panel;
  g.fill();
  g.strokeStyle = C.panelEdge;
  g.lineWidth = 1;
  g.stroke();

  // Blue band, rounded only on top.
  g.save();
  roundRect(g, pad - 6, pad - 6, W - (pad - 6) * 2, H - (pad - 6) * 2, 20);
  g.clip();
  const band = g.createLinearGradient(0, 0, W, 0);
  band.addColorStop(0, C.bandFrom);
  band.addColorStop(1, C.bandTo);
  g.fillStyle = band;
  g.fillRect(0, 0, W, headTop);
  g.restore();
  g.fillStyle = "#FFFFFF";
  g.font = "800 14px Inter";
  spaced(g, title.toUpperCase(), pad + 6, pad + 20, 2.2);
  if (ticket) {
    g.font = "600 11px Inter";
    g.fillStyle = "#C7D2FE";
    spaced(g, ticket, W - pad - 6, pad + 20, 0.8, "right");
  }

  // "Scan to pay" + what it is for.
  g.textAlign = "center";
  g.fillStyle = "#FFFFFF";
  g.font = "700 16px Battambang";
  g.fillText("ស្កេនដើម្បីទូទាត់", W / 2, headTop + 26);
  if (subtitle) {
    g.fillStyle = C.soft;
    g.font = "400 12px Battambang, Inter";
    g.fillText(ellipsize(g, subtitle, W - pad * 4), W / 2, headTop + 46);
  }

  // Perforation: dashed rule with a notch cut into each edge.
  dashedLine(g, pad + 4, W - pad - 4, perfY, "#2B3A5E", 6, 5);
  g.fillStyle = C.page;
  for (const x of [pad - 6, W - pad + 6]) {
    g.beginPath();
    g.arc(x, perfY, 7, 0, Math.PI * 2);
    g.fill();
  }

  // The KHQR card.
  const cx = (W - cardW) / 2;
  g.save();
  g.shadowColor = "rgba(0,0,0,0.45)";
  g.shadowBlur = 18;
  g.shadowOffsetY = 6;
  roundRect(g, cx, cardY, cardW, cardH, 14);
  g.fillStyle = "#FFFFFF";
  g.fill();
  g.restore();

  // Red band with the ticket's clipped bottom-right corner.
  g.save();
  roundRect(g, cx, cardY, cardW, cardH, 14);
  g.clip();
  g.fillStyle = C.red;
  g.beginPath();
  g.moveTo(cx, cardY);
  g.lineTo(cx + cardW, cardY);
  g.lineTo(cx + cardW, cardY + redH * 0.55);
  g.lineTo(cx + cardW * 0.86, cardY + redH);
  g.lineTo(cx, cardY + redH);
  g.closePath();
  g.fill();
  g.restore();
  g.fillStyle = "#FFFFFF";
  g.font = "800 12px Inter";
  spaced(g, "KHQR", W / 2, cardY + 19, 2.4, "center");

  g.textAlign = "left";
  g.fillStyle = C.ink;
  g.font = "600 11px Inter, Battambang";
  g.fillText(ellipsize(g, facts.name, cardW - cardPad * 2), cx + cardPad, cardY + redH + 8 + 11);
  g.font = "800 19px Inter";
  const amountY = cardY + redH + 8 + 16 + 20;
  g.fillText(facts.value, cx + cardPad, amountY);
  const valueW = g.measureText(facts.value).width;
  g.fillStyle = C.muted;
  g.font = "600 10.5px Inter";
  g.fillText(facts.currency, cx + cardPad + valueW + 4, amountY);

  const dashY = cardY + redH + 8 + 16 + 26 + 4;
  dashedLine(g, cx + cardPad, cx + cardW - cardPad, dashY, C.dash, 4, 3);

  const qrY = dashY + 6;
  drawQr(g, payload, cx + cardPad, qrY, qrSize);
  await drawCentreMark(g, cx + cardPad + qrSize / 2, qrY + qrSize / 2, qrSize);

  // Banks that can scan it.
  g.textAlign = "center";
  g.fillStyle = C.soft;
  g.font = "400 11px Battambang";
  g.fillText("ស្កេនបានគ្រប់ App ធនាគារដែលប្រើ KHQR", W / 2, banksY + 4);
  const icon = 22;
  const gap = 7;
  const marks = await Promise.all([1, 2, 3, 4, 5].map((i) => asset(`banks/bank-${i}.png`)));
  const shown = marks.filter(Boolean);
  let ix = W / 2 - (shown.length * icon + (shown.length - 1) * gap) / 2;
  for (const mark of shown) {
    g.save();
    roundRect(g, ix, banksY + 14, icon, icon, 6);
    g.clip();
    g.drawImage(mark, ix, banksY + 14, icon, icon);
    g.restore();
    ix += icon + gap;
  }

  g.fillStyle = "#64748B";
  g.font = "400 10.5px Battambang";
  g.fillText("QR មានសុពលភាព ៦០ នាទី", W / 2, banksY + 14 + icon + 20);

  return canvas.toBuffer("image/png");
}
