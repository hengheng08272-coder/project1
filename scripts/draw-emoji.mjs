// Draws the bot's custom emoji tiles into assets/emoji (100x100 PNG, the size
// Telegram wants for a custom emoji pack). One glossy style for all of them:
// gradient tile, top shine, thin light rim, soft shadow under the symbol.
// Bank logos are raster files and are not made here.
//
//   node scripts/draw-emoji.mjs            -> writes the tiles
//   node scripts/draw-emoji.mjs sheet.png  -> also a preview sheet
//
// After changing tiles, the operator runs /makeemoji in the bot to rebuild
// the pack.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createCanvas, GlobalFonts, loadImage } from "@napi-rs/canvas";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "assets", "emoji");
GlobalFonts.registerFromPath(path.join(ROOT, "assets", "fonts", "Inter_800ExtraBold.ttf"), "Inter");

const S = 100;
const R = 26;

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

/** One glossy tile. `draw` paints the symbol in white (or its own colours). */
function tile(name, [top, bottom], draw, { sparkles = false, dark = false } = {}) {
  const c = createCanvas(S, S);
  const g = c.getContext("2d");
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
  g.ellipse(50, 8, 62, 44, 0, 0, Math.PI * 2);
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
  draw(g);
  g.restore();

  if (sparkles) {
    sparkle(g, 80, 18, 7);
    sparkle(g, 88, 32, 3.5);
  }

  // Thin light rim.
  g.strokeStyle = "rgba(255,255,255,0.35)";
  g.lineWidth = 2;
  g.beginPath();
  g.roundRect(3, 3, 94, 94, R - 1);
  g.stroke();

  fs.writeFileSync(path.join(OUT, `${name}.png`), c.toBuffer("image/png"));
}

const person = (g, x, y, s) => {
  g.beginPath();
  g.arc(x, y - 12 * s, 11 * s, 0, Math.PI * 2);
  g.fill();
  g.beginPath();
  g.moveTo(x - 20 * s, y + 22 * s);
  g.quadraticCurveTo(x - 20 * s, y + 2 * s, x, y + 2 * s);
  g.quadraticCurveTo(x + 20 * s, y + 2 * s, x + 20 * s, y + 22 * s);
  g.closePath();
  g.fill();
};

// ------------------------------------------------------------ main menu
tile("m_free", ["#4ADE80", "#15803D"], (g) => {
  g.lineWidth = 10;
  g.beginPath();
  g.moveTo(50, 50);
  g.bezierCurveTo(38, 30, 16, 32, 16, 50);
  g.bezierCurveTo(16, 68, 38, 70, 50, 50);
  g.bezierCurveTo(62, 30, 84, 32, 84, 50);
  g.bezierCurveTo(84, 68, 62, 70, 50, 50);
  g.stroke();
}, { sparkles: true });

tile("m_pro", ["#38BDF8", "#1D6FD1"], (g) => {
  // paper plane
  g.beginPath();
  g.moveTo(18, 48);
  g.lineTo(80, 22);
  g.lineTo(66, 78);
  g.lineTo(46, 60);
  g.closePath();
  g.fill();
  g.fillStyle = "#BFE3FA";
  g.beginPath();
  g.moveTo(46, 60);
  g.lineTo(80, 22);
  g.lineTo(42, 74);
  g.closePath();
  g.fill();
}, { sparkles: true });

tile("m_account", ["#60A5FA", "#1E40AF"], (g) => person(g, 50, 46, 1.25));

tile("m_buy", ["#67E8F9", "#0E7490"], (g) => {
  g.beginPath();
  g.moveTo(30, 28);
  g.lineTo(70, 28);
  g.lineTo(84, 44);
  g.lineTo(50, 82);
  g.lineTo(16, 44);
  g.closePath();
  g.fill();
  g.strokeStyle = "#0E7490";
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(16, 44);
  g.lineTo(84, 44);
  g.moveTo(38, 28);
  g.lineTo(32, 44);
  g.lineTo(50, 82);
  g.lineTo(68, 44);
  g.lineTo(62, 28);
  g.stroke();
}, { sparkles: true });

