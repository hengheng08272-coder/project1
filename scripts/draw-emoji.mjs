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
