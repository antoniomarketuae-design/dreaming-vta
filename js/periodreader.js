// Insights readings (the owner's "Option 1", no AI): what a week, a month, a year or the whole journal says when its
// dreams are read together, built from Dreaming's dream library on the phone itself, like the reading of one dream
// (reader.js finds the library's images in each dream; the dream text never leaves the phone). For a period:
//   - how many dreams, on how many nights, against the period before,
//   - the dream mood in one line (feelings chosen, mood words, nightmares, the 1–5 rating),
//   - the main thread and what else keeps coming back, which images are new and which are back again,
//   - "what may be behind it": the library's own readings of those images taken together, the mood, the day before,
//   - people and places, the other recurring images with a line of meaning, questions to ask yourself,
//   - day → night: what the day notes and the dreams after them share (only with enough pairs, with real numbers).
// For the whole journal: dream threads (an image followed through the nights it came back in) and the dreamer's
// dream signs for lucid dreaming. A library entry's short view (first sentences, its core phrase, its questions) is
// kept on the phone for a week (dreaming.libbrief.v2), so Insights does not fetch the same meanings every time.
// No storage access at import time.
import { listDreams, localDay, getDayNote } from './store.js';
import { dreamDay, dreamType } from './symbols.js';
import { TAGS } from './analyze.js';
import { imagesIn, imagesInText, sentences } from './reader.js';
import { loadEntry } from './screens/b/symbolsheet.js';

const DAY = 86400000;
const BRIEF_KEY = 'dreaming.libbrief.v2';
const BRIEF_DAYS = 7;
const BRIEF_MAX = 300;
const MIN_DAY_PAIRS = 3;

export const PERIODS = [
  { id: 'week', label: 'Week', days: 7, title: 'Your week in dreams', past: 'the past 7 days', before: 'the 7 days before' },
  { id: 'month', label: 'Month', days: 30, title: 'Your month in dreams', past: 'the past 30 days', before: 'the 30 days before' },
  { id: 'year', label: 'Year', days: 365, title: 'Your year in dreams', past: 'the past year', before: 'the year before' },
  { id: 'all', label: 'All', days: 0, title: 'Your dreams so far', past: 'your whole journal', before: '' },
];
export const periodOf = (id) => PERIODS.find((p) => p.id === id) || PERIODS[1];

/** The day `n` days before today ("YYYY-MM-DD"). */
export const dayBack = (n) => localDay(new Date(Date.now() - n * DAY));

