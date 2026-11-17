// Adds editorial "it depends on…" situations to library entries (answer.more), kept apart from the researched ones
// (answer.depends, every line backed by evidence). Editorial lines are labelled "Dreaming editorial" wherever the app
// shows them, and the app tries researched lines first.
//   node tools/kb-situations.mjs brief <ids…|--batch N size>   write kb/plan/situation-batches/<name>.json for helpers
//   node tools/kb-situations.mjs apply [--dry]                 merge kb/plan/situation-proposals/*.json → answer.more
//   node tools/kb-situations.mjs undo <log.json>               restore answer.more as it was before a round
// A proposal file: [{ "id": "<entry id>", "more": [{ "when": "you hide under the bed", "meaning": "1–2 sentences" }] }].
// Checks: "when" 2–9 words with 1–5 words left after the image's own words (otherwise the phone can never match it);
// not a repeat of a researched or earlier editorial line; "meaning" 40–320 characters, no predictions, studies,
// statistics or source names.
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const KB = join(import.meta.dirname, '..', 'Interpretation', 'kb');
const PLAN = join(KB, 'plan');
const BATCHES = join(PLAN, 'situation-batches');
const PROPOSALS = join(PLAN, 'situation-proposals');

const norm = (s) => String(s || '').toLowerCase().replace(/[’']/g, "'").replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim();
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
const toks = (s) => norm(s).split(' ').filter((w) => w.length > 2 && !STOP.has(w)).map(stem);
// Wording the library never uses in situations (rules in SYNTHESIS.md §3).
const BANNED = [/\bstud(y|ies)\b/i, /\bresearch(ers)? (shows?|found|says)\b/i, /\d+\s?%|\bpercent\b/i, /\bwill (happen|come true|die|get)\b/i,
  /\bpredicts?\b/i, /\bomen\b/i, /\bfreud\b|\bjung\b|\bmiller\b|\bartemidorus\b|\bibn sirin\b/i, /\bdiagnos/i, /\bdisorder\b/i,
  /\bmeans you (are|will)\b/i, /\bdefinitely\b|\bcertainly\b|\balways means\b/i];

function loadEntries() {
  const out = new Map();
  for (const dir of ['themes', 'symbols']) {
    for (const f of readdirSync(join(KB, dir)).filter((n) => n.endsWith('.json'))) {
      const e = JSON.parse(readFileSync(join(KB, dir, f), 'utf8'));
      out.set(e.id, { file: join(KB, dir, f), e });
    }
  }
  return out;
}

function brief(args) {
  mkdirSync(BATCHES, { recursive: true });
  const all = loadEntries();
  let groups;
  if (args[0] === '--batch') {
    const size = Number(args[2]) || 26;
    // --skip <batch name>: leave out entries already given to helpers in that batch file
    const skipName = args.includes('--skip') ? args[args.indexOf('--skip') + 1] : '';
    const skip = new Set(skipName ? JSON.parse(readFileSync(join(BATCHES, `${skipName}.json`), 'utf8')).map((x) => x.id) : []);
    const ids = [...all.keys()].filter((id) => !skip.has(id)).sort();
    groups = [];
    for (let i = 0; i < ids.length; i += size) groups.push([`s${String(groups.length + 1).padStart(2, '0')}`, ids.slice(i, i + size)]);
  } else {
    groups = [[args[0], args.slice(1)]];
  }
  for (const [name, ids] of groups) {
    const items = ids.map((id) => all.get(id)?.e).filter(Boolean).map((e) => ({
      id: e.id,
      name: e.name,
      kind: e.kind,
      words: [e.name, ...(e.aliases || []), ...(e.signals || [])].slice(0, 30),
      meaning: e.answer?.meaning || e.summary || '',
      researched: (e.answer?.depends || []).map((d) => d.when),
      editorialSoFar: (e.answer?.more || []).map((d) => d.when),
      care: e.care || '',
    }));
    writeFileSync(join(BATCHES, `${name}.json`), JSON.stringify(items, null, 1));
    console.log(`${name}: ${items.length} entries`);
  }
}

// The 400 most frequent words of ordinary prose (the local book texts): a line whose only matchable word is one of
// these ("small", "dark", "found") would fit unrelated dreams, so it is dropped.
function commonWords() {
  const dir = join(KB, '..', 'sources');
  const counts = new Map();
  for (const f of ['freud-interpretation-1913.txt', 'densmore-1918-teton-sioux-music.txt', 'nielsen-2003-typical-dreams.txt']) {
    if (!existsSync(join(dir, f))) continue;
    for (const w of norm(readFileSync(join(dir, f), 'utf8')).split(' ')) {
      if (w.length < 3 || STOP.has(w)) continue;
      const t = stem(w);
      counts.set(t, (counts.get(t) || 0) + 1);
    }
  }
  return new Set([...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 400).map(([t]) => t));
}

function apply(dry) {
  const all = loadEntries();
  const COMMON = commonWords();
  const files = existsSync(PROPOSALS) ? readdirSync(PROPOSALS).filter((n) => n.endsWith('.json')) : [];
  const before = {};
  const drops = { unknownId: 0, whenLength: 0, unmatchable: 0, commonWord: 0, repeat: 0, meaningLength: 0, banned: 0 };
  let added = 0;
  const touched = new Set();
  for (const f of files) {
    let data;
    try { data = JSON.parse(readFileSync(join(PROPOSALS, f), 'utf8')); } catch (err) { console.error(`skip ${f}: ${err.message}`); continue; }
    for (const p of Array.isArray(data) ? data : []) {
      const x = all.get(p?.id);
      if (!x) { drops.unknownId += 1; continue; }
      const e = x.e;
      if (!e.answer) continue;
      if (!(e.id in before)) before[e.id] = e.answer.more ? [...e.answer.more] : null;
      const own = new Set(toks([e.name, ...(e.aliases || []), ...(e.signals || [])].join(' ')));
      const seen = new Set([...(e.answer.depends || []), ...(e.answer.more || [])].map((d) => norm(d.when)));
      const keep = [];
      for (const s of Array.isArray(p.more) ? p.more : []) {
        const when = String(s?.when || '').trim().replace(/[.]+$/, '');
        const meaning = String(s?.meaning || '').trim();
        const words = norm(when).split(' ').filter(Boolean);
        const left = toks(when).filter((t) => !own.has(t));
        if (words.length < 2 || words.length > 9) { drops.whenLength += 1; continue; }
        if (!left.length || left.length > 5) { drops.unmatchable += 1; continue; }
        if (left.length === 1 && COMMON.has(left[0])) { drops.commonWord += 1; continue; }
        if (seen.has(norm(when))) { drops.repeat += 1; continue; }
        if (meaning.length < 40 || meaning.length > 320) { drops.meaningLength += 1; continue; }
        if (BANNED.some((re) => re.test(meaning) || re.test(when))) { drops.banned += 1; continue; }
        seen.add(norm(when));
        keep.push({ when, meaning });
      }
      if (keep.length) {
        e.answer.more = [...(e.answer.more || []), ...keep];
        e.answer.moreSource = 'Dreaming editorial';
        e.answer.moreUpdated = new Date().toISOString().slice(0, 10);
        added += keep.length;
        touched.add(e.id);
      }
    }
  }
  console.log(JSON.stringify({ proposalFiles: files.length, entries: touched.size, situationsAdded: added, dropped: drops }, null, 1));
  if (dry) return;
  for (const id of touched) { const x = all.get(id); writeFileSync(x.file, `${JSON.stringify(x.e, null, 2)}\n`); }
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  const log = join(PLAN, `situations-added-${stamp}.json`);
  writeFileSync(log, JSON.stringify({ at: new Date().toISOString(), before }, null, 1));
  console.log(`written; log ${log}`);
}

function undo(logFile) {
  const { before } = JSON.parse(readFileSync(logFile, 'utf8'));
  const all = loadEntries();
  for (const [id, prev] of Object.entries(before || {})) {
    const x = all.get(id);
    if (!x?.e.answer) continue;
    if (prev) x.e.answer.more = prev;
    else { delete x.e.answer.more; delete x.e.answer.moreSource; delete x.e.answer.moreUpdated; }
    writeFileSync(x.file, `${JSON.stringify(x.e, null, 2)}\n`);
  }
  console.log(`restored ${Object.keys(before || {}).length} entries`);
}

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === 'brief') brief(rest);
else if (cmd === 'apply') apply(process.argv.includes('--dry'));
else if (cmd === 'undo' && rest[0]) undo(rest[0]);
else console.log('usage: brief <name> <ids…> | brief --batch _ <size> | apply [--dry] | undo <log.json>');
