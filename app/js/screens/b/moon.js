// New layout: the moon-cycle card, shared by Home (compact) and Insights (full, under the dream sky).
//   moonCardHTML({ dreams, compact })  → HTML for this month: tonight's moon drawn in its real phase with its name and
//     how much of it is lit, the next full moon, and a strip with every night of the month (a tiny moon each, a gold dot
//     under nights with a dream, a ring on today). Nights with a dream are plain links to that night's newest dream
//     (#dream/<id>), so the card needs no wiring. Full card: month title and a small key. Compact: one slim row plus
//     the strip and a one-line caption (about 125px tall on a 390px phone). Styles: css/b-moon.css (bmoon-).
//   moonOfNight('YYYY-MM-DD') → { lit 0..1, waxing, event: 'new'|'first'|'full'|'last'|null, name }.
// Only the phase is shown, no astrology.
//
// The night of a date D is the night that starts on the evening of D (Record dates a dream recorded before noon to the
// day before). So the moon is drawn for midnight after D, and D is the "full moon" night when the full moon falls
// between noon on D and noon on D+1, local time; same for new moon and the quarters. The instants of new moon,
// quarters and full moon come from Meeus, Astronomical Algorithms ch. 49 (within about a minute); the phase between
// them is interpolated. Drawn as seen from the northern hemisphere (lit on the right while waxing).
import { localDay } from '../../store.js';
import { dreamDay } from '../../symbols.js';
import { esc } from '../../ui.js';

const DAY_MS = 86400000;
const RAD = Math.PI / 180;
const SYNODIC = 29.530588861; // mean days from new moon to new moon
const JD_UNIX = 2440587.5;    // Julian day of 1970-01-01 00:00 UTC
const JD_K0 = 2451550.09766;  // mean new moon of lunation 0 (6 Jan 2000; the true one is at 18:14 UTC)

const pad = (n) => String(n).padStart(2, '0');
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const parts = (day) => day.split('-').map(Number);
const titleOf = (d) => String(d?.title || '').trim() || 'Untitled dream';

// ---- Moon phases ----

const phaseCache = new Map(); // k → ms

/** Instant (ms, UTC) of lunation k's phase: k whole = new moon, +0.25 first quarter, +0.5 full, +0.75 last quarter. */
function phaseTime(k) {
  const hit = phaseCache.get(k);
  if (hit !== undefined) return hit;
  const T = k / 1236.85, T2 = T * T, T3 = T2 * T, T4 = T3 * T;
  let jde = JD_K0 + SYNODIC * k + 0.00015437 * T2 - 0.00000015 * T3 + 0.00000000073 * T4;
  const E = 1 - 0.002516 * T - 0.0000074 * T2;
  const M = (2.5534 + 29.1053567 * k - 0.0000014 * T2 - 0.00000011 * T3) * RAD;                         // Sun's anomaly
  const P = (201.5643 + 385.81693528 * k + 0.0107582 * T2 + 0.00001238 * T3 - 0.000000058 * T4) * RAD;   // Moon's anomaly
  const F = (160.7108 + 390.67050284 * k - 0.0016118 * T2 - 0.00000227 * T3 + 0.000000011 * T4) * RAD;   // latitude argument
  const O = (124.7746 - 1.56375588 * k + 0.0020672 * T2 + 0.00000215 * T3) * RAD;                         // ascending node
  const s = Math.sin, c = Math.cos;
  const q = Math.round((k - Math.floor(k)) * 4) % 4;
  if (q === 0 || q === 2) {
    const a = q === 0
      ? [-0.40720, 0.17241, 0.01608, 0.01039, 0.00739, -0.00514, 0.00208]
      : [-0.40614, 0.17302, 0.01614, 0.01043, 0.00734, -0.00515, 0.00209];
    jde += a[0] * s(P) + a[1] * E * s(M) + a[2] * s(2 * P) + a[3] * s(2 * F) + a[4] * E * s(P - M)
      + a[5] * E * s(P + M) + a[6] * E * E * s(2 * M) - 0.00111 * s(P - 2 * F) - 0.00057 * s(P + 2 * F)
      + 0.00056 * E * s(2 * P + M) - 0.00042 * s(3 * P) + 0.00042 * E * s(M + 2 * F) + 0.00038 * E * s(M - 2 * F)
      - 0.00024 * E * s(2 * P - M) - 0.00017 * s(O);
  } else {
    jde += -0.62801 * s(P) + 0.17172 * E * s(M) - 0.01183 * E * s(P + M) + 0.00862 * s(2 * P) + 0.00804 * s(2 * F)
      + 0.00454 * E * s(P - M) + 0.00204 * E * E * s(2 * M) - 0.00180 * s(P - 2 * F) - 0.00070 * s(P + 2 * F)
      - 0.00040 * s(3 * P) - 0.00034 * E * s(2 * P - M) + 0.00032 * E * s(M + 2 * F) + 0.00032 * E * s(M - 2 * F)
      - 0.00028 * E * E * s(P + 2 * M) + 0.00027 * E * s(2 * P + M) - 0.00017 * s(O);
    const W = 0.00306 - 0.00038 * E * c(M) + 0.00026 * c(P) - 0.00002 * c(P - M) + 0.00002 * c(P + M) + 0.00002 * c(2 * F);
    jde += q === 1 ? W : -W;
  }
  const ms = (jde - JD_UNIX) * DAY_MS - 69000; // dynamical time → UTC (ΔT ≈ 69 s)
  phaseCache.set(k, ms);
  return ms;
}

