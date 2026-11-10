// Settings tab (#profile). Main list mirrors the reference app's order, adapted honestly:
// profile card · plan card (Free / Plus until, usage this month, See plans) · Redeem a code ·
// Notifications / Passcode / Export · Account · Labs · Personalisation · sample dreams / delete all · About.
// Rows with a chevron open sub-pages at #profile/<page>:
//   notifications · passcode · export · print (readable journal, print-ready) · account · personalise · about · redeem
// Touches document/window/storage only inside render and event handlers, never at import time.
import {
  getStats, getSetting, setSetting, exportData, importData, addSampleDreams, clearAll, localDay,
  getProfile, setProfile, listDreams, withDefaults, SYMBOL_CATEGORIES,
} from '../store.js';
import { esc, formatDate, icons } from '../ui.js';
import { levelFor } from '../progress.js';
import { mountPinPad, sha256hex } from './lock.js';
import { getAccount, cachedAccount, redeem, remaining } from '../account.js';
import { plusPill, planLimits, formatUntil, renewDate, allowanceLine } from '../paywall.js';

// Icons ui.js doesn't have (kept local; same stroke style).
const ic = (body) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const localIcons = {
  download: ic('<path d="M12 4v11"/><path d="m7.5 10.5 4.5 4.5 4.5-4.5"/><path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>'),
  sliders: ic('<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>'),
  flask: ic('<path d="M9.5 3h5M10 3v6l-5 9a2 2 0 0 0 1.8 3h10.4a2 2 0 0 0 1.8-3l-5-9V3"/><path d="M7.5 15h9"/>'),
  printer: ic('<path d="M7 9V3h10v6"/><rect x="3.5" y="9" width="17" height="8" rx="2"/><path d="M7 14h10v7H7z"/>'),
  text: ic('<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 12h6M9 16h6"/>'),
  ticket: ic('<path d="M3.5 8.5V6.5a1.5 1.5 0 0 1 1.5-1.5h14a1.5 1.5 0 0 1 1.5 1.5v2a2.5 2.5 0 0 0 0 5v2a1.5 1.5 0 0 1-1.5 1.5H5a1.5 1.5 0 0 1-1.5-1.5v-2a2.5 2.5 0 0 0 0-5z"/><path d="M14.5 5v14" stroke-dasharray="2 2.2"/>'),
};

const pad2 = (n) => String(n).padStart(2, '0');

// ---- Calendar reminders (.ics) ----

/** "YYYYMMDDTHHMMSS" in local (floating) time. */
const icsLocal = (d) => `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}T${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`;

/** "YYYYMMDDTHHMMSSZ" in UTC. */
const icsUtc = (d) => `${d.getUTCFullYear()}${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCDate())}T${pad2(d.getUTCHours())}${pad2(d.getUTCMinutes())}${pad2(d.getUTCSeconds())}Z`;

/** Escapes an iCalendar TEXT value. */
const icsText = (s) => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** Folds a content line to at most 75 UTF-8 octets per physical line (RFC 5545 §3.1). */
function fold(line) {
  const enc = new TextEncoder();
  const out = [];
  let cur = '';
  let bytes = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    const limit = out.length ? 74 : 75; // continuation lines start with a space
    if (bytes + n > limit) { out.push(cur); cur = ''; bytes = 0; }
    cur += ch;
    bytes += n;
  }
  out.push(cur);
  return out.join('\r\n ');
}

const validTime = (t) => /^\d{1,2}:\d{2}$/.test(String(t ?? ''));

/** Next Date at hh:mm local time (today if still ahead, else tomorrow). */
function nextOccurrence(hhmm) {
  const [h, m] = (validTime(hhmm) ? hhmm : '07:00').split(':').map(Number);
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m, 0, 0);
  if (d <= now) d.setDate(d.getDate() + 1);
  return d;
}

