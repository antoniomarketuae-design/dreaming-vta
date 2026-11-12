// New layout: Home tab, as the owner's mind map (video/DREAMS APP.pdf, "HOME TAB") and the team's review:
// date (with a greeting) · this month's moon cycle (compact card, moon.js) · record dream button · recent dreams, compact
// rows: name, date (a moon-gold tile on the left: weekday, day, month) and symbols, the 5 newest first, "Load more
// dreams" adds 5 more each tap, in place · "What you dream about": one sentence on what keeps coming back, then up to 8 symbol
// chips with counts (last 30 days); tapping one opens its meaning (symbolsheet.js). Repaints itself when dreams change.
// (The dream wheel that was here in v15 is now the Calendar tab; the day journal lives in the Calendar too.)
import { listDreams, localDay, getProfile, onChange } from '../../store.js';
import { symbolsOf, recurringSymbols, dreamDay } from '../../symbols.js';
import { esc, greeting, formatLongDate, icons } from '../../ui.js';
import { moonCardHTML } from './moon.js';
import { openSymbolSheet, closeSymbolSheet } from './symbolsheet.js';

const FIRST = 5;     // dreams shown at first
const STEP = 5;      // ...and how many more each "Load more" adds
const TOP_SYMBOLS = 8;

// Screen state. Reset each time Home opens; kept while it repaints for data changes.
let shown = FIRST;
let cleanup = null;

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const titleOf = (d) => String(d?.title || '').trim() || 'Untitled dream';
const dreamHref = (d) => `#dream/${encodeURIComponent(d.id)}`;

// Crescent moon, a few stars and a soft cloud: the empty-journal picture.
const EMPTY_ART = `
  <svg class="bh-empty-art" viewBox="0 0 220 130" aria-hidden="true">
    <defs>
      <radialGradient id="bh-glow" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stop-color="#ffd98a" stop-opacity="0.32"/>
        <stop offset="100%" stop-color="#ffd98a" stop-opacity="0"/>
      </radialGradient>
      <linearGradient id="bh-moon" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#fff0c8"/>
        <stop offset="100%" stop-color="#ffd98a"/>
      </linearGradient>
      <linearGradient id="bh-cloud" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#c9b6ff" stop-opacity="0.5"/>
        <stop offset="100%" stop-color="#ff9f8f" stop-opacity="0.3"/>
      </linearGradient>
      <mask id="bh-crescent">
        <rect width="220" height="130" fill="#fff"/>
        <circle cx="126" cy="44" r="27" fill="#000"/>
      </mask>
    </defs>
    <circle cx="110" cy="56" r="52" fill="url(#bh-glow)"/>
    <circle cx="110" cy="56" r="29" fill="url(#bh-moon)" mask="url(#bh-crescent)"/>
    <g fill="#f0eaff">
      <circle cx="38" cy="26" r="1.5" opacity="0.8"/>
      <circle cx="64" cy="58" r="1" opacity="0.6"/>
      <circle cx="176" cy="22" r="1.3" opacity="0.75"/>
      <circle cx="192" cy="62" r="1" opacity="0.5"/>
      <circle cx="24" cy="80" r="1" opacity="0.45"/>
    </g>
    <path d="M162 38l1.5 3.7 3.7 1.5-3.7 1.5-1.5 3.7-1.5-3.7-3.7-1.5 3.7-1.5z" fill="#ffd98a" opacity="0.9"/>
    <path class="bh-empty-cloud" fill="url(#bh-cloud)"
      d="M58 116c-10 0-16-6-16-13s6-13 15-13c3-10 12-16 22-16 10 0 18 5 22 13 3-2 6-3 10-3 10 0 17 7 17 16v3c6 1 11 6 11 13z"/>
  </svg>`;

// ---------- 1. greeting ----------

function headerHTML(now) {
  const name = String(getProfile()?.name ?? '').trim();
  const hello = name
    ? `${esc(greeting(now))}, <span class="bh-name">${esc(name)}</span>`
    : esc(greeting(now));
  return `
    <header class="bh-top">
      <h1 class="bh-greeting">${hello}</h1>
      <p class="bh-date">${esc(formatLongDate(now))}</p>
    </header>`;
}

// ---------- 2. moon cycle ----------

const moonHTML = (dreams) => `<div class="bh-moon">${moonCardHTML({ dreams, compact: true })}</div>`;

// ---------- 3. record ----------

const actionHTML = () => `
  <div class="bh-action">
    <a class="btn bh-record" href="#record">${icons.plus}<span>Record a dream</span></a>
  </div>`;

// ---------- 4. recent dreams + Load more ----------

