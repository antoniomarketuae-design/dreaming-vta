// Technique guide (#technique/<id>): what it is, when to use it, steps, tips and common mistakes,
// plus a small tool where one helps (reality-check reminders, a WBTB alarm calculator, the audio cue).
// Locked techniques show what they are and how many dreams are still needed.
import { TECHNIQUES, dreamCount } from '../progress.js';
import { markSeen, getSetting, setSetting, getProfile } from '../store.js';
import { esc, icons } from '../ui.js';
import { getTechniqueContent, techniqueGlyph, SECTION_LABELS, TECHNIQUE_CONTENT } from '../content/techniques.js';
import { getArticle } from '../content/articles.js';
import * as audio from '../audio.js';

const pad = (n) => String(n).padStart(2, '0');
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// ---- Reality-check reminders as calendar events (.ics) ----

/** Slightly irregular times, so the reminders don't become background noise. */
const RC_SETS = {
  3: ['11:10', '15:40', '20:05'],
  5: ['10:05', '12:40', '15:10', '17:35', '20:15'],
  8: ['09:35', '11:10', '12:45', '14:20', '15:55', '17:25', '18:50', '20:20'],
};

const icsLocal = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
const icsUtc = (d) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
const icsText = (s) => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** Folds a content line to at most 75 octets per physical line (RFC 5545). */
function fold(line) {
  const enc = new TextEncoder();
  const out = [];
  let cur = '';
  let bytes = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (bytes + n > (out.length ? 74 : 75)) { out.push(cur); cur = ''; bytes = 0; }
    cur += ch;
    bytes += n;
  }
  out.push(cur);
  return out.join('\r\n ');
}

function nextAt(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m, 0, 0);
  if (d <= now) d.setDate(d.getDate() + 1);
  return d;
}

