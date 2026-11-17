// Test-dream factory: runs the phone's dream reader over many test dreams (written blind to the library), splits the
// readings into batches for judges, and turns their verdicts into numbers and fix lists.
//   node tools/kb-factory.mjs read [corpus.json …]   readings → kb/plan/factory/readings.json
//                                                     (default: every Interpretation/tests/factory/*.json)
//   node tools/kb-factory.mjs batches [size]          kb/plan/factory/judge/jNN.json (default 60 dreams each)
//   node tools/kb-factory.mjs report                  merge kb/plan/factory/verdicts/*.json → numbers + fix lists
// A verdict file: [{ "id": "<dream id>",
//   "images": [{ "id": "<entry id>", "verdict": "right" | "stretch" | "wrong", "note": "" }],
//   "situations": [{ "id": "<entry id>", "when": "<line>", "verdict": "fits" | "weak" | "wrong", "note": "" }],
//   "missing": ["grandmother", "being late"],
//   "wanted": [{ "id": "<entry id>", "when": "you never see who chases you" }] }]   (situations the dream shows that no line has)
// Never put the held-out set (Interpretation/tests/holdout/) through this: judges see library lines, and the holdout
// must stay unseen.
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { buildIndex, indexItems, loadEntries, readingOf, findImages } from './kb-reach.mjs';

const ROOT = join(import.meta.dirname, '..', 'Interpretation');
const CORPUS = join(ROOT, 'tests', 'factory');
const PLAN = join(ROOT, 'kb', 'plan', 'factory');
const JUDGE = join(PLAN, 'judge');
const VERDICTS = join(PLAN, 'verdicts');
const READINGS = join(PLAN, 'readings.json');

const firstSentence = (s) => String(s || '').split(/(?<=[.!?])\s+/)[0];
const label = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/^(a|an|the|my) /, '');

function read(files) {
  const list = files.length ? files : readdirSync(CORPUS).filter((n) => n.endsWith('.json')).sort().map((n) => join(CORPUS, n));
  if (list.some((f) => /holdout/i.test(f))) throw new Error('the held-out set never goes through the factory');
  const entries = loadEntries();
  const byId = new Map(entries.map((e) => [e.id, e]));
  const idx = buildIndex(indexItems(entries));
  const out = [];
  for (const file of list) {
    for (const d of JSON.parse(readFileSync(file, 'utf8'))) {
      if (!d?.text?.trim()) continue;
      const r = readingOf(d.text, idx, byId);
      out.push({
        id: d.id,
        persona: d.persona || '',
        text: d.text,
        images: r.images.map(({ f, e, situations }) => ({
          id: e.id,
          name: e.name,
          kind: f.kind === 't' ? 'theme' : 'symbol',
          said: f.said,
          meaning: firstSentence(e.answer.meaning),
          situations: situations.map((s) => ({ when: s.when, meaning: s.meaning, editorial: Boolean(s.editorial) })),
        })),
        notShown: r.notShown.map((f) => ({ id: f.id, said: f.said })),
      });
    }
  }
  mkdirSync(PLAN, { recursive: true });
  writeFileSync(READINGS, JSON.stringify(out, null, 1));
  const shown = out.reduce((n, d) => n + d.images.length, 0);
  const sit = out.reduce((n, d) => n + d.images.filter((im) => im.situations.length).length, 0);
  console.log(JSON.stringify({
    dreams: out.length,
    imagesPerDream: +(shown / (out.length || 1)).toFixed(2),
    dreamsWithNoImage: out.filter((d) => !d.images.length).length,
    imagesWithASituation: `${((sit / (shown || 1)) * 100).toFixed(1)}%`,
  }, null, 1));
}

