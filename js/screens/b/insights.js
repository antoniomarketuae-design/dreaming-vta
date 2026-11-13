// New layout: Insights tab, rebuilt around readings of the dreams (owner, 2026-11-13: "the app must give real
// feedback, like a psychologist, not only counts"). Everything is built on the phone from Dreaming's dream library
// (js/periodreader.js on top of js/reader.js); the dream text never leaves the phone. Top to bottom:
//   period switch: Week · Month · Year · All (remembered), for the cards marked (P),
//   1. gentle help for bad dreams, when nightmares pile up over two weeks (can be hidden for a week),
//   2. (P) the reading: how many dreams and nights against the period before, the mood in one line, the main
//      thread, what else keeps coming back, what is new and what is back, what may be behind it, questions,
//      and the tap-through story of the period (story.js),
//   3. growing with you: what opens next as the journal grows, and the morning reminder (until all are done),
//   4. (P) people and places, 5. (P) what keeps coming back, each with a line of its meaning,
//   6. dream threads (all time): an image followed through the nights it came back in, in place of the dream sky,
//   7. (P) day and night: what the notes about the day before share with the dreams (real numbers only),
//   8. lucid dreaming: the dreamer's own dream signs and the reality-check technique,
//   9. milestones, 10. (P) dream types, 11. the Symbols map (Dreaming Plus).
// A symbol's meaning opens in the shared symbol sheet (symbolsheet.js). The Reflect questions live in Profile
// (me.js imports reflectCardHTML from here). Old #insights/survey links go to #me/survey.
import { listDreams, getDream, localDay, getSetting, setSetting, onChange, getDayNote } from '../../store.js';
import { dreamDay, DREAM_TYPES, dreamType, typeCounts, symbolsOf } from '../../symbols.js';
import { MODULES } from '../../progress.js';
import { TAGS } from '../../analyze.js';
import { esc, icons, relativeDay, formatDate } from '../../ui.js';
import { MODULE_INFO, MOD_ICONS } from '../module.js';
import { hasFeature, openPaywall, getAccount } from '../../account.js';
import { plusPill } from '../../paywall.js';
import { openSymbolSheet, closeSymbolSheet } from './symbolsheet.js';
import { PERIODS, periodOf, readPeriod, readThreads, loadBriefs, moodLine, dreamSigns, dayBack, dayBefore, nameInText } from '../../periodreader.js';
import { openStory, closeStory } from './story.js';
import { sentences } from '../../reader.js';

const RECENT = 10;              // dreams the Reflect questions are drawn from
const MAX_QUESTIONS = 5;
const MIN_FOR_QUESTIONS = 3;
const SYMBOLS_SHOWN = 6;
const THREADS_SHOWN = 5;
const MIN_FOR_STORY = 3;

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const dreamTitle = (d) => String(d?.title || '').trim() || 'Untitled dream';
const str = (v) => (typeof v === 'string' ? v.trim() : '');
const lower = nameInText;

let state = null; // { root, period, read, threads, token, cache, showAllSyms, showAllThreads, offs, navigate, fresh }

const getPeriod = () => periodOf(getSetting('insightsPeriod', 'month')).id;

/** Dream links (title + day). */
function dreamLinksHTML(ids) {
  const items = ids.map((id) => getDream(id)).filter(Boolean);
  if (!items.length) return '';
  return `<ul class="bi-dreams">${items.map((d) => `
    <li><a class="bi-dream" href="#dream/${encodeURIComponent(d.id)}">
      <span class="bi-dream-title">${esc(dreamTitle(d))}</span>
      <span class="bi-dream-day">${esc(relativeDay(dreamDay(d)))}</span>${icons.chevronRight}
    </a></li>`).join('')}</ul>`;
}

const chip = (g, extra = '') => `<button type="button" class="bi-chip" data-sym="${esc(g.name)}">${esc(g.name)}${extra}</button>`;
const countChip = (g) => chip(g, g.ids.length > 1 ? `<small>${g.ids.length}</small>` : '');

/** A card waiting for its reading. */
const waiting = (id, title, meta = '') => `
  <section class="bi-card glass" aria-labelledby="${id}" aria-busy="true">
    <div class="bi-card-head"><h2 class="bi-card-title" id="${id}">${esc(title)}</h2>${meta ? `<span class="bi-card-meta">${esc(meta)}</span>` : ''}</div>
    <p class="bi-wait-line"><span class="bi-wait-dot" aria-hidden="true"></span>Reading your dreams…</p>
  </section>`;

const offlineLine = '<p class="bi-hint">This needs an internet connection the first time. Open Insights again when you are online.</p>';

// ---- Period switch ----

