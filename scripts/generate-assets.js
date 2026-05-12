/**
 * Generates app icon (1024x1024) and splash screen (1024x1024) as PNG files.
 * Uses only Node.js built-in modules (zlib, fs, Buffer) — no external packages.
 * Run with: node scripts/generate-assets.js
 */

const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

// ── CRC32 (required by PNG format) ──────────────────────────────────────────
const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
  CRC_TABLE[i] = c;
}
function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (const byte of buf) crc = CRC_TABLE[(crc ^ byte) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// ── PNG writer ───────────────────────────────────────────────────────────────
function pngChunk(type, data) {
  const t = Buffer.from(type);
  const d = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const len = Buffer.alloc(4); len.writeUInt32BE(d.length);
  const crcBuf = Buffer.alloc(4); crcBuf.writeUInt32BE(crc32(Buffer.concat([t, d])));
  return Buffer.concat([len, t, d, crcBuf]);
}

function writePNG(filename, w, h, getColor) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB

  const rowBufs = [];
  for (let y = 0; y < h; y++) {
    const row = Buffer.alloc(1 + w * 3);
    row[0] = 0; // filter: None
    for (let x = 0; x < w; x++) {
      const [r, g, b] = getColor(x, y, w, h);
      row[1 + x * 3] = r;
      row[2 + x * 3] = g;
      row[3 + x * 3] = b;
    }
    rowBufs.push(row);
  }
  const compressed = zlib.deflateSync(Buffer.concat(rowBufs), { level: 6 });
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  fs.writeFileSync(filename, Buffer.concat([
    sig,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', Buffer.alloc(0)),
  ]));
  console.log(`✓  ${filename}`);
}

// ── Geometry helpers ──────────────────────────────────────────────────────────
function dist2(ax, ay, bx, by) { return (ax - bx) ** 2 + (ay - by) ** 2; }

function inRoundedRect(x, y, rx, ry, rw, rh, radius) {
  if (x < rx || x > rx + rw || y < ry || y > ry + rh) return false;
  const corners = [
    [rx + radius, ry + radius],
    [rx + rw - radius, ry + radius],
    [rx + radius, ry + rh - radius],
    [rx + rw - radius, ry + rh - radius],
  ];
  for (const [cx, cy] of corners) {
    if (x < cx + 0.5 && x > cx - radius - 0.5 &&
        y < cy + 0.5 && y > cy - radius - 0.5) {
      if ((x < cx && y < cy) ||
          (x > cx && y < cy) ||
          (x < cx && y > cy) ||
          (x > cx && y > cy)) {
        if (dist2(x, y, cx, cy) > radius * radius) return false;
      }
    }
  }
  return true;
}

function inCircle(x, y, cx, cy, r) { return dist2(x, y, cx, cy) <= r * r; }

// ── Color palette ─────────────────────────────────────────────────────────────
const BRAND   = [59,  91,  219];  // #3B5BDB
const NAVY    = [30,  58,  138];  // #1E3A8A
const WHITE   = [255, 255, 255];
const BG_GRAY = [240, 244, 255];  // #F0F4FF