tile("m_history", ["#A5B4FC", "#4338CA"], (g) => {
  g.lineWidth = 8;
  g.beginPath();
  g.arc(52, 52, 27, Math.PI * 0.95, Math.PI * 2.75);
  g.stroke();
  g.beginPath();
  g.moveTo(14, 44);
  g.lineTo(26, 58);
  g.lineTo(36, 42);
  g.closePath();
  g.fill();
  g.lineWidth = 7;
  g.beginPath();
  g.moveTo(52, 36);
  g.lineTo(52, 53);
  g.lineTo(64, 60);
  g.stroke();
});

tile("m_referral", ["#FDBA74", "#C2410C"], (g) => {
  g.globalAlpha = 0.85;
  person(g, 64, 44, 0.9);
  g.globalAlpha = 1;
  person(g, 40, 52, 1.05);
});

tile("m_language", ["#5EEAD4", "#0F766E"], (g) => {
  g.lineWidth = 6;
  g.beginPath();
  g.arc(50, 50, 30, 0, Math.PI * 2);
  g.stroke();
  g.beginPath();
  g.ellipse(50, 50, 13, 30, 0, 0, Math.PI * 2);
  g.stroke();
  g.lineWidth = 5;
  g.beginPath();
  g.moveTo(21, 40);
  g.lineTo(79, 40);
  g.moveTo(21, 60);
  g.lineTo(79, 60);
  g.stroke();
});

tile("m_help", ["#FDA4AF", "#BE123C"], (g) => {
  g.font = "800 66px Inter";
  g.textAlign = "center";
  g.fillText("?", 50, 74);
});

tile("m_desktop", ["#CBD5E1", "#475569"], (g) => {
  g.beginPath();
  g.roundRect(16, 22, 68, 46, 7);
  g.fill();
  g.fillStyle = "#475569";
  g.fillRect(22, 28, 56, 34);
  g.fillStyle = "#FFFFFF";
  g.fillRect(44, 68, 12, 9);
  g.beginPath();
  g.roundRect(32, 76, 36, 6, 3);
  g.fill();
});

