// Generative "dream painting" for each dream: a starry violet night sky tinted by the dream's tags,
// with a soft motif for its main symbol. Stands in for an AI image until there is one.
// Deterministic: the same dream always paints the same picture. Never touches document/window at import.

import { TAGS } from './analyze.js';

const CACHE_LIMIT = 300;
const cache = new Map();
let cnv = null;
let cctx = null;

/** Data-URL (JPEG) of the dream's painting, square, cssPx wide (rendered at up to 2x for Retina). */
export function dreamArtURL(dream, cssPx = 300) {
  if (!dream || typeof document === 'undefined') return '';
  const dpr = typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2) : 1;
  const size = Math.max(16, Math.round(cssPx * dpr));
  const tags = Array.isArray(dream.tags) ? dream.tags : [];
  const seed = Number.isFinite(dream.seed) ? dream.seed | 0 : hashStr(String(dream.id ?? 'dream'));
  const lucid = !!dream.lucid;
  const key = `${dream.id}:${seed}:${tags.join(',')}:${lucid}:${size}`;
  const hit = cache.get(key);
  if (hit) { cache.delete(key); cache.set(key, hit); return hit; }

  if (!cnv) {
    cnv = document.createElement('canvas');
    cctx = cnv.getContext('2d', { alpha: false });
  }
  cnv.width = size;
  cnv.height = size;
  paint(cctx, size, seed, tags, lucid);
  const url = cnv.toDataURL('image/jpeg', 0.86);
  cache.set(key, url);
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
  return url;
}

/** Same painter for an unsaved draft. */
export function dreamArtPreview(tags, seed, cssPx = 300, lucid = false) {
  return dreamArtURL({ id: 'draft', tags: tags || [], seed: Number.isFinite(seed) ? seed : 1, lucid }, cssPx);
}

// ---------- helpers ----------

function mulberry32(a) {
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h | 0;
}

const hsl = (h, s, l, a = 1) => `hsla(${(((h % 360) + 360) % 360).toFixed(1)},${s}%,${l}%,${a})`;
const mixHue = (a, b, t) => a + ((((b - a) % 360) + 540) % 360 - 180) * t;
const TAU = Math.PI * 2;

/** Soft radial light (gaussian-ish falloff), optionally squashed/rotated. */
function glow(ctx, x, y, r, h, s, l, a, sy = 1, rot = 0) {
  if (r <= 0 || a <= 0) return;
  ctx.save();
  ctx.translate(x, y);
  if (rot) ctx.rotate(rot);
  if (sy !== 1) ctx.scale(1, sy);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
  g.addColorStop(0, hsl(h, s, l, a));
  g.addColorStop(0.22, hsl(h, s, l, a * 0.72));
  g.addColorStop(0.5, hsl(h, s, l, a * 0.28));
  g.addColorStop(0.78, hsl(h, s, l, a * 0.07));
  g.addColorStop(1, hsl(h, s, l, 0));
  ctx.fillStyle = g;
  ctx.fillRect(-r, -r, r * 2, r * 2);
  ctx.restore();
}

/** Rolling hill silhouette; `anchor` [x, y] forces a crest there so a motif can stand on it. */
function hills(ctx, P, baseY, amp, light, anchor = null, rimA = 0.22) {
  const { R } = P;
  const pts = [];
  for (let i = 0; i <= 5; i++) {
    pts.push([-4 + (108 * i) / 5 + (i && i < 5 ? (R() - 0.5) * 8 : 0), baseY + (R() - 0.5) * amp]);
  }
  if (anchor) {
    let bi = 1;
    for (let i = 1; i < 5; i++) if (Math.abs(pts[i][0] - anchor[0]) < Math.abs(pts[bi][0] - anchor[0])) bi = i;
    pts[bi] = [anchor[0], anchor[1]];
    pts.sort((p, q) => p[0] - q[0]);
  }
  const trace = () => {
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1];
      const [x1, y1] = pts[i];
      const cx = (x0 + x1) / 2;
      ctx.bezierCurveTo(cx, y0, cx, y1, x1, y1);
    }
  };
  ctx.globalCompositeOperation = 'source-over';
  const g = ctx.createLinearGradient(0, baseY - amp, 0, 100);
  g.addColorStop(0, hsl(P.sky, 42, light));
  g.addColorStop(1, hsl(P.sky, 48, light * 0.35));
  ctx.beginPath();
  trace();
  ctx.lineTo(104, 104);
  ctx.lineTo(-4, 104);
  ctx.closePath();
  ctx.fillStyle = g;
  ctx.fill();
  if (rimA > 0) {
    ctx.globalCompositeOperation = 'lighter';
    ctx.beginPath();
    trace();
    ctx.strokeStyle = hsl(P.ember, 85, 72, rimA);
    ctx.lineWidth = 0.45;
    ctx.stroke();
  }
  ctx.globalCompositeOperation = 'source-over';
}

function backHills(ctx, P) {
  hills(ctx, P, P.hy + 3, 7, 11, null, 0.16);
  ctx.globalCompositeOperation = 'screen';
  glow(ctx, P.gx, P.hy + 6, 70, P.ember, 60, 45, 0.22, 0.14); // low mist between the ridges
  ctx.globalCompositeOperation = 'source-over';
}

function rim(ctx, P, hue = P.ember, blur = 4, a = 0.85) {
  ctx.shadowColor = hsl(hue, 90, 70, a);
  ctx.shadowBlur = blur * P.k;
}
function noRim(ctx) { ctx.shadowBlur = 0; ctx.shadowColor = 'transparent'; }

