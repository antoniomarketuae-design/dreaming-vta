// Journal view (new layout): the Milky Way. Your dreams lie along a band of starlight that meanders down the page from
// the newest dream back into the past, like the galaxy across a clear night: a wide violet haze, soft milky star
// clouds, a bright core split by a dark dust lane, and star dust that is thick inside the band and sparse outside it.
// Each dream is a bright star on the band, its glow coloured by how it felt: its mood tag, else an emotion it was given,
// else a soft lilac. Nightmares lean coral. Newer and longer dreams shine bigger and brighter; the newest few, the long
// ones and lucid dreams (in gold) carry a small four-point sparkle. The band takes a faint tint of the moods it passes.
// Month names mark where a month begins, like labels on a star chart. Tap a star or its title to open the dream; tap a
// mood in the legend to pick out its stars. Deterministic: the same dreams always draw the same sky (dust and clouds are
// seeded from the dream ids). One SVG for the band and stars, HTML titles on top (so they can ellipsize); everything is
// laid out once per render (and again only if the width changes). Nothing runs per frame except a CSS twinkle on a few
// stars (off when the phone asks for less motion).
import { dreamDay, dreamType } from '../../../symbols.js';
import { TAGS } from '../../../analyze.js';
import { esc, relativeDay } from '../../../ui.js';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const TOP = 64;    // y of the first star (room for the first month name above it)
const STEP = 62;   // between two stars
const GAP = 46;    // extra room where a new month begins
const CROSS = 24;  // extra room where the band crosses to the other side, so it swings clear of the titles
const BEND = 0.35; // how much the band leans sideways at a star (1 = plain Catmull-Rom): low keeps it off the titles
const ITEM_H = 46; // tap area of a title row
const SLAB = 1600; // star dust is cut into slabs this tall, so a redraw only touches the dust on screen

// Emotion words (the Record screen's list and a few more) and the mood whose colour they share.
const EMOTION_MOOD = {
  happy: 'happy', excited: 'happy', loved: 'happy', joy: 'happy', joyful: 'happy', free: 'happy', grateful: 'happy', playful: 'happy',
  calm: 'calm', relieved: 'calm', peaceful: 'calm', safe: 'calm', relaxed: 'calm', content: 'calm',
  curious: 'surreal', amazed: 'surreal', confused: 'surreal', awe: 'surreal', strange: 'surreal', surreal: 'surreal',
  anxious: 'anxious', ashamed: 'anxious', worried: 'anxious', nervous: 'anxious', stressed: 'anxious', embarrassed: 'anxious',
  scared: 'scared', afraid: 'scared', terrified: 'scared', angry: 'scared', frightened: 'scared', panicked: 'scared',
  sad: 'sad', lonely: 'sad', nostalgic: 'sad', grief: 'sad', lost: 'sad', heartbroken: 'sad',
};
const EMBER = [255, 159, 143];
const LILAC = [178, 168, 216];
const WHITE = [255, 255, 255];
const HAZE = [96, 78, 196];    // the wide violet-indigo haze around the band
const MILK = [236, 228, 255];  // the band's pale lilac starlight
const CREAM = [255, 240, 214]; // its warm bright core

// The Milky Way as a 24×24 icon: a tilted galaxy (a bright middle and two arms) between two small stars.
const ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
  + '<ellipse cx="12" cy="12" rx="2.6" ry="1.5" transform="rotate(-30 12 12)"/>'
  + '<path d="M3.5 15.1A9.5 4.6 -30 0 1 19.35 6.4"/><path d="M20.5 8.9A9.5 4.6 -30 0 1 4.65 17.6"/>'
  + '<path d="M5 3v3M3.5 4.5h3"/><path d="M19.5 19.5h.01"/></svg>';

const f1 = (v) => Math.round(v * 10) / 10;
const plural = (n, word) => `${n} ${n === 1 ? word : `${word}s`}`;
const titleOf = (d) => String(d?.title || '').trim() || 'Untitled dream';
const capital = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