function periodHTML() {
  const id = getPeriod();
  return `
    <div class="bi-seg bi-period" role="group" aria-label="Period">
      ${PERIODS.map((p) => `<button type="button" data-period="${p.id}" aria-pressed="${p.id === id}">${p.label}</button>`).join('')}
    </div>`;
}

// ---- 1. Gentle help for bad dreams ----

function careHTML() {
  const today = localDay();
  if (String(getSetting('careHiddenUntil', '')) > today) return '';
  const since = dayBack(13);
  const recent = listDreams().filter((d) => dreamDay(d) >= since);
  const n = recent.filter((d) => dreamType(d) === 'nightmare').length;
  if (!(n >= 3 || (n >= 2 && n * 2 >= recent.length))) return '';
  return `
    <section class="bi-card glass bi-care" aria-labelledby="bi-care-title">
      <div class="bi-card-head"><h2 class="bi-card-title" id="bi-care-title">Gentle help for bad dreams</h2><span class="bi-card-meta">Past 2 weeks</span></div>
      <p class="bi-care-lead">${n} of your last ${plural(recent.length, 'dream')} were nightmares. That is common in stressful times, and there are simple ways to make them less frightening.</p>
      <ul class="bi-care-list">
        <li><b>Rewrite the ending.</b> While awake, write the dream again with a calmer ending and read it through a few times a day. This is called imagery rehearsal.</li>
        <li><b>Wind down.</b> Less news and screens before bed, a regular bedtime and some quiet time first.</li>
        <li><b>Write it down.</b> Putting a nightmare into words often makes it feel smaller.</li>
      </ul>
      <a class="bi-care-link" href="#article/nightmares">Read: Nightmares and what helps${icons.chevronRight}</a>
      <p class="bi-care-note">If nightmares keep you from sleeping or follow something painful, a doctor or mental health professional can help.</p>
      <button type="button" class="bi-link bi-care-hide" data-care-hide>Hide for a week</button>
    </section>`;
}

// ---- 2. The reading of the period ----

function compareLine(r) {
  const p = r.period;
  if (r.prevCount === null || !p.before) return '';
  const diff = r.dreams.length - r.prevCount;
  if (diff > 0) return `, ${diff} more than ${p.before}`;
  if (diff < 0) return `, ${-diff} fewer than ${p.before}`;
  return r.prevCount ? `, as many as ${p.before}` : '';
}

function moodDots(m) {
  if (!m.dots.length) return '';
  const label = { uneasy: 'uneasy', light: 'light', mixed: 'light and uneasy', '': 'no feelings noted' };
  return `<p class="bi-mood-dots" aria-hidden="true">${m.dots.map((d) => `<i class="bi-mood-${d.mood || 'none'}" title="${esc(`${formatDate(d.day)}: ${label[d.mood]}`)}"></i>`).join('')}</p>`;
}

function moodHTML(r) {
  const m = r.mood;
  const line = moodLine(m, r.dreams.length, r.period);
  return `
    <div class="bi-mood">
      ${moodDots(m)}
      <p class="bi-mood-line">${line ? esc(line) : 'Add how a dream felt (Details, then Emotions) and your dream mood shows here.'}</p>
      ${m.felt.length ? `<p class="bi-mood-felt">Felt most: ${esc(m.felt.join(', '))}</p>` : ''}
    </div>`;
}