/** The date tile: weekday, day number and short month (the year too when it isn't this year). */
function dateTile(day) {
  const date = new Date(`${day}T12:00:00`);
  if (Number.isNaN(date.getTime())) return '<span class="bh-tile" aria-hidden="true"></span>';
  const month = date.toLocaleDateString(undefined, { month: 'short' }).replace('.', '');
  const weekday = date.toLocaleDateString(undefined, { weekday: 'short' }).replace('.', '');
  const year = date.getFullYear() !== new Date().getFullYear() ? ` <span class="bh-tile-y">’${String(date.getFullYear()).slice(2)}</span>` : '';
  return `
    <span class="bh-tile${day === localDay() ? ' bh-tile-today' : ''}" aria-hidden="true">
      <span class="bh-tile-w">${esc(weekday)}</span>
      <span class="bh-tile-d">${date.getDate()}</span>
      <span class="bh-tile-m">${esc(month)}${year}</span>
    </span>`;
}

function longDate(day) {
  const date = new Date(`${day}T12:00:00`);
  if (Number.isNaN(date.getTime())) return '';
  const opts = { weekday: 'long', day: 'numeric', month: 'long' };
  if (date.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
  return date.toLocaleDateString(undefined, opts);
}

function rowHTML(d) {
  const day = dreamDay(d);
  const syms = symbolsOf(d).slice(0, 3);
  const label = [titleOf(d), longDate(day), syms.length ? `symbols: ${syms.map((x) => x.name).join(', ')}` : ''].filter(Boolean).join(', ');
  return `
    <li>
      <a class="glass bh-row" href="${dreamHref(d)}" aria-label="${esc(label)}">
        ${dateTile(day)}
        <span class="bh-row-body">
          <span class="bh-row-title">${esc(titleOf(d))}</span>
          ${syms.length
            ? `<span class="bh-chips">${syms.map((x) => `<span class="chip bh-chip">${esc(x.name)}</span>`).join('')}</span>`
            : '<span class="bh-row-none">No symbols yet</span>'}
        </span>
        <span class="bh-row-go" aria-hidden="true">${icons.chevronRight}</span>
      </a>
    </li>`;
}

/** "Load more dreams" while some are hidden, and "Show less" once more than the first ones show. */
function moreHTML(total) {
  const left = total - shown;
  const more = left > 0 ? `
      <button type="button" class="btn btn-ghost bh-more" data-more>
        <span>Load more dreams</span><span class="bh-more-n">${left} left</span>
      </button>` : '';
  const less = shown > FIRST ? `<button type="button" class="btn btn-ghost bh-less" data-less>Show less</button>` : '';
  return more || less ? `<div class="bh-more-row" data-more-row>${more}${less}</div>` : '';
}

function recentHTML(dreams) {
  return `
    <section class="bh-section" aria-labelledby="bh-recent-title">
      <h2 class="bh-h2" id="bh-recent-title">Recent dreams</h2>
      <ul class="bh-list">${dreams.slice(0, shown).map(rowHTML).join('')}</ul>
      ${moreHTML(dreams.length)}
    </section>`;
}

const emptyHTML = () => `
  <section class="glass bh-empty" aria-labelledby="bh-empty-title">
    ${EMPTY_ART}
    <h2 class="bh-empty-title" id="bh-empty-title">Your dream journal starts here</h2>
    <p class="bh-empty-text">Write down any dream you remember, from last night or long ago. Even a small fragment is worth keeping.</p>
  </section>`;

// ---------- 4. what you dream about ----------

/** Recurring symbols of the last 30 days (all time when that month is empty) and how many dreams they come from. */
function symbolSummary(dreams) {
  const since = localDay(new Date(Date.now() - 29 * 86400000)); // same window as recurringSymbols({ days: 30 })
  const recent = dreams.filter((d) => dreamDay(d) >= since);
  const month = recent.length ? recurringSymbols({ days: 30 }) : [];
  if (month.length) return { list: month.slice(0, TOP_SYMBOLS), total: recent.length, lately: true };
  return { list: recurringSymbols({ days: 0 }).slice(0, TOP_SYMBOLS), total: dreams.length, lately: false };
}

function leadSentence({ list, total, lately }) {
  const top = list[0];
  if (top.count < 2) {
    return lately
      ? 'Nothing has come back twice yet this month. Here is what turned up lately.'
      : 'Nothing has come back twice yet. Here is what turned up so far.';
  }
  const tied = list.filter((s) => s.count === top.count).slice(0, 2);
  const last = lately ? 'your last' : 'your';
  if (top.count === total) {
    const names = tied.map((s, i) => `<b>${esc(i ? s.key : s.name)}</b>`).join(' and ');
    return `${names} ${tied.length > 1 ? 'show' : 'shows'} up in every one of ${last} ${total} dreams.`;
  }
  const names = tied.map((s) => `<b>${esc(s.key)}</b>`).join(' and ');
  return `${lately ? 'Lately' : 'So far'} you dream most about ${names}: ${top.count} of ${last} ${plural(total, 'dream')}${tied.length > 1 ? ' each' : ''}.`;
}

/** A symbol chip with its count; tapping it opens the symbol's meaning. */
const chipHTML = (s) => `
  <li><button type="button" class="bh-schip" data-sym="${esc(s.key)}" data-name="${esc(s.name)}"
    aria-label="${esc(`${s.name}, in ${plural(s.count, 'dream')}. What it can mean`)}">
    <span class="bh-schip-name">${esc(s.name)}</span><span class="bh-schip-n" aria-hidden="true">${s.count}</span>
  </button></li>`;

function symbolsHTML(dreams) {
  let body;
  let meta = '';
  if (!dreams.length) {
    body = '<p class="bh-sym-empty">Once you record a few dreams, the people, places and things that keep coming back will gather here.</p>';
  } else {
    const sum = symbolSummary(dreams);
    if (!sum.list.length) {
      body = '<p class="bh-sym-empty">No symbols yet. Add people, places or things to a dream, or analyze one, and they will gather here.</p>';
    } else {
      meta = sum.lately ? 'Last 30 days' : 'All time';
      body = `
        <p class="bh-sym-lead">${leadSentence(sum)}</p>
        <ul class="bh-schips" aria-label="Symbols">${sum.list.map(chipHTML).join('')}</ul>`;
    }
  }
  return `
    <section class="bh-section" aria-labelledby="bh-sym-title">
      <div class="bh-head">
        <h2 class="bh-h2" id="bh-sym-title">What you dream about</h2>
        ${meta ? `<span class="bh-meta">${meta}</span>` : ''}
      </div>
      <div class="glass bh-sym">${body}</div>
    </section>`;
}

// ---------- screen ----------

function screenHTML() {
  const dreams = listDreams();
  return `
    ${headerHTML(new Date())}
    ${moonHTML(dreams)}
    ${actionHTML()}
    ${dreams.length ? recentHTML(dreams) : emptyHTML()}
    ${symbolsHTML(dreams)}`;
}

export default {
  id: 'home',
  label: 'Home',
  icon: icons.home,

  render(el, ctx) {
    cleanup?.();
    shown = FIRST;

    el.innerHTML = '<div class="bh"></div>';
    const root = el.firstElementChild;
    const paint = () => { root.innerHTML = screenHTML(); };
    paint();

    // Several changes in a row (e.g. an AI image landing) repaint once.
    let queued = false;
    const repaint = () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        if (root.isConnected) paint();
      });
    };

    // A symbol chip: its meaning in the shared sheet (library first, then the user's own interpretation and dreams).
    const navigate = (hash) => { if (ctx?.navigate) ctx.navigate(hash); else location.hash = hash; };
    const openSymbol = (btn) => openSymbolSheet({ key: btn.dataset.sym, name: btn.dataset.name, navigate });

    // "Load more": adds the next rows in place and keeps the focus on the button (or the first new row).
    const loadMore = (btn) => {
      const dreams = listDreams();
      const list = root.querySelector('.bh-list');
      if (!list) return;
      const from = shown;
      shown = Math.min(dreams.length, shown + STEP);
      list.insertAdjacentHTML('beforeend', dreams.slice(from, shown).map(rowHTML).join(''));
      for (const li of [...list.children].slice(from)) li.classList.add('bh-new');
      const row = root.querySelector('[data-more-row]');
      const html = moreHTML(dreams.length).trim();
      if (row) row.outerHTML = html;
      (root.querySelector('[data-more]') || list.children[from]?.querySelector('a'))?.focus({ preventScroll: true });
    };

    // "Show less": back to the first dreams, keeping the "Recent dreams" heading in view.
    const showLess = () => {
      shown = FIRST;
      paint();
      const head = root.querySelector('#bh-recent-title');
      if (head && head.getBoundingClientRect().top < 0) head.scrollIntoView({ block: 'start' });
      root.querySelector('[data-more]')?.focus({ preventScroll: true });
    };

    // Listeners live on our own root (the screen element is shared with other screens).
    root.addEventListener('click', (e) => {
      let b;
      if ((b = e.target.closest('[data-more]'))) loadMore(b);
      else if (e.target.closest('[data-less]')) showLess();
      else if ((b = e.target.closest('[data-sym]'))) openSymbol(b);
    });

    cleanup = onChange(repaint);
  },

  destroy() {
    cleanup?.();
    cleanup = null;
    closeSymbolSheet();
  },
};
