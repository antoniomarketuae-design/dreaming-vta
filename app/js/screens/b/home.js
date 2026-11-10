// New layout: Home tab, following the owner's structure.
// Greeting + date · big record button (+ voice) · the 3 newest dreams with their symbols (Load more adds 5 in place) ·
// "What you dream about" (recurring symbols of the last 30 days; tap one for its meaning) · "Your day" (today's day
// journal, which opens the Calendar's day sheet). Repaints itself when dreams or day notes change.
import { listDreams, getDream, localDay, getProfile, getDayNote, onChange } from '../../store.js';
import { symbolsOf, recurringSymbols, NO_MEANING, dreamDay, dreamType, DREAM_TYPES } from '../../symbols.js';
import { esc, greeting, formatLongDate, relativeDay, icons } from '../../ui.js';
import { dreamArtURL } from '../../dreamart.js';
import { hasVideo } from '../../videos.js';
import { openDaySheet, SUN } from './calendar.js';

const FIRST = 3;     // dreams shown at first
const STEP = 5;      // ...and how many more each "Load more" adds
const TOP_SYMBOLS = 5;
const SNIPPET = 120; // characters of today's note shown on the card

// Screen state. Reset each time Home opens; kept while it repaints for data changes.
let shown = FIRST;
let expanded = null; // key of the symbol whose meaning is open
let cleanup = null;

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const titleOf = (d) => String(d?.title || '').trim() || 'Untitled dream';
const dreamHref = (d) => `#dream/${encodeURIComponent(d.id)}`;
const norm = (s) => String(s || '').toLowerCase().trim();

// ---------- pictures ----------

/** The dream's picture (AI image or generated painting), or a soft gradient if it can't be drawn. */
function thumb(d, px) {
  let url = '';
  try { url = dreamArtURL(d, px) || ''; } catch {}
  if (url) return `<img class="bh-thumb-img" src="${esc(url)}" alt="" width="${px}" height="${px}" decoding="async">`;
  return `<span class="bh-thumb-img bh-thumb-fallback" style="--h:${(Number(d.seed) || 0) % 360}"></span>`;
}

const videoMark = (d) => (hasVideo(d) ? `<span class="video-mark" aria-hidden="true">${icons.play}</span>` : '');

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
    <a class="bh-voice" href="#record/voice" aria-label="Record a dream by voice">${icons.mic}</a>
  </div>`;

// ---------- 3. recent dreams + Load more ----------

function firstLine(text) {
  return String(text || '').split('\n').map((s) => s.trim()).find(Boolean) || '';
}

function rowHTML(d) {
  const type = dreamType(d);
  const typeLabel = type === 'general' ? '' : (DREAM_TYPES.find((t) => t.id === type)?.label || '');
  const syms = symbolsOf(d).slice(0, 3);
  const extra = syms.length
    ? `<span class="bh-chips">${syms.map((s) => `<span class="chip bh-chip">${esc(s.name)}</span>`).join('')}</span>`
    : (firstLine(d.text) ? `<span class="bh-row-text">${esc(firstLine(d.text))}</span>` : '');
  return `
    <li>
      <a class="glass bh-row${type === 'nightmare' ? ' bh-row-night' : ''}" href="${dreamHref(d)}">
        <span class="bh-thumb">${thumb(d, 60)}${videoMark(d)}</span>
        <span class="bh-row-body">
          <span class="bh-row-title">${esc(titleOf(d))}</span>
          <span class="bh-row-meta">
            <span>${esc(relativeDay(dreamDay(d)))}</span>
            ${typeLabel ? `<span class="bh-type bh-type-${type}">${esc(typeLabel)}</span>` : ''}
          </span>
          ${extra}
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
      <span>Load more</span><span class="bh-more-n">${left} left</span>
    </button>`;
}

function recentHTML(dreams) {
  return `
    <section class="bh-section" aria-labelledby="bh-recent-title">
      <div class="bh-head">
        <h2 class="bh-h2" id="bh-recent-title">Recent dreams</h2>
        ${dreams.length > FIRST ? '<a class="bh-see-all" href="#journal">See all</a>' : ''}
      </div>
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

// ---------- 5. your day ----------

/** First ~120 characters of the note, cut at a word, on one line. */
function snippet(text) {
  const flat = String(text || '').replace(/\s+/g, ' ').trim();
  if (flat.length <= SNIPPET) return flat;
  const cut = flat.slice(0, SNIPPET);
  const space = cut.lastIndexOf(' ');
  return `${(space > SNIPPET * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,.;:–-]+$/, '')}…`;
}

function dayHTML() {
  const note = getDayNote(localDay());
  const head = `
      <div class="bh-day-head">
        <span class="bh-day-icon" aria-hidden="true">${SUN}</span>
        <div class="bh-day-titles">
          <h2 class="bh-day-title" id="bh-day-title">Your day</h2>
          <p class="bh-day-sub">Today</p>
        </div>
        ${note ? `<button type="button" class="bh-day-edit" data-day-open>${icons.edit}<span>Edit</span></button>` : ''}
      </div>`;
  const body = note
    ? `<button type="button" class="bh-day-note" data-day-open aria-label="Edit today’s note: ${esc(snippet(note))}">${esc(snippet(note))}</button>`
    : `
      <p class="bh-day-prompt">What happened today? A few lines about events, people and feelings help you see what your dreams pick up.</p>
      <button type="button" class="btn btn-ghost bh-day-btn" data-day-open>${icons.edit}<span>Write about today</span></button>`;
  return `
    <section class="bh-section glass bh-day${note ? ' bh-filled' : ''}" aria-labelledby="bh-day-title">
      ${head}
      ${body}
    </section>`;
}

// ---------- screen ----------

function screenHTML() {
  const dreams = listDreams();
  return `
    ${headerHTML(new Date())}
    ${actionHTML()}
    ${dreams.length ? recentHTML(dreams) : emptyHTML()}
    ${symbolsHTML(dreams)}
    ${dayHTML()}`;
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

    // Listeners live on our own root (the screen element is shared with other screens).
    root.addEventListener('click', (e) => {
      let b;
      if ((b = e.target.closest('[data-more]'))) loadMore(b);
      else if ((b = e.target.closest('[data-sym]'))) toggleSymbol(b);
      else if (e.target.closest('[data-day-open]')) openDaySheet(localDay(), ctx, { focusNote: true });
    });

    const unsubscribe = onChange(repaint);
    window.addEventListener('dreaming:daynote', repaint);
    cleanup = () => {
      unsubscribe();
      window.removeEventListener('dreaming:daynote', repaint);
    };
  },

  destroy() {
    cleanup?.();
    cleanup = null;
  },
};
