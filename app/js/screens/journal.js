// Journal: every dream, as a searchable list grouped by month or as a month calendar.
import { listDreams, localDay } from '../store.js';
import { TAGS } from '../analyze.js';
import { esc, icons, relativeDay } from '../ui.js';
import { dreamArtURL } from '../dreamart.js';

const VIEW_KEY = 'dreaming.journal.view';

// Kept between visits so coming back from a dream returns to the same place.
let query = '';
let cal = null; // { y, m (0-11), selected: 'YYYY-MM-DD' | null }
let thumbJob = 0;
const artCache = new Map();

const pad = (n) => String(n).padStart(2, '0');
const dayDate = (iso) => new Date(`${iso}T00:00:00`);

function getView() {
  try { return sessionStorage.getItem(VIEW_KEY) === 'calendar' ? 'calendar' : 'list'; } catch { return 'list'; }
}
function setView(v) {
  try { sessionStorage.setItem(VIEW_KEY, v); } catch {}
}

function monthName(y, m) {
  return new Date(y, m, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

function sortDreams(list) {
  return list.sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.createdAt || '').localeCompare(a.createdAt || ''));
}

// ---- Shared dream row ----

function chipsFor(d, max = 2) {
  return (d.tags || []).filter((t) => TAGS[t]).slice(0, max)
    .map((t) => `<span class="chip" style="--hue:${TAGS[t].hue}">${esc(TAGS[t].label)}</span>`).join('');
}

function row(d) {
  const title = d.title || 'Untitled dream';
  const marks = [d.lucid && 'Lucid', d.recurring && 'Recurring'].filter(Boolean);
  const star = marks.length ? `<span class="star-mark" title="${marks.join(', ')}" aria-label="${marks.join(', ')}">${icons.star}</span>` : '';
  const chips = chipsFor(d);
  return `
    <a class="jr-row glass" href="#dream/${encodeURIComponent(d.id)}">
      <img class="jr-thumb" data-id="${esc(d.id)}" alt="" width="60" height="60" decoding="async">
      <div class="jr-row-body">
        <div class="jr-row-top">
          <span class="jr-row-title">${esc(title)}</span>${star}
        </div>
        <div class="jr-row-day faint">${esc(relativeDay(d.date))}</div>
        ${d.text ? `<p class="jr-row-text muted">${esc(d.text)}</p>` : ''}
        ${chips ? `<div class="jr-row-chips">${chips}</div>` : ''}
      </div>
    </a>`;
}

function artFor(d) {
  if (!d) return '';
  const key = `${d.id}:${d.seed}:${d.updatedAt || ''}`;
  if (!artCache.has(key)) {
    let url = '';
    try { url = dreamArtURL(d, 60) || ''; } catch {}
    artCache.set(key, url);
  }
  return artCache.get(key);
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
      const url = artFor(byId.get(img.dataset.id));
      if (url) img.src = url;
    }
    if (i < imgs.length) requestAnimationFrame(step);
  };
  step();
}

// ---- List view ----

function matches(d, q) {
  if (!q) return true;
  if ((d.title || '').toLowerCase().includes(q) || (d.text || '').toLowerCase().includes(q)) return true;
  return (d.tags || []).some((t) => TAGS[t]?.label.toLowerCase().includes(q));
}

function listHTML(dreams) {
  const q = query.trim().toLowerCase();
  const shown = dreams.filter((d) => matches(d, q));
  if (!shown.length) {
    return `<div class="jr-note glass"><p class="muted">No dreams match “${esc(query.trim())}”.</p></div>`;
  }
  const groups = new Map();
  for (const d of shown) {
    const key = (d.date || '').slice(0, 7);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(d);
  }
  return [...groups.entries()].map(([key, items]) => {
    const [y, m] = key.split('-').map(Number);
    const label = y && m ? monthName(y, m - 1) : 'Undated';
    return `
      <section class="jr-month">
        <h2 class="section-title">${esc(label)} <span class="jr-count">${items.length}</span></h2>
        <div class="jr-rows">${items.map(row).join('')}</div>
      </section>`;
  }).join('');
}

// ---- Calendar view ----

function weekdayInitials() {
  const monday = new Date(2024, 0, 1); // a Monday
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d.toLocaleDateString(undefined, { weekday: 'narrow' });
  });
}