function buildRealityIcs(times) {
  const appUrl = location.href.split('#')[0];
  const now = new Date();
  const summary = 'Reality check: am I dreaming?';
  const desc = `Pause. Pinch your nose and try to breathe, read something twice, then ask how you got here. ${appUrl}`;
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Dreaming//Reality checks//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
  times.forEach((t, i) => {
    lines.push(
      'BEGIN:VEVENT',
      `UID:rc-${now.getTime().toString(36)}-${i}-${Math.random().toString(36).slice(2, 8)}@dreaming`,
      `DTSTAMP:${icsUtc(now)}`,
      `DTSTART:${icsLocal(nextAt(t))}`,
      'DURATION:PT5M',
      'RRULE:FREQ=DAILY',
      `SUMMARY:${icsText(summary)}`,
      `DESCRIPTION:${icsText(desc)}`,
      `URL:${appUrl}`,
      'TRANSP:TRANSPARENT',
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      'TRIGGER:PT0M',
      `DESCRIPTION:${icsText(summary)}`,
      'END:VALARM',
      'END:VEVENT',
    );
  });
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/** iPhone shows its "Add to Calendar" sheet for a text/calendar page; elsewhere the file is downloaded. */
function openIcs(text, filename) {
  const blob = new Blob([text], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  if (isIOS()) {
    location.href = url;
  } else {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

function remindersTool() {
  const n = getSetting('realityRemindersPerDay', 5);
  const times = RC_SETS[n] || RC_SETS[5];
  const added = getSetting('realityReminders', false);
  return `
    <section class="glass tech-card tech-tool" data-rc-tool>
      <h2 class="tech-h"><span class="tech-h-icon">${icons.bell}</span>Reminders</h2>
      <p>Daily calendar alerts nudge you to stop and check. Your Calendar app shows them, so they work even when Dreaming is closed.</p>
      <div class="tech-seg" role="group" aria-label="Reminders per day">
        ${Object.keys(RC_SETS).map((k) => `<button type="button" class="chip tech-seg-btn" data-rc-count="${k}" aria-pressed="${Number(k) === n ? 'true' : 'false'}">${k} a day</button>`).join('')}
      </div>
      <p class="tech-times">${times.join(' · ')}</p>
      <button type="button" class="btn" data-rc-add>${icons.calendar}<span>Add reality-check reminders</span></button>
      ${added ? `<p class="tech-done">${icons.check}<span>Reminders added. You can change or delete them in your Calendar app.</span></p>` : ''}
    </section>`;
}

function checksList(c) {
  return `
    <section class="glass tech-card">
      <h2 class="tech-h">Checks to try</h2>
      <ul class="tech-checks">
        ${c.checks.map((k) => `
          <li>
            <b>${esc(k.name)}</b>
            <span>${esc(k.how)}</span>
            <span class="tech-dream">${icons.sparkle}${esc(k.dream)}</span>
          </li>`).join('')}
      </ul>
    </section>`;
}

// ---- Wake back to bed: alarm calculator ----

function addMinutes(hhmm, minutes) {
  const [h, m] = (/^\d{1,2}:\d{2}$/.test(hhmm) ? hhmm : '23:30').split(':').map(Number);
  const total = (((h * 60 + m + minutes) % 1440) + 1440) % 1440;
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}

function wbtbResult(bed) {
  return `Set an alarm for about <b>${addMinutes(bed, 300)}</b>, 5 hours after you fall asleep. Anywhere from ${addMinutes(bed, 270)} to ${addMinutes(bed, 360)} works.`;
}

function wbtbTool() {
  const bed = getSetting('wbtbBedtime', getProfile().sleepSchedule?.bedtime || '23:30');
  return `
    <section class="glass tech-card tech-tool">
      <h2 class="tech-h"><span class="tech-h-icon">${icons.moon}</span>When to set the alarm</h2>
      <label class="tech-field">
        <span>I usually fall asleep around</span>
        <input type="time" class="field tech-time" value="${esc(bed)}" data-wbtb-bed>
      </label>
      <p class="tech-result" data-wbtb-out>${wbtbResult(bed)}</p>
      <p class="tech-small">Use your Clock app for the alarm. A web app can't wake you while the phone is locked.</p>
    </section>`;
}

// ---- Audio cue + conditioning practice ----

function cueTool(id, c) {
  const practice = id === 'conditioning';
  return `
    <section class="glass tech-card tech-tool">
      <h2 class="tech-h"><span class="tech-h-icon">${icons.bell}</span>The Dreaming cue</h2>
      <p>A soft bell made on your phone. Use this same sound for every practice and at night.</p>
      <button type="button" class="btn btn-ghost" data-cue>${icons.headphones}<span>Play the cue</span></button>
      ${practice ? `
        <div class="tech-practice" data-practice>
          <p class="tech-practice-status" data-practice-status>Practice session: the cue plays at random moments, every 1 to 4 minutes, for up to 30 minutes.</p>
          <button type="button" class="btn" data-practice-toggle>Start practice</button>
        </div>` : ''}
      ${c.honest ? `<p class="tech-small">${esc(c.honest)}</p>` : ''}
    </section>`;
}

function toolFor(id, c) {
  if (id === 'reality-checks') return remindersTool();
  if (id === 'wbtb') return wbtbTool();
  if (id === 'audio-cues' || id === 'conditioning') return cueTool(id, c);
  return '';
}

// ---- Shared pieces ----

function pairs(c, count) {
  const list = (c.pairsWith || []).map((pid) => TECHNIQUES.find((t) => t.id === pid)).filter(Boolean);
  if (!list.length) return '';
  return `
    <section class="tech-more">
      <h2 class="tech-h2">Pairs well with</h2>
      <div class="tech-pairs">
        ${list.map((t) => {
          const locked = count < t.unlockAt;
          return `
            <a class="glass tech-pair${locked ? ' is-locked' : ''}" href="#technique/${esc(t.id)}" style="--h:${TECHNIQUE_CONTENT[t.id]?.hue ?? 268}">
              <span class="tech-pair-art">${techniqueGlyph(t.id)}</span>
              <span class="tech-pair-name">${esc(t.name)}</span>
              ${locked ? `<span class="tech-pair-lock">${icons.lock}${t.unlockAt}</span>` : icons.chevronRight}
            </a>`;
        }).join('')}
      </div>
    </section>`;
}

function readMore(c) {
  const list = (c.articles || []).map(getArticle).filter(Boolean);
  if (!list.length) return '';
  return `
    <section class="tech-more">
      <h2 class="tech-h2">Read more</h2>
      <div class="tech-reads">
        ${list.map((a) => `
          <a class="glass tech-read" href="#article/${esc(a.id)}">
            <span class="tech-read-icon" style="--h:${a.hue}">${icons[a.icon] || icons.book}</span>
            <span class="tech-read-text"><b>${esc(a.title)}</b><span>${a.minutes} min read</span></span>
            ${icons.chevronRight}
          </a>`).join('')}
      </div>
    </section>`;
}

function lockPanel(t, count) {
  const toGo = Math.max(0, t.unlockAt - count);
  const pct = Math.round(Math.min(1, count / Math.max(1, t.unlockAt)) * 100);
  return `
    <section class="glass tech-lock">
      <span class="tech-lock-icon">${icons.lock}</span>
      <p class="tech-lock-title">Unlocks after ${plural(t.unlockAt, 'dream')}</p>
      <p class="tech-lock-sub">${toGo} to go. Every dream you write down brings it closer.</p>
      <span class="tech-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><i style="width:${pct}%"></i></span>
      <a class="btn" href="#record">${icons.plus}<span>Write a dream</span></a>
    </section>`;
}

let cleanup = [];

export default {
  id: 'technique',
  hideTabbar: true,

  render(el, ctx, param) {
    const t = TECHNIQUES.find((x) => x.id === param);
    const c = t && getTechniqueContent(t.id);
    if (!t || !c) {
      el.innerHTML = `
        <div class="tech">
          <header class="screen-header"><button type="button" class="icon-btn" data-back aria-label="Back">${icons.back}</button></header>
          <p class="muted tech-missing">This technique could not be found.</p>
          <a class="btn btn-ghost" href="#lucidity">Open Lucidity</a>
        </div>`;
      el.querySelector('[data-back]').addEventListener('click', () => ctx.back());
      return;
    }

    const count = dreamCount();
    const unlocked = count >= t.unlockAt;
    if (unlocked) markSeen(`technique:${t.id}`);

    el.innerHTML = `
      <article class="tech" style="--h:${c.hue ?? 268}">
        <header class="screen-header">
          <button type="button" class="icon-btn" data-back aria-label="Back">${icons.back}</button>
          <p class="tech-kicker">${esc(SECTION_LABELS[t.section] || 'Technique')}</p>
        </header>

        <section class="tech-hero">
          <div class="tech-art${unlocked ? '' : ' is-locked'}">${techniqueGlyph(t.id)}</div>
          <h1 class="tech-title">${esc(t.name)}</h1>
          <p class="tech-tagline">${esc(c.tagline)}</p>
          <div class="tech-meta">
            <span class="chip">${icons.moon}${esc(c.when)}</span>
            <span class="chip">${icons.target}${esc(c.level)}</span>
          </div>
        </section>

        ${unlocked ? '' : lockPanel(t, count)}

        <section class="glass tech-card">
          <h2 class="tech-h">What it is</h2>
          ${c.what.map((p) => `<p>${esc(p)}</p>`).join('')}
        </section>

        ${unlocked ? `
          ${toolFor(t.id, c)}
          <section class="glass tech-card">
            <h2 class="tech-h">When to use it</h2>
            <p>${esc(c.whenText)}</p>
          </section>
          <section class="glass tech-card">
            <h2 class="tech-h">Step by step</h2>
            <ol class="tech-steps">${c.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
          </section>
          ${c.checks ? checksList(c) : ''}
          <section class="glass tech-card">
            <h2 class="tech-h">Tips</h2>
            <ul class="tech-list tech-tips">${c.tips.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>
          </section>
          <section class="glass tech-card">
            <h2 class="tech-h">Common mistakes</h2>
            <ul class="tech-list tech-mistakes">${c.mistakes.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>
          </section>
          ${pairs(c, count)}
          ${readMore(c)}
        ` : `<p class="faint tech-later">The full step-by-step guide opens at ${plural(t.unlockAt, 'dream')}.</p>`}
      </article>`;

    el.querySelector('[data-back]').addEventListener('click', () => ctx.back());

    // Reality-check reminders
    const rcTool = () => el.querySelector('[data-rc-tool]');
    const onRc = (e) => {
      const countBtn = e.target.closest('[data-rc-count]');
      const addBtn = e.target.closest('[data-rc-add]');
      if (!countBtn && !addBtn) return;
      if (countBtn) {
        setSetting('realityRemindersPerDay', Number(countBtn.dataset.rcCount));
      } else {
        const n = getSetting('realityRemindersPerDay', 5);
        openIcs(buildRealityIcs(RC_SETS[n] || RC_SETS[5]), 'dreaming-reality-checks.ics');
        setSetting('realityReminders', true);
        ctx.toast(isIOS() ? 'Tap "Add All" to save the reminders' : 'Open the downloaded file to add the reminders');
      }
      const tool = rcTool();
      if (tool) tool.outerHTML = remindersTool();
    };
    // #screen outlives this page, so the delegated listener is removed in destroy().
    el.addEventListener('click', onRc);
    cleanup.push(() => el.removeEventListener('click', onRc));

    // WBTB alarm calculator
    const bedInput = el.querySelector('[data-wbtb-bed]');
    if (bedInput) {
      bedInput.addEventListener('input', () => {
        if (!/^\d{1,2}:\d{2}$/.test(bedInput.value)) return;
        setSetting('wbtbBedtime', bedInput.value);
        el.querySelector('[data-wbtb-out]').innerHTML = wbtbResult(bedInput.value);
      });
    }

    // Audio cue
    el.querySelector('[data-cue]')?.addEventListener('click', () => {
      if (!audio.playCue()) ctx.toast('Sound is not available in this browser');
    });

    // Conditioning practice: random cues while this screen is open
    const practiceBtn = el.querySelector('[data-practice-toggle]');
    if (practiceBtn) {
      const status = el.querySelector('[data-practice-status]');
      const LIMIT = 30 * 60000;
      let timer = null;
      let startedAt = 0;
      let cues = 0;
      const stopPractice = (msg) => {
        clearTimeout(timer);
        timer = null;
        practiceBtn.textContent = 'Start practice';
        if (msg) status.textContent = msg;
      };
      const schedule = () => {
        const wait = 60000 + Math.random() * 180000;
        if (Date.now() + wait - startedAt > LIMIT) {
          timer = setTimeout(() => stopPractice(`Session finished: ${plural(cues, 'cue')}. Nice work.`), Math.max(0, LIMIT - (Date.now() - startedAt)));
          return;
        }
        timer = setTimeout(() => {
          audio.playCue();
          cues += 1;
          status.textContent = `${plural(cues, 'cue')} so far. Each time: two reality checks, then look around.`;
          schedule();
        }, wait);
      };
      practiceBtn.addEventListener('click', () => {
        if (timer) { stopPractice(`Stopped after ${plural(cues, 'cue')}.`); return; }
        if (!audio.playCue(0.0001)) { ctx.toast('Sound is not available in this browser'); return; }
        startedAt = Date.now();
        cues = 0;
        practiceBtn.textContent = 'Stop practice';
        status.textContent = 'Listening… the first cue comes within a few minutes. Keep this screen open.';
        schedule();
      });
      cleanup.push(() => clearTimeout(timer));
    }
  },

  destroy() {
    for (const fn of cleanup) { try { fn(); } catch {} }
    cleanup = [];
  },
};