// relativeDay() from ui.js with the weekday ("2 days ago · Monday", "Mon, 2 Nov 2025"), with shared date formatters:
// formatting hundreds of dates one by one is slow.
function dayLabeller() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const cache = new Map();
  let fmt = null;
  let wk = null;
  return (isoDay) => {
    if (!isoDay) return '';
    let out = cache.get(isoDay);
    if (out !== undefined) return out;
    const date = new Date(`${isoDay}T00:00:00`);
    const days = Math.round((today - date) / 86400000);
    try {
      if (Number.isNaN(days)) out = '';
      else if (days >= 0 && days < 7) {
        wk = wk || new Intl.DateTimeFormat(undefined, { weekday: 'long' });
        out = `${days === 0 ? 'Today' : days === 1 ? 'Yesterday' : `${days} days ago`} · ${wk.format(date)}`;
      } else {
        fmt = fmt || new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
        out = fmt.format(date);
      }
    } catch { out = relativeDay(isoDay); }
    cache.set(isoDay, out);
    return out;
  };
}

function hslRGB(h, s, l) {
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const hex = (rgb) => `#${rgb.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')}`;

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// Small seeded random generator (mulberry32): the same seed gives the same numbers, so the same sky.
function rng(seed) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// Roughly bell-shaped between -3 and 3 (three uniforms added up): most values near the middle, a few far out.
const bell = (rnd) => (rnd() + rnd() + rnd() - 1.5) * 2;

/** How the dream felt: a mood id from TAGS, or 'nightmare' / 'none' when nothing says. */
function moodOf(d) {
  for (const t of Array.isArray(d?.tags) ? d.tags : []) if (TAGS[t]?.kind === 'mood') return t;
  for (const e of Array.isArray(d?.emotions) ? d.emotions : []) {
    const m = EMOTION_MOOD[String(e || '').toLowerCase().trim()];
    if (m && TAGS[m]?.kind === 'mood') return m;
  }
  return dreamType(d) === 'nightmare' ? 'nightmare' : 'none';
}

function moodRGB(mood) {
  if (mood === 'nightmare') return EMBER;
  if (mood === 'none' || !TAGS[mood]) return LILAC;
  return hslRGB(TAGS[mood].hue, 0.72, 0.72);
}

const moodLabel = (mood) => (mood === 'none' ? 'no mood' : mood === 'nightmare' ? 'nightmare' : TAGS[mood]?.label || mood);

function monthName(month) {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  return m ? `${MONTHS[Number(m[2]) - 1] || ''} ${m[1]}`.trim() : 'Undated';
}

// Where the band runs at star i: mostly near one side or the other, crossing every third star, so each title has
// room on the open side. A slow second wave keeps the bends from looking stamped out.
function bandX(i, W) {
  const A = Math.min(W * 0.27, 140);
  const wave = Math.tanh(1.8 * Math.sin((i * Math.PI) / 3 + Math.PI / 6)) / Math.tanh(1.8);
  return W / 2 + A * (0.86 + 0.14 * Math.sin(i * 0.61 + 0.4)) * wave;
}

// A smooth curve through the points, as cubic Béziers (Catmull-Rom with the sideways pull softened by BEND, so the
// band runs nearly straight through each star and swings between them).
function curves(pts) {
  const out = [];
  for (let i = 0; i < pts.length - 1; i += 1) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    out.push([
      p1,
      { x: p1.x + (BEND * (p2.x - p0.x)) / 6, y: p1.y + (p2.y - p0.y) / 6 },
      { x: p2.x - (BEND * (p3.x - p1.x)) / 6, y: p2.y - (p3.y - p1.y) / 6 },
      p2,
    ]);
  }
  return out;
}

function pathOf(cs) {
  let d = `M${f1(cs[0][0].x)} ${f1(cs[0][0].y)}`;
  for (const [, a, b, p] of cs) d += `C${f1(a.x)} ${f1(a.y)} ${f1(b.x)} ${f1(b.y)} ${f1(p.x)} ${f1(p.y)}`;
  return d;
}

