// One dream (#dream/<id>): its picture, title and markers, then three tabs — Story · Details · Sleep —
// and an "Analyze" button that asks for the interpretation (beta). Sleep times are edited right here;
// everything else is edited in the editor (#record/edit/<id>).
// Routes: #dream/<id> · #dream/<id>/analyze (opens and starts Analyze) · #dream/<id>/edit (old link → editor).
import { getDream, updateDream, deleteDream, withDefaults, SYMBOL_CATEGORIES, setSetting } from '../store.js';
import { TAGS } from '../analyze.js';
import { esc, formatDate, relativeDay, icons } from '../ui.js';
import { dreamArtURL } from '../dreamart.js';
import { isEnabled, isPending, isStale, requestInterpretation, sendFeedback, startPolling } from '../interpret.js';

function artSrc(dream) {
  try { return dreamArtURL(dream, 420) || ''; } catch { return ''; }
}

const str = (v) => (typeof v === 'string' ? v.trim() : '');
const arr = (v) => (Array.isArray(v) ? v : []);
const dayDate = (iso) => new Date(`${iso}T00:00:00`);

/** Locale-based numeric date ("10.11.2026", "10/11/2026", ...) plus "Today"/"Yesterday"/"N days ago". */
function whenLabel(iso) {
  if (!iso) return '';
  const d = dayDate(iso);
  if (Number.isNaN(d.getTime())) return '';
  const num = d.toLocaleDateString(undefined, { day: '2-digit', month: '2-digit', year: 'numeric' });
  const rel = relativeDay(iso);
  return rel && rel !== formatDate(iso) ? `${num} · ${rel}` : num;
}

const longDate = (iso) => {
  const d = iso ? dayDate(iso) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }) : '';
};

// ---- Display helpers for the Story / Details / Sleep tabs ----

const CATEGORY_LABELS = { people: 'People', objects: 'Objects', characters: 'Characters', places: 'Places', themes: 'Themes', actions: 'Actions' };

const SCALES = {
  rating: ['Very bad', 'Bad', 'Okay', 'Good', 'Very good'],
  length: ['Very short', 'Short', 'Medium', 'Long', 'Very long'],
  quality: ['Very poor', 'Poor', 'Okay', 'Good', 'Very good'],
  vividness: ['Very vague', 'Vague', 'Clear', 'Vivid', 'Very vivid'],
};

const level = (v) => (Number.isInteger(v) && v >= 1 && v <= 5 ? v : null);

function dots(value, scale) {
  const v = level(value);
  if (!v) return '<span class="dream-unset">Not set</span>';
  const marks = [1, 2, 3, 4, 5].map((i) => `<i class="dream-dot${i <= v ? ' dream-dot-on' : ''}"></i>`).join('');
  return `<span class="dream-dots" role="img" aria-label="${v} of 5">${marks}</span><span class="dream-dots-word">${esc(SCALES[scale][v - 1])}</span>`;
}

const yesNo = (v) => (v === true ? '<span class="dream-yes">Yes</span>'
  : v === false ? '<span class="dream-no">No</span>'
    : '<span class="dream-unset">Not answered</span>');

const row = (label, value) => `<div class="dream-row"><span class="dream-row-label">${label}</span><span class="dream-row-value">${value}</span></div>`;

const chip = (text) => `<span class="chip">${esc(text)}</span>`;
const tagChip = (id) => (TAGS[id] ? `<span class="chip" style="--hue:${TAGS[id].hue}">${esc(TAGS[id].label)}</span>` : '');

/** "23:30" → minutes after midnight, or null. */
function minutesOf(hhmm) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(hhmm ?? ''));
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h < 24 && min < 60 ? h * 60 + min : null;
}

