// The Dream Reader (no AI, the owner's "Option 1"): finds the dream library's symbols and situations in a dream on the
// phone itself (the dream text never leaves it: only the library's word list is downloaded, once a day), fetches the
// meanings of the images it found, and builds one reading: the main thread, what each image means here (the
// "it depends on…" lines that match the dream), how often the image comes back in the dreamer's own journal, and
// questions to ask yourself. The meanings are the library's combined answers (Interpretation/kb/SYNTHESIS.md); older
// entries fall back to their summary and situations.
import { API_BASE } from './interpret.js';
import { listDreams } from './store.js';
import { loadEntry } from './screens/b/symbolsheet.js';

const INDEX_KEY = 'dreaming.libindex.v1'; // its own key: too big for settings (which go into exports)
const DAY = 86400000;
const MAX_IMAGES = 5;
const MAX_THEMES = 2;
// Words that name a symbol only by accident in most dreams ("I was back home", "a friend of mine", "the sun rose").
const AMBIGUOUS = new Set(['back', 'face', 'play', 'present', 'mine', 'note', 'flat', 'rose', 'store', 'cross', 'racket', 'watch', 'kid', 'like', 'well', 'left', 'right']);
// Kinds of entries whose words are often verbs, so "flooding" / "chased" may stand for "flood" / "chase".
const VERBISH = new Set(['theme', 'action', 'nature', 'event']);
// Abstract entries come after the concrete images of a dream.
const ABSTRACT = new Set(['emotion', 'color', 'number', 'shape', 'sound']);

