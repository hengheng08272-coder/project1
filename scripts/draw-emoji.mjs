// Draws the bot's custom emoji into assets/emoji: 100x100 PNG stills and,
// for every icon, a 100x100 WEBM loop (VP9 with alpha, 2.4 s at 30 fps, under
// Telegram's 256 KB) -- the formats Telegram takes for custom emoji.
//
// One style, the operator's: line icons on a clear background, a light-to-
// deep blue gradient with gold accents, each with its own small motion and a
// glint of light that passes over it. The five icons the operator supplied
// (assets/emoji-src: download, owner, vip, premium, success) are used as they
// are; the KH Invoice and SaveIt logos are drawn from assets/emoji-src too.
// Platform logos keep their brand tiles; bank logos are raster files.
//
//   node scripts/draw-emoji.mjs            -> writes the icons
//   node scripts/draw-emoji.mjs sheet.png  -> also a preview sheet
//
// Needs ffmpeg with libvpx (FFMPEG=/path/to/ffmpeg if it is not on PATH).
// After changing icons, the operator runs /makeemoji in the bot.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createCanvas, GlobalFonts, loadImage } from "@napi-rs/canvas";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "assets", "emoji");
const SRC = path.join(ROOT, "assets", "emoji-src");
GlobalFonts.registerFromPath(path.join(ROOT, "assets", "fonts", "Inter_800ExtraBold.ttf"), "Inter");

const S = 100;
const R = 26;
const FPS = 30;
const FRAMES = 72; // 2.4 s loop, the length of the supplied icons
const FFMPEG = process.env.FFMPEG || "ffmpeg";
const TAU = Math.PI * 2;
const MAX_WEBM_BYTES = 256 * 1024;

const ease = (x) => 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, x)));
const wave = (t, k = 1, phase = 0) => Math.sin(TAU * (t * k + phase));

function sparkle(g, x, y, r) {
  g.save();
  g.shadowColor = "rgba(255,255,255,0.9)";
  g.shadowBlur = 4;
  g.fillStyle = "#FFFFFF";
  g.beginPath();
  g.moveTo(x, y - r);
  g.quadraticCurveTo(x, y, x + r, y);
  g.quadraticCurveTo(x, y, x, y + r);
  g.quadraticCurveTo(x, y, x - r, y);
  g.quadraticCurveTo(x, y, x, y - r);
  g.fill();
  g.restore();
}

/** Moving sparkle size: a slow twinkle, each one on its own phase. */
const twinkle = (t, phase) => 0.55 + 0.45 * Math.sin(TAU * (t * 2 + phase));

/** One tile at moment t. `draw(g, t)` paints the symbol in white (or its own colours). */
function paintTile(g, [top, bottom], draw, { sparkles = false, dark = false, sweep = false }, t) {
  g.beginPath();
  g.roundRect(2, 2, 96, 96, R);
  g.clip();

  const base = g.createLinearGradient(0, 0, 0, S);
  base.addColorStop(0, top);
  base.addColorStop(1, bottom);
  g.fillStyle = base;
  g.fillRect(0, 0, S, S);

  // Shine: a soft ellipse over the top half.
  const shine = g.createLinearGradient(0, 0, 0, 52);
  shine.addColorStop(0, dark ? "rgba(255,255,255,0.18)" : "rgba(255,255,255,0.42)");
  shine.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = shine;
  g.beginPath();
  g.ellipse(50, 8, 62, 44, 0, 0, TAU);
  g.fill();

  // Depth at the foot.
  const foot = g.createLinearGradient(0, 62, 0, S);
  foot.addColorStop(0, "rgba(0,0,0,0)");
  foot.addColorStop(1, "rgba(0,0,0,0.18)");
  g.fillStyle = foot;
  g.fillRect(0, 62, S, 38);

  // The symbol, lifted by a soft shadow.
  g.save();
  g.shadowColor = "rgba(0,0,0,0.28)";
  g.shadowBlur = 5;
  g.shadowOffsetY = 2;
  g.fillStyle = "#FFFFFF";
  g.strokeStyle = "#FFFFFF";
  g.lineCap = "round";
  g.lineJoin = "round";
  draw(g, t);
  g.restore();

  if (sparkles) {
    sparkle(g, 80, 18, 7 * (sparkles === "live" ? twinkle(t, 0) : 1));
    sparkle(g, 88, 32, 3.5 * (sparkles === "live" ? twinkle(t, 0.5) : 1));
  }

  // A band of light crossing the tile once per loop (first half, then rest).
  if (sweep) {
    const x = -70 + 240 * Math.min(1, t * 2);
    g.save();
    g.translate(x, 50);
    g.rotate(0.35);
    const band = g.createLinearGradient(-18, 0, 18, 0);
    band.addColorStop(0, "rgba(255,255,255,0)");
    band.addColorStop(0.5, "rgba(255,255,255,0.45)");
    band.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = band;
    g.fillRect(-18, -90, 36, 180);
    g.restore();
  }

  // Thin light rim.
  g.strokeStyle = "rgba(255,255,255,0.35)";
  g.lineWidth = 2;
  g.beginPath();
  g.roundRect(3, 3, 94, 94, R - 1);
  g.stroke();
}

