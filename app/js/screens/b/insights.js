// New layout: Insights tab. What keeps coming back in the dreams and what it may mean:
//   1. your dream sky, all time (sky.js), on top: every dream a star, dreams that share a symbol joined into
//      constellations; a constellation's "Read more" opens the symbol's meaning,
//   (no moon cycle here since v52, owner's call: Home keeps its small moon card),
//   3. recurring symbols over the past 30 / 15 / 10 days (tap one for its meaning),
//   4. the dream types recorded (general / lucid / nightmare / prophetic, all time),
//   5. the Symbols map analysis (#module/symbols-map, a Dreaming Plus feature),
//   6. up to 5 questions to reflect on, from the last 10 dreams.
// A symbol's meaning opens in the shared symbol sheet (symbolsheet.js): Dreaming's dream library first, the user's
// own interpretation and dreams below it. Questions are the interpretations' own "reflect" questions first, then
// gentle ones we word from patterns in the same dreams: open, never predictive or diagnostic.
// The personalisation survey lives in the Profile tab now (#me/survey); old #insights/survey links go there.
// The sky keeps its own state (listeners, the chosen star), so it is not one of the re-painted SECTIONS: it has its
// own host and is drawn again only when the dreams change (see paintSky).
import { listDreams, getDream, localDay, getSetting, setSetting, onChange } from '../../store.js';
import { recurringSymbols, symbolsOf, dreamDay, DREAM_TYPES, dreamType, typeCounts } from '../../symbols.js';
import { MODULES } from '../../progress.js';
import { TAGS } from '../../analyze.js';
import { esc, icons, relativeDay } from '../../ui.js';
import { MODULE_INFO, MOD_ICONS } from '../module.js';
import { hasFeature, openPaywall, getAccount } from '../../account.js';
import { plusPill } from '../../paywall.js';
import sky from './sky.js';
import { openSymbolSheet, closeSymbolSheet } from './symbolsheet.js';

const DAY = 86400000;
const PERIODS = [30, 15, 10];   // days, the first is the default
const SYMBOLS_SHOWN = 8;        // symbols listed before "Show all"
const RECENT = 10;              // dreams the questions are drawn from
const MAX_QUESTIONS = 5;
const MIN_FOR_QUESTIONS = 3;

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const dreamTitle = (d) => String(d?.title || '').trim() || 'Untitled dream';
const str = (v) => (typeof v === 'string' ? v.trim() : '');

let state = null; // { root, cache, symbols, showAll, offs, navigate, skySig }

// ---- Period (remembered in settings) ----

const getDays = () => {
  const n = Number(getSetting('insightsDays', PERIODS[0]));
  return PERIODS.includes(n) ? n : PERIODS[0];
};
// Same window as recurringSymbols(): today and the days - 1 before it.
const sinceDay = (days) => localDay(new Date(Date.now() - (days - 1) * DAY));
const dreamsSince = (days) => {
  const since = sinceDay(days);
  return listDreams().filter((d) => dreamDay(d) >= since);
};

/** Dream links (title + day) for the questions. */
function dreamLinksHTML(ids) {
  const items = ids.map((id) => getDream(id)).filter(Boolean);
  if (!items.length) return '';
  return `<ul class="bi-dreams">${items.map((d) => `
    <li><a class="bi-dream" href="#dream/${encodeURIComponent(d.id)}">
      <span class="bi-dream-title">${esc(dreamTitle(d))}</span>
      <span class="bi-dream-day">${esc(relativeDay(dreamDay(d)))}</span>${icons.chevronRight}
    </a></li>`).join('')}</ul>`;
}

// ---- 1. Recurring symbols ----

