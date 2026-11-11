// Journal view (new layout): Year wheel. The twelve months around a circle like a zodiac (January at the top, then
// clockwise), each segment glowing with that month's dreams: one dot per dream, placed by its day, stacked when a
// day has several. The current month is gold, months still to come are dimmed, and the middle sums up the year.
// Tap a month to open its day wheel (js/screens/b/wheel.js, wired the same way as on Home): year → month → day.
// The year wheel counts the Journal's current dreams (search and filters applied); the day wheel shows every dream.
import { localDay } from '../../../store.js';
import { symbolsOf, dreamDay, dreamType } from '../../../symbols.js';
import { esc, icons } from '../../../ui.js';
import { wheelHTML, defaultDay, dreamsByDay, shiftMonth, isCurrentMonth } from '../wheel.js';

const SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const ISO = /^\d{4}-\d{2}-\d{2}$/;

// Ring radii in the 200×200 drawing.
const R_RIM = 99;
const R_OUT = 97;   // segments, outer edge
const R_IN = 58;    // segments, inner edge
const R_CORE = 54;  // the middle
const R_DOT = 63;   // first row of dots (more rows outward)
const DOT_ROW = 5.2;

// Kept between renders (the Journal redraws the view on every search keystroke and on coming back from a dream).
// { year, month: 'YYYY-MM' while a month is open, else null, wheel: { month, selected, index }, last: 'YYYY-MM' }
let keep = null;
let cleanup = null;

const plural = (n, word) => `${n} ${n === 1 ? word : `${word}s`}`;
const pad2 = (n) => String(n).padStart(2, '0');
const monthKey = (year, m) => `${year}-${pad2(m + 1)}`; // m 0-based
const daysIn = (year, m) => new Date(year, m + 1, 0).getDate();
const freshWheel = (month) => ({ month, selected: defaultDay(month), index: 0 });

function pt(deg, r) {
  const a = (deg * Math.PI) / 180;
  return `${(100 + r * Math.sin(a)).toFixed(2)} ${(100 - r * Math.cos(a)).toFixed(2)}`;
}

/** The year's dreams by month: { months: [{ count, days: Map(day → [types]) }], total, top, busiest }. */
function yearData(dreams, year) {
  const months = Array.from({ length: 12 }, () => ({ count: 0, days: new Map() }));
  const syms = new Map();
  const y = String(year);
  let total = 0;
  for (const d of dreams) {
    const day = dreamDay(d);
    if (!ISO.test(day) || day.slice(0, 4) !== y) continue;
    const mo = months[Number(day.slice(5, 7)) - 1];
    if (!mo) continue;
    const n = Number(day.slice(8, 10));
    mo.count += 1;
    total += 1;
    if (!mo.days.has(n)) mo.days.set(n, []);
    mo.days.get(n).push(dreamType(d));
    for (const s of symbolsOf(d)) {
      const c = syms.get(s.key) || { name: s.name, count: 0 };
      c.count += 1;
      syms.set(s.key, c);
    }
  }
  let top = null;
  for (const c of syms.values()) if (!top || c.count > top.count) top = c;
  let busiest = -1;
  months.forEach((m, i) => { if (m.count && (busiest < 0 || m.count > months[busiest].count)) busiest = i; });
  return { months, total, top, busiest };
}

