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

export function createDream({ text = '', title, tags, lucid = false, recurring = false, date, createdAt } = {}) {
  const now = createdAt ? new Date(createdAt) : new Date();
  const clean = String(text).trim();
  const dream = {
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
  };
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

/** total, streak (consecutive days with a dream, ending today or yesterday), thisMonth, lucid. */
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

export function exportData() {
  return JSON.stringify({ app: 'dreaming', exportedAt: new Date().toISOString(), dreams: all() }, null, 2);
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
    createDream({ text: s.text, lucid: s.lucid, recurring: s.recurring, createdAt: when.toISOString() });
  }
}
