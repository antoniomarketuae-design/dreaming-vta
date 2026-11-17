// Combinations: two library images that mean something together ("a snake in your house", "a baby in water").
// Each lives in Interpretation/kb/combos/<idA>+<idB>.json (ids sorted), labelled Dreaming editorial:
//   { key, pair: [idA, idB], title, meaning, ask: [...], basedOn: ["dreaming-editorial"], confidence: "low",
//     editorial: true, updated }
// The phone shows one when both images are in the same or the next sentence of a dream (app/js/reader.js).
//   node tools/kb-combos.mjs mine [size]      image pairs found together in the test dreams (never the held-out set)
//                                             → kb/plan/combos/candidates.json + batches/cNN.json for writers
//   node tools/kb-combos.mjs apply [--dry]    kb/plan/combos/proposals/*.json → kb/combos/ (checked, logged)
//   node tools/kb-combos.mjs reach <corpus…>  how many dreams of a corpus get a combination, as the phone finds them
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { buildIndex, indexItems, loadEntries, findImages, combosIn } from './kb-reach.mjs';

const ROOT = join(import.meta.dirname, '..', 'Interpretation');
const KB = join(ROOT, 'kb');
const COMBOS = join(KB, 'combos');
const PLAN = join(KB, 'plan', 'combos');
const SKIP = new Set(['color', 'number', 'shape', 'sound']); // too thin to pair
const BANNED = [/\bstud(y|ies)\b/i, /\bresearch(ers)? (shows?|found|says)\b/i, /\d+\s?%|\bpercent\b/i, /\bwill (happen|come true|die|get)\b/i,
  /\bpredicts?\b/i, /\bomen\b/i, /\bdiagnos/i, /\bdisorder\b/i, /\bmeans you (are|will)\b/i, /\bdefinitely\b|\bcertainly\b|\balways means\b/i];

export const comboKey = (a, b) => [a, b].sort().join('+');

/** Test dreams the writers may see: the factory, validation and first realistic sets (never tests/holdout). */
function corpus() {
  const out = [];
  const tests = join(ROOT, 'tests');
  for (const dir of ['factory', 'validation', '.']) {
    const folder = join(tests, dir);
    if (!existsSync(folder)) continue;
    for (const f of readdirSync(folder).filter((n) => n.endsWith('.json') && !/expected/.test(n))) {
      for (const d of JSON.parse(readFileSync(join(folder, f), 'utf8'))) {
        const text = d?.text || d?.dream?.text || '';
        if (text.trim()) out.push({ id: d.id || f, text });
      }
    }
  }
  return out;
}

const LIMIT = 840; // pairs handed to writers, best first
function mine(size) {
  const entries = loadEntries();
  const byId = new Map(entries.map((e) => [e.id, e]));
  const idx = buildIndex(indexItems(entries));
  const pairs = new Map();
  const seenIn = new Map(); // image → dreams it appears in
  const all = corpus();
  for (const d of all) {
    for (const g of findImages(d.text, idx).images) seenIn.set(g.id, (seenIn.get(g.id) || 0) + 1);
    // every pair of images within the same or the next sentence (no combos yet: pass an empty list)
    for (const p of combosIn(d.text, idx, new Map(), { all: true })) {
      const [a, b] = p.ids;
      if (SKIP.has(byId.get(a)?.category) || SKIP.has(byId.get(b)?.category)) continue;
      const k = comboKey(a, b);
      const o = pairs.get(k) || { pair: k.split('+'), names: k.split('+').map((id) => byId.get(id)?.name), count: 0, examples: [] };
      o.count += 1;
      if (o.examples.length < 2) o.examples.push(p.excerpt);
      pairs.set(k, o);
    }
  }
  // How much more often the two appear together than by chance (lift); everyday scenery (road + car) scores low.
  for (const o of pairs.values()) {
    o.lift = +((o.count * all.length) / ((seenIn.get(o.pair[0]) || 1) * (seenIn.get(o.pair[1]) || 1))).toFixed(2);
    o.score = +(o.count * Math.log2(1 + o.lift)).toFixed(2);
  }
  const list = [...pairs.values()].filter((o) => o.count >= 3 && o.lift >= 1.3).sort((a, b) => b.score - a.score).slice(0, LIMIT);
  mkdirSync(join(PLAN, 'batches'), { recursive: true });
  writeFileSync(join(PLAN, 'candidates.json'), JSON.stringify(list, null, 1));
  let n = 0;
  for (let i = 0; i < list.length; i += size) {
    n += 1;
    writeFileSync(join(PLAN, 'batches', `c${String(n).padStart(2, '0')}.json`), JSON.stringify(list.slice(i, i + size), null, 1));
  }
  console.log(`${pairs.size} pairs seen together; best ${list.length} (3+ times, together more than by chance) → ${n} batches of ${size}`);
}