function yearSVG(data, year, now) {
  const curY = Number(now.slice(0, 4));
  const curM = Number(now.slice(5, 7)) - 1;
  const max = Math.max(1, ...data.months.map((m) => m.count));
  const segs = [];
  const dots = [];
  data.months.forEach((mo, i) => {
    const a0 = i * 30 - 15;
    const future = year > curY || (year === curY && i > curM);
    const cls = ['bv-year-seg', future ? 'is-future' : '', year === curY && i === curM ? 'is-now' : '', mo.count ? 'is-dream' : ''].filter(Boolean).join(' ');
    const fill = mo.count ? (0.08 + 0.34 * (mo.count / max)).toFixed(3) : '0.04';
    const s0 = a0 + 0.9;
    const s1 = a0 + 30 - 0.9;
    segs.push(`<path class="${cls}" fill-opacity="${fill}" d="M${pt(s0, R_OUT)}A${R_OUT} ${R_OUT} 0 0 1 ${pt(s1, R_OUT)}L${pt(s1, R_IN)}A${R_IN} ${R_IN} 0 0 0 ${pt(s0, R_IN)}Z"/>`);
    // One dot per dream at its day's angle inside the segment; a day's second and third dream sit further out.
    const dim = daysIn(year, i);
    for (const [n, types] of mo.days) {
      const a = a0 + 2.5 + ((n - 0.5) / dim) * 25;
      types.slice(0, 3).forEach((t, k) => {
        const p = pt(a, R_DOT + k * DOT_ROW).split(' ');
        if (k === 0) dots.push(`<circle class="bv-year-halo" cx="${p[0]}" cy="${p[1]}" r="3.2"/>`);
        dots.push(`<circle class="bv-year-dot t-${t}" cx="${p[0]}" cy="${p[1]}" r="1.35"/>`);
      });
    }
  });
  const dividers = Array.from({ length: 12 }, (_, i) => {
    const a = i * 30 - 15;
    return `<path d="M${pt(a, R_IN - 1)}L${pt(a, R_RIM)}"/>`;
  }).join('');
  // Today: a small gold mark on the inner ring, at today's place in the current month.
  let todayMark = '';
  if (year === curY) {
    const a = curM * 30 - 15 + 2.5 + ((Number(now.slice(8, 10)) - 0.5) / daysIn(year, curM)) * 25;
    const p = pt(a, R_IN - 2.6).split(' ');
    todayMark = `<circle class="bv-year-today" cx="${p[0]}" cy="${p[1]}" r="1.7"/>`;
  }
  return `
    <svg class="bv-year-rings" viewBox="0 0 200 200" aria-hidden="true">
      <defs>
        <radialGradient id="bv-year-core" cx="50%" cy="45%" r="55%">
          <stop offset="0%" stop-color="#3a2a78" stop-opacity="0.95"/>
          <stop offset="100%" stop-color="#120d2e" stop-opacity="0.9"/>
        </radialGradient>
      </defs>
      <circle cx="100" cy="100" r="${R_RIM}" class="bv-year-rim"/>
      <g class="bv-year-segs">${segs.join('')}</g>
      <g class="bv-year-dividers">${dividers}</g>
      <circle cx="100" cy="100" r="${R_IN - 1}" class="bv-year-ring-in"/>
      <circle cx="100" cy="100" r="${R_CORE}" fill="url(#bv-year-core)" class="bv-year-core"/>
      <g class="bv-year-dots">${dots.join('')}</g>
      ${todayMark}
      <g class="bv-year-stars">
        <circle cx="74" cy="66" r="0.8"/><circle cx="128" cy="72" r="0.6"/><circle cx="66" cy="126" r="0.7"/>
        <circle cx="136" cy="132" r="0.9"/><circle cx="100" cy="150" r="0.6"/>
      </g>
    </svg>`;
}

function centerHTML(data, year, filtering) {
  if (!data.total) {
    return `
      <div class="bv-year-center is-empty">
        <p class="bv-year-none">${filtering ? `No matching dreams in ${year}` : `No dreams saved in ${year}`}</p>
      </div>`;
  }
  const top = data.top;
  const busy = data.busiest >= 0 ? data.months[data.busiest] : null;
  return `
    <div class="bv-year-center">
      <p class="bv-year-big">${data.total}</p>
      <p class="bv-year-big-sub">${data.total === 1 ? 'dream' : 'dreams'} in ${year}</p>
      ${top ? `<p class="bv-year-k">Most dreamt</p><p class="bv-year-v">${esc(top.name)} <span>× ${top.count}</span></p>` : ''}
      ${busy ? `<p class="bv-year-k">Busiest month</p><p class="bv-year-v">${LONG[data.busiest]} <span>× ${busy.count}</span></p>` : ''}
    </div>`;
}

