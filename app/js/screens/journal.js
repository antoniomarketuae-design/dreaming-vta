// Journal: every dream, with search, a filter sheet, quick chips and a List / Calendar switch.
// Dreams are read through withDefaults(). They live only on this iPhone, and the screen says so honestly.
// The new layout (js/layout.js) adds two things, and only there: a Gallery view of the dreams' AI pictures,
// and each row's small chips show the dream's main symbols instead of its tags. The current layout is unchanged.
import { listDreams, withDefaults, localDay, SYMBOL_CATEGORIES, getSetting, setSetting } from '../store.js';
import { TAGS } from '../analyze.js';
import { nextTechnique } from '../progress.js';
import { esc, icons, relativeDay } from '../ui.js';
import { dreamArtURL } from '../dreamart.js';
import { hasVideo } from '../videos.js';
import { hasImage } from '../images.js';
import { symbolsOf } from '../symbols.js';
import { isNewLayout } from '../layout.js';
import { EXTRA_VIEWS } from './b/views/index.js';

const VIEW_KEY = 'dreaming.journal.view';
const NOTE_KEY = 'journalNoteHiddenAt'; // dream count when the "only on this iPhone" note was tucked away
const NOTE_RETURNS_AFTER = 20;          // ...it comes back after this many more dreams, as a backup reminder
const SYMBOL_LIMIT = 18;                // symbols shown in the filter sheet before "Show all"

const blankFilters = () => ({ kind: 'all', lucid: false, recurring: false, emotions: [], symbols: [], from: '', to: '' });

// Kept between visits so coming back from a dream returns to the same place.
let query = '';
let filters = blankFilters();
let cal = null; // { y, m (0-11), selected: 'YYYY-MM-DD' | null }
let thumbJob = 0;
let teardown = null;
let newLayout = false; // read at each render: Gallery view + main-symbol chips

const pad = (n) => String(n).padStart(2, '0');
const dayDate = (iso) => new Date(`${iso}T00:00:00`);
const norm = (s) => String(s ?? '').toLowerCase().trim();
const cap = (s) => { const t = String(s ?? '').trim(); return t ? t[0].toUpperCase() + t.slice(1) : ''; };
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const arr = (v) => (Array.isArray(v) ? v : []);

// 'gallery' and the extra views (b/views) exist only in the new layout; a saved one opens the list in the current one.
function getView() {
  let v = '';
  try { v = sessionStorage.getItem(VIEW_KEY) || ''; } catch {}
  if (v === 'calendar') return 'calendar';
  if (newLayout && (v === 'gallery' || EXTRA_VIEWS.some((x) => x.id === v))) return v;
  return 'list';
}
function setView(v) {
  try { sessionStorage.setItem(VIEW_KEY, v); } catch {}
}