/** The day before a dream (a dream written down in the morning follows that day's events). */
export function dayBefore(dream) {
  const d = new Date(`${dreamDay(dream)}T12:00:00`);
  d.setDate(d.getDate() - 1);
  return localDay(d);
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const listOf = (items) => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`);
const lower = (s) => (/^[A-Z][a-z]/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s);
export const nameInText = lower;

// ---- Mood of a dream ----

const UNEASY = new Set(['anxious', 'scared', 'sad', 'angry', 'lonely', 'ashamed', 'confused', 'afraid', 'worried',
  'guilty', 'frustrated', 'helpless', 'trapped']);
const LIGHT = new Set(['happy', 'calm', 'excited', 'loved', 'curious', 'amazed', 'free', 'relieved', 'peaceful', 'joyful']);

/** Feelings noted in a dream: the emotions chosen plus the mood words found in it (not "surreal"). */
export function feelingsOf(d) {
  const out = new Set();
  for (const e of Array.isArray(d?.emotions) ? d.emotions : []) if (typeof e === 'string' && e.trim()) out.add(e.trim().toLowerCase());
  for (const t of Array.isArray(d?.tags) ? d.tags : []) if (TAGS[t]?.kind === 'mood' && t !== 'surreal') out.add(TAGS[t].label);
  return out;
}

/** 'uneasy' | 'light' | 'mixed' | '' (nothing to go on), from the feelings, a nightmare and the 1–5 rating. */
export function moodOf(d) {
  const f = [...feelingsOf(d)];
  let uneasy = dreamType(d) === 'nightmare' || f.some((x) => UNEASY.has(x));
  let light = f.some((x) => LIGHT.has(x));
  const r = Number(d?.ratings?.rating);
  if (r && r <= 2) uneasy = true;
  if (r >= 4) light = true;
  return uneasy && light ? 'mixed' : uneasy ? 'uneasy' : light ? 'light' : '';
}

// ---- A library entry's short view ----

// The core of a meaning's first sentence: "Fog in a dream most often reflects confusion and uncertainty: …" →
// "confusion and uncertainty". Empty when the sentence has another shape.
const CORE = /\b(?:most often|often|usually|typically|commonly)\s+(?:reflects?|points? to|stands? for|pictures?|mirrors?|carries|puts you at|marks?|brings up|gives a face to|has to do with|comes with)\s+([^:;.]+)/i;

export function coreOf(text) {
  const m = CORE.exec(String(text || ''));
  if (!m) return '';
  let c = m[1].trim().split(/\s[—–-]\s/)[0].replace(/,? (?:and|or|but) (?:it|this|they) (?:is|are) .*$/, '');
  if (c.length > 80) {
    const cut = c.lastIndexOf(',', 80);
    c = cut > 24 ? c.slice(0, cut) : '';
  }
  return c.replace(/[,\s]+$/, '');
}

let briefs = null;
const briefStore = () => {
  if (!briefs) {
    try { briefs = JSON.parse(localStorage.getItem(BRIEF_KEY) || '{}') || {}; } catch { briefs = {}; }
  }
  return briefs;
};
const saveBriefs = () => { try { localStorage.setItem(BRIEF_KEY, JSON.stringify(briefs)); } catch {} };

/** { name, meaning (up to 3 sentences), first (its first sentence), core, ask: [] } or null (not reachable). */
export async function brief(name) {
  const k = String(name || '').toLowerCase();
  if (!k) return null;
  const store = briefStore();
  const had = store[k];
  if (had && Date.now() - (had.at || 0) < BRIEF_DAYS * DAY) return { ...had, core: coreOf(had.meaning) };
  try {
    const r = await loadEntry(name);
    if (!r?.entry) return had ? { ...had, core: coreOf(had.meaning) } : null;
    const e = r.entry;
    const a = e.answer && e.answer.meaning ? e.answer : null;
    const meaning = String(a ? a.meaning : e.summary || '');
    const ask = (a ? a.ask : e.questions) || [];
    const b = {
      name: e.name || name,
      meaning: sentences(meaning, 3),
      first: sentences(meaning, 1),
      ask: (Array.isArray(ask) ? ask : []).filter((q) => typeof q === 'string' && q.trim()).slice(0, 3),
      at: Date.now(),
    };
    store[k] = b;
    const keys = Object.keys(store);
    if (keys.length > BRIEF_MAX) {
      keys.sort((x, y) => (store[x].at || 0) - (store[y].at || 0)).slice(0, keys.length - BRIEF_MAX).forEach((x) => delete store[x]);
    }
    saveBriefs();
    return { ...b, core: coreOf(b.meaning) };
  } catch {
    return had ? { ...had, core: coreOf(had.meaning) } : null;
  }
}

const briefAll = (items) => Promise.all(items.map(async (i) => { i.brief = await brief(i.name); return i; }));

// ---- The images of the whole journal ----

// Feelings are read as the dream's mood, not as images of their own.
const isImage = (i) => i.category !== 'emotion';

let journal = { sig: '', map: null };

/** dream id → its library images, for every dream; null when the word list is unavailable. */
async function journalImages(dreams) {
  const sig = dreams.map((d) => `${d.id}:${d.updatedAt || d.createdAt || ''}`).join('|');
  if (journal.map && journal.sig === sig) return journal.map;
  const map = new Map();
  for (const d of dreams) {
    const found = await imagesIn(d);
    if (found === null) return null;
    map.set(d.id, found.filter(isImage));
  }
  journal = { sig, map };
  return map;
}

/** The images of a set of dreams, each with the dreams it is in (oldest first), most dreams first. */
function gather(dreams, map) {
  const by = new Map();
  for (const d of [...dreams].sort((a, b) => dreamDay(a).localeCompare(dreamDay(b)))) {
    for (const i of map.get(d.id) || []) {
      const g = by.get(i.name) || { name: i.name, kind: i.kind, category: i.category, ids: [], days: [] };
      if (!g.ids.includes(d.id)) { g.ids.push(d.id); g.days.push(dreamDay(d)); }
      by.set(i.name, g);
    }
  }
  // Situations (themes) and concrete images before colours, numbers, shapes and sounds when the counts are equal.
  const abstract = (g) => (['color', 'number', 'shape', 'sound'].includes(g.category) ? 1 : 0);
  return [...by.values()].sort((a, b) => (b.ids.length - a.ids.length) || (abstract(a) - abstract(b))
    || (a.kind === b.kind ? 0 : a.kind === 't' ? -1 : 1) || a.days[0].localeCompare(b.days[0]));
}

// ---- Day → night ----

const STOP = new Set(('a an the and or but so of in on at to from with by for as into onto over under up down out off '
  + 'it its is are was were be been being am i me my mine we us our you your he him his she her they them their this that '
  + 'these those there here then than when while who what which where why how all any some no not just only very really '
  + 'more most much many lot lots bit little have has had do does did done get got getting go went going gone come came '
  + 'make made take took see saw seen say said tell told think thought know knew feel felt want wanted need needed '
  + 'today yesterday tonight morning evening afternoon night day days week time times after before again also still '
  + 'about around back home well good great nice bad okay ok fine first last next other another thing things something '
  + 'nothing everything someone people bit kind sort quite pretty even though because could would should can will '
  + 'one two three dont didnt cant wasnt im ive its thats').split(' '));

const wordsOf = (text) => new Set(String(text || '').toLowerCase().replace(/[’']/g, '').match(/[a-z]{4,}/g)?.map((w) => (w.length > 4 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w)).filter((w) => !STOP.has(w)) || []);

/**
 * What the days before the dreams share with them: { pairs, ready, echoes: [{ name, n }], withEcho, words: [{ word,
 * n, of, mood }] }. Words are counted only where they set uneasy dreams apart from the others (or light ones),
 * at least twice and before at least half of those dreams.
 */
async function readDayNight(dreams, map) {
  const pairs = [];
  for (const d of dreams) {
    const note = getDayNote(dayBefore(d));
    if (note) pairs.push({ d, note });
  }
  const out = { pairs: pairs.length, ready: pairs.length >= MIN_DAY_PAIRS, echoes: [], withEcho: 0, words: [] };
  if (!out.ready) return out;

  const echo = new Map();
  for (const x of pairs) {
    const inNote = (await imagesInText(x.note)) || [];
    const inDream = new Set((map.get(x.d.id) || []).map((i) => i.name));
    const shared = [...new Set(inNote.filter((i) => isImage(i) && inDream.has(i.name)).map((i) => i.name))];
    if (shared.length) out.withEcho += 1;
    for (const n of shared) echo.set(n, (echo.get(n) || 0) + 1);
  }
  out.echoes = [...echo.entries()].map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n).slice(0, 3);

  for (const mood of ['uneasy', 'light']) {
    const these = pairs.filter((x) => moodOf(x.d) === mood);
    const rest = pairs.filter((x) => moodOf(x.d) !== mood);
    if (these.length < 2) continue;
    const count = (list) => {
      const c = new Map();
      for (const x of list) for (const w of wordsOf(x.note)) c.set(w, (c.get(w) || 0) + 1);
      return c;
    };
    const inThese = count(these);
    const inRest = count(rest);
    const best = [...inThese.entries()]
      .filter(([w, n]) => n >= 2 && n / these.length >= 0.5 && (inRest.get(w) || 0) / Math.max(1, rest.length) < n / these.length)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
    if (best) out.words.push({ word: best[0], n: best[1], of: these.length, mood });
  }
  return out;
}

// ---- A period ----

/**
 * The reading of a period: { status: 'ok' | 'empty' | 'offline', period, dreams, nights, prevCount, mood, images,
 * main, threads, fresh, back, people, places, symbols, behind, questions, dayNight }.
 * 'offline': the counts and the mood only (the word list could not be fetched the first time).
 */
export async function readPeriod(id) {
  const p = periodOf(id);
  const all = listDreams();
  const since = p.days ? dayBack(p.days - 1) : '';
  const prevSince = p.days ? dayBack(2 * p.days - 1) : '';
  const dreams = all.filter((d) => !since || dreamDay(d) >= since);
  const prev = p.days ? all.filter((d) => dreamDay(d) >= prevSince && dreamDay(d) < since) : null;
  const out = {
    status: 'ok',
    period: p,
    since,
    dreams,
    nights: new Set(dreams.map(dreamDay)).size,
    prevCount: prev ? prev.length : null,
    mood: periodMood(dreams, prev),
  };
  if (!dreams.length) return { ...out, status: 'empty' };

  const map = await journalImages(all);
  if (!map) return { ...out, status: 'offline' };

  const images = gather(dreams, map);
  const firstEver = new Map();
  for (const g of gather(all, map)) firstEver.set(g.name, g.days[0]);
  for (const g of images) {
    g.since = firstEver.get(g.name) || g.days[0];
    g.isNew = !since || g.since >= since;
  }

  const repeated = images.filter((g) => g.ids.length >= 2);
  const main = repeated[0] || (dreams.length === 1 ? images[0] : null) || null;
  const threads = repeated.slice(main && repeated[0] === main ? 1 : 0, 4);
  const people = images.filter((g) => g.category === 'person').slice(0, 5);
  const places = images.filter((g) => g.category === 'place').slice(0, 5);
  const symbols = images.filter((g) => g.category !== 'person' && g.category !== 'place');

  // Meanings: the main thread, the others coming back and the first symbols (the rest load when shown).
  await briefAll([...new Set([main, ...threads, ...symbols.slice(0, 6)].filter(Boolean))]);

  const named = new Set([main, ...threads]);
  const fresh = since ? images.filter((g) => g.isNew && !named.has(g)).slice(0, 3) : [];
  const back = since ? images.filter((g) => !g.isNew && !named.has(g)).sort((a, b) => b.ids.length - a.ids.length).slice(0, 2) : [];
  const dayNight = await readDayNight(dreams, map);

  return {
    ...out,
    images,
    main,
    threads,
    fresh,
    back,
    people,
    places,
    symbols,
    dayNight,
    behind: behindText({ main, threads, mood: out.mood, dayNight, count: dreams.length }),
    questions: periodQuestions({ main, threads, mood: out.mood }),
  };
}

/** The rest of a period's symbols with their meanings (for "Show all"). */
export const loadBriefs = (items) => briefAll(items.filter((i) => !i.brief));

function periodMood(dreams, prev) {
  const m = { uneasy: 0, light: 0, mixed: 0, none: 0, nightmares: 0, prevNightmares: null, dots: [], felt: [] };
  const felt = new Map();
  for (const d of [...dreams].sort((a, b) => dreamDay(a).localeCompare(dreamDay(b)))) {
    const mood = moodOf(d);
    m[mood || 'none'] += 1;
    m.dots.push({ id: d.id, mood, day: dreamDay(d) });
    if (dreamType(d) === 'nightmare') m.nightmares += 1;
    for (const f of feelingsOf(d)) felt.set(f, (felt.get(f) || 0) + 1);
  }
  if (prev) m.prevNightmares = prev.filter((d) => dreamType(d) === 'nightmare').length;
  m.felt = [...felt.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 3).map(([f]) => f);
  return m;
}

/** The mood in one line. */
export function moodLine(m, count, p) {
  const known = m.uneasy + m.light + m.mixed;
  if (!known) return '';
  let s;
  if (m.uneasy > m.light + m.mixed) s = `Mostly uneasy: ${m.uneasy} of ${plural(count, 'dream')} carried fear, worry, sadness or anger`;
  else if (m.light > m.uneasy + m.mixed) s = `Mostly light: ${m.light} of ${plural(count, 'dream')} felt calm, happy or free`;
  else s = `A mix of light and uneasy dreams (${m.light} light, ${m.uneasy} uneasy${m.mixed ? `, ${m.mixed} both` : ''})`;
  if (m.nightmares || m.prevNightmares) {
    s += `; ${m.nightmares ? plural(m.nightmares, 'nightmare') : 'no nightmares'}`;
    if (m.prevNightmares !== null && p.before) s += ` (${m.prevNightmares} in ${p.before})`;
  }
  return `${s}.`;
}

/** The overall lean of a period: 'uneasy' | 'light' | ''. */
const lean = (m) => (m.uneasy > m.light + m.mixed ? 'uneasy' : m.light > m.uneasy + m.mixed ? 'light' : '');

function behindText({ main, threads, mood, dayNight, count }) {
  const cores = [];
  for (const g of [main, ...threads]) {
    const c = g?.brief?.core;
    if (c && !cores.includes(c)) cores.push(c);
    if (cores.length >= 3) break;
  }
  const parts = [];
  if (cores.length) {
    const list = cores.some((c) => c.includes(','))
      ? (cores.length < 2 ? cores[0] : `${cores.slice(0, -1).join('; ')}; and ${cores[cores.length - 1]}`)
      : listOf(cores);
    parts.push(`Read together, the images in ${count === 1 ? 'this dream' : 'these dreams'} most often point to ${list}.`);
  }
  const l = lean(mood);
  if (l === 'uneasy') parts.push(`Most of them felt uneasy. Dreams tend to carry the feelings of our days, so it may be worth asking what has been weighing on you lately.`);
  if (l === 'light') parts.push('Most of them felt light. Dreams tend to carry the feelings of our days, so something may be going well that is worth noticing.');
  if (dayNight?.withEcho >= 2 && dayNight.echoes.length) {
    parts.push(`${dayNight.withEcho} of them picked up something from the day before, such as ${listOf(dayNight.echoes.map((e) => lower(e.name)))}.`);
  }
  return parts.length ? parts : [];
}

function periodQuestions({ main, threads, mood }) {
  const qs = [];
  for (const g of [main, ...threads]) {
    const q = g?.brief?.ask?.[0];
    if (q && !qs.includes(q)) qs.push(q);
    if (qs.length >= 2) break;
  }
  const l = lean(mood);
  if (l === 'uneasy') qs.push('What has been weighing on you most lately, and what is one small thing that would ease it?');
  else if (l === 'light') qs.push('What has been going well lately that your dreams may be echoing?');
  else if (main) qs.push(`Where in your days does something like ${lower(main.name)} show up for you right now?`);
  if (qs.length < 3 && main?.brief?.ask?.[1] && !qs.includes(main.brief.ask[1])) qs.push(main.brief.ask[1]);
  return qs.slice(0, 3);
}

// ---- The whole journal: dream threads and dream signs ----

/**
 * Images that came back in at least two dreams, all time, most dreams first: [{ name, kind, category, ids (oldest
 * first), days, trend: 'more' | 'less' | '', shift: 'calmer' | 'uneasier' | '', brief }]. null when offline.
 */
export async function readThreads(limit = 8) {
  const all = listDreams();
  const map = await journalImages(all);
  if (!map) return null;
  const byId = new Map(all.map((d) => [d.id, d]));
  const recentSince = dayBack(29);
  const beforeSince = dayBack(59);
  const threads = gather(all, map).filter((g) => g.ids.length >= 2 && !['color', 'number', 'shape', 'sound'].includes(g.category));
  for (const t of threads) {
    const recent = t.days.filter((d) => d >= recentSince).length;
    const before = t.days.filter((d) => d >= beforeSince && d < recentSince).length;
    t.trend = recent >= 2 && recent > before ? 'more' : before >= 2 && before > recent ? 'less' : '';
    // How its dreams felt, earlier against later (only with at least two dreams on each side).
    const moods = t.ids.map((id) => moodOf(byId.get(id)));
    const half = Math.floor(moods.length / 2);
    const early = moods.slice(0, half);
    const late = moods.slice(moods.length - half);
    const share = (list) => list.filter((x) => x === 'uneasy' || x === 'mixed').length / Math.max(1, list.length);
    t.shift = '';
    if (half >= 2) {
      const diff = share(late) - share(early);
      if (diff <= -0.5) t.shift = 'calmer';
      if (diff >= 0.5) t.shift = 'uneasier';
    }
  }
  await briefAll(threads.slice(0, limit));
  return threads;
}

/** The dreamer's dream signs: the images that come back most (situations and concrete images, not places alone). */
export function dreamSigns(threads) {
  return (threads || []).filter((t) => t.kind === 't' || !['place'].includes(t.category)).slice(0, 3);
}
