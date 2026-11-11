// New layout: Calendar tab. Two looks, switched at the top (remembered in settings.calendarStyle):
//   Circle (default): the dream wheel (wheel.js), the month as a zodiac-like circle. Tap a day to put its dream in the
//     middle; under the circle, that day's card ("what happened this day") opens the day sheet.
//   Grid: a Monday-first month. Days with dreams glow (with a count when there are several), days with a day-journal
//     note get a warm mark, today has a moon-gold ring. Tapping a day opens its sheet.
// Under both, the month's totals. Swipe the month sideways to turn the page.
// The day sheet holds that day's dreams and its day journal, which the dream page shows next to the dreams of the
// following morning. openDaySheet() is shared with Home's "Your day" card.
// Saving a note fires 'dreaming:daynote' on window (store.js does not notify for settings), so screens can repaint.
import { listDreams, listDayNotes, getDayNote, setDayNote, localDay, onChange, getSetting, setSetting } from '../../store.js';
import { symbolsOf, dreamDay } from '../../symbols.js';
import { esc, icons, formatDate, relativeDay } from '../../ui.js';
import { dreamArtURL } from '../../dreamart.js';
import { hasVideo } from '../../videos.js';
import { wheelHTML, defaultDay, dreamsByDay } from './wheel.js';

/** A small sun: the day journal's mark (the moon belongs to dreams). Home uses it too. */
export const SUN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.2M12 19.3v2.2M4.6 4.6l1.6 1.6M17.8 17.8l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.6 19.4l1.6-1.6M17.8 6.2l1.6-1.6"/></svg>';

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const SWIPE = 56; // px of sideways swipe on the month that turns the page
const SNIPPET = 140; // characters of a day note shown on the day card
const STYLE_KEY = 'calendarStyle'; // 'wheel' | 'grid'

// Month on screen, kept between visits (null: this month).
let view = null; // { y, m (0-11) }
let pick = null; // the circle's chosen day in that month: { selected: day number, index: which of its dreams }
let cleanup = null;
let sheet = null; // the open day sheet: { day, close }

const getStyle = () => (getSetting(STYLE_KEY, 'wheel') === 'grid' ? 'grid' : 'wheel');

const pad = (n) => String(n).padStart(2, '0');
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const noon = (iso) => new Date(`${iso}T12:00:00`);
const titleOf = (d) => String(d?.title || '').trim() || 'Untitled dream';

const monthName = (y, m) => new Date(y, m, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
const monthOnly = (y, m) => new Date(y, m, 1).toLocaleDateString(undefined, { month: 'long' });

/** "Wednesday, 11 November" (with the year when it isn't this year). */
function longDay(iso) {
  const d = noon(iso);
  const opts = { weekday: 'long', day: 'numeric', month: 'long' };
  if (d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
  return d.toLocaleDateString(undefined, opts);
}

function weekdayInitials() {
  const monday = new Date(2024, 0, 1); // a Monday
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return {
      short: d.toLocaleDateString(undefined, { weekday: 'narrow' }),
      long: d.toLocaleDateString(undefined, { weekday: 'long' }),
    };
  });
}

function thisMonth() {
  const now = new Date();
  return { y: now.getFullYear(), m: now.getMonth() };
}
const isCurrent = (v) => { const t = thisMonth(); return v.y === t.y && v.m === t.m; };
const isFuture = (v) => { const t = thisMonth(); return v.y > t.y || (v.y === t.y && v.m > t.m); };

function emitDayNote(day) {
  try { window.dispatchEvent(new CustomEvent('dreaming:daynote', { detail: { day } })); } catch {}
}

/** Dreams of one day, newest first. */
const dreamsOn = (day) => listDreams().filter((d) => dreamDay(d) === day);

// ---------- dream rows (the sheet) ----------

function thumb(d, px) {
  let url = '';
  try { url = dreamArtURL(d, px) || ''; } catch {}
  if (url) return `<img class="bc-thumb-img" src="${esc(url)}" alt="" width="${px}" height="${px}" decoding="async">`;
  return `<span class="bc-thumb-img bc-thumb-fallback" style="--h:${(Number(d.seed) || 0) % 360}"></span>`;
}