function apply(dry) {
  const ids = new Set(loadEntries().map((e) => e.id));
  const dir = join(PLAN, 'proposals');
  const files = existsSync(dir) ? readdirSync(dir).filter((n) => n.endsWith('.json')) : [];
  const drops = { unknownId: 0, samePair: 0, exists: 0, title: 0, meaning: 0, banned: 0, ask: 0 };
  const written = [];
  const seen = new Set(existsSync(COMBOS) ? readdirSync(COMBOS).map((n) => n.replace(/\.json$/, '')) : []);
  for (const f of files) {
    let data;
    try { data = JSON.parse(readFileSync(join(dir, f), 'utf8')); } catch (err) { console.error(`skip ${f}: ${err.message}`); continue; }
    for (const p of Array.isArray(data) ? data : []) {
      const [a, b] = Array.isArray(p?.pair) ? p.pair : [];
      if (!ids.has(a) || !ids.has(b)) { drops.unknownId += 1; continue; }
      if (a === b) { drops.samePair += 1; continue; }
      const key = comboKey(a, b);
      if (seen.has(key)) { drops.exists += 1; continue; }
      const title = String(p.title || '').trim();
      const meaning = String(p.meaning || '').trim();
      const ask = (Array.isArray(p.ask) ? p.ask : []).map((q) => String(q).trim()).filter(Boolean).slice(0, 2);
      if (title.length < 3 || title.length > 70) { drops.title += 1; continue; }
      if (meaning.length < 80 || meaning.length > 520) { drops.meaning += 1; continue; }
      if (!ask.length) { drops.ask += 1; continue; }
      if (BANNED.some((re) => re.test(meaning) || re.test(title) || ask.some((q) => re.test(q)))) { drops.banned += 1; continue; }
      seen.add(key);
      written.push({ key, pair: key.split('+'), title, meaning, ask, basedOn: ['dreaming-editorial'], confidence: 'low', editorial: true, updated: new Date().toISOString().slice(0, 10) });
    }
  }
  console.log(JSON.stringify({ proposalFiles: files.length, combosWritten: written.length, dropped: drops }, null, 1));
  if (dry) return;
  mkdirSync(COMBOS, { recursive: true });
  for (const c of written) writeFileSync(join(COMBOS, `${c.key}.json`), `${JSON.stringify(c, null, 2)}\n`);
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  writeFileSync(join(KB, 'plan', `combos-added-${stamp}.json`), JSON.stringify({ at: new Date().toISOString(), keys: written.map((c) => c.key) }, null, 1));
  console.log(`written to ${COMBOS}`);
}

function reach(files) {
  const entries = loadEntries();
  const byId = new Map(entries.map((e) => [e.id, e]));
  const idx = buildIndex(indexItems(entries));
  const combos = new Map();
  if (existsSync(COMBOS)) for (const f of readdirSync(COMBOS).filter((n) => n.endsWith('.json'))) { const c = JSON.parse(readFileSync(join(COMBOS, f), 'utf8')); combos.set(c.key, c); }
  let dreams = 0;
  let withCombo = 0;
  const used = new Map();
  for (const file of files) {
    for (const d of JSON.parse(readFileSync(file, 'utf8'))) {
      const text = d?.text || d?.dream?.text || '';
      if (!text.trim()) continue;
      dreams += 1;
      const found = combosIn(text, idx, combos);
      if (found.length) { withCombo += 1; const k = found[0].key; used.set(k, (used.get(k) || 0) + 1); }
    }
  }
  console.log(JSON.stringify({ combos: combos.size, dreams, withCombo, pct: +((withCombo / (dreams || 1)) * 100).toFixed(1),
    top: [...used.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([k, n]) => `${combos.get(k)?.title} (${k}) ${n}`) }, null, 1));
  void byId;
}

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === 'mine') mine(Number(rest[0]) || 70);
else if (cmd === 'apply') apply(process.argv.includes('--dry'));
else if (cmd === 'reach' && rest.length) reach(rest);
else console.log('usage: mine [size] | apply [--dry] | reach <corpus.json…>');
