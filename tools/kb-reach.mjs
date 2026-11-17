// How well the app's dream reader recognises library images in dreams, measured on this PC.
// It builds the same word list the server sends the phone (GET /library/index) and matches it exactly the way
// app/js/reader.js does (whole words, longest phrase first, plural and -ing/-ed forms of the last word), so a
// change to aliases/signals can be measured before it goes live.
//   node tools/kb-reach.mjs [corpus.json …]        summary + the most common words no image covered
//   node tools/kb-reach.mjs --dreams [corpus.json] every dream with the images found
//   node tools/kb-reach.mjs --term "<words>"       which entry a phrase lands on
//   node tools/kb-reach.mjs --expect <corpus.json> <expected.json>
//        recall against hand-listed images ({id, expect: ["teeth falling out", …]}): an expected image counts as
//        found when the entry its words land on is among the dream's images; "no entry" = a gap in the library,
//        "missed" = the library has it but the dream's own wording didn't reach it (more words/phrases needed)
// A corpus is a JSON array of { id?, text } or { dream: { text } }. Default: Interpretation/tests/*.json and the
// testers' dreams in Interpretation/runs/*.dream.json.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..', 'Interpretation');
const KB = process.env.KB_DIR || join(ROOT, 'kb'); // KB_DIR: measure another copy of the library (e.g. a backup)

// ---- The word list, as server/library.js builds it ----