function symbolsHTML() {
  const days = getDays();
  const dreams = dreamsSince(days);
  // The sparkle marks symbols that one of the user's interpretations explained (any time, not only in the period).
  const known = new Set(recurringSymbols({ days: 0 }).filter((s) => s.meaning).map((s) => s.key));
  const list = recurringSymbols({ days }).map((s) => ({ ...s, mine: Boolean(s.meaning) || known.has(s.key) }));
  state.symbols = list;

  const seg = `
    <div class="bi-seg" role="group" aria-label="Period">
      ${PERIODS.map((n) => `<button type="button" data-days="${n}" aria-pressed="${n === days}">${n} days</button>`).join('')}
    </div>`;

  let body;
  if (!dreams.length) {
    const wider = days < PERIODS[0] && dreamsSince(PERIODS[0]).length > 0;
    body = `
      <div class="bi-empty">
        <span class="bi-empty-icon">${icons.moon}</span>
        <p class="bi-empty-title">No dreams in the past ${days} days</p>
        <p class="bi-empty-text">The symbols in the dreams you write down gather here, so you can see what keeps coming back.</p>
        ${wider
          ? `<button type="button" class="bi-link" data-days="${PERIODS[0]}">See the past ${PERIODS[0]} days</button>`
          : `<a class="btn btn-ghost bi-empty-btn" href="#record">${icons.plus}<span>Write down a dream</span></a>`}
      </div>`;
  } else if (!list.length) {
    body = `
      <div class="bi-empty">
        <span class="bi-empty-icon">${icons.sparkle}</span>
        <p class="bi-empty-title">No symbols in these dreams yet</p>
        <p class="bi-empty-text">Add symbols when you edit a dream, or interpret it, and they gather here.</p>
      </div>`;
  } else {
    const max = list[0].count;
    const again = list.filter((s) => s.count > 1).length;
    const shown = state.showAll ? list : list.slice(0, SYMBOLS_SHOWN);
    const rows = shown.map((s) => `
      <li><button type="button" class="bi-sym${s.count > 1 ? ' bi-sym-again' : ''}" data-sym="${esc(s.key)}"
        aria-label="${esc(s.name)}, in ${plural(s.count, 'dream')}${s.mine ? ', also explained in your interpretation' : ''}. What it can mean">
        <span class="bi-sym-top">
          <span class="bi-sym-name">${esc(s.name)}</span>
          ${s.mine ? `<span class="bi-sym-has" title="Also explained in your interpretation">${icons.sparkle}</span>` : ''}
          <span class="bi-sym-n">${s.count}</span>
          <span class="bi-sym-go">${icons.chevronRight}</span>
        </span>
        <span class="bi-bar"><i style="width:${Math.max(6, (s.count / max) * 100).toFixed(1)}%"></i></span>
      </button></li>`).join('');
    const more = list.length > SYMBOLS_SHOWN
      ? `<button type="button" class="bi-more" data-more aria-expanded="${state.showAll}">${state.showAll ? 'Show fewer' : `Show all ${list.length}`}</button>`
      : '';
    body = `
      <p class="bi-sum"><b>${plural(list.length, 'symbol')}</b> in ${plural(dreams.length, 'dream')}${again ? ` · ${again} more than once` : ''}</p>
      <ul class="bi-syms">${rows}</ul>
      ${more}
      <p class="bi-hint">Tap a symbol to read what it can mean.</p>`;
  }

  return `
    <section class="bi-card glass" aria-labelledby="bi-sym-title">
      <div class="bi-card-head"><h2 class="bi-card-title" id="bi-sym-title">Recurring symbols</h2></div>
      ${seg}
      ${body}
    </section>`;
}

/**
 * A symbol's meaning in the shared sheet: the library first, then the user's own interpretation and dreams (counted
 * over all the dreams, filled in by the sheet). Used by the recurring symbols and by the sky's "Read more".
 */
function openSymbol(key) {
  if (!state || !key) return;
  const s = state.symbols.find((x) => x.key === key) || recurringSymbols({ days: 0 }).find((x) => x.key === key);
  openSymbolSheet({ key, name: s?.name, navigate: state.navigate });
}

// ---- 2. Your dream sky (all time) ----

