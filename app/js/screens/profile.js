// Profile: morning reminder (via an .ics calendar event), data export/import, and app info.
// Touches document/window/localStorage only inside render and event handlers, never at import time.
import { getStats, getSetting, setSetting, exportData, importData, addSampleDreams, clearAll, localDay } from '../store.js';
import { esc, formatDate, icons } from '../ui.js';

const pad = (n) => String(n).padStart(2, '0');

/** "YYYYMMDDTHHMMSS" in local (floating) time. */
const icsLocal = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;

/** "YYYYMMDDTHHMMSSZ" in UTC. */
const icsUtc = (d) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;

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

/** Next Date at hh:mm local time (today if still ahead, else tomorrow). */
function nextOccurrence(hhmm) {
  const [h, m] = (/^\d{1,2}:\d{2}/.test(hhmm) ? hhmm : '07:00').split(':').map(Number);
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m, 0, 0);
  if (d <= now) d.setDate(d.getDate() + 1);
  return d;
}

function buildIcs(hhmm) {
  const appUrl = location.href.split('#')[0];
  const now = new Date();
  const uid = `${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 10)}@dreaming`;
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Dreaming//Dream Journal//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${icsUtc(now)}`,
    `DTSTART:${icsLocal(nextOccurrence(hhmm))}`,
    'DURATION:PT5M',
    'RRULE:FREQ=DAILY',
    `SUMMARY:${icsText('Record your dream 🌙')}`,
    `DESCRIPTION:${icsText(`Open Dreaming and write down last night's dream before it fades: ${appUrl}`)}`,
    `URL:${appUrl}`,
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    'TRIGGER:PT0M',
    `DESCRIPTION:${icsText('Record your dream 🌙')}`,
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
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

function addReminderToCalendar(hhmm) {
  const blob = new Blob([buildIcs(hhmm)], { type: 'text/calendar;charset=utf-8' });
  if (isIOS()) {
    // Navigating to a text/calendar resource makes iOS show its "Add to Calendar" sheet.
    const url = URL.createObjectURL(blob);
    location.href = url;
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } else {
    downloadBlob(blob, 'dreaming-reminder.ics');
  }
}

async function exportDreams(ctx) {
  const name = `dreaming-${localDay()}.json`;
  const json = exportData();
  let file = null;
  try { file = new File([json], name, { type: 'application/json' }); } catch {}
  if (file && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return;
    } catch (err) {
      if (err?.name === 'AbortError') return; // user closed the share sheet
    }
  }
  downloadBlob(new Blob([json], { type: 'application/json' }), name);
  ctx.toast('Dreams exported');
}

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

function draw(el, ctx) {
  setSetting('reminderAsked', true);
  const reminderTime = getSetting('reminderTime', '07:00');
  const stats = getStats();
  const v = ctx.version;
  const updated = formatDate(v?.updated);

  el.innerHTML = `
    <h1 class="screen-title">Profile</h1>

    <h2 class="section-title">Morning reminder</h2>
    <section class="glass prof-card">
      <div class="prof-intro">
        <span class="prof-intro-icon">${icons.bell}</span>
        <p class="muted">Dreams fade within minutes of waking.</p>
      </div>
      <label class="prof-row">
        <span class="prof-label">Remind me at</span>
        <input class="prof-time" type="time" value="${esc(reminderTime)}" data-time>
      </label>
      <div class="prof-actions">
        <button class="btn" type="button" data-calendar>${icons.calendar}<span>Add daily reminder to Calendar</span></button>
        <p class="prof-note faint">Your iPhone Calendar will remind you every morning.</p>
      </div>
    </section>

    <h2 class="section-title">Your dreams</h2>
    <section class="glass prof-card">
      <div class="prof-row"><span class="prof-label">Dreams recorded</span><span class="prof-value">${stats.total}</span></div>
      <div class="prof-row"><span class="prof-label">Lucid dreams</span><span class="prof-value">${stats.lucid}</span></div>
      <div class="prof-actions">
        <button class="btn btn-ghost" type="button" data-export ${stats.total ? '' : 'disabled'}>${icons.share}<span>Export dreams</span></button>
        <button class="btn btn-ghost" type="button" data-import>${icons.addSquare}<span>Import dreams</span></button>
        <input type="file" accept="application/json,.json" hidden data-file>
        <button class="btn btn-ghost" type="button" data-samples>${icons.star}<span>Try with sample dreams</span></button>
        ${stats.total ? `<button class="btn btn-danger" type="button" data-clear>${icons.trash}<span>Delete all dreams</span></button>` : ''}
      </div>
    </section>

    <h2 class="section-title">About</h2>
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

    <p class="prof-footer faint">Dreaming keeps your dreams on this iPhone only.</p>
  `;

  const $ = (sel) => el.querySelector(sel);
  const redraw = () => draw(el, ctx);

  $('[data-time]').addEventListener('change', (e) => {
    if (e.target.value) setSetting('reminderTime', e.target.value);
  });

  $('[data-calendar]').addEventListener('click', () => {
    const t = $('[data-time]').value || getSetting('reminderTime', '07:00');
    setSetting('reminderTime', t);
    addReminderToCalendar(t);
  });

  $('[data-export]').addEventListener('click', () => {
    exportDreams(ctx).catch(() => ctx.toast('Could not export dreams'));
  });

  const fileInput = $('[data-file]');
  $('[data-import]').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (!file) return;
    try {
      const n = importData(await file.text());
      ctx.toast(n === 1 ? 'Added 1 dream' : `Added ${n} dreams`);
      redraw();
    } catch (err) {
      ctx.toast(err instanceof SyntaxError ? 'That file is not a Dreaming export' : (err?.message || 'Could not import that file'));
    }
  });

  $('[data-samples]').addEventListener('click', () => {
    addSampleDreams();
    ctx.toast('Sample dreams added');
    redraw();
  });

  $('[data-clear]')?.addEventListener('click', () => {
    const n = getStats().total;
    if (!confirm(`Delete all ${n} dreams? This can't be undone.`)) return;
    clearAll();
    ctx.toast('All dreams deleted');
    redraw();
  });

  $('[data-check]').addEventListener('click', () => ctx.checkForUpdate('manual'));
}

export default {
  id: 'profile',
  label: 'Profile',
  icon: icons.profile,

  render(el, ctx) {
    draw(el, ctx);
  },
};
