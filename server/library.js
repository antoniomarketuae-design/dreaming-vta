// Dream symbol library: general meanings of symbols and themes from Dreaming's knowledge base (Miller 1901,
// Freud 1913 and Dreaming's own editorial writing), served one entry at a time by GET /library/symbol?name=….
// The entries themselves are private product IP: they live only on the server (LIBRARY_DIR, default ./library with
// symbols/*.json and themes/*.json) and are never part of the public repository.
// The interpreter's private guidance (`care`) and the matching lists (aliases, signals) are not sent to phones.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const DIRS = ['symbols', 'themes'];

const norm = (s) => String(s || '')
  .toLowerCase()
  .replace(/[’']/g, "'")
  .replace(/[^a-z0-9' ]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .replace(/^(the|a|an|my|your) /, '');

/** Simple singular forms to try for a word ("eels" → "eel", "boxes" → "box", "babies" → "baby"). */
function singulars(word) {
  const out = [];
  if (/ies$/.test(word)) out.push(`${word.slice(0, -3)}y`);
  if (/(s|x|z|ch|sh)es$/.test(word)) out.push(word.slice(0, -2));
  if (/s$/.test(word) && !/ss$/.test(word)) out.push(word.slice(0, -1));
  return out;
}

let entries = [];
let byId = new Map();
let sources = new Map(); // source key → { title, author, year, kind, culture } (library/sources.json, the register)
let byTerm = new Map(); // normalised name / alias / signal → entry (symbols win over themes for the same term)

/** Loads every entry from `dir`. Returns how many were loaded (0 when the folder is missing). */
export function loadLibrary(dir) {
  const list = [];
  for (const sub of DIRS) {
    const folder = join(dir, sub);
    if (!existsSync(folder)) continue;
    for (const file of readdirSync(folder).filter((f) => f.endsWith('.json'))) {
      try {
        const e = JSON.parse(readFileSync(join(folder, file), 'utf8'));
        if (e && e.id && e.name) list.push(e);
      } catch (err) {
        console.error(`library: skipped ${sub}/${file}: ${err.message}`);
      }
    }
  }
  entries = list;
  byId = new Map(list.map((e) => [e.id, e]));
  sources = new Map();
  try {
    const reg = JSON.parse(readFileSync(join(dir, 'sources.json'), 'utf8'));
    for (const s of Array.isArray(reg) ? reg : []) if (s && s.key) sources.set(s.key, s);
  } catch {}
  byTerm = new Map();
  // Themes first, then symbols, so a symbol's own name or alias replaces a theme's signal of the same words.
  for (const e of [...list.filter((x) => x.kind === 'theme'), ...list.filter((x) => x.kind !== 'theme')]) {
    for (const t of [e.name, ...(e.aliases || []), ...(e.signals || [])]) {
      const k = norm(t);
      if (k) byTerm.set(k, e);
    }
  }
  // An entry's own name always points to itself.
  for (const e of list) byTerm.set(norm(e.name), e);
  return list.length;
}

export const librarySize = () => entries.length;

/**
 * The best entry for a symbol name as the app shows it ("Old friend", "Being chased", "Eels"), or null.
 * Exact name/alias first, then singular forms, then the longest run of words inside the name ("old friend" → "friend").
 */
export function findEntry(name) {
  const k = norm(name);
  if (!k) return null;
  const tryKey = (key) => byTerm.get(key) || singulars(key).map((s) => byTerm.get(s)).find(Boolean) || null;
  let hit = tryKey(k);
  if (hit) return hit;
  const words = k.split(' ');
  for (let len = words.length - 1; len >= 1; len -= 1) {
    for (let i = 0; i + len <= words.length; i += 1) {
      hit = tryKey(words.slice(i, i + len).join(' '));
      if (hit) return hit;
    }
  }
  return null;
}

const str = (v) => (typeof v === 'string' ? v.trim() : '');
/** A source line for readers: without our own page notes ("…(1913), PDF pages 263-264" → "…(1913)"). */
const sourceLine = (v) => str(v).replace(/,?\s*PDF pages?\s*[\d\s,–-]+$/i, '').trim();

/** A source for readers: "Artemidorus, The Interpretation of Dreams (c. 200)" plus its kind and culture. */
function sourceView(key) {
  const s = sources.get(key);
  if (!s) return null;
  const year = Number(s.year);
  const when = Number.isFinite(year) ? (year < 0 ? `${-year} BCE` : year < 1000 ? `c. ${year}` : String(year)) : str(String(s.year || ''));
  return { title: str(s.title), author: str(s.author), year: when, kind: str(s.kind), culture: str(s.culture) };
}

/** The one combined answer (see Interpretation/kb/SYNTHESIS.md), or null when the entry has none yet. */
function answerView(a) {
  if (!a || typeof a !== 'object' || !str(a.meaning)) return null;
  const used = (Array.isArray(a.basedOn) ? a.basedOn : []).map(str).filter(Boolean);
  return {
    meaning: str(a.meaning),
    depends: (Array.isArray(a.depends) ? a.depends : []).filter((d) => d && str(d.meaning)).map((d) => ({ when: str(d.when), meaning: str(d.meaning) })),
    ask: (Array.isArray(a.ask) ? a.ask : []).map(str).filter(Boolean),
    confidence: ['high', 'medium', 'low'].includes(a.confidence) ? a.confidence : null,
    sources: used.map(sourceView).filter(Boolean),
    sourceCount: used.length,
  };
}

/** What a phone gets for one entry. */
export function publicEntry(e) {
  const perspectives = {};
  for (const [key, v] of Object.entries(e.perspectives || {})) {
    if (typeof v === 'string' && v.trim()) perspectives[key] = v.trim();
    else if (v && typeof v === 'object' && str(v.text)) perspectives[key] = { text: str(v.text), ...(sourceLine(v.source) ? { source: sourceLine(v.source) } : {}) };
  }
  const contexts = (Array.isArray(e.contexts) ? e.contexts : Array.isArray(e.variations) ? e.variations : [])
    .filter((c) => c && str(c.meaning))
    .map((c) => ({ when: str(c.when), meaning: str(c.meaning) }));
  return {
    id: e.id,
    kind: e.kind === 'theme' ? 'theme' : 'symbol',
    name: e.name,
    summary: str(e.summary),
    contexts,
    perspectives,
    questions: (Array.isArray(e.questions) ? e.questions : []).map(str).filter(Boolean),
    related: (Array.isArray(e.related) ? e.related : []).map((id) => byId.get(id)).filter(Boolean).map((r) => ({ id: r.id, name: r.name })),
    sources: (Array.isArray(e.sources) ? e.sources : []).map(str).filter(Boolean),
    answer: answerView(e.answer),
  };
}
