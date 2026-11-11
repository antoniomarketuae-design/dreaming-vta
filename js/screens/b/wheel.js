// New layout: the dream wheel on Home. The month as a circle, like a zodiac wheel: day 1 at the top and clockwise,
// each day labelled 1st, 2nd, 3rd…; days with dreams light up with the dream's picture, today has a gold ring and
// future days are dimmed. The middle shows the chosen day's dream (tap it to open the dream; "next" when the day has
// more than one). This file only builds HTML; Home keeps the state and wires the taps.
import { listDreams, localDay } from '../../store.js';
import { symbolsOf, dreamDay, dreamType, DREAM_TYPES } from '../../symbols.js';
import { esc, icons } from '../../ui.js';
import { dreamArtURL } from '../../dreamart.js';
import { hasVideo } from '../../videos.js';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** 1 → "1st", 2 → "2nd", 3 → "3rd", 11 → "11th", 22 → "22nd". */
export function ordinal(n) {
  const v = n % 100;
  const suffix = v >= 11 && v <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th');
  return `${n}${suffix}`;
}

const daysIn = (month) => new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate();
const thisMonth = () => localDay().slice(0, 7);
const dayKey = (month, n) => `${month}-${String(n).padStart(2, '0')}`;

/** 'YYYY-MM' one month before / after. */
export function shiftMonth(month, by) {
  const d = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1 + by, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export const isCurrentMonth = (month) => month === thisMonth();

/** The month's dreams by day number, newest first within a day: Map(n → dreams). */
export function dreamsByDay(month) {
  const map = new Map();
  for (const d of listDreams()) {
    const day = dreamDay(d);
    if (!day.startsWith(month)) continue;
    const n = Number(day.slice(8, 10));
    if (!map.has(n)) map.set(n, []);
    map.get(n).push(d);
  }
  return map;
}

/** Which day to show first: the newest dream's day this month, else today (this month) or the 1st. */
export function defaultDay(month) {
  const byDay = dreamsByDay(month);
  if (byDay.size) return Math.max(...byDay.keys());
  return isCurrentMonth(month) ? Number(localDay().slice(8, 10)) : 1;
}

function picture(d, px, cls) {
  let url = '';
  try { url = dreamArtURL(d, px) || ''; } catch {}
  return url
    ? `<img class="${cls}" src="${esc(url)}" alt="" width="${px}" height="${px}" decoding="async">`
    : `<span class="${cls} bw-pic-fallback"></span>`;
}

// Rings, day ticks and a few stars behind the days (drawn in a 200×200 box).
function ringsSVG(n) {
  const ticks = Array.from({ length: n }, (_, i) => {
    const a = ((i + 0.5) / n) * 2 * Math.PI; // between two days
    const x1 = 100 + 82 * Math.sin(a), y1 = 100 - 82 * Math.cos(a);
    const x2 = 100 + 99 * Math.sin(a), y2 = 100 - 99 * Math.cos(a);
    return `<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}"/>`;
  }).join('');
  return `
    <svg class="bw-rings" viewBox="0 0 200 200" aria-hidden="true">
      <defs>
        <radialGradient id="bw-core" cx="50%" cy="45%" r="55%">
          <stop offset="0%" stop-color="#3a2a78" stop-opacity="0.95"/>
          <stop offset="100%" stop-color="#120d2e" stop-opacity="0.9"/>
        </radialGradient>
      </defs>
      <circle cx="100" cy="100" r="99" class="bw-ring-outer"/>
      <circle cx="100" cy="100" r="82" class="bw-ring-mid"/>
      <circle cx="100" cy="100" r="62" class="bw-ring-inner"/>
      <circle cx="100" cy="100" r="50" fill="url(#bw-core)" class="bw-core"/>
      <g class="bw-ticks">${ticks}</g>
      <g class="bw-stars">
        <circle cx="72" cy="64" r="0.8"/><circle cx="131" cy="70" r="0.6"/><circle cx="64" cy="128" r="0.7"/>
        <circle cx="138" cy="134" r="0.9"/><circle cx="100" cy="42" r="0.6"/><circle cx="100" cy="158" r="0.7"/>
      </g>
    </svg>`;
}

function centerHTML(month, n, list, index) {
  const date = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, n);
  const when = `${WEEKDAYS[date.getDay()]} · ${ordinal(n)}`;
  if (!list.length) {
    const today = isCurrentMonth(month) && n === Number(localDay().slice(8, 10));
    return `
      <div class="bw-center bw-center-empty">
        <p class="bw-when">${esc(when)}</p>
        <p class="bw-none">${today ? 'No dream yet today' : `No dream on the ${ordinal(n)}`}</p>
        ${today ? `<a class="bw-record" href="#record">${icons.plus}<span>Record</span></a>` : ''}
      </div>`;
  }
  const d = list[Math.min(index, list.length - 1)];
  const type = dreamType(d);
  const typeLabel = type === 'general' ? '' : DREAM_TYPES.find((t) => t.id === type)?.label || '';
  const syms = symbolsOf(d).slice(0, 2);
  return `
    <div class="bw-center">
      <a class="bw-open" href="#dream/${encodeURIComponent(d.id)}" aria-label="Open ${esc(d.title || 'this dream')}">
        <span class="bw-center-pic">${picture(d, 64, 'bw-center-img')}${hasVideo(d) ? `<span class="video-mark" aria-hidden="true">${icons.play}</span>` : ''}</span>
        <span class="bw-when">${esc(when)}${typeLabel ? ` · <span class="bw-type bw-type-${type}">${esc(typeLabel)}</span>` : ''}</span>
        <span class="bw-title">${esc(String(d.title || '').trim() || 'Untitled dream')}</span>
        ${syms.length ? `<span class="bw-syms">${syms.map((s) => `<span class="bw-sym">${esc(s.name)}</span>`).join('')}</span>` : ''}
      </a>
      ${list.length > 1 ? `
        <button type="button" class="bw-next" data-wheel-more aria-label="Next dream of this day">
          <span>${index + 1} of ${list.length}</span>${icons.chevronRight}
        </button>` : ''}
    </div>`;
}

