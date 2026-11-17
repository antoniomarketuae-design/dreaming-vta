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
const MAX_ASKS = 3; // situations per image that may be asked about, one at a time
// Words that name a symbol only by accident in most dreams ("I was back home", "a friend of mine", "the sun rose").
const AMBIGUOUS = new Set(['back', 'face', 'play', 'present', 'mine', 'note', 'flat', 'rose', 'store', 'cross', 'racket', 'watch', 'kid', 'like', 'well', 'left', 'right', 'head']);
// Kinds of entries whose words are often verbs, so "flooding" / "chased" may stand for "flood" / "chase".
const VERBISH = new Set(['theme', 'action', 'nature', 'event']);
// Abstract entries come after the concrete images of a dream.
const ABSTRACT = new Set(['emotion', 'color', 'number', 'shape', 'sound']);
// Phrases that only look like images ("I fell asleep", "cabin crew", "the ring road", "he never does"): they cover
// their words, and nothing overlapping them counts. Found by judges reading 1,200 test dreams.
const BLOCK = new Set(['falling asleep', 'fell asleep', 'fall asleep', 'falls asleep', 'falling apart', 'fell apart',
  'falls apart', 'falling in love', 'fell in love', 'fall in love', 'heart rate', 'by heart', 'have the heart',
  'had the heart', 'cabin crew', 'ring road', 'ring the bell', 'ring the doorbell', 'feet tall', 'foot tall',
  'feet high', 'feet away', 'feet long', 'foot long', 'feet deep', 'head office', 'needed a hand', 'need a hand',
  'give me a hand', 'gave me a hand', 'on the other hand', 'out of hand', 'on the clock', 'clock in', 'clocked in',
  'train of thought', 'time flies', 'time flew', 'does', 'only one', 'guinea pig', 'red bull', 'blood pressure',
  'times table', 'multiplication table', 'table mountain', 'tasmanian devil']);
// The end of a dream ("…then I woke up and my husband was snoring"): what comes after it in the second half of the
// text happened awake, so it is not part of the dream.
const WOKE = /\b(then i woke|and i woke|and woke up|i woke up and|woke up to|when i woke|after i woke|after waking|woke up (sweating|crying|screaming|laughing|shaking)|in real life|irl|writing this)\b/;
// An image right after these words is not there ("no umbrella", "nobody panicked", "instead of fighting").
const NEG = new Set(['no', 'not', 'never', 'nobody', 'without', 'instead', 'nothing', 'none']);
const FIRST = new Set(['i', "i'm", 'im', "i'd", "i've", 'me', 'we', 'myself', 'us', "we're"]);
// Pet and people's names that are also library words: written with a capital mid-sentence ("our dog Biscuit"), a name.
const NAMES = new Set(('daisy lily rose ruby amber jade holly ivy violet poppy hazel willow summer autumn sky river storm '
  + 'hope faith grace joy pearl crystal coco biscuit pebbles clover noodle mittens bear buddy shadow smokey ginger honey '
  + 'pepper oreo peanut cookie muffin patch bella luna star angel bunny fluffy snowy tiger lion fox wolf hunter cinnamon '
  + 'mango olive basil sage rocky duke king prince princess queen mercedes ford jaguar target apple').split(' '));
// Themes about the dreamer's own movement: "leaves falling" or "birds flying" are not the dreamer falling or flying.
const MOTION = new Set(['Falling', 'Floating', 'Flying']);

/**
 * The dream's words as written, lined up with norm()'s words: { cap (a capital letter mid-sentence), sentence }.
 * null when they don't line up (unusual letters), so the checks that need them are skipped.
 */