function sparkle(ctx, x, y, s, h, a) {
  ctx.strokeStyle = hsl(h, 100, 85, a);
  ctx.lineWidth = s * 0.12;
  ctx.beginPath();
  ctx.moveTo(x - s, y); ctx.lineTo(x + s, y);
  ctx.moveTo(x, y - s); ctx.lineTo(x, y + s);
  ctx.stroke();
  glow(ctx, x, y, s * 0.9, h, 100, 80, a * 0.7);
}

/** Stick-figure body drawn with thick round strokes: list of polylines in figure units (height 1, feet at 0). */
function strokeFigure(ctx, x, y, h, lines, head, width = 0.09) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(h, h);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = width;
  ctx.beginPath();
  for (const pl of lines) {
    ctx.moveTo(pl[0], pl[1]);
    for (let i = 2; i < pl.length; i += 2) ctx.lineTo(pl[i], pl[i + 1]);
  }
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(head[0], head[1], head[2], 0, TAU);
  ctx.fill();
  ctx.restore();
}

const RUNNER = {
  lines: [
    [0, -0.5, 0.12, -0.84], // torso
    [0.1, -0.8, 0.27, -0.66, 0.4, -0.78], // front arm
    [0.1, -0.8, -0.04, -0.64, -0.2, -0.7], // back arm
    [0, -0.5, 0.2, -0.3, 0.17, -0.02], // front leg
    [0, -0.5, -0.1, -0.27, -0.32, -0.2], // back leg
  ],
  head: [0.16, -0.95, 0.085],
};

// ---------- painter ----------

function paint(ctx, S, seed, tags, lucid) {
  const R = mulberry32(seed ^ 0x5bd1e995);
  const k = S / 100;
  ctx.setTransform(k, 0, 0, k, 0, 0);
  ctx.globalCompositeOperation = 'source-over';

  const known = tags.filter((t) => TAGS[t]);
  const r0 = R(), r1 = R(), r2 = R(), r3 = R();
  const h1 = known[0] ? TAGS[known[0]].hue : 250 + r0 * 45;
  const h2 = known[1] ? TAGS[known[1]].hue : known[0] ? mixHue(h1, 325, 0.55) : 312 + r1 * 30;
  const symbol = known.find((t) => TAGS[t].kind === 'symbol') || null;
  const P = {
    R, k, S, h1, h2,
    sky: mixHue(h1, 258, 0.6),
    ember: mixHue(h2, 348, 0.55),
    hy: 64 + r2 * 10,
    gx: 30 + r3 * 40,
  };
  P.sil = hsl(mixHue(h1, 252, 0.75), 45, 5);

  // Sky
  const g = ctx.createLinearGradient(0, 0, 0, 100);
  g.addColorStop(0, hsl(P.sky, 62, 5));
  g.addColorStop(0.42, hsl(mixHue(P.sky, h1, 0.3), 52, 13));
  g.addColorStop(P.hy / 100, hsl(mixHue(P.ember, 300, 0.45), 48, 26));
  g.addColorStop(1, hsl(P.sky, 50, 8));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 100, 100);

  // Nebula: a tilted band of soft coloured clouds, with darker dust lanes
  const ang = (R() - 0.5) * 1.1;
  const ncy = 22 + R() * 18;
  const hues = [h1, h2, P.sky, mixHue(h1, h2, 0.5), 285];
  ctx.globalCompositeOperation = 'screen';
  for (let i = 0; i < 10; i++) {
    const t = (i / 9 - 0.5) * 1.3;
    const x = 50 + Math.cos(ang) * t * 100 + (R() - 0.5) * 16;
    const y = ncy + Math.sin(ang) * t * 100 + (R() - 0.5) * 16;
    glow(ctx, x, y, 14 + R() * 22, hues[i % hues.length], 72, 52 + R() * 12, 0.16 + R() * 0.2, 0.45 + R() * 0.45, ang + (R() - 0.5) * 0.8);
  }
  ctx.globalCompositeOperation = 'source-over';
  for (let i = 0; i < 3; i++) {
    const t = (R() - 0.5) * 1.1;
    glow(ctx, 50 + Math.cos(ang) * t * 100, ncy + Math.sin(ang) * t * 100 + (R() - 0.5) * 6, 10 + R() * 10, P.sky, 50, 4, 0.32, 0.28, ang);
  }

  // Horizon glow (pink / ember)
  ctx.globalCompositeOperation = 'screen';
  glow(ctx, P.gx, P.hy, 80, P.ember, 82, 58, 0.55, 0.36);
  glow(ctx, P.gx, P.hy, 34, mixHue(P.ember, 30, 0.35), 92, 70, 0.45, 0.32);

  // Stars
  ctx.globalCompositeOperation = 'lighter';
  const minR = 0.42 / k;
  for (let i = 0; i < 130; i++) {
    const x = R() * 100;
    const y = Math.pow(R(), 1.35) * P.hy * 1.02;
    const m = Math.pow(R(), 5);
    const tint = R();
    const a = (0.3 + R() * 0.6) * (1 - (y / P.hy) * 0.45);
    const hue = tint < 0.2 ? 45 : tint < 0.45 ? 300 : 230;
    const sat = tint < 0.45 ? 90 : 60;
    const r = Math.max(0.1 + m * 0.5, minR);
    if (m > 0.3) {
      glow(ctx, x, y, r * 7, hue, sat, 80, a * 0.45);
      ctx.strokeStyle = hsl(hue, sat, 92, a * 0.5);
      ctx.lineWidth = Math.max(0.08, minR * 0.5);
      ctx.beginPath();
      ctx.moveTo(x - r * 6, y); ctx.lineTo(x + r * 6, y);
      ctx.moveTo(x, y - r * 6); ctx.lineTo(x, y + r * 6);
      ctx.stroke();
    }
    ctx.fillStyle = hsl(hue, sat, 92, a);
    if (r * k < 1.1) { ctx.fillRect(x - r, y - r, r * 2, r * 2); continue; }
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';

  // Motif
  const focus = (MOTIFS[symbol] || aurora)(ctx, P);
  ctx.globalCompositeOperation = 'source-over';
  noRim(ctx);

  if (lucid) halo(ctx, P, focus);

  // Vignette
  ctx.globalCompositeOperation = 'source-over';
  const v = ctx.createRadialGradient(50, 44, 28, 50, 46, 80);
  v.addColorStop(0, 'rgba(8,4,24,0)');
  v.addColorStop(1, 'rgba(8,4,24,0.62)');
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, 100, 100);
}