/** The lunation around an instant: { k, t: [new, first quarter, full, last quarter, next new] } in ms. */
function lunationAt(ms) {
  let k = Math.floor((ms / DAY_MS + JD_UNIX - JD_K0) / SYNODIC);
  if (phaseTime(k) > ms) k -= 1;
  else if (phaseTime(k + 1) <= ms) k += 1;
  return { k, t: [k, k + 0.25, k + 0.5, k + 0.75, k + 1].map(phaseTime) };
}

const EVENTS = ['new', 'first', 'full', 'last', 'new'];
const EVENT_NAMES = { new: 'New moon', first: 'First quarter', full: 'Full moon', last: 'Last quarter' };
const BETWEEN_NAMES = ['Waxing crescent', 'Waxing gibbous', 'Waning gibbous', 'Waning crescent'];
const nightCache = new Map();

/** The moon on the night of `day` ('YYYY-MM-DD'): { lit 0..1, waxing, event: new|first|full|last|null, name }. */
export function moonOfNight(day) {
  const hit = nightCache.get(day);
  if (hit) return hit;
  const [y, m, d] = parts(day);
  const start = new Date(y, m - 1, d, 12).getTime();
  const mid = new Date(y, m - 1, d + 1).getTime();
  const end = new Date(y, m - 1, d + 1, 12).getTime();
  const { t } = lunationAt(mid);
  let i = 0;
  while (i < 3 && mid >= t[i + 1]) i += 1;
  let p = (i + (mid - t[i]) / (t[i + 1] - t[i])) / 4; // 0 new, 0.25 first quarter, 0.5 full, 0.75 last quarter
  let event = null;
  for (let j = 0; j < 5; j += 1) {
    if (t[j] >= start && t[j] < end) { event = EVENTS[j]; p = (j % 4) / 4; break; }
  }
  const moon = {
    lit: (1 - Math.cos(2 * Math.PI * p)) / 2,
    waxing: p < 0.5,
    event,
    name: event ? EVENT_NAMES[event] : BETWEEN_NAMES[i],
  };
  nightCache.set(day, moon);
  return moon;
}

/** The night ('YYYY-MM-DD') that holds an instant: before noon belongs to the night that started the evening before. */
function nightOf(ms) {
  const d = new Date(ms);
  if (d.getHours() < 12) d.setDate(d.getDate() - 1);
  return localDay(d);
}

/** The first night from `today` on (today included) with a full moon (frac 0.5) or a new moon (frac 0). */
function nextNight(today, frac) {
  const { k } = lunationAt(Date.now());
  for (let j = k - 1; j <= k + 2; j += 1) {
    const night = nightOf(phaseTime(j + frac));
    if (night >= today) return night;
  }
  return '';
}

