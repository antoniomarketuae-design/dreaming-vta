// New layout: the dream wheel, the Calendar tab's main view. The month as a circle, like a zodiac wheel: day 1 at the
// top and clockwise, each day labelled 1st, 2nd, 3rd…; days with dreams light up with the dream's picture, days with a
// day-journal note get a small ember mark, today has a gold ring and future days are dimmed.
// The middle shows the chosen day's dream: its picture, title and symbols, and a gold "See more" button that opens it
// (the picture and title open it too). When the day has several dreams, small dots with a › under the button show
// the next one (data-wheel-more).
// On the ring, the first tap on a day chooses it; tapping the chosen day again opens the dream in the middle. The
// chosen dream day has a soft pulsing ring (a still ring with reduced motion) as a hint that it can be opened.
// This file only builds HTML; the Calendar (calendar.js) keeps the state and wires the taps. Styles: .bw-* in
// css/b-calendar.css.
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
  const i = Math.min(Math.max(0, index), list.length - 1);
  const d = list[i];
  const type = dreamType(d);
  const typeLabel = type === 'general' ? '' : DREAM_TYPES.find((t) => t.id === type)?.label || '';
  const syms = symbolsOf(d).slice(0, 2);
  const title = String(d.title || '').trim() || 'Untitled dream';
  const href = `#dream/${encodeURIComponent(d.id)}`;
  // The picture and title open the dream too, but only for touch: screen readers get the one "See more" link.
  return `
    <div class="bw-center">
      <a class="bw-open" href="${esc(href)}" tabindex="-1" aria-hidden="true">
        <span class="bw-center-pic">${picture(d, 64, 'bw-center-img')}${hasVideo(d) ? `<span class="video-mark">${icons.play}</span>` : ''}</span>
        <span class="bw-when">${esc(when)}${typeLabel ? ` · <span class="bw-type bw-type-${type}">${esc(typeLabel)}</span>` : ''}</span>
        <span class="bw-title">${esc(title)}</span>
        ${syms.length ? `<span class="bw-syms">${syms.map((s) => `<span class="bw-sym">${esc(s.name)}</span>`).join('')}</span>` : ''}
      </a>
      <a class="bw-cta" href="${esc(href)}" aria-label="${esc(`See more: ${title}${typeLabel ? `, ${typeLabel.toLowerCase()} dream` : ''}`)}">
        <span>See more</span>${icons.chevronRight}
      </a>
      ${list.length > 1 ? switchHTML(i, list.length) : ''}
    </div>`;
}

/** Under "See more": a quiet way to show the day's next dream (dots for up to 5 dreams, "2/7" beyond). */
function switchHTML(i, count) {
  const marks = count <= 5
    ? `<span class="bw-dots">${Array.from({ length: count }, (_, k) => `<i${k === i ? ' class="is-on"' : ''}></i>`).join('')}</span>`
    : `<span class="bw-of">${i + 1}/${count}</span>`;
  return `
      <button type="button" class="bw-switch" data-wheel-more aria-label="${esc(`Dream ${i + 1} of ${count} on this day. Show the next one`)}">
        <span class="bw-switch-in" aria-hidden="true">${marks}${icons.chevronRight}</span>
      </button>`;
}

/**
 * The wheel section for `month` ('YYYY-MM') with day `selected` chosen and its `index`-th dream in the middle.
 * `notes`: day numbers that have a day-journal note.
 */
export function wheelHTML({ month, selected, index = 0 }, { notes = new Set() } = {}) {
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
    const noted = notes.has(day);
    const again = day === selected && list.length ? '. Press again to open the dream in the middle' : '';
    const what = `${list.length ? `${list.length} ${list.length === 1 ? 'dream' : 'dreams'}` : 'no dream'}${noted ? ', day note' : ''}${again}`;
    return `
      <button type="button" class="${cls}" style="--a:${angle}deg" data-wheel-day="${day}"
        aria-label="${esc(`${MONTHS[Number(month.slice(5, 7)) - 1]} ${ordinal(day)}: ${what}`)}" aria-pressed="${day === selected}" ${future ? 'disabled' : ''}>
        <span class="bw-dot">${list.length ? picture(list[0], 28, 'bw-dot-img') : ''}</span>
        ${list.length > 1 ? `<span class="bw-count">${list.length}</span>` : ''}
        ${noted ? '<span class="bw-note"></span>' : ''}
      </button>
      <span class="bw-label${day === todayN ? ' is-today' : ''}${list.length ? ' is-dream' : ''}" style="--a:${angle}deg" aria-hidden="true">${ordinal(day)}</span>`;
  }).join('');

  return `
    <section class="bw" aria-labelledby="bw-title" data-wheel>
      <div class="bw-head">
        <button type="button" class="icon-btn bw-nav" data-wheel-prev aria-label="Previous month">${icons.back}</button>
        <div class="bw-head-text">
          <h2 class="bw-h2" id="bw-title" aria-live="polite">${esc(label)}</h2>
          <p class="bw-sub">${total ? `${total} ${total === 1 ? 'dream' : 'dreams'} on ${byDay.size} ${byDay.size === 1 ? 'day' : 'days'}` : 'No dreams this month yet'}</p>
        </div>
        <button type="button" class="icon-btn bw-nav bw-nav-next" data-wheel-next aria-label="Next month" ${current ? 'disabled' : ''}>${icons.back}</button>
      </div>
      <div class="bw-wheel" role="group" aria-label="${esc(`Dreams in ${label}`)}">
        ${ringsSVG(n)}
        ${days}
        ${centerHTML(month, selected, byDay.get(selected) || [], index)}
      </div>
    </section>`;
}