/** What the sky is drawn from: which dreams, in which order, and when each last changed. */
const skySignature = (dreams) => dreams
  .map((d) => `${d.id}:${d.updatedAt || d.createdAt || ''}:${d.interpretation?.status || ''}`).join('|');

/** Draws the sky into its own host, and again only when the dreams change. No dreams: the card stays hidden. */
function paintSky() {
  const host = state.root.querySelector('[data-sky]');
  if (!host) return;
  const dreams = listDreams();
  const sig = skySignature(dreams);
  if (sig === state.skySig) return;
  state.skySig = sig;
  if (!dreams.length) {
    sky.destroy();
    host.hidden = true;
    host.innerHTML = '';
    return;
  }
  if (!host.querySelector('.bi-sky-host')) {
    host.innerHTML = `
      <section class="bi-card glass" aria-labelledby="bi-sky-title">
        <div class="bi-card-head"><h2 class="bi-card-title" id="bi-sky-title">Your dream sky</h2><span class="bi-card-meta">All time</span></div>
        <p class="bi-sky-lead">Each dream is a star. Dreams that share a symbol join into a constellation.</p>
        <div class="bi-sky-host"></div>
      </section>`;
  }
  host.hidden = false;
  const el = host.querySelector('.bi-sky-host');
  try {
    sky.render(el, { dreams, filtering: false, navigate: state.navigate, onSymbol: openSymbol });
  } catch (err) {
    console.error(err);
    sky.destroy();
    el.innerHTML = '<p class="bi-hint">Your sky could not be drawn just now.</p>';
  }
}

// ---- 3. Dream types ----

const TYPE_LOOK = {
  general: { icon: icons.moon, hint: 'Everyday dreams' },
  lucid: { icon: icons.lucidity, hint: 'You knew you were dreaming' },
  nightmare: { icon: MOD_ICONS.cloud, hint: 'Frightening or upsetting' },
  prophetic: { icon: icons.sparkle, hint: 'Felt like it might come true' },
};

function typesHTML() {
  const counts = typeCounts();
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const rows = DREAM_TYPES.map((t) => {
    const n = counts[t.id] || 0;
    const share = total ? Math.round((n / total) * 100) : 0;
    return `
      <li class="bi-type bi-type-${t.id}" aria-label="${esc(t.label)}: ${plural(n, 'dream')}${total ? `, ${share}%` : ''}">
        <span class="bi-type-icon">${TYPE_LOOK[t.id].icon}</span>
        <span class="bi-type-text"><span class="bi-type-label">${esc(t.label)}</span><span class="bi-type-hint">${esc(TYPE_LOOK[t.id].hint)}</span></span>
        <span class="bi-type-n"><b>${n}</b>${total ? `<small>${share}%</small>` : ''}</span>
        <span class="bi-bar"><i style="width:${total ? ((n / total) * 100).toFixed(1) : 0}%"></i></span>
      </li>`;
  }).join('');
  return `
    <section class="bi-card glass" aria-labelledby="bi-types-title">
      <div class="bi-card-head"><h2 class="bi-card-title" id="bi-types-title">Dream types</h2><span class="bi-card-meta">All time</span></div>
      <ul class="bi-types">${rows}</ul>
      <p class="bi-types-total"><span>Total</span><b>${plural(total, 'dream')}</b></p>
      ${total ? '' : '<p class="bi-hint">Your dream types fill in as you write down dreams.</p>'}
    </section>`;
}

// ---- 4. Symbols map (Dreaming Plus) ----

