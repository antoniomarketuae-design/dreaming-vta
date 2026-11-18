// Benchmark: an honest end-to-end score of the dream reading on a blind test set (written for the benchmark only,
// never used to grow the library — keep it that way, or the score stops meaning anything).
// It reproduces what the phone shows (app/js/reader.js + the dream page): up to 5 images, the "Was it like this in
// your dream?" questions for the first 3 images (up to 3 candidates each, asked one at a time), and the one "Together"
// question for two images in the same or next sentence.
//   node tools/kb-bench.mjs read <set>     Interpretation/tests/<set>/*.json → kb/plan/bench-<set>/readings.json + judge/jNN.json
//   node tools/kb-bench.mjs report <set>   verdicts in kb/plan/bench-<set>/verdicts/ (+ tests/<set>/expected.json) → scores
// A verdict file: [{ "id", "images": [{ "id", "verdict": "right"|"stretch"|"wrong" }],
//   "questions": [{ "id", "when", "answer": "yes"|"partly"|"no" }], "together": [{ "key", "answer": … }], "missing": [] }]
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { buildIndex, indexItems, loadEntries, readingOf, combosIn, findImages } from './kb-reach.mjs';

const ROOT = join(import.meta.dirname, '..', 'Interpretation');
const ASK_IMAGES = 3; // as app/js/screens/dream.js
const firstSentence = (s) => String(s || '').split(/(?<=[.!?])\s+/)[0];
const label = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/^(a|an|the|my) /, '');

function loadCombos() {
  const dir = join(ROOT, 'kb', 'combos');
  const out = new Map();
  if (existsSync(dir)) for (const f of readdirSync(dir).filter((n) => n.endsWith('.json'))) { const c = JSON.parse(readFileSync(join(dir, f), 'utf8')); out.set(c.key, c); }
  return out;
}

function read(set, size = 40) {
  if (/holdout|factory|validation/.test(set)) throw new Error('the benchmark reads only its own blind set');
  const dir = join(ROOT, 'tests', set);
  const entries = loadEntries();
  const byId = new Map(entries.map((e) => [e.id, e]));
  const idx = buildIndex(indexItems(entries));
  const combos = loadCombos();
  const out = [];
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.json') && !/expected/.test(n)).sort()) {
    for (const d of JSON.parse(readFileSync(join(dir, f), 'utf8'))) {
      if (!d?.text?.trim()) continue;
      const r = readingOf(d.text, idx, byId);
      const t = combosIn(d.text, idx, combos)[0];
      out.push({
        id: d.id,
        text: d.text,
        images: r.images.map(({ f: g, e, situations }, i) => ({
          id: e.id, name: e.name, said: g.said, meaning: firstSentence(e.answer.meaning),
          questions: i < ASK_IMAGES ? situations.map((s) => ({ when: s.when, editorial: Boolean(s.editorial) })) : [],
        })),
        together: t ? [{ key: t.key, title: combos.get(t.key).title, meaning: firstSentence(combos.get(t.key).meaning) }] : [],
      });
    }
  }
  const P = join(ROOT, 'kb', 'plan', `bench-${set}`);
  mkdirSync(join(P, 'judge'), { recursive: true });
  mkdirSync(join(P, 'verdicts'), { recursive: true });
  writeFileSync(join(P, 'readings.json'), JSON.stringify(out, null, 1));
  let n = 0;
  for (let i = 0; i < out.length; i += size) {
    n += 1;
    writeFileSync(join(P, 'judge', `j${String(n).padStart(2, '0')}.json`), JSON.stringify(out.slice(i, i + size), null, 1));
  }
  const q = out.reduce((s, d) => s + d.images.reduce((a, im) => a + im.questions.length, 0), 0);
  console.log(JSON.stringify({ dreams: out.length, batches: n, imagesPerDream: +(out.reduce((s, d) => s + d.images.length, 0) / out.length).toFixed(2),
    dreamsWithAQuestion: out.filter((d) => d.images.some((im) => im.questions.length)).length, questionCandidates: q,
    dreamsWithTogether: out.filter((d) => d.together.length).length }, null, 1));
}