/** "7:05" → "07:05" (what <input type="time"> needs), or ''. */
function hhmm(v) {
  const m = minutesOf(v);
  return m == null ? '' : `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** Time asleep between bedtime and wake (crossing midnight), "7 h 40 min", or ''. */
function sleepLength(bedtime, wake) {
  const a = minutesOf(bedtime);
  const b = minutesOf(wake);
  if (a == null || b == null) return '';
  const diff = (b - a + 1440) % 1440;
  const h = Math.floor(diff / 60);
  const m = diff % 60;
  return h && m ? `${h} h ${m} min` : h ? `${h} h` : `${m} min`;
}

const qualityOf = (dream) => level(dream.sleep.quality) ?? level(dream.ratings.sleep);

// ---- Interpretation (beta). Every string from the server goes through esc(). ----

/** 'animal.dog' → 'Dog · animal';  'place.old_school' → 'Old school · place' */
function prettyEntry(id) {
  const raw = String(id ?? '').trim();
  const dot = raw.indexOf('.');
  const group = dot > 0 ? raw.slice(0, dot).replace(/[_-]+/g, ' ') : '';
  const name = (dot > 0 ? raw.slice(dot + 1) : raw).replace(/[._-]+/g, ' ').trim();
  const nice = name ? name[0].toUpperCase() + name.slice(1) : raw;
  return group ? `${nice} · ${group}` : nice;
}

const PERSPECTIVES = [['psychology', 'Psychology'], ['freud', 'Freud'], ['traditional', 'Traditional']];

const interpHead = (label) => `<h2 class="dream-interp-h">${label}</h2>`;

function itemList(items) {
  const rows = arr(items)
    .filter((x) => x && (str(x.name) || str(x.meaning)))
    .map((x) => `
      <li class="dream-interp-item">
        ${str(x.name) ? `<span class="dream-interp-name">${esc(str(x.name))}</span>` : ''}
        ${str(x.meaning) ? `<p class="dream-interp-meaning">${esc(str(x.meaning))}</p>` : ''}
      </li>`).join('');
  return rows ? `<ul class="dream-interp-list">${rows}</ul>` : '';
}

function timeOf(iso) {
  const d = iso ? new Date(iso) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : '';
}

// Stops the interpretation poller and timers when leaving the screen. Module state only; nothing runs at import.
let cleanup = null;

export default {
  id: 'dream',
  hideTabbar: true,

  render(el, ctx, param) {
    const [id, sub] = String(param ?? '').split('/');

    // Old links (#dream/<id>/edit) now open the full editor.
    if (sub === 'edit' && id) {
      location.replace(`#record/edit/${encodeURIComponent(id)}`);
      return;
    }

    const goBack = () => (ctx.back ? ctx.back() : history.back());
    let tab = 'story';
    let stopPoll = null;
    let asking = false;        // a request is being sent
    let feedbackBusy = false;  // a rating/note is being sent
    let noteOpen = false;      // show the optional note field right after rating
    let perspKey = 'psychology';
    let savedTimer = null;

    cleanup?.();
    cleanup = () => { stopPolling(); clearTimeout(savedTimer); };

    const root = document.createElement('div');
    root.className = 'dream';
    el.innerHTML = '';
    el.append(root);

    const read = () => {
      const raw = getDream(id);
      return raw ? withDefaults(raw) : null;
    };

    // ---- Page ----

    function show() {
      stopPolling();
      const dream = read();
      if (!dream) {
        root.innerHTML = `
          <header class="screen-header">
            <button type="button" class="icon-btn" data-act="back" aria-label="Back">${icons.back}</button>
          </header>
          <div class="glass dream-missing">
            <p class="dream-missing-title">This dream has drifted away.</p>
            <p class="muted">It may have been deleted, or the link is out of date.</p>
            <a class="btn btn-ghost" href="#journal">${icons.journal}<span>Open the journal</span></a>
          </div>`;
        return;
      }

      const src = artSrc(dream);
      const hue = TAGS[dream.tags?.[0]]?.hue ?? 260;
      const nightmare = dream.kind === 'nightmare';
      const badges = [
        nightmare ? `<span class="chip dream-badge-nightmare">${icons.flame}<span>Nightmare</span></span>` : '',
        dream.lucid ? `<span class="chip dream-badge-mark"><span class="star-mark">${icons.star}</span>Lucid</span>` : '',
        dream.recurring ? `<span class="chip dream-badge-mark">${icons.repeat}<span>Recurring</span></span>` : '',
      ].join('');
      const TABS = [['story', 'Story'], ['details', 'Details'], ['sleep', 'Sleep']];

      root.innerHTML = `
        <div class="dream-hero${nightmare ? ' dream-hero-nightmare' : ''}" style="--glow:${hue}">
          ${src ? `<img class="dream-hero-img" src="${src}" alt="A picture painted from this dream" width="420" height="420">` : ''}
          <div class="dream-hero-bar">
            <button type="button" class="icon-btn" data-act="back" aria-label="Back">${icons.back}</button>
            <span class="dream-hero-gap"></span>
            <button type="button" class="icon-btn" data-act="share" aria-label="Share">${icons.share}</button>
            <button type="button" class="icon-btn" data-act="edit" aria-label="Edit">${icons.edit}</button>
          </div>
        </div>

        <p class="dream-date">${esc(whenLabel(dream.date))}</p>
        <h1 class="dream-title">${esc(dream.title || 'Untitled dream')}</h1>
        ${badges ? `<div class="dream-badges">${badges}</div>` : ''}

        <div class="dream-tabs" role="tablist" aria-label="Dream sections">
          ${TABS.map(([k, label]) => `<button type="button" role="tab" class="dream-tab" id="dream-tab-${k}" data-act="tab" data-tab="${k}" aria-controls="dream-panel-${k}" aria-selected="${k === tab}">${label}</button>`).join('')}
        </div>
        ${TABS.map(([k]) => `<section class="dream-panel" id="dream-panel-${k}" role="tabpanel" aria-labelledby="dream-tab-${k}" data-panel="${k}" ${k === tab ? '' : 'hidden'}></section>`).join('')}

        <div class="dream-interp" data-interp aria-live="polite"></div>

        <button type="button" class="btn btn-danger dream-delete" data-act="delete">${icons.trash}<span>Delete dream</span></button>

        <div class="dream-bar" data-bar></div>`;

      paintPanels(dream);
      paintInterp();
    }

    function paintPanels(dream = read()) {
      if (!dream) return;
      const p = (k) => root.querySelector(`[data-panel="${k}"]`);
      p('story').innerHTML = storyHTML(dream);
      p('details').innerHTML = detailsHTML(dream);
      p('sleep').innerHTML = sleepHTML(dream);
    }

    function selectTab(next) {
      tab = next;
      for (const t of root.querySelectorAll('[data-act="tab"]')) t.setAttribute('aria-selected', String(t.dataset.tab === tab));
      for (const panel of root.querySelectorAll('[data-panel]')) panel.hidden = panel.dataset.panel !== tab;
    }

    // ---- Story: the full text, symbols per category, emotions ----

    function storyHTML(dream) {
      const groups = SYMBOL_CATEGORIES
        .map((c) => [c, arr(dream.symbols[c]).map((s) => String(s ?? '').trim()).filter(Boolean)])
        .filter(([, list]) => list.length);
      const emotions = arr(dream.emotions).map((e) => String(e ?? '').trim()).filter(Boolean);
      const tags = arr(dream.tags).filter((t) => TAGS[t]);

      const symbols = groups.length ? `
        <h2 class="section-title">Symbols</h2>
        <div class="glass dream-card dream-groups">
          ${groups.map(([c, list]) => `
            <div class="dream-group">
              <p class="dream-group-label">${CATEGORY_LABELS[c] || esc(c)}</p>
              <div class="dream-chips">${list.map(chip).join('')}</div>
            </div>`).join('')}
        </div>` : '';

      const feelings = emotions.length ? `
        <h2 class="section-title">Emotions</h2>
        <div class="dream-chips">${emotions.map((e) => `<span class="chip dream-emotion">${esc(e)}</span>`).join('')}</div>` : '';

      const noticed = tags.length ? `
        <h2 class="section-title">Noticed in the text</h2>
        <div class="dream-chips">${tags.map(tagChip).join('')}</div>` : '';

      const empty = !groups.length && !emotions.length ? `
        <p class="dream-hint faint">No symbols or emotions added yet. <button type="button" class="dream-link" data-act="edit">Add them</button></p>` : '';

      return `
        <div class="glass dream-text">${esc(dream.text) || '<span class="faint">No words written for this dream.</span>'}</div>
        ${symbols}${feelings}${noticed}${empty}`;
    }

    // ---- Details: ratings as dots, kind, the yes/no questions, lucidity, notes ----

    function detailsHTML(dream) {
      const notes = str(dream.notes);
      return `
        <h2 class="section-title">General</h2>
        <div class="glass dream-card">
          ${row('Type', dream.kind === 'nightmare' ? '<span class="dream-kind-nightmare">Nightmare</span>' : 'Dream')}
          ${row('Rating', dots(dream.ratings.rating, 'rating'))}
          ${row('Length', dots(dream.ratings.length, 'length'))}
          ${row('Sleep quality', dots(qualityOf(dream), 'quality'))}
        </div>

        <h2 class="section-title">Questions</h2>
        <div class="glass dream-card">
          ${row('You were in the dream', yesNo(dream.questions.inDream))}
          ${row('It matched your mood', yesNo(dream.questions.matchesMood))}
          ${row('Linked to real life', yesNo(dream.questions.realLife))}
          ${row('Recurring dream', yesNo(typeof dream.recurring === 'boolean' ? dream.recurring : null))}
        </div>

        <h2 class="section-title">Lucidity</h2>
        <div class="glass dream-card">
          ${row('Lucid', dream.lucid ? '<span class="dream-yes">Lucid</span>' : 'Not lucid')}
          ${row('In control', yesNo(dream.lucidity.control))}
          ${row('Vividness', dots(dream.lucidity.vividness, 'vividness'))}
        </div>

        <h2 class="section-title">Notes</h2>
        <div class="glass dream-card dream-notes">${notes ? esc(notes) : '<span class="faint">No notes.</span>'}</div>
        <p class="dream-hint faint">To change these, tap <button type="button" class="dream-link" data-act="edit">Edit</button>.</p>`;
    }

    // ---- Sleep: bedtime, wake time, time asleep, quality — edited inline ----

    function sleepHTML(dream) {
      const { bedtime, wake } = dream.sleep;
      const q = qualityOf(dream);
      const len = sleepLength(bedtime, wake);
      return `
        <div class="glass dream-card dream-sleep">
          <label class="dream-row dream-sleep-row">
            <span class="dream-row-label">${icons.moon}<span>Bedtime</span></span>
            <input class="field dream-time" type="time" data-sleep="bedtime" value="${esc(hhmm(bedtime))}">
          </label>
          <label class="dream-row dream-sleep-row">
            <span class="dream-row-label">${icons.bell}<span>Woke up</span></span>
            <input class="field dream-time" type="time" data-sleep="wake" value="${esc(hhmm(wake))}">
          </label>
          <div class="dream-row">
            <span class="dream-row-label">Time asleep</span>
            <span class="dream-row-value dream-sleep-length" data-length>${len ? esc(len) : '<span class="dream-unset">Add both times</span>'}</span>
          </div>
        </div>

        <h2 class="section-title">Sleep quality</h2>
        <div class="glass dream-card dream-quality">
          <div class="dream-scale" role="group" aria-label="Sleep quality, 1 to 5">
            ${[1, 2, 3, 4, 5].map((v) => `<button type="button" class="dream-scale-btn" data-act="quality" data-value="${v}" aria-pressed="${q === v}" aria-label="${v} — ${SCALES.quality[v - 1]}">${v}</button>`).join('')}
          </div>
          <div class="dream-scale-ends faint"><span>${SCALES.quality[0]}</span><span>${SCALES.quality[4]}</span></div>
        </div>
        <p class="dream-saved" data-saved aria-live="polite"></p>
        <p class="dream-hint faint">Times are entered by hand: an app on the Home Screen can't read Apple Health.</p>`;
    }

    function saveSleep(patch) {
      const dream = read();
      if (!dream) return;
      const sleep = { ...dream.sleep, ...patch };
      const update = { sleep };
      // Keep the editor's "Sleep quality" rating in step with the Sleep tab.
      if ('quality' in patch) update.ratings = { ...dream.ratings, sleep: patch.quality };
      updateDream(id, update);
      const fresh = read();
      root.querySelector('[data-panel="details"]').innerHTML = detailsHTML(fresh);
      for (const b of root.querySelectorAll('[data-act="quality"]')) b.setAttribute('aria-pressed', String(Number(b.dataset.value) === qualityOf(fresh)));
      flashSaved();
    }

    function flashSaved() {
      const s = root.querySelector('[data-saved]');
      if (!s) return;
      s.textContent = 'Saved';
      s.classList.add('dream-saved-on');
      clearTimeout(savedTimer);
      savedTimer = setTimeout(() => { s.classList.remove('dream-saved-on'); }, 1600);
    }

    function paintLength() {
      const val = (k) => root.querySelector(`[data-sleep="${k}"]`)?.value || null;
      const len = sleepLength(val('bedtime'), val('wake'));
      const out = root.querySelector('[data-length]');
      if (out) out.innerHTML = len ? esc(len) : '<span class="dream-unset">Add both times</span>';
    }

    // ---- Share: the iOS share sheet, or copy to the clipboard ----

    async function share() {
      const dream = read();
      if (!dream) return;
      const title = dream.title || 'A dream';
      const text = [title, longDate(dream.date), '', dream.text, '', '— from my Dreaming journal'].filter((l, i) => i !== 1 || l).join('\n');
      if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
        try {
          await navigator.share({ title, text });
          return;
        } catch (err) {
          if (err?.name === 'AbortError') return; // the user closed the share sheet
        }
      }
      if (await copyText(text)) ctx.toast?.('Dream copied to the clipboard');
      else ctx.toast?.("Couldn't share this dream");
    }

    async function copyText(text) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch {}
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;';
        document.body.append(ta);
        ta.select();
        const ok = document.execCommand('copy');
        ta.remove();
        return ok;
      } catch {
        return false;
      }
    }

    // ---- Analyze: consent (first time), then request → waiting → result ----

    function onAnalyze() {
      if (asking) return;
      if (!isEnabled()) { openConsent(); return; }
      analyzeNow();
    }

    function analyzeNow() {
      const status = getDream(id)?.interpretation?.status;
      if (!status || status === 'failed') askForInterpretation(true);
      else { paintInterp(); scrollToInterp(); }
    }

    function scrollToInterp() {
      const slot = root.querySelector('[data-interp]');
      if (!slot?.childElementCount) return;
      requestAnimationFrame(() => {
        try { slot.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch { slot.scrollIntoView(); }
      });
    }

    function openConsent() {
      closeConsent();
      const sheet = document.createElement('div');
      sheet.className = 'dream-sheet';
      sheet.dataset.sheet = '';
      sheet.innerHTML = `
        <div class="dream-sheet-scrim" data-act="sheet-close"></div>
        <div class="glass dream-sheet-card" role="dialog" aria-modal="true" aria-labelledby="dream-sheet-title">
          <div class="dream-sheet-icon" aria-hidden="true">${icons.sparkle}</div>
          <h2 class="dream-sheet-title" id="dream-sheet-title">Interpret this dream?</h2>
          <ul class="dream-sheet-points">
            <li>${icons.share}<span>This dream's text, with its title, date and tags, is sent to Dreaming's server to be interpreted.</span></li>
            <li>${icons.lock}<span>The rest of your journal stays on this iPhone.</span></li>
            <li>${icons.settings}<span>It's a beta. You can turn it off any time in Settings → Labs.</span></li>
          </ul>
          <button type="button" class="btn" data-act="consent-yes">${icons.check}<span>Agree and analyze</span></button>
          <button type="button" class="btn btn-ghost" data-act="sheet-close">Not now</button>
        </div>`;
      root.append(sheet);
      sheet.querySelector('[data-act="consent-yes"]')?.focus();
    }

    function closeConsent() {
      root.querySelector('[data-sheet]')?.remove();
    }

    function stopPolling() {
      stopPoll?.();
      stopPoll = null;
    }

    function ensurePolling() {
      if (stopPoll || !isPending(getDream(id))) return;
      stopPoll = startPolling(id, () => { if (root.isConnected) paintInterp(); });
    }

    function paintBar() {
      const bar = root.querySelector('[data-bar]');
      if (!bar) return;
      const interp = isEnabled() ? getDream(id)?.interpretation : null;
      const status = interp?.status;
      let icon = icons.sparkle;
      let label = 'Analyze';
      if (asking) label = 'Sending…';
      else if (isPending({ interpretation: interp })) { icon = icons.moon; label = 'Interpreting…'; }
      else if (status === 'done' && interp?.result) label = 'Read the interpretation';
      else if (status) label = 'Analyze again';
      bar.innerHTML = `
        <button type="button" class="dream-analyze" data-act="analyze" ${asking ? 'disabled' : ''}>
          <span class="dream-analyze-icon" aria-hidden="true">${icon}</span><span>${label}</span>
        </button>`;
    }

    function paintInterp() {
      paintBar();
      const slot = root.querySelector('[data-interp]');
      if (!slot) return;
      const dream = getDream(id);
      const interp = dream?.interpretation;

      if (!isEnabled() || !interp?.status) {
        stopPolling();
        slot.innerHTML = '';
        return;
      }

      if (isPending(dream)) {
        const sent = timeOf(interp.requestedAt);
        slot.innerHTML = `
          <section class="glass dream-interp-card dream-interp-wait">
            <div class="dream-interp-moon" aria-hidden="true">${icons.moon}</div>
            <p class="dream-interp-wait-title">Interpreting your dream…</p>
            <div class="dream-interp-shimmer" aria-hidden="true"><span></span><span></span><span></span></div>
            <p class="dream-interp-wait-note faint">While we test, a reply can take a few minutes. You can leave this screen — it will be here when you come back.</p>
            ${sent ? `<p class="dream-interp-sent faint">Sent at ${esc(sent)}</p>` : ''}
          </section>`;
        ensurePolling();
        return;
      }
      stopPolling();

      if (interp.status !== 'done' || !interp.result || typeof interp.result !== 'object') {
        slot.innerHTML = `
          <section class="glass dream-interp-card dream-interp-failed">
            <p class="dream-interp-failed-title">This dream couldn't be interpreted.</p>
            <button type="button" class="btn btn-ghost" data-act="interpret" ${asking ? 'disabled' : ''}>${asking ? 'Sending…' : 'Try again'}</button>
          </section>`;
        return;
      }

      slot.innerHTML = interpretationHTML(dream);
    }

    function interpretationHTML(dream) {
      const interp = dream.interpretation;
      const r = interp.result;
      const parts = [];

      const stale = isStale(dream)
        ? `<p class="dream-interp-stale faint">The dream was edited after this interpretation · <button type="button" class="dream-interp-link" data-act="interpret" ${asking ? 'disabled' : ''}>${asking ? 'Sending…' : 'Interpret again'}</button></p>`
        : '';

      const essence = str(r.essence);
      parts.push(`
        <section class="glass dream-interp-card">
          <p class="dream-interp-kicker"><span aria-hidden="true">✨</span> What it may mean <span class="dream-interp-beta">beta</span></p>
          ${essence ? `<p class="dream-interp-essence">${esc(essence)}</p>` : ''}
          ${stale}
        </section>`);

      const symbols = itemList(r.symbols);
      if (symbols) parts.push(`<section class="glass dream-interp-card">${interpHead('Symbols')}${symbols}</section>`);

      const themes = itemList(r.themes);
      if (themes) parts.push(`<section class="glass dream-interp-card">${interpHead('Themes')}${themes}</section>`);

      const arc = str(r.feeling?.arc);
      const feel = str(r.feeling?.text);
      if (arc || feel) {
        parts.push(`
          <section class="glass dream-interp-card">
            ${interpHead('The feeling')}
            ${arc ? `<span class="chip dream-interp-arc">${esc(arc)}</span>` : ''}
            ${feel ? `<p class="dream-interp-text">${esc(feel)}</p>` : ''}
          </section>`);
      }

      const persp = PERSPECTIVES.filter(([k]) => str(r.perspectives?.[k]));
      if (persp.length) {
        if (!persp.some(([k]) => k === perspKey)) perspKey = persp[0][0];
        const tabs = persp.length > 1
          ? `<div class="dream-interp-tabs" role="tablist">${persp.map(([k, label]) => `
              <button type="button" role="tab" class="dream-interp-tab" data-act="persp" data-key="${k}" aria-selected="${k === perspKey}">${label}</button>`).join('')}
            </div>`
          : '';
        const panels = persp.map(([k]) => `
          <p class="dream-interp-text dream-interp-panel" role="tabpanel" data-ppanel="${k}" ${k === perspKey ? '' : 'hidden'}>${esc(str(r.perspectives[k]))}</p>`).join('');
        parts.push(`
          <section class="glass dream-interp-card">
            ${interpHead(persp.length > 1 ? 'Perspectives' : `Perspective · ${persp[0][1]}`)}
            ${tabs}${panels}
          </section>`);
      }

      const questions = arr(r.reflect).map(str).filter(Boolean);
      if (questions.length) {
        parts.push(`
          <section class="glass dream-interp-card">
            ${interpHead('Reflect')}
            <ul class="dream-interp-reflect">${questions.map((q) => `<li>${esc(q)}</li>`).join('')}</ul>
          </section>`);
      }

      const care = str(r.care);
      if (care) parts.push(`<section class="dream-interp-care"><p>${esc(care)}</p></section>`);

      let based = arr(r.basedOn).map((x) => String(x ?? '').trim()).filter(Boolean);
      if (!based.length) based = [...arr(r.symbols), ...arr(r.themes)].map((x) => str(x?.entry)).filter(Boolean);
      based = [...new Set(based)];
      const disclaimer = str(r.disclaimer) || 'For reflection, not prediction.';

      parts.push(`
        <section class="glass dream-interp-card dream-interp-foot">
          ${based.length ? `
            <details class="dream-interp-based">
              <summary><span>Based on ${based.length} knowledge ${based.length === 1 ? 'entry' : 'entries'}</span>${icons.chevronRight}</summary>
              <ul>${based.map((b) => `<li>${esc(prettyEntry(b))}</li>`).join('')}</ul>
            </details>` : ''}
          ${feedbackHTML(interp)}
          <p class="dream-interp-disclaimer faint">${esc(disclaimer)}</p>
        </section>`);

      return parts.join('');
    }

    function feedbackHTML(interp) {
      const rated = interp.rating === 1 || interp.rating === -1;
      const thumb = (val, emoji, label) => `
        <button type="button" class="dream-interp-thumb" data-act="rate" data-rating="${val}" aria-pressed="${interp.rating === val}" aria-label="${label}" ${feedbackBusy ? 'disabled' : ''}>${emoji}</button>`;
      const note = rated && noteOpen && !interp.feedbackNote
        ? `
          <form class="dream-interp-note" data-note novalidate>
            <input class="field" type="text" name="note" maxlength="500" autocomplete="off" placeholder="Anything to add? (optional)" aria-label="Optional note">
            <button type="submit" class="btn btn-ghost" ${feedbackBusy ? 'disabled' : ''}>Send</button>
          </form>`
        : '';
      const label = !rated ? 'Was this helpful?' : interp.feedbackNote ? 'Thanks — noted.' : 'Thanks';
      return `
        <div class="dream-interp-feedback">
          <span class="dream-interp-ask">${label}</span>
          <span class="dream-interp-thumbs">${thumb(1, '👍', 'Helpful')}${thumb(-1, '👎', 'Not helpful')}</span>
        </div>${note}`;
    }

    async function askForInterpretation(scroll = false) {
      if (asking) return;
      const dream = getDream(id);
      if (!dream) return;
      asking = true;
      paintInterp();
      let ok = false;
      try {
        await requestInterpretation(dream);
        noteOpen = false;
        perspKey = 'psychology';
        ok = true;
      } catch (err) {
        ctx.toast?.(err?.message || "Couldn't send the dream. Please try again.");
      } finally {
        asking = false;
      }
      if (!root.isConnected) return;
      paintInterp();
      if (ok && scroll) scrollToInterp();
    }

    async function rate(rating, note) {
      if (feedbackBusy) return;
      const dream = getDream(id);
      if (!dream?.interpretation) return;
      feedbackBusy = true;
      try {
        await sendFeedback(dream, rating, note);
        noteOpen = !note;
      } catch (err) {
        ctx.toast?.(err?.message || "Couldn't send feedback. Please try again.");
      } finally {
        feedbackBusy = false;
      }
      if (root.isConnected) paintInterp();
    }

    // ---- Events ----

    root.addEventListener('click', (e) => {
      const target = e.target.closest('[data-act]');
      const act = target?.dataset.act;
      if (!act) return;
      if (act === 'back') goBack();
      else if (act === 'share') share();
      else if (act === 'edit') ctx.navigate(`#record/edit/${encodeURIComponent(id)}`);
      else if (act === 'tab') selectTab(target.dataset.tab || 'story');
      else if (act === 'quality') {
        const v = Number(target.dataset.value);
        saveSleep({ quality: qualityOf(read() || withDefaults({})) === v ? null : v }); // tap again to clear
      }
      else if (act === 'analyze') onAnalyze();
      else if (act === 'sheet-close') closeConsent();
      else if (act === 'consent-yes') {
        setSetting('interpretBeta', true);
        closeConsent();
        analyzeNow();
      }
      else if (act === 'interpret') askForInterpretation();
      else if (act === 'rate') rate(Number(target.dataset.rating) === -1 ? -1 : 1);
      else if (act === 'persp') {
        perspKey = target.dataset.key || 'psychology';
        const card = target.closest('.dream-interp-card');
        for (const t of card?.querySelectorAll('[data-act="persp"]') ?? []) t.setAttribute('aria-selected', String(t.dataset.key === perspKey));
        for (const p of card?.querySelectorAll('[data-ppanel]') ?? []) p.hidden = p.dataset.ppanel !== perspKey;
      }
      else if (act === 'delete') {
        // eslint-disable-next-line no-alert
        if (!confirm("Delete this dream? This can't be undone.")) return;
        stopPolling();
        deleteDream(id);
        ctx.toast?.('Dream deleted');
        ctx.navigate('#journal');
      }
    });

    root.addEventListener('input', (e) => {
      if (e.target.matches?.('[data-sleep]')) paintLength();
    });

    root.addEventListener('change', (e) => {
      const key = e.target.dataset?.sleep;
      if (key !== 'bedtime' && key !== 'wake') return;
      const v = e.target.value;
      saveSleep({ [key]: hhmm(v) || null });
      paintLength();
    });

    root.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && root.querySelector('[data-sheet]')) closeConsent();
    });

    root.addEventListener('submit', (e) => {
      const form = e.target.closest?.('form[data-note]');
      if (!form) return;
      e.preventDefault();
      const note = form.elements.note?.value.trim();
      if (!note) { noteOpen = false; paintInterp(); return; }
      rate(getDream(id)?.interpretation?.rating === -1 ? -1 : 1, note);
    });

    show();

    // #dream/<id>/analyze (Home's "Analyze this dream"): open the page, then start the Analyze flow straight away.
    // The address drops "/analyze" so coming Back here doesn't start it again.
    if (sub === 'analyze' && getDream(id)) {
      try { history.replaceState(null, '', `#dream/${encodeURIComponent(id)}`); } catch {}
      onAnalyze();
    }
  },

  destroy() {
    cleanup?.();
    cleanup = null;
  },
};