// ------------------------------------------------------------ KH Invoice
tile("inv_create", ["#60A5FA", "#1B5FA8"], (g) => {
  g.beginPath();
  g.moveTo(24, 16);
  g.lineTo(64, 16);
  g.lineTo(64, 80);
  for (let i = 0; i < 5; i++) {
    g.lineTo(60 - i * 8, 74);
    g.lineTo(56 - i * 8, 80);
  }
  g.lineTo(24, 80);
  g.closePath();
  g.fill();
  g.shadowColor = "transparent";
  g.strokeStyle = "#1B5FA8";
  g.lineWidth = 5;
  for (const y of [31, 43, 55]) {
    g.beginPath();
    g.moveTo(32, y);
    g.lineTo(56, y);
    g.stroke();
  }
  g.fillStyle = "#22C55E";
  g.beginPath();
  g.arc(71, 71, 16, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = "#FFFFFF";
  g.lineWidth = 5;
  g.beginPath();
  g.moveTo(71, 62);
  g.lineTo(71, 80);
  g.moveTo(62, 71);
  g.lineTo(80, 71);
  g.stroke();
});

tile("inv_in", ["#4ADE80", "#138A5B"], (g) => {
  g.lineWidth = 12;
  g.beginPath();
  g.moveTo(50, 78);
  g.lineTo(50, 28);
  g.stroke();
  g.beginPath();
  g.moveTo(28, 47);
  g.lineTo(50, 24);
  g.lineTo(72, 47);
  g.stroke();
});

tile("inv_out", ["#FB923C", "#C9361F"], (g) => {
  g.lineWidth = 12;
  g.beginPath();
  g.moveTo(50, 22);
  g.lineTo(50, 72);
  g.stroke();
  g.beginPath();
  g.moveTo(28, 53);
  g.lineTo(50, 76);
  g.lineTo(72, 53);
  g.stroke();
});

tile("inv_report", ["#60A5FA", "#0C447C"], (g) => {
  for (const [x, top] of [[24, 56], [42, 38], [60, 48], [78, 26]]) {
    g.beginPath();
    g.roundRect(x - 7, top, 14, 78 - top, 4);
    g.fill();
  }
  g.fillRect(16, 79, 70, 5);
});

tile("inv_stock", ["#34D399", "#0B5E48"], (g) => {
  g.beginPath();
  g.moveTo(50, 18);
  g.lineTo(80, 33);
  g.lineTo(80, 67);
  g.lineTo(50, 82);
  g.lineTo(20, 67);
  g.lineTo(20, 33);
  g.closePath();
  g.fill();
  g.shadowColor = "transparent";
  g.strokeStyle = "#0B5E48";
  g.lineWidth = 4;
  g.beginPath();
  g.moveTo(20, 33);
  g.lineTo(50, 48);
  g.lineTo(80, 33);
  g.moveTo(50, 48);
  g.lineTo(50, 82);
  g.stroke();
});

tile("inv_unpaid", ["#FCD34D", "#C27A12"], (g) => {
  g.beginPath();
  g.arc(50, 50, 29, 0, Math.PI * 2);
  g.fill();
  g.shadowColor = "transparent";
  g.strokeStyle = "#C27A12";
  g.lineWidth = 6;
  g.beginPath();
  g.moveTo(50, 33);
  g.lineTo(50, 51);
  g.lineTo(62, 58);
  g.stroke();
});

tile("inv_refresh", ["#94A3B8", "#45546B"], (g) => {
  g.lineWidth = 9;
  g.beginPath();
  g.arc(50, 50, 24, Math.PI * 1.15, Math.PI * 1.95);
  g.stroke();
  g.beginPath();
  g.arc(50, 50, 24, Math.PI * 0.15, Math.PI * 0.95);
  g.stroke();
  const head = (x, y, a) => {
    g.save();
    g.translate(x, y);
    g.rotate(a);
    g.beginPath();
    g.moveTo(0, -11);
    g.lineTo(11, 2);
    g.lineTo(-9, 4);
    g.closePath();
    g.fill();
    g.restore();
  };
  head(73, 42, 0.3);
  head(27, 58, Math.PI + 0.3);
});

tile("inv_pro", ["#FDE68A", "#D18A12"], (g) => {
  g.beginPath();
  g.moveTo(18, 70);
  g.lineTo(22, 32);
  g.lineTo(37, 50);
  g.lineTo(50, 24);
  g.lineTo(63, 50);
  g.lineTo(78, 32);
  g.lineTo(82, 70);
  g.closePath();
  g.fill();
  g.fillRect(18, 72, 64, 9);
  g.shadowColor = "transparent";
  g.fillStyle = "#E11D48";
  g.beginPath();
  g.arc(50, 60, 5, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#2563EB";
  for (const x of [32, 68]) {
    g.beginPath();
    g.arc(x, 62, 4, 0, Math.PI * 2);
    g.fill();
  }
}, { sparkles: true });

tile("inv_summary", ["#A78BFA", "#4F3BC4"], (g) => {
  g.beginPath();
  g.roundRect(25, 21, 50, 62, 9);
  g.fill();
  g.shadowColor = "transparent";
  g.fillStyle = "#4F3BC4";
  g.beginPath();
  g.roundRect(38, 15, 24, 12, 4);
  g.fill();
  g.strokeStyle = "#4F3BC4";
  g.lineWidth = 5;
  for (const y of [42, 54, 66]) {
    g.beginPath();
    g.moveTo(34, y);
    g.lineTo(66, y);
    g.stroke();
  }
});

tile("inv_shop", ["#F9A8D4", "#BE185D"], (g) => {
  g.fillRect(25, 50, 50, 31);
  g.beginPath();
  g.moveTo(16, 48);
  g.lineTo(25, 22);
  g.lineTo(75, 22);
  g.lineTo(84, 48);
  g.closePath();
  g.fill();
  g.shadowColor = "transparent";
  g.fillStyle = "#BE185D";
  for (const x of [33, 50, 67]) {
    g.beginPath();
    g.arc(x, 48, 8.5, 0, Math.PI);
    g.fill();
  }
  g.fillRect(44, 61, 12, 20);
});

tile("inv_back", ["#CBD5E1", "#475569"], (g) => {
  g.lineWidth = 12;
  g.beginPath();
  g.moveTo(76, 50);
  g.lineTo(28, 50);
  g.stroke();
  g.beginPath();
  g.moveTo(47, 29);
  g.lineTo(26, 50);
  g.lineTo(47, 71);
  g.stroke();
});

// ------------------------------------------------------------ platforms
tile("facebook", ["#3B8BFF", "#0B5CD5"], (g) => {
  g.font = "800 94px Inter";
  g.textAlign = "center";
  g.fillText("f", 58, 106);
});

tile("youtube", ["#FF4B4B", "#CC0000"], (g) => {
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
});

tile("instagram", ["#F58529", "#8134AF"], (g) => {
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
});

tile("twitter", ["#3A3A3A", "#000000"], (g) => {
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
}, { dark: true });

tile("tiktok", ["#2A2A2A", "#000000"], (g) => {
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
}, { dark: true });

// ------------------------------------------------------------ illustrations
// Flat, outlined drawings (the style the operator picked) on a white tile.
const INK = "#2F3441";
const WHITE_TILE = ["#FFFFFF", "#E3E9F1"];

function gear(g, cx, cy, rOuter, rBody, teeth, fillL, fillR, hole) {
  g.save();
  g.beginPath();
  for (let i = 0; i < teeth; i++) {
    const a = (i / teeth) * Math.PI * 2;
    const w = (Math.PI * 2) / teeth / 4;
    g.lineTo(cx + Math.cos(a - w * 1.4) * rBody, cy + Math.sin(a - w * 1.4) * rBody);
    g.lineTo(cx + Math.cos(a - w) * rOuter, cy + Math.sin(a - w) * rOuter);
    g.lineTo(cx + Math.cos(a + w) * rOuter, cy + Math.sin(a + w) * rOuter);
    g.lineTo(cx + Math.cos(a + w * 1.4) * rBody, cy + Math.sin(a + w * 1.4) * rBody);
  }
  g.closePath();
  g.save();
  g.clip();
  g.fillStyle = fillL;
  g.fillRect(cx - rOuter - 2, cy - rOuter - 2, rOuter + 2, rOuter * 2 + 4);
  g.fillStyle = fillR;
  g.fillRect(cx, cy - rOuter - 2, rOuter + 2, rOuter * 2 + 4);
  g.restore();
  g.stroke();
  g.fillStyle = hole;
  g.beginPath();
  g.arc(cx, cy, rBody * 0.42, 0, Math.PI * 2);
  g.fill();
  if (hole === "#FFFFFF") g.stroke();
  g.restore();
}

// Account: business person with a gear for a head.
tile("m_account", WHITE_TILE, (g) => {
  g.shadowColor = "transparent";
  g.strokeStyle = INK;
  g.lineWidth = 3;
  // suit
  g.fillStyle = "#C3CAD4";
  g.beginPath();
  g.moveTo(10, 98);
  g.lineTo(12, 80);
  g.quadraticCurveTo(14, 68, 32, 64);
  g.lineTo(68, 64);
  g.quadraticCurveTo(86, 68, 88, 80);
  g.lineTo(90, 98);
  g.closePath();
  g.fill();
  g.stroke();
  // shirt
  g.fillStyle = "#C4B5FD";
  g.beginPath();
  g.moveTo(36, 64);
  g.lineTo(50, 84);
  g.lineTo(64, 64);
  g.closePath();
  g.fill();
  g.stroke();
  // tie
  g.fillStyle = "#FFFFFF";
  g.beginPath();
  g.moveTo(47, 72);
  g.lineTo(53, 72);
  g.lineTo(55, 90);
  g.lineTo(50, 95);
  g.lineTo(45, 90);
  g.closePath();
  g.fill();
  g.stroke();
  // lapels
  g.beginPath();
  g.moveTo(34, 65);
  g.lineTo(44, 96);
  g.moveTo(66, 65);
  g.lineTo(56, 96);
  g.stroke();
  // gear head
  gear(g, 50, 34, 25, 18, 8, "#FCD34D", "#F59E0B", INK);
});

// Help: support agent with a headset, a gear and a wrench beside.
tile("m_help", WHITE_TILE, (g) => {
  g.shadowColor = "transparent";
  const LINE = "#2B7FD4";
  const FILL = "#CFE5FB";
  g.strokeStyle = LINE;
  g.fillStyle = FILL;
  g.lineWidth = 3.5;
  // gear + wrench (behind)
  gear(g, 72, 64, 17, 12, 8, FILL, FILL, "#FFFFFF");
  g.strokeStyle = LINE;
  g.fillStyle = FILL;
  // wrench: handle, then a round head with an open jaw
  g.beginPath();
  g.roundRect(68, 26, 8, 26, 3);
  g.fill();
  g.stroke();
  g.beginPath();
  g.arc(72, 20, 11, 0, Math.PI * 2);
  g.fill();
  g.stroke();
  g.fillStyle = "#FFFFFF";
  g.beginPath();
  g.moveTo(66, 4);
  g.lineTo(78, 4);
  g.lineTo(76, 19);
  g.lineTo(68, 19);
  g.closePath();
  g.fill();
  g.beginPath();
  g.moveTo(66, 10);
  g.lineTo(68, 19);
  g.lineTo(76, 19);
  g.lineTo(78, 10);
  g.stroke();
  g.fillStyle = FILL;
  // body
  g.beginPath();
  g.moveTo(8, 98);
  g.lineTo(9, 84);
  g.quadraticCurveTo(12, 70, 30, 67);
  g.lineTo(46, 67);
  g.quadraticCurveTo(64, 70, 66, 84);
  g.lineTo(66, 98);
  g.closePath();
  g.fill();
  g.stroke();
  // head
  g.beginPath();
  g.arc(37, 44, 16, 0, Math.PI * 2);
  g.fillStyle = "#FFFFFF";
  g.fill();
  g.stroke();
  // hair
  g.fillStyle = FILL;
  g.beginPath();
  g.moveTo(21, 42);
  g.quadraticCurveTo(22, 27, 37, 27);
  g.quadraticCurveTo(52, 27, 53, 42);
  g.quadraticCurveTo(45, 34, 36, 38);
  g.quadraticCurveTo(28, 40, 21, 42);
  g.closePath();
  g.fill();
  g.stroke();
  // eyes
  g.fillStyle = LINE;
  g.fillRect(30, 45, 3.5, 3.5);
  g.fillRect(41, 45, 3.5, 3.5);
  // headset
  g.beginPath();
  g.arc(37, 44, 21, Math.PI * 1.05, Math.PI * 1.95);
  g.stroke();
  g.fillStyle = FILL;
  for (const x of [13, 55]) {
    g.beginPath();
    g.roundRect(x, 38, 7, 14, 3);
    g.fill();
    g.stroke();
  }
  g.beginPath();
  g.moveTo(57, 52);
  g.quadraticCurveTo(56, 60, 44, 58);
  g.stroke();
});

// Income: an open hand receiving a coin.
tile("inv_in", WHITE_TILE, (g) => {
  g.shadowColor = "transparent";
  g.strokeStyle = INK;
  g.lineWidth = 3.5;
  // coin
  g.fillStyle = "#FCD776";
  g.beginPath();
  g.arc(58, 27, 17, 0, Math.PI * 2);
  g.fill();
  g.stroke();
  g.fillStyle = INK;
  g.font = "800 22px Inter";
  g.textAlign = "center";
  g.fillText("$", 58, 35);
  // hand
  g.fillStyle = "#F9C4AE";
  g.beginPath();
  g.moveTo(30, 66);
  g.bezierCurveTo(44, 58, 62, 62, 78, 54);
  g.bezierCurveTo(86, 50, 92, 58, 86, 63);
  g.bezierCurveTo(74, 74, 54, 82, 36, 84);
  g.closePath();
  g.fill();
  g.stroke();
  g.beginPath();
  g.moveTo(50, 70);
  g.lineTo(66, 68);
  g.stroke();
  // cuff
  g.save();
  g.translate(24, 78);
  g.rotate(-0.62);
  g.fillStyle = "#7DD3E8";
  g.beginPath();
  g.roundRect(-10, -14, 20, 30, 3);
  g.fill();
  g.stroke();
  g.restore();
});

// Expense: one hand handing a banknote over to another.
tile("inv_out", WHITE_TILE, (g) => {
  g.shadowColor = "transparent";
  const HAND = "#3B9AD9";
  // lower, receiving hand
  g.fillStyle = HAND;
  g.beginPath();
  g.moveTo(24, 70);
  g.bezierCurveTo(40, 64, 60, 70, 76, 62);
  g.bezierCurveTo(84, 58, 88, 66, 82, 70);
  g.bezierCurveTo(70, 80, 50, 84, 30, 84);
  g.closePath();
  g.fill();
  g.fillRect(12, 70, 14, 16);
  // banknote
  g.save();
  g.translate(56, 38);
  g.rotate(-0.45);
  g.fillStyle = "#4ADE80";
  g.strokeStyle = "#15803D";
  g.lineWidth = 2.5;
  g.beginPath();
  g.roundRect(-20, -12, 40, 24, 3);
  g.fill();
  g.stroke();
  g.beginPath();
  g.arc(0, 0, 7, 0, Math.PI * 2);
  g.stroke();
  g.restore();
  // upper, giving hand
  g.fillStyle = HAND;
  g.beginPath();
  g.moveTo(16, 30);
  g.bezierCurveTo(28, 26, 40, 30, 48, 36);
  g.bezierCurveTo(52, 40, 48, 46, 42, 44);
  g.bezierCurveTo(34, 42, 26, 44, 18, 46);
  g.closePath();
  g.fill();
  g.fillRect(6, 28, 12, 20);
});

// Create invoice: a bill with a checklist, a dollar sign and a pen.
tile("inv_create", WHITE_TILE, (g) => {
  g.shadowColor = "transparent";
  const TEAL = "#16706A";
  g.strokeStyle = TEAL;
  g.lineWidth = 3.5;
  // paper with folded corner
  g.fillStyle = "#E3F6EE";
  g.beginPath();
  g.moveTo(20, 16);
  g.lineTo(58, 16);
  g.lineTo(70, 28);
  g.lineTo(70, 86);
  g.lineTo(20, 86);
  g.closePath();
  g.fill();
  g.stroke();
  g.fillStyle = "#A7E3C9";
  g.beginPath();
  g.moveTo(58, 16);
  g.lineTo(58, 28);
  g.lineTo(70, 28);
  g.closePath();
  g.fill();
  g.stroke();
  // checklist
  g.lineWidth = 3;
  for (const y of [30, 46, 62]) {
    g.strokeRect(27, y - 5, 9, 9);
    g.beginPath();
    g.moveTo(42, y);
    g.lineTo(56, y);
    g.stroke();
  }
  g.fillStyle = TEAL;
  g.font = "800 15px Inter";
  g.textAlign = "center";
  g.fillText("$", 47, 81);
  // pen
  g.save();
  g.translate(74, 58);
  g.rotate(0.55);
  g.fillStyle = "#86EFAC";
  g.lineWidth = 3;
  g.beginPath();
  g.roundRect(-6, -30, 12, 44, 3);
  g.fill();
  g.stroke();
  g.fillStyle = "#FDE68A";
  g.beginPath();
  g.moveTo(-6, 14);
  g.lineTo(6, 14);
  g.lineTo(0, 26);
  g.closePath();
  g.fill();
  g.stroke();
  g.restore();
});

// ------------------------------------------------------------ preview
if (process.argv[2]) {
  const files = fs.readdirSync(OUT).filter((f) => f.endsWith(".png")).sort();
  const cols = 12;
  const rows = Math.ceil(files.length / cols);
  const sheet = createCanvas(cols * 110, rows * 130);
  const s = sheet.getContext("2d");
  s.fillStyle = "#17212B";
  s.fillRect(0, 0, sheet.width, sheet.height);
  s.fillStyle = "#FFFFFF";
  s.font = "800 11px Inter";
  s.textAlign = "center";
  for (const [i, f] of files.entries()) {
    const x = (i % cols) * 110;
    const y = Math.floor(i / cols) * 130;
    s.drawImage(await loadImage(fs.readFileSync(path.join(OUT, f))), x + 5, y + 5, 100, 100);
    s.fillText(f.replace(".png", ""), x + 55, y + 122);
  }
  fs.writeFileSync(process.argv[2], sheet.toBuffer("image/png"));
}