function dreamRowHTML(d) {
  const syms = symbolsOf(d).slice(0, 3);
  return `
    <li>
      <a class="bc-dream" href="#dream/${esc(encodeURIComponent(d.id))}">
        <span class="bc-thumb">
          ${thumb(d, 52)}
          ${hasVideo(d) ? `<span class="video-mark" aria-hidden="true">${icons.play}</span>` : ''}
        </span>
        <span class="bc-dream-body">
          <span class="bc-dream-title">${esc(titleOf(d))}</span>
          ${syms.length ? `<span class="bc-chips">${syms.map((s) => `<span class="chip bc-chip">${esc(s.name)}</span>`).join('')}</span>` : ''}
        </span>
        <span class="bc-dream-go" aria-hidden="true">${icons.chevronRight}</span>
      </a>
    </li>`;
}

// ---------- the day sheet (shared with Home) ----------

/**
 * Opens the sheet for `day` ('YYYY-MM-DD', not in the future): its dreams and its day journal.
 * The note saves on Save and when the sheet closes (×, scrim, Escape, a link, leaving the screen) if it changed.
 * Options: focusNote (put the cursor in the note straight away; call it from inside the tap so iOS shows the keyboard).
 */
export function openDaySheet(day, ctx, { focusNote = false } = {}) {
  if (typeof document === 'undefined' || !ISO_DAY.test(String(day || '')) || day > localDay()) return;
  sheet?.close({ animate: false });

  const dreams = dreamsOn(day);
  const isToday = day === localDay();
  const rel = relativeDay(day);
  const sub = rel && rel !== formatDate(day) ? rel : '';
  const returnTo = document.activeElement;

  const el = document.createElement('div');
  el.className = 'bc-sheet';
  el.innerHTML = `
    <div class="bc-sheet-scrim" data-bc="close"></div>
    <div class="bc-sheet-panel" role="dialog" aria-modal="true" aria-labelledby="bc-sheet-title">
      <span class="bc-sheet-grab" aria-hidden="true"></span>
      <div class="bc-sheet-head">
        <div class="bc-sheet-titles">
          <h2 class="bc-sheet-title" id="bc-sheet-title">${esc(longDay(day))}</h2>
          ${sub ? `<p class="bc-sheet-sub">${esc(sub)}</p>` : ''}
        </div>
        <button type="button" class="icon-btn bc-sheet-close" data-bc="close" aria-label="Close">${icons.close}</button>
      </div>
      <div class="bc-sheet-scroll">
        <section class="bc-sheet-sec" aria-labelledby="bc-sheet-dreams">
          <h3 class="bc-sheet-label" id="bc-sheet-dreams">${dreams.length ? `Dreams · ${dreams.length}` : 'Dreams'}</h3>
          ${dreams.length
            ? `<ul class="bc-dreams">${dreams.map(dreamRowHTML).join('')}</ul>`
            : `<p class="bc-sheet-none">No dreams recorded for ${isToday ? 'today' : 'this day'}.</p>`}
          <a class="bc-sheet-record" href="#record">${icons.plus}<span>${isToday ? 'Record a dream' : 'Record a dream for this day'}</span></a>
          ${isToday ? '' : `<p class="bc-sheet-hint">In the editor, set the date to ${esc(formatDate(day))}.</p>`}
        </section>
        <section class="bc-sheet-sec bc-sheet-daysec">
          <h3 class="bc-sheet-label"><label for="bc-note">${SUN}<span>${isToday ? 'Your day' : 'That day'}</span></label></h3>
          <p class="bc-sheet-hint">Dreams from the next morning show this note on their page, so you can see what connects.</p>
          <textarea class="field bc-note" id="bc-note" rows="5" maxlength="4000"
            placeholder="What happened this day? Main events, people, feelings…">${esc(getDayNote(day))}</textarea>
          <button type="button" class="btn bc-save" data-bc="save">${icons.check}<span>Save</span></button>
        </section>
      </div>
    </div>`;
  document.body.append(el);
  document.body.classList.add('bc-sheet-open');

  const ta = el.querySelector('.bc-note');
  let saved = getDayNote(day);

  /** Saves the note if it changed. Returns true when something was written. */
  const save = ({ quiet = false } = {}) => {
    const text = ta.value.trim().slice(0, 4000);
    if (text === saved) return false;
    setDayNote(day, text);
    saved = getDayNote(day);
    emitDayNote(day);
    if (!quiet) ctx?.toast?.(text ? 'Saved' : 'Day note removed');
    return true;
  };

  // Keeps the sheet inside the visible area when the iPhone keyboard is up.
  const vv = window.visualViewport || null;
  const fit = () => {
    if (!vv) return;
    el.style.top = `${Math.round(vv.offsetTop)}px`;
    el.style.height = `${Math.round(vv.height)}px`;
    el.classList.toggle('bc-kb', window.innerHeight - vv.height > 120);
  };

  let closed = false;
  const close = ({ animate = true } = {}) => {
    if (closed) return;
    closed = true;
    save();
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('hashchange', onRoute);
    document.removeEventListener('visibilitychange', onHide);
    vv?.removeEventListener('resize', fit);
    vv?.removeEventListener('scroll', fit);
    document.body.classList.remove('bc-sheet-open');
    if (sheet?.el === el) sheet = null;
    let reduce = false;
    try { reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch {}
    if (animate && !reduce) {
      el.classList.add('bc-sheet-out');
      setTimeout(() => el.remove(), 180);
    } else {
      el.remove();
    }
    if (animate && returnTo instanceof HTMLElement && returnTo.isConnected) returnTo.focus({ preventScroll: true });
  };

  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const onRoute = () => close({ animate: false });
  // The app can be closed from the app switcher while hidden: keep what was typed.
  const onHide = () => { if (document.visibilityState === 'hidden') save({ quiet: true }); };

  el.addEventListener('click', (e) => {
    const act = e.target.closest('[data-bc]')?.dataset.bc;
    if (act === 'close') { close(); return; }
    if (act === 'save') {
      if (!save() && saved) ctx?.toast?.('Saved'); // unchanged but kept: still confirm it
      close();
      return;
    }
    // A dream or "Record a dream": close first (saving the note), then go there.
    const link = e.target.closest('a[href^="#"]');
    if (link) {
      e.preventDefault();
      const href = link.getAttribute('href');
      close({ animate: false });
      if (ctx?.navigate) ctx.navigate(href);
      else location.hash = href;
    }
  });
  document.addEventListener('keydown', onKey);
  window.addEventListener('hashchange', onRoute);
  document.addEventListener('visibilitychange', onHide);
  vv?.addEventListener('resize', fit);
  vv?.addEventListener('scroll', fit);
  fit();

  sheet = { day, el, close };
  if (focusNote) {
    ta.focus();
    const end = ta.value.length;
    try { ta.setSelectionRange(end, end); } catch {}
  } else {
    el.querySelector('.bc-sheet-close')?.focus({ preventScroll: true });
  }
}

// ---------- the month ----------

function monthData(y, m) {
  const prefix = `${y}-${pad(m + 1)}`;
  const byDay = new Map();
  let dreams = 0;
  for (const d of listDreams()) {
    const day = dreamDay(d);
    if (!day.startsWith(prefix)) continue;
    dreams += 1;
    byDay.set(day, (byDay.get(day) || 0) + 1);
  }
  const notes = new Set(listDayNotes().filter((n) => n.day.startsWith(prefix)).map((n) => n.day));
  return { prefix, byDay, notes, dreams };
}

function cellHTML(iso, n, noted, today) {
  const num = Number(iso.slice(8));
  if (iso > today) return `<span class="bc-day bc-future"><span class="bc-disc">${num}</span></span>`;
  const cls = ['bc-day'];
  if (n) cls.push('bc-has');
  if (noted) cls.push('bc-noted');
  if (iso === today) cls.push('bc-today');
  const label = [
    longDay(iso),
    iso === today ? 'today' : '',
    n ? plural(n, 'dream') : 'no dreams',
    noted ? 'day note' : '',
  ].filter(Boolean).join(', ');
  return `
    <button type="button" class="${cls.join(' ')}" data-day="${iso}" aria-label="${esc(label)}">
      <span class="bc-disc">${num}${n > 1 ? `<span class="bc-count">${n}</span>` : ''}</span>
      ${noted ? '<span class="bc-note-mark"></span>' : ''}
    </button>`;
}

const styleHTML = (style) => `
    <div class="bc-style" role="group" aria-label="Calendar look">
      <button type="button" data-style="wheel" aria-pressed="${style === 'wheel'}">${icons.zodiac}<span>Circle</span></button>
      <button type="button" data-style="grid" aria-pressed="${style === 'grid'}">${icons.calendar}<span>Grid</span></button>
    </div>`;

/** First ~140 characters of a note, cut at a word. */
function snippet(text) {
  const flat = String(text || '').replace(/\s+/g, ' ').trim();
  if (flat.length <= SNIPPET) return flat;
  const cut = flat.slice(0, SNIPPET);
  const space = cut.lastIndexOf(' ');
  return `${(space > SNIPPET * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,.;:–-]+$/, '')}…`;
}

/** The circle's chosen day, under it: the day's name and its day-journal note (tap to open the day sheet). */
function dayCardHTML(iso, dreams) {
  const today = localDay();
  const note = getDayNote(iso);
  const rel = relativeDay(iso);
  const sub = [rel && rel !== formatDate(iso) ? rel : '', dreams ? plural(dreams, 'dream') : 'No dreams'].filter(Boolean).join(' · ');
  const isToday = iso === today;
  return `
    <section class="glass bc-daycard" aria-labelledby="bc-daycard-title">
      <div class="bc-daycard-head">
        <span class="bc-daycard-icon" aria-hidden="true">${SUN}</span>
        <div class="bc-daycard-titles">
          <h2 class="bc-daycard-title" id="bc-daycard-title">${esc(longDay(iso))}</h2>
          <p class="bc-daycard-sub">${esc(sub)}</p>
        </div>
      </div>
      ${note
        ? `<button type="button" class="bc-daycard-note" data-day="${iso}" aria-label="${esc(`Open this day’s note: ${snippet(note)}`)}">${esc(snippet(note))}</button>`
        : `<p class="bc-daycard-prompt">${isToday ? 'What happened today?' : 'What happened this day?'} A few lines about events, people and feelings help you see what your dreams pick up.</p>`}
      <button type="button" class="btn btn-ghost bc-daycard-btn" data-day="${iso}">${icons.edit}<span>${note ? 'Open this day' : `Write about ${isToday ? 'today' : 'this day'}`}</span></button>
    </section>`;
}

function wheelBodyHTML() {
  const { y, m } = view;
  const month = `${y}-${pad(m + 1)}`;
  const { notes } = monthData(y, m);
  const days = new Set([...notes].map((iso) => Number(iso.slice(8, 10))));
  const iso = `${month}-${pad(pick.selected)}`;
  const count = (dreamsByDay(month).get(pick.selected) || []).length;
  return `
    ${isCurrent(view) ? '' : '<div class="bc-now-row"><button type="button" class="bc-back-now" data-cal="now">Back to this month</button></div>'}
    ${wheelHTML({ month, selected: pick.selected, index: pick.index }, { notes: days })}
    ${dayCardHTML(iso, count)}`;
}

function totalsHTML() {
  const { y, m } = view;
  const { byDay, notes, dreams } = monthData(y, m);
  const current = isCurrent(view);
  const month = monthOnly(y, m);
  const hint = dreams || notes.size
    ? 'Tap a day to see its dreams and write about what happened.'
    : `Nothing in ${month} yet. Tap a day to write about it.`;
  return `
    <h2 class="section-title">${current ? 'This month' : esc(monthName(y, m))}</h2>
    <dl class="bc-totals">
      <div class="glass bc-total"><dt>Dreams recorded</dt><dd>${dreams}</dd></div>
      <div class="glass bc-total"><dt>Days with dreams</dt><dd>${byDay.size}</dd></div>
      <div class="glass bc-total bc-total-notes"><dt>Day notes</dt><dd>${notes.size}</dd></div>
    </dl>
    <p class="bc-hint">${esc(hint)}</p>`;
}

function screenHTML(anim) {
  const style = getStyle();
  return `
    <h1 class="screen-title bc-title">Calendar</h1>
    ${styleHTML(style)}
    ${style === 'wheel' ? wheelBodyHTML() : gridHTML(anim)}
    ${totalsHTML()}`;
}

function gridHTML(anim) {
  const { y, m } = view;
  const today = localDay();
  const { prefix, byDay, notes } = monthData(y, m);
  const lead = (new Date(y, m, 1).getDay() + 6) % 7; // Monday first
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const current = isCurrent(view);

  const cells = [];
  for (let i = 0; i < lead; i++) cells.push('<span class="bc-day bc-blank" aria-hidden="true"></span>');
  for (let day = 1; day <= daysInMonth; day++) {
    const iso = `${prefix}-${pad(day)}`;
    cells.push(cellHTML(iso, byDay.get(iso) || 0, notes.has(iso), today));
  }

  const week = weekdayInitials();

  return `
    <div class="glass bc-cal">
      <div class="bc-head">
        <button type="button" class="icon-btn bc-nav" data-cal="prev" aria-label="Previous month">${icons.back}</button>
        <div class="bc-head-mid">
          <h2 class="bc-month" aria-live="polite">${esc(monthName(y, m))}</h2>
          ${current ? '' : '<button type="button" class="bc-back-now" data-cal="now">Back to this month</button>'}
        </div>
        <button type="button" class="icon-btn bc-nav" data-cal="next" aria-label="Next month" ${current ? 'disabled' : ''}>${icons.chevronRight}</button>
      </div>
      <div class="bc-grid bc-weekdays" aria-hidden="true">${week.map((w) => `<span title="${esc(w.long)}">${esc(w.short)}</span>`).join('')}</div>
      <div class="bc-grid bc-days${anim ? ` bc-in-${anim}` : ''}">${cells.join('')}</div>
      <div class="bc-legend" aria-hidden="true">
        <span><i class="bc-key bc-key-dream"></i>Dream</span>
        <span><i class="bc-key bc-key-note"></i>Day note</span>
        <span><i class="bc-key bc-key-today"></i>Today</span>
      </div>
    </div>`;
}

export default {
  id: 'calendar',
  label: 'Calendar',
  icon: icons.calendar,

  render(el, ctx) {
    cleanup?.();
    if (!view || isFuture(view)) view = thisMonth();
    const monthKey = () => `${view.y}-${pad(view.m + 1)}`;
    const freshPick = () => { pick = { selected: defaultDay(monthKey()), index: 0 }; };
    freshPick();

    el.innerHTML = '<div class="bc"></div>';
    const root = el.firstElementChild;
    const paint = (anim = '') => { root.innerHTML = screenHTML(anim); };
    paint();

    let queued = false;
    const repaint = () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        if (root.isConnected) paint();
      });
    };

    /** Moves by `step` months (never past this month); keeps the focus on the button that was used. */
    const go = (step, focusSel) => {
      const d = step ? new Date(view.y, view.m + step, 1) : new Date();
      const next = { y: d.getFullYear(), m: d.getMonth() };
      if (isFuture(next) || (next.y === view.y && next.m === view.m)) return;
      const later = next.y * 12 + next.m > view.y * 12 + view.m;
      view = next;
      freshPick();
      paint(later ? 'next' : 'prev');
      if (focusSel) {
        const target = root.querySelector(focusSel);
        (target && !target.disabled ? target : root.querySelector('[data-cal="prev"], [data-wheel-prev]'))?.focus({ preventScroll: true });
      }
    };

    root.addEventListener('click', (e) => {
      let b;
      // Circle / Grid
      if ((b = e.target.closest('[data-style]'))) {
        if (b.dataset.style !== getStyle()) {
          setSetting(STYLE_KEY, b.dataset.style);
          paint();
          root.querySelector(`[data-style="${b.dataset.style}"]`)?.focus({ preventScroll: true });
        }
        return;
      }
      // The circle: choose a day, the next dream of that day, or turn the month.
      if ((b = e.target.closest('[data-wheel-day]'))) {
        pick = { selected: Number(b.dataset.wheelDay), index: 0 };
        paint();
        root.querySelector(`[data-wheel-day="${pick.selected}"]`)?.focus({ preventScroll: true });
        return;
      }
      if (e.target.closest('[data-wheel-more]')) {
        const count = (dreamsByDay(monthKey()).get(pick.selected) || []).length;
        pick = { ...pick, index: count ? (pick.index + 1) % count : 0 };
        paint();
        root.querySelector('[data-wheel-more]')?.focus({ preventScroll: true });
        return;
      }
      if (e.target.closest('[data-wheel-prev]')) { go(-1, '[data-wheel-prev]'); return; }
      if ((b = e.target.closest('[data-wheel-next]'))) { if (!b.disabled) go(1, '[data-wheel-next]'); return; }

      const nav = e.target.closest('[data-cal]');
      if (nav) {
        if (nav.disabled) return;
        const act = nav.dataset.cal;
        if (act === 'now') go(0, '[data-cal="prev"]');
        else go(act === 'next' ? 1 : -1, `[data-cal="${act}"]`);
        return;
      }
      const day = e.target.closest('[data-day]');
      if (day) openDaySheet(day.dataset.day, ctx);
    });

    // Swipe the month sideways to turn the page (left: next month, right: previous).
    let start = null;
    root.addEventListener('touchstart', (e) => {
      const t = e.touches[0];
      start = e.touches.length === 1 && e.target.closest('.bc-cal, .bw') ? { x: t.clientX, y: t.clientY } : null;
    }, { passive: true });
    root.addEventListener('touchend', (e) => {
      if (!start) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - start.x;
      const dy = t.clientY - start.y;
      start = null;
      if (Math.abs(dx) > SWIPE && Math.abs(dx) > Math.abs(dy) * 1.5) go(dx < 0 ? 1 : -1);
    }, { passive: true });

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