const norm = (s) => String(s || '')
  .toLowerCase()
  .replace(/[’']/g, "'")
  .replace(/[^a-z0-9' ]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

/** -ing / -ed forms back to a base ("flooding" → "flood", "running" → "run", "chased" → "chase"). */
function verbBases(word) {
  const out = [];
  const m = /^(.{3,}?)(ing|ed)$/.exec(word);
  if (!m) return out;
  const root = m[1];
  out.push(root, `${root}e`);
  if (/(.)\1$/.test(root)) out.push(root.slice(0, -1)); // running → run
  if (/i$/.test(root)) out.push(`${root.slice(0, -1)}y`); // tried → try
  return out;
}

/** Simple singular forms ("snakes" → "snake", "boxes" → "box", "babies" → "baby"), as the server does. */
function singulars(word) {
  const out = [];
  if (/ies$/.test(word)) out.push(`${word.slice(0, -3)}y`);
  if (/(s|x|z|ch|sh)es$/.test(word)) out.push(word.slice(0, -2));
  if (/s$/.test(word) && !/ss$/.test(word)) out.push(word.slice(0, -1));
  return out;
}

// ---- The word list ----

let index = null; // { map: Map(term → { name, kind, terms }), maxWords }

async function getIndex() {
  if (index) return index;
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(INDEX_KEY) || 'null'); } catch {}
  let data = saved && Array.isArray(saved.items) ? saved : null;
  if (!data || Date.now() - (saved.at || 0) > DAY) {
    try {
      const res = await fetch(`${API_BASE}/library/index`, { credentials: 'omit' });
      if (res.ok) {
        const j = await res.json();
        if (Array.isArray(j.items)) {
          data = { v: j.v, items: j.items, at: Date.now() };
          try { localStorage.setItem(INDEX_KEY, JSON.stringify(data)); } catch {}
        }
      }
    } catch {}
  }
  if (!data) return null;
  const map = new Map();
  let maxWords = 1;
  for (const [name, kind, terms, category] of data.items) {
    const item = { name, kind, terms, category: category || (kind === 't' ? 'theme' : '') };
    for (const t of terms) {
      if (AMBIGUOUS.has(t)) continue;
      const had = map.get(t);
      if (!had || (kind === 's' && had.kind === 't')) map.set(t, item);
      maxWords = Math.max(maxWords, t.split(' ').length);
    }
  }
  index = { map, maxWords: Math.min(maxWords, 7) };
  return index;
}

/** The library images in a text: themes first, then symbols (most mentioned, then first mentioned). */
function findImages(text, idx) {
  const words = norm(text).split(' ').filter(Boolean);
  const hits = [];
  for (let i = 0; i < words.length; i += 1) {
    for (let n = Math.min(idx.maxWords, words.length - i); n >= 1; n -= 1) {
      const head = words.slice(i, i + n - 1);
      let item = idx.map.get([...head, words[i + n - 1]].join(' '));
      if (!item) {
        for (const s of singulars(words[i + n - 1])) {
          item = idx.map.get([...head, s].join(' '));
          if (item) break;
        }
      }
      if (!item) {
        for (const b of verbBases(words[i + n - 1])) {
          const cand = idx.map.get([...head, b].join(' '));
          if (cand && VERBISH.has(cand.category)) { item = cand; break; }
        }
      }
      if (item) { hits.push({ item, start: i, len: n }); break; } // the longest term starting here
    }
  }
  // A short term inside a longer one ("house" inside "house on fire") counts once, as the longer one.
  const kept = hits.filter((h) => !hits.some((o) => o !== h && o.len > h.len && o.start <= h.start && o.start + o.len >= h.start + h.len));
  const by = new Map();
  for (const h of kept) {
    const g = by.get(h.item.name) || { name: h.item.name, kind: h.item.kind, category: h.item.category, terms: h.item.terms, count: 0, first: h.start };
    g.count += 1;
    by.set(h.item.name, g);
  }
  // Situations (themes) first, then concrete images, then feelings and other abstract ones; each group in story order.
  const rank = (g) => (g.kind === 't' ? 0 : ABSTRACT.has(g.category) ? 2 : 1);
  return [...by.values()].sort((a, b) => (rank(a) - rank(b)) || (a.first - b.first));
}

// ---- Which "it depends on…" lines fit this dream ----

const STOP = new Set(('a an the you your yours it its is are was were be been being or and of in on at to from with by for as '
  + 'into onto over under up down out off one someone something somebody anyone they them their he she him her his hers we '
  + 'our us i me my this that these those there here very more most not no just only still all any some own get gets got '
  + 'have has had do does did can cannot could will would than then when while who what which where').split(' '));
const stem = (w) => w.replace(/(ings|ing|ied|ies|ed|es|s|ly)$/, '').slice(0, 6);
const stemsOf = (text) => new Set(norm(text).split(' ').filter((w) => w.length > 2 && !STOP.has(w)).map(stem));

function fit(when, stems) {
  const toks = norm(when).split(' ').filter((w) => w.length > 2 && !STOP.has(w)).map(stem);
  if (!toks.length) return 0;
  const hit = toks.filter((t) => stems.has(t)).length;
  return hit ? hit / toks.length : 0;
}

/** How many of the other dreams show this image (by its words), and since when. */
function historyOf(terms, others) {
  let count = 0;
  let since = '';
  for (const d of others) {
    const words = ` ${norm(`${d.title || ''} ${d.text || ''}`)} `;
    if (terms.some((t) => words.includes(` ${t} `) || words.includes(` ${t}s `))) {
      count += 1;
      const day = String(d.date || '');
      if (day && (!since || day < since)) since = day;
    }
  }
  return { count, since };
}

const cache = new Map(); // dream id + content → reading

/**
 * The reading for a dream: { status: 'ok', images: [{ name, kind, meaning, situations, ask, isNew, history }],
 * questions } · { status: 'empty' } (no library image found) · { status: 'offline' } (word list unavailable).
 */
export async function readDream(dream) {
  const extra = [...(Array.isArray(dream.emotions) ? dream.emotions : []),
    ...Object.values(dream.symbols || {}).flat().filter((s) => typeof s === 'string')].join('. ');
  const text = `${dream.title || ''}. ${dream.text || ''}. ${extra}`;
  const key = `${dream.id}|${text}`;
  if (cache.has(key)) return cache.get(key);

  const idx = await getIndex();
  if (!idx) return { status: 'offline' };
  const found = findImages(text, idx);
  const themes = found.filter((f) => f.kind === 't').slice(0, MAX_THEMES);
  // One image of each kind first (a place, an animal, a person…), then the rest, so one kind cannot crowd out the others.
  const symbols = found.filter((f) => f.kind === 's');
  const picked = [];
  const kinds = new Set();
  for (const f of symbols) if (!kinds.has(f.category)) { picked.push(f); kinds.add(f.category); }
  for (const f of symbols) if (!picked.includes(f)) picked.push(f);
  const chosen = [...themes, ...picked].slice(0, MAX_IMAGES);
  if (!chosen.length) {
    const out = { status: 'empty' };
    cache.set(key, out);
    return out;
  }

  const loaded = await Promise.all(chosen.map(async (f) => {
    try {
      const r = await loadEntry(f.name);
      return r && r.entry ? { f, entry: r.entry } : null;
    } catch {
      return null;
    }
  }));
  const stems = stemsOf(text);
  const others = listDreams().filter((d) => d.id !== dream.id);
  const images = loaded.filter(Boolean).map(({ f, entry }) => {
    const isNew = Boolean(entry.answer && entry.answer.meaning);
    const a = isNew ? entry.answer : { meaning: entry.summary || '', depends: entry.contexts || [], ask: entry.questions || [] };
    const situations = (Array.isArray(a.depends) ? a.depends : [])
      .map((d) => ({ d, s: fit(d.when, stems) }))
      .filter((x) => x.s >= 0.5)
      .sort((x, y) => y.s - x.s)
      .slice(0, 2)
      .map((x) => x.d);
    return {
      name: entry.name || f.name,
      kind: f.kind,
      meaning: String(a.meaning || ''),
      situations,
      ask: (Array.isArray(a.ask) ? a.ask : []).filter(Boolean),
      isNew,
      history: historyOf(f.terms, others),
    };
  }).filter((im) => im.meaning);
  if (!images.length) return { status: 'offline' };

  // Up to 3 questions, the main image's first.
  const questions = [];
  for (let round = 0; round < 3 && questions.length < 3; round += 1) {
    for (const im of images) {
      const q = im.ask[round];
      if (q && !questions.includes(q) && questions.length < 3) questions.push(q);
    }
  }
  const out = { status: 'ok', images, questions };
  cache.set(key, out);
  return out;
}

/** The first n sentences of a paragraph. */
export function sentences(text, n) {
  const parts = String(text || '').match(/[^.!?]+[.!?]+(\s|$)/g) || [String(text || '')];
  return parts.slice(0, n).join('').trim();
}
