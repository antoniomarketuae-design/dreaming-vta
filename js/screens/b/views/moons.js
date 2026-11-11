// Journal view (new layout): Moon timeline. One line down the page with one row per night that has dreams, newest
// first; each row has the moon drawn in its real phase that night and the night's dream cards. Above it, this month's
// moons day by day (today ringed, nights with a dream marked). Only the phase is shown, no astrology.
//
// The night of a date D is the night that starts on the evening of D (Record dates a dream recorded before noon to the
// day before). So the moon is drawn for midnight after D, and D is the "full moon" night when the full moon falls
// between noon on D and noon on D+1, local time; same for new moon and the quarters. The instants of new moon,
// quarters and full moon come from Meeus, Astronomical Algorithms ch. 49 (within about a minute); the phase between
// them is interpolated. Drawn as seen from the northern hemisphere (lit on the right while waxing).
import { localDay } from '../../../store.js';
import { symbolsOf, dreamDay, dreamType, DREAM_TYPES } from '../../../symbols.js';
import { dreamArtURL } from '../../../dreamart.js';
import { hasImage } from '../../../images.js';
import { hasVideo } from '../../../videos.js';
import { esc, icons } from '../../../ui.js';

const DAY_MS = 86400000;
const RAD = Math.PI / 180;
const SYNODIC = 29.530588861; // mean days from new moon to new moon
const JD_UNIX = 2440587.5;    // Julian day of 1970-01-01 00:00 UTC
const JD_K0 = 2451550.09766;  // mean new moon of lunation 0 (6 Jan 2000; the true one is at 18:14 UTC)
const GAP_NOTE = 4;           // nights without a dream before the line says so
const THUMB = 52;             // card picture, CSS px
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

const pad = (n) => String(n).padStart(2, '0');
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const parts = (day) => day.split('-').map(Number);
const dayNumber = (day) => { const [y, m, d] = parts(day); return Math.round(Date.UTC(y, m - 1, d) / DAY_MS); };

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
function moonOfNight(day) {
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

/** The next full moon's night from now, as 'YYYY-MM-DD'. */
function nextFullNight(today) {
  const now = Date.now();
  const { k, t } = lunationAt(now);
  let full = t[2] > now ? t[2] : phaseTime(k + 1.5);
  if (nightOf(full) < today) full = phaseTime(k + 1.5); // early morning: the full moon of the night that is ending
  return nightOf(full);
}

// A lit disc plus the terminator: half the rim on the lit side, then back along a half-ellipse whose width is
// |1 - 2 × lit| (a crescent bulges toward the lit side, a gibbous moon away from it). Unit circle, sized by CSS.
function moonSVG(moon, cls) {
  const f = moon.lit;
  let lit = '';
  if (f > 0.995) lit = '<circle r="1" class="bv-moons-lit"/>';
  else if (f > 0.005) {
    const rx = Math.abs(1 - 2 * f).toFixed(3);
    const rim = moon.waxing ? 1 : 0;
    const term = moon.waxing === (f >= 0.5) ? 1 : 0;
    lit = `<path class="bv-moons-lit" d="M0 -1A1 1 0 0 ${rim} 0 1A${rx} 1 0 0 ${term} 0 -1Z"/>`;
  }
  return `<svg class="${cls}" viewBox="-1.12 -1.12 2.24 2.24" aria-hidden="true"><circle r="1" class="bv-moons-dark"/>${lit}</svg>`;
}

// ---- Words ----

function dateWords(day, today, yesterday) {
  if (day === today) return 'Today';
  if (day === yesterday) return 'Last night';
  const [y, m, d] = parts(day);
  const opts = { weekday: 'short', day: 'numeric', month: 'short' };
  if (y !== Number(today.slice(0, 4))) opts.year = 'numeric';
  return new Date(y, m - 1, d).toLocaleDateString(undefined, opts);
}

function monthWords(day) {
  const [y, m] = parts(day);
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

function gapWords(nights, filtering) {
  const what = filtering ? 'a matching dream' : 'a dream';
  if (nights >= 60) return `About ${plural(Math.round(nights / 30.44), 'month')} without ${what}`;
  return `${nights} nights without ${what}`;
}

// ---- HTML ----

function skyHTML(byDay, today) {
  const [y, m] = parts(today);
  const days = new Date(y, m, 0).getDate();
  const short = new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'short' });
  const cells = [];
  for (let d = 1; d <= days; d += 1) {
    const day = `${y}-${pad(m)}-${pad(d)}`;
    const moon = moonOfNight(day);
    const count = byDay.get(day)?.length || 0;
    const cls = ['bv-moons-day'];
    if (day === today) cls.push('is-today');
    if (day > today) cls.push('is-future');
    if (count) cls.push('is-dream');
    if (moon.event === 'full') cls.push('is-full');
    const label = `${short} ${d}: ${moon.name.toLowerCase()}${day === today ? ', tonight' : ''}${count ? `, ${plural(count, 'dream')}` : ''}`;
    const inner = `${moonSVG(moon, 'bv-moons-tiny')}<span class="bv-moons-mark"></span>${d % 7 === 1 ? `<span class="bv-moons-num">${d}</span>` : ''}`;
    cells.push(count
      ? `<button type="button" class="${cls.join(' ')}" data-bvm-go="${day}" aria-label="${esc(`${label}. Show this night`)}">${inner}</button>`
      : `<span class="${cls.join(' ')}" role="img" aria-label="${esc(label)}">${inner}</span>`);
  }
  const tonight = moonOfNight(today);
  const full = tonight.event === 'full' ? today : nextFullNight(today);
  const [fy, fm, fd] = parts(full);
  const fullWords = `Next full moon: ${new Date(fy, fm - 1, fd).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}`;
  const tonightWords = tonight.event === 'full' ? 'Tonight the moon is full'
    : `Tonight: ${tonight.name.toLowerCase()}, ${Math.round(tonight.lit * 100)}% lit`;
  return `
    <section class="bv-moons-sky" aria-label="${esc(`Moon phases in ${monthWords(today)}`)}">
      <div class="bv-moons-sky-head">
        <div class="bv-moons-sky-text">
          <h2 class="bv-moons-sky-title">${esc(monthWords(today))}</h2>
          <p class="bv-moons-sky-sub">${esc(tonightWords)}</p>
          ${full === today ? '' : `<p class="bv-moons-sky-sub">${esc(fullWords)}</p>`}
        </div>
        <span class="bv-moons-tonight${tonight.event === 'full' ? ' is-full' : ''}">${moonSVG(tonight, 'bv-moons-tonight-svg')}</span>
      </div>
      <div class="bv-moons-strip" style="--n:${days}">${cells.join('')}</div>
      <p class="bv-moons-key">
        <span><i class="bv-moons-key-dot"></i>a night with a dream</span>
        <span><i class="bv-moons-key-ring"></i>today</span>
      </p>
    </section>`;
}