function calendarHTML(byDay) {
  const { y, m, selected } = cal;
  const today = localDay();
  const first = new Date(y, m, 1);
  const lead = (first.getDay() + 6) % 7; // Monday first
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
    const lucid = list.some((d) => d.lucid);
    const marks = list.length > 3
      ? `<span class="jr-dots"><span class="jr-many${lucid ? ' jr-gold' : ''}">${list.length}</span></span>`
      : `<span class="jr-dots">${list.map((d) => `<span class="jr-dot${d.lucid ? ' jr-gold' : ''}"></span>`).join('')}</span>`;
    const label = `${dayDate(iso).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}, ${list.length} dream${list.length > 1 ? 's' : ''}${lucid ? ', lucid' : ''}`;
    cells.push(`<button type="button" class="${cls.join(' ')}" data-day="${iso}" aria-label="${esc(label)}" aria-pressed="${iso === selected}">
      <span class="jr-num">${day}</span>${marks}</button>`);
  }

  const picked = selected && selected.startsWith(prefix) ? (byDay.get(selected) || []) : [];
  let below;
  if (picked.length) {
    below = `
      <h2 class="section-title">${esc(relativeDay(selected))}</h2>
      <div class="jr-rows">${picked.map(row).join('')}</div>`;
  } else {
    below = `<p class="jr-hint faint">${inMonth ? 'Tap a glowing night to see its dreams.' : 'No dreams recorded this month.'}</p>`;
  }

  return `
    <div class="jr-cal glass">
      <div class="jr-cal-head">
        <button type="button" class="icon-btn jr-nav" data-action="prev" aria-label="Previous month">${icons.back}</button>
        <h2 class="jr-cal-month">${esc(monthName(y, m))}</h2>
        <button type="button" class="icon-btn jr-nav" data-action="next" aria-label="Next month">${icons.chevronRight}</button>
      </div>
      <div class="jr-grid jr-weekdays" aria-hidden="true">${weekdayInitials().map((w) => `<span>${esc(w)}</span>`).join('')}</div>
      <div class="jr-grid">${cells.join('')}</div>
    </div>
    <div class="jr-daylist">${below}</div>`;
}

// ---- Screen ----

export default {
  id: 'journal',
  label: 'Journal',
  icon: icons.journal,

  render(el) {
    const dreams = sortDreams(listDreams());
    const byId = new Map(dreams.map((d) => [d.id, d]));

    if (!dreams.length) {
      el.innerHTML = `
        <div class="jr">
          <h1 class="screen-title">Journal</h1>
          <div class="jr-empty glass">
            <div class="jr-empty-icon">${icons.moon}</div>
            <h2 class="jr-empty-title">No dreams yet</h2>
            <p class="muted">Each morning, catch what you remember before it fades.</p>
            <a class="btn" href="#record">${icons.plus}<span>Record a dream</span></a>
          </div>
        </div>`;
      return;
    }

    const byDay = new Map();
    for (const d of dreams) {
      if (!byDay.has(d.date)) byDay.set(d.date, []);
      byDay.get(d.date).push(d);
    }
    if (!cal) {
      const now = new Date();
      const today = localDay(now);
      cal = { y: now.getFullYear(), m: now.getMonth(), selected: byDay.has(today) ? today : null };
    }

    let view = getView();
    el.innerHTML = `
      <div class="jr">
        <div class="jr-head">
          <h1 class="screen-title">Journal</h1>
          <div class="jr-seg" role="group" aria-label="View">
            <button type="button" data-view="list" aria-pressed="${view === 'list'}">${icons.list}<span>List</span></button>
            <button type="button" data-view="calendar" aria-pressed="${view === 'calendar'}">${icons.calendar}<span>Calendar</span></button>
          </div>
        </div>
        <div class="jr-body"></div>
      </div>`;

    const root = el.querySelector('.jr');
    const body = root.querySelector('.jr-body');

    const paintList = () => {
      const results = body.querySelector('.jr-results');
      results.innerHTML = listHTML(dreams);
      fillThumbs(results, byId);
    };

    const paint = () => {
      if (view === 'list') {
        body.innerHTML = `
          <input class="field jr-search" type="search" placeholder="Search dreams" aria-label="Search dreams"
            value="${esc(query)}" autocomplete="off" autocorrect="off" spellcheck="false" enterkeyhint="search">
          <div class="jr-results"></div>`;
        paintList();
      } else {
        body.innerHTML = calendarHTML(byDay);
        fillThumbs(body, byId);
      }
    };

    root.addEventListener('input', (e) => {
      if (!e.target.classList.contains('jr-search')) return;
      query = e.target.value;
      paintList();
    });
    root.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.classList.contains('jr-search')) e.target.blur();
    });

    root.addEventListener('click', (e) => {
      const seg = e.target.closest('[data-view]');
      if (seg) {
        if (seg.dataset.view === view) return;
        view = seg.dataset.view;
        setView(view);
        for (const b of root.querySelectorAll('[data-view]')) b.setAttribute('aria-pressed', String(b.dataset.view === view));
        paint();
        return;
      }
      const nav = e.target.closest('[data-action]');
      if (nav) {
        const step = nav.dataset.action === 'next' ? 1 : -1;
        const d = new Date(cal.y, cal.m + step, 1);
        cal.y = d.getFullYear();
        cal.m = d.getMonth();
        paint();
        return;
      }
      const day = e.target.closest('[data-day]');
      if (day) {
        cal.selected = cal.selected === day.dataset.day ? null : day.dataset.day;
        paint();
        if (cal.selected) body.querySelector('.jr-daylist')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    });

    paint();
  },

  destroy() {
    thumbJob += 1;
  },
};
