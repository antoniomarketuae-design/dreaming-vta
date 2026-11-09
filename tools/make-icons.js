// Draws the app icon (crescent moon on a night sky) and writes the PNG sizes iPhone and Android need.
// No dependencies: the PNG is encoded by hand with Node's zlib.  Run: node tools/make-icons.js
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT = path.join(__dirname, '..', 'app', 'icons');
const SIZES = { 'icon-180.png': 180, 'icon-192.png': 192, 'icon-512.png': 512 };

const mix = (a, b, t) => a + (b - a) * t;
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

const SKY_TOP = hex('#1d1450');
const SKY_BOTTOM = hex('#55308f');
const GLOW = hex('#8f6bd8');
const MOON = hex('#ffe3a3');
const STAR = [255, 255, 255];

const MOON_C = [0.47, 0.47];
const MOON_R = 0.25;
const CUT_C = [0.575, 0.395];
const CUT_R = 0.215;
const STARS = [
  [0.79, 0.24, 0.016], [0.70, 0.73, 0.012], [0.25, 0.80, 0.010],
  [0.83, 0.56, 0.008], [0.20, 0.22, 0.009], [0.60, 0.14, 0.007], [0.88, 0.86, 0.007],
];

// Colour of the icon at (u, v), both 0..1 from the top-left corner.
function sample(u, v) {
  let c = SKY_TOP.map((x, i) => mix(x, SKY_BOTTOM[i], v));

  const dm = Math.hypot(u - MOON_C[0], v - MOON_C[1]);
  const glow = Math.max(0, 1 - dm / 0.55) ** 2 * 0.55;
  c = c.map((x, i) => mix(x, GLOW[i], glow));

  for (const [sx, sy, r] of STARS) {
    if (Math.hypot(u - sx, v - sy) < r) return STAR;
  }

  const inMoon = dm < MOON_R;
  const inCut = Math.hypot(u - CUT_C[0], v - CUT_C[1]) < CUT_R;
  if (inMoon && !inCut) return MOON;
  return c;
}

function render(size) {
  const SS = 4; // 4x4 samples per pixel for smooth edges
  const px = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const [cr, cg, cb] = sample((x + (sx + 0.5) / SS) / size, (y + (sy + 0.5) / SS) / size);
          r += cr; g += cg; b += cb;
        }
      }
      const o = (y * size + x) * 4;
      px[o] = Math.round(r / (SS * SS));
      px[o + 1] = Math.round(g / (SS * SS));
      px[o + 2] = Math.round(b / (SS * SS));
      px[o + 3] = 255; // fully opaque: iOS turns transparency black
    }
  }
  return px;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePNG(size, rgba) {
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

fs.mkdirSync(OUT, { recursive: true });
for (const [name, size] of Object.entries(SIZES)) {
  fs.writeFileSync(path.join(OUT, name), encodePNG(size, render(size)));
  console.log(`wrote icons/${name} (${size}x${size})`);
}