// Points every few pixels along a curve, each with its sideways direction (nx, ny), its heading in degrees and the
// length it stands for: what the star dust and star clouds are scattered from.
function trace(cs) {
  const out = [];
  for (const [p0, p1, p2, p3] of cs) {
    const len = Math.hypot(p1.x - p0.x, p1.y - p0.y) + Math.hypot(p2.x - p1.x, p2.y - p1.y) + Math.hypot(p3.x - p2.x, p3.y - p2.y);
    const n = Math.max(2, Math.ceil(len / 6));
    for (let k = 0; k < n; k += 1) {
      const t = k / n;
      const u = 1 - t;
      const x = u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x;
      const y = u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y;
      const dx = 3 * u * u * (p1.x - p0.x) + 6 * u * t * (p2.x - p1.x) + 3 * t * t * (p3.x - p2.x);
      const dy = 3 * u * u * (p1.y - p0.y) + 6 * u * t * (p2.y - p1.y) + 3 * t * t * (p3.y - p2.y);
      const m = Math.hypot(dx, dy) || 1;
      out.push({ x, y, nx: -dy / m, ny: dx / m, deg: (Math.atan2(dy, dx) * 180) / Math.PI, ds: len / n });
    }
  }
  return out;
}

function layout(dreams, W, filtering) {
  const rows = [];
  const months = [];
  dreams.forEach((d, i) => {
    const day = dreamDay(d);
    const month = String(day || '').slice(0, 7);
    const x = bandX(i, W);
    let y = TOP;
    if (i === 0) months.push({ y: 24, month });
    else {
      const prev = rows[i - 1];
      y = prev.y + STEP + ((x > W / 2) !== (prev.x > W / 2) ? CROSS : 0);
      if (month !== prev.month) {
        y += GAP;
        months.push({ y: (prev.y + y) / 2, month });
      }
    }
    const mood = moodOf(d);
    const type = dreamType(d);
    const base = moodRGB(mood);
    const rgb = type === 'nightmare' && mood !== 'nightmare' ? mix(base, EMBER, 0.4) : base;
    const words = (String(d?.text || '').trim().match(/\S+/g) || []).length;
    const fresh = Math.exp(-i / 24); // 1 for the newest dream, fading over the next few dozen
    rows.push({
      d, i, y, x, day, month, mood, type, rgb,
      color: hex(rgb),
      tint: hex(mix(rgb, WHITE, type === 'lucid' ? 0.6 : 0.74)),
      r: (5.5 + 5 * Math.min(1, Math.sqrt(words / 400))) * (1 + 0.16 * Math.exp(-i / 5)),
      op: 0.66 + 0.34 * fresh,
      spiky: i < 3 || words >= 280 || type === 'lucid',
      side: x > W / 2 ? 'left' : 'right', // the title goes where the band leaves room
    });
  });
  const last = rows[rows.length - 1];
  const H = Math.round(last.y + (filtering ? 72 : 104));
  const pts = [{ x: bandX(-1, W), y: 0 }, ...rows, { x: bandX(rows.length, W), y: H }];

  const counts = new Map();
  for (const r of rows) counts.set(r.mood, (counts.get(r.mood) || 0) + 1);
  const moods = [...counts.entries()]
    .map(([id, n]) => ({ id, n, color: hex(moodRGB(id)), label: moodLabel(id) }))
    .sort((a, b) => (a.id === 'none') - (b.id === 'none') || b.n - a.n || a.label.localeCompare(b.label)); // 'no mood' last
  return { W, H, rows, months, pts, moods, last };
}

// ---------- Drawing ----------

// A small four-point sparkle (diffraction spikes), centred on 0 0, arms `a` long.
const sparkle = (a) => `M0 ${-a}Q0 0 ${a} 0Q0 0 0 ${a}Q0 0 ${-a} 0Q0 0 0 ${-a}Z`;

// A vertical gradient down the whole band: each star's colour (blended by `tone`) where it sits, fading out at both
// ends. Only where the colour changes are stops needed, so long runs of one mood stay cheap.
function bandGradient(id, lay, tone) {
  const { H, rows, last } = lay;
  const at = (y) => Math.max(0, Math.min(1, y / H)).toFixed(4);
  const stop = (y, c, op = 1) => `<stop offset="${at(y)}" stop-color="${c}"${op < 1 ? ` stop-opacity="${op}"` : ''}/>`;
  const cs = rows.map((r) => hex(tone(r.rgb)));
  const out = [stop(0, cs[0], 0), stop(rows[0].y - 30, cs[0])];
  cs.forEach((c, i) => {
    if (i === 0 || i === cs.length - 1 || c !== cs[i - 1] || c !== cs[i + 1]) out.push(stop(rows[i].y, c));
  });
  out.push(stop(last.y + 24, cs[cs.length - 1]), stop(H, cs[cs.length - 1], 0));
  return `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="${H}">${out.join('')}</linearGradient>`;
}