function readingHTML(r) {
  const p = periodOf(getPeriod());
  if (!r || r.period.id !== p.id) return waiting('bi-read-title', p.title);
  const head = `<div class="bi-card-head"><h2 class="bi-card-title" id="bi-read-title">${esc(p.title)}</h2><span class="bi-card-meta">${esc(p.days ? `Past ${p.days === 365 ? 'year' : `${p.days} days`}` : 'All time')}</span></div>`;

  if (r.status === 'empty') {
    const other = PERIODS.find((x) => x.days > p.days && listDreams().some((d) => dreamDay(d) >= dayBack(x.days - 1))) || (listDreams().length ? PERIODS[3] : null);
    return `
      <section class="bi-card glass bi-read" aria-labelledby="bi-read-title">
        ${head}
        <div class="bi-empty">
          <span class="bi-empty-icon">${icons.moon}</span>
          <p class="bi-empty-title">No dreams in ${esc(p.past)}</p>
          <p class="bi-empty-text">Write down your dreams and this becomes a reading of them: the threads that run through them, how they felt and what may be behind them.</p>
          ${other
            ? `<button type="button" class="bi-link" data-period="${other.id}">See ${esc(other.past)}</button>`
            : `<a class="btn btn-ghost bi-empty-btn" href="#record">${icons.plus}<span>Write down a dream</span></a>`}
        </div>
      </section>`;
  }

  const n = r.dreams.length;
  const lead = `<p class="bi-read-lead">You wrote down <b>${plural(n, 'dream')}</b>${r.nights !== n ? ` on ${plural(r.nights, 'night')}` : ''}${esc(compareLine(r))}.</p>`;
  const story = n >= MIN_FOR_STORY && r.status === 'ok'
    ? `<button type="button" class="btn bi-story-btn" data-story>${icons.play}<span>Play your ${esc(p.id === 'all' ? 'dreams so far' : p.label.toLowerCase())}</span></button>`
    : '';

  if (r.status === 'offline') {
    return `<section class="bi-card glass bi-read" aria-labelledby="bi-read-title">${head}${lead}${moodHTML(r)}${offlineLine}</section>`;
  }

  if (n === 1) {
    const d = r.dreams[0];
    const g = r.main;
    return `
      <section class="bi-card glass bi-read" aria-labelledby="bi-read-title">
        ${head}${lead}${moodHTML(r)}
        ${g?.brief ? `<h3 class="bi-read-h">In it</h3><p class="bi-read-text"><b>${esc(g.name)}</b>: ${esc(g.brief.first)}</p>` : ''}
        <p class="bi-read-text">Its full reading is on its page.</p>
        ${dreamLinksHTML([d.id])}
        <p class="bi-hint">A reading of the whole ${esc(p.id === 'all' ? 'journal' : p.label.toLowerCase())} starts at 2 dreams: the threads that run through them and what may be behind them.</p>
      </section>`;
  }

  const main = r.main;
  const mainHTML = main
    ? `
      <h3 class="bi-read-h">The main thread</h3>
      <p class="bi-read-text"><button type="button" class="bi-inline" data-sym="${esc(main.name)}">${esc(main.name)}</button> runs through ${main.ids.length} of your ${n} dreams.</p>
      ${main.brief?.meaning ? `<p class="bi-read-text">${esc(sentences(main.brief.meaning, 2))}</p>` : ''}`
    : `
      <h3 class="bi-read-h">No thread yet</h3>
      <p class="bi-read-text">No image has come back yet in these dreams: each one stands on its own so far.${r.images?.length ? ' They bring together:' : ''}</p>
      ${r.images?.length ? `<p class="bi-chips">${r.images.slice(0, 6).map((g) => chip(g)).join('')}</p>` : ''}`;
  const also = r.threads?.length
    ? `<h3 class="bi-read-h">Also coming back</h3><p class="bi-chips">${r.threads.map(countChip).join('')}</p>`
    : '';
  const newWord = p.id === 'week' ? 'this week' : p.id === 'month' ? 'this month' : 'this year';
  const freshBack = (r.fresh?.length || r.back?.length) && p.days
    ? `
      <ul class="bi-read-notes">
        ${r.fresh.length ? `<li><b>New ${newWord}:</b> ${r.fresh.map((g) => esc(lower(g.name))).join(', ')}</li>` : ''}
        ${r.back.map((g) => `<li><b>Back again:</b> ${esc(lower(g.name))}, first seen ${esc(formatDate(g.since))}</li>`).join('')}
      </ul>`
    : '';
  const behind = r.behind?.length
    ? `
      <h3 class="bi-read-h">What may be behind it</h3>
      ${r.behind.map((t) => `<p class="bi-read-text">${esc(t)}</p>`).join('')}
      <p class="bi-read-note">These are common readings, not a verdict: you know your life best.</p>`
    : '';
  const qs = r.questions?.length
    ? `<h3 class="bi-read-h">Ask yourself</h3><ul class="bi-read-qs">${r.questions.map((q) => `<li>${esc(q)}</li>`).join('')}</ul>`
    : '';
  const noImages = !r.images?.length
    ? '<p class="bi-hint">We did not find images from our dream library in these dreams yet. Add more detail to your dreams (the people, places and what happened) and the reading fills in.</p>'
    : '';

  return `
    <section class="bi-card glass bi-read" aria-labelledby="bi-read-title">
      ${head}${lead}${moodHTML(r)}
      ${r.images?.length ? mainHTML : ''}${also}${freshBack}${behind}${qs}${noImages}
      ${story}
      <p class="bi-foot">From Dreaming's dream library. Your dreams stay on this phone.</p>
    </section>`;
}

// ---- 3. Growing with you ----

