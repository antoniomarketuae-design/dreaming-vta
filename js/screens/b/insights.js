// New layout: Insights tab. What keeps coming back in the dreams and what it may mean:
//   1. your dream sky, all time (sky.js), on top: every dream a star, dreams that share a symbol joined into
//      constellations; a constellation's "Read more" opens the symbol sheet, with the meaning in full,
//   2. recurring symbols over the past 30 / 15 / 10 days (tap one for its meaning, in a bottom sheet),
//   3. the dream types recorded (general / lucid / nightmare / prophetic, all time),
//   4. the Symbols map analysis (#module/symbols-map, a Dreaming Plus feature),
//   5. up to 5 questions to reflect on, from the last 10 dreams,
//   6. a short survey that personalises Dreaming (answers saved at once in profile.survey).
// Meanings come only from the user's own interpretations (symbols.js). Questions are the interpretations' own
// "reflect" questions first, then gentle ones we word from patterns in the same dreams: open, never predictive or
// diagnostic. The two sheets (symbol, survey) live on <body> and are removed when the screen goes away.
// The sky keeps its own state (listeners, the chosen star), so it is not one of the re-painted SECTIONS: it has its
// own host and is drawn again only when the dreams change (see paintSky).
import { listDreams, getDream, localDay, getProfile, setProfile, getSetting, setSetting, onChange } from '../../store.js';
import { recurringSymbols, symbolsOf, NO_MEANING, dreamDay, DREAM_TYPES, dreamType, typeCounts } from '../../symbols.js';
import { MODULES } from '../../progress.js';
import { TAGS } from '../../analyze.js';
import { esc, icons, relativeDay } from '../../ui.js';
import { MODULE_INFO, MOD_ICONS } from '../module.js';
import { hasFeature, openPaywall, getAccount } from '../../account.js';
import { plusPill } from '../../paywall.js';
import sky from './sky.js';

const DAY = 86400000;
const PERIODS = [30, 15, 10];   // days, the first is the default
const SYMBOLS_SHOWN = 8;        // symbols listed before "Show all"
const RECENT = 10;              // dreams the questions are drawn from
const MAX_QUESTIONS = 5;
const MIN_FOR_QUESTIONS = 3;

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const dreamTitle = (d) => String(d?.title || '').trim() || 'Untitled dream';
const str = (v) => (typeof v === 'string' ? v.trim() : '');

let state = null; // { root, cache, symbols, showAll, sheet, offs, navigate, skySig }

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