/** One calendar file with a daily repeating event per entry: [{ time, summary, description }]. */
function buildIcs(events) {
  const appUrl = location.href.split('#')[0];
  const now = new Date();
  const rand = Math.random().toString(36).slice(2, 10);
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Dreaming//Dream Journal//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
  events.forEach((ev, i) => {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${now.getTime().toString(36)}-${i}-${rand}@dreaming`,
      `DTSTAMP:${icsUtc(now)}`,
      `DTSTART:${icsLocal(nextOccurrence(ev.time))}`,
      'DURATION:PT5M',
      'RRULE:FREQ=DAILY',
      'TRANSP:TRANSPARENT',
      `SUMMARY:${icsText(ev.summary)}`,
      `DESCRIPTION:${icsText(`${ev.description} ${appUrl}`)}`,
      `URL:${appUrl}`,
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      'TRIGGER:PT0M',
      `DESCRIPTION:${icsText(ev.summary)}`,
      'END:VALARM',
      'END:VEVENT',
    );
  });
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/** Saves a Blob through a temporary <a download> click. */
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function sendToCalendar(events, filename) {
  const blob = new Blob([buildIcs(events)], { type: 'text/calendar;charset=utf-8' });
  if (isIOS()) {
    // Navigating to a text/calendar resource makes iOS show its "Add to Calendar" sheet.
    const url = URL.createObjectURL(blob);
    location.href = url;
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } else {
    downloadBlob(blob, filename);
  }
}

const morningEvent = (time) => ({
  time,
  summary: 'Write down your dream 🌙',
  description: "Before it fades: open Dreaming and note whatever you remember from last night, even a single image.",
});

const realityEvent = (time) => ({
  time,
  summary: 'Reality check: am I dreaming?',
  description: 'Look at your hands, read a line of text twice, and ask yourself honestly whether this could be a dream.',
});

const REALITY_SLOTS = ['09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00', '20:00'];
const REALITY_DEFAULT = ['10:00', '13:00', '16:00', '19:00'];

/** "7:00 AM" or "07:00", following the phone's clock style. */
function clock(hhmm) {
  if (!validTime(hhmm)) return hhmm || '';
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(2000, 0, 1, h, m).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

// ---- Files: share sheet on iPhone, download elsewhere ----

async function shareOrDownload(ctx, content, name, type, doneMsg) {
  let file = null;
  try { file = new File([content], name, { type }); } catch {}
  if (file && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return;
    } catch (err) {
      if (err?.name === 'AbortError') return; // user closed the share sheet
    }
  }
  downloadBlob(new Blob([content], { type }), name);
  if (doneMsg) ctx.toast(doneMsg);
}

// ---- Readable journal (text + print-ready HTML) ----

const longDay = (isoDay) => {
  if (!isoDay) return '';
  const d = new Date(`${isoDay}T00:00:00`);
  return Number.isNaN(d.getTime()) ? String(isoDay)
    : d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
};

const CATEGORY_LABEL = { people: 'People', objects: 'Objects', characters: 'Characters', places: 'Places', themes: 'Themes', actions: 'Actions' };

/** Dreams oldest first, each as plain fields ready for text or HTML. */
function readableDreams() {
  return listDreams().map(withDefaults)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.createdAt).localeCompare(String(b.createdAt)))
    .map((d) => {
      const marks = [];
      if (d.kind === 'nightmare') marks.push('Nightmare');
      if (d.lucid) marks.push('Lucid');
      if (d.recurring) marks.push('Recurring');
      const symbols = SYMBOL_CATEGORIES
        .filter((c) => d.symbols[c]?.length)
        .map((c) => `${CATEGORY_LABEL[c] || c}: ${d.symbols[c].join(', ')}`);
      return {
        day: longDay(d.date),
        title: d.title || 'Untitled dream',
        marks,
        text: String(d.text || ''),
        emotions: (d.emotions || []).join(', '),
        symbols,
        notes: String(d.notes || ''),
      };
    });
}

function journalText() {
  const dreams = readableDreams();
  const out = ['DREAMING · DREAM JOURNAL', `Exported ${formatDate(localDay())} · ${dreams.length} ${dreams.length === 1 ? 'dream' : 'dreams'}`, ''];
  for (const d of dreams) {
    out.push('────────────────────', d.day, d.title + (d.marks.length ? `  [${d.marks.join(' · ')}]` : ''), '');
    if (d.text) out.push(d.text, '');
    if (d.emotions) out.push(`Emotions: ${d.emotions}`);
    for (const s of d.symbols) out.push(s);
    if (d.notes) out.push(`Notes: ${d.notes}`);
    if (d.emotions || d.symbols.length || d.notes) out.push('');
  }
  return out.join('\n');
}

const paragraphs = (text) => String(text).split(/\n{2,}|\r?\n/).map((p) => p.trim()).filter(Boolean)
  .map((p) => `<p>${esc(p)}</p>`).join('');

function journalArticles() {
  const dreams = readableDreams();
  if (!dreams.length) return '<p class="prof-paper-empty">No dreams yet. Once you record some, they appear here.</p>';
  return dreams.map((d) => `
    <article class="prof-paper-dream">
      <p class="prof-paper-day">${esc(d.day)}</p>
      <h2 class="prof-paper-title">${esc(d.title)}${d.marks.map((m) => ` <span class="prof-paper-mark">${esc(m)}</span>`).join('')}</h2>
      ${paragraphs(d.text)}
      ${d.emotions || d.symbols.length || d.notes ? `<dl class="prof-paper-meta">
        ${d.emotions ? `<div><dt>Emotions</dt><dd>${esc(d.emotions)}</dd></div>` : ''}
        ${d.symbols.map((s) => { const [k, ...v] = s.split(': '); return `<div><dt>${esc(k)}</dt><dd>${esc(v.join(': '))}</dd></div>`; }).join('')}
        ${d.notes ? `<div><dt>Notes</dt><dd>${esc(d.notes)}</dd></div>` : ''}
      </dl>` : ''}
    </article>`).join('');
}

/** A standalone print-ready HTML file of the journal (shared as dreaming-journal.html). */
function journalHtmlFile() {
  const n = listDreams().length;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Dream journal</title><style>
body{margin:0 auto;max-width:640px;padding:32px 24px;font:16px/1.6 ui-serif,"New York",Georgia,serif;color:#221c33;background:#fff}
h1{font-weight:400;font-size:30px;margin:0 0 4px}.meta{color:#6b6480;font-size:14px;margin:0 0 28px}
article{padding:18px 0;border-top:1px solid #ddd6ea;break-inside:avoid-page}
.prof-paper-day{margin:0;color:#7a6fa0;font:600 12px/1.4 -apple-system,system-ui,sans-serif;letter-spacing:.06em;text-transform:uppercase}
h2{font-size:20px;font-weight:600;margin:4px 0 8px}.prof-paper-mark{font:600 11px -apple-system,system-ui,sans-serif;color:#8a6d1f;border:1px solid #e4cf95;border-radius:99px;padding:1px 7px;vertical-align:3px}
p{margin:0 0 10px}dl{margin:8px 0 0;font-size:14px;color:#4b4462}dl div{display:flex;gap:8px}dt{font-weight:600;min-width:84px}dd{margin:0}
</style></head><body><h1>Dream journal</h1><p class="meta">Dreaming · exported ${esc(formatDate(localDay()))} · ${n} ${n === 1 ? 'dream' : 'dreams'}</p>
${journalArticles()}</body></html>`;
}

// ---- Build log ----

const compareVersion = (a, b) => {
  const pa = String(a ?? '').split('.').map((x) => parseInt(x, 10) || 0);
  const pb = String(b ?? '').split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
};

function buildLog(notes) {
  if (!notes?.length) return '<p class="prof-log-empty faint">The build log loads when you are online.</p>';
  const sorted = [...notes].sort((a, b) => String(b.date ?? '').localeCompare(String(a.date ?? '')) || compareVersion(b.version, a.version));
  return `<ol class="prof-log">${sorted.map((n) => `
    <li class="prof-log-item">
      <div class="prof-log-meta"><span class="prof-log-ver">v${esc(n.version)}</span><span class="prof-log-dot">·</span><span>${esc(formatDate(n.date) || n.date || '')}</span></div>
      <p class="prof-log-text">${esc(n.text)}</p>
    </li>`).join('')}</ol>`;
}

// ---- Shared bits ----

let cleanups = [];
const runCleanups = () => { for (const fn of cleanups.splice(0)) { try { fn(); } catch {} } };

const tile = (icon, hue) => `<span class="prof-tile" style="--prof-hue:${hue}">${icon}</span>`;

const row = ({ href, icon, hue, label, value = '', data = '', danger = false, chevron = true }) => {
  const inner = `${tile(icon, hue)}<span class="prof-item-label">${label}</span>${value ? `<span class="prof-item-value">${esc(value)}</span>` : ''}${chevron ? `<span class="prof-chev">${icons.chevronRight}</span>` : ''}`;
  const cls = `prof-item${danger ? ' prof-item-danger' : ''}`;
  return href ? `<a class="${cls}" href="${href}">${inner}</a>` : `<button class="${cls}" type="button" ${data}>${inner}</button>`;
};

const subHeader = (title, back = '#profile', extraClass = '') => `
  <header class="screen-header prof-subhead ${extraClass}">
    <button class="icon-btn" type="button" data-back="${back}" aria-label="Back">${icons.back}</button>
    <h1 class="screen-title">${esc(title)}</h1>
  </header>`;

const intro = (icon, hue, text) => `<div class="prof-intro">${tile(icon, hue)}<p class="muted">${text}</p></div>`;

const sentNote = (on, text) => (on ? `<p class="prof-sent">${icons.check}<span>${esc(text)}</span></p>` : '');

// ---- Passcode sheet (set / change / turn off) ----

function openPinSheet(el, ctx, mode, done) {
  const sheet = document.createElement('div');
  sheet.className = 'prof-sheet';
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');
  sheet.setAttribute('aria-label', 'Passcode');
  sheet.innerHTML = `
    <div class="prof-sheet-top"><button class="icon-btn" type="button" data-close aria-label="Cancel">${icons.close}</button></div>
    <div class="prof-sheet-pad" data-pad></div>`;
  el.append(sheet);

  const T = {
    current: ['Enter your current passcode', ''],
    new: [mode === 'change' ? 'Choose a new passcode' : 'Choose a passcode', 'Four digits you will remember'],
    confirm: ['Enter it once more', 'To be sure it’s right'],
  };
  let step = mode === 'set' ? 'new' : 'current';
  let first = '';

  const pad = mountPinPad(sheet.querySelector('[data-pad]'), {
    title: T[step][0],
    hint: T[step][1],
    async onComplete(pin, p) {
      if (step === 'current') {
        if ((await sha256hex(pin)) !== getSetting('passcode', null)) { p.shake('That’s not it. Try again.'); return; }
        if (mode === 'off') {
          setSetting('passcode', null);
          p.success();
          close();
          ctx.toast('Passcode turned off');
          done();
          return;
        }
        step = 'new';
        p.next(...T.new);
        return;
      }
      if (step === 'new') {
        first = pin;
        step = 'confirm';
        p.next(...T.confirm);
        return;
      }
      if (pin !== first) {
        step = 'new';
        first = '';
        p.shake('Those didn’t match. Choose again.', T.new[0]);
        return;
      }
      setSetting('passcode', await sha256hex(pin));
      // This session stays unlocked; the lock screen appears next time Dreaming is opened or left.
      try { sessionStorage.setItem('dreaming.unlocked', '1'); } catch {}
      p.success();
      close();
      ctx.toast(mode === 'change' ? 'Passcode changed' : 'Passcode is on');
      done();
    },
  });

  const onEsc = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onEsc);
  function close() {
    pad.destroy();
    document.removeEventListener('keydown', onEsc);
    sheet.remove();
  }
  sheet.querySelector('[data-close]').addEventListener('click', close);
  cleanups.push(close);
}

// ---- Plan card (Free / Dreaming Plus) ----

/** One allowance: what is left this month ("50 left of 60"); the bar empties as it is used. */
function usageLine(label, used, limit) {
  const left = Math.max(0, limit - used);
  const pct = limit ? Math.min(100, Math.round((left / limit) * 100)) : 0;
  return `
    <div class="prof-plan-use">
      <span class="prof-plan-use-label">${esc(label)}</span>
      <span class="prof-plan-use-num"><b>${left}</b> left of ${limit}</span>
      <span class="prof-plan-bar" role="progressbar" aria-label="${esc(label)} left this month" aria-valuemin="0" aria-valuemax="${limit}" aria-valuenow="${left}"><i style="width:${pct}%"></i></span>
    </div>`;
}

/** A Plus-only feature on the free plan: its name and the PLUS pill instead of a usage bar. */
function lockedLine(label) {
  return `
    <div class="prof-plan-use prof-plan-locked">
      <span class="prof-plan-use-label">${esc(label)}</span>
      ${plusPill()}
    </div>`;
}

function planCard() {
  const acc = cachedAccount();
  const plus = acc?.plan === 'plus';
  const until = plus ? formatUntil(acc.plusUntil) : '';
  const limits = planLimits();
  const lim = acc?.limits || (plus ? limits.plus : limits.free);
  const used = acc?.used || null;
  const left = allowanceLine('images', remaining('images'));
  return `
    <section class="glass prof-plan${plus ? ' is-plus' : ''}" data-plan-card aria-label="Your plan">
      <div class="prof-plan-head">
        <span class="prof-plan-icon">${icons.sparkle}</span>
        <span class="prof-plan-who">
          <span class="prof-plan-kicker">Your plan</span>
          <span class="prof-plan-title">${plus ? `Dreaming Plus ${plusPill()}` : 'Free'}</span>
          <span class="prof-plan-sub">${plus ? (until ? `Until ${esc(until)}` : 'Active') : esc(left || 'Dreaming Plus adds AI videos, more images, interpretations, sounds and analyses.')}</span>
        </span>
      </div>
      ${used
        ? `<div class="prof-plan-usage">
            <p class="prof-plan-usage-title">This month</p>
            ${usageLine('AI images', used.images || 0, lim.images ?? 0)}
            ${plus ? usageLine('Video credits', used.videos || 0, lim.videos ?? limits.plus.videos) : lockedLine('AI videos')}
            ${usageLine('Interpretations', used.analyses || 0, lim.analyses ?? 0)}
            ${plus ? '<p class="prof-plan-note">1 video credit = 1 second of Standard video. HD uses 2 per second.</p>' : ''}
            <p class="prof-plan-note">Everything fills up again on ${esc(renewDate(acc.period))}.</p>
          </div>`
        : '<p class="prof-plan-note prof-plan-offline">Your monthly usage shows once Dreaming is online.</p>'}
      <a class="btn ${plus ? 'btn-ghost' : ''} prof-plan-btn" href="#plus">${plus ? 'View my plan' : 'See plans'}</a>
    </section>`;
}

function redeemPage() {
  const acc = cachedAccount();
  const plus = acc?.plan === 'plus';
  const until = plus ? formatUntil(acc.plusUntil) : '';
  return `
    ${subHeader('Redeem a code')}
    <section class="glass prof-card">
      ${intro(localIcons.ticket, 44, 'Have a Dreaming Plus code? Enter it to switch on Plus for this iPhone. No account or payment details needed.')}
      ${plus ? `<p class="prof-sent prof-redeem-active">${icons.check}<span>Dreaming Plus is active${until ? ` until ${esc(until)}` : ''}. A new code adds its time on top.</span></p>` : ''}
      <form class="prof-redeem" data-redeem-form>
        <label class="prof-redeem-label" for="prof-redeem-code">Your code</label>
        <input class="field prof-redeem-input" id="prof-redeem-code" name="code" maxlength="40" autocomplete="off"
          autocapitalize="characters" spellcheck="false" enterkeyhint="go" placeholder="e.g. DREAM-1234">
        <button class="btn" type="submit" data-redeem-btn>Redeem</button>
        <p class="prof-redeem-msg" data-redeem-msg role="status" hidden></p>
      </form>
    </section>
    <p class="prof-group-note">Plus belongs to this iPhone’s anonymous Dreaming ID. Your dreams stay on this phone either way.</p>
  `;
}

// ---- Pages ----

function mainPage(ctx) {
  const profile = getProfile();
  const stats = getStats();
  const lv = levelFor(stats.total);
  const name = String(profile.name ?? '').trim();
  const initial = name ? esc([...name][0].toUpperCase()) : icons.moon;
  const toNext = lv.nextMin != null ? lv.nextMin - stats.total : 0;
  const morningOn = getSetting('reminderMorning', false) === true;
  const realityOn = getSetting('realityReminders', false) === true;
  const remindersOn = (morningOn ? 1 : 0) + (realityOn ? 1 : 0);
  const v = ctx.version;

  return `
    <h1 class="screen-title">Settings</h1>

    <section class="glass prof-hero" aria-label="Your profile">
      <div class="prof-hero-top">
        <span class="prof-avatar${name ? '' : ' is-empty'}">${initial}</span>
        <div class="prof-who" data-who>
          <div class="prof-name-row">
            <h2 class="prof-name${name ? '' : ' is-empty'}">${name ? esc(name) : 'Add your name'}</h2>
            <button class="prof-edit" type="button" data-edit-name aria-label="Edit name">${icons.edit}</button>
          </div>
          <p class="prof-count">${stats.total} ${stats.total === 1 ? 'dream' : 'dreams'} recorded</p>
        </div>
      </div>
      <form class="prof-name-form" data-name-form hidden>
        <input class="field prof-name-input" type="text" name="name" maxlength="40" autocomplete="given-name"
          enterkeyhint="done" placeholder="Your name" value="${esc(name)}" aria-label="Your name">
        <button class="btn prof-name-save" type="submit">Save</button>
      </form>
      <div class="prof-level">
        <span class="prof-level-pill">${icons.star}<span>Level ${lv.level} · ${esc(lv.name)}</span></span>
        ${lv.nextMin != null ? `<span class="prof-level-next">${toNext} more to ${esc(lv.nextName)}</span>` : '<span class="prof-level-next">Highest level</span>'}
      </div>
      <div class="prof-level-bar" role="progressbar" aria-label="Progress to the next level" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(lv.progress * 100)}">
        <span style="width:${Math.round(lv.progress * 100)}%"></span>
      </div>
    </section>

    ${planCard()}

    <div class="glass prof-group">
      ${row({ href: '#profile/redeem', icon: localIcons.ticket, hue: 44, label: 'Redeem a code' })}
    </div>

    <div class="glass prof-group">
      ${row({ href: '#profile/notifications', icon: icons.bell, hue: 265, label: 'Notifications', value: remindersOn ? 'On' : 'Off' })}
      ${row({ href: '#profile/passcode', icon: icons.lock, hue: 210, label: 'Passcode lock', value: getSetting('passcode', null) ? 'On' : 'Off' })}
      ${row({ href: '#profile/export', icon: localIcons.download, hue: 160, label: 'Export journal' })}
    </div>

    <div class="glass prof-group">
      ${row({ href: '#profile/account', icon: icons.profile, hue: 290, label: 'Account', value: 'Not needed' })}
    </div>

    <div class="glass prof-group">
      <label class="prof-item prof-item-switch">
        ${tile(localIcons.flask, 42)}
        <span class="prof-item-label">Dream interpretation <span class="prof-beta">beta</span></span>
        <input class="prof-switch" type="checkbox" role="switch" data-interpret ${getSetting('interpretBeta', false) === true ? 'checked' : ''}>
      </label>
    </div>
    <p class="prof-group-note">Labs. When you tap ‘Analyze’ on a dream, only that dream’s text is sent to Dreaming’s server to be interpreted. The rest of your journal stays on this iPhone.</p>

    <div class="glass prof-group">
      ${row({ href: '#profile/personalise', icon: localIcons.sliders, hue: 320, label: 'Personalisation' })}
    </div>

    <div class="glass prof-group">
      ${row({ icon: icons.star, hue: 48, label: 'Add sample dreams', value: '7 examples', data: 'data-samples', chevron: false })}
      ${stats.total ? row({ icon: icons.trash, hue: 0, label: 'Delete all dreams', data: 'data-clear', danger: true, chevron: false }) : ''}
    </div>

    <div class="glass prof-group">
      ${row({ href: '#profile/about', icon: icons.info, hue: 230, label: 'About', value: v?.version != null ? `Version ${v.version}` : '' })}
    </div>

    <p class="prof-footer">Dreaming keeps your dreams on this iPhone only.</p>
  `;
}

function notificationsPage() {
  const time = getSetting('reminderTime', '07:00');
  const morningOn = getSetting('reminderMorning', false) === true;
  const realityOn = getSetting('realityReminders', false) === true;
  const chosen = new Set(getSetting('realityTimes', REALITY_DEFAULT));
  const n = REALITY_SLOTS.filter((t) => chosen.has(t)).length;

  return `
    ${subHeader('Notifications')}
    <p class="prof-lead">A Home Screen web app can’t send notifications on its own, so Dreaming adds repeating events to your iPhone Calendar instead, and Calendar does the reminding.</p>

    <h2 class="section-title">Morning dream recall</h2>
    <section class="glass prof-card">
      ${intro(icons.bell, 265, 'Dreams fade within minutes of waking. A daily nudge helps you write yours down while it’s still there.')}
      <label class="prof-row">
        <span class="prof-label">Remind me at</span>
        <input class="prof-time" type="time" value="${esc(validTime(time) ? time : '07:00')}" data-time>
      </label>
      <div class="prof-actions">
        <button class="btn" type="button" data-morning>${icons.calendar}<span>Add morning reminder to Calendar</span></button>
        ${sentNote(morningOn, 'Sent to Calendar. To move it, delete the old event there and add it again.')}
      </div>
    </section>

    <h2 class="section-title">Reality checks</h2>
    <section class="glass prof-card">
      ${intro(icons.lucidity, 42, 'Short prompts during the day to stop and ask “am I dreaming?”. The habit can carry over into your dreams and help you notice when you’re in one.')}
      <div class="prof-slots" role="group" aria-label="Reality check times">
        ${REALITY_SLOTS.map((t) => `<button class="prof-slot" type="button" data-slot="${t}" aria-pressed="${chosen.has(t)}">${esc(clock(t))}</button>`).join('')}
      </div>
      <div class="prof-actions">
        <button class="btn" type="button" data-reality ${n ? '' : 'disabled'}>${icons.calendar}<span>${n ? `Add ${n} daily ${n === 1 ? 'check' : 'checks'} to Calendar` : 'Pick at least one time'}</span></button>
        ${sentNote(realityOn, 'Sent to Calendar.')}
        <p class="prof-note">Each one repeats every day. To stop them, delete the events in Calendar.</p>
      </div>
    </section>
  `;
}

function passcodePage() {
  const on = Boolean(getSetting('passcode', null));
  return `
    ${subHeader('Passcode lock')}
    <section class="glass prof-card">
      ${intro(icons.lock, 210, on
        ? 'Dreaming asks for your passcode each time you open it or come back to it.'
        : 'Ask for a 4-digit passcode each time Dreaming opens, so nobody else can read your journal on this iPhone.')}
      <div class="prof-row prof-row-top"><span class="prof-label">Passcode</span><span class="prof-value">${on ? 'On' : 'Off'}</span></div>
      <div class="prof-actions">
        ${on
          ? `<button class="btn btn-ghost" type="button" data-pin="change">Change passcode</button>
             <button class="btn btn-danger" type="button" data-pin="off">Turn passcode off</button>`
          : '<button class="btn" type="button" data-pin="set">Turn passcode on</button>'}
      </div>
    </section>
    <p class="prof-lead prof-lead-after">The passcode keeps others out of the app. It doesn’t encrypt what’s stored, and it can’t be recovered: if you forget it, the only way back in is to erase the journal. Exporting a backup now and then keeps your dreams safe.</p>
  `;
}

function exportPage() {
  const total = getStats().total;
  return `
    ${subHeader('Export journal')}
    <h2 class="section-title">Backup</h2>
    <section class="glass prof-card">
      ${intro(localIcons.download, 160, 'Your whole journal as one file. Keep it in Files or iCloud Drive and import it here, or on another iPhone, whenever you need it.')}
      <div class="prof-actions">
        <button class="btn" type="button" data-export ${total ? '' : 'disabled'}>${localIcons.download}<span>Export backup (.json)</span></button>
        <button class="btn btn-ghost" type="button" data-import>${icons.addSquare}<span>Import a backup</span></button>
        <input type="file" accept="application/json,.json" hidden data-file>
        <p class="prof-note">Importing adds dreams you don’t have yet. Nothing here gets overwritten.</p>
      </div>
    </section>

    <h2 class="section-title">Readable copy</h2>
    <section class="glass prof-card">
      ${intro(icons.book, 30, 'Your dreams as plain pages, oldest first: to read, print, or keep as a PDF.')}
      <div class="prof-actions">
        <a class="btn btn-ghost" href="#profile/print">${localIcons.printer}<span>Print or save as PDF</span></a>
        <button class="btn btn-ghost" type="button" data-txt ${total ? '' : 'disabled'}>${localIcons.text}<span>Share as text (.txt)</span></button>
      </div>
    </section>
  `;
}

function printPage() {
  const n = listDreams().length;
  const canPrint = typeof window.print === 'function';
  return `
    <div class="prof-noprint">
      ${subHeader('Readable journal', '#profile/export')}
      <div class="prof-print-actions">
        ${canPrint ? `<button class="btn" type="button" data-print ${n ? '' : 'disabled'}>${localIcons.printer}<span>Print</span></button>` : ''}
        <button class="btn btn-ghost" type="button" data-html ${n ? '' : 'disabled'}>${icons.share}<span>Share file</span></button>
      </div>
      <p class="prof-note prof-print-hint">In the print screen you can also save it as a PDF. If printing doesn’t open, share the file and open it in Safari or Files.</p>
    </div>
    <div class="prof-paper">
      <h1 class="prof-paper-h1">Dream journal</h1>
      <p class="prof-paper-sub">Dreaming · exported ${esc(formatDate(localDay()))} · ${n} ${n === 1 ? 'dream' : 'dreams'}</p>
      ${journalArticles()}
    </div>
  `;
}

function accountPage() {
  return `
    ${subHeader('Account')}
    <section class="glass prof-card prof-account">
      <span class="prof-account-icon">${icons.profile}</span>
      <h2 class="prof-account-title">No account needed</h2>
      <p class="muted">Dreaming works without signing up: no login, no password, and no copy of your journal on a server. Everything stays inside this app on this iPhone.</p>
      <p class="muted">That also means nobody can restore it for you. Removing Dreaming from your Home Screen can erase its data, so export a backup now and then, and before you switch phones.</p>
      <div class="prof-actions prof-actions-flush">
        <a class="btn btn-ghost" href="#profile/export">${localIcons.download}<span>Export journal</span></a>
      </div>
    </section>
  `;
}

const GOAL_LABEL = { analysis: 'Understand my dreams', lucid: 'Lucid dreaming', journal: 'Keep a dream journal' };

function personalisePage() {
  const p = getProfile();
  const rows = [];
  if (p.name) rows.push(['Name', p.name]);
  if (p.mainGoal) rows.push(['Main goal', GOAL_LABEL[p.mainGoal] || p.mainGoal]);
  if (p.sleepSchedule?.bedtime && p.sleepSchedule?.wake) rows.push(['Usual sleep', `${clock(p.sleepSchedule.bedtime)} – ${clock(p.sleepSchedule.wake)}`]);
  if (Number(p.monthlyGoal) > 0) rows.push(['Monthly goal', `${Number(p.monthlyGoal)} dreams`]);
  return `
    ${subHeader('Personalisation')}
    <section class="glass prof-card">
      ${intro(localIcons.sliders, 320, 'Your answers to the welcome questions shape what Dreaming suggests. Go through them again any time; your dreams stay exactly as they are.')}
      ${rows.map(([k, val]) => `<div class="prof-row"><span class="prof-label">${esc(k)}</span><span class="prof-value">${esc(val)}</span></div>`).join('')}
      <div class="prof-actions">
        <button class="btn" type="button" data-redo>${icons.repeat}<span>Redo the welcome questions</span></button>
      </div>
    </section>
  `;
}

function aboutPage(ctx) {
  const v = ctx.version;
  const updated = formatDate(v?.updated);
  return `
    ${subHeader('About')}
    <section class="glass prof-card">
      <div class="prof-row"><span class="prof-label">Version</span><span class="prof-value">${esc(v?.version ?? '—')}</span></div>
      <div class="prof-row"><span class="prof-label">Last updated</span><span class="prof-value">${esc(updated || '—')}</span></div>
      <div class="prof-row"><span class="prof-label">On Home Screen</span><span class="prof-value">${ctx.isStandalone() ? 'Yes' : 'Not yet'}</span></div>
      <div class="prof-actions">
        <button class="btn btn-ghost" type="button" data-check>Check for updates</button>
      </div>
      <details class="prof-details">
        <summary class="prof-summary"><span>Build log</span>${icons.chevronRight}</summary>
        ${buildLog(v?.notes)}
      </details>
    </section>

    <h2 class="section-title">Privacy</h2>
    <section class="glass prof-card prof-text-card">
      <p class="muted">Your dreams, goals and answers are stored only in this app on this iPhone. Dreaming has no account, no ads and no trackers.</p>
      <p class="muted">Only a few things ever go online: checking for app updates, which sends nothing about you; checking your plan and monthly allowance, which sends only this iPhone’s anonymous Dreaming ID; and dream interpretation, AI images or AI videos, which send a single dream’s text, and only when you ask for them.</p>
    </section>

    <p class="prof-footer">Made with care for curious dreamers.</p>
  `;
}

const PAGES = {
  notifications: notificationsPage,
  passcode: passcodePage,
  export: exportPage,
  print: printPage,
  account: accountPage,
  personalise: personalisePage,
  about: aboutPage,
  redeem: redeemPage,
};
const ALIASES = { reminders: 'notifications', reminder: 'notifications', lock: 'passcode', import: 'export', personalization: 'personalise', code: 'redeem' };

// ---- Wiring ----

function draw(el, ctx, param) {
  runCleanups();
  const key = ALIASES[param] || param;
  const page = PAGES[key] ? key : 'main';
  if (page === 'main') setSetting('reminderAsked', true);

  el.innerHTML = `<div class="prof prof-page-${page}">${page === 'main' ? mainPage(ctx) : PAGES[page](ctx)}</div>`;
  const $ = (sel) => el.querySelector(sel);
  const redraw = () => draw(el, ctx, param);

  for (const b of el.querySelectorAll('[data-back]')) b.addEventListener('click', () => ctx.navigate(b.dataset.back));

  // Main list
  const nameForm = $('[data-name-form]');
  if (nameForm) {
    $('[data-edit-name]').addEventListener('click', () => {
      $('[data-who]').classList.add('is-editing');
      nameForm.hidden = false;
      const input = nameForm.querySelector('input');
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    });
    nameForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const value = nameForm.querySelector('input').value.trim().slice(0, 40);
      setProfile({ name: value });
      ctx.toast(value ? 'Name saved' : 'Name removed');
      redraw();
    });
  }

  $('[data-interpret]')?.addEventListener('change', (e) => {
    const on = e.target.checked;
    setSetting('interpretBeta', on);
    ctx.toast(on ? 'Dream interpretation is on' : 'Dream interpretation is off');
  });

  $('[data-samples]')?.addEventListener('click', () => {
    if (getStats().total && !confirm('Add 7 example dreams to your journal? You can delete them one by one later.')) return;
    addSampleDreams();
    ctx.toast('Sample dreams added');
    redraw();
  });

  $('[data-clear]')?.addEventListener('click', () => {
    const n = getStats().total;
    if (!confirm(`Delete all ${n} ${n === 1 ? 'dream' : 'dreams'}? This can’t be undone.`)) return;
    clearAll();
    ctx.toast('All dreams deleted');
    redraw();
  });

  // Notifications
  $('[data-time]')?.addEventListener('change', (e) => {
    if (validTime(e.target.value)) setSetting('reminderTime', e.target.value);
  });
  $('[data-morning]')?.addEventListener('click', () => {
    const t = validTime($('[data-time]').value) ? $('[data-time]').value : getSetting('reminderTime', '07:00');
    setSetting('reminderTime', t);
    sendToCalendar([morningEvent(t)], 'dreaming-morning-reminder.ics');
    setSetting('reminderMorning', true);
    setTimeout(redraw, 600);
  });
  for (const b of el.querySelectorAll('[data-slot]')) {
    b.addEventListener('click', () => {
      const set = new Set(getSetting('realityTimes', REALITY_DEFAULT));
      if (set.has(b.dataset.slot)) set.delete(b.dataset.slot); else set.add(b.dataset.slot);
      setSetting('realityTimes', REALITY_SLOTS.filter((t) => set.has(t)));
      redraw();
    });
  }
  $('[data-reality]')?.addEventListener('click', () => {
    const times = REALITY_SLOTS.filter((t) => new Set(getSetting('realityTimes', REALITY_DEFAULT)).has(t));
    if (!times.length) return;
    sendToCalendar(times.map(realityEvent), 'dreaming-reality-checks.ics');
    setSetting('realityReminders', true);
    setTimeout(redraw, 600);
  });

  // Passcode
  for (const b of el.querySelectorAll('[data-pin]')) {
    b.addEventListener('click', () => openPinSheet(el, ctx, b.dataset.pin, redraw));
  }

  // Export / import
  $('[data-export]')?.addEventListener('click', () => {
    shareOrDownload(ctx, exportData(), `dreaming-${localDay()}.json`, 'application/json', 'Backup exported')
      .catch(() => ctx.toast('Could not export the journal'));
  });
  const fileInput = $('[data-file]');
  if (fileInput) {
    $('[data-import]').addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files?.[0];
      fileInput.value = '';
      if (!file) return;
      try {
        const n = importData(await file.text());
        ctx.toast(n === 0 ? 'No new dreams in that file' : n === 1 ? 'Added 1 dream' : `Added ${n} dreams`);
        redraw();
      } catch (err) {
        ctx.toast(err instanceof SyntaxError ? 'That file isn’t a Dreaming backup' : (err?.message || 'Could not import that file'));
      }
    });
  }
  $('[data-txt]')?.addEventListener('click', () => {
    shareOrDownload(ctx, journalText(), `dreaming-journal-${localDay()}.txt`, 'text/plain', 'Journal saved as text')
      .catch(() => ctx.toast('Could not export the journal'));
  });
  $('[data-print]')?.addEventListener('click', () => {
    try { window.print(); } catch { ctx.toast('Printing isn’t available here. Try Share file.'); }
  });
  $('[data-html]')?.addEventListener('click', () => {
    shareOrDownload(ctx, journalHtmlFile(), `dreaming-journal-${localDay()}.html`, 'text/html', 'Journal saved')
      .catch(() => ctx.toast('Could not share the journal'));
  });

  // Personalisation
  $('[data-redo]')?.addEventListener('click', () => {
    setProfile({ onboarded: false });
    ctx.navigate('#onboarding');
  });

  // About
  $('[data-check]')?.addEventListener('click', () => ctx.checkForUpdate('manual'));

  // Redeem a code
  const redeemForm = $('[data-redeem-form]');
  if (redeemForm) {
    const input = redeemForm.querySelector('input');
    const btn = redeemForm.querySelector('[data-redeem-btn]');
    const msg = redeemForm.querySelector('[data-redeem-msg]');
    const say = (text, ok) => {
      msg.hidden = false;
      msg.className = `prof-redeem-msg${ok ? ' is-ok' : ' is-error'}`;
      msg.innerHTML = ok ? `${icons.check}<span>${esc(text)}</span>` : `<span>${esc(text)}</span>`;
    };
    redeemForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const code = input.value.trim();
      if (!code) { say('Type your code first.', false); input.focus(); return; }
      btn.disabled = true;
      btn.textContent = 'Checking…';
      try {
        const view = await redeem(code);
        const until = formatUntil(view?.plusUntil);
        input.value = '';
        say(`Dreaming Plus is active${until ? ` until ${until}` : ''}.`, true);
        ctx.toast('Dreaming Plus is active');
      } catch (err) {
        const offline = err instanceof TypeError || /fetch|network|load failed/i.test(String(err?.message || ''));
        say(offline ? 'Could not reach Dreaming. Check your connection and try again.' : (err?.message || 'That code did not work.'), false);
      }
      btn.disabled = false;
      btn.textContent = 'Redeem';
    });
    if (param === 'redeem' || param === 'code') requestAnimationFrame(() => input.focus({ preventScroll: true }));
  }
}

// The plan card follows the account (redeemed code, new month, plan ended) without redrawing the whole page.
let offAccount = null;
function watchAccount(el) {
  offAccount?.();
  const onAccount = () => {
    const card = el.querySelector('[data-plan-card]');
    if (card) card.outerHTML = planCard();
  };
  window.addEventListener('dreaming:account', onAccount);
  offAccount = () => window.removeEventListener('dreaming:account', onAccount);
}

export default {
  id: 'profile',
  label: 'Settings',
  icon: icons.settings,
  // The printable journal hides the tab bar so it doesn't end up on paper.
  get hideTabbar() {
    try { return /^#profile\/print(\/|$)/.test(location.hash); } catch { return false; }
  },

  render(el, ctx, param) {
    draw(el, ctx, param);
    watchAccount(el);
    // Fresh plan state; a new answer arrives as a 'dreaming:account' event and repaints the card.
    getAccount().catch(() => {});
  },

  destroy() {
    runCleanups();
    offAccount?.();
    offAccount = null;
  },
};