// The same, in one colour: only the fades at both ends.
function fadeGradient(id, lay, c) {
  const { H, rows, last } = lay;
  return `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="${H}">`
    + `<stop offset="0" stop-color="${c}" stop-opacity="0"/>`
    + `<stop offset="${(Math.max(0, rows[0].y - 24) / H).toFixed(4)}" stop-color="${c}"/>`
    + `<stop offset="${Math.min(1, (last.y + 22) / H).toFixed(4)}" stop-color="${c}"/>`
    + `<stop offset="1" stop-color="${c}" stop-opacity="0"/></linearGradient>`;
}

const o2 = (v) => v.toFixed(2).replace(/^0(?=\.)/, ''); // 0.25 -> .25 (hundreds of these, so every byte counts)
const ellipse = (x, y, rx, ry, deg, op) => `<ellipse rx="${f1(rx)}" ry="${f1(ry)}" transform="translate(${f1(x)} ${f1(y)})rotate(${Math.round(deg)})" opacity="${o2(op)}"/>`;

// A soft round glow, bright in the middle and gone at the edge (stretched to fit each ellipse that uses it).
const softGlow = (id, c, peak) => `
  <radialGradient id="${id}">
    <stop offset="0" stop-color="${c}" stop-opacity="${peak}"/>
    <stop offset="0.35" stop-color="${c}" stop-opacity="${(peak * 0.55).toFixed(3)}"/>
    <stop offset="0.7" stop-color="${c}" stop-opacity="${(peak * 0.14).toFixed(3)}"/>
    <stop offset="1" stop-color="${c}" stop-opacity="0"/>
  </radialGradient>`;

// A dream star's halo in its colour: a white-hot middle, then the colour, fading softly into the dark.
const haloGlow = (id, rgb) => `
  <radialGradient id="${id}">
    <stop offset="0" stop-color="${hex(mix(rgb, WHITE, 0.6))}"/>
    <stop offset="0.14" stop-color="${hex(rgb)}" stop-opacity="0.85"/>
    <stop offset="0.34" stop-color="${hex(rgb)}" stop-opacity="0.38"/>
    <stop offset="0.64" stop-color="${hex(rgb)}" stop-opacity="0.11"/>
    <stop offset="1" stop-color="${hex(rgb)}" stop-opacity="0"/>
  </radialGradient>`;

// Clumps of starlight along the band (soft ellipses turned with it): milky ones in the middle, wider violet ones
// around them, now and then a small rosy glow (like the pink nebulae in real photos of the Milky Way).
function cloudsSVG(line, fade, rnd) {
  const out = { cv: [], cm: [], cr: [] };
  let next = 0;
  let run = 0;
  for (const s of line) {
    run += s.ds;
    if (run < next) continue;
    run = 0;
    next = 28 + rnd() * 22;
    const f = fade(s.y);
    if (f < 0.05) continue;
    const v = rnd();
    let g; let rx; let o; let op;
    if (v < 0.6) { g = 'cm'; rx = 18 + rnd() * 32; o = bell(rnd) * 9; op = 0.22 + rnd() * 0.27; }
    else if (v < 0.96) { g = 'cv'; rx = 40 + rnd() * 52; o = bell(rnd) * 18; op = 0.17 + rnd() * 0.2; }
    else { g = 'cr'; rx = 5 + rnd() * 7; o = bell(rnd) * 16; op = 0.3 + rnd() * 0.3; }
    out[g].push(ellipse(s.x + s.nx * o, s.y + s.ny * o, rx, rx * (0.38 + rnd() * 0.34), s.deg + bell(rnd) * 9, op * f));
  }
  // Violet under milky, rosy on top; one fill per group instead of one per cloud.
  return Object.entries(out).map(([g, els]) => (els.length ? `<g fill="url(#bv-mw-${g})">${els.join('')}</g>` : '')).join('');
}