function report(set) {
  const P = join(ROOT, 'kb', 'plan', `bench-${set}`);
  const readings = new Map(JSON.parse(readFileSync(join(P, 'readings.json'), 'utf8')).map((d) => [d.id, d]));
  const tally = () => ({ yes: 0, partly: 0, no: 0 });
  const img = { right: 0, stretch: 0, wrong: 0 };
  const firstQ = tally(); // the question the dreamer sees first for each image
  const anyQ = { images: 0, withYes: 0 }; // images asked about: does any of its candidates get a yes?
  const allQ = tally();
  const tog = tally();
  let dreams = 0; let dreamsAsked = 0; let dreamsWithYes = 0; let missing = 0;
  for (const f of readdirSync(join(P, 'verdicts')).filter((n) => n.endsWith('.json'))) {
    for (const v of JSON.parse(readFileSync(join(P, 'verdicts', f), 'utf8'))) {
      const d = readings.get(v.id);
      if (!d) continue;
      dreams += 1;
      for (const iv of v.images || []) if (iv.verdict in img) img[iv.verdict] += 1;
      const ans = new Map((v.questions || []).map((q) => [`${q.id}|${q.when}`, q.answer]));
      let asked = false; let yes = false;
      for (const im of d.images) {
        if (!im.questions.length) continue;
        asked = true;
        anyQ.images += 1;
        const a0 = ans.get(`${im.id}|${im.questions[0].when}`);
        if (a0 in firstQ) firstQ[a0] += 1;
        let imYes = false;
        for (const q of im.questions) { const a = ans.get(`${im.id}|${q.when}`); if (a in allQ) allQ[a] += 1; if (a === 'yes') imYes = true; }
        if (imYes) { anyQ.withYes += 1; yes = true; }
      }
      for (const t of v.together || []) if (t.answer in tog) tog[t.answer] += 1;
      if (asked) dreamsAsked += 1;
      if (yes) dreamsWithYes += 1;
      missing += (v.missing || []).length;
    }
  }
  const pct = (n, t) => +((n / (t || 1)) * 100).toFixed(1);
  const share = (o) => { const t = o.yes + o.partly + o.no; return { judged: t, yesPct: pct(o.yes, t), partlyPct: pct(o.partly, t), noPct: pct(o.no, t) }; };
  const imgN = img.right + img.stretch + img.wrong;
  const out = {
    dreamsJudged: dreams,
    images: { judged: imgN, rightPct: pct(img.right, imgN), stretchPct: pct(img.stretch, imgN), wrongPct: pct(img.wrong, imgN) },
    questions: { dreamsAskedPct: pct(dreamsAsked, dreams), firstQuestion: share(firstQ), everyCandidate: share(allQ),
      imagesWhereSomeCandidateIsYesPct: pct(anyQ.withYes, anyQ.images), dreamsWithAYesPct: pct(dreamsWithYes, dreams) },
    together: { shownInPct: pct([...readings.values()].filter((d) => d.together.length).length, readings.size), ...share(tog) },
    missingPerDream: +(missing / (dreams || 1)).toFixed(2),
  };
  // Recognition against the blind lists of expected images (tests/<set>/expected.json: [{ id, expect: [...] }])
  const exp = join(ROOT, 'tests', set, 'expected.json');
  if (existsSync(exp)) {
    const idx = buildIndex(indexItems(loadEntries()));
    let total = 0; let found = 0; let gaps = 0;
    for (const { id, expect } of JSON.parse(readFileSync(exp, 'utf8'))) {
      const d = readings.get(id);
      if (!d) continue;
      const have = new Set(findImages(d.text, idx).images.map((g) => g.id));
      for (const phrase of expect || []) {
        total += 1;
        const targets = findImages(label(phrase), idx).images.map((g) => g.id);
        if (!targets.length) gaps += 1;
        else if (targets.some((t) => have.has(t))) found += 1;
      }
    }
    out.recognition = { expected: total, foundPct: pct(found, total), noEntryPct: pct(gaps, total), missedPct: pct(total - found - gaps, total) };
  }
  writeFileSync(join(P, `report-${new Date().toISOString().slice(0, 10)}.json`), JSON.stringify(out, null, 1));
  console.log(JSON.stringify(out, null, 1));
}

const [cmd, set] = process.argv.slice(2);
if (cmd === 'read' && set) read(set);
else if (cmd === 'report' && set) report(set);
else console.log('usage: read <set> | report <set>');