/** The wheel section for `month` ('YYYY-MM') with day `selected` chosen and its `index`-th dream in the middle. */
export function wheelHTML({ month, selected, index = 0 }) {
  const n = daysIn(month);
  const byDay = dreamsByDay(month);
  const now = localDay();
  const current = isCurrentMonth(month);
  const todayN = current ? Number(now.slice(8, 10)) : 0;
  const total = [...byDay.values()].reduce((sum, l) => sum + l.length, 0);
  const label = `${MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;

  const days = Array.from({ length: n }, (_, i) => {
    const day = i + 1;
    const angle = ((i / n) * 360).toFixed(2);
    const list = byDay.get(day) || [];
    const future = dayKey(month, day) > now;
    const cls = [
      'bw-day',
      list.length ? 'is-dream' : '',
      day === todayN ? 'is-today' : '',
      day === selected ? 'is-sel' : '',
      list.some((d) => dreamType(d) === 'nightmare') ? 'is-night' : '',
    ].filter(Boolean).join(' ');
    const what = list.length ? `${list.length} ${list.length === 1 ? 'dream' : 'dreams'}` : 'no dream';
    return `
      <button type="button" class="${cls}" style="--a:${angle}deg" data-wheel-day="${day}"
        aria-label="${esc(`${MONTHS[Number(month.slice(5, 7)) - 1]} ${ordinal(day)}: ${what}`)}" aria-pressed="${day === selected}" ${future ? 'disabled' : ''}>
        <span class="bw-dot">${list.length ? picture(list[0], 28, 'bw-dot-img') : ''}</span>
        ${list.length > 1 ? `<span class="bw-count">${list.length}</span>` : ''}
      </button>
      <span class="bw-label${day === todayN ? ' is-today' : ''}${list.length ? ' is-dream' : ''}" style="--a:${angle}deg" aria-hidden="true">${ordinal(day)}</span>`;
  }).join('');

  return `
    <section class="bh-section bw" aria-labelledby="bw-title" data-wheel>
      <div class="bw-head">
        <button type="button" class="icon-btn bw-nav" data-wheel-prev aria-label="Previous month">${icons.back}</button>
        <div class="bw-head-text">
          <h2 class="bh-h2" id="bw-title">${esc(label)}</h2>
          <p class="bw-sub">${total ? `${total} ${total === 1 ? 'dream' : 'dreams'} on ${byDay.size} ${byDay.size === 1 ? 'day' : 'days'}` : 'No dreams this month yet'}</p>
        </div>
        <button type="button" class="icon-btn bw-nav bw-nav-next" data-wheel-next aria-label="Next month" ${current ? 'disabled' : ''}>${icons.back}</button>
      </div>
      <div class="bw-wheel" role="group" aria-label="${esc(`Dreams in ${label}`)}">
        ${ringsSVG(n)}
        ${days}
        ${centerHTML(month, selected, byDay.get(selected) || [], index)}
      </div>
      <a class="bw-all" href="#journal">All dreams in the journal${icons.chevronRight}</a>
    </section>`;
}