function halo(ctx, P, f) {
  const { R } = P;
  ctx.globalCompositeOperation = 'lighter';
  glow(ctx, f.x, f.y, f.r * 1.5, 44, 100, 70, 0.14);
  const g = ctx.createRadialGradient(f.x, f.y, f.r * 0.5, f.x, f.y, f.r * 1.3);
  g.addColorStop(0, 'hsla(45,100%,70%,0)');
  g.addColorStop(0.4, 'hsla(45,100%,72%,0.16)');
  g.addColorStop(0.6, 'hsla(44,100%,70%,0.06)');
  g.addColorStop(1, 'hsla(44,100%,70%,0)');
  ctx.fillStyle = g;
  ctx.fillRect(f.x - f.r * 1.4, f.y - f.r * 1.4, f.r * 2.8, f.r * 2.8);
  ctx.lineWidth = 0.25;
  ctx.strokeStyle = 'hsla(46,100%,82%,0.14)';
  ctx.beginPath();
  ctx.arc(f.x, f.y, f.r * 0.9, 0, TAU);
  ctx.stroke();
  for (let i = 0; i < 6; i++) {
    const a = R() * TAU;
    const d = f.r * (0.8 + R() * 0.45);
    sparkle(ctx, f.x + Math.cos(a) * d, f.y + Math.sin(a) * d, 0.8 + R() * 1.4, 46, 0.55 + R() * 0.35);
  }
  ctx.globalCompositeOperation = 'source-over';
}

// ---------- motifs: each paints its scene and returns the focal point {x, y, r} ----------