function growingHTML() {
  const all = listDreams();
  const inDays = (n) => all.filter((d) => dreamDay(d) >= dayBack(n - 1)).length;
  const pairs = all.filter((d) => getDayNote(dayBefore(d))).length;
  const reminder = getSetting('reminderMorning', false) === true;
  const threads = state?.threads;
  const rows = [
    { done: inDays(7) >= 2, have: Math.min(2, inDays(7)), need: 2, label: 'Write down 2 dreams in a week', sub: 'Your weekly reading starts.' },
    { done: Boolean(threads?.length), label: 'Dream of something a second time', sub: 'Dream threads follow it through your nights.' },
    { done: pairs >= 3, have: Math.min(3, pairs), need: 3, label: 'Write about the day before 3 dreams', sub: 'Day and night links appear. Use “Your day before” on a dream’s page.' },
    { done: inDays(30) >= MIN_FOR_STORY, have: Math.min(MIN_FOR_STORY, inDays(30)), need: MIN_FOR_STORY, label: `${MIN_FOR_STORY} dreams in a month`, sub: 'Your month story opens.' },
    { done: reminder, label: 'Turn on a morning reminder', sub: 'Dreams fade within minutes of waking; a reminder helps you catch them.', href: '#profile/notifications' },
  ];
  if (rows.every((x) => x.done) || threads === undefined) return '';
  const left = rows.filter((x) => !x.done).length;
  return `
    <section class="bi-card glass bi-grow" aria-labelledby="bi-grow-title">
      <div class="bi-card-head"><h2 class="bi-card-title" id="bi-grow-title">Growing with you</h2><span class="bi-card-meta">${left} to go</span></div>
      <ul class="bi-grow-list">${rows.map((x) => {
        const inner = `
          <span class="bi-grow-mark${x.done ? ' is-done' : ''}" aria-hidden="true">${x.done ? icons.check : ''}</span>
          <span class="bi-grow-text"><span class="bi-grow-label">${esc(x.label)}</span><span class="bi-grow-sub">${esc(x.sub)}</span></span>
          ${!x.done && x.need ? `<span class="bi-grow-n">${x.have} of ${x.need}</span>` : ''}
          ${!x.done && x.href ? `<span class="bi-grow-go">${icons.chevronRight}</span>` : ''}`;
        return `<li>${!x.done && x.href ? `<a class="bi-grow-row" href="${x.href}">${inner}</a>` : `<div class="bi-grow-row" aria-label="${esc(`${x.label}${x.done ? ', done' : ''}`)}">${inner}</div>`}</li>`;
      }).join('')}</ul>
    </section>`;
}

// ---- 4. People and places ----

function whoHTML(r) {
  const p = periodOf(getPeriod());
  if (!r || r.period.id !== p.id) return waiting('bi-who-title', 'People and places', p.label);
  if (r.status === 'empty') return '';
  const head = `<div class="bi-card-head"><h2 class="bi-card-title" id="bi-who-title">People and places</h2><span class="bi-card-meta">${esc(p.label)}</span></div>`;
  if (r.status === 'offline') return `<section class="bi-card glass" aria-labelledby="bi-who-title">${head}${offlineLine}</section>`;
  const line = (label, list, none) => `
    <div class="bi-who-row">
      <p class="bi-who-label">${label}</p>
      ${list.length ? `<p class="bi-chips">${list.map(countChip).join('')}</p>` : `<p class="bi-who-none">${none}</p>`}
    </div>`;
  return `
    <section class="bi-card glass" aria-labelledby="bi-who-title">
      ${head}
      ${line('People', r.people, 'No people from our library in these dreams yet.')}
      ${line('Places', r.places, 'No places from our library in these dreams yet.')}
      ${r.people.length || r.places.length ? '<p class="bi-hint">Tap one for what it can mean. The number is how many dreams it was in.</p>' : ''}
    </section>`;
}

// ---- 5. What keeps coming back ----

function symbolsHTML(r) {
  const p = periodOf(getPeriod());
  if (!r || r.period.id !== p.id) return waiting('bi-sym-title', 'Images in your dreams', p.label);
  if (r.status === 'empty') return '';
  const head = `<div class="bi-card-head"><h2 class="bi-card-title" id="bi-sym-title">Images in your dreams</h2><span class="bi-card-meta">${esc(p.label)}</span></div>`;
  if (r.status === 'offline') return `<section class="bi-card glass" aria-labelledby="bi-sym-title">${head}${offlineLine}</section>`;
  const list = r.symbols || [];
  if (!list.length) {
    return `
      <section class="bi-card glass" aria-labelledby="bi-sym-title">
        ${head}
        <p class="bi-who-none">No images from our library in these dreams yet. Add more detail to a dream and they gather here.</p>
      </section>`;
  }
  const max = list[0].ids.length;
  const shown = state.showAllSyms ? list : list.slice(0, SYMBOLS_SHOWN);
  const rows = shown.map((g) => `
    <li><button type="button" class="bi-sym${g.ids.length > 1 ? ' bi-sym-again' : ''}" data-sym="${esc(g.name)}"
      aria-label="${esc(g.name)}, in ${plural(g.ids.length, 'dream')}. What it can mean">
      <span class="bi-sym-top">
        <span class="bi-sym-name">${esc(g.name)}</span>
        <span class="bi-sym-n">${g.ids.length}</span>
        <span class="bi-sym-go">${icons.chevronRight}</span>
      </span>
      <span class="bi-bar"><i style="width:${Math.max(6, (g.ids.length / max) * 100).toFixed(1)}%"></i></span>
      ${g.brief?.first ? `<span class="bi-sym-mean">${esc(g.brief.first)}</span>` : ''}
    </button></li>`).join('');
  const more = list.length > SYMBOLS_SHOWN
    ? `<button type="button" class="bi-more" data-more-syms aria-expanded="${state.showAllSyms}">${state.showAllSyms ? 'Show fewer' : `Show all ${list.length}`}</button>`
    : '';
  const again = list.filter((g) => g.ids.length > 1).length;
  return `
    <section class="bi-card glass" aria-labelledby="bi-sym-title">
      ${head}
      <p class="bi-sum"><b>${plural(list.length, 'image')}</b> in ${plural(r.dreams.length, 'dream')}${again ? ` · ${again} more than once` : ''}</p>
      <ul class="bi-syms">${rows}</ul>
      ${more}
      <p class="bi-hint">Tap one for its full meaning.</p>
    </section>`;
}