function casedWords(text, count) {
  const out = [];
  let sentence = 0;
  let start = true;
  const said = []; // each sentence's words, and where its first word is
  for (const m of String(text || '').replace(/[’']/g, "'").matchAll(/[A-Za-z0-9']+|[.!?\n]/g)) {
    if (/^[.!?\n]$/.test(m[0])) { sentence += 1; start = true; continue; }
    if (!said[sentence]) said[sentence] = { from: out.length, words: [] };
    said[sentence].words.push(m[0].toLowerCase());
    out.push({ cap: !start && m[0] !== 'I' && /^[A-Z]/.test(m[0]), sentence });
    start = false;
  }
  if (out.length !== count) return null;
  // everything from the last waking-up words in the second half of the text on is awake
  let woke = Infinity;
  said.forEach((s, i) => {
    if (!s || i < said.length / 2) return;
    const m = WOKE.exec(s.words.join(' '));
    if (m) woke = s.from + s.words.join(' ').slice(0, m.index + m[0].length).split(' ').length;
  });
  out.forEach((c, i) => { c.awake = i >= woke; });
  // Someone Who Writes Like This: capitals tell nothing.
  if (out.filter((c) => c.cap).length > Math.max(3, out.length * 0.25)) for (const c of out) c.cap = false;
  return out;
}

/** True when a found image is only a figure of speech, denied, a name, someone else's movement, or after waking. */
function notReally(h, words, cased) {
  const s = h.start;
  const [p1, p2, p3, p4] = [words[s - 1], words[s - 2], words[s - 3], words[s - 4]];
  const next = words[s + h.len];
  if (NEG.has(p1) || (NEG.has(p2) && !FIRST.has(p1))) return true;
  if (p1 === 'like' || (['a', 'an', 'the', 'some'].includes(p1) && (p2 === 'like' || p2 === 'as' || (p2 === 'of' && p3 === 'size')))) return true;
  if (['sized', 'shaped', 'size'].includes(next)) return true; // "shoebox-sized", "the size of a car"
  if (MOTION.has(h.item.name) && h.len === 1 && ![p1, p2, p3, p4].some((w) => FIRST.has(w))) return true;
  if (cased) {
    const c = cased[s];
    if (c.awake) return true;
    if (c.cap && NAMES.has(words[s])) return true;
    // part of a proper name ("Swan River", "Marble Arch", "Ford Falcon"); places and people keep their name
    const nb = (k) => cased[k] && cased[k].cap;
    if (c.cap && !['theme', 'place', 'person'].includes(h.item.category) && (nb(s - 1) || nb(s + h.len))) return true;
  }
  return false;
}

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
  if (/.'s$/.test(word)) out.push(word.slice(0, -2)); // possessive: mum's → mum
  if (/s'$/.test(word)) out.push(word.slice(0, -1)); // parents' → parents
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
  for (const b of BLOCK) map.set(b, { block: true });
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
  // A short term inside a longer one ("house" inside "house on fire") counts once, as the longer one; nothing that
  // overlaps a blocked phrase counts; nor an image that is only a comparison, denied, a name or someone else moving.
  const blocks = hits.filter((h) => h.item.block);
  const cased = casedWords(text, words.length);
  const kept = hits.filter((h) => !h.item.block
    && !hits.some((o) => o !== h && o.len > h.len && o.start <= h.start && o.start + o.len >= h.start + h.len)
    && !blocks.some((b) => b.start < h.start + h.len && h.start < b.start + b.len)
    && !notReally(h, words, cased));
  const by = new Map();
  for (const h of kept) {
    const g = by.get(h.item.name) || { name: h.item.name, kind: h.item.kind, category: h.item.category, terms: h.item.terms, count: 0, first: h.start, spans: [] };
    g.count += 1;
    g.spans.push([h.start, h.len]);
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
  + 'have has had do does did can cannot could will would than then when while who what which where '
  + 'but too like really also even again about yourself myself yours everyone everybody nobody anybody back time times '
  + 'last first next feel felt look looked looking thing things way').split(' '));
// Word endings off so the forms people write line up: hide/hiding/hid → "hid", chase/chased/chasing → "chas",
// run/running → "run", cry/cried/cries → "cry", rescue/rescued → "rescu", pass/passed → "pass". Never shorter than
// 3 letters, and words that only look like endings stay whole ("bleed", "red", "ring", "fly", "family").
const stem = (w) => {
  let s = w.replace(/'s$/, ''); // child's → child
  let cut = false;
  if (/(ied|ies)$/.test(s) && s.length >= 5) s = `${s.slice(0, -3)}y`;
  else if (/ings$/.test(s) && s.length >= 7) { s = s.slice(0, -4); cut = true; }
  else if (/ing$/.test(s) && s.length >= 6) { s = s.slice(0, -3); cut = true; }
  else if (/[^e]ed$/.test(s) && s.length >= 5) { s = s.slice(0, -2); cut = true; }
  else if (/(s|x|z|ch|sh)es$/.test(s) && s.length >= 5) s = s.slice(0, -2);
  else if (/[^s]s$/.test(s) && s.length >= 4) s = s.slice(0, -1);
  else if (/[^i]ly$/.test(s) && s.length >= 6) s = s.slice(0, -2);
  if (cut && /([bcdfgkmnprtv])\1$/.test(s)) s = s.slice(0, -1); // running → run, stopped → stop (not fall, kiss, buzz)
  if (s.length > 3 && s.endsWith('e')) s = s.slice(0, -1);       // hide → hid, rescue → rescu
  return s.slice(0, 6);
};
const stemsOf = (text) => new Set(norm(text).split(' ').filter((w) => w.length > 2 && !STOP.has(w)).map(stem));
// Word stems found in more than 1 in 20 dreams ("woke", "said", "kept", "dream", "door", "car"): they tell nothing
// about a dream's situation, so they never count towards a match. Measured on 1,200 test dreams.
const GENERIC = new Set(('actual after alway anyth around ask awak away baby becaus bed befor behind big bit call cam car '
  + "check com couldn day didn't differ dog doing don't door dream dreamt driv eat end every everyt fac find float floor "
  + "found front full gav get glass going good green hand head hear hold hom hous how husban i'd i'm i'v insid instea it "
  + 'keep kept kid kitche knew know laugh lif light lin littl liv long mad mak man mayb mother mov mum nam never night '
  + 'normal now old open other outsid past peopl phon play pull put read real red right room round run said sam sat say '
  + 'school see should show sid sit slow smell stand start stop street tabl tak talk tell that think though throug tiny '
  + 'told took top try turn two wak walk want watch water wav week went whit whol wif window wok work year').split(' '));

/**
 * Where each word stem of a dream appears, by sentence ({ stem → Set(sentence) }), and which sentences name an image.
 * A situation's word only counts when it is in a sentence that also names the image: "you are afraid of your
 * partner" fits "I was afraid of my partner", not a dream where the partner is in one scene and fear in another.
 */
function sentencesOf(words, cased) {
  const at = new Map();
  words.forEach((w, i) => {
    if (w.length <= 2 || STOP.has(w)) return;
    const t = stem(w);
    if (!at.has(t)) at.set(t, new Set());
    at.get(t).add(cased ? cased[i].sentence : 0);
  });
  return at;
}

// The image's own words ("sharks" for the sharks entry) never count towards a match, nor the most common words.
// Words naming other images in the dream do count, but one of them alone is not enough ("sharks circle you" must not
// fit a calm swim just because the dream has sharks; "your family is arguing" does fit a dream where the family argues).
// strict (editorial lines): at least two words must match, unless the line has only one word to match.
function fit(when, ctx, own = new Set(), strict = false) {
  const toks = [...new Set(norm(when).split(' ').filter((w) => w.length > 2 && !STOP.has(w)).map(stem))]
    .filter((t) => !own.has(t) && !GENERIC.has(t));
  if (!toks.length) return 0;
  // imageSentences null: the word may be anywhere in the dream
  const hits = toks.filter((t) => [...(ctx.at.get(t) || [])].some((s) => !ctx.imageSentences || ctx.imageSentences.has(s)));
  if (!hits.length || (hits.length === 1 && ctx.imageWords.has(hits[0]))) return 0;
  if (strict && hits.length < 2 && toks.length > 1) return 0;
  return hits.length / toks.length;
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
const imageCache = new Map(); // dream id + content → images (no meanings), for the Insights readings

/** What the reader looks at in a dream: its title, words, chosen feelings and the symbols added to it. */
export function dreamText(dream) {
  const extra = [...(Array.isArray(dream.emotions) ? dream.emotions : []),
    ...Object.values(dream.symbols || {}).flat().filter((s) => typeof s === 'string')].join('. ');
  return `${dream.title || ''}. ${dream.text || ''}. ${extra}`;
}

/**
 * The library images in one dream, without meanings: [{ name, kind ('t' situation | 's' symbol), category, terms,
 * count, first }], situations first. null when the word list is unavailable (offline the first time).
 */
export async function imagesIn(dream) {
  const idx = await getIndex();
  if (!idx) return null;
  const text = dreamText(dream);
  const key = `${dream.id}|${text}`;
  if (!imageCache.has(key)) imageCache.set(key, findImages(text, idx));
  return imageCache.get(key);
}

/** The library images in any text (a day note), as imagesIn(). */
export async function imagesInText(text) {
  const idx = await getIndex();
  return idx ? findImages(String(text || ''), idx) : null;
}

// How much an image of each kind usually matters to a dream, from judges reading 1,200 test dreams: the people in it
// first (they were the images most often missed), body parts, colours and numbers last.
const WEIGHT = { person: 3, animal: 2.5, place: 2, event: 2, vehicle: 1.5, action: 1.2, nature: 1.2, object: 1, plant: 1,
  food: 0.8, emotion: 0.8, body: 0.5, sound: 0.5, number: 0.4, color: 0.3, shape: 0.3 };

/**
 * The images a reading shows: up to 2 situations (themes), then symbols by weight × how often they are mentioned,
 * one of each kind first (two people), so one kind cannot crowd out the others; 5 in all.
 */
function chooseImages(found) {
  const themes = found.filter((f) => f.kind === 't').slice(0, MAX_THEMES);
  const ranked = found.filter((f) => f.kind === 's')
    .map((f) => ({ f, v: (WEIGHT[f.category] ?? 1) * (1 + Math.log2(f.count)) - f.first / 400 }))
    .sort((a, b) => b.v - a.v)
    .map((x) => x.f);
  const picked = [];
  const perKind = new Map();
  for (const f of ranked) {
    const n = perKind.get(f.category) || 0;
    if (n < (f.category === 'person' ? 2 : 1)) { picked.push(f); perKind.set(f.category, n + 1); }
  }
  for (const f of ranked) if (!picked.includes(f)) picked.push(f);
  return [...themes, ...picked].slice(0, MAX_IMAGES);
}

/**
 * The reading for a dream: { status: 'ok', images: [{ name, kind, meaning, situations, ask, isNew, history }],
 * questions } · { status: 'empty' } (no library image found) · { status: 'offline' } (word list unavailable).
 * situations are the lines that may fit, best first, to ask the dreamer about (see answerOf / confirmed).
 */
export async function readDream(dream) {
  const text = dreamText(dream);
  const key = `${dream.id}|${text}`;
  if (cache.has(key)) return cache.get(key);

  const idx = await getIndex();
  if (!idx) return { status: 'offline' };
  const found = findImages(text, idx);
  const chosen = chooseImages(found);
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
  const words = norm(text).split(' ').filter(Boolean);
  const cased = casedWords(text, words.length);
  const at = sentencesOf(words, cased);
  // Words that name concrete images found in this dream ("water" in "a shark in shallow water") don't count towards
  // a situation match either: they are there because of the image, not because of the situation. Feelings do count.
  const imageWords = stemsOf(found.filter((f) => !ABSTRACT.has(f.category)).flatMap((f) => [f.name, ...(f.terms || [])]).join(' '));
  const others = listDreams().filter((d) => d.id !== dream.id);
  const images = loaded.filter(Boolean).map(({ f, entry }) => {
    const isNew = Boolean(entry.answer && entry.answer.meaning);
    const a = isNew ? entry.answer : { meaning: entry.summary || '', depends: entry.contexts || [], ask: entry.questions || [] };
    const own = stemsOf([entry.name, f.name, ...(f.terms || [])].join(' '));
    const ctx = { at, imageWords, imageSentences: new Set((f.spans || []).map(([s]) => (cased ? cased[s].sentence : 0))) };
    const anywhere = { ...ctx, imageSentences: null };
    // The situations that may fit, asked as questions on the dream page ("Was it like this in your dream?"), so a near
    // miss costs nothing: a line may fit when its words are anywhere in the dream; lines whose words share a sentence
    // with the image come first. Researched lines before the editorial ones (answer.more, "Dreaming editorial").
    const rank = (list, strict) => (Array.isArray(list) ? list : [])
      .map((d) => ({ d, near: fit(d.when, ctx, own, strict), any: fit(d.when, anywhere, own, strict) }))
      .filter((x) => x.any >= 0.5)
      .sort((x, y) => (Number(y.near >= 0.5) - Number(x.near >= 0.5)) || (y.any - x.any))
      .map((x) => x.d);
    const situations = [...rank(a.depends, false), ...(isNew ? rank(a.more, true).map((d) => ({ ...d, editorial: true })) : [])]
      .slice(0, MAX_ASKS);
    return {
      id: entry.id || f.name,
      name: entry.name || f.name,
      kind: f.kind,
      category: f.category,
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

// The dreamer's answers to "Was it like this in your dream?", kept on the dream: dream.answers = { key: 'yes' | 'no' }.
export const answerKey = (im, s) => `${im.id}|${s.when}`;
/** 'yes', 'no' or '' (not asked yet) for one situation of one image. */
export const answerOf = (dream, im, s) => (dream?.answers || {})[answerKey(im, s)] || '';
/** The situations of an image that the dreamer said were in the dream. */
export const confirmed = (dream, im) => (im.situations || []).filter((s) => answerOf(dream, im, s) === 'yes');

/** The first n sentences of a paragraph. */
export function sentences(text, n) {
  const parts = String(text || '').match(/[^.!?]+[.!?]+(\s|$)/g) || [String(text || '')];
  return parts.slice(0, n).join('').trim();
}