// ---- Drawing ----

// The lit part: half the rim on the lit side, then back along a half-ellipse whose width is |1 - 2 × lit| (a crescent
// bulges toward the lit side, a gibbous moon away from it). Unit circle; '' for a new moon.
function litPath(moon) {
  const f = moon.lit;
  if (f <= 0.005) return '';
  if (f > 0.995) return 'M-1 0A1 1 0 1 0 1 0A1 1 0 1 0 -1 0Z';
  const rx = Math.abs(1 - 2 * f).toFixed(3);
  const rim = moon.waxing ? 1 : 0;
  const term = moon.waxing === (f >= 0.5) ? 1 : 0;
  return `M0 -1A1 1 0 0 ${rim} 0 1A${rx} 1 0 0 ${term} 0 -1Z`;
}

/** A tiny flat moon for the strip. */
function tinySVG(moon) {
  const d = litPath(moon);
  return `<svg class="bmoon-tiny" viewBox="-1.12 -1.12 2.24 2.24" aria-hidden="true"><circle r="1" class="bmoon-dark"/>${d ? `<path class="bmoon-lit" d="${d}"/>` : ''}</svg>`;
}

/**
 * Tonight's moon as a small picture: warm lit side with soft craters, faint earthshine on the dark side.
 * `id` keeps its gradient ids apart per card type (one card of a type per page) and the HTML the same each time,
 * so a screen that compares HTML before re-drawing sees no change.
 */
function bigSVG(moon, id) {
  const g = `bmoon-g-${id}`;
  const c = `bmoon-c-${id}`;
  const d = litPath(moon);
  const craters = [[0.36, -0.34, 0.2], [-0.22, 0.34, 0.16], [0.18, 0.6, 0.1], [-0.42, -0.28, 0.12], [0.58, 0.22, 0.09], [-0.05, -0.62, 0.08]]
    .map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}"/>`).join('');
  return `
    <svg class="bmoon-big" viewBox="-1.08 -1.08 2.16 2.16" aria-hidden="true">
      <defs>
        <radialGradient id="${g}" gradientUnits="userSpaceOnUse" cx="-0.35" cy="-0.4" r="1.7">
          <stop offset="0" stop-color="#fff8e4"/>
          <stop offset="0.55" stop-color="#fbe5ad"/>
          <stop offset="1" stop-color="#e2b86c"/>
        </radialGradient>
        ${d ? `<clipPath id="${c}"><path d="${d}"/></clipPath>` : ''}
      </defs>
      <circle r="1" class="bmoon-big-dark"/>
      ${d ? `<path d="${d}" fill="url(#${g})"/><g class="bmoon-craters" clip-path="url(#${c})">${craters}</g>` : ''}
    </svg>`;
}

// ---- Words ----

const shortDate = (day) => {
  const [y, m, d] = parts(day);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
};

function monthWords(day, opts = { month: 'long', year: 'numeric' }) {
  const [y, m] = parts(day);
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, opts);
}

/** { phase, lit, next }: "Waxing crescent" · "6% lit" · "Next full moon: Tue 24 Nov" (the new moon on a full-moon night). */
function tonightWords(today) {
  const moon = moonOfNight(today);
  const lit = `${Math.round(moon.lit * 100)}% lit`;
  if (moon.event === 'full') {
    const nm = nextNight(today, 0);
    return { moon, phase: 'Full moon', lit, next: nm ? `Next new moon: ${shortDate(nm)}` : '' };
  }
  const fm = nextNight(today, 0.5);
  return { moon, phase: moon.name, lit, next: fm ? `Next full moon: ${shortDate(fm)}` : '' };
}

// ---- The card ----

/** Newest dream of each night: Map('YYYY-MM-DD' → { count, newest }). */
function nightsWithDreams(dreams) {
  const out = new Map();
  for (const d of Array.isArray(dreams) ? dreams : []) {
    if (!d || d.id == null) continue;
    const day = dreamDay(d);
    const cur = out.get(day);
    if (!cur) out.set(day, { count: 1, newest: d });
    else {
      cur.count += 1;
      if (String(d.createdAt || '') > String(cur.newest.createdAt || '')) cur.newest = d;
    }
  }
  return out;
}