// ---- 6. Dream threads (all time) ----

function threadsHTML(threads) {
  const head = `<div class="bi-card-head"><h2 class="bi-card-title" id="bi-thr-title">Dream threads</h2><span class="bi-card-meta">All time</span></div>`;
  if (threads === undefined) return waiting('bi-thr-title', 'Dream threads', 'All time');
  if (threads === null) return `<section class="bi-card glass" aria-labelledby="bi-thr-title">${head}${offlineLine}</section>`;
  const all = listDreams();
  if (!threads.length) {
    return `
      <section class="bi-card glass" aria-labelledby="bi-thr-title">
        ${head}
        <p class="bi-who-none">A thread starts when an image comes back in a second dream: a person, a place, being chased, water… Then you can follow it through your nights and see how it changes.</p>
      </section>`;
  }
  const first = all.length ? dreamDay(all[all.length - 1]) : localDay();
  const today = localDay();
  const t0 = new Date(`${first}T12:00:00`).getTime();
  const span = Math.max(1, new Date(`${today}T12:00:00`).getTime() - t0);
  const pos = (day) => (((new Date(`${day}T12:00:00`).getTime() - t0) / span) * 100).toFixed(1);
  const shown = state.showAllThreads ? threads : threads.slice(0, THREADS_SHOWN);
  const items = shown.map((t) => {
    const trend = t.trend === 'more' ? '<span class="bi-thr-pill is-more">More often lately</span>'
      : t.trend === 'less' ? '<span class="bi-thr-pill">Quieter lately</span>' : '';
    const shift = t.shift === 'calmer' ? 'Its dreams have grown calmer over time.'
      : t.shift === 'uneasier' ? 'Its dreams have grown more uneasy over time.' : '';
    return `
      <li class="bi-thr">
        <details data-key="thr-${esc(t.name)}">
          <summary>
            <span class="bi-thr-top">
              <span class="bi-thr-name">${esc(t.name)}</span>
              ${trend}
              <span class="bi-thr-go">${icons.chevronRight}</span>
            </span>
            <span class="bi-thr-sub">In ${plural(t.ids.length, 'dream')} · since ${esc(formatDate(t.days[0]))}</span>
            <span class="bi-thr-line" aria-hidden="true">${t.days.map((d) => `<i style="left:${pos(d)}%"></i>`).join('')}</span>
          </summary>
          <div class="bi-thr-body">
            ${t.brief?.meaning ? `<p class="bi-read-text">${esc(sentences(t.brief.meaning, 2))}</p>` : ''}
            ${shift ? `<p class="bi-thr-shift">${esc(shift)}</p>` : ''}
            ${dreamLinksHTML([...t.ids].reverse().slice(0, 6))}
            <button type="button" class="bi-link" data-sym="${esc(t.name)}">Full meaning of ${esc(lower(t.name))}</button>
          </div>
        </details>
      </li>`;
  }).join('');
  const more = threads.length > THREADS_SHOWN
    ? `<button type="button" class="bi-more" data-more-threads aria-expanded="${state.showAllThreads}">${state.showAllThreads ? 'Show fewer' : `Show all ${threads.length}`}</button>`
    : '';
  return `
    <section class="bi-card glass" aria-labelledby="bi-thr-title">
      ${head}
      <p class="bi-thr-lead">Images that came back across your nights. Open one to follow it through your dreams and see how it is changing.</p>
      <ul class="bi-thrs">${items}</ul>
      ${more}
    </section>`;
}