const serverNorm = (s) => String(s || '')
  .toLowerCase()
  .replace(/[’']/g, "'")
  .replace(/[^a-z0-9' ]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .replace(/^(the|a|an|my|your) /, '');

export function loadEntries() {
  const out = [];
  for (const dir of ['themes', 'symbols']) {
    for (const f of readdirSync(join(KB, dir)).filter((n) => n.endsWith('.json'))) {
      out.push(JSON.parse(readFileSync(join(KB, dir, f), 'utf8')));
    }
  }
  return out;
}

export function indexItems(entries = loadEntries()) {
  return entries.map((e) => ({
    id: e.id,
    name: e.name,
    kind: e.kind === 'theme' ? 't' : 's',
    category: e.kind === 'theme' ? 'theme' : String(e.category || e.id.split('.')[0] || ''),
    terms: [...new Set([e.name, ...(e.aliases || []), ...(e.signals || [])].map(serverNorm).filter((t) => t && t.length > 1))],
  }));
}

// ---- Matching, as app/js/reader.js does it ----

const AMBIGUOUS = new Set(['back', 'face', 'play', 'present', 'mine', 'note', 'flat', 'rose', 'store', 'cross', 'racket', 'watch', 'kid', 'like', 'well', 'left', 'right', 'head']);
const VERBISH = new Set(['theme', 'action', 'nature', 'event']);
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

function verbBases(word) {
  const out = [];
  const m = /^(.{3,}?)(ing|ed)$/.exec(word);
  if (!m) return out;
  const root = m[1];
  out.push(root, `${root}e`);
  if (/(.)\1$/.test(root)) out.push(root.slice(0, -1));
  if (/i$/.test(root)) out.push(`${root.slice(0, -1)}y`);
  return out;
}

function singulars(word) {
  const out = [];
  if (/ies$/.test(word)) out.push(`${word.slice(0, -3)}y`);
  if (/(s|x|z|ch|sh)es$/.test(word)) out.push(word.slice(0, -2));
  if (/s$/.test(word) && !/ss$/.test(word)) out.push(word.slice(0, -1));
  if (/.'s$/.test(word)) out.push(word.slice(0, -2)); // possessive: mum's → mum
  if (/s'$/.test(word)) out.push(word.slice(0, -1)); // parents' → parents
  return out;
}

export function buildIndex(items) {
  const map = new Map();
  let maxWords = 1;
  for (const item of items) {
    for (const t of item.terms) {
      if (AMBIGUOUS.has(t)) continue;
      const had = map.get(t);
      if (!had || (item.kind === 's' && had.kind === 't')) map.set(t, item);
      maxWords = Math.max(maxWords, t.split(' ').length);
    }
  }
  for (const b of BLOCK) map.set(b, { block: true });
  return { map, maxWords: Math.min(maxWords, 7) };
}

/** Images in a text, plus which word positions they covered. */
export function findImages(text, idx) {
  const words = norm(text).split(' ').filter(Boolean);
  const hits = [];
  for (let i = 0; i < words.length; i += 1) {
    for (let n = Math.min(idx.maxWords, words.length - i); n >= 1; n -= 1) {
      const head = words.slice(i, i + n - 1);
      let item = idx.map.get([...head, words[i + n - 1]].join(' '));
      if (!item) for (const s of singulars(words[i + n - 1])) { item = idx.map.get([...head, s].join(' ')); if (item) break; }
      if (!item) {
        for (const b of verbBases(words[i + n - 1])) {
          const cand = idx.map.get([...head, b].join(' '));
          if (cand && VERBISH.has(cand.category)) { item = cand; break; }
        }
      }
      if (item) { hits.push({ item, start: i, len: n }); break; }
    }
  }
  const blocks = hits.filter((h) => h.item.block);
  const cased = casedWords(text, words.length);
  const kept = hits.filter((h) => !h.item.block
    && !hits.some((o) => o !== h && o.len > h.len && o.start <= h.start && o.start + o.len >= h.start + h.len)
    && !blocks.some((b) => b.start < h.start + h.len && h.start < b.start + b.len)
    && !notReally(h, words, cased));
  const covered = new Set();
  for (const h of kept) for (let k = h.start; k < h.start + h.len; k += 1) covered.add(k);
  const by = new Map();
  for (const h of kept) {
    const g = by.get(h.item.id) || { ...h.item, count: 0, first: h.start, said: words.slice(h.start, h.start + h.len).join(' '), spans: [] };
    g.count += 1;
    g.spans.push([h.start, h.len]);
    by.set(h.item.id, g);
  }
  const rank = (g) => (g.kind === 't' ? 0 : ABSTRACT.has(g.category) ? 2 : 1);
  return { images: [...by.values()].sort((a, b) => (rank(a) - rank(b)) || (a.first - b.first)), words, covered };
}

// ---- Situations ("it depends on…"), as app/js/reader.js picks them ----

const SIT_STOP = new Set(('a an the you your yours it its is are was were be been being or and of in on at to from with by for as '
  + 'into onto over under up down out off one someone something somebody anyone they them their he she him her his hers we '
  + 'our us i me my this that these those there here very more most not no just only still all any some own get gets got '
  + 'have has had do does did can cannot could will would than then when while who what which where '
  + 'but too like really also even again about yourself myself yours everyone everybody nobody anybody back time times '
  + 'last first next feel felt look looked looking thing things way').split(' '));
// Word endings off so the forms people write line up: hide/hiding/hid → "hid", chase/chased/chasing → "chas",
// run/running → "run", cry/cried/cries → "cry", rescue/rescued → "rescu", pass/passed → "pass". Never shorter than
// 3 letters, and words that only look like endings stay whole ("bleed", "red", "ring", "fly", "family").
const sitStem = (w) => {
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
const stemsOf = (text) => new Set(norm(text).split(' ').filter((w) => w.length > 2 && !SIT_STOP.has(w)).map(sitStem));
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
    if (w.length <= 2 || SIT_STOP.has(w)) return;
    const t = sitStem(w);
    if (!at.has(t)) at.set(t, new Set());
    at.get(t).add(cased ? cased[i].sentence : 0);
  });
  return at;
}

function fit(when, ctx, own = new Set(), strict = false) {
  const toks = [...new Set(norm(when).split(' ').filter((w) => w.length > 2 && !SIT_STOP.has(w)).map(sitStem))]
    .filter((t) => !own.has(t) && !GENERIC.has(t));
  if (!toks.length) return 0;
  // imageSentences null: the word may be anywhere in the dream
  const hits = toks.filter((t) => [...(ctx.at.get(t) || [])].some((s) => !ctx.imageSentences || ctx.imageSentences.has(s)));
  if (!hits.length || (hits.length === 1 && ctx.imageWords.has(hits[0]))) return 0;
  if (strict && hits.length < 2 && toks.length > 1) return 0;
  return hits.length / toks.length;
}

/**
 * The reading the phone shows for a dream (app/js/reader.js readDream): images by chooseImages(), each with up to 3
 * situations that may fit (asked as questions on the dream page): researched first, then editorial (editorial: true).
 */
export function readingOf(text, idx, byId) {
  const { images: found, words } = findImages(text, idx);
  const chosen = chooseImages(found);
  const cased = casedWords(text, words.length);
  const at = sentencesOf(words, cased);
  const imageWords = stemsOf(found.filter((f) => !ABSTRACT.has(f.category)).flatMap((f) => [f.name, ...(f.terms || [])]).join(' '));
  const images = [];
  for (const f of chosen) {
    const e = byId.get(f.id);
    if (!e?.answer?.meaning) continue;
    const own = stemsOf([e.name, f.name, ...(f.terms || [])].join(' '));
    const ctx = { at, imageWords, imageSentences: new Set(f.spans.map(([s]) => (cased ? cased[s].sentence : 0))) };
    const anywhere = { ...ctx, imageSentences: null };
    const rank = (list, strict) => (Array.isArray(list) ? list : [])
      .map((d) => ({ d, near: fit(d.when, ctx, own, strict), any: fit(d.when, anywhere, own, strict) }))
      .filter((x) => x.any >= 0.5)
      .sort((x, y) => (Number(y.near >= 0.5) - Number(x.near >= 0.5)) || (y.any - x.any))
      .map((x) => x.d);
    const situations = [...rank(e.answer.depends, false), ...rank(e.answer.more, true).map((d) => ({ ...d, editorial: true }))].slice(0, 3);
    images.push({ f, e, situations });
  }
  return { images, notShown: found.filter((f) => !chosen.includes(f)) };
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
  const themes = found.filter((f) => f.kind === 't').slice(0, 2);
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
  return [...themes, ...picked].slice(0, 5);
}

/** For each image the reader would show, does a researched or editorial situation fit? */
export function situationReport(corpus, idx, byId) {
  let images = 0;
  let researched = 0;
  let editorial = 0;
  const examples = [];
  for (const d of corpus) {
    for (const im of readingOf(d.text, idx, byId).images) {
      images += 1;
      const s = im.situations[0];
      if (!s) continue;
      if (!s.editorial) { researched += 1; continue; }
      editorial += 1;
      if (examples.length < 25) examples.push(`${d.id} ${im.e.id}: "${s.when}"`);
    }
  }
  const pct = (n) => +((n / (images || 1)) * 100).toFixed(1);
  return { imagesShown: images, withResearchedSituation: researched, researchedPct: pct(researched), withEditorialOnly: editorial, editorialPct: pct(editorial), anySituationPct: pct(researched + editorial), editorialExamples: examples };
}

// ---- Corpus ----

function corpusFiles(args) {
  if (args.length) return args;
  const files = [];
  const tests = join(ROOT, 'tests');
  for (const f of readdirSync(tests).filter((n) => n.endsWith('.json'))) files.push(join(tests, f));
  return files;
}

function loadCorpus(files) {
  const out = [];
  for (const file of files) {
    const data = JSON.parse(readFileSync(file, 'utf8'));
    const list = Array.isArray(data) ? data : data.dreams || [];
    list.forEach((d, i) => {
      const text = d?.dream?.text || d?.text || '';
      if (text.trim()) out.push({ id: d.id || `${file.split(/[\\/]/).pop()}#${i + 1}`, text });
    });
  }
  const runs = join(ROOT, 'runs');
  if (!process.argv.slice(2).some((a) => a.endsWith('.json')) && existsSync(runs)) {
    for (const f of readdirSync(runs).filter((n) => n.endsWith('.dream.json'))) {
      try {
        const d = JSON.parse(readFileSync(join(runs, f), 'utf8'));
        if (d && typeof d.text === 'string' && d.text.trim().split(/\s+/).length > 3) out.push({ id: `tester:${f.slice(0, 6)}`, text: d.text });
      } catch {}
    }
  }
  return out;
}

// Words that are never images, for the "not covered" report.
const STOP = new Set(('a an the you your yours it its is are was were be been being or and of in on at to from with by for as into onto over under up down out off one someone something somebody anyone they them their he she him her his hers we us our i me my mine myself this that these those there here then than so but if not no yes all some any very really just like felt feel feeling seemed seem looked look looking got get getting went go going came come coming saw see seeing had have having did do doing said say told tell thought think knew know about around through again still even also only back when while where what who which how why because after before suddenly started start trying tried kept keep could would should might will can lot lots way thing things time times dream dreamed dreamt dreaming woke wake night last then next other another same each every both much many more most little big small long old new first second whole bit kind sort maybe everything nothing anything everyone nobody something somewhere away inside outside toward towards behind front top bottom side end middle part ever never always sometimes once twice gonna wanna kinda idk lol im ive id dont didnt wasnt couldnt cant wont isnt thats theres whats its').split(' '));

function summary(corpus, idx) {
  let total = 0;
  let themes = 0;
  let none = 0;
  let two = 0;
  const missed = new Map();
  const landed = new Map();
  for (const d of corpus) {
    const { images, words, covered } = findImages(d.text, idx);
    total += images.length;
    themes += images.filter((g) => g.kind === 't').length;
    if (!images.length) none += 1;
    if (images.length >= 2) two += 1;
    for (const g of images) landed.set(g.id, (landed.get(g.id) || 0) + 1);
    const seen = new Set();
    words.forEach((w, i) => {
      if (covered.has(i) || w.length < 4 || STOP.has(w) || /^\d+$/.test(w) || seen.has(w)) return;
      seen.add(w);
      missed.set(w, (missed.get(w) || 0) + 1);
    });
  }
  const n = corpus.length || 1;
  return {
    dreams: corpus.length,
    imagesPerDream: +(total / n).toFixed(2),
    themesPerDream: +(themes / n).toFixed(2),
    withNone: none,
    withTwoPlus: two,
    pctTwoPlus: +((two / n) * 100).toFixed(1),
    topMissed: [...missed.entries()].sort((a, b) => b[1] - a[1]).slice(0, 60).map(([w, c]) => `${w} ${c}`),
    mostLanded: [...landed.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([id, c]) => `${id} ${c}`),
  };
}

// ---- CLI ----

if (/[\\/]kb-reach\.mjs$/.test(process.argv[1] || '')) { // run as a command, not imported
  const args = process.argv.slice(2);
  const idx = buildIndex(indexItems());
  if (args[0] === '--term') {
    const { images } = findImages(args.slice(1).join(' '), idx);
    console.log(images.map((g) => `${g.said} → ${g.id}`).join('\n') || 'no entry');
  } else if (args[0] === '--expect') {
    const dreams = new Map(loadCorpus([args[1]]).map((d) => [d.id, d]));
    const expected = JSON.parse(readFileSync(args[2], 'utf8'));
    let total = 0;
    let found = 0;
    let gaps = 0;
    const gapWords = new Map();
    const missedWords = new Map();
    for (const { id, expect } of expected) {
      const d = dreams.get(id);
      if (!d) continue;
      const have = new Set(findImages(d.text, idx).images.map((g) => g.id));
      for (const phrase of expect || []) {
        total += 1;
        const targets = findImages(phrase, idx).images.map((g) => g.id);
        if (!targets.length) { gaps += 1; gapWords.set(phrase.toLowerCase(), (gapWords.get(phrase.toLowerCase()) || 0) + 1); continue; }
        if (targets.some((t) => have.has(t))) found += 1;
        else missedWords.set(`${phrase.toLowerCase()} [${targets[0]}] in ${id}`, 1);
      }
    }
    const pct = (n) => +((n / (total || 1)) * 100).toFixed(1);
    console.log(JSON.stringify({
      expected: total,
      found, foundPct: pct(found),
      libraryGaps: gaps, gapPct: pct(gaps),
      missed: total - found - gaps, missedPct: pct(total - found - gaps),
      topGaps: [...gapWords.entries()].sort((a, b) => b[1] - a[1]).slice(0, 60).map(([w, c]) => `${w} ${c}`),
      missedSample: [...missedWords.keys()].slice(0, 60),
    }, null, 1));
  } else if (args[0] === '--situations') {
    const byId = new Map(loadEntries().map((e) => [e.id, e]));
    console.log(JSON.stringify(situationReport(loadCorpus(corpusFiles(args.slice(1))), idx, byId), null, 1));
  } else if (args[0] === '--dreams') {
    for (const d of loadCorpus(corpusFiles(args.slice(1)))) {
      const { images } = findImages(d.text, idx);
      console.log(`${d.id}: ${images.map((g) => `${g.id} ("${g.said}")`).join(', ') || '(none)'}`);
    }
  } else {
    console.log(JSON.stringify(summary(loadCorpus(corpusFiles(args)), idx), null, 1));
  }
}

// For the factory analysis (tools/kb-factory.mjs and scratch scripts): the same word handling the phone uses.
export { norm, stemsOf, sitStem, fit, SIT_STOP, ABSTRACT };