function cardHTML(d) {
  const type = dreamType(d);
  const typeLabel = type === 'general' ? '' : DREAM_TYPES.find((t) => t.id === type)?.label || '';
  const syms = symbolsOf(d).slice(0, 3);
  const title = String(d.title || '').trim() || 'Untitled dream';
  let src = '';
  if (hasImage(d)) { try { src = dreamArtURL(d, THUMB) || ''; } catch {} }
  const tags = (typeLabel ? `<span class="bv-moons-type bv-moons-type-${type}">${esc(typeLabel)}</span>` : '')
    + syms.map((s) => `<span class="bv-moons-sym">${esc(s.name)}</span>`).join('');
  return `
    <a class="bv-moons-card${type === 'nightmare' ? ' is-night' : ''}" href="#dream/${encodeURIComponent(d.id)}" data-bvm-open>
      <span class="bv-moons-pic">
        <img class="bv-moons-img" alt="" width="${THUMB}" height="${THUMB}" decoding="async" data-bvm-art="${esc(d.id)}"${src ? ` src="${esc(src)}" loading="lazy"` : ''}>
        ${hasVideo(d) ? `<span class="video-mark" aria-hidden="true">${icons.play}</span>` : ''}
      </span>
      <span class="bv-moons-text">
        <span class="bv-moons-title">${esc(title)}</span>
        ${tags ? `<span class="bv-moons-tags">${tags}</span>` : ''}
      </span>
      <span class="bv-moons-chev" aria-hidden="true">${icons.chevronRight}</span>
    </a>`;
}

function nightHTML(day, list, today, yesterday) {
  const moon = moonOfNight(day);
  const word = moon.event === 'full' ? 'Full' : moon.event === 'new' ? 'New' : '';
  return `
    <li class="bv-moons-night${moon.event ? ` is-${moon.event}` : ''}" data-bvm-night="${day}">
      <span class="bv-moons-node">
        <span class="bv-moons-moon">${moonSVG(moon, 'bv-moons-moon-svg')}</span>
        ${word ? `<span class="bv-moons-word">${word}</span>` : ''}
      </span>
      <p class="bv-moons-when">
        <span class="bv-moons-date">${esc(dateWords(day, today, yesterday))}</span>
        <span class="bv-moons-phase">${esc(moon.name)}</span>
      </p>
      <div class="bv-moons-cards">${list.map(cardHTML).join('')}</div>
    </li>`;
}