// ---- 7. Day and night ----

function dayNightHTML(r) {
  const p = periodOf(getPeriod());
  if (!r || r.period.id !== p.id) return '';
  if (r.status !== 'ok') return '';
  const dn = r.dayNight;
  const head = `<div class="bi-card-head"><h2 class="bi-card-title" id="bi-dn-title">Day and night</h2><span class="bi-card-meta">${esc(p.label)}</span></div>`;
  if (!dn?.ready) {
    const have = dn?.pairs || 0;
    return `
      <section class="bi-card glass" aria-labelledby="bi-dn-title">
        ${head}
        <p class="bi-who-none">Dreams often pick up the day before. Write a few lines about the day before a dream (on its page, under “Your day before”) and this card shows what your days and nights share.</p>
        <p class="bi-dn-progress"><span class="bi-bar"><i style="width:${((have / 3) * 100).toFixed(0)}%"></i></span><span>${have} of 3 dreams with a day note</span></p>
      </section>`;
  }
  const lines = [];
  if (dn.withEcho) {
    lines.push(`<p class="bi-read-text"><b>${dn.withEcho} of ${plural(dn.pairs, 'dream')}</b> with a note about the day before picked up something from that day.</p>`);
    if (dn.echoes.length) lines.push(`<p class="bi-chips">${dn.echoes.map((e) => chip({ name: e.name }, e.n > 1 ? `<small>${e.n}</small>` : '')).join('')}</p>`);
  } else {
    lines.push(`<p class="bi-read-text">In ${plural(dn.pairs, 'dream')} with a note about the day before, no image from our library appears in both. Connections can be in feelings rather than things.</p>`);
  }
  for (const w of dn.words) {
    lines.push(`<p class="bi-read-text">Before <b>${w.n} of your ${w.of} ${w.mood === 'uneasy' ? 'uneasy' : 'light'} dreams</b>, your day notes mention “${esc(w.word)}”.</p>`);
  }
  return `
    <section class="bi-card glass" aria-labelledby="bi-dn-title">
      ${head}
      ${lines.join('')}
      <p class="bi-read-note">Dream research finds that dreams often carry on the concerns of our days. Links show only with real numbers from your own notes.</p>
    </section>`;
}

// ---- 8. Lucid dreaming ----

function lucidHTML(threads) {
  const all = listDreams();
  const lucid = all.filter((d) => dreamType(d) === 'lucid' || d.lucid);
  const control = lucid.filter((d) => d.lucidity?.control === true).length;
  const signs = threads ? dreamSigns(threads) : [];
  const stat = lucid.length
    ? `<p class="bi-read-text"><b>${plural(lucid.length, 'lucid dream')}</b>, the last ${esc(relativeDay(dreamDay(lucid[0])).toLowerCase())}${control ? `. You took control in ${control} of them` : ''}.</p>`
    : '<p class="bi-read-text">No lucid dreams yet: dreams where you know you are dreaming.</p>';
  const signsHTML = signs.length
    ? `
      <h3 class="bi-read-h">Your dream signs</h3>
      <p class="bi-read-text">The images that keep coming back in your dreams make the best cues. When one appears, ask yourself: am I dreaming?</p>
      <p class="bi-chips">${signs.map((g) => chip(g)).join('')}</p>
      <p class="bi-read-text">Practise by day: whenever you meet or think of ${esc(signs.length === 1 ? 'it' : 'one of them')}, do a reality check, such as reading a line twice or looking at your hands.</p>`
    : `<p class="bi-read-text">Your dream signs appear here once images start coming back in your dreams: they are the best cues for noticing that you are dreaming.</p>`;
  return `
    <section class="bi-card glass" aria-labelledby="bi-luc-title">
      <div class="bi-card-head"><h2 class="bi-card-title" id="bi-luc-title">Lucid dreaming</h2><span class="bi-card-meta">All time</span></div>
      ${stat}
      ${threads === undefined ? '' : signsHTML}
      <a class="bi-care-link" href="#technique/reality-checks">How to do reality checks${icons.chevronRight}</a>
    </section>`;
}

// ---- 9. Milestones ----

function bestStreak(days) {
  const list = [...new Set(days)].sort();
  let best = 0;
  let run = 0;
  let prev = null;
  for (const d of list) {
    const t = new Date(`${d}T12:00:00`).getTime();
    run = prev !== null && Math.round((t - prev) / 86400000) === 1 ? run + 1 : 1;
    best = Math.max(best, run);
    prev = t;
  }
  return best;
}