// ── Icon design ───────────────────────────────────────────────────────────────
// Deep navy rounded-square background, white card, three list rows with dots
function iconColor(x, y, W, H) {
  const cx = W / 2, cy = H / 2;

  // Background: navy rounded square (full bleed, 160px radius)
  const bg = inRoundedRect(x, y, 0, 0, W, H, 160);
  if (!bg) return NAVY;

  // Subtle radial gradient on background (lighter at top-left)
  const gradT = Math.max(0, 1 - Math.sqrt(dist2(x, y, cx * 0.5, cy * 0.5)) / (W * 0.8));
  const bgR = Math.round(NAVY[0] + (BRAND[0] - NAVY[0]) * gradT * 0.6);
  const bgG = Math.round(NAVY[1] + (BRAND[1] - NAVY[1]) * gradT * 0.6);
  const bgB = Math.round(NAVY[2] + (BRAND[2] - NAVY[2]) * gradT * 0.6);

  // White card (centred, 560×660, 60px radius)
  const cw = 560, ch = 660, cr = 60;
  const cardX = cx - cw / 2, cardY = cy - ch / 2;
  if (inRoundedRect(x, y, cardX, cardY, cw, ch, cr)) {

    // Three list rows
    const rowData = [
      { y: cardY + 160, dotFill: true  },
      { y: cardY + 300, dotFill: false },
      { y: cardY + 440, dotFill: false },
    ];
    for (const row of rowData) {
      const rowH = 44, lineH = 10;
      const dotSize = 38, dotX = cardX + 60, dotY = row.y + rowH / 2 - dotSize / 2;
      const lineX = cardX + 60 + dotSize + 28;
      const lineY = row.y + rowH / 2 - lineH / 2;
      const lineW = cw - 120 - dotSize - 28 - 40;

      // Dot (checkbox)
      if (inRoundedRect(x, y, dotX, dotY, dotSize, dotSize, 8)) {
        if (row.dotFill) {
          // Filled dot (completed) — brand blue
          return BRAND;
        }
        // Empty dot — light blue border
        const borderW = 4;
        if (!inRoundedRect(x, y, dotX + borderW, dotY + borderW,
                           dotSize - borderW * 2, dotSize - borderW * 2, 5)) {
          return BRAND;
        }
        return WHITE;
      }

      // Line
      if (x >= lineX && x <= lineX + lineW && y >= lineY && y <= lineY + lineH) {
        // First line shorter (crossed off)
        if (row.dotFill && x > lineX + lineW * 0.55) {
          return BG_GRAY;
        }
        return BRAND;
      }
    }

    return WHITE;
  }

  return [bgR, bgG, bgB];
}

// ── Splash design ─────────────────────────────────────────────────────────────
// Clean white background with centred brand circle + abstract lines
function splashColor(x, y, W, H) {
  const cx = W / 2, cy = H / 2;

  // White background
  let color = WHITE;

  // Blue brand circle
  const r = 200;
  if (inCircle(x, y, cx, cy, r)) {
    color = BRAND;

    // White lines inside circle (mini list)
    const lineH = 10;
    const lineData = [
      { ly: cy - 45, dotFill: true  },
      { ly: cy,      dotFill: false },
      { ly: cy + 45, dotFill: false },
    ];
    for (const { ly, dotFill } of lineData) {
      const dotSz = 20, dotX = cx - 90, dotY = ly - dotSz / 2;
      const lx = dotX + dotSz + 16, lw = 110;

      if (inRoundedRect(x, y, dotX, dotY, dotSz, dotSz, 4)) {
        if (dotFill) return WHITE;
        const bw = 3;
        if (!inRoundedRect(x, y, dotX + bw, dotY + bw, dotSz - bw * 2, dotSz - bw * 2, 2)) {
          return WHITE;
        }
        return BRAND;
      }
      if (x >= lx && x <= lx + lw && y >= ly - lineH / 2 && y <= ly + lineH / 2) {
        return WHITE;
      }
    }
  }

  return color;
}

// ── Generate ──────────────────────────────────────────────────────────────────
const assetsDir = path.join(__dirname, '..', 'assets');
const SIZE = 1024;

console.log('Generating assets…');
writePNG(path.join(assetsDir, 'icon.png'), SIZE, SIZE, iconColor);
writePNG(path.join(assetsDir, 'adaptive-icon.png'), SIZE, SIZE, iconColor);
writePNG(path.join(assetsDir, 'splash-icon.png'), SIZE, SIZE, splashColor);
// Favicon: 48x48 version of the icon
writePNG(path.join(assetsDir, 'favicon.png'), 48, 48, iconColor);
console.log('Done.');