function timelineHTML(dreams, filtering, today) {
  const yesterday = (() => { const [y, m, d] = parts(today); return localDay(new Date(y, m - 1, d - 1)); })();
  const nights = new Map();
  const undated = [];
  for (const d of dreams) {
    const day = dreamDay(d);
    if (!ISO_DAY.test(day)) { undated.push(d); continue; }
    if (!nights.has(day)) nights.set(day, []);
    nights.get(day).push(d);
  }
  const days = [...nights.keys()].sort().reverse();
  const rows = [];
  let prev = '';
  for (const day of days) {
    if (prev) {
      const gap = dayNumber(prev) - dayNumber(day) - 1;
      if (gap >= GAP_NOTE) rows.push(`<li class="bv-moons-gap">${esc(gapWords(gap, filtering))}</li>`);
    }
    if (!prev ? day.slice(0, 7) !== today.slice(0, 7) : day.slice(0, 7) !== prev.slice(0, 7)) {
      rows.push(`<li class="bv-moons-mlabel">${esc(monthWords(day))}</li>`);
    }
    rows.push(nightHTML(day, nights.get(day), today, yesterday));
    prev = day;
  }
  if (undated.length) {
    rows.push(`
      <li class="bv-moons-night is-undated">
        <span class="bv-moons-node"><span class="bv-moons-moon bv-moons-moon-blank"></span></span>
        <p class="bv-moons-when"><span class="bv-moons-date">No date</span></p>
        <div class="bv-moons-cards">${undated.map(cardHTML).join('')}</div>
      </li>`);
  }
  const total = dreams.length;
  const count = days.length + (undated.length ? 1 : 0);
  const end = filtering ? `${plural(total, 'dream')} found, on ${plural(count, 'night')}.` : `${plural(total, 'dream')} on ${plural(count, 'night')}.`;
  return `
    <ol class="bv-moons-line">${rows.join('')}</ol>
    <p class="bv-moons-end">${esc(end)}</p>`;
}

function emptyHTML(filtering) {
  return `
    <div class="bv-moons-empty">
      <p>${filtering ? 'No dreams match. The moon keeps turning though.' : 'No dreams yet. Your first one will get its moon here.'}</p>
      ${filtering ? '<button type="button" class="btn btn-ghost" data-clear-all>Show all dreams</button>' : ''}
    </div>`;
}

// ---- View ----

let live = null; // { el, io, raf, onClick, onError }

function cleanup() {
  if (!live) return;
  const { el, io, onClick, onError } = live;
  io?.disconnect();
  if (live.raf) cancelAnimationFrame(live.raf);
  el.removeEventListener('click', onClick);
  el.removeEventListener('error', onError, true);
  live = null;
}

export default {
  id: 'moons',
  label: 'Moons',
  icon: icons.moon,

  render(el, { dreams = [], filtering = false, navigate } = {}) {
    cleanup();
    const today = localDay();
    const byId = new Map(dreams.map((d) => [String(d.id), d]));
    const byDay = new Map();
    for (const d of dreams) {
      const day = dreamDay(d);
      if (!byDay.has(day)) byDay.set(day, []);
      byDay.get(day).push(d);
    }

    el.innerHTML = `
      <div class="bv-moons">
        ${skyHTML(byDay, today)}
        ${dreams.length ? timelineHTML(dreams, filtering, today) : emptyHTML(filtering)}
      </div>`;

    const state = { el, io: null, raf: 0, onClick: null, onError: null };
    live = state;

    // Generated paintings are drawn on a canvas, so only the ones near the screen are painted, a few per frame.
    const queue = [];
    const paint = (img) => {
      const d = byId.get(img.dataset.bvmArt);
      let url = '';
      try { url = d ? dreamArtURL(d, THUMB) || '' : ''; } catch {}
      if (url) img.src = url;
    };
    const drain = () => {
      state.raf = 0;
      if (live !== state) return;
      const stop = performance.now() + 8;
      while (queue.length && performance.now() < stop) paint(queue.shift());
      if (queue.length) state.raf = requestAnimationFrame(drain);
    };
    const enqueue = (img) => {
      queue.push(img);
      if (!state.raf) state.raf = requestAnimationFrame(drain);
    };
    const pending = el.querySelectorAll('img[data-bvm-art]:not([src])');
    if (typeof IntersectionObserver === 'function') {
      state.io = new IntersectionObserver((entries) => {
        for (const en of entries) {
          if (!en.isIntersecting) continue;
          state.io.unobserve(en.target);
          enqueue(en.target);
        }
      }, { rootMargin: '600px 0px' });
      for (const img of pending) state.io.observe(img);
    } else {
      for (const img of pending) enqueue(img);
    }

    state.onClick = (ev) => {
      const card = ev.target.closest('[data-bvm-open]');
      if (card && el.contains(card)) {
        ev.preventDefault();
        navigate?.(card.getAttribute('href'));
        return;
      }
      const go = ev.target.closest('[data-bvm-go]');
      if (!go || !el.contains(go)) return;
      const row = el.querySelector(`[data-bvm-night="${go.dataset.bvmGo}"]`);
      if (!row) return;
      const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
      row.scrollIntoView({ block: 'start', behavior: calm ? 'auto' : 'smooth' });
      row.classList.remove('is-flash');
      void row.offsetWidth; // restart the glow
      row.classList.add('is-flash');
    };
    el.addEventListener('click', state.onClick);

    // A picture that can't load (offline, removed) shows the dream's painting instead. 'error' doesn't bubble.
    state.onError = (ev) => {
      const img = ev.target;
      if (!img?.dataset?.bvmArt || img.dataset.fallback) return;
      const d = byId.get(img.dataset.bvmArt);
      img.dataset.fallback = '1';
      let url = '';
      try { url = d ? dreamArtURL({ ...d, image: null }, THUMB) || '' : ''; } catch {}
      if (url) img.src = url;
    };
    el.addEventListener('error', state.onError, true);
  },

  destroy() {
    cleanup();
  },
};