const MILESTONES = [
  ['dreams', 1, 'First dream'], ['dreams', 5, '5 dreams'], ['dreams', 10, '10 dreams'], ['dreams', 25, '25 dreams'],
  ['dreams', 50, '50 dreams'], ['dreams', 100, '100 dreams'], ['dreams', 250, '250 dreams'],
  ['streak', 3, '3 nights in a row'], ['streak', 7, 'A week in a row'], ['streak', 14, 'Two weeks in a row'], ['streak', 30, 'A month in a row'],
  ['lucid', 1, 'First lucid dream'], ['lucid', 5, '5 lucid dreams'], ['lucid', 10, '10 lucid dreams'],
  ['days', 1, 'First day and night linked'], ['days', 7, '7 days and nights linked'],
].map(([of, need, label]) => ({ id: `${of}-${need}`, of, need, label }));

const UNIT = { dreams: 'dreams', streak: 'nights in a row', lucid: 'lucid dreams', days: 'days linked' };
const MILE_ICON = { dreams: icons.moon, streak: icons.flame, lucid: icons.lucidity, days: icons.calendar };

function milestoneValues() {
  const all = listDreams();
  return {
    dreams: all.length,
    streak: bestStreak(all.map(dreamDay)),
    lucid: all.filter((d) => dreamType(d) === 'lucid' || d.lucid).length,
    days: all.filter((d) => getDayNote(dayBefore(d))).length,
  };
}

/** Milestones reached since the last visit (worked out once per visit, then remembered as seen). */
function freshMilestones() {
  const v = milestoneValues();
  const seen = new Set(Array.isArray(getSetting('milestonesSeen', null)) ? getSetting('milestonesSeen', []) : []);
  const first = !Array.isArray(getSetting('milestonesSeen', null));
  const reached = MILESTONES.filter((m) => v[m.of] >= m.need).map((m) => m.id);
  setSetting('milestonesSeen', reached);
  return first ? new Set() : new Set(reached.filter((id) => !seen.has(id)));
}

function milestonesHTML() {
  const v = milestoneValues();
  const reached = MILESTONES.filter((m) => v[m.of] >= m.need);
  const next = MILESTONES.filter((m) => v[m.of] < m.need)
    .sort((a, b) => (v[b.of] / b.need) - (v[a.of] / a.need) || a.need - b.need)[0];
  const fresh = state?.fresh || new Set();
  const badges = reached.map((m) => `
    <li class="bi-mile${fresh.has(m.id) ? ' is-new' : ''}">
      <span class="bi-mile-icon" aria-hidden="true">${MILE_ICON[m.of]}</span>
      <span class="bi-mile-label">${esc(m.label)}</span>
      ${fresh.has(m.id) ? '<span class="bi-mile-new">New</span>' : ''}
    </li>`).join('');
  return `
    <section class="bi-card glass" aria-labelledby="bi-mile-title">
      <div class="bi-card-head"><h2 class="bi-card-title" id="bi-mile-title">Milestones</h2><span class="bi-card-meta">${reached.length} of ${MILESTONES.length}</span></div>
      ${next ? `
        <div class="bi-mile-next">
          <p class="bi-mile-next-label"><span>Next: <b>${esc(next.label)}</b></span><span>${Math.min(v[next.of], next.need)} of ${next.need} ${esc(UNIT[next.of])}</span></p>
          <span class="bi-bar"><i style="width:${Math.max(4, (v[next.of] / next.need) * 100).toFixed(1)}%"></i></span>
        </div>` : '<p class="bi-read-text">Every milestone reached. Wonderful.</p>'}
      ${badges ? `<ul class="bi-miles">${badges}</ul>` : '<p class="bi-who-none">Your first milestone comes with your first dream.</p>'}
    </section>`;
}

// ---- 10. Dream types (period) ----

const TYPE_LOOK = {
  general: { icon: icons.moon, hint: 'Everyday dreams' },
  lucid: { icon: icons.lucidity, hint: 'You knew you were dreaming' },
  nightmare: { icon: MOD_ICONS.cloud, hint: 'Frightening or upsetting' },
  prophetic: { icon: icons.sparkle, hint: 'Felt like it might come true' },
};