// Dark knots of dust along the lane, so it breaks and thickens like the real one.
function knotsSVG(line, fade, rnd) {
  const out = [];
  let run = 0;
  let next = 30;
  for (const s of line) {
    run += s.ds;
    if (run < next) continue;
    run = 0;
    next = 36 + rnd() * 64;
    const f = fade(s.y);
    if (f < 0.1) continue;
    const rx = 9 + rnd() * 16;
    const o = bell(rnd) * 3;
    out.push(ellipse(s.x + s.nx * o, s.y + s.ny * o, rx, rx * (0.24 + rnd() * 0.22), s.deg + bell(rnd) * 7, (0.4 + rnd() * 0.4) * f));
  }
  return out.join('');
}

// Star dust: thousands of tiny stars, thick inside the band and sparse outside it. Each is a round-capped dot
// ("M x y h.1"); they are merged into a few paths by size and tint, cut into slabs down the page.
const DUST = [[0.85, 0.32], [1.2, 0.48], [1.65, 0.66], [2.3, 0.9]]; // [diameter, opacity]
function dustSVG(lay, line, fade, rnd) {
  const { W, H } = lay;
  const slabs = Math.max(1, Math.ceil(H / SLAB));
  const bins = Array.from({ length: slabs * DUST.length * 2 }, () => []);
  const put = (x, y, bright) => {
    if (x < 1 || x > W - 1 || y < 1 || y > H - 1) return;
    const v = rnd() * bright;
    const s = v < 0.6 ? 0 : v < 0.86 ? 1 : v < 0.97 ? 2 : 3;
    const warm = rnd() < 0.28 ? 1 : 0;
    bins[(Math.floor(y / SLAB) * DUST.length + s) * 2 + warm].push(`M${Math.round(x)} ${Math.round(y)}h.1`);
  };
  // Inside the band: most stars close to the core, a looser spread further out.
  const length = line.reduce((a, s) => a + s.ds, 0);
  const perPx = Math.min(1.5, 10000 / Math.max(1, length));
  for (const s of line) {
    const f = fade(s.y);
    let n = Math.floor(perPx * s.ds * f + rnd());
    while (n > 0) {
      n -= 1;
      const wide = rnd() < 0.45;
      const o = bell(rnd) * (wide ? 28 : 12);
      const along = (rnd() - 0.5) * s.ds;
      put(s.x + s.nx * o - s.ny * along, s.y + s.ny * o + s.nx * along, wide ? 0.97 : 1.03);
    }
  }
  // Everywhere: a thin scatter of field stars.
  const field = Math.min(2400, Math.round((W * H) / 1500));
  for (let k = 0; k < field; k += 1) put(rnd() * W, rnd() * H, 0.985);

  const out = [];
  bins.forEach((dots, b) => {
    if (!dots.length) return;
    const [w, op] = DUST[Math.floor(b / 2) % DUST.length];
    out.push(`<path${b % 2 ? ' class="is-warm"' : ''} stroke-width="${w}" stroke-opacity="${op}" d="${dots.join('')}"/>`);
  });
  return out.join('');
}

// One dream: its coloured halo, a sparkle on the notable ones, and a small bright core.
function starSVG(r, gid) {
  const kind = r.type === 'nightmare' ? ' is-night' : r.type === 'lucid' ? ' is-lucid' : '';
  return `<g class="bv-mw-star${kind}" transform="translate(${f1(r.x)} ${f1(r.y)})"${r.op < 0.995 ? ` opacity="${r.op.toFixed(2)}"` : ''}>`
    + `<circle class="bv-mw-halo" r="${f1(r.r * 2.5 + 3)}" fill="url(#${gid})"/>`
    + (r.spiky ? `<path class="bv-mw-spike" d="${sparkle(f1(r.r * 1.5 + 6))}"/>` : '')
    + `<circle class="bv-mw-point" r="${f1(1.3 + r.r * 0.22)}" fill="${r.tint}"/>`
    + '</g>';
}