/** Dream links (title + day) for the sheet and the questions. */
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
  // A symbol with no meaning in the period may still have one from an older interpretation.
  const known = new Map(recurringSymbols({ days: 0 }).filter((s) => s.meaning).map((s) => [s.key, s]));
  const list = recurringSymbols({ days }).map((s) => {
    const k = s.meaning ? null : known.get(s.key);
    return k ? { ...s, meaning: k.meaning, title: k.title, meaningFrom: k.meaningFrom } : s;
  });
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
        aria-label="${esc(s.name)}, in ${plural(s.count, 'dream')}${s.meaning ? ', meaning available' : ''}">
        <span class="bi-sym-top">
          <span class="bi-sym-name">${esc(s.name)}</span>
          ${s.meaning ? `<span class="bi-sym-has" title="Meaning from your interpretation">${icons.sparkle}</span>` : ''}
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
      <p class="bi-hint">Tap a symbol to see what it may mean for you.</p>`;
  }

  return `
    <section class="bi-card glass" aria-labelledby="bi-sym-title">
      <div class="bi-card-head"><h2 class="bi-card-title" id="bi-sym-title">Recurring symbols</h2></div>
      ${seg}
      ${body}
    </section>`;
}

/** `period` names where the count comes from: 'past 30 days', 'all time'. */
function symbolSheetHTML(s, period) {
  const from = s.meaningFrom ? getDream(s.meaningFrom) : null;
  const as = str(s.title) && str(s.title).toLowerCase() !== s.name.toLowerCase() ? str(s.title) : '';
  const meaning = s.meaning
    ? `
      <section class="bi-meaning">
        <p class="bi-meaning-label">${icons.sparkle}<span>What it may mean for you</span></p>
        <p class="bi-meaning-text">${esc(s.meaning)}</p>
        ${from
          ? `<a class="bi-meaning-from" href="#dream/${encodeURIComponent(from.id)}">
              <span>From your interpretation of <b>“${esc(dreamTitle(from))}”</b>${as ? `, as “${esc(as)}”` : ''} · ${esc(relativeDay(dreamDay(from)))}</span>${icons.chevronRight}
            </a>`
          : '<p class="bi-meaning-src">From your interpretation of one of your dreams.</p>'}
      </section>`
    : `<section class="bi-meaning bi-meaning-none"><p class="bi-meaning-text">${esc(NO_MEANING)}</p></section>`;
  return `
    <p class="bi-sheet-kicker">Symbol · ${esc(period)}</p>
    <h2 class="bi-sheet-title" id="bi-sheet-title" tabindex="-1">${esc(s.name)}</h2>
    <p class="bi-sheet-lead">In ${plural(s.count, 'dream')}</p>
    ${meaning}
    <h3 class="bi-sheet-label">${s.count === 1 ? 'The dream' : 'Dreams'} with this symbol</h3>
    ${dreamLinksHTML(s.dreamIds)}`;
}

function openSymbol(key) {
  const s = state?.symbols.find((x) => x.key === key);
  if (s) openSheet('symbol', symbolSheetHTML(s, `past ${getDays()} days`));
}

// ---- 2. Your dream sky (all time) ----

/** What the sky is drawn from: which dreams, in which order, and when each last changed. */
const skySignature = (dreams) => dreams
  .map((d) => `${d.id}:${d.updatedAt || d.createdAt || ''}:${d.interpretation?.status || ''}`).join('|');

/** A constellation's "Read more" (or a symbol in a star's card): the symbol sheet, counted over all the dreams. */
function openSkySymbol(key) {
  const s = recurringSymbols({ days: 0 }).find((x) => x.key === key);
  if (s) openSheet('symbol', symbolSheetHTML(s, 'all time'));
}

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
    sky.render(el, { dreams, filtering: false, navigate: state.navigate, onSymbol: openSkySymbol });
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

// ---- 6. Survey for personalisation (profile.survey) ----

const SURVEY = [
  { id: 'recall', short: 'Remembering dreams', q: 'How often do you remember your dreams?',
    options: [['most', 'Most mornings'], ['often', 'A few times a week'], ['sometimes', 'Now and then'], ['rarely', 'Hardly ever']] },
  { id: 'waking', short: 'Waking up', q: 'How do you usually feel when you wake up?',
    options: [['rested', 'Rested'], ['okay', 'Okay'], ['tired', 'Tired'], ['unsettled', 'Unsettled'], ['varies', 'It changes a lot']] },
  { id: 'goal', short: 'What you want most', q: 'What do you most want from Dreaming?',
    options: [['understand', 'Understand my dreams'], ['sleep', 'Sleep better'], ['lucid', 'Lucid dreaming'], ['nightmares', 'Fewer nightmares'], ['creativity', 'Creativity and ideas']] },
  { id: 'stress', short: 'Stress lately', q: 'How stressful does life feel lately?',
    options: [['calm', 'Calm'], ['little', 'A little'], ['quite', 'Quite a lot'], ['very', 'Very']] },
  { id: 'comeTrue', short: 'Dreams coming true', q: 'Do your dreams ever seem to come true?',
    hint: 'Some people notice a dream that later seems to match real events.',
    options: [['often', 'Often'], ['sometimes', 'Sometimes'], ['once', 'Once or twice'], ['never', 'Never']] },
  { id: 'recurring', short: 'Recurring dreams', q: 'Do you have dreams that keep coming back?',
    options: [['often', 'Yes, often'], ['sometimes', 'Sometimes'], ['no', 'Not really']] },
  { id: 'life', short: 'Life right now', q: 'What is going on in your life right now?', multi: true, exclusive: 'none',
    options: [['work', 'Work or study'], ['relationships', 'Relationships'], ['health', 'Health'], ['family', 'Family'], ['change', 'A big change'], ['none', 'Nothing in particular']] },
  { id: 'tone', short: 'Interpretation tone', q: 'How should interpretations speak to you?',
    options: [['gentle', 'Gentle and warm'], ['direct', 'Clear and direct']] },
];

const surveyAnswers = () => {
  const s = getProfile().survey;
  return s && typeof s === 'object' ? s : {};
};
const validIds = (q, v) => (Array.isArray(v) ? v.filter((x) => q.options.some(([id]) => id === x)) : []);
const isAnswered = (q, v) => (q.multi ? validIds(q, v).length > 0 : q.options.some(([id]) => id === v));
const answeredCount = (a = surveyAnswers()) => SURVEY.filter((q) => isAnswered(q, a[q.id])).length;
const firstUnanswered = (a = surveyAnswers()) => Math.max(0, SURVEY.findIndex((q) => !isAnswered(q, a[q.id])));
const answerLabel = (q, v) => (q.multi
  ? validIds(q, v).map((x) => q.options.find(([id]) => id === x)[1]).join(', ')
  : q.options.find(([id]) => id === v)?.[1] || '');

/** Saves one answer at once (an empty multi-choice removes it) and refreshes the card behind the sheet. */
function saveAnswer(id, value) {
  const survey = { ...surveyAnswers() };
  if (value == null || (Array.isArray(value) && !value.length)) delete survey[id];
  else survey[id] = value;
  setProfile({ survey });
  paint();
}

function surveyHTML() {
  const n = SURVEY.length;
  const done = answeredCount();
  const all = done === n;
  return `
    <section class="bi-survey glass" aria-labelledby="bi-survey-title">
      <div class="bi-survey-top">
        <span class="bi-survey-icon">${all ? icons.check : icons.target}</span>
        <div class="bi-survey-text">
          <h2 class="bi-survey-title" id="bi-survey-title">Personalise Dreaming</h2>
          <p class="bi-survey-lead">${all
            ? 'Thank you. Your answers are saved on this phone, and you can change them anytime.'
            : 'A few quick questions about you and your sleep, so Dreaming can suit you better.'}</p>
        </div>
      </div>
      <div class="bi-progress" role="progressbar" aria-label="Questions answered" aria-valuemin="0" aria-valuemax="${n}" aria-valuenow="${done}">
        <i style="width:${((done / n) * 100).toFixed(1)}%"></i>
      </div>
      <p class="bi-survey-count">${done} of ${n} answered</p>
      <button type="button" class="btn${all ? ' btn-ghost' : ''}" data-survey="${all ? 'edit' : 'go'}">${all ? 'Edit answers' : done ? 'Continue' : 'Start'}</button>
    </section>`;
}

function surveyStepHTML(i, editing) {
  const q = SURVEY[i];
  const n = SURVEY.length;
  const v = surveyAnswers()[q.id];
  const answered = isAnswered(q, v);
  const picked = q.multi ? validIds(q, v) : [v];
  const opts = q.options.map(([id, label]) => `
    <button type="button" class="bi-sv-opt" data-opt="${id}" aria-pressed="${picked.includes(id)}">
      <span>${esc(label)}</span><span class="bi-sv-tick">${icons.check}</span>
    </button>`).join('');
  return `
    <div class="bi-sv${q.multi ? ' bi-sv-multi' : ''}">
      <p class="bi-sv-step">Question ${i + 1} of ${n}</p>
      <div class="bi-progress" aria-hidden="true"><i style="width:${(((i + 1) / n) * 100).toFixed(1)}%"></i></div>
      <h2 class="bi-sv-q" id="bi-sheet-title" tabindex="-1">${esc(q.q)}</h2>
      <p class="bi-sv-hint">${esc(q.hint || (q.multi ? 'Pick all that fit.' : 'Pick one.'))}</p>
      <div class="bi-sv-opts" role="group" aria-labelledby="bi-sheet-title">${opts}</div>
    </div>
    <div class="bi-sv-foot">
      <button type="button" class="btn btn-ghost bi-sv-back" data-sv="back"${!editing && i === 0 ? ' disabled' : ''}>Back</button>
      ${editing ? '' : `<button type="button" class="bi-sv-skip" data-sv="skip"${answered ? ' hidden' : ''}>Skip</button>`}
      <button type="button" class="btn bi-sv-next" data-sv="next"${!editing && !answered ? ' disabled' : ''}>${editing ? 'Done' : i === n - 1 ? 'Finish' : 'Next'}</button>
    </div>`;
}

/** The end of the survey: a thank-you and every answer, each tappable to change it. */
function surveySummaryHTML() {
  const a = surveyAnswers();
  const n = SURVEY.length;
  const done = answeredCount(a);
  const all = done === n;
  const title = all ? 'Thank you' : done ? 'Thanks so far' : 'No answers yet';
  const lead = all
    ? 'Every question answered. Tap any answer to change it.'
    : `${done} of ${n} answered. You can answer the rest now or whenever you like.`;
  const rows = SURVEY.map((q, i) => {
    const label = answerLabel(q, a[q.id]);
    return `
      <li><button type="button" class="bi-answer" data-edit="${i}">
        <span class="bi-answer-q">${esc(q.short)}</span>
        <span class="bi-answer-a${label ? '' : ' bi-answer-none'}">${esc(label || 'Not answered')}</span>${icons.chevronRight}
      </button></li>`;
  }).join('');
  return `
    <div class="bi-thanks">
      <span class="bi-thanks-icon">${all ? icons.check : icons.sparkle}</span>
      <h2 class="bi-sheet-title" id="bi-sheet-title" tabindex="-1">${title}</h2>
      <p class="bi-sheet-lead">${esc(lead)}</p>
    </div>
    <ul class="bi-answers">${rows}</ul>
    <div class="bi-sv-foot">
      ${all ? '' : '<button type="button" class="btn btn-ghost" data-sv="rest">Answer the rest</button>'}
      <button type="button" class="btn" data-close>Done</button>
    </div>`;
}

/** Step-by-step survey sheet. `start`: a question index, 'summary', or nothing for the first unanswered one. */
function openSurvey(start) {
  const sheet = openSheet('survey', '');
  let step = start === 'summary' || Number.isInteger(start) ? start : firstUnanswered();
  let editing = false; // changing one answer from the summary: Back / Done return there
  let timer = null;

  const draw = (moved) => {
    sheet.body.innerHTML = step === 'summary' ? surveySummaryHTML() : surveyStepHTML(step, editing);
    if (moved) {
      sheet.panel.scrollTop = 0;
      try { sheet.body.querySelector('#bi-sheet-title')?.focus({ preventScroll: true }); } catch {}
    }
  };
  const go = (to, edit = editing) => { clearTimeout(timer); step = to; editing = edit; draw(true); };
  const after = (i) => (editing || i + 1 >= SURVEY.length ? 'summary' : i + 1);

  sheet.onClick = (e) => {
    const hit = (sel) => e.target.closest(sel);
    let b;
    if ((b = hit('[data-opt]')) && step !== 'summary') {
      const q = SURVEY[step];
      const id = b.dataset.opt;
      clearTimeout(timer);
      if (q.multi) {
        let next = validIds(q, surveyAnswers()[q.id]);
        if (next.includes(id)) next = next.filter((x) => x !== id);
        else if (id === q.exclusive) next = [id];
        else next = [...next.filter((x) => x !== q.exclusive), id];
        saveAnswer(q.id, next);
        draw(false);
        return;
      }
      saveAnswer(q.id, id);
      draw(false);
      // A single choice moves on by itself after a moment (not from the last question: Finish stays a choice).
      if (editing || step < SURVEY.length - 1) {
        const at = step;
        timer = setTimeout(() => { if (!sheet.closed && step === at) go(after(at)); }, 320);
      }
      return;
    }
    if ((b = hit('[data-sv]'))) {
      const act = b.dataset.sv;
      if (act === 'back') go(editing ? 'summary' : Math.max(0, step - 1));
      else if (act === 'skip' || act === 'next') go(after(step));
      else if (act === 'rest') go(firstUnanswered(), false);
      return;
    }
    if ((b = hit('[data-edit]'))) go(Number(b.dataset.edit), true);
  };
  sheet.onClose = () => clearTimeout(timer);
  draw(false);
}

// ---- Bottom sheet (shared by the symbol and the survey) ----

function openSheet(kind, html) {
  state?.sheet?.close(true);
  const root = document.createElement('div');
  root.className = `bi-sheet bi-sheet-${kind}`;
  root.innerHTML = `
    <div class="bi-sheet-backdrop" data-close></div>
    <section class="bi-sheet-panel" role="dialog" aria-modal="true" aria-labelledby="bi-sheet-title" tabindex="-1">
      <div class="bi-sheet-grab" aria-hidden="true"></div>
      <button type="button" class="icon-btn bi-sheet-x" data-close aria-label="Close">${icons.close}</button>
      <div class="bi-sheet-body" data-body>${html}</div>
    </section>`;
  document.body.append(root);
  document.body.classList.add('bi-lock');
  const panel = root.querySelector('.bi-sheet-panel');
  const before = document.activeElement;
  requestAnimationFrame(() => root.classList.add('bi-in'));
  try { panel.focus({ preventScroll: true }); } catch {}

  const sheet = { root, panel, body: root.querySelector('[data-body]'), closed: false, onClick: null, onClose: null, close };

  function close(now = false) {
    if (sheet.closed) return;
    sheet.closed = true;
    if (state?.sheet === sheet) state.sheet = null;
    document.removeEventListener('keydown', onKey);
    document.body.classList.remove('bi-lock'); // only one sheet is ever open: a new one closes the old first
    try { sheet.onClose?.(); } catch {}
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (now || reduce) root.remove();
    else {
      root.classList.remove('bi-in');
      root.classList.add('bi-out');
      setTimeout(() => root.remove(), 260);
    }
    if (!now) { try { if (before && document.contains(before)) before.focus({ preventScroll: true }); } catch {} }
  }
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  root.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) { close(); return; }
    sheet.onClick?.(e);
  });

  // Swipe down to close (once the sheet is scrolled to the top).
  let startY = null;
  let dy = 0;
  panel.addEventListener('touchstart', (e) => { startY = panel.scrollTop <= 0 ? e.touches[0].clientY : null; dy = 0; }, { passive: true });
  panel.addEventListener('touchmove', (e) => {
    if (startY == null) return;
    dy = Math.max(0, e.touches[0].clientY - startY);
    if (dy > 6) { panel.style.transition = 'none'; panel.style.transform = `translateY(${dy}px)`; }
  }, { passive: true });
  const release = () => {
    if (startY == null) return;
    panel.style.transition = '';
    if (dy > 90) { panel.style.transform = 'translateY(110%)'; close(); } else panel.style.transform = '';
    startY = null;
  };
  panel.addEventListener('touchend', release);
  panel.addEventListener('touchcancel', release);

  if (state) state.sheet = sheet;
  return sheet;
}

// ---- Screen ----

// In page order; the sky's own host goes right after the recurring symbols.
const SECTIONS = { symbols: symbolsHTML, types: typesHTML, map: mapHTML, reflect: reflectHTML, survey: surveyHTML };

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
    return;
  }
  if ((b = hit('[data-survey]'))) openSurvey(b.dataset.survey === 'edit' ? 'summary' : undefined);
}

function teardown() {
  if (!state) return;
  for (const off of state.offs) { try { off(); } catch {} }
  state.sheet?.close(true);
  if (state.skySig != null) { try { sky.destroy(); } catch {} } // its listeners, its pending scroll
  state = null;
}

export default {
  id: 'insights',
  label: 'Insights',
  icon: icons.insights,

  // #insights/survey opens the survey straight away (for links from other screens).
  render(el, ctx, param) {
    teardown();
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
    state = { root, cache: {}, symbols: [], showAll: false, sheet: null, offs: [], navigate, skySig: null };
    paint();
    root.addEventListener('click', onRootClick);

    // New, edited or deleted dreams; plan changes (code redeemed, Plus ended) re-draw the Symbols map card.
    state.offs.push(onChange(() => paint()));
    const onAccount = () => paint();
    window.addEventListener('dreaming:account', onAccount);
    state.offs.push(() => window.removeEventListener('dreaming:account', onAccount));
    getAccount().catch(() => {});

    if (param === 'survey') {
      try { history.replaceState(null, '', '#insights'); } catch {}
      openSurvey();
    }
  },

  destroy() {
    teardown();
  },
};