function typesHTML() {
  const p = periodOf(getPeriod());
  const dreams = listDreams().filter((d) => !p.days || dreamDay(d) >= dayBack(p.days - 1));
  const counts = typeCounts(dreams);
  const total = dreams.length;
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
      <div class="bi-card-head"><h2 class="bi-card-title" id="bi-types-title">Dream types</h2><span class="bi-card-meta">${esc(p.label)}</span></div>
      <ul class="bi-types">${rows}</ul>
      <p class="bi-types-total"><span>Total</span><b>${plural(total, 'dream')}</b></p>
      ${total ? '' : '<p class="bi-hint">Your dream types fill in as you write down dreams.</p>'}
    </section>`;
}

// ---- 11. Symbols map (Dreaming Plus) ----

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

// ---- Reflect questions (shown in the Profile tab) ----

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

/** The Reflect card (questions from the last dreams), shown in the Profile tab. */
export const reflectCardHTML = () => reflectHTML();

// ---- Screen ----

// In page order. Each builds its card from the period's reading (state.read) or the threads (state.threads) when
// it needs them; until they are ready, those cards say "Reading your dreams…".
const SECTIONS = {
  period: () => periodHTML(),
  care: () => careHTML(),
  reading: () => readingHTML(state.read),
  growing: () => growingHTML(),
  who: () => whoHTML(state.read),
  symbols: () => symbolsHTML(state.read),
  threads: () => threadsHTML(state.threads),
  daynight: () => dayNightHTML(state.read),
  lucid: () => lucidHTML(state.threads),
  milestones: () => milestonesHTML(),
  types: () => typesHTML(),
  map: () => mapHTML(),
};

// Re-draws only the sections whose HTML changed, keeping open threads and lists open.
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
    host.hidden = !html;
    state.cache[key] = html;
    if (open.size) for (const d of host.querySelectorAll('details[data-key]')) if (open.has(d.dataset.key)) d.open = true;
  }
}

/** Reads the chosen period and the threads (again after any change), then re-draws. */
async function load() {
  if (!state) return;
  const token = ++state.token;
  const id = state.period;
  let read;
  let threads;
  try {
    [read, threads] = await Promise.all([readPeriod(id), readThreads()]);
  } catch (err) {
    console.error(err);
    read = null;
    threads = null;
  }
  if (!state || token !== state.token) return;
  state.read = read || { status: 'offline', period: periodOf(id), dreams: [], nights: 0, prevCount: null, mood: { dots: [], felt: [] } };
  state.threads = threads;
  paint();
}

function openSymbol(name) {
  if (!state || !name) return;
  openSymbolSheet({ name, navigate: state.navigate });
}

function onRootClick(e) {
  const hit = (sel) => e.target.closest(sel);
  let b;
  if ((b = hit('[data-period]'))) {
    const id = periodOf(b.dataset.period).id;
    if (id !== state.period) {
      setSetting('insightsPeriod', id);
      state.period = id;
      state.showAllSyms = false;
      paint();
      load();
    }
    return;
  }
  if ((b = hit('[data-sym]'))) { openSymbol(b.dataset.sym); return; }
  if (hit('[data-more-syms]')) {
    state.showAllSyms = !state.showAllSyms;
    paint();
    if (state.showAllSyms && state.read?.symbols) loadBriefs(state.read.symbols).then(() => { if (state) { state.cache.symbols = null; paint(); } });
    return;
  }
  if (hit('[data-more-threads]')) {
    state.showAllThreads = !state.showAllThreads;
    paint();
    if (state.showAllThreads && state.threads) loadBriefs(state.threads).then(() => { if (state) { state.cache.threads = null; paint(); } });
    return;
  }
  if (hit('[data-story]')) { if (state.read?.status === 'ok') openStory(state.read, { onSymbol: openSymbol }); return; }
  if (hit('[data-care-hide]')) {
    setSetting('careHiddenUntil', dayBack(-7));
    paint();
    return;
  }
  if (hit('[data-map]')) {
    // A free user gets the paywall instead of the module.
    if (!hasFeature('symbols-map')) { e.preventDefault(); openPaywall({ feature: 'symbols-map' }); }
  }
}

function teardown() {
  if (!state) return;
  for (const off of state.offs) { try { off(); } catch {} }
  closeSymbolSheet();
  closeStory();
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
          <p class="bi-lead">Readings of your dreams: what runs through them, how they felt and what may be behind them.</p>
        </header>
        ${Object.keys(SECTIONS).map((k) => `<div class="bi-sec" data-sec="${k}"></div>`).join('')}
      </div>`;
    const root = el.querySelector('.bi');
    const navigate = (hash) => { if (ctx?.navigate) ctx.navigate(hash); else location.hash = hash; };
    state = {
      root, period: getPeriod(), read: null, threads: undefined, token: 0, cache: {},
      showAllSyms: false, showAllThreads: false, offs: [], navigate, fresh: new Set(),
    };
    try { state.fresh = freshMilestones(); } catch (err) { console.error(err); }
    paint();
    load();
    root.addEventListener('click', onRootClick);

    // New, edited or deleted dreams: read again. Plan changes re-draw the Symbols map card.
    state.offs.push(onChange(() => { paint(); load(); }));
    const onAccount = () => paint();
    window.addEventListener('dreaming:account', onAccount);
    state.offs.push(() => window.removeEventListener('dreaming:account', onAccount));
    getAccount().catch(() => {});
  },

  destroy() {
    teardown();
  },
};