function yearModeHTML(dreams, filtering, minYear) {
  const now = localDay();
  const curY = Number(now.slice(0, 4));
  const curM = Number(now.slice(5, 7)) - 1;
  const { year } = keep;
  const data = yearData(dreams, year);
  const hits = data.months.map((mo, i) => {
    const future = year > curY || (year === curY && i > curM);
    const key = monthKey(year, i);
    return `<button type="button" class="bv-year-hit${keep.last === key ? ' is-sel' : ''}" style="--a:${i * 30}deg" data-year-month="${key}"
      aria-label="${esc(`${LONG[i]} ${year}: ${mo.count ? plural(mo.count, filtering ? 'matching dream' : 'dream') : 'no dreams'}`)}" ${future ? 'disabled' : ''}></button>`;
  }).join('');
  const labels = data.months.map((mo, i) => {
    const cls = [
      year > curY || (year === curY && i > curM) ? 'is-future' : '',
      year === curY && i === curM ? 'is-now' : '',
      mo.count ? 'is-dream' : '',
      keep.last === monthKey(year, i) ? 'is-sel' : '',
    ].filter(Boolean).join(' ');
    return `<span class="bv-year-label ${cls}" style="--a:${i * 30}deg" aria-hidden="true">${SHORT[i]}</span>
      ${mo.count ? `<span class="bv-year-count ${cls}" style="--a:${i * 30}deg" aria-hidden="true">${mo.count}</span>` : ''}`;
  }).join('');
  const sub = data.total
    ? (filtering ? 'Matching dreams only · tap a month' : 'Tap a month to see its days')
    : 'Tap a month to look at its days';
  return `
    <div class="bv-year-head">
      <button type="button" class="icon-btn bv-year-nav" data-year-prev aria-label="Previous year" ${year <= minYear ? 'disabled' : ''}>${icons.back}</button>
      <div class="bv-year-head-text">
        <h2 class="bh-h2 bv-year-title">${year}</h2>
        <p class="bv-year-sub">${esc(sub)}</p>
      </div>
      <button type="button" class="icon-btn bv-year-nav bv-year-nav-next" data-year-next aria-label="Next year" ${year >= curY ? 'disabled' : ''}>${icons.back}</button>
    </div>
    <div class="bv-year-wheel" role="group" aria-label="${esc(`Your dreams in ${year}, month by month`)}">
      ${yearSVG(data, year, now)}
      ${labels}
      ${hits}
      ${centerHTML(data, year, filtering)}
    </div>`;
}

function monthModeHTML(dreams, filtering) {
  const now = localDay();
  const curY = Number(now.slice(0, 4));
  const curM = Number(now.slice(5, 7)) - 1;
  const { year, month } = keep;
  const data = yearData(dreams, year);
  const max = Math.max(1, ...data.months.map((m) => m.count));
  const ribbon = data.months.map((mo, i) => {
    const key = monthKey(year, i);
    const future = year > curY || (year === curY && i > curM);
    const cls = ['bv-year-rib', year === curY && i === curM ? 'is-now' : '', mo.count ? 'is-dream' : ''].filter(Boolean).join(' ');
    return `<button type="button" class="${cls}" data-year-jump="${key}" aria-pressed="${key === month}"
      aria-label="${esc(`${LONG[i]} ${year}: ${mo.count ? plural(mo.count, filtering ? 'matching dream' : 'dream') : 'no dreams'}`)}" ${future ? 'disabled' : ''}>
      <span class="bv-year-rib-name">${SHORT[i]}</span>
      <span class="bv-year-rib-glow" style="opacity:${mo.count ? (0.35 + 0.65 * (mo.count / max)).toFixed(2) : 0}"></span>
    </button>`;
  }).join('');
  return `
    <div class="bv-year-bar">
      <button type="button" class="bv-year-back" data-year-back>${icons.back}<span>Back to ${year}</span></button>
      ${filtering ? '<span class="bv-year-note">Days show all dreams</span>' : ''}
    </div>
    <div class="bv-year-ribbon" role="group" aria-label="${esc(`Months of ${year}`)}">${ribbon}</div>
    ${wheelHTML(keep.wheel)}`;
}

function emptyHTML(filtering) {
  return filtering
    ? `<div class="jr-none glass bv-year-empty">
        <p>No dreams match, so the year wheel is empty for now.</p>
        <button type="button" class="btn btn-ghost" data-clear-all>Show all dreams</button>
      </div>`
    : `<div class="jr-none glass bv-year-empty"><p>No dreams yet. Each one you save lights up its month here.</p></div>`;
}