function writeVideo(name, render) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `emoji-${name}-`));
  try {
    for (let i = 0; i < FRAMES; i++) {
      fs.writeFileSync(path.join(dir, `f${String(i).padStart(3, "0")}.png`), render(i / FRAMES).toBuffer("image/png"));
    }
    const out = path.join(OUT, `${name}.webm`);
    for (const crf of [30, 36, 42, 48]) {
      execFileSync(FFMPEG, [
        "-y", "-loglevel", "error", "-framerate", String(FPS), "-i", path.join(dir, "f%03d.png"),
        "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-auto-alt-ref", "0", "-b:v", "0", "-crf", String(crf),
        "-metadata:s:v:0", "alpha_mode=1", "-an", out,
      ]);
      if (fs.statSync(out).size <= MAX_WEBM_BYTES) return;
    }
    throw new Error(`${name}.webm is still over ${MAX_WEBM_BYTES} bytes`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ------------------------------------------------------------ the style
const grad = (g, stops, y0 = 8, y1 = 92) => {
  const gr = g.createLinearGradient(0, y0, 0, y1);
  stops.forEach((c, i) => gr.addColorStop(i / (stops.length - 1), c));
  return gr;
};
const BLUE = ["#9BE3FF", "#46B4EC", "#2388CF"];
const GOLD = ["#FFE9A0", "#F5BE3A", "#CF8A10"];
const RED = ["#FFB4B4", "#F05252", "#C81E1E"];
const PINK = ["#FFB3C6", "#F43F6E", "#BE123C"];
const GREEN = ["#B4F5D2", "#34C77B", "#0E8F53"];
const blue = (g, y0, y1) => grad(g, BLUE, y0, y1);
const gold = (g, y0, y1) => grad(g, GOLD, y0, y1);
const green = (g, y0, y1) => grad(g, GREEN, y0, y1);
const red = (g, y0, y1) => grad(g, RED, y0, y1);

/** A four-point glint. */
function glint(g, x, y, r, colour = "#FFFFFF") {
  g.save();
  g.fillStyle = colour;
  g.shadowColor = colour;
  g.shadowBlur = 3;
  g.beginPath();
  g.moveTo(x, y - r);
  g.quadraticCurveTo(x, y, x + r, y);
  g.quadraticCurveTo(x, y, x, y + r);
  g.quadraticCurveTo(x, y, x - r, y);
  g.quadraticCurveTo(x, y, x, y - r);
  g.fill();
  g.restore();
}

/**
 * One frame of an icon: `draw(g, t)` paints it on a clear 100x100 layer,
 * a band of light passes over what was painted (only over it), a gold glint
 * twinkles at a corner, and the layer gets a soft shadow so it reads on
 * light and dark chat backgrounds alike.
 */
// How much bigger the glyph is drawn than it was designed at -- fills more
// of the 100x100 tile so it stays legible once Telegram renders it small.
const ICON_ZOOM = 1.16;
function frame(draw, { sweep = true, glints = true } = {}, t) {
  const layer = createCanvas(S, S);
  const g = layer.getContext("2d");
  g.lineCap = "round";
  g.lineJoin = "round";
  g.save();
  g.translate(50, 50);
  g.scale(ICON_ZOOM, ICON_ZOOM);
  g.translate(-50, -50);
  draw(g, t);
  g.restore();
  if (sweep) {
    const p = (t - 0.5) / 0.4; // the second half of the loop
    if (p > 0 && p < 1) {
      g.save();
      g.globalCompositeOperation = "source-atop";
      g.translate(-40 + 180 * p, 50);
      g.rotate(0.45);
      const band = g.createLinearGradient(-14, 0, 14, 0);
      band.addColorStop(0, "rgba(255,255,255,0)");
      band.addColorStop(0.5, "rgba(255,255,255,0.7)");
      band.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = band;
      g.fillRect(-14, -90, 28, 180);
      g.restore();
    }
  }
  if (glints) {
    const k = Math.max(0, wave(t, 1, 0.1));
    if (k > 0.05) glint(g, 88, 12, 6 * k, "#FFE38A");
    const k2 = Math.max(0, wave(t, 1, 0.6));
    if (k2 > 0.05) glint(g, 10, 84, 4 * k2, "#BDEBFF");
  }
  const c = createCanvas(S, S);
  const out = c.getContext("2d");
  out.shadowColor = "rgba(6,18,40,0.35)";
  out.shadowBlur = 3;
  out.shadowOffsetY = 1.5;
  out.drawImage(layer, 0, 0);
  return c;
}

/** Writes `name`.png (the still at t = `still`) and `name`.webm. */
function icon(name, draw, opts = {}) {
  const render = (t) => frame(draw, opts, t);
  fs.writeFileSync(path.join(OUT, `${name}.png`), render(opts.still ?? 0.25).toBuffer("image/png"));
  writeVideo(name, render);
}

/** A brand tile (the platform logos): the older glossy square, now moving. */
function tiled(name, colors, draw, opts = {}) {
  const o = { sweep: true, ...opts, sparkles: opts.sparkles ? "live" : false };
  const render = (t) => {
    const c = createCanvas(S, S);
    paintTile(c.getContext("2d"), colors, draw, o, t);
    return c;
  };
  fs.writeFileSync(path.join(OUT, `${name}.png`), render(0).toBuffer("image/png"));
  writeVideo(name, render);
}

/** The operator's own icons: their 100 px WEBM as is, and a 100 px still from the 512 px PNG. */
async function supplied(name, file) {
  fs.copyFileSync(path.join(SRC, `${file}.webm`), path.join(OUT, `${name}.webm`));
  const img = await loadImage(fs.readFileSync(path.join(SRC, `${file}.png`)));
  const c = createCanvas(S, S);
  c.getContext("2d").drawImage(img, 0, 0, S, S);
  fs.writeFileSync(path.join(OUT, `${name}.png`), c.toBuffer("image/png"));
}

// Icons read small in a chat -- thicken every stroke a bit past what looks
// right at full size, so the shape still reads once Telegram shrinks it.
const STROKE = 1.22;
const line = (g, w, style) => {
  g.lineWidth = w * STROKE;
  g.strokeStyle = style;
};
const path2 = (g, pts) => {
  g.beginPath();
  pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
};

// ------------------------------------------------------------ supplied
await supplied("dl", "download");
await supplied("admin", "owner");
await supplied("vip", "vip");
await supplied("premium", "premium");
await supplied("ok", "success");

// ------------------------------------------------------------ logos
// SaveIt KH: the round badge -- blue ring, two chevrons and a stem falling
// into a gold tray.
function drawSaveIt(g, t) {
  const bg = g.createRadialGradient(50, 40, 6, 50, 50, 50);
  bg.addColorStop(0, "#15305E");
  bg.addColorStop(1, "#060F22");
  g.fillStyle = bg;
  g.beginPath();
  g.arc(50, 50, 47, 0, TAU);
  g.fill();
  line(g, 3, "#2A4F8A");
  g.beginPath();
  g.arc(50, 50, 46, 0, TAU);
  g.stroke();
  line(g, 0.8, "rgba(80,170,230,0.45)");
  g.beginPath();
  g.arc(50, 50, 41, 0, TAU);
  g.stroke();
  const drop = 5 * ease(Math.min(1, (t % 1) / 0.35)) * (1 - ease(Math.max(0, (t - 0.45) / 0.35)));
  g.save();
  g.translate(0, drop);
  g.fillStyle = "#3EC8FF";
  g.beginPath();
  g.roundRect(45, 18, 10, 20, 4);
  g.fill();
  line(g, 9, "#3EC8FF");
  path2(g, [[31, 43], [50, 56], [69, 43]]);
  g.stroke();
  line(g, 9, "#2F84E3");
  path2(g, [[31, 55], [50, 68], [69, 55]]);
  g.stroke();
  g.restore();
  const bar = g.createLinearGradient(33, 0, 67, 0);
  const shine = 0.5 + 0.4 * wave(t);
  bar.addColorStop(0, "#C98A12");
  bar.addColorStop(shine, "#FFE591");
  bar.addColorStop(1, "#C98A12");
  g.fillStyle = bar;
  g.beginPath();
  g.roundRect(33, 76, 34, 5, 2.5);
  g.fill();
}


// The wordmark: "SaveIt" in blue over a gold "KH".
icon("brand", (g) => {
  g.textAlign = "center";
  g.font = "800 27px Inter";
  g.fillStyle = blue(g, 24, 46);
  g.fillText("SaveIt", 50, 45);
  g.font = "800 38px Inter";
  g.fillStyle = gold(g, 52, 84);
  g.fillText("KH", 50, 83);
});

// ------------------------------------------------------------ main menu
// Free: a gold infinity with light running round it.
icon("m_free", (g, t) => {
  const inf = () => {
    g.beginPath();
    g.moveTo(50, 50);
    g.bezierCurveTo(62, 30, 88, 32, 88, 50);
    g.bezierCurveTo(88, 68, 62, 70, 50, 50);
    g.bezierCurveTo(38, 30, 12, 32, 12, 50);
    g.bezierCurveTo(12, 68, 38, 70, 50, 50);
  };
  line(g, 10, gold(g, 34, 66));
  inf();
  g.stroke();
  line(g, 4, "rgba(255,255,255,0.9)");
  g.setLineDash([14, 200]);
  g.lineDashOffset = -214 * t;
  inf();
  g.stroke();
});

// Account: a blue head, gold shoulders; the head nods.
icon("m_account", (g, t) => {
  const nod = 2 * wave(t);
  line(g, 7, blue(g, 12, 50));
  g.beginPath();
  g.arc(50, 32 + nod, 14, 0, TAU);
  g.stroke();
  line(g, 7, gold(g, 58, 88));
  g.beginPath();
  g.moveTo(20, 86);
  g.bezierCurveTo(20, 58, 80, 58, 80, 86);
  g.stroke();
});

// History: a clock whose gold hands turn.
icon("m_history", (g, t) => {
  line(g, 7, blue(g));
  g.beginPath();
  g.arc(50, 50, 38, 0, TAU);
  g.stroke();
  line(g, 6, gold(g, 20, 70));
  const a = TAU * t - Math.PI / 2;
  path2(g, [[50, 50], [50 + Math.cos(a) * 26, 50 + Math.sin(a) * 26]]);
  g.stroke();
  const b = -Math.PI * 5 / 6 + (TAU * t) / 12; // the hour hand near ten
  path2(g, [[50, 50], [50 + Math.cos(b) * 17, 50 + Math.sin(b) * 17]]);
  g.stroke();
  g.fillStyle = "#F5BE3A";
  g.beginPath();
  g.arc(50, 50, 4, 0, TAU);
  g.fill();
});

// Referral: three linked people-dots; a pulse runs from the gold one.
icon("m_referral", (g, t) => {
  const pts = [[50, 20], [20, 76], [80, 76]];
  line(g, 6, blue(g));
  path2(g, [...pts, pts[0]]);
  g.stroke();
  pts.forEach(([x, y], i) => {
    const k = 1 + 0.25 * Math.max(0, wave(t, 1, -i / 3));
    g.fillStyle = i === 0 ? gold(g, 8, 32) : blue(g, 64, 88);
    g.beginPath();
    g.arc(x, y, 10 * k, 0, TAU);
    g.fill();
  });
});

// Language: a globe; the gold meridian turns.
icon("m_language", (g, t) => {
  line(g, 6, blue(g));
  g.beginPath();
  g.arc(50, 50, 38, 0, TAU);
  g.stroke();
  path2(g, [[12, 50], [88, 50]]);
  g.stroke();
  line(g, 5, blue(g));
  g.beginPath();
  g.ellipse(50, 31, 30, 1, 0, 0, TAU);
  g.moveTo(80, 69);
  g.ellipse(50, 69, 30, 1, 0, 0, TAU);
  g.stroke();
  line(g, 6, gold(g));
  g.beginPath();
  g.ellipse(50, 50, Math.max(2, 16 * Math.abs(Math.cos(Math.PI * t))), 38, 0, 0, TAU);
  g.stroke();
});

// Help: a gold question mark in a blue ring, tilting.
icon("m_help", (g, t) => {
  line(g, 7, blue(g));
  g.beginPath();
  g.arc(50, 50, 38, 0, TAU);
  g.stroke();
  g.save();
  g.translate(50, 50);
  g.rotate(0.18 * wave(t));
  line(g, 8, gold(g, 20, 70));
  g.beginPath();
  g.moveTo(-11, -9);
  g.bezierCurveTo(-11, -26, 13, -26, 13, -11);
  g.bezierCurveTo(13, 0, 0, 0, 0, 9);
  g.stroke();
  g.fillStyle = "#E6A424";
  g.beginPath();
  g.arc(0, 21, 5, 0, TAU);
  g.fill();
  g.restore();
});

// Desktop app: a blue screen on a gold stand, a play mark inside.
icon("m_desktop", (g, t) => {
  line(g, 7, blue(g, 14, 70));
  g.beginPath();
  g.roundRect(12, 16, 76, 52, 8);
  g.stroke();
  line(g, 7, gold(g, 70, 90));
  path2(g, [[50, 70], [50, 82]]);
  g.stroke();
  path2(g, [[32, 86], [68, 86]]);
  g.stroke();
  const k = 1 + 0.15 * Math.max(0, wave(t, 2));
  g.translate(52, 42);
  g.scale(k, k);
  g.fillStyle = gold(g, -10, 10);
  path2(g, [[-8, -11], [11, 0], [-8, 11]]);
  g.closePath();
  g.fill();
});

// Emoji Maker: a gold sparkle turning, a blue one twinkling.
icon("sparkle", (g, t) => {
  g.save();
  g.translate(44, 54);
  g.rotate(TAU * t * 0.25);
  const r = 32 * (0.88 + 0.12 * wave(t, 2));
  g.fillStyle = gold(g, -r, r);
  g.beginPath();
  g.moveTo(0, -r);
  g.quadraticCurveTo(0, 0, r, 0);
  g.quadraticCurveTo(0, 0, 0, r);
  g.quadraticCurveTo(0, 0, -r, 0);
  g.quadraticCurveTo(0, 0, 0, -r);
  g.fill();
  g.restore();
  const s = 13 * (0.6 + 0.4 * Math.max(0, wave(t, 2, 0.5)));
  g.fillStyle = blue(g, 8, 40);
  g.beginPath();
  g.moveTo(78, 24 - s);
  g.quadraticCurveTo(78, 24, 78 + s, 24);
  g.quadraticCurveTo(78, 24, 78, 24 + s);
  g.quadraticCurveTo(78, 24, 78 - s, 24);
  g.quadraticCurveTo(78, 24, 78, 24 - s);
  g.fill();
}, { glints: false });

// ------------------------------------------------------------ KH Invoice section
// Create: a receipt whose gold lines write themselves.
icon("inv_create", (g, t) => {
  line(g, 7, blue(g));
  g.beginPath();
  g.moveTo(24, 12);
  g.lineTo(76, 12);
  g.lineTo(76, 84);
  for (let i = 0; i < 6; i++) g.lineTo(76 - (i + 0.5) * (52 / 6), i % 2 ? 84 : 90);
  g.lineTo(24, 84);
  g.closePath();
  g.stroke();
  line(g, 6, gold(g, 20, 70));
  const rows = [[34, 30, 66], [34, 44, 66], [34, 58, 54]];
  rows.forEach(([x0, y, x1], i) => {
    const p = ease((t * 1.4 - i * 0.22) / 0.3);
    if (p <= 0) return;
    path2(g, [[x0, y], [x0 + (x1 - x0) * p, y]]);
    g.stroke();
  });
}, { still: 0.9 });

const wallet = (g) => {
  line(g, 7, blue(g, 30, 88));
  g.beginPath();
  g.roundRect(12, 34, 70, 50, 9);
  g.stroke();
  g.fillStyle = gold(g, 50, 66);
  g.beginPath();
  g.roundRect(64, 50, 24, 17, 6);
  g.fill();
};
const coin = (g, x, y, tone, r = 10) => {
  g.fillStyle = tone(g, y - r, y + r);
  g.beginPath();
  g.arc(x, y, r, 0, TAU);
  g.fill();
  line(g, 2, "rgba(255,255,255,0.7)");
  g.beginPath();
  g.arc(x, y, r - 4, 0, TAU);
  g.stroke();
};
// Income and expense share one wallet, but nothing else: green in, red out,
// so which is which reads from colour alone at the size a keyboard button
// actually shows it, before anyone can make out an arrow's direction.
// Income: a green coin drops into the wallet, arrow pointing down.
icon("inv_in", (g, t) => {
  const p = ease((t % 1) / 0.55);
  g.save();
  g.beginPath();
  g.rect(0, 0, S, 40);
  g.clip();
  coin(g, 42, -4 + 36 * p, green, 11);
  g.restore();
  wallet(g);
  line(g, 5, green(g, 4, 30));
  const d = 3 * Math.max(0, wave(t, 2));
  path2(g, [[74, 6 + d], [74, 26 + d]]);
  g.stroke();
  path2(g, [[67, 19 + d], [74, 26 + d], [81, 19 + d]]);
  g.stroke();
}, { still: 0.35 });
// Expense: a red coin rises out of the wallet, arrow pointing up.
icon("inv_out", (g, t) => {
  const p = ease((t % 1) / 0.6);
  wallet(g);
  const fade = Math.max(0, (p - 0.7) / 0.3);
  if (fade < 1) coin(g, 40, 30 - 22 * p, red, 10 * (1 - fade) + 0.01);
  line(g, 5, red(g, 4, 30));
  path2(g, [[74, 28], [74, 8]]);
  g.stroke();
  path2(g, [[67, 15], [74, 8], [81, 15]]);
  g.stroke();
}, { still: 0.3 });

// Report: bars that grow, the last one gold.
icon("inv_report", (g, t) => {
  const bars = [[16, 0.45], [36, 0.65], [56, 0.5], [76, 0.9]];
  bars.forEach(([x, h], i) => {
    const p = 0.6 + 0.4 * ease(((t * 1.6 - i * 0.12) % 1) / 0.4);
    const top = 84 - 64 * h * p;
    g.fillStyle = i === 3 ? gold(g, top, 84) : blue(g, top, 84);
    g.beginPath();
    g.roundRect(x - 1, top, 12, 84 - top, 4);
    g.fill();
  });
  line(g, 5, blue(g, 86, 92));
  path2(g, [[10, 90], [90, 90]]);
  g.stroke();
});

// Stock: a box whose gold-taped lid lifts.
icon("inv_stock", (g, t) => {
  const lift = 5 * Math.max(0, wave(t, 2));
  line(g, 7, blue(g, 40, 90));
  g.beginPath();
  g.roundRect(18, 42, 64, 44, 6);
  g.stroke();
  g.save();
  g.translate(0, -lift);
  line(g, 7, blue(g, 20, 44));
  g.beginPath();
  g.roundRect(12, 26, 76, 16, 5);
  g.stroke();
  g.restore();
  line(g, 7, gold(g, 30, 70));
  path2(g, [[50, 26 - lift], [50, 42 - lift]]);
  g.stroke();
  path2(g, [[50, 50], [50, 64]]);
  g.stroke();
});

// Waiting / unpaid: an hourglass, gold sand running, then it turns.
const hourglass = (g, t) => {
  const flip = ease((t - 0.82) / 0.18);
  g.translate(50, 50);
  g.rotate(Math.PI * flip);
  line(g, 7, blue(g, -40, 40));
  path2(g, [[-22, -38], [22, -38]]);
  g.stroke();
  path2(g, [[-22, 38], [22, 38]]);
  g.stroke();
  line(g, 6, blue(g, -40, 40));
  g.beginPath();
  g.moveTo(-17, -38); g.quadraticCurveTo(-17, -8, 0, 0); g.quadraticCurveTo(-17, 8, -17, 38);
  g.moveTo(17, -38); g.quadraticCurveTo(17, -8, 0, 0); g.quadraticCurveTo(17, 8, 17, 38);
  g.stroke();
  const run = Math.min(1, t / 0.82);
  const h = 24 * (1 - run);
  g.fillStyle = gold(g, -30, 34);
  if (h > 0.5) {
    g.beginPath();
    g.moveTo(-11 * (h / 24), -5 - h); g.lineTo(11 * (h / 24), -5 - h); g.lineTo(0, -3); g.closePath();
    g.fill();
  }
  const b = 24 * run;
  g.beginPath();
  g.moveTo(-13, 33); g.lineTo(13, 33); g.lineTo(0, 33 - b); g.closePath();
  g.fill();
  if (run < 1) g.fillRect(-1.2, -3, 2.4, 36 - b);
};
icon("wait", hourglass, { still: 0.45 });
icon("inv_unpaid", hourglass, { still: 0.45 });

// Refresh: two arrows chasing round.
icon("inv_refresh", (g, t) => {
  g.translate(50, 50);
  g.rotate(TAU * ease(t / 0.7));
  const arc = (a0, a1, style) => {
    line(g, 7, style);
    g.beginPath();
    g.arc(0, 0, 32, a0, a1);
    g.stroke();
    const x = Math.cos(a1) * 32, y = Math.sin(a1) * 32;
    g.fillStyle = style;
    g.save();
    g.translate(x, y);
    g.rotate(a1 + Math.PI / 2);
    path2(g, [[-9, -6], [9, 0], [-9, 6]]);
    g.closePath();
    g.restore();
    g.save();
    g.translate(x, y);
    g.rotate(a1);
    path2(g, [[-8, -3], [0, 9], [8, -3]]);
    g.closePath();
    g.fill();
    g.restore();
  };
  arc(Math.PI * 0.15, Math.PI * 0.85, blue(g, -40, 40));
  arc(Math.PI * 1.15, Math.PI * 1.85, gold(g, -40, 40));
});

// Summary: a clipboard with a gold clip, its lines ticking in.
icon("inv_summary", (g, t) => {
  line(g, 7, blue(g));
  g.beginPath();
  g.roundRect(18, 16, 64, 74, 8);
  g.stroke();
  g.fillStyle = gold(g, 8, 26);
  g.beginPath();
  g.roundRect(36, 8, 28, 16, 5);
  g.fill();
  line(g, 6, blue(g));
  [38, 54, 70].forEach((y, i) => {
    const p = ease((t * 1.4 - i * 0.2) / 0.3);
    if (p <= 0) return;
    g.fillStyle = "#F5BE3A";
    g.beginPath();
    g.arc(32, y, 3.5, 0, TAU);
    g.fill();
    path2(g, [[42, y], [42 + 26 * p, y]]);
    g.stroke();
  });
}, { still: 0.9 });

// Shop: a gold awning over a blue shopfront; the awning sways.
icon("inv_shop", (g, t) => {
  line(g, 7, blue(g, 40, 90));
  g.beginPath();
  g.moveTo(18, 46);
  g.lineTo(18, 86);
  g.lineTo(82, 86);
  g.lineTo(82, 46);
  g.stroke();
  g.beginPath();
  g.roundRect(42, 60, 16, 26, 3);
  g.stroke();
  const sway = 1.5 * wave(t, 2);
  g.fillStyle = gold(g, 14, 50);
  g.beginPath();
  g.moveTo(16, 14);
  g.lineTo(84, 14);
  g.lineTo(92, 36);
  for (let i = 0; i < 4; i++) {
    const x0 = 92 - i * 21, x1 = x0 - 21;
    g.quadraticCurveTo((x0 + x1) / 2, 50 + sway, x1, 36);
  }
  g.closePath();
  g.fill();
});

// Back: a blue arrow nudging left.
icon("inv_back", (g, t) => {
  const d = -5 * Math.max(0, wave(t, 2));
  g.translate(d, 0);
  line(g, 9, blue(g));
  path2(g, [[80, 50], [22, 50]]);
  g.stroke();
  line(g, 9, gold(g, 24, 76));
  path2(g, [[44, 28], [22, 50], [44, 72]]);
  g.stroke();
}, { glints: false });

// ------------------------------------------------------------ replies & extras
// Video: a blue frame, a gold play mark that pulses.
icon("video", (g, t) => {
  line(g, 7, blue(g, 20, 80));
  g.beginPath();
  g.roundRect(10, 22, 80, 56, 10);
  g.stroke();
  const k = 1 + 0.14 * Math.max(0, wave(t, 2));
  g.translate(52, 50);
  g.scale(k, k);
  g.fillStyle = gold(g, -14, 14);
  path2(g, [[-10, -14], [14, 0], [-10, 14]]);
  g.closePath();
  g.fill();
});

// Failed: a red ring, the cross drawn in, then a shake.
icon("fail", (g, t) => {
  const shake = t > 0.35 && t < 0.6 ? wave(t, 10) * 3 : 0;
  g.translate(shake, 0);
  line(g, 7, grad(g, RED));
  g.beginPath();
  g.arc(50, 50, 38, 0, TAU);
  g.stroke();
  const p = ease(t / 0.3);
  line(g, 8, grad(g, RED, 30, 70));
  path2(g, [[36, 36], [36 + 28 * Math.min(1, p * 2), 36 + 28 * Math.min(1, p * 2)]]);
  g.stroke();
  if (p > 0.5) {
    const q = (p - 0.5) * 2;
    path2(g, [[64, 36], [64 - 28 * q, 36 + 28 * q]]);
    g.stroke();
  }
}, { still: 0.8, glints: false });

// Fire: a gold flame that flickers.
icon("fire", (g, t) => {
  const f = (k) => wave(t, 3, k);
  const flame = (s, style, sway) => {
    g.fillStyle = style;
    g.beginPath();
    g.moveTo(50, 90);
    g.bezierCurveTo(50 - 30 * s, 90, 50 - 32 * s, 60, 50 - 15 * s, 44);
    g.bezierCurveTo(50 - 13 * s, 56, 50 - 4 * s, 58, 50 - 4 * s, 58);
    g.bezierCurveTo(50 - 10 * s + sway, 36, 50 + sway, 20, 50 + 6 * s + sway, 10 + 4 * (1 - s));
    g.bezierCurveTo(50 + 12 * s, 34, 50 + 32 * s, 48, 50 + 30 * s, 66);
    g.bezierCurveTo(50 + 30 * s, 80, 50 + 19 * s, 90, 50, 90);
    g.fill();
  };
  flame(1 + 0.04 * f(0), grad(g, ["#FFD66B", "#F59E0B", "#EA580C"]), 3 * f(0.2));
  flame(0.55 + 0.05 * f(0.5), grad(g, ["#FFF7D1", "#FFE08A"], 50, 90), 2 * f(0.7));
});

// Star: a gold star that sways and glints.
icon("star", (g, t) => {
  g.translate(50, 52);
  g.rotate(0.25 * wave(t));
  const k = 1 + 0.06 * wave(t, 2);
  g.scale(k, k);
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? 16 : 38;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  g.closePath();
  g.fillStyle = gold(g, -38, 34);
  g.fill();
  line(g, 4, "rgba(255,255,255,0.55)");
  g.stroke();
});

// Rocket: blue outline, gold flame, rising.
icon("rocket", (g, t) => {
  g.translate(50, 50 + 3 * wave(t));
  g.rotate(Math.PI / 4);
  const fl = 0.75 + 0.25 * wave(t, 6);
  g.fillStyle = gold(g, 20, 44);
  path2(g, [[-8, 24], [0, 24 + 20 * fl], [8, 24]]);
  g.closePath();
  g.fill();
  line(g, 6, blue(g, -36, 26));
  g.beginPath();
  g.moveTo(0, -36);
  g.bezierCurveTo(17, -22, 15, 8, 12, 24);
  g.lineTo(-12, 24);
  g.bezierCurveTo(-15, 8, -17, -22, 0, -36);
  g.stroke();
  path2(g, [[-12, 8], [-24, 26], [-12, 22]]);
  g.stroke();
  path2(g, [[12, 8], [24, 26], [12, 22]]);
  g.stroke();
  g.fillStyle = gold(g, -16, 0);
  g.beginPath();
  g.arc(0, -8, 6, 0, TAU);
  g.fill();
});

// Gift: a blue box, gold ribbon, the lid hops.
icon("gift", (g, t) => {
  const hop = 7 * Math.max(0, wave(t, 2));
  line(g, 7, blue(g, 44, 90));
  g.beginPath();
  g.roundRect(20, 48, 60, 38, 5);
  g.stroke();
  g.save();
  g.translate(0, -hop);
  line(g, 7, blue(g, 30, 50));
  g.beginPath();
  g.roundRect(14, 32, 72, 16, 5);
  g.stroke();
  line(g, 6, gold(g, 10, 40));
  g.beginPath();
  g.moveTo(50, 32); g.bezierCurveTo(40, 12, 24, 22, 38, 31);
  g.moveTo(50, 32); g.bezierCurveTo(60, 12, 76, 22, 62, 31);
  g.stroke();
  path2(g, [[50, 32], [50, 48]]);
  g.stroke();
  g.restore();
  line(g, 6, gold(g, 48, 90));
  path2(g, [[50, 50], [50, 86]]);
  g.stroke();
});

// Music: blue stems and beam, gold heads, bouncing in turn.
icon("music", (g, t) => {
  const a = -5 * Math.max(0, wave(t, 2));
  const b = -5 * Math.max(0, wave(t, 2, 0.5));
  line(g, 6, blue(g));
  path2(g, [[38, 70 + a], [38, 24 + a]]);
  g.stroke();
  path2(g, [[74, 64 + b], [74, 18 + b]]);
  g.stroke();
  g.fillStyle = blue(g, 10, 40);
  g.beginPath();
  g.moveTo(38, 22 + a); g.lineTo(74, 14 + b); g.lineTo(74, 26 + b); g.lineTo(38, 34 + a); g.closePath();
  g.fill();
  g.fillStyle = gold(g, 60, 84);
  g.beginPath(); g.ellipse(29, 72 + a, 11, 9, -0.35, 0, TAU); g.fill();
  g.beginPath(); g.ellipse(65, 66 + b, 11, 9, -0.35, 0, TAU); g.fill();
});

// Heart: a rose-red heart that beats.
icon("heart", (g, t) => {
  const p = Math.max(0, Math.sin(TAU * t * 2)) ** 3;
  const k = 1 + 0.12 * p;
  g.translate(50, 52);
  g.scale(k, k);
  g.translate(-50, -52);
  g.fillStyle = grad(g, PINK, 20, 86);
  g.beginPath();
  g.moveTo(50, 86);
  g.bezierCurveTo(10, 60, 12, 20, 35, 20);
  g.bezierCurveTo(44, 20, 50, 28, 50, 34);
  g.bezierCurveTo(50, 28, 56, 20, 65, 20);
  g.bezierCurveTo(88, 20, 90, 60, 50, 86);
  g.fill();
});

// Link: blue and gold chain links that close.
icon("link", (g, t) => {
  const gap = 6 * (1 - ease(t / 0.4)) * (t < 0.9 ? 1 : 0);
  g.translate(50, 50);
  g.rotate(-Math.PI / 4);
  line(g, 8, blue(g, -12, 12));
  g.beginPath();
  g.roundRect(-38 - gap, -12, 42, 24, 12);
  g.stroke();
  line(g, 8, gold(g, -12, 12));
  g.beginPath();
  g.roundRect(-4 + gap, -12, 42, 24, 12);
  g.stroke();
}, { still: 0.6 });

// Lock: a gold shackle that clicks shut on a blue body.
icon("lock", (g, t) => {
  const up = 9 * (1 - ease((t - 0.25) / 0.2));
  line(g, 8, gold(g, 10, 50));
  g.beginPath();
  g.moveTo(32, 46 - up);
  g.lineTo(32, 34 - up);
  g.arc(50, 34 - up, 18, Math.PI, 0);
  g.lineTo(68, 46 - up);
  g.stroke();
  line(g, 7, blue(g, 44, 90));
  g.beginPath();
  g.roundRect(20, 46, 60, 42, 9);
  g.stroke();
  g.fillStyle = gold(g, 56, 80);
  g.beginPath();
  g.arc(50, 62, 6, 0, TAU);
  g.fill();
  g.fillRect(47, 62, 6, 13);
}, { still: 0.8 });

// Ticket: a stub with a torn perforation, the notch cut once.
icon("ticket", (g, t) => {
  const cut = ease(t / 0.5);
  line(g, 6, blue(g));
  g.beginPath();
  g.moveTo(14, 30);
  g.arc(14, 50, 8, -Math.PI / 2, Math.PI / 2, true);
  g.lineTo(86, 70);
  g.arc(86, 50, 8, Math.PI / 2, -Math.PI / 2, true);
  g.closePath();
  g.stroke();
  g.setLineDash([1, 7]);
  g.lineCap = "round";
  line(g, 6, blue(g, 20, 80));
  g.beginPath();
  g.moveTo(56, 26);
  g.lineTo(56, 26 + 48 * Math.min(1, cut * 1.4));
  g.stroke();
  g.setLineDash([]);
  g.fillStyle = gold(g, 40, 60);
  g.beginPath();
  g.arc(56, 50, 4.5, 0, TAU);
  g.fill();
}, { still: 0.9 });

// Camera: a body and lens, the shutter blinking once per loop.
icon("camera", (g, t) => {
  const blink = t > 0.55 && t < 0.68 ? 0.15 : 1;
  line(g, 6, blue(g, 20, 80));
  g.beginPath();
  g.roundRect(14, 34, 72, 50, 10);
  g.stroke();
  g.beginPath();
  g.moveTo(36, 34);
  g.lineTo(42, 22);
  g.lineTo(64, 22);
  g.lineTo(70, 34);
  g.stroke();
  g.save();
  g.translate(50, 60);
  g.scale(blink, blink);
  line(g, 6, gold(g, -20, 20));
  g.beginPath();
  g.arc(0, 0, 16, 0, TAU);
  g.stroke();
  g.restore();
  g.fillStyle = blue(g, 30, 40);
  g.beginPath();
  g.arc(72, 42, 3, 0, TAU);
  g.fill();
}, { still: 0.3 });

// Tip: a lightbulb that switches on, a filament glowing gold.
icon("bulb", (g, t) => {
  const on = Math.max(0, wave(t, 1, 0.25));
  line(g, 6.5, blue(g, 14, 60));
  g.beginPath();
  g.arc(50, 40, 22, Math.PI * 0.15, Math.PI * 0.85, true);
  g.moveTo(32, 53);
  g.bezierCurveTo(30, 64, 38, 68, 38, 76);
  g.moveTo(68, 53);
  g.bezierCurveTo(70, 64, 62, 68, 62, 76);
  g.stroke();
  line(g, 6, gold(g, 58, 84));
  g.beginPath();
  g.roundRect(38, 76, 24, 8, 3);
  g.moveTo(41, 86);
  g.lineTo(59, 86);
  g.stroke();
  if (on > 0.15) {
    g.save();
    g.globalAlpha = Math.min(1, on);
    g.fillStyle = "#FFF3C4";
    g.shadowColor = "#FDE68A";
    g.shadowBlur = 10 * on;
    g.beginPath();
    g.arc(50, 40, 13, 0, TAU);
    g.fill();
    g.restore();
  }
  g.strokeStyle = "#B45309";
  g.lineWidth = 2.6;
  g.beginPath();
  g.moveTo(41, 46);
  g.lineTo(46, 34);
  g.lineTo(50, 44);
  g.lineTo(54, 34);
  g.lineTo(59, 46);
  g.stroke();
}, { still: 0 });

// Party: confetti bursting from a popper, each piece its own colour.
icon("party", (g, t) => {
  line(g, 7, gold(g, 40, 80));
  g.save();
  g.translate(30, 78);
  g.rotate(-0.6);
  g.beginPath();
  g.moveTo(-10, 10);
  g.lineTo(10, 10);
  g.lineTo(6, -14);
  g.lineTo(-6, -14);
  g.closePath();
  g.stroke();
  g.restore();
  const bits = [
    [58, 30, "#F97316", 0], [72, 46, "#34D399", 0.2], [50, 20, "#60A5FA", 0.4],
    [80, 62, "#FBBF24", 0.6], [64, 60, "#F472B6", 0.8], [40, 40, "#38BDF8", 0.1],
  ];
  for (const [bx, by, colour, ph] of bits) {
    const p = ease(Math.min(1, (t + ph) % 1 / 0.7));
    const x = bx + 14 * p;
    const y = by - 20 * p + 24 * p * p;
    g.save();
    g.globalAlpha = Math.max(0, 1 - p);
    g.translate(x, y);
    g.rotate(p * 6);
    g.fillStyle = colour;
    g.fillRect(-3.5, -3.5, 7, 7);
    g.restore();
  }
}, { sweep: false });

// Warning: a triangle with an exclamation mark, a gentle shake.
icon("warn", (g, t) => {
  const shake = 2.5 * Math.sin(TAU * t * 3) * Math.max(0, 1 - t * 2);
  g.translate(shake, 0);
  g.fillStyle = gold(g, 14, 82);
  g.beginPath();
  g.moveTo(50, 12);
  g.lineTo(90, 82);
  g.lineTo(10, 82);
  g.closePath();
  g.fill();
  g.fillStyle = "#FFFFFF";
  g.beginPath();
  g.roundRect(46, 36, 8, 26, 4);
  g.fill();
  g.beginPath();
  g.arc(50, 70, 4.5, 0, TAU);
  g.fill();
}, { still: 0.8, glints: false });

// ------------------------------------------------------------ platforms
/** A soft heartbeat about the tile's centre (two quick pulses per loop). */
function beat(g, t, amount = 0.07) {
  const p = Math.max(0, Math.sin(TAU * t * 2)) ** 3;
  const k = 1 + amount * p;
  g.translate(50, 50);
  g.scale(k, k);
  g.translate(-50, -50);
}
tiled("facebook", ["#3B8BFF", "#0B5CD5"], (g, t) => {
  beat(g, t);
  g.font = "800 94px Inter";
  g.textAlign = "center";
  g.fillText("f", 58, 106);
}, { animate: true });

tiled("youtube", ["#FF4B4B", "#CC0000"], (g, t) => {
  beat(g, t);
  g.beginPath();
  g.roundRect(15, 27, 70, 46, 14);
  g.fill();
  g.shadowColor = "transparent";
  g.fillStyle = "#E00000";
  g.beginPath();
  g.moveTo(43, 38);
  g.lineTo(63, 50);
  g.lineTo(43, 62);
  g.closePath();
  g.fill();
}, { animate: true });

tiled("instagram", ["#F58529", "#8134AF"], (g, t) => {
  beat(g, t);
  g.lineWidth = 7;
  g.beginPath();
  g.roundRect(22, 22, 56, 56, 17);
  g.stroke();
  g.beginPath();
  g.arc(50, 50, 13, 0, Math.PI * 2);
  g.stroke();
  g.beginPath();
  g.arc(66.5, 33.5, 4.5, 0, Math.PI * 2);
  g.fill();
}, { animate: true });

tiled("twitter", ["#3A3A3A", "#000000"], (g, t) => {
  beat(g, t);
  g.beginPath();
  g.moveTo(25, 23);
  g.lineTo(40, 23);
  g.lineTo(76, 77);
  g.lineTo(61, 77);
  g.closePath();
  g.fill();
  g.beginPath();
  g.moveTo(71, 23);
  g.lineTo(77, 23);
  g.lineTo(31, 77);
  g.lineTo(25, 77);
  g.closePath();
  g.fill();
}, { dark: true, animate: true });

tiled("tiktok", ["#2A2A2A", "#000000"], (g, t) => {
  beat(g, t);
  g.shadowColor = "transparent";
  const note = (dx, dy, colour) => {
    g.fillStyle = colour;
    g.strokeStyle = colour;
    g.lineWidth = 8;
    g.beginPath();
    g.arc(40 + dx, 64 + dy, 12, 0, Math.PI * 2);
    g.stroke();
    g.fillRect(48 + dx, 22 + dy, 8, 44);
    g.beginPath();
    g.moveTo(56 + dx, 22 + dy);
    g.quadraticCurveTo(60 + dx, 38 + dy, 74 + dx, 38 + dy);
    g.lineTo(74 + dx, 46 + dy);
    g.quadraticCurveTo(62 + dx, 46 + dy, 56 + dx, 38 + dy);
    g.closePath();
    g.fill();
  };
  note(-2.5, -2, "#25F4EE");
  note(2.5, 2, "#FE2C55");
  note(0, 0, "#FFFFFF");
}, { dark: true, animate: true });

// ------------------------------------------------------------ combined icons
// Drawn after the platform tiles, which two of them reuse.
const pop = (t, at) => ease((t - at) / 0.12) * (1 + 0.15 * Math.max(0, Math.sin(Math.PI * ((t - at - 0.12) / 0.15))));

// Free: the download arrow ringed by the four platforms it takes.
{
  const arrow = await loadImage(fs.readFileSync(path.join(SRC, "download.png")));
  const logos = await Promise.all(["facebook", "youtube", "instagram", "tiktok"].map(async (n) => loadImage(fs.readFileSync(path.join(OUT, `${n}.png`)))));
  icon("free_all", (g, t) => {
    const bob = 2.5 * wave(t, 2);
    g.drawImage(arrow, 16, 14 + bob, 68, 68);
    [[2, 2], [72, 2], [2, 72], [72, 72]].forEach(([x, y], i) => {
      const s = 26 * (t < 0.62 ? pop(t, i * 0.12) : 1);
      if (s > 0.5) g.drawImage(logos[i], x + 13 - s / 2, y + 13 - s / 2, s, s);
    });
}, { still: 0.9, glints: false });
}

// Invite friends, get credit: two friends, a +coin rising between them.
icon("invite", (g, t) => {
  const friend = (x, style, nod) => {
    line(g, 6, style);
    g.beginPath();
    g.arc(x, 50 + nod, 10, 0, TAU);
    g.stroke();
    g.beginPath();
    g.moveTo(x - 17, 90);
    g.bezierCurveTo(x - 17, 68, x + 17, 68, x + 17, 90);
    g.stroke();
  };
  friend(24, blue(g, 38, 90), 1.5 * wave(t));
  friend(76, blue(g, 38, 90), 1.5 * wave(t, 1, 0.5));
  const p = ease((t % 1) / 0.5);
  const y = 44 - 22 * p;
  const k = 0.7 + 0.3 * p;
  g.fillStyle = gold(g, y - 16, y + 16);
  g.beginPath();
  g.arc(50, y, 16 * k, 0, TAU);
  g.fill();
  g.fillStyle = "#FFFFFF";
  g.font = `800 ${Math.round(20 * k)}px Inter`;
  g.textAlign = "center";
  g.fillText("+", 50, y + 7 * k);
}, { still: 0.6 });

// Open App: Telegram's plane with a download badge.
icon("app_tg", (g, t) => {
  const bg = g.createLinearGradient(0, 8, 0, 84);
  bg.addColorStop(0, "#3FC1FF");
  bg.addColorStop(1, "#1C8BD6");
  g.fillStyle = bg;
  g.beginPath();
  g.arc(46, 46, 38, 0, TAU);
  g.fill();
  const fly = 2.5 * wave(t);
  g.save();
  g.translate(fly, -fly);
  g.fillStyle = "#FFFFFF";
  path2(g, [[22, 45], [66, 27], [58, 66], [45, 56], [38, 63], [37, 52], [57, 35], [34, 50]]);
  g.closePath();
  g.fill();
  g.fillStyle = "#D3ECFA";
  path2(g, [[37, 52], [38, 63], [45, 56]]);
  g.closePath();
  g.fill();
  g.restore();
  // The badge: a gold disc, a white arrow dropping into it.
  g.fillStyle = gold(g, 58, 96);
  g.beginPath();
  g.arc(76, 76, 20, 0, TAU);
  g.fill();
  line(g, 3, "#FFFFFF");
  g.beginPath();
  g.arc(76, 76, 20, 0, TAU);
  g.stroke();
  const d = 3 * Math.max(0, wave(t, 2));
  line(g, 5, "#FFFFFF");
  path2(g, [[76, 64 + d], [76, 82 + d]]);
  g.stroke();
  path2(g, [[69, 76 + d], [76, 83 + d], [83, 76 + d]]);
  g.stroke();
}, { glints: false });

// Add Credit: a gold $ coin that spins, a blue plus that pulses.
icon("credit", (g, t) => {
  const spin = Math.cos(TAU * ease(t / 0.6));
  g.save();
  g.translate(44, 54);
  g.scale(Math.max(0.12, Math.abs(spin)), 1);
  g.fillStyle = gold(g, -36, 36);
  g.beginPath();
  g.arc(0, 0, 36, 0, TAU);
  g.fill();
  line(g, 3, "rgba(255,255,255,0.75)");
  g.beginPath();
  g.arc(0, 0, 29, 0, TAU);
  g.stroke();
  if (Math.abs(spin) > 0.3) {
    g.fillStyle = "#FFFFFF";
    g.font = "800 44px Inter";
    g.textAlign = "center";
    g.fillText("$", 0, 16);
  }
  g.restore();
  const k = 1 + 0.18 * Math.max(0, wave(t, 2, 0.25));
  g.translate(80, 22);
  g.scale(k, k);
  g.fillStyle = blue(g, -16, 16);
  g.beginPath();
  g.arc(0, 0, 16, 0, TAU);
  g.fill();
  line(g, 5, "#FFFFFF");
  path2(g, [[-8, 0], [8, 0]]);
  g.stroke();
  path2(g, [[0, -8], [0, 8]]);
  g.stroke();
}, { still: 0.8 });

// ------------------------------------------------------------ 360° logos
/**
 * A badge that turns a full 360° about its upright axis, fast, then rests:
 * the face narrows to its edge and opens again, a coin-thick rim shows
 * while it is side-on, and the face darkens a little as it turns away.
 */
function spin360(face, { turn = 0.55, rim = "#0B1B3A", round = false } = {}) {
  return (g, t) => {
    const a = TAU * ease(t / turn); // one full turn, then still
    const sx = Math.cos(a);
    const side = Math.sin(a);
    g.translate(50, 50);
    // The rim: a few stacked copies, offset toward the side facing us.
    const depth = 4 * Math.abs(side);
    for (let i = depth; i > 0; i -= 1) {
      g.save();
      g.translate(-Math.sign(side) * i * 0.9, 0);
      g.scale(Math.max(0.04, Math.abs(sx)), 1);
      g.fillStyle = rim;
      g.beginPath();
      if (round) g.arc(0, 0, 47, 0, TAU);
      else g.roundRect(-47, -47, 94, 94, 24);
      g.fill();
      g.restore();
    }
    g.save();
    g.scale(Math.max(0.04, Math.abs(sx)), 1);
    g.translate(-50, -50);
    face(g, t, sx < 0);
    // Turned away: a touch darker.
    const dim = 0.3 * (1 - Math.abs(sx));
    if (dim > 0.01) {
      g.globalCompositeOperation = "source-atop";
      g.fillStyle = `rgba(0,0,0,${dim})`;
      g.fillRect(0, 0, S, S);
    }
    g.restore();
  };
}

/** KH Invoice, drawn: a page with a gold dog-ear, green bars, a rising arrow. */
function drawKhInvoice(g, t, back) {
  g.save();
  g.beginPath();
  g.roundRect(3, 3, 94, 94, 24);
  g.clip();
  const bg = g.createLinearGradient(0, 100, 100, 0);
  bg.addColorStop(0, "#101650");
  bg.addColorStop(0.55, "#0E3D6A");
  bg.addColorStop(1, "#0A8580");
  g.fillStyle = bg;
  g.fillRect(0, 0, S, S);
  // Seen from behind the picture mirrors, as a real card would.
  if (back) {
    g.translate(100, 0);
    g.scale(-1, 1);
  }
  // The page, with its corner folded.
  g.lineJoin = "round";
  line(g, 5.5, "#FFFFFF");
  g.beginPath();
  g.moveTo(58, 17);
  g.lineTo(28, 17);
  g.quadraticCurveTo(22, 17, 22, 23);
  g.lineTo(22, 76);
  g.quadraticCurveTo(22, 82, 28, 82);
  g.lineTo(66, 82);
  g.quadraticCurveTo(72, 82, 72, 76);
  g.lineTo(72, 31);
  g.stroke();
  const ear = g.createLinearGradient(58, 17, 72, 31);
  ear.addColorStop(0, "#FFE9A0");
  ear.addColorStop(1, "#C98A12");
  g.fillStyle = ear;
  g.beginPath();
  g.moveTo(58, 15);
  g.quadraticCurveTo(70, 18, 74, 31);
  g.lineTo(60, 31);
  g.quadraticCurveTo(58, 31, 58, 29);
  g.closePath();
  g.fill();
  // Bars.
  const green = (y0) => {
    const gr = g.createLinearGradient(0, y0, 0, 68);
    gr.addColorStop(0, "#6EE7B7");
    gr.addColorStop(1, "#047857");
    return gr;
  };
  for (const [x, top] of [[31, 52], [41, 44], [51, 38]]) {
    g.fillStyle = green(top);
    g.beginPath();
    g.roundRect(x, top, 7, 66 - top, 2);
    g.fill();
  }
  // The arrow: white under green, climbing out of the page.
  const pts = [[14, 84], [36, 62], [48, 72], [80, 34]];
  line(g, 11, "#FFFFFF");
  path2(g, pts);
  g.stroke();
  const ag = g.createLinearGradient(14, 84, 84, 26);
  ag.addColorStop(0, "#047857");
  ag.addColorStop(1, "#34D399");
  line(g, 6, ag);
  path2(g, pts);
  g.stroke();
  g.fillStyle = "#FFFFFF";
  path2(g, [[88, 22], [70, 30], [84, 42]]);
  g.closePath();
  g.fill();
  g.fillStyle = "#34D399";
  path2(g, [[85, 26], [74, 31], [83, 38]]);
  g.closePath();
  g.fill();
  g.restore();
  // Rim light.
  line(g, 1.6, "rgba(255,255,255,0.35)");
  g.beginPath();
  g.roundRect(4, 4, 92, 92, 23);
  g.stroke();
}

/** SaveIt KH, as a face for the spin (its own badge, arrows falling). */
function drawSaveItFace(g, t) {
  drawSaveIt(g, Math.max(0, (t - 0.5) / 0.5)); // the drop plays once it rests
}

icon("inv_app", spin360(drawKhInvoice, { rim: "#07243F" }), { glints: true, still: 0.8 });
icon("logo", spin360(drawSaveItFace, { rim: "#0A1630", round: true }), { glints: true, still: 0.8 });

// ------------------------------------------------------------ profile videos
// Each logo at 640x640, turning 360°, as an MP4 loop and a PNG, for an
// animated profile photo (Telegram Premium). Written to assets/profile.
//
// Telegram crops a profile photo to a circle, so the logo is shrunk by
// `scale` until all of it sits inside that circle -- drawn full-bleed, the
// SaveIt ring and the KH Invoice tile's corners and arrow were cut off.
function profileVideo(file, draw, background, scale) {
  const dir = path.join(ROOT, "assets", "profile");
  fs.mkdirSync(dir, { recursive: true });
  const SIZE = 640;
  const big = (t) => {
    // The logo goes on a clear layer first: spin360's "turned away" dimming
    // paints over everything already there, which would darken a box of the
    // background around the shrunken logo mid-turn.
    const logo = createCanvas(SIZE, SIZE);
    const lg = logo.getContext("2d");
    lg.scale(SIZE / 100, SIZE / 100);
    lg.translate(50 * (1 - scale), 50 * (1 - scale));
    lg.scale(scale, scale);
    lg.lineCap = "round";
    lg.lineJoin = "round";
    draw(lg, t);
    const c = createCanvas(SIZE, SIZE);
    const g = c.getContext("2d");
    g.fillStyle = background;
    g.fillRect(0, 0, SIZE, SIZE);
    g.drawImage(logo, 0, 0);
    return c;
  };
  fs.writeFileSync(path.join(dir, `${file}.png`), big(0.8).toBuffer("image/png"));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "profile-"));
  try {
    for (let i = 0; i < FRAMES; i++) {
      fs.writeFileSync(path.join(tmp, `f${String(i).padStart(3, "0")}.png`), big(i / FRAMES).toBuffer("image/png"));
    }
    execFileSync(FFMPEG, [
      "-y", "-loglevel", "error", "-framerate", String(FPS), "-i", path.join(tmp, "f%03d.png"),
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-movflags", "+faststart", "-an",
      path.join(dir, `${file}.mp4`),
    ]);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
// A round badge only needs its ring pulled in; the rounded tile's corners
// reach ~57 from the centre, so it shrinks to fit the circle's radius of 50.
profileVideo("saveit-logo", spin360(drawSaveItFace, { rim: "#0A1630", round: true }), "#050B18", 0.9);
profileVideo("kh-invoice-logo", spin360(drawKhInvoice, { rim: "#07243F" }), "#0B1640", 0.8);

// ------------------------------------------------------------ preview
if (process.argv[2]) {
  const files = fs.readdirSync(OUT).filter((f) => f.endsWith(".png")).sort();
  const cols = 10;
  const rows = Math.ceil(files.length / cols);
  const sheet = createCanvas(cols * 110, rows * 130 * 2);
  const s = sheet.getContext("2d");
  for (const [half, bg, fg] of [[0, "#17212B", "#FFFFFF"], [1, "#FFFFFF", "#17212B"]]) {
    s.fillStyle = bg;
    s.fillRect(0, half * rows * 130, sheet.width, rows * 130);
    s.fillStyle = fg;
    s.font = "800 11px Inter";
    s.textAlign = "center";
    for (const [i, f] of files.entries()) {
      const x = (i % cols) * 110;
      const y = Math.floor(i / cols) * 130 + half * rows * 130;
      s.drawImage(await loadImage(fs.readFileSync(path.join(OUT, f))), x + 5, y + 5, 100, 100);
      s.fillText(f.replace(".png", ""), x + 55, y + 122);
    }
  }
  fs.writeFileSync(process.argv[2], sheet.toBuffer("image/png"));
}
