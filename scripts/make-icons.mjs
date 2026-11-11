// Generates the PWA / Home Screen icons from the companion sprite (lantern + flame spirit).
// Usage: npm run icons  →  apps/web/public/{favicon,apple-touch-icon,icon-192,icon-512,icon-512-maskable}.png
// Only node:zlib and node:fs: the PNG encoder (CRC32 + zlib-deflated scanlines) is written by hand.

import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

// Copy of SPRITES.companion[0] (frame 0) and its palette from apps/web/src/art/sprites.ts and
// apps/web/src/art/palette.ts. Keep in sync by hand if the sprite changes.
const ROWS = [
  '......DDDD......',
  '.....D....D.....',
  '.....oGBBDo.....',
  '....oGBBBBDo....',
  '..oDDDDDDDDDDo..',
  '..oBgggaRaggDo..',
  '..oBhgaRORggDo..',
  '..oBhgRYORagDo..',
  '..oBgROYYORgDo..',
  '..oBgReYYeRgDo..',
  '..oBgROWWORgDo..',
  '..oBgaRRRRagDo..',
  '..oDDDDDDDDDDo..',
  '...oGBBBBBBDo...',
  '....oooooooo....',
  '................',
];
const PALETTE = {
  o: '#1a1220', // OUTLINE
  G: '#f8dc84', // BRASS_LIGHT
  B: '#e0a63a', // BRASS
  D: '#9a5c1c', // BRASS_DARK
  g: '#2c2238', // GLASS
  a: '#5e3532', // GLASS_GLOW
  h: '#77689a', // GLASS_SHINE
  R: '#e0482c', // FLAME_RED
  O: '#f58f2c', // FLAME_ORANGE
  Y: '#ffd447', // FLAME_YELLOW
  W: '#fff5c9', // FLAME_CORE
  e: '#1a1220', // EYE
};

const BACKGROUND = '#12141f'; // --bg
const GLOW = '#f5a03c'; // the warm glow the app draws behind the companion
const OUT_DIR = new URL('../apps/web/public/', import.meta.url);

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));

// ------------------------------------------------------------------ PNG encoder

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c >>> 0;
}

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  typeAndData.copy(out, 4);
  out.writeUInt32BE(crc32(typeAndData), 8 + data.length);
  return out;
}

/** RGB, 8 bits per channel, no interlace; every scanline uses filter type 0 (None). */
function encodePng(size, pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour (opaque: iOS fills transparency with black anyway)
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter method
  ihdr[12] = 0; // interlace
  const stride = size * 3 + 1;
  const raw = Buffer.alloc(stride * size);
  for (let y = 0; y < size; y++) {
    raw[y * stride] = 0; // filter: None
    pixels.copy(raw, y * stride + 1, y * size * 3, (y + 1) * size * 3);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// --------------------------------------------------------------------- render

/** Bounding box of the painted pixels, so the lantern itself is centred (not its 16×16 frame). */
function spriteBounds() {
  let x0 = 16, y0 = 16, x1 = -1, y1 = -1;
  ROWS.forEach((row, y) => [...row].forEach((k, x) => {
    if (k === '.') return;
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  }));
  return { x0, y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/**
 * Integer nearest-neighbour upscale of the sprite, centred on a BACKGROUND square with `padding`
 * (fraction of the size on each side), over a stepped pixel glow centred on the flame.
 */
function renderIcon(size, padding) {
  const box = spriteBounds();
  const scale = Math.max(1, Math.floor((size * (1 - 2 * padding)) / Math.max(box.w, box.h)));
  const left = Math.round((size - box.w * scale) / 2) - box.x0 * scale;
  const top = Math.round((size - box.h * scale) / 2) - box.y0 * scale;
  const bg = hex(BACKGROUND);
  const glow = hex(GLOW);
  const palette = Object.fromEntries(Object.entries(PALETTE).map(([k, v]) => [k, hex(v)]));
  const flame = { x: 8, y: 8.5 }; // sprite coordinates
  const radius = 9;

  const pixels = Buffer.alloc(size * size * 3);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      // Sprite cell under this pixel (cells continue past the sprite, so the glow stays pixelated).
      const cx = Math.floor((px - left) / scale);
      const cy = Math.floor((py - top) / scale);
      const key = ROWS[cy]?.[cx];
      let rgb;
      if (key && key !== '.') {
        rgb = palette[key];
      } else {
        const d = Math.hypot(cx + 0.5 - flame.x, cy + 0.5 - flame.y);
        const steps = Math.max(0, Math.ceil(4 * (1 - d / radius))); // 4 rings
        rgb = mix(bg, glow, steps * 0.07);
      }
      pixels.set(rgb, (py * size + px) * 3);
    }
  }
  return encodePng(size, pixels);
}

const OUTPUTS = [
  { file: 'favicon.png', size: 32, padding: 0 }, // tiny: the sprite's own margin is enough
  { file: 'apple-touch-icon.png', size: 180, padding: 0.12 },
  { file: 'icon-192.png', size: 192, padding: 0.12 },
  { file: 'icon-512.png', size: 512, padding: 0.12 },
  { file: 'icon-512-maskable.png', size: 512, padding: 0.22 }, // stays inside the maskable safe zone
];

mkdirSync(OUT_DIR, { recursive: true });
for (const { file, size, padding } of OUTPUTS) {
  const png = renderIcon(size, padding);
  writeFileSync(new URL(file, OUT_DIR), png);
  console.log(`${file}  ${size}×${size}  ${png.length} bytes`);
}