export default {
  id: 'year',
  label: 'Year',
  icon: icons.zodiac,

  render(el, { dreams, all, filtering }) {
    cleanup?.();
    cleanup = null;
    if (!dreams.length) {
      el.innerHTML = emptyHTML(filtering);
      return;
    }

    const now = localDay();
    const curY = Number(now.slice(0, 4));
    // The wheel goes back to the year of the oldest dream (never past this year).
    let minYear = curY;
    for (const d of all || dreams) {
      const day = dreamDay(d);
      if (ISO.test(day)) minYear = Math.min(minYear, Number(day.slice(0, 4)));
    }
    if (!keep || !(keep.year <= curY) || (keep.month && keep.month > now.slice(0, 7))) {
      // First visit: this year, unless none of the shown dreams are from it (then the newest one's year).
      const newest = dreams.map(dreamDay).filter((d) => ISO.test(d) && d <= now).sort().pop();
      const hasThisYear = dreams.some((d) => dreamDay(d).startsWith(String(curY)));
      keep = { year: hasThisYear || !newest ? curY : Number(newest.slice(0, 4)), month: null, wheel: null, last: null };
    }
    if (keep.month && !keep.wheel) keep.wheel = freshWheel(keep.month);

    el.innerHTML = '<div class="bv-year"></div>';
    const root = el.firstElementChild;

    const paint = (focus) => {
      minYear = Math.min(minYear, keep.year);
      root.classList.toggle('is-month', Boolean(keep.month));
      root.innerHTML = keep.month ? monthModeHTML(dreams, filtering) : yearModeHTML(dreams, filtering, minYear);
      if (focus) root.querySelector(focus)?.focus({ preventScroll: true });
    };

    // The day wheel's month changed: the year follows it.
    const goMonth = (month, focus) => {
      keep.month = month;
      keep.last = month;
      keep.year = Number(month.slice(0, 4));
      keep.wheel = freshWheel(month);
      paint(focus);
    };

    // Only the day wheel redraws for a day / next-dream tap; the ribbon above it stays.
    const paintWheel = (focus) => {
      const section = root.querySelector('[data-wheel]');
      if (!section) { paint(focus); return; }
      section.outerHTML = wheelHTML(keep.wheel);
      if (focus) root.querySelector(focus)?.focus({ preventScroll: true });
    };

    const onClick = (e) => {
      let b;
      if (e.target.closest('[data-year-prev]')) {
        if (keep.year <= minYear) return;
        keep.year -= 1;
        paint(keep.year <= minYear ? '[data-year-next]' : '[data-year-prev]');
      } else if (e.target.closest('[data-year-next]')) {
        if (keep.year >= curY) return;
        keep.year += 1;
        paint(keep.year >= curY ? '[data-year-prev]' : '[data-year-next]');
      } else if ((b = e.target.closest('[data-year-month]'))) {
        goMonth(b.dataset.yearMonth, '[data-year-back]');
      } else if ((b = e.target.closest('[data-year-jump]'))) {
        if (b.dataset.yearJump === keep.month) return;
        goMonth(b.dataset.yearJump, `[data-year-jump="${b.dataset.yearJump}"]`);
      } else if (e.target.closest('[data-year-back]')) {
        const last = keep.month;
        keep.month = null;
        keep.wheel = null;
        paint(last ? `[data-year-month="${last}"]` : null);
      } else if ((b = e.target.closest('[data-wheel-day]'))) {
        keep.wheel = { ...keep.wheel, selected: Number(b.dataset.wheelDay), index: 0 };
        paintWheel(`[data-wheel-day="${keep.wheel.selected}"]`);
      } else if (e.target.closest('[data-wheel-more]')) {
        const count = (dreamsByDay(keep.wheel.month).get(keep.wheel.selected) || []).length;
        keep.wheel = { ...keep.wheel, index: count ? (keep.wheel.index + 1) % count : 0 };
        paintWheel('[data-wheel-more]');
      } else if (e.target.closest('[data-wheel-prev]')) {
        goMonth(shiftMonth(keep.wheel.month, -1), '[data-wheel-prev]');
      } else if (e.target.closest('[data-wheel-next]')) {
        if (isCurrentMonth(keep.wheel.month)) return;
        const next = shiftMonth(keep.wheel.month, 1);
        goMonth(next, isCurrentMonth(next) ? '[data-wheel-prev]' : '[data-wheel-next]');
      }
    };

    root.addEventListener('click', onClick);
    cleanup = () => root.removeEventListener('click', onClick);
    paint();
  },

  destroy() {
    cleanup?.();
    cleanup = null;
  },
};
