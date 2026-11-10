// Symbols across the journal for the new layout's Home and Insights: which symbols keep coming back, in which
// dreams, and what they mean. Meanings come only from the user's own interpretations (answers built from Dreaming's
// knowledge base); a symbol that no interpretation has covered yet has no meaning here, and screens say how to get one.
// Also the dream types (general / lucid / nightmare / prophetic). No DOM or storage access at import time.
import { listDreams, localDay, updateDream, SYMBOL_CATEGORIES } from './store.js';
import { TAGS } from './analyze.js';

const norm = (s) => String(s || '').toLowerCase().replace(/[-_]+/g, ' ').replace(/^(the|a|an|my|your)\s+/, '').trim();
const capital = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** The dream's day (YYYY-MM-DD). */
export const dreamDay = (d) => d?.date || String(d?.createdAt || '').slice(0, 10);

/**
 * Symbols of one dream, most telling first: [{ key, name, meaning?, title?, entry? }].
 * From its interpretation (with meanings), then the symbols the user added, then the ones detected in the text.
 */
export function symbolsOf(d) {
  const out = new Map();
  const add = (raw, extra = {}) => {
    const key = norm(raw);
    if (!key) return;
    const cur = out.get(key);
    if (cur) { if (extra.meaning && !cur.meaning) Object.assign(cur, extra); return; }
    out.set(key, { key, name: capital(key), ...extra });
  };
  const interp = d?.interpretation?.status === 'done' ? d.interpretation.result : null;
  for (const s of Array.isArray(interp?.symbols) ? interp.symbols : []) {
    const leaf = typeof s?.entry === 'string' && s.entry.includes('.') ? s.entry.split('.').pop() : s?.name;
    add(leaf, { meaning: typeof s?.meaning === 'string' ? s.meaning : '', title: s?.name || '', entry: s?.entry || '' });
  }
  for (const c of SYMBOL_CATEGORIES) for (const s of Array.isArray(d?.symbols?.[c]) ? d.symbols[c] : []) add(s);
  for (const t of Array.isArray(d?.tags) ? d.tags : []) if (TAGS[t]?.kind === 'symbol') add(TAGS[t].label);
  return [...out.values()];
}

/**
 * Symbols that keep coming back in the last `days` days (0 = all time), most frequent first:
 * [{ key, name, count, dreamIds, meaning, title, entry, meaningFrom }]. The meaning is the newest one an
 * interpretation gave for that symbol.
 */
export function recurringSymbols({ days = 30 } = {}) {
  const since = days ? localDay(new Date(Date.now() - (days - 1) * 86400000)) : '';
  const map = new Map();
  for (const d of listDreams()) { // newest first
    if (since && dreamDay(d) < since) continue;
    for (const s of symbolsOf(d)) {
      const cur = map.get(s.key) || { key: s.key, name: s.name, count: 0, dreamIds: [], meaning: '', title: '', entry: '', meaningFrom: null };
      cur.count += 1;
      cur.dreamIds.push(d.id);
      if (!cur.meaning && s.meaning) Object.assign(cur, { meaning: s.meaning, title: s.title || '', entry: s.entry || '', meaningFrom: d.id });
      map.set(s.key, cur);
    }
  }
  return [...map.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/** What to say when a symbol has no meaning yet. */
export const NO_MEANING = 'Analyze a dream with this symbol to see what it means for you.';

// ---- Dream types ----

export const DREAM_TYPES = [
  { id: 'general', label: 'General' },
  { id: 'lucid', label: 'Lucid' },
  { id: 'nightmare', label: 'Nightmare' },
  { id: 'prophetic', label: 'Prophetic' },
];

/** The dream's type. Older dreams have none saved: nightmare / lucid flags decide, otherwise general. */
export function dreamType(d) {
  if (DREAM_TYPES.some((t) => t.id === d?.type)) return d.type;
  if (d?.kind === 'nightmare') return 'nightmare';
  if (d?.lucid) return 'lucid';
  return 'general';
}

/** Saves the type, keeping the older kind / lucid fields in step (the current layout reads those). */
export function setDreamType(id, type) {
  const t = DREAM_TYPES.some((x) => x.id === type) ? type : 'general';
  return updateDream(id, { type: t, kind: t === 'nightmare' ? 'nightmare' : 'dream', lucid: t === 'lucid' });
}

/** { general, lucid, nightmare, prophetic } counts for the given dreams (default: all). */
export function typeCounts(dreams = listDreams()) {
  const counts = Object.fromEntries(DREAM_TYPES.map((t) => [t.id, 0]));
  for (const d of dreams) counts[dreamType(d)] += 1;
  return counts;
}
