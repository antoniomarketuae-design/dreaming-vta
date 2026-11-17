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
const KB = join(ROOT, 'kb');

// ---- The word list, as server/library.js builds it ----

const serverNorm = (s) => String(s || '')
  .toLowerCase()
  .replace(/[’']/g, "'")
  .replace(/[^a-z0-9' ]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .replace(/^(the|a|an|my|your) /, '');

function loadEntries() {
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

const AMBIGUOUS = new Set(['back', 'face', 'play', 'present', 'mine', 'note', 'flat', 'rose', 'store', 'cross', 'racket', 'watch', 'kid', 'like', 'well', 'left', 'right']);
const VERBISH = new Set(['theme', 'action', 'nature', 'event']);
const ABSTRACT = new Set(['emotion', 'color', 'number', 'shape', 'sound']);

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
  const kept = hits.filter((h) => !hits.some((o) => o !== h && o.len > h.len && o.start <= h.start && o.start + o.len >= h.start + h.len));
  const covered = new Set();
  for (const h of kept) for (let k = h.start; k < h.start + h.len; k += 1) covered.add(k);
  const by = new Map();
  for (const h of kept) {
    const g = by.get(h.item.id) || { ...h.item, count: 0, first: h.start, said: words.slice(h.start, h.start + h.len).join(' ') };
    g.count += 1;
    by.set(h.item.id, g);
  }
  const rank = (g) => (g.kind === 't' ? 0 : ABSTRACT.has(g.category) ? 2 : 1);
  return { images: [...by.values()].sort((a, b) => (rank(a) - rank(b)) || (a.first - b.first)), words, covered };
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

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/').replace(/^([A-Za-z]):/, '/$1:')}` || process.argv[1]?.endsWith('kb-reach.mjs')) {
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
  } else if (args[0] === '--dreams') {
    for (const d of loadCorpus(corpusFiles(args.slice(1)))) {
      const { images } = findImages(d.text, idx);
      console.log(`${d.id}: ${images.map((g) => `${g.id} ("${g.said}")`).join(', ') || '(none)'}`);
    }
  } else {
    console.log(JSON.stringify(summary(loadCorpus(corpusFiles(args)), idx), null, 1));
  }
}