function skySVG(lay) {
  const { W, H, rows, last, pts } = lay;
  const rnd = rng(hash(`${W}|${rows.map((r) => r.d.id).join('|')}`));
  const fade = (y) => Math.max(0, Math.min(1, y / (rows[0].y - 20), (H - y) / (H - last.y - 20)));
  const cs = curves(pts);
  const line = trace(cs);
  const path = pathOf(cs);
  // The dust lane runs just beside the core (and a fainter second one on the other side), wavering a little.
  const lane = curves(pts.map((p, j) => ({ x: p.x + 3.5 + 2.2 * Math.sin(j * 1.1 + 0.7), y: p.y })));
  const lane2 = pathOf(curves(pts.map((p, j) => ({ x: p.x - 6 - 2 * Math.sin(j * 0.8 + 2), y: p.y }))));

  const gids = new Map();
  for (const r of rows) if (!gids.has(r.color)) gids.set(r.color, { id: `bv-mw-h${gids.size}`, rgb: r.rgb });
  const halos = [...gids.values()].map((g) => haloGlow(g.id, g.rgb)).join('');
  const stars = rows.map((r) => starSVG(r, gids.get(r.color).id)).join('');
  const hazeW = Math.min(W * 0.66, 250);
  // Soft edges without a blur filter (too heavy on a page this tall): each layer is a stack of faint strokes along the
  // same line (drawn once in <defs>, reused), widest first, so the light builds up towards the middle and fades out
  // at the sides.
  const stack = (cls, ref, grad, widths, op, dashes = []) => widths.map((w, k) => `<use href="#${ref}" class="${cls}" stroke="url(#${grad})" stroke-width="${f1(w)}" stroke-opacity="${op}"${
    dashes[k] ? ` stroke-dasharray="${dashes[k]}"` : ''}/>`).join('');
  const line0 = (id, d) => `<path id="${id}" d="${d}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;

  return `
    <svg class="bv-mw-svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true" focusable="false">
      <defs>
        ${line0('bv-mw-c', path)}
        ${line0('bv-mw-l1', pathOf(lane))}
        ${line0('bv-mw-l2', lane2)}
        ${fadeGradient('bv-mw-gh', lay, hex(HAZE))}
        ${bandGradient('bv-mw-gg', lay, (c) => mix(MILK, c, 0.3))}
        ${fadeGradient('bv-mw-gc', lay, hex(CREAM))}
        ${fadeGradient('bv-mw-gl', lay, '#0a061e')}
        ${softGlow('bv-mw-cm', '#f4eeff', 0.9)}
        ${softGlow('bv-mw-cv', '#8f78ec', 0.75)}
        ${softGlow('bv-mw-cr', '#ff9fc4', 0.85)}
        ${softGlow('bv-mw-cd', '#08051a', 1)}
        ${halos}
      </defs>
      <g class="bv-mw-band">
        ${stack('bv-mw-haze', 'bv-mw-c', 'bv-mw-gh', [1, 0.8, 0.62, 0.46, 0.32].map((k) => hazeW * k), 0.03)}
        ${stack('bv-mw-glow', 'bv-mw-c', 'bv-mw-gg', [66, 52, 40, 30, 21, 13], 0.036)}
        <g class="bv-mw-clouds">${cloudsSVG(line, fade, rnd)}</g>
        ${stack('bv-mw-core', 'bv-mw-c', 'bv-mw-gc', [10, 6, 3], 0.085)}
        <g class="bv-mw-knots" fill="url(#bv-mw-cd)">${knotsSVG(trace(lane), fade, rnd)}</g>
        ${stack('bv-mw-lane', 'bv-mw-l1', 'bv-mw-gl', [9, 5.5, 2.6], 0.13, ['260 40 170 70 120 30', '190 55 90 36 240 45', '140 70 210 40 60 50 110 35'])}
        ${stack('bv-mw-lane', 'bv-mw-l2', 'bv-mw-gl', [5, 2.2], 0.11, ['120 90 60 140 200 70', '90 110 150 60 40 90'])}
      </g>
      <g class="bv-mw-dust">${dustSVG(lay, line, fade, rnd)}</g>
      <g class="bv-mw-stars">${stars}</g>
      <g class="bv-mw-sel"></g>
    </svg>`;
}

// A few stars that twinkle (HTML dots above the SVG, so the twinkle never makes the phone redraw the sky).
function twinklesHTML(lay) {
  const { W, H, rows } = lay;
  const rnd = rng(hash(`twinkle|${W}|${rows[0].d.id}|${rows.length}`));
  const n = Math.min(36, Math.max(8, Math.round(H / 190)));
  const out = [];
  for (let k = 0; k < n; k += 1) {
    const r = rows[Math.floor(rnd() * rows.length)];
    const inBand = rnd() < 0.7;
    const x = inBand ? r.x + bell(rnd) * 30 : rnd() * W;
    const y = inBand ? r.y + (rnd() - 0.5) * STEP : 20 + rnd() * (H - 60);
    if (x < 4 || x > W - 4) continue;
    out.push(`<i class="bv-mw-twk${rnd() < 0.3 ? ' is-big' : ''}" style="left:${f1(x)}px;top:${f1(y)}px;animation-duration:${f1(2.6 + rnd() * 4)}s;animation-delay:-${f1(rnd() * 6)}s"></i>`);
  }
  return `<div class="bv-mw-twinkles" aria-hidden="true">${out.join('')}</div>`;
}

function itemsHTML(lay) {
  const { W, rows } = lay;
  const dayOf = dayLabeller();
  return rows.map((r) => {
    const reach = 22; // the row's tap area also covers the star
    const pad = Math.round(reach + r.r + 15);
    const left = r.side === 'right' ? Math.max(0, Math.round(r.x - reach)) : 0;
    const width = r.side === 'right' ? W - left : Math.min(W, Math.round(r.x + reach));
    const when = dayOf(r.day);
    const feel = r.mood === 'none' ? '' : moodLabel(r.mood);
    const meta = [when, feel].filter(Boolean).join(' · ');
    const aria = [titleOf(r.d), when, feel, r.type === 'nightmare' && r.mood !== 'nightmare' ? 'nightmare' : ''].filter(Boolean).join(', ');
    return `
      <button type="button" class="bv-mw-item is-${r.side}" data-mw-open="${esc(r.d.id)}" aria-label="${esc(aria)}"
        style="top:${Math.round(r.y - ITEM_H / 2)}px;left:${left}px;width:${width}px;--pad:${pad}px">
        <span class="bv-mw-title">${esc(titleOf(r.d))}</span>
        ${meta ? `<span class="bv-mw-when">${esc(meta)}</span>` : ''}
      </button>`;
  }).join('');
}

function monthsHTML(lay) {
  return lay.months.map((m) => `
    <div class="bv-mw-month" style="top:${Math.round(m.y)}px" aria-hidden="true"><span>${esc(monthName(m.month))}</span></div>`).join('');
}

function legendHTML(moods) {
  return `
    <div class="bv-mw-legend" role="group" aria-label="Moods">
      ${moods.map((m) => `
        <button type="button" class="bv-mw-chip" data-mw-mood="${esc(m.id)}" aria-pressed="false" style="--c:${m.color}">
          <span class="bv-mw-dot" aria-hidden="true"></span>${esc(m.label)}<b>${m.n}</b>
        </button>`).join('')}
    </div>`;
}

function emptyHTML(filtering) {
  return `
    <div class="bv-mw-empty">
      <span class="bv-mw-empty-icon" aria-hidden="true">${ICON}</span>
      <p class="bv-mw-empty-title">${filtering ? 'No stars here' : 'Your Milky Way starts with a dream'}</p>
      <p class="bv-mw-empty-hint">${filtering
        ? 'No dream fits this search or filter. Clear it to see your whole Milky Way again.'
        : 'Record a dream and it will appear here as a star.'}</p>
    </div>`;
}

// ---------- The view ----------

let state = null;

function teardown() {
  if (!state) return;
  for (const off of state.offs) off();
  if (state.raf) cancelAnimationFrame(state.raf);
  state = null;
}

function setCaption(mood) {
  const m = mood ? state.lay.moods.find((x) => x.id === mood) : null;
  state.cap.innerHTML = m
    ? `<span class="bv-mw-cap-text">${esc(capital(m.label))} · ${plural(m.n, 'dream')}</span>
       <button type="button" class="bv-mw-clear" data-mw-all>Show all</button>`
    : `<span class="bv-mw-cap-text">${plural(state.lay.rows.length, 'dream')} · newest at the top</span>`;
}

function setMood(mood) {
  const m = mood && state.lay.moods.some((x) => x.id === mood) ? mood : null;
  state.mood = m;
  state.root.classList.toggle('is-focus', Boolean(m));
  const rings = [];
  state.lay.rows.forEach((r, i) => {
    const on = Boolean(m) && r.mood === m;
    state.starEls[i]?.classList.toggle('is-hl', on);
    state.itemEls[i]?.classList.toggle('is-hl', on);
    if (on) rings.push(`<circle cx="${f1(r.x)}" cy="${f1(r.y)}" r="${f1(r.r + 8)}"/>`);
  });
  // A thin ring around each picked-out star, like the circles that mark objects on a star chart.
  if (state.selEl) state.selEl.innerHTML = rings.join('');
  for (const c of state.chipEls) c.setAttribute('aria-pressed', String(c.dataset.mwMood === m));
  setCaption(m);
}

function render(el, args = {}) {
  teardown();
  const { dreams = [], filtering = false, navigate } = args;
  const list = (Array.isArray(dreams) ? dreams : []).filter((d) => d && d.id != null);
  if (!list.length) {
    el.innerHTML = emptyHTML(filtering);
    return;
  }
  const W = Math.max(260, Math.round(el.clientWidth || 350));
  const lay = layout(list, W, filtering);
  el.innerHTML = `
    <div class="bv-mw">
      ${legendHTML(lay.moods)}
      <p class="bv-mw-cap" aria-live="polite"></p>
      <div class="bv-mw-flow" style="height:${lay.H}px">
        ${skySVG(lay)}
        ${twinklesHTML(lay)}
        ${monthsHTML(lay)}
        ${itemsHTML(lay)}
        ${filtering ? '' : `<p class="bv-mw-source" style="top:${Math.round(lay.last.y + 58)}px">Where your Milky Way begins</p>`}
      </div>
    </div>`;
  const root = el.querySelector('.bv-mw');
  state = {
    el,
    args,
    root,
    lay,
    W,
    cap: root.querySelector('.bv-mw-cap'),
    selEl: root.querySelector('.bv-mw-sel'),
    starEls: [...root.querySelectorAll('.bv-mw-star')],
    itemEls: [...root.querySelectorAll('.bv-mw-item')],
    chipEls: [...root.querySelectorAll('.bv-mw-chip')],
    mood: null,
    raf: 0,
    offs: [],
  };
  setCaption(null);

  const on = (target, type, fn, opts) => {
    target.addEventListener(type, fn, opts);
    state.offs.push(() => target.removeEventListener(type, fn, opts));
  };
  on(root, 'click', (ev) => {
    let b;
    if ((b = ev.target.closest('[data-mw-open]'))) {
      navigate?.(`#dream/${encodeURIComponent(b.dataset.mwOpen)}`);
    } else if ((b = ev.target.closest('[data-mw-mood]'))) {
      const m = b.dataset.mwMood;
      setMood(state.mood === m ? null : m);
    } else if (ev.target.closest('[data-mw-all]')) {
      setMood(null);
    }
  });
  on(document, 'keydown', (ev) => {
    if (ev.key === 'Escape' && state.mood) setMood(null);
  });
  // Titles are placed in pixels, so lay the Milky Way out again if the width changes (e.g. the phone turns).
  on(window, 'resize', () => {
    if (state.raf) return;
    state.raf = requestAnimationFrame(() => {
      if (!state) return;
      state.raf = 0;
      if (!el.isConnected) return;
      const w = Math.round(el.clientWidth || 0);
      if (!w || Math.abs(w - state.W) <= 2) return;
      const keep = state.mood;
      render(el, state.args);
      if (keep && state) setMood(keep);
    });
  });
}

export default {
  id: 'milkyway',
  label: 'Milky Way',
  icon: ICON,
  render,
  destroy() { teardown(); },
};