function mapHTML() {
  const info = MODULE_INFO['symbols-map'];
  const plus = !hasFeature('symbols-map');
  const at = MODULES.find((m) => m.id === 'symbols-map')?.unlockAt || 0;
  const toGo = Math.max(0, at - listDreams().length);
  return `
    <a class="bi-map glass${plus ? ' bi-map-plus' : ''}" href="#module/symbols-map" data-map
      aria-label="Symbols map${plus ? ': part of Dreaming Plus' : toGo ? `: opens at ${plural(at, 'dream')}` : ''}">
      <svg class="bi-map-art" viewBox="0 0 150 110" aria-hidden="true">
        <path d="M20 72 58 34l40 18 34-30M58 34l12 54 28-36 26 32"/>
        <circle cx="20" cy="72" r="3"/><circle cx="58" cy="34" r="4.5"/><circle cx="98" cy="52" r="6"/>
        <circle cx="132" cy="22" r="2.5"/><circle cx="70" cy="88" r="3.5"/><circle cx="124" cy="84" r="3"/>
      </svg>
      <span class="bi-map-icon">${info.icon}</span>
      <span class="bi-map-text">
        <span class="bi-map-name">Symbols map${plus ? plusPill() : ''}</span>
        <span class="bi-map-about">${esc(info.about)}</span>
        ${!plus && toGo ? `<span class="bi-map-note">Opens at ${plural(at, 'dream')} · ${toGo} to go</span>` : ''}
      </span>
      <span class="bi-map-go">${icons.chevronRight}</span>
    </a>`;
}

// ---- 5. Questions to reflect on ----

