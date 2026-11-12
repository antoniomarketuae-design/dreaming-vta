// Where dreams live: this phone's own storage (localStorage). Nothing leaves the device.
// Never touches localStorage at import time, only when a function is called.
import { detectTags, suggestTitle } from './analyze.js';

const DREAMS_KEY = 'dreaming.dreams.v1';
const SETTINGS_KEY = 'dreaming.settings.v1';
const listeners = new Set();
let cache = null;

const pad = (n) => String(n).padStart(2, '0');

/** "YYYY-MM-DD" in local time. */
export function localDay(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

function all() {
  if (!cache) cache = read(DREAMS_KEY, []);
  return cache;
}

function commit() {
  cache.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  write(DREAMS_KEY, cache);
  for (const fn of listeners) { try { fn(); } catch {} }
}

/** All dreams, newest first. */
export function listDreams() {
  return [...all()];
}

export function getDream(id) {
  return all().find((d) => d.id === id) ?? null;
}

/** The six symbol categories of the editor's Symbols tab. */
export const SYMBOL_CATEGORIES = ['people', 'objects', 'characters', 'places', 'themes', 'actions'];

/**
 * Full shape of a dream (older dreams lack the newer fields; read them through withDefaults).
 *   kind: 'dream' | 'nightmare'
 *   ratings: { rating, length, sleep }            each 1–5 or null
 *   emotions: [string]
 *   questions: { inDream, matchesMood, realLife }  each true / false / null  (recurring is top-level)
 *   symbols: { people, objects, characters, places, themes, actions }  arrays of strings
 *   lucidity: { control: true/false/null, vividness: 1–5 or null }    (lucid is top-level)
 *   sleep: { bedtime: "23:30" | null, wake: "07:10" | null, quality: 1–5 or null }
 *   notes: string
 */
export function withDefaults(d) {
  return {
    kind: 'dream',
    ratings: { rating: null, length: null, sleep: null },
    emotions: [],
    questions: { inDream: null, matchesMood: null, realLife: null },
    symbols: Object.fromEntries(SYMBOL_CATEGORIES.map((c) => [c, []])),
    lucidity: { control: null, vividness: null },
    sleep: { bedtime: null, wake: null, quality: null },
    notes: '',
    ...d,
    ratings: { rating: null, length: null, sleep: null, ...(d?.ratings || {}) },
    questions: { inDream: null, matchesMood: null, realLife: null, ...(d?.questions || {}) },
    symbols: { ...Object.fromEntries(SYMBOL_CATEGORIES.map((c) => [c, []])), ...(d?.symbols || {}) },
    lucidity: { control: null, vividness: null, ...(d?.lucidity || {}) },
    sleep: { bedtime: null, wake: null, quality: null, ...(d?.sleep || {}) },
  };
}

export function createDream({ text = '', title, tags, lucid = false, recurring = false, date, createdAt, ...extra } = {}) {
  const now = createdAt ? new Date(createdAt) : new Date();
  const clean = String(text).trim();
  const dream = withDefaults({
    ...extra,
    id: `d${now.getTime().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    createdAt: now.toISOString(),
    date: date || localDay(now),
    text: clean,
    title: title?.trim() || suggestTitle(clean),
    titleEdited: Boolean(title?.trim()),
    tags: tags ?? detectTags(clean),
    lucid: Boolean(lucid),
    recurring: Boolean(recurring),
    seed: Math.floor(Math.random() * 2 ** 31),
  });
  all().push(dream);
  commit();
  return dream;
}

export function updateDream(id, patch) {
  const dream = getDream(id);
  if (!dream) return null;
  Object.assign(dream, patch, { updatedAt: new Date().toISOString() });
  if ('title' in patch) dream.titleEdited = true;
  else if ('text' in patch && !dream.titleEdited) dream.title = suggestTitle(dream.text);
  commit();
  return dream;
}

export function deleteDream(id) {
  const list = all();
  const i = list.findIndex((d) => d.id === id);
  if (i >= 0) { list.splice(i, 1); commit(); }
}

/** Calls fn after any change to the dreams. Returns an unsubscribe function. */
export function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Distinct symbols (all six categories) and emotions across all dreams. */
export function collection() {
  const symbols = new Set();
  const emotions = new Set();
  for (const d of all().map(withDefaults)) {
    for (const c of SYMBOL_CATEGORIES) for (const s of d.symbols[c] || []) symbols.add(`${c}:${String(s).toLowerCase().trim()}`);
    for (const e of d.emotions || []) emotions.add(String(e).toLowerCase().trim());
  }
  return { symbols: symbols.size, emotions: emotions.size, symbolList: [...symbols].map((s) => s.split(':')), emotionList: [...emotions] };
}

/** Dreams per day for the last `days` days, oldest first: [{ date, count }]. */
export function recallByDay(days = 31) {
  const counts = new Map();
  for (const d of all()) counts.set(d.date, (counts.get(d.date) || 0) + 1);
  const out = [];
  const cursor = new Date();
  cursor.setDate(cursor.getDate() - (days - 1));
  for (let i = 0; i < days; i += 1) {
    const day = localDay(cursor);
    out.push({ date: day, count: counts.get(day) || 0 });
    cursor.setDate(cursor.getDate() + 1);
  }
  return out;
}

export function loggedToday() {
  const today = localDay();
  return all().some((d) => d.date === today || d.createdAt.slice(0, 10) === today);
}

// ---- Onboarding profile, dream goals, "seen" markers ----

/**
 * Profile keys (all optional): name, gender, age, foundVia, mainGoal ('analysis'|'lucid'|'journal'), recall,
 * nightmares, techniquesKnown[], lucidGoals[], interpretationStyle, dreamTypes[], topics[], dailyMinutes,
 * monthlyGoal, sleepSchedule {bedtime, wake}, artStyle, lifeGoals[], personalGoal, onboarded (bool), onboardedAt.
 */
export function getProfile() {
  return getSetting('profile', {});
}

export function setProfile(patch) {
  setSetting('profile', { ...getProfile(), ...patch });
}

export function listGoals() {
  return getSetting('dreamGoals', []);
}

export function addGoal(text) {
  const goal = { id: `g${Date.now().toString(36)}`, text: String(text).trim(), done: false, createdAt: new Date().toISOString() };
  if (goal.text) setSetting('dreamGoals', [...listGoals(), goal]);
  return goal;
}

export function updateGoal(id, patch) {
  setSetting('dreamGoals', listGoals().map((g) => (g.id === id ? { ...g, ...patch } : g)));
}

export function deleteGoal(id) {
  setSetting('dreamGoals', listGoals().filter((g) => g.id !== id));
}

/** Small "has the user seen X" flags, e.g. 'tab:lucidity', 'technique:wild'. */
export function isSeen(key) {
  return Boolean(getSetting('seen', {})[key]);
}

export function markSeen(key) {
  const seen = getSetting('seen', {});
  if (!seen[key]) setSetting('seen', { ...seen, [key]: true });
}

/** total, streak (consecutive days with a dream, ending today or yesterday), thisMonth, lucid, nightmares. */
export function getStats() {
  const dreams = all();
  const days = new Set(dreams.map((d) => d.date));
  const cursor = new Date();
  if (!days.has(localDay(cursor))) cursor.setDate(cursor.getDate() - 1);
  let streak = 0;
  while (days.has(localDay(cursor))) { streak += 1; cursor.setDate(cursor.getDate() - 1); }
  const month = localDay().slice(0, 7);
  return {
    total: dreams.length,
    streak,
    thisMonth: dreams.filter((d) => d.date.startsWith(month)).length,
    lucid: dreams.filter((d) => d.lucid).length,
    nightmares: dreams.filter((d) => d.kind === 'nightmare').length,
  };
}

// Settings keys in use: 'reminderAsked' (bool), 'reminderTime' ("07:00"), 'inputMode' ('voice' | 'type').
export function getSetting(key, fallback) {
  const s = read(SETTINGS_KEY, {});
  return key in s ? s[key] : fallback;
}

export function setSetting(key, value) {
  const s = read(SETTINGS_KEY, {});
  s[key] = value;
  write(SETTINGS_KEY, s);
}

// ---- Day journal (new layout: connect what happened in the day with the dreams after it) ----
// Kept in settings as dayNotes = { 'YYYY-MM-DD': { text, updatedAt } }.

/** The note for a day ('' when none). */
export function getDayNote(day) {
  return getSetting('dayNotes', {})?.[day]?.text || '';
}

/** Saves (or, with empty text, removes) the note for a day. */
export function setDayNote(day, text) {
  const notes = { ...(getSetting('dayNotes', {}) || {}) };
  const clean = String(text || '').trim().slice(0, 4000);
  if (clean) notes[day] = { text: clean, updatedAt: new Date().toISOString() };
  else delete notes[day];
  setSetting('dayNotes', notes);
}

/** All day notes, newest day first: [{ day, text, updatedAt }]. */
export function listDayNotes() {
  return Object.entries(getSetting('dayNotes', {}) || {})
    .map(([day, n]) => ({ day, text: n?.text || '', updatedAt: n?.updatedAt || '' }))
    .filter((n) => n.text)
    .sort((a, b) => b.day.localeCompare(a.day));
}

export function exportData() {
  return JSON.stringify({ app: 'dreaming', exportedAt: new Date().toISOString(), dreams: all(), dayNotes: getSetting('dayNotes', {}) }, null, 2);
}

/** Adds dreams from an export file; skips ones already here. Returns how many were added. */
export function importData(json) {
  const data = JSON.parse(json);
  const incoming = Array.isArray(data) ? data : data?.dreams;
  if (!Array.isArray(incoming)) throw new Error('No dreams found in that file');
  const ids = new Set(all().map((d) => d.id));
  let added = 0;
  for (const d of incoming) {
    if (d?.id && d.createdAt && !ids.has(d.id)) { all().push(d); added += 1; }
  }
  commit();
  // Day notes from the file fill in days that have none here.
  if (data?.dayNotes && typeof data.dayNotes === 'object') {
    const notes = { ...(getSetting('dayNotes', {}) || {}) };
    for (const [day, n] of Object.entries(data.dayNotes)) if (/^\d{4}-\d{2}-\d{2}$/.test(day) && n?.text && !notes[day]) notes[day] = n;
    setSetting('dayNotes', notes);
  }
  return added;
}

export function clearAll() {
  cache = [];
  commit();
}

const SAMPLES = [
  { daysAgo: 0, lucid: true, text: 'I was flying over a city made of glass. The sky was purple and I could feel the wind under my arms. I knew I was dreaming, so I flew higher towards the moon.' },
  { daysAgo: 1, text: 'I was back at my old school but the hallways were flooded with warm water. I swam between classrooms looking for my exam and I was late.' },
  { daysAgo: 2, recurring: true, text: 'A big black dog chased me through a forest at night. I hid behind a tree and the dog turned into a friendly cat.' },
  { daysAgo: 4, text: 'My grandmother and I were baking bread in a house by the sea. Everything smelled warm and I felt completely calm and happy.' },
  { daysAgo: 5, text: 'I was falling from a tall building but landed softly in a field of glowing flowers under the stars.' },
  { daysAgo: 7, text: 'I was on a train that never stopped, travelling through cities I did not recognise. I lost my ticket and felt anxious.' },
  { daysAgo: 9, recurring: true, text: 'There was a fire on the beach and people were dancing around it. I swam out into the dark ocean and the water was full of stars.' },
];

/** Fills the journal with example dreams so the app can be tried out. */
export function addSampleDreams() {
  for (const s of SAMPLES) {
    const when = new Date();
    when.setDate(when.getDate() - s.daysAgo);
    when.setHours(7, 10 + s.daysAgo, 0, 0);
    createDream({ text: s.text, lucid: s.lucid, recurring: s.recurring, createdAt: when.toISOString(), sample: true });
  }
}

const SAMPLE_TEXTS = new Set(SAMPLES.map((s) => s.text));
/** True for the built-in example dreams (Settings → Add sample dreams): flagged, or older ones by their exact text. */
export const isSampleDream = (d) => d?.sample === true || SAMPLE_TEXTS.has(String(d?.text || '').trim());
const isSample = isSampleDream;

/** How many of the built-in example dreams are in the journal. */
export function countSampleDreams() {
  return listDreams().filter(isSample).length;
}

/** Removes only the built-in example dreams; returns how many went. */
export function removeSampleDreams() {
  const ids = listDreams().filter(isSample).map((d) => d.id);
  for (const id of ids) deleteDream(id);
  return ids.length;
}
