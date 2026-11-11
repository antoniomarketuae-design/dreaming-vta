// New layout: Home tab, strictly as the owner's mind map (video/DREAMS APP.pdf, "HOME TAB"):
// date (with a greeting) · record dream button · the 3 newest dreams, each with its name, date and symbols (a moon-gold
// date tile on the left) · "Load more dreams" (3 more each tap, in place) · "What you dream about" (recurring symbols of
// the last 30 days; tap one for its meaning). Repaints itself when dreams change.
// (The dream wheel that was here in v15 is now the Calendar tab; the day journal lives in the Calendar too.)
import { listDreams, getDream, localDay, getProfile, onChange } from '../../store.js';
import { symbolsOf, recurringSymbols, NO_MEANING, dreamDay } from '../../symbols.js';
import { esc, greeting, formatLongDate, icons } from '../../ui.js';

const FIRST = 3;     // dreams shown at first
const STEP = 3;      // ...and how many more each "Load more" adds
const TOP_SYMBOLS = 5;

// Screen state. Reset each time Home opens; kept while it repaints for data changes.
let shown = FIRST;
let expanded = null; // key of the symbol whose meaning is open
let cleanup = null;

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const titleOf = (d) => String(d?.title || '').trim() || 'Untitled dream';
const dreamHref = (d) => `#dream/${encodeURIComponent(d.id)}`;
const norm = (s) => String(s || '').toLowerCase().trim();

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

// ---------- 2. record ----------

const actionHTML = () => `
  <div class="bh-action">
    <a class="btn bh-record" href="#record">${icons.plus}<span>Record a dream</span></a>
  </div>`;

// ---------- 3. recent dreams + Load more ----------

/** The date tile: day number, short month, and the year when it isn't this year. */
function dateTile(day) {
  const date = new Date(`${day}T12:00:00`);
  if (Number.isNaN(date.getTime())) return '<span class="bh-tile" aria-hidden="true"></span>';
  const month = date.toLocaleDateString(undefined, { month: 'short' }).replace('.', '');
  const year = date.getFullYear() !== new Date().getFullYear() ? `<span class="bh-tile-y">${date.getFullYear()}</span>` : '';
  return `
    <span class="bh-tile${day === localDay() ? ' bh-tile-today' : ''}" aria-hidden="true">
      <span class="bh-tile-d">${date.getDate()}</span>
      <span class="bh-tile-m">${esc(month)}</span>${year}
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

function moreHTML(total) {
  const left = total - shown;
  if (left <= 0) return '';
  return `
    <button type="button" class="btn btn-ghost bh-more" data-more>
      <span>Load more dreams</span><span class="bh-more-n">${left} left</span>
    </button>`;
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

function meaningHTML(s) {
  if (s.meaning) {
    const from = s.meaningFrom ? getDream(s.meaningFrom) : null;
    const heading = s.title && norm(s.title) !== s.key ? `<p class="bh-sym-mtitle">${esc(s.title)}</p>` : '';
    return `
      ${heading}
      <p class="bh-sym-text">${esc(s.meaning)}</p>
      ${from ? `<a class="bh-sym-link" href="${dreamHref(from)}"><span>From “${esc(titleOf(from))}”</span>${icons.chevronRight}</a>` : ''}`;
  }
  const newest = getDream(s.dreamIds[0]);
  return `
    <p class="bh-sym-text bh-sym-none">${esc(NO_MEANING)}</p>
    ${newest ? `<a class="bh-sym-link" href="${dreamHref(newest)}"><span>Open “${esc(titleOf(newest))}”</span>${icons.chevronRight}</a>` : ''}`;
}

function symRowHTML(s, i, total) {
  const open = s.key === expanded;
  const pct = total ? Math.max(6, Math.round((s.count / total) * 100)) : 0;
  return `
    <li class="bh-sym-item${open ? ' bh-open' : ''}">
      <button type="button" class="bh-sym-row" data-sym="${esc(s.key)}" aria-expanded="${open}" aria-controls="bh-sym-${i}">
        <span class="bh-sym-glyph" aria-hidden="true">${icons.sparkle}</span>
        <span class="bh-sym-main">
          <span class="bh-sym-name">${esc(s.name)}</span>
          <span class="bh-sym-bar" aria-hidden="true"><span style="width:${pct}%"></span></span>
        </span>
        <span class="bh-sym-count">${esc(plural(s.count, 'dream'))}</span>
        <span class="bh-sym-chev" aria-hidden="true">${icons.chevronRight}</span>
      </button>
      <div class="bh-sym-meaning" id="bh-sym-${i}" ${open ? '' : 'hidden'}>${meaningHTML(s)}</div>
    </li>`;
}

function symbolsHTML(dreams) {
  let body;
  if (!dreams.length) {
    body = '<p class="bh-sym-empty">Once you record a few dreams, the people, places and things that keep coming back will gather here.</p>';
  } else {
    const sum = symbolSummary(dreams);
    if (!sum.list.length) {
      body = '<p class="bh-sym-empty">No symbols yet. Add people, places or things to a dream, or analyze one, and they will gather here.</p>';
    } else {
      if (expanded && !sum.list.some((s) => s.key === expanded)) expanded = null;
      body = `
        <p class="bh-sym-lead">${leadSentence(sum)}</p>
        <ul class="bh-sym-list">${sum.list.map((s, i) => symRowHTML(s, i, sum.total)).join('')}</ul>`;
    }
  }
  return `
    <section class="bh-section" aria-labelledby="bh-sym-title">
      <h2 class="bh-h2" id="bh-sym-title">What you dream about</h2>
      <div class="glass bh-sym">${body}</div>
    </section>`;
}

// ---------- screen ----------

function screenHTML() {
  const dreams = listDreams();
  return `
    ${headerHTML(new Date())}
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
    expanded = null;

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

    // One symbol open at a time.
    const toggleSymbol = (btn) => {
      const key = btn.dataset.sym;
      expanded = expanded === key ? null : key;
      for (const b of root.querySelectorAll('[data-sym]')) {
        const open = b.dataset.sym === expanded;
        b.setAttribute('aria-expanded', String(open));
        b.closest('.bh-sym-item')?.classList.toggle('bh-open', open);
        const panel = root.querySelector(`#${b.getAttribute('aria-controls')}`);
        if (panel) panel.hidden = !open;
      }
    };

    // "Load more": adds the next rows in place and keeps the focus on the button (or the first new row).
    const loadMore = (btn) => {
      const dreams = listDreams();
      const list = root.querySelector('.bh-list');
      if (!list) return;
      const from = shown;
      shown = Math.min(dreams.length, shown + STEP);
      list.insertAdjacentHTML('beforeend', dreams.slice(from, shown).map(rowHTML).join(''));
      for (const li of [...list.children].slice(from)) li.classList.add('bh-new');
      const html = moreHTML(dreams.length).trim();
      if (html) {
        btn.outerHTML = html;
        root.querySelector('[data-more]')?.focus({ preventScroll: true });
      } else {
        btn.remove();
        list.children[from]?.querySelector('a')?.focus({ preventScroll: true });
      }
    };

    // Listeners live on our own root (the screen element is shared with other screens).
    root.addEventListener('click', (e) => {
      let b;
      if ((b = e.target.closest('[data-more]'))) loadMore(b);
      else if ((b = e.target.closest('[data-sym]'))) toggleSymbol(b);
    });

    cleanup = onChange(repaint);
  },

  destroy() {
    cleanup?.();
    cleanup = null;
  },
};