function batches(size) {
  const all = JSON.parse(readFileSync(READINGS, 'utf8'));
  mkdirSync(JUDGE, { recursive: true });
  let n = 0;
  for (let i = 0; i < all.length; i += size) {
    n += 1;
    const items = all.slice(i, i + size).map(({ id, text, images }) => ({ id, text, reading: images.map(({ id: eid, name, said, meaning, situations }) => ({ id: eid, name, said, meaning, situations: situations.map(({ when, meaning: m, editorial }) => ({ when, meaning: m, editorial })) })) }));
    writeFileSync(join(JUDGE, `j${String(n).padStart(2, '0')}.json`), JSON.stringify(items, null, 1));
  }
  console.log(`${n} judge batches of up to ${size} dreams in ${JUDGE}`);
}

function report() {
  const readings = new Map(JSON.parse(readFileSync(READINGS, 'utf8')).map((d) => [d.id, d]));
  const entries = loadEntries();
  const idx = buildIndex(indexItems(entries));
  const files = existsSync(VERDICTS) ? readdirSync(VERDICTS).filter((n) => n.endsWith('.json')).sort() : [];
  const img = { right: 0, stretch: 0, wrong: 0 };
  const sit = { researched: { fits: 0, weak: 0, wrong: 0 }, editorial: { fits: 0, weak: 0, wrong: 0 } };
  const pair = new Map(); // "said → id" → { shown, wrong, stretch, notes }
  const lines = new Map(); // "id | when" → { id, when, editorial, fits, weak, wrong, notes }
  const miss = { total: 0, cutByLimit: 0, wordsNeeded: 0, gap: 0 };
  const gaps = new Map();
  const needed = new Map();
  const wanted = new Map(); // entry id → [when, …] situations real dreams show that no line covers
  let dreams = 0;
  // How often each "said → id" pair is shown across all readings, judged or not (for precision per word).
  const shownCount = new Map();
  for (const d of readings.values()) for (const im of d.images) { const k = `${im.said} → ${im.id}`; shownCount.set(k, (shownCount.get(k) || 0) + 1); }
  for (const f of files) {
    let data;
    try { data = JSON.parse(readFileSync(join(VERDICTS, f), 'utf8')); } catch (err) { console.error(`skip ${f}: ${err.message}`); continue; }
    for (const v of Array.isArray(data) ? data : []) {
      const d = readings.get(v?.id);
      if (!d) continue;
      dreams += 1;
      for (const iv of v.images || []) {
        const im = d.images.find((x) => x.id === iv.id);
        if (!im || !(iv.verdict in img)) continue;
        img[iv.verdict] += 1;
        const k = `${im.said} → ${im.id}`;
        const p = pair.get(k) || { pair: k, shown: shownCount.get(k) || 0, judged: 0, wrong: 0, stretch: 0, notes: [] };
        p.judged += 1;
        if (iv.verdict !== 'right') { p[iv.verdict] += 1; if (iv.note && p.notes.length < 3) p.notes.push(`${d.id}: ${iv.note}`); }
        pair.set(k, p);
      }
      for (const sv of v.situations || []) {
        const im = d.images.find((x) => x.id === sv.id);
        const s = im?.situations.find((x) => x.when === sv.when) || im?.situations[0];
        if (!s || !['fits', 'weak', 'wrong'].includes(sv.verdict)) continue;
        sit[s.editorial ? 'editorial' : 'researched'][sv.verdict] += 1;
        const k = `${im.id} | ${s.when}`;
        const l = lines.get(k) || { id: im.id, when: s.when, editorial: s.editorial, fits: 0, weak: 0, wrong: 0, notes: [] };
        l[sv.verdict] += 1;
        if (sv.verdict !== 'fits' && sv.note && l.notes.length < 3) l.notes.push(`${d.id}: ${sv.note}`);
        lines.set(k, l);
      }
      for (const w of v.wanted || []) {
        if (!d.images.some((x) => x.id === w?.id) || !String(w.when || '').trim()) continue;
        wanted.set(w.id, [...(wanted.get(w.id) || []), String(w.when).trim()]);
      }
      const found = new Set([...d.images.map((x) => x.id)]);
      const cut = new Set(d.notShown.map((x) => x.id));
      for (const m of v.missing || []) {
        const w = label(m);
        if (!w) continue;
        miss.total += 1;
        const targets = findImages(w, idx).images.map((g) => g.id);
        if (targets.some((t) => found.has(t))) { miss.total -= 1; continue; } // judge listed something already shown
        if (targets.some((t) => cut.has(t))) { miss.cutByLimit += 1; continue; }
        if (targets.length) { miss.wordsNeeded += 1; const k = `${w} [${targets[0]}]`; needed.set(k, (needed.get(k) || 0) + 1); continue; }
        miss.gap += 1;
        gaps.set(w, (gaps.get(w) || 0) + 1);
      }
    }
  }
  const pct = (n, t) => +((n / (t || 1)) * 100).toFixed(1);
  const imgN = img.right + img.stretch + img.wrong;
  const sum = (o) => o.fits + o.weak + o.wrong;
  const out = {
    verdictFiles: files.length,
    dreamsJudged: dreams,
    images: { judged: imgN, rightPct: pct(img.right, imgN), stretchPct: pct(img.stretch, imgN), wrongPct: pct(img.wrong, imgN) },
    situations: {
      researched: { judged: sum(sit.researched), fitsPct: pct(sit.researched.fits, sum(sit.researched)), weakPct: pct(sit.researched.weak, sum(sit.researched)), wrongPct: pct(sit.researched.wrong, sum(sit.researched)) },
      editorial: { judged: sum(sit.editorial), fitsPct: pct(sit.editorial.fits, sum(sit.editorial)), weakPct: pct(sit.editorial.weak, sum(sit.editorial)), wrongPct: pct(sit.editorial.wrong, sum(sit.editorial)) },
    },
    missing: { ...miss, perDream: +(miss.total / (dreams || 1)).toFixed(2) },
    wrongWords: [...pair.values()].filter((p) => p.wrong).sort((a, b) => b.wrong - a.wrong || b.shown - a.shown),
    stretchWords: [...pair.values()].filter((p) => p.stretch >= 2).sort((a, b) => b.stretch - a.stretch),
    badLines: [...lines.values()].filter((l) => l.wrong || l.weak).sort((a, b) => (b.wrong * 2 + b.weak) - (a.wrong * 2 + a.weak)),
    topGaps: [...gaps.entries()].sort((a, b) => b[1] - a[1]).map(([w, c]) => `${w} ${c}`),
    wordsNeeded: [...needed.entries()].sort((a, b) => b[1] - a[1]).map(([w, c]) => `${w} ${c}`),
    wanted: Object.fromEntries([...wanted.entries()].sort((a, b) => b[1].length - a[1].length)),
  };
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  const file = join(PLAN, `report-${stamp}.json`);
  writeFileSync(file, JSON.stringify(out, null, 1));
  console.log(JSON.stringify({ ...out, wrongWords: out.wrongWords.slice(0, 25).map((p) => `${p.pair}: wrong ${p.wrong}/${p.judged} (shown ${p.shown})`), stretchWords: out.stretchWords.slice(0, 15).map((p) => `${p.pair}: stretch ${p.stretch}/${p.judged}`), badLines: out.badLines.slice(0, 20).map((l) => `${l.editorial ? 'ed' : 'res'} ${l.id}: "${l.when}" wrong ${l.wrong} weak ${l.weak} fits ${l.fits}`), topGaps: out.topGaps.slice(0, 60), wordsNeeded: out.wordsNeeded.slice(0, 40), wanted: `${[...wanted.values()].flat().length} lines for ${wanted.size} entries` }, null, 1));
  console.log(`full report: ${file}`);
}

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === 'read') read(rest);
else if (cmd === 'batches') batches(Number(rest[0]) || 60);
else if (cmd === 'report') report();
else console.log('usage: read [corpus.json …] | batches [size] | report');