function monthName(y, m) {
  return new Date(y, m, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

function hueFor(key) {
  if (TAGS[key]) return TAGS[key].hue;
  let h = 0;
  for (const c of key) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

// ---- Data ----

// One journal entry: the dream (with defaults) plus its emotions and symbols, i.e. what the user picked
// in the editor and the moods / symbols detected from the text, keyed in lower case.
function prepare(raw) {
  const d = withDefaults(raw);
  const emotions = new Map();
  const symbols = new Map();
  const add = (map, v) => { const k = norm(v); if (k && !map.has(k)) map.set(k, String(v).trim()); };
  for (const e of arr(d.emotions)) add(emotions, e);
  for (const c of SYMBOL_CATEGORIES) for (const s of arr(d.symbols[c])) add(symbols, s);
  for (const t of arr(d.tags)) {
    const tag = TAGS[t];
    if (tag) add(tag.kind === 'mood' ? emotions : symbols, tag.label);
  }
  const day = typeof d.date === 'string' ? d.date : '';
  const hay = [d.title, d.text, d.notes, ...emotions.values(), ...symbols.values()].join('\n').toLowerCase();
  return { d, day, emotions, symbols, hay };
}

const byNewest = (a, b) => b.day.localeCompare(a.day) || String(b.d.createdAt || '').localeCompare(String(a.d.createdAt || ''));

function activeCount(f) {
  return (f.kind !== 'all') + f.lucid + f.recurring + f.emotions.length + f.symbols.length + (f.from || f.to ? 1 : 0);
}

function matches(e, q, f) {
  if (q && !e.hay.includes(q)) return false;
  if (f.kind === 'nightmare' && e.d.kind !== 'nightmare') return false;
  if (f.kind === 'dream' && e.d.kind === 'nightmare') return false;
  if (f.lucid && !e.d.lucid) return false;
  if (f.recurring && !e.d.recurring) return false;
  if (f.emotions.length && !f.emotions.some((k) => e.emotions.has(k))) return false;
  if (f.symbols.length && !f.symbols.some((k) => e.symbols.has(k))) return false;
  if (f.from && e.day < f.from) return false;
  if (f.to && e.day > f.to) return false;
  return true;
}

// [{ key, label, n }] most frequent first
function tally(entries, field) {
  const m = new Map();
  for (const e of entries) {
    for (const [key, label] of e[field]) {
      const cur = m.get(key);
      if (cur) cur.n += 1;
      else m.set(key, { key, label, n: 1 });
    }
  }
  return [...m.values()].sort((a, b) => b.n - a.n || a.label.localeCompare(b.label));
}

// Options plus anything still selected that no dream carries any more, so it can be switched off.
function withSelected(opts, selected) {
  const have = new Set(opts.map((o) => o.key));
  return [...opts, ...selected.filter((k) => !have.has(k)).map((k) => ({ key: k, label: k, n: 0 }))];
}

function toggleIn(field, key) {
  const list = filters[field];
  filters[field] = list.includes(key) ? list.filter((k) => k !== key) : [...list, key];
}

// ---- Pieces ----

function headHTML() {
  return `
    <header class="jr-head">
      <h1 class="screen-title">Journal</h1>
      <a class="jr-add" href="#record" aria-label="Record a new dream">${icons.plus}<span>Dream</span></a>
    </header>`;
}

function emptyHTML() {
  return `
    <div class="jr">
      ${headHTML()}
      <div class="jr-empty glass">
        <div class="jr-empty-art" aria-hidden="true">
          ${icons.moon}<span class="jr-star jr-s1"></span><span class="jr-star jr-s2"></span><span class="jr-star jr-s3"></span>
        </div>
        <h2 class="jr-empty-title">Your journal is empty, for now</h2>
        <p class="muted">Write down any dream you still remember, from last night or from years ago.</p>
        <a class="btn" href="#record">${icons.plus}<span>Record a dream</span></a>
        <p class="jr-empty-note faint">Your dreams are kept only on this iPhone.</p>
      </div>
    </div>`;
}

function quickChipsHTML(emotionOpts) {
  const chips = [
    { id: 'nightmare', label: 'Nightmares', on: filters.kind === 'nightmare', icon: icons.flame },
    { id: 'lucid', label: 'Lucid', on: filters.lucid, icon: icons.star },
    { id: 'recurring', label: 'Recurring', on: filters.recurring, icon: icons.repeat },
    ...emotionOpts.slice(0, 3).map((o) => ({ id: `emotion:${o.key}`, label: cap(o.label), on: filters.emotions.includes(o.key) })),
  ];
  return chips.map((c) => `
    <button type="button" class="jr-qchip" data-quick="${esc(c.id)}" aria-pressed="${c.on}">${c.icon || ''}<span>${esc(c.label)}</span></button>`).join('');
}

function noteHTML(count) {
  const hiddenAt = getSetting(NOTE_KEY, null);
  if (Number.isFinite(hiddenAt) && count < hiddenAt + NOTE_RETURNS_AFTER) return '';
  return `
    <div class="jr-note glass">
      <span class="jr-note-icon" aria-hidden="true">${icons.info}</span>
      <div class="jr-note-body">
        <p class="jr-note-title">Kept only on this iPhone</p>
        <p class="jr-note-text">There is no account and no cloud copy. If this phone is lost or the app is removed, your dreams go with it.</p>
        <a class="jr-note-link" href="#profile">Export a backup in Settings${icons.chevronRight}</a>
      </div>
      <button type="button" class="jr-note-x" data-hide-note aria-label="Hide this note">${icons.close}</button>
    </div>`;
}

function nextHTML(count) {
  const t = nextTechnique(count);
  if (!t) return '';
  const deg = Math.round(Math.max(0, Math.min(1, t.progress || 0)) * 360);
  return `
    <a class="jr-next glass" href="#lucidity">
      <span class="jr-next-icon" aria-hidden="true">${icons.lucidity}</span>
      <span class="jr-next-body">
        <span class="jr-next-cap">Next technique</span>
        <span class="jr-next-name">${esc(t.name)}</span>
        <span class="jr-next-togo faint">${plural(t.toGo, 'dream')} to go</span>
      </span>
      <span class="jr-ring" style="--deg:${deg}deg" aria-hidden="true"></span>
    </a>`;
}

// New layout: the dream's three main symbols (from its interpretation first, then the user's, then the detected ones).
function mainSymbols(e) {
  if (!e.main) e.main = symbolsOf(e.d).slice(0, 3).map((s) => s.name);
  return e.main;
}

function rowHTML(e) {
  const d = e.d;
  const title = String(d.title || '').trim() || 'Untitled dream';
  const first = String(d.text || '').split('\n').map((s) => s.trim()).find(Boolean) || '';
  const night = d.kind === 'nightmare';
  const chips = newLayout
    ? mainSymbols(e).map((name) => `<span class="chip">${esc(name)}</span>`).join('')
    : [
      ...[...e.emotions].slice(0, 2).map(([k, label]) => `<span class="chip" style="--hue:${hueFor(k)}">${esc(cap(label))}</span>`),
      ...[...e.symbols].slice(0, 3).map(([, label]) => `<span class="chip">${esc(cap(label))}</span>`),
    ].slice(0, 3).join('');
  return `
    <a class="jr-row glass${night ? ' jr-row-night' : ''}" href="#dream/${encodeURIComponent(d.id)}">
      <span class="jr-thumb-wrap">
        <img class="jr-thumb" data-id="${esc(d.id)}" alt="" width="64" height="64" decoding="async">
        ${hasVideo(d) ? `<span class="video-mark" aria-hidden="true">${icons.play}</span>` : ''}
      </span>
      <div class="jr-row-body">
        <div class="jr-row-top">
          <span class="jr-row-title">${esc(title)}</span>
          ${d.lucid ? `<span class="star-mark" role="img" aria-label="Lucid">${icons.star}</span>` : ''}
        </div>
        <div class="jr-row-meta">
          <span>${esc(relativeDay(e.day))}</span>
          ${night ? '<span class="jr-kind">Nightmare</span>' : ''}
          ${d.recurring ? `<span class="jr-rec" role="img" aria-label="Recurring">${icons.repeat}</span>` : ''}
        </div>
        ${first ? `<p class="jr-row-text muted">${esc(first)}</p>` : ''}
        ${chips ? `<div class="jr-row-chips">${chips}</div>` : ''}
      </div>
    </a>`;
}

function noMatchHTML(what = 'dreams') {
  const q = query.trim();
  return `
    <div class="jr-none glass">
      <p>${q ? `No ${what} match “${esc(q)}”${activeCount(filters) ? ' with these filters' : ''}.` : `No ${what} match these filters.`}</p>
      <button type="button" class="btn btn-ghost" data-clear-all>Show all dreams</button>
    </div>`;
}

function listHTML(shown, filtering) {
  if (!shown.length) return noMatchHTML();
  const groups = new Map();
  for (const e of shown) {
    const key = e.day.slice(0, 7);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
  }
  const months = [...groups.entries()].map(([key, items]) => {
    const [y, m] = key.split('-').map(Number);
    const label = y && m ? monthName(y, m - 1) : 'Undated';
    return `
      <section class="jr-month">
        <h2 class="section-title">${esc(label)} <span class="jr-count">${items.length}</span></h2>
        <div class="jr-rows">${items.map(rowHTML).join('')}</div>
      </section>`;
  }).join('');
  const end = filtering
    ? `${plural(shown.length, 'dream')} found.`
    : 'You have reached your first recorded dream.';
  return `${months}
    <div class="jr-end" aria-hidden="true">${icons.sparkle}</div>
    <p class="jr-end-text">${end}</p>`;
}

// ---- Gallery (new layout): the dreams' AI pictures, newest first, by month ----

function galleryTileHTML(e) {
  const d = e.d;
  const title = String(d.title || '').trim() || 'Untitled dream';
  return `
    <a class="jr-gal-tile" href="#dream/${encodeURIComponent(d.id)}" aria-label="${esc(`${title}, ${relativeDay(e.day)}${hasVideo(d) ? ', has a video' : ''}`)}">
      <img class="jr-gal-img" data-id="${esc(d.id)}" src="${esc(d.image.url)}" alt="" width="120" height="120" loading="lazy" decoding="async">
      ${hasVideo(d) ? `<span class="video-mark" aria-hidden="true">${icons.play}</span>` : ''}
    </a>`;
}

function galleryEmptyHTML(newest) {
  return `
    <div class="jr-gal-empty glass">
      <span class="jr-gal-empty-icon" aria-hidden="true">${icons.image}</span>
      <p class="jr-gal-empty-title">Pictures you create from your dreams appear here.</p>
      <p class="jr-gal-empty-hint">Open a dream and tap <b>Create AI image</b> to make one.</p>
      ${newest ? `<a class="btn btn-ghost" href="#dream/${encodeURIComponent(newest.d.id)}">Open your latest dream</a>` : ''}
    </div>`;
}

function galleryHTML(shown, filtering, all) {
  const pictured = shown.filter((e) => hasImage(e.d));
  if (!pictured.length) {
    return filtering && all.some((e) => hasImage(e.d)) ? noMatchHTML('pictures') : galleryEmptyHTML(all[0]);
  }
  const groups = new Map();
  for (const e of pictured) {
    const key = e.day.slice(0, 7);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
  }
  const months = [...groups.entries()].map(([key, items]) => {
    const [y, m] = key.split('-').map(Number);
    const label = y && m ? monthName(y, m - 1) : 'Undated';
    return `
      <section class="jr-month">
        <h2 class="section-title">${esc(label)} <span class="jr-count">${items.length}</span></h2>
        <div class="jr-gal-grid">${items.map(galleryTileHTML).join('')}</div>
      </section>`;
  }).join('');
  const end = filtering ? `${plural(pictured.length, 'picture')} found.` : `${plural(pictured.length, 'picture')} from your dreams.`;
  return `${months}
    <div class="jr-end" aria-hidden="true">${icons.sparkle}</div>
    <p class="jr-end-text">${end}</p>`;
}

function weekdayInitials() {
  const monday = new Date(2024, 0, 1); // a Monday
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d.toLocaleDateString(undefined, { weekday: 'narrow' });
  });
}

function calendarHTML(byDay, filtering) {
  const { y, m, selected } = cal;
  const today = localDay();
  const lead = (new Date(y, m, 1).getDay() + 6) % 7; // Monday first
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const prefix = `${y}-${pad(m + 1)}`;
  let inMonth = 0;

  const cells = [];
  for (let i = 0; i < lead; i++) cells.push('<span class="jr-cell jr-cell-blank" aria-hidden="true"></span>');
  for (let day = 1; day <= daysInMonth; day++) {
    const iso = `${prefix}-${pad(day)}`;
    const list = byDay.get(iso) || [];
    const cls = ['jr-cell'];
    if (iso === today) cls.push('jr-today');
    if (!list.length) {
      cells.push(`<span class="${cls.join(' ')}"><span class="jr-num">${day}</span></span>`);
      continue;
    }
    inMonth += list.length;
    cls.push('jr-has');
    if (iso === selected) cls.push('jr-selected');
    const lucid = list.some((e) => e.d.lucid);
    const night = list.some((e) => e.d.kind === 'nightmare');
    const tone = (e) => (e.d.kind === 'nightmare' ? ' jr-ember' : e.d.lucid ? ' jr-gold' : '');
    const marks = list.length > 3
      ? `<span class="jr-dots"><span class="jr-many${night ? ' jr-ember' : lucid ? ' jr-gold' : ''}">${list.length}</span></span>`
      : `<span class="jr-dots">${list.map((e) => `<span class="jr-dot${tone(e)}"></span>`).join('')}</span>`;
    const label = `${dayDate(iso).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}, ${plural(list.length, 'dream')}${lucid ? ', lucid' : ''}${night ? ', nightmare' : ''}`;
    cells.push(`<button type="button" class="${cls.join(' ')}" data-day="${iso}" aria-label="${esc(label)}" aria-pressed="${iso === selected}">
      <span class="jr-num">${day}</span>${marks}</button>`);
  }

  const picked = selected && selected.startsWith(prefix) ? (byDay.get(selected) || []) : [];
  let below;
  if (picked.length) {
    below = `
      <h2 class="section-title">${esc(relativeDay(selected))}</h2>
      <div class="jr-rows">${picked.map(rowHTML).join('')}</div>`;
  } else if (inMonth) {
    below = '<p class="jr-hint faint">Tap a glowing night to see its dreams.</p>';
  } else {
    below = `<p class="jr-hint faint">${filtering ? 'No matching dreams this month.' : 'No dreams recorded this month.'}</p>`;
  }

  return `
    <div class="jr-cal glass">
      <div class="jr-cal-head">
        <button type="button" class="icon-btn jr-nav" data-cal="prev" aria-label="Previous month">${icons.back}</button>
        <h2 class="jr-cal-month">${esc(monthName(y, m))}</h2>
        <button type="button" class="icon-btn jr-nav" data-cal="next" aria-label="Next month">${icons.chevronRight}</button>
      </div>
      <div class="jr-grid jr-weekdays" aria-hidden="true">${weekdayInitials().map((w) => `<span>${esc(w)}</span>`).join('')}</div>
      <div class="jr-grid">${cells.join('')}</div>
      <div class="jr-legend" aria-hidden="true">
        <span><i class="jr-dot"></i>Dream</span><span><i class="jr-dot jr-gold"></i>Lucid</span><span><i class="jr-dot jr-ember"></i>Nightmare</span>
      </div>
    </div>
    <div class="jr-daylist">${below}</div>`;
}

function sheetHTML(emotionOpts, symbolOpts, showAllSymbols) {
  const f = filters;
  const today = localDay();
  const typeBtn = (v, label) => `<button type="button" data-type="${v}" aria-pressed="${f.kind === v}">${label}</button>`;
  const flag = (k, label, icon) => `<button type="button" class="jr-opt" data-flag="${k}" aria-pressed="${f[k]}">${icon}<span>${label}</span></button>`;
  const opt = (field, o) => `<button type="button" class="jr-opt" data-opt="${field}" data-key="${esc(o.key)}" aria-pressed="${f[field].includes(o.key)}"><span>${esc(cap(o.label))}</span>${o.n ? `<span class="jr-opt-n">${o.n}</span>` : ''}</button>`;
  const emo = withSelected(emotionOpts, f.emotions);
  const sym = withSelected(symbolOpts, f.symbols);
  const symShown = showAllSymbols ? sym : sym.filter((o, i) => i < SYMBOL_LIMIT || f.symbols.includes(o.key));
  const more = sym.length > symShown.length
    ? `<button type="button" class="jr-opt jr-opt-more" data-more-symbols>Show all ${sym.length}</button>` : '';

  return `
    <div class="jr-sheet-backdrop" data-close-sheet></div>
    <div class="jr-sheet-panel">
      <div class="jr-sheet-grab" aria-hidden="true"></div>
      <div class="jr-sheet-head">
        <h2 id="jr-sheet-title">Filters</h2>
        <button type="button" class="icon-btn jr-sheet-close" data-close-sheet aria-label="Close filters">${icons.close}</button>
      </div>
      <div class="jr-sheet-scroll">
        <section class="jr-sheet-sec">
          <h3 class="jr-sheet-label">Type</h3>
          <div class="jr-type" role="group" aria-label="Type">
            ${typeBtn('all', 'All')}${typeBtn('dream', 'Dreams')}${typeBtn('nightmare', 'Nightmares')}
          </div>
        </section>
        <section class="jr-sheet-sec">
          <h3 class="jr-sheet-label">Only show</h3>
          <div class="jr-opts">${flag('lucid', 'Lucid dreams', icons.star)}${flag('recurring', 'Recurring dreams', icons.repeat)}</div>
        </section>
        <section class="jr-sheet-sec">
          <h3 class="jr-sheet-label">Emotions</h3>
          ${emo.length
            ? `<p class="jr-sheet-hint">A dream matches if it has any one you pick.</p><div class="jr-opts">${emo.map((o) => opt('emotions', o)).join('')}</div>`
            : '<p class="jr-sheet-none">No emotions noted in your dreams yet.</p>'}
        </section>
        <section class="jr-sheet-sec">
          <h3 class="jr-sheet-label">Symbols</h3>
          ${sym.length
            ? `<p class="jr-sheet-hint">People, places, objects and themes from your dreams.</p><div class="jr-opts">${symShown.map((o) => opt('symbols', o)).join('')}${more}</div>`
            : '<p class="jr-sheet-none">No symbols noted in your dreams yet.</p>'}
        </section>
        <section class="jr-sheet-sec">
          <h3 class="jr-sheet-label">Date range</h3>
          <div class="jr-dates">
            <label><span>From</span><input class="field jr-date" type="date" data-date="from" value="${esc(f.from)}" max="${esc(f.to || today)}"></label>
            <label><span>To</span><input class="field jr-date" type="date" data-date="to" value="${esc(f.to)}" ${f.from ? `min="${esc(f.from)}"` : ''} max="${esc(today)}"></label>
          </div>
        </section>
      </div>
      <div class="jr-sheet-foot">
        <button type="button" class="btn btn-ghost" data-sheet-clear>Clear all</button>
        <button type="button" class="btn" data-close-sheet data-sheet-count>Show dreams</button>
      </div>
    </div>`;
}

// Paints thumbnails a few at a time so a long journal still opens instantly.
function fillThumbs(container, byId) {
  const job = ++thumbJob;
  const imgs = [...container.querySelectorAll('img.jr-thumb[data-id]:not([src])')];
  let i = 0;
  const step = () => {
    if (job !== thumbJob || !container.isConnected) return;
    const end = performance.now() + 10;
    while (i < imgs.length && performance.now() < end) {
      const img = imgs[i++];
      let url = '';
      try { url = dreamArtURL(byId.get(img.dataset.id), 64) || ''; } catch {}
      if (url) img.src = url;
    }
    if (i < imgs.length) requestAnimationFrame(step);
  };
  step();
}

// ---- Screen ----

export default {
  id: 'journal',
  label: 'Journal',
  icon: icons.journal,

  render(el, ctx) {
    teardown?.();
    teardown = null;
    thumbJob += 1;
    newLayout = isNewLayout();

    const entries = listDreams().map(prepare).sort(byNewest);
    if (!entries.length) {
      el.innerHTML = emptyHTML();
      return;
    }
    const byId = new Map(entries.map((e) => [e.d.id, e.d]));
    const emotionOpts = tally(entries, 'emotions');
    const symbolOpts = tally(entries, 'symbols');
    if (!cal) {
      const now = new Date();
      const today = localDay(now);
      cal = { y: now.getFullYear(), m: now.getMonth(), selected: entries.some((e) => e.day === today) ? today : null };
    }
    let view = getView();
    let extra = null; // the extra view (b/views) drawn in the body, if any
    let showAllSymbols = false;
    let current = [];

    el.innerHTML = `
      <div class="jr">
        ${headHTML()}
        <div class="jr-search-wrap">
          ${icons.search}
          <input class="field jr-search" type="search" placeholder="Search your dreams" aria-label="Search dreams"
            value="${esc(query)}" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" enterkeyhint="search">
          <button type="button" class="jr-search-clear" data-clear-search aria-label="Clear search" ${query ? '' : 'hidden'}>${icons.close}</button>
        </div>
        <div class="jr-filterbar">
          <button type="button" class="jr-filter-btn" data-open-filters aria-haspopup="dialog">${icons.filter}<span>Filters</span><span class="jr-badge" hidden></span></button>
          <div class="jr-chips" role="group" aria-label="Quick filters"></div>
        </div>
        <div class="jr-active" hidden></div>
        <div class="jr-body"></div>
        <div class="jr-seg${newLayout ? ' jr-seg-many' : ''}" role="group" aria-label="View">
          <button type="button" data-view="list" aria-pressed="${view === 'list'}">${icons.list}<span>List</span></button>
          <button type="button" data-view="calendar" aria-pressed="${view === 'calendar'}">${icons.calendar}<span>Calendar</span></button>
          ${newLayout ? `<button type="button" data-view="gallery" aria-pressed="${view === 'gallery'}">${icons.image}<span>Gallery</span></button>
          ${EXTRA_VIEWS.map((x) => `<button type="button" data-view="${x.id}" aria-pressed="${view === x.id}">${x.icon}<span>${esc(x.label)}</span></button>`).join('')}` : ''}
        </div>
        <div class="jr-sheet" role="dialog" aria-modal="true" aria-labelledby="jr-sheet-title" hidden></div>
      </div>`;

    const root = el.querySelector('.jr');
    const head = root.querySelector('.jr-head');
    const input = root.querySelector('.jr-search');
    const clearBtn = root.querySelector('.jr-search-clear');
    const filterBtn = root.querySelector('.jr-filter-btn');
    const badge = root.querySelector('.jr-badge');
    const chipsEl = root.querySelector('.jr-chips');
    const activeEl = root.querySelector('.jr-active');
    const body = root.querySelector('.jr-body');
    const sheet = root.querySelector('.jr-sheet');

    const isFiltering = () => Boolean(query.trim()) || activeCount(filters) > 0;

    const paintControls = () => {
      const n = activeCount(filters);
      badge.hidden = !n;
      badge.textContent = String(n);
      filterBtn.dataset.on = String(n > 0);
      filterBtn.setAttribute('aria-label', n ? `Filters, ${n} active` : 'Filters');
      const left = chipsEl.scrollLeft;
      chipsEl.innerHTML = quickChipsHTML(emotionOpts);
      chipsEl.scrollLeft = left;
      activeEl.hidden = !n;
      activeEl.innerHTML = n
        ? `<span>${plural(n, 'filter')} on · ${current.length} of ${plural(entries.length, 'dream')}</span><button type="button" data-clear-filters>Clear</button>`
        : '';
    };

    const paintBody = () => {
      const filtering = isFiltering();
      try { extra?.destroy?.(); } catch {}
      extra = null;
      root.dataset.view = view;
      const xv = EXTRA_VIEWS.find((x) => x.id === view);
      if (xv) {
        body.innerHTML = '<div class="jr-xview"></div>';
        extra = xv;
        try {
          xv.render(body.firstElementChild, {
            dreams: current.map((e) => e.d), all: entries.map((e) => e.d), filtering, navigate: (h) => ctx?.navigate(h),
          });
        } catch (err) {
          console.error(err);
          body.innerHTML = '<p class="muted" style="padding:24px 4px">This view could not be drawn.</p>';
        }
        return;
      }
      if (view === 'list') {
        body.innerHTML = (filtering ? '' : noteHTML(entries.length) + nextHTML(entries.length)) + listHTML(current, filtering);
      } else if (view === 'gallery') {
        body.innerHTML = galleryHTML(current, filtering, entries);
      } else {
        const byDay = new Map();
        for (const e of current) {
          if (!byDay.has(e.day)) byDay.set(e.day, []);
          byDay.get(e.day).push(e);
        }
        body.innerHTML = calendarHTML(byDay, filtering);
      }
      fillThumbs(body, byId);
    };

    const updateSheetCount = () => {
      const btn = sheet.querySelector('[data-sheet-count]');
      if (btn) btn.textContent = current.length ? `Show ${plural(current.length, 'dream')}` : 'No dreams match';
    };

    const refresh = () => {
      const q = query.trim().toLowerCase();
      current = entries.filter((e) => matches(e, q, filters));
      paintControls();
      paintBody();
      updateSheetCount();
    };

    const paintSheet = () => {
      const keep = sheet.querySelector('.jr-sheet-scroll')?.scrollTop || 0;
      sheet.innerHTML = sheetHTML(emotionOpts, symbolOpts, showAllSymbols);
      sheet.querySelector('.jr-sheet-scroll').scrollTop = keep;
      updateSheetCount();
    };

    const openSheet = () => {
      showAllSymbols = false;
      sheet.innerHTML = '';
      paintSheet();
      sheet.hidden = false;
      sheet.querySelector('.jr-sheet-close')?.focus({ preventScroll: true });
    };

    const closeSheet = () => {
      if (sheet.hidden) return;
      sheet.hidden = true;
      sheet.innerHTML = '';
      filterBtn.focus({ preventScroll: true });
    };

    const resetSearch = () => {
      query = '';
      input.value = '';
      clearBtn.hidden = true;
    };

    root.addEventListener('input', (ev) => {
      if (ev.target !== input) return;
      query = input.value;
      clearBtn.hidden = !query;
      refresh();
    });

    root.addEventListener('change', (ev) => {
      const date = ev.target.closest('[data-date]');
      if (!date) return;
      filters[date.dataset.date] = date.value || '';
      if (filters.from && filters.to && filters.from > filters.to) [filters.from, filters.to] = [filters.to, filters.from];
      // Update the inputs in place: re-rendering them would close the iOS date picker.
      const from = sheet.querySelector('[data-date="from"]');
      const to = sheet.querySelector('[data-date="to"]');
      if (from && to) {
        if (from.value !== filters.from) from.value = filters.from;
        if (to.value !== filters.to) to.value = filters.to;
        from.max = filters.to || localDay();
        if (filters.from) to.min = filters.from;
        else to.removeAttribute('min');
      }
      refresh();
    });

    root.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' && ev.target === input) input.blur();
      if (ev.key === 'Escape' && !sheet.hidden) closeSheet();
    });

    root.addEventListener('click', (ev) => {
      const hit = (sel) => ev.target.closest(sel);
      let b;
      if ((b = hit('[data-view]'))) {
        if (b.dataset.view === view) return;
        view = b.dataset.view;
        setView(view);
        for (const v of root.querySelectorAll('[data-view]')) v.setAttribute('aria-pressed', String(v.dataset.view === view));
        b.scrollIntoView?.({ block: 'nearest', inline: 'center', behavior: 'smooth' });
        paintBody();
      } else if ((b = hit('[data-quick]'))) {
        const id = b.dataset.quick;
        if (id === 'nightmare') filters.kind = filters.kind === 'nightmare' ? 'all' : 'nightmare';
        else if (id === 'lucid') filters.lucid = !filters.lucid;
        else if (id === 'recurring') filters.recurring = !filters.recurring;
        else if (id.startsWith('emotion:')) toggleIn('emotions', id.slice(8));
        refresh();
      } else if (hit('[data-open-filters]')) {
        openSheet();
      } else if (hit('[data-close-sheet]')) {
        closeSheet();
      } else if (hit('[data-sheet-clear]')) {
        filters = blankFilters();
        paintSheet();
        refresh();
      } else if ((b = hit('[data-type]'))) {
        filters.kind = b.dataset.type;
        for (const t of sheet.querySelectorAll('[data-type]')) t.setAttribute('aria-pressed', String(t.dataset.type === filters.kind));
        refresh();
      } else if ((b = hit('[data-flag]'))) {
        const k = b.dataset.flag;
        filters[k] = !filters[k];
        b.setAttribute('aria-pressed', String(filters[k]));
        refresh();
      } else if ((b = hit('[data-opt]'))) {
        toggleIn(b.dataset.opt, b.dataset.key);
        b.setAttribute('aria-pressed', String(filters[b.dataset.opt].includes(b.dataset.key)));
        refresh();
      } else if (hit('[data-more-symbols]')) {
        showAllSymbols = true;
        paintSheet();
      } else if (hit('[data-clear-filters]')) {
        filters = blankFilters();
        refresh();
      } else if (hit('[data-clear-all]')) {
        filters = blankFilters();
        resetSearch();
        refresh();
      } else if (hit('[data-clear-search]')) {
        resetSearch();
        refresh();
        input.focus({ preventScroll: true });
      } else if (hit('[data-hide-note]')) {
        setSetting(NOTE_KEY, entries.length);
        paintBody();
      } else if ((b = hit('[data-cal]'))) {
        const d = new Date(cal.y, cal.m + (b.dataset.cal === 'next' ? 1 : -1), 1);
        cal.y = d.getFullYear();
        cal.m = d.getMonth();
        paintBody();
      } else if ((b = hit('[data-day]'))) {
        cal.selected = cal.selected === b.dataset.day ? null : b.dataset.day;
        paintBody();
        if (cal.selected) body.querySelector('.jr-daylist')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    });

    // Gallery: a picture that can't load (offline, removed) shows the dream's painting instead.
    // 'error' doesn't bubble, so this listens in the capture phase.
    if (newLayout) {
      root.addEventListener('error', (ev) => {
        const img = ev.target;
        if (!img?.classList?.contains('jr-gal-img') || img.dataset.fallback) return;
        const d = byId.get(img.dataset.id);
        img.dataset.fallback = '1';
        let url = '';
        try { url = d ? dreamArtURL({ ...d, image: null }, 120) || '' : ''; } catch {}
        if (url) img.src = url;
      }, true);
    }

    // The title bar stays pinned; it gains a frosted backing once the list scrolls under it.
    const onScroll = () => head.classList.toggle('jr-stuck', window.scrollY > 6);
    window.addEventListener('scroll', onScroll, { passive: true });
    teardown = () => {
      window.removeEventListener('scroll', onScroll);
      try { extra?.destroy?.(); } catch {}
      extra = null;
    };
    onScroll();

    refresh();
  },

  destroy() {
    thumbJob += 1;
    teardown?.();
    teardown = null;
  },
};