const qKey = (s) => String(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** Feelings noted in a dream: chosen emotions plus mood tags found in the text (not "surreal"). */
function feelingsOf(d) {
  const out = new Set();
  for (const e of Array.isArray(d?.emotions) ? d.emotions : []) if (str(e)) out.add(str(e).toLowerCase());
  for (const t of Array.isArray(d?.tags) ? d.tags : []) if (TAGS[t]?.kind === 'mood' && t !== 'surreal') out.add(TAGS[t].label);
  return out;
}

const tally = (dreams, itemsOf) => {
  const map = new Map();
  for (const d of dreams) {
    for (const [key, name] of itemsOf(d)) {
      const cur = map.get(key) || { name, ids: [] };
      if (!cur.ids.includes(d.id)) cur.ids.push(d.id);
      map.set(key, cur);
    }
  }
  return [...map.values()].filter((x) => x.ids.length >= 2).sort((a, b) => b.ids.length - a.ids.length || a.name.localeCompare(b.name));
};

/** Questions we word ourselves from what these dreams share, most telling first. */
function patternQuestions(recent) {
  const n = recent.length;
  const ofN = (k) => `${k} of your last ${n} dreams`;
  const all = recent.map((d) => d.id);
  const ofType = (t) => recent.filter((d) => dreamType(d) === t).map((d) => d.id);
  const symbols = tally(recent, (d) => symbolsOf(d).map((s) => [s.key, s.name]));
  const feelings = tally(recent, (d) => [...feelingsOf(d)].map((e) => [e, e]));
  const nightmares = ofType('nightmare');
  const lucid = ofType('lucid');
  const prophetic = ofType('prophetic');
  const recurring = recent.filter((d) => d.recurring).map((d) => d.id);
  const qs = [];

  if (symbols[0]) qs.push({ text: `“${symbols[0].name}” came up in ${ofN(symbols[0].ids.length)}. What does it bring to mind for you lately?`, ids: symbols[0].ids });
  if (nightmares.length >= 2) qs.push({ text: `${ofN(nightmares.length)} were nightmares. What helps you feel calm and safe at bedtime?`, ids: nightmares });
  if (lucid.length === 1) qs.push({ text: 'In one of your recent dreams you knew you were dreaming. What would you like to try the next time it happens?', ids: lucid });
  if (lucid.length >= 2) qs.push({ text: `You knew you were dreaming in ${ofN(lucid.length)}. What do you think helped you notice?`, ids: lucid });
  if (prophetic.length === 1) qs.push({ text: 'One of your recent dreams felt like it might come true. What made it feel that way?', ids: prophetic });
  if (prophetic.length >= 2) qs.push({ text: `${ofN(prophetic.length)} felt like they might come true. What made them feel that way?`, ids: prophetic });
  if (recurring.length === 1) qs.push({ text: 'One of your recent dreams felt like one you have had before. What do you think brings it back?', ids: recurring });
  if (recurring.length >= 2) qs.push({ text: `${ofN(recurring.length)} felt like dreams you have had before. What do you think brings them back?`, ids: recurring });
  if (feelings[0]) qs.push({ text: `Feeling ${feelings[0].name} came up in ${ofN(feelings[0].ids.length)}. Is there somewhere in your days where you feel it too?`, ids: feelings[0].ids });
  if (symbols[1]) qs.push({ text: `How do you usually feel when “${symbols[1].name}” shows up in your dreams?`, ids: symbols[1].ids });
  // Always fitting, for when the dreams share little yet.
  qs.push({ text: 'Which of your recent dreams has stayed with you the most, and why?', ids: all });
  qs.push({ text: 'What, if anything, links your recent dreams to what is going on in your days?', ids: all });
  qs.push({ text: 'Is there a person or place from your recent dreams you would like to understand better?', ids: all });
  return qs;
}

/** Up to 5 questions: the interpretations' own first (newest dream first, no repeats), then ours. */
function reflectQuestions(recent) {
  const out = [];
  const seen = new Map();
  for (const d of recent) {
    const r = d?.interpretation?.status === 'done' ? d.interpretation.result : null;
    for (const raw of Array.isArray(r?.reflect) ? r.reflect : []) {
      const text = str(raw);
      const k = qKey(text);
      if (!k) continue;
      const dup = seen.get(k);
      if (dup) { if (!dup.ids.includes(d.id)) dup.ids.push(d.id); continue; }
      if (out.length >= MAX_QUESTIONS) continue;
      const q = { text, ids: [d.id], fromInterp: true };
      seen.set(k, q);
      out.push(q);
    }
  }
  for (const q of patternQuestions(recent)) {
    if (out.length >= MAX_QUESTIONS) break;
    const k = qKey(q.text);
    if (seen.has(k)) continue;
    seen.set(k, q);
    out.push(q);
  }
  return out;
}

function fromLabel(q) {
  if (q.fromInterp && q.ids.length === 1) return `From your interpretation of “${esc(dreamTitle(getDream(q.ids[0])))}”`;
  if (q.fromInterp) return `From ${q.ids.length} of your interpretations`;
  return `Based on ${plural(q.ids.length, 'dream')}`;
}

function reflectHTML() {
  const recent = listDreams().slice(0, RECENT);
  const head = `
    <div class="bi-card-head">
      <h2 class="bi-card-title" id="bi-reflect-title">Reflect</h2>
      ${recent.length >= MIN_FOR_QUESTIONS ? `<span class="bi-card-meta">Last ${plural(recent.length, 'dream')}</span>` : ''}
    </div>`;

  if (recent.length < MIN_FOR_QUESTIONS) {
    const left = MIN_FOR_QUESTIONS - recent.length;
    return `
      <section class="bi-card glass" aria-labelledby="bi-reflect-title">
        ${head}
        <div class="bi-wait">
          <span class="bi-dots" aria-hidden="true">${Array.from({ length: MIN_FOR_QUESTIONS }, (_, i) => `<i${i < recent.length ? ' class="bi-on"' : ''}></i>`).join('')}</span>
          <p>Questions to reflect on appear after a few more dreams. ${left === 1 ? 'One more to go.' : `${left} more to go.`}</p>
        </div>
      </section>`;
  }

  const items = reflectQuestions(recent).map((q, i) => `
    <li class="bi-q">
      <span class="bi-q-n" aria-hidden="true">${i + 1}</span>
      <div class="bi-q-body">
        <p class="bi-q-text">${esc(q.text)}</p>
        <details class="bi-q-from" data-key="${esc(qKey(q.text).slice(0, 80))}">
          <summary><span>${fromLabel(q)}</span>${icons.chevronRight}</summary>
          ${dreamLinksHTML(q.ids)}
        </details>
      </div>
    </li>`).join('');

  return `
    <section class="bi-card glass" aria-labelledby="bi-reflect-title">
      ${head}
      <ol class="bi-qs">${items}</ol>
      <p class="bi-foot">For reflection, not prediction. There are no right answers.</p>
    </section>`;
}

// ---- Screen ----

// In page order, after the sky's own host (which comes first).
const SECTIONS = { symbols: symbolsHTML, types: typesHTML, map: mapHTML, reflect: reflectHTML };

// Re-draws only the sections whose HTML changed (a background image finishing touches no section here), and keeps
// any "From … dreams" lists that were open. The sky checks for itself whether the dreams changed.
function paint() {
  if (!state) return;
  for (const [key, build] of Object.entries(SECTIONS)) {
    const host = state.root.querySelector(`[data-sec="${key}"]`);
    if (!host) continue;
    let html;
    try { html = build(); } catch (err) { console.error(err); html = ''; }
    if (state.cache[key] === html) continue;
    const open = new Set([...host.querySelectorAll('details[open][data-key]')].map((d) => d.dataset.key));
    host.innerHTML = html;
    state.cache[key] = html;
    if (open.size) for (const d of host.querySelectorAll('details[data-key]')) if (open.has(d.dataset.key)) d.open = true;
  }
  try { paintSky(); } catch (err) { console.error(err); }
}

function onRootClick(e) {
  const hit = (sel) => e.target.closest(sel);
  let b;
  if ((b = hit('[data-days]'))) {
    const n = Number(b.dataset.days);
    if (PERIODS.includes(n) && n !== getDays()) {
      setSetting('insightsDays', n);
      state.showAll = false;
      paint();
    }
    return;
  }
  if ((b = hit('[data-sym]'))) { openSymbol(b.dataset.sym); return; }
  if (hit('[data-more]')) { state.showAll = !state.showAll; paint(); return; }
  if (hit('[data-map]')) {
    // A free user gets the paywall instead of the module.
    if (!hasFeature('symbols-map')) { e.preventDefault(); openPaywall({ feature: 'symbols-map' }); }
  }
}

function teardown() {
  if (!state) return;
  for (const off of state.offs) { try { off(); } catch {} }
  closeSymbolSheet();
  if (state.skySig != null) { try { sky.destroy(); } catch {} } // its listeners, its pending scroll
  state = null;
}

export default {
  id: 'insights',
  label: 'Insights',
  icon: icons.insights,

  // The survey moved to the Profile tab: an old #insights/survey link goes to #me/survey (replacing this entry).
  render(el, ctx, param) {
    teardown();
    if (param === 'survey') {
      el.innerHTML = '';
      location.replace('#me/survey');
      return;
    }
    el.innerHTML = `
      <div class="bi">
        <header class="bi-head">
          <h1 class="screen-title">Insights</h1>
          <p class="bi-lead">What keeps coming back in your dreams, and what it may mean for you.</p>
        </header>
        <div class="bi-sec" data-sky hidden></div>
        ${Object.keys(SECTIONS).map((k) => `<div class="bi-sec" data-sec="${k}"></div>`).join('')}
      </div>`;
    const root = el.querySelector('.bi');
    const navigate = (hash) => { if (ctx?.navigate) ctx.navigate(hash); else location.hash = hash; };
    state = { root, cache: {}, symbols: [], showAll: false, offs: [], navigate, skySig: null };
    paint();
    root.addEventListener('click', onRootClick);

    // New, edited or deleted dreams; plan changes (code redeemed, Plus ended) re-draw the Symbols map card.
    state.offs.push(onChange(() => paint()));
    const onAccount = () => paint();
    window.addEventListener('dreaming:account', onAccount);
    state.offs.push(() => window.removeEventListener('dreaming:account', onAccount));
    getAccount().catch(() => {});
  },

  destroy() {
    teardown();
  },
};