function stripHTML(today, nights, compact) {
  const [y, m] = parts(today);
  const days = new Date(y, m, 0).getDate();
  const short = monthWords(today, { month: 'short' });
  const cells = [];
  for (let d = 1; d <= days; d += 1) {
    const day = `${y}-${pad(m)}-${pad(d)}`;
    const moon = moonOfNight(day);
    const night = nights.get(day);
    const cls = ['bmoon-day'];
    if (day === today) cls.push('is-today');
    if (day > today) cls.push('is-future');
    if (night) cls.push('is-dream');
    if (moon.event === 'full') cls.push('is-full');
    const label = `${short} ${d}: ${moon.name.toLowerCase()}${day === today ? ', tonight' : ''}`;
    const num = !compact && d % 7 === 1 ? `<span class="bmoon-num">${d}</span>` : '';
    const inner = `${tinySVG(moon)}<span class="bmoon-mark"></span>${num}`;
    cells.push(night
      ? `<a class="${cls.join(' ')}" href="#dream/${encodeURIComponent(night.newest.id)}"
          aria-label="${esc(`${label}, ${plural(night.count, 'dream')}. Open “${titleOf(night.newest)}”`)}">${inner}</a>`
      : `<span class="${cls.join(' ')}" role="img" aria-label="${esc(label)}">${inner}</span>`);
  }
  return `<div class="bmoon-strip" style="--n:${days}">${cells.join('')}</div>`;
}

/**
 * The moon card for the current month. `dreams`: the dreams whose nights get a gold dot (any order).
 * `compact`: the slim Home version.
 */
export function moonCardHTML({ dreams = [], compact = false } = {}) {
  const today = localDay();
  const nights = nightsWithDreams(dreams);
  const t = tonightWords(today);
  const glow = (0.25 + 0.75 * t.moon.lit).toFixed(2);
  const picture = `<span class="bmoon-tonight${t.moon.event === 'full' ? ' is-full' : ''}" style="--glow:${glow}">${bigSVG(t.moon, compact ? 'compact' : 'full')}</span>`;
  const month = monthWords(today);

  if (compact) {
    return `
      <section class="glass bmoon bmoon-compact" aria-label="${esc(`Moon cycle, ${month}`)}">
        <div class="bmoon-head">
          ${picture}
          <div class="bmoon-text">
            <p class="bmoon-phase"><span class="bmoon-phase-name">${esc(t.phase)}</span><span class="bmoon-lit">${esc(t.lit)}</span></p>
            ${t.next ? `<p class="bmoon-sub">${esc(t.next)}</p>` : ''}
          </div>
        </div>
        ${stripHTML(today, nights, true)}
        <p class="bmoon-cap">
          <span>${esc(monthWords(today, { month: 'long' }))} moons</span>
          <span class="bmoon-cap-key"><i class="bmoon-key-dot" aria-hidden="true"></i>a night with a dream</span>
        </p>
      </section>`;
  }

  const tonight = t.moon.event === 'full' ? 'Tonight the moon is full' : `Tonight: ${t.phase.toLowerCase()}, ${t.lit}`;
  return `
    <section class="glass bmoon" aria-label="${esc(`Moon cycle, ${month}`)}">
      <div class="bmoon-head">
        <div class="bmoon-text">
          <p class="bmoon-kicker">Moon cycle</p>
          <h2 class="bmoon-title">${esc(month)}</h2>
          <p class="bmoon-sub">${esc(tonight)}</p>
          ${t.next ? `<p class="bmoon-sub">${esc(t.next)}</p>` : ''}
        </div>
        ${picture}
      </div>
      ${stripHTML(today, nights, false)}
      <p class="bmoon-key">
        <span><i class="bmoon-key-dot" aria-hidden="true"></i>a night with a dream</span>
        <span><i class="bmoon-key-ring" aria-hidden="true"></i>today</span>
      </p>
    </section>`;
}