function aurora(ctx, P) {
  const { R } = P;
  ctx.globalCompositeOperation = 'lighter';
  const hues = [P.h1, P.h2, mixHue(P.h1, P.h2, 0.5)];
  for (let j = 0; j < 3; j++) {
    const y0 = 20 + j * 9 + R() * 6;
    const A = 4 + R() * 5;
    const f = 0.035 + R() * 0.04;
    const ph = R() * TAU;
    const hue = hues[j];
    for (let s = 0; s < 22; s++) {
      const a = 0.075 * Math.pow(1 - s / 22, 1.8) * (j === 0 ? 1 : 0.75);
      ctx.strokeStyle = hsl(hue, 85, s < 2 ? 75 : 64, s < 2 ? a * 1.6 : a);
      ctx.lineWidth = s < 2 ? 0.6 + s * 0.8 : 3.2;
      ctx.beginPath();
      for (let x = -6; x <= 106; x += 4) {
        const y = y0 + A * Math.sin(x * f + ph) + 1.6 * Math.sin(x * f * 3.1 + ph * 2) - s * 0.95;
        if (x === -6) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }
  backHills(ctx, P);
  hills(ctx, P, P.hy + 14, 10, 5);
  return { x: 50, y: 28, r: 22 };
}

function flying(ctx, P) {
  const { R } = P;
  backHills(ctx, P);
  hills(ctx, P, P.hy + 15, 9, 5);
  const bx = 40 + R() * 20, by = 28 + R() * 12, w = 18 + R() * 5, tilt = (R() - 0.5) * 0.35;
  const pale = mixHue(P.h1, 220, 0.3);
  ctx.globalCompositeOperation = 'lighter';
  // light trail
  const side = R() < 0.5 ? -1 : 1;
  for (const [lw, a] of [[7, 0.05], [3, 0.08], [0.9, 0.22]]) {
    ctx.strokeStyle = hsl(pale, 90, 78, a);
    ctx.lineWidth = lw;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(bx - side * 48, by + 30);
    ctx.quadraticCurveTo(bx - side * 18, by + 18, bx, by + 1);
    ctx.stroke();
  }
  glow(ctx, bx, by, w * 1.3, pale, 80, 70, 0.3);
  // bird
  ctx.save();
  ctx.translate(bx, by);
  ctx.rotate(tilt);
  ctx.scale(w / 24, w / 24);
  rim(ctx, P, pale, 7, 0.9);
  for (const sx of [-1, 1]) {
    ctx.save();
    ctx.scale(sx, 1);
    const wg = ctx.createLinearGradient(0, 0, 25, -8);
    wg.addColorStop(0, hsl(pale, 100, 94, 0.95));
    wg.addColorStop(0.6, hsl(pale, 90, 80, 0.55));
    wg.addColorStop(1, hsl(pale, 90, 75, 0.08));
    ctx.fillStyle = wg;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.bezierCurveTo(5, -9, 13, -12.5, 25, -8);
    ctx.bezierCurveTo(16, -6.5, 8, -2.5, 1, 3);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = hsl(pale, 90, 85, 0.22);
    ctx.lineWidth = 0.35;
    ctx.beginPath();
    for (let i = 1; i <= 4; i++) {
      ctx.moveTo(2 + i * 3, -2 - i * 1.2);
      ctx.quadraticCurveTo(9 + i * 3, -6 - i, 15 + i * 2.2, -6.5 - i * 0.3);
    }
    ctx.stroke();
    ctx.restore();
  }
  ctx.fillStyle = hsl(pale, 100, 95, 0.9);
  ctx.beginPath();
  ctx.ellipse(0, 1, 1.3, 3.2, 0, 0, TAU);
  ctx.fill();
  ctx.restore();
  noRim(ctx);
  // distant birds
  ctx.strokeStyle = hsl(pale, 70, 85, 0.55);
  ctx.lineWidth = 0.35;
  ctx.beginPath();
  for (let i = 0; i < 4; i++) {
    const x = 12 + R() * 76, y = 10 + R() * 40, s = 1.2 + R() * 1.8;
    if (Math.abs(x - bx) < w && Math.abs(y - by) < 10) continue;
    ctx.moveTo(x - s, y);
    ctx.quadraticCurveTo(x - s / 2, y - s * 0.7, x, y);
    ctx.quadraticCurveTo(x + s / 2, y - s * 0.7, x + s, y);
  }
  ctx.stroke();
  return { x: bx, y: by - 3, r: w * 1.05 };
}

function water(ctx, P) {
  const { R } = P;
  hills(ctx, P, P.hy - 1.5, 4, 9, null, 0.2);
  const top = P.hy + 1;
  const g = ctx.createLinearGradient(0, top, 0, 100);
  g.addColorStop(0, hsl(mixHue(P.sky, P.h1, 0.4), 50, 20));
  g.addColorStop(0.35, hsl(P.sky, 52, 11));
  g.addColorStop(1, hsl(P.sky, 58, 5));
  ctx.fillStyle = g;
  ctx.fillRect(0, top, 100, 100 - top);
  ctx.globalCompositeOperation = 'screen';
  glow(ctx, P.gx, top, 70, P.ember, 80, 58, 0.45, 0.2);
  ctx.globalCompositeOperation = 'lighter';
  // shimmering reflection column
  for (let i = 0; i < 80; i++) {
    const t = R();
    const y = top + Math.pow(t, 1.4) * (100 - top);
    const spread = 4 + t * 26;
    const x = P.gx + (R() - 0.5) * spread * (R() + 0.4);
    const len = 0.8 + t * 6 * R();
    ctx.fillStyle = hsl(R() < 0.5 ? P.ember : 40, 95, 75, 0.12 + R() * 0.38 * (1 - t * 0.4));
    ctx.fillRect(x - len / 2, y, len, 0.22 + t * 0.55);
  }
  // waves
  const wh = mixHue(P.h1, 210, 0.3);
  for (let i = 0; i < 15; i++) {
    const t = (i + 1) / 16;
    const y0 = top + Math.pow(t, 1.7) * (100 - top);
    const amp = 0.25 + t * 1.5, f = 0.12 + R() * 0.1, ph = R() * TAU;
    ctx.strokeStyle = hsl(wh, 80, 76, 0.06 + t * 0.12);
    ctx.lineWidth = 0.25 + t * 0.55;
    ctx.beginPath();
    for (let x = -4; x <= 104; x += 3) {
      const y = y0 + Math.sin(x * f + ph) * amp;
      if (x === -4) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  return { x: P.gx, y: top - 8, r: 20 };
}

function falling(ctx, P) {
  const { R } = P;
  const cx = 45 + R() * 14, cy = 56 + R() * 8;
  const pale = mixHue(P.h1, 270, 0.3);
  // cliff edge
  const left = R() < 0.5;
  ctx.save();
  if (!left) { ctx.translate(100, 0); ctx.scale(-1, 1); }
  ctx.fillStyle = P.sil;
  ctx.beginPath();
  ctx.moveTo(-2, 38);
  ctx.lineTo(16, 39.5);
  ctx.lineTo(19, 41);
  ctx.lineTo(17, 52);
  ctx.lineTo(20, 63);
  ctx.lineTo(15, 78);
  ctx.lineTo(18, 102);
  ctx.lineTo(-2, 102);
  ctx.closePath();
  ctx.fill();
  ctx.globalCompositeOperation = 'lighter';
  ctx.strokeStyle = hsl(P.ember, 85, 72, 0.3);
  ctx.lineWidth = 0.45;
  ctx.beginPath();
  ctx.moveTo(-2, 38); ctx.lineTo(16, 39.5); ctx.lineTo(19, 41);
  ctx.stroke();
  ctx.restore();
  ctx.globalCompositeOperation = 'lighter';
  // vortex spiral
  const turns = 4.5, ph = R() * TAU, end = turns * TAU;
  glow(ctx, cx, cy, 30, P.h1, 70, 55, 0.25, 0.6);
  for (const [lw, a] of [[3.5, 0.05], [1.4, 0.1], [0.3, 0.32]]) {
    ctx.strokeStyle = hsl(pale, 85, 80, a);
    ctx.lineWidth = lw;
    ctx.beginPath();
    for (let th = 0; th <= end; th += 0.12) {
      const r = 40 * Math.pow(1 - th / end, 1.4) + 0.4;
      const x = cx + Math.cos(th + ph) * r, y = cy + Math.sin(th + ph) * r * 0.55;
      if (th === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  glow(ctx, cx, cy, 12, pale, 90, 85, 0.6);
  // descending streaks
  ctx.lineCap = 'round';
  for (let i = 0; i < 14; i++) {
    const x = 8 + R() * 84, y = R() * 60, len = 8 + R() * 18;
    const dx = (cx - x) * 0.08;
    const sg = ctx.createLinearGradient(x, y, x + dx, y + len);
    sg.addColorStop(0, hsl(pale, 90, 85, 0));
    sg.addColorStop(1, hsl(pale, 90, 88, 0.35 + R() * 0.4));
    ctx.strokeStyle = sg;
    ctx.lineWidth = 0.25 + R() * 0.4;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + dx, y + len);
    ctx.stroke();
  }
  // tumbling figure against the bright core
  ctx.globalCompositeOperation = 'source-over';
  ctx.save();
  ctx.translate(cx, cy - 2);
  ctx.rotate(0.6 + R() * 1.2);
  ctx.strokeStyle = P.sil;
  ctx.fillStyle = P.sil;
  rim(ctx, P, pale, 3, 0.9);
  strokeFigure(ctx, 0, 4, 8, [
    [0, -0.5, 0, -0.84], [0, -0.8, -0.28, -1.05], [0, -0.8, 0.3, -1.02],
    [0, -0.5, -0.22, -0.05], [0, -0.5, 0.25, -0.12],
  ], [0, -0.97, 0.1], 0.11);
  ctx.restore();
  noRim(ctx);
  return { x: cx, y: cy - 2, r: 15 };
}

function chased(ctx, P) {
  const { R } = P;
  backHills(ctx, P);
  const fx = 56 + R() * 12, gy = P.hy + 12;
  hills(ctx, P, P.hy + 14, 8, 5, [fx, gy]);
  // looming shadow behind
  ctx.globalCompositeOperation = 'source-over';
  glow(ctx, 8, gy - 10, 34, P.sky, 50, 3, 0.85, 0.9);
  ctx.globalCompositeOperation = 'lighter';
  for (const ex of [10, 14.5]) glow(ctx, ex, gy - 15, 1.6, P.ember, 100, 60, 0.6);
  // afterimages
  const h = 13;
  for (let j = 3; j >= 1; j--) {
    ctx.strokeStyle = hsl(P.ember, 80, 60, 0.32 - j * 0.08);
    ctx.fillStyle = ctx.strokeStyle;
    strokeFigure(ctx, fx - j * 5.5, gy + 0.5, h, RUNNER.lines, RUNNER.head);
  }
  ctx.globalCompositeOperation = 'source-over';
  ctx.strokeStyle = P.sil;
  ctx.fillStyle = P.sil;
  rim(ctx, P, P.ember, 4, 0.9);
  strokeFigure(ctx, fx, gy + 0.5, h, RUNNER.lines, RUNNER.head);
  noRim(ctx);
  return { x: fx + 1, y: gy - 7, r: 12 };
}

function night(ctx, P) {
  const { R } = P;
  const mx = 30 + R() * 40, my = 22 + R() * 12, mr = 11 + R() * 3;
  const mh = mixHue(44, P.h1, 0.15);
  ctx.globalCompositeOperation = 'screen';
  glow(ctx, mx, my, mr * 5, mixHue(mh, P.h1, 0.4), 60, 70, 0.32);
  glow(ctx, mx, my, mr * 2.2, mh, 80, 82, 0.5);
  ctx.globalCompositeOperation = 'lighter';
  ctx.strokeStyle = hsl(mh, 80, 85, 0.1);
  ctx.lineWidth = 0.6;
  ctx.beginPath();
  ctx.arc(mx, my, mr * 1.9, 0, TAU);
  ctx.stroke();
  ctx.globalCompositeOperation = 'source-over';
  const g = ctx.createRadialGradient(mx - mr * 0.35, my - mr * 0.35, 0, mx, my, mr);
  g.addColorStop(0, hsl(mh, 100, 96));
  g.addColorStop(0.7, hsl(mh, 85, 84));
  g.addColorStop(1, hsl(mh - 8, 70, 72));
  ctx.fillStyle = g;
  rim(ctx, P, mh, 22, 0.9);
  ctx.beginPath();
  ctx.arc(mx, my, mr, 0, TAU);
  ctx.fill();
  noRim(ctx);
  ctx.save();
  ctx.beginPath();
  ctx.arc(mx, my, mr, 0, TAU);
  ctx.clip();
  for (let i = 0; i < 8; i++) {
    const a = R() * TAU, d = R() * mr * 0.8, cr = mr * (0.08 + R() * 0.22);
    ctx.fillStyle = hsl(mh - 15, 40, 55, 0.13 + R() * 0.1);
    ctx.beginPath();
    ctx.arc(mx + Math.cos(a) * d, my + Math.sin(a) * d, cr, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
  backHills(ctx, P);
  hills(ctx, P, P.hy + 14, 10, 5);
  return { x: mx, y: my, r: mr * 1.6 };
}

function fire(ctx, P) {
  const { R } = P;
  backHills(ctx, P);
  const fx = 38 + R() * 24, gy = P.hy + 12;
  hills(ctx, P, P.hy + 14, 8, 6, [fx, gy]);
  ctx.globalCompositeOperation = 'screen';
  glow(ctx, fx, gy - 6, 42, 22, 95, 55, 0.55, 0.8);
  glow(ctx, fx, gy - 4, 18, 36, 100, 65, 0.6);
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 10; i++) {
    const w = 6.5 * (1 - i / 12) * (0.6 + R() * 0.5), h = 22 * (1 - i / 11) * (0.7 + R() * 0.5);
    const x = fx + (R() - 0.5) * 6, sway = (R() - 0.5) * 9;
    const fg = ctx.createLinearGradient(0, gy, 0, gy - h);
    fg.addColorStop(0, hsl(44, 100, 70, 0.32));
    fg.addColorStop(0.3, hsl(30, 100, 58, 0.26));
    fg.addColorStop(0.7, hsl(12, 100, 50, 0.1));
    fg.addColorStop(1, hsl(0, 100, 45, 0));
    ctx.fillStyle = fg;
    ctx.beginPath();
    ctx.moveTo(x - w, gy + 0.5);
    ctx.bezierCurveTo(x - w * 1.1, gy - h * 0.45, x + sway * 0.3, gy - h * 0.6, x + sway, gy - h);
    ctx.bezierCurveTo(x + sway * 0.4, gy - h * 0.55, x + w * 1.1, gy - h * 0.4, x + w, gy + 0.5);
    ctx.closePath();
    ctx.fill();
  }
  glow(ctx, fx, gy - 3, 5, 48, 100, 88, 0.55, 0.8);
  for (let i = 0; i < 55; i++) {
    const t = R();
    const y = gy - 5 - t * 58;
    const x = fx + (R() - 0.5) * (5 + t * 50) + Math.sin(t * 9 + R() * 2) * 3;
    const r = 0.18 + R() * 0.45 * (1 - t * 0.6);
    const hue = 18 + R() * 30, a = 0.95 * (1 - t * 0.65);
    if (R() < 0.35) glow(ctx, x, y, r * 6, hue, 100, 60, a * 0.35);
    ctx.fillStyle = hsl(hue, 100, 62 + R() * 22, a);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
  }
  return { x: fx, y: gy - 10, r: 16 };
}

function nature(ctx, P) {
  const { R } = P;
  backHills(ctx, P);
  const right = R() < 0.5;
  const tx = right ? 62 + R() * 12 : 26 + R() * 12, gy = P.hy + 9;
  hills(ctx, P, P.hy + 14, 9, 5, [tx, gy]);
  // branching tree, batched by depth
  const DEPTH = 8;
  const segs = Array.from({ length: DEPTH + 1 }, () => []);
  const tips = [];
  const branch = (x, y, len, a, d) => {
    const x2 = x + Math.cos(a) * len, y2 = y + Math.sin(a) * len;
    segs[d].push(x, y, x2, y2);
    if (d === 0) { tips.push(x2, y2); return; }
    const spread = 0.32 + R() * 0.28;
    branch(x2, y2, len * (0.7 + R() * 0.12), a - spread * (0.6 + R() * 0.6), d - 1);
    branch(x2, y2, len * (0.7 + R() * 0.12), a + spread * (0.6 + R() * 0.6), d - 1);
  };
  branch(tx, gy + 1, 11, -Math.PI / 2 + (R() - 0.5) * 0.2, DEPTH);
  ctx.strokeStyle = P.sil;
  ctx.lineCap = 'round';
  rim(ctx, P, P.ember, 2.5, 0.55);
  for (let d = DEPTH; d >= 0; d--) {
    const s = segs[d];
    ctx.lineWidth = 0.18 + Math.pow(d / DEPTH, 1.8) * 2.2;
    ctx.beginPath();
    for (let i = 0; i < s.length; i += 4) { ctx.moveTo(s[i], s[i + 1]); ctx.lineTo(s[i + 2], s[i + 3]); }
    ctx.stroke();
  }
  noRim(ctx);
  // blossoms
  ctx.globalCompositeOperation = 'lighter';
  const bh = mixHue(P.h2, 330, 0.4);
  for (let i = 0; i < tips.length; i += 2) {
    if (R() > 0.22) continue;
    glow(ctx, tips[i], tips[i + 1], 1.8, bh, 90, 70, 0.35);
    ctx.fillStyle = hsl(bh, 100, 85, 0.8);
    ctx.fillRect(tips[i] - 0.2, tips[i + 1] - 0.2, 0.4, 0.4);
  }
  // flowers in the foreground, opposite the tree
  ctx.globalCompositeOperation = 'source-over';
  for (let i = 0; i < 5; i++) {
    const x = right ? 8 + R() * 32 : 60 + R() * 32, hgt = 7 + R() * 9, bend = (R() - 0.5) * 4;
    const hx = x + bend, hyy = 100 - hgt;
    ctx.strokeStyle = P.sil;
    ctx.lineWidth = 0.35;
    ctx.beginPath();
    ctx.moveTo(x, 101);
    ctx.quadraticCurveTo(x, 100 - hgt * 0.5, hx, hyy);
    ctx.stroke();
    ctx.fillStyle = P.sil;
    const pr = 1 + R() * 0.6;
    for (let p = 0; p < 5; p++) {
      const a = (p / 5) * TAU + i;
      ctx.beginPath();
      ctx.ellipse(hx + Math.cos(a) * pr, hyy + Math.sin(a) * pr, pr * 0.85, pr * 0.5, a, 0, TAU);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'lighter';
    glow(ctx, hx, hyy, 2.4, bh, 90, 70, 0.5);
    ctx.globalCompositeOperation = 'source-over';
  }
  // fireflies
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 12; i++) {
    const x = R() * 100, y = P.hy - 10 + R() * 30;
    glow(ctx, x, y, 1.5, 70, 100, 70, 0.45);
  }
  return { x: tx, y: gy - 20, r: 19 };
}

function travel(ctx, P) {
  const { R } = P;
  const vx = Math.min(64, Math.max(36, P.gx)), vy = P.hy;
  // distant skyline
  ctx.fillStyle = hsl(P.sky, 40, 9);
  const lights = [];
  ctx.beginPath();
  for (let x = 4; x < 96; ) {
    const w = 1.2 + R() * 3, h = R() < 0.3 ? 0.5 + R() * 1.2 : 1 + R() * 5 * (1 - Math.abs(x - vx) / 70);
    ctx.rect(x, vy - h, w, h + 0.2);
    if (h > 1.5 && R() < 0.7) lights.push(x + R() * w, vy - R() * h);
    x += w + R() * 1.5;
  }
  ctx.fill();
  // ground
  const gg = ctx.createLinearGradient(0, vy, 0, 100);
  gg.addColorStop(0, hsl(P.sky, 40, 11));
  gg.addColorStop(1, hsl(P.sky, 48, 4));
  ctx.fillStyle = gg;
  ctx.fillRect(0, vy, 100, 100 - vy);
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < lights.length; i += 2) {
    ctx.fillStyle = hsl(40, 100, 75, 0.7);
    ctx.fillRect(lights[i], lights[i + 1], 0.3, 0.3);
  }
  ctx.strokeStyle = hsl(P.ember, 85, 72, 0.3);
  ctx.lineWidth = 0.35;
  ctx.beginPath(); ctx.moveTo(0, vy); ctx.lineTo(100, vy); ctx.stroke();
  ctx.globalCompositeOperation = 'source-over';
  const depth = (t) => vy + t * t * (100 - vy);
  if (R() < 0.55) {
    // road
    const rg = ctx.createLinearGradient(0, vy, 0, 100);
    rg.addColorStop(0, hsl(P.ember, 35, 24));
    rg.addColorStop(0.3, hsl(P.sky, 40, 10));
    rg.addColorStop(1, hsl(P.sky, 45, 5));
    ctx.fillStyle = rg;
    ctx.beginPath();
    ctx.moveTo(vx - 0.5, vy); ctx.lineTo(vx + 0.5, vy); ctx.lineTo(vx + 48, 102); ctx.lineTo(vx - 48, 102);
    ctx.closePath();
    ctx.fill();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = hsl(P.ember, 80, 72, 0.35);
    ctx.lineWidth = 0.4;
    ctx.beginPath();
    ctx.moveTo(vx - 0.5, vy); ctx.lineTo(vx - 48, 102);
    ctx.moveTo(vx + 0.5, vy); ctx.lineTo(vx + 48, 102);
    ctx.stroke();
    ctx.strokeStyle = hsl(42, 100, 75, 0.7);
    for (let i = 1; i < 12; i++) {
      const t0 = i / 12, t1 = (i + 0.45) / 12;
      ctx.lineWidth = 0.1 + t0 * t0 * 1.2;
      ctx.beginPath();
      ctx.moveTo(vx, depth(t0)); ctx.lineTo(vx, depth(t1));
      ctx.stroke();
    }
  } else {
    // rails
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = hsl(P.sky, 35, 14);
    for (let i = 1; i < 22; i++) {
      const t = i / 22, y = depth(t), half = 0.3 + t * t * 16;
      ctx.lineWidth = 0.1 + t * t * 1.4;
      ctx.beginPath(); ctx.moveTo(vx - half * 1.25, y); ctx.lineTo(vx + half * 1.25, y); ctx.stroke();
    }
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = hsl(P.ember, 70, 78, 0.55);
    ctx.lineWidth = 0.35;
    ctx.beginPath();
    for (const s of [-1, 1]) { ctx.moveTo(vx + s * 0.3, vy); ctx.lineTo(vx + s * 16.3, 100); }
    ctx.stroke();
  }
  // lamp posts receding to the horizon
  for (const s of [-1, 1]) {
    for (let i = 0; i < 7; i++) {
      const t = (i + 1) / 7, y = depth(t), x = vx + s * (1.5 + t * t * 56), h = 0.8 + t * t * 26;
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = P.sil;
      ctx.lineWidth = 0.12 + t * 0.6;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - h); ctx.stroke();
      ctx.globalCompositeOperation = 'lighter';
      glow(ctx, x, y - h, 0.8 + t * 6, 38, 100, 68, 0.55);
      ctx.fillStyle = hsl(42, 100, 85, 0.9);
      ctx.beginPath(); ctx.arc(x, y - h, 0.15 + t * 0.6, 0, TAU); ctx.fill();
    }
  }
  return { x: vx, y: vy - 5, r: 13 };
}

function home(ctx, P) {
  const { R } = P;
  backHills(ctx, P);
  const hx = 34 + R() * 32, gy = P.hy + 11;
  hills(ctx, P, P.hy + 14, 9, 5, [hx, gy]);
  const w = 15, h = 9, roof = 7;
  // chimney smoke
  ctx.globalCompositeOperation = 'screen';
  const chx = hx + w * 0.24;
  for (let i = 0; i < 7; i++) glow(ctx, chx + i * 1.6 + R() * 2, gy - h - roof - 2 - i * 3.5, 2.5 + i * 1.2, P.sky, 30, 70, 0.1 - i * 0.01);
  // house
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = P.sil;
  rim(ctx, P, P.ember, 4, 0.7);
  ctx.beginPath();
  ctx.rect(hx - w / 2, gy - h, w, h + 1.5);
  ctx.rect(chx - 1, gy - h - roof * 0.95, 2.2, roof * 0.6);
  ctx.moveTo(hx - w / 2 - 1.8, gy - h + 0.2);
  ctx.lineTo(hx, gy - h - roof);
  ctx.lineTo(hx + w / 2 + 1.8, gy - h + 0.2);
  ctx.closePath();
  ctx.fill();
  noRim(ctx);
  // lit window(s)
  const wx = hx - w * 0.22, wy = gy - h * 0.6;
  ctx.globalCompositeOperation = 'screen';
  glow(ctx, wx, wy, 16, 36, 100, 62, 0.45);
  glow(ctx, wx, gy + 3, 13, 36, 100, 58, 0.22, 0.28);
  ctx.globalCompositeOperation = 'source-over';
  const win = (x, y, a) => {
    ctx.fillStyle = hsl(42, 100, 72, a);
    ctx.fillRect(x - 1.6, y - 1.7, 3.2, 3.4);
    ctx.strokeStyle = P.sil;
    ctx.lineWidth = 0.3;
    ctx.beginPath(); ctx.moveTo(x, y - 1.7); ctx.lineTo(x, y + 1.7); ctx.moveTo(x - 1.6, y); ctx.lineTo(x + 1.6, y); ctx.stroke();
  };
  win(wx, wy, 1);
  if (R() < 0.5) win(hx + w * 0.24, wy, 0.35);
  ctx.globalCompositeOperation = 'lighter';
  glow(ctx, wx, wy, 4, 45, 100, 80, 0.6);
  return { x: hx, y: gy - h, r: 15 };
}

function animals(ctx, P) {
  const { R } = P;
  backHills(ctx, P);
  const ax = 38 + R() * 24, gy = P.hy + 11;
  hills(ctx, P, P.hy + 14, 8, 5, [ax, gy]);
  const eh = mixHue(P.h1, 75, 0.6);
  // cat, sitting, facing us
  ctx.save();
  ctx.translate(ax, gy + 0.6);
  ctx.scale(1.15, 1.15);
  ctx.fillStyle = P.sil;
  ctx.strokeStyle = P.sil;
  rim(ctx, P, P.ember, 4, 0.75);
  ctx.beginPath();
  ctx.moveTo(-5, 0);
  ctx.bezierCurveTo(-6.5, -6, -3.6, -9.5, -2.6, -11);
  ctx.lineTo(2.6, -11);
  ctx.bezierCurveTo(3.6, -9.5, 6.5, -6, 5, 0);
  ctx.closePath();
  ctx.moveTo(3.6, -13.5);
  ctx.arc(0, -13.5, 3.6, 0, TAU);
  ctx.moveTo(-3.5, -14.6); ctx.lineTo(-3.1, -19.2); ctx.lineTo(-0.8, -16.6); ctx.closePath();
  ctx.moveTo(3.5, -14.6); ctx.lineTo(3.1, -19.2); ctx.lineTo(0.8, -16.6); ctx.closePath();
  ctx.fill();
  ctx.lineWidth = 1.3;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(4.2, -0.6);
  ctx.quadraticCurveTo(10, -0.5, 9.2, -6.5);
  ctx.stroke();
  noRim(ctx);
  ctx.globalCompositeOperation = 'lighter';
  for (const s of [-1, 1]) {
    glow(ctx, s * 1.45, -13.9, 2.4, eh, 100, 60, 0.6);
    ctx.fillStyle = hsl(eh, 100, 72, 0.95);
    ctx.beginPath();
    ctx.ellipse(s * 1.45, -13.9, 0.75, 0.45, 0, 0, TAU);
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = P.sil;
  for (const s of [-1, 1]) ctx.fillRect(s * 1.45 - 0.09, -14.3, 0.18, 0.8);
  ctx.restore();
  // distant eyes in the dark
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 2; i++) {
    const x = (i ? 70 : 8) + R() * 20, y = 88 + R() * 8;
    for (const dx of [0, 1.6]) glow(ctx, x + dx, y, 0.9, eh, 100, 65, 0.6);
  }
  return { x: ax, y: gy - 12, r: 14 };
}

function family(ctx, P) {
  const { R } = P;
  backHills(ctx, P);
  const fx = 40 + R() * 20, gy = P.hy + 11;
  hills(ctx, P, P.hy + 14, 8, 5, [fx, gy]);
  ctx.globalCompositeOperation = 'screen';
  glow(ctx, fx, gy - 8, 30, mixHue(P.h2, 30, 0.5), 85, 60, 0.4);
  ctx.globalCompositeOperation = 'source-over';
  const hs = R() < 0.5 ? [15, 13.5] : [15, 8.5, 13.5];
  const n = hs.length, gap = 6.2;
  const xs = hs.map((_, i) => fx + (i - (n - 1) / 2) * gap);
  ctx.fillStyle = P.sil;
  ctx.strokeStyle = P.sil;
  ctx.lineCap = 'round';
  rim(ctx, P, mixHue(P.ember, 30, 0.5), 4, 0.8);
  for (let i = 0; i < n; i++) {
    const x = xs[i], h = hs[i], y = gy + 0.6;
    const ys = y - h * 0.76, yh = y - h * 0.4;
    ctx.beginPath();
    ctx.arc(x, y - h + h * 0.11, h * 0.11, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x - h * 0.15, ys);
    ctx.quadraticCurveTo(x, ys - h * 0.05, x + h * 0.15, ys);
    ctx.lineTo(x + h * 0.11, yh);
    ctx.lineTo(x - h * 0.11, yh);
    ctx.closePath();
    ctx.fill();
    ctx.lineWidth = h * 0.08;
    ctx.beginPath();
    ctx.moveTo(x - h * 0.05, yh); ctx.lineTo(x - h * 0.07, y);
    ctx.moveTo(x + h * 0.05, yh); ctx.lineTo(x + h * 0.07, y);
    ctx.stroke();
    // arms: hold hands with neighbours, otherwise hang down
    ctx.lineWidth = h * 0.06;
    ctx.beginPath();
    for (const s of [-1, 1]) {
      const j = i + s;
      ctx.moveTo(x + s * h * 0.13, ys + h * 0.03);
      if (j >= 0 && j < n) {
        const hy = gy - Math.min(h, hs[j]) * 0.42;
        ctx.lineTo((x + xs[j]) / 2, hy);
      } else {
        ctx.lineTo(x + s * h * 0.2, y - h * 0.44);
      }
    }
    ctx.stroke();
  }
  noRim(ctx);
  return { x: fx, y: gy - 8, r: 14 };
}

const MOTIFS = { flying, water, falling, chased, night, fire, nature, travel, home, animals, family };
