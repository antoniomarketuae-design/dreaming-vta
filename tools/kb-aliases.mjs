// Grows the words the dream reader recognises (aliases for symbols, signals for themes) from helper proposals,
// safely: proposals never touch the library directly; this tool filters them and keeps a log so a round can be undone.
//   node tools/kb-aliases.mjs batches [size]       write kb/plan/alias-batches/aNN.json (entries to cover)
//   node tools/kb-aliases.mjs apply [--dry]        merge kb/plan/alias-proposals/*.json into the entries
//                                                  (move a round's files into alias-proposals/applied/ afterwards)
//   node tools/kb-aliases.mjs undo <log.json>      remove the words a round added
// A proposal file is a JSON array of { "id": "<entry id>", "add": ["word or phrase", …] }.
// Filters: normalised like the server; 2+ letters; at most 5 words; no everyday words that would fire in any dream;
// no word another entry already owns; a new word proposed for two different entries goes to neither (logged).
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const KB = join(import.meta.dirname, '..', 'Interpretation', 'kb');
const PLAN = join(KB, 'plan');
const BATCHES = join(PLAN, 'alias-batches');
const PROPOSALS = join(PLAN, 'alias-proposals');

const serverNorm = (s) => String(s || '')
  .toLowerCase()
  .replace(/[’']/g, "'")
  .replace(/[^a-z0-9' ]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .replace(/^(the|a|an|my|your) /, '');

// Single words that would fire in almost any dream, or mean many different things.
const GENERIC = new Set(('a an the i me my you your he she it we they him her us them his its our their this that these those '
  + 'is are was were be been being am do did done does have has had get got gets getting go goes went gone going come came '
  + 'coming make made making take took taken taking put give gave given find found keep kept let seem seemed turn turned '
  + 'show showed try tried call called ask asked need needed want wanted feel felt become became leave left mean meant bring '
  + 'brought begin began hold held stand stood hear heard play played move moved live lived happen happened sit sat set say '
  + 'said tell told think thought know knew see saw seen look looked looking watch watched start started stop stopped use '
  + 'used work worked way thing things stuff time times day days night nights year years place places part people person '
  + 'someone something somebody anything everything nothing everyone anyone nobody man woman guy girl boy lady thing kind '
  + 'sort lot lots bit side end top front back middle inside outside around away over under up down out off in on at to '
  + 'from with by for of about into onto through again still even also only just really very so but and or if then than '
  + 'when while where what who which how why because after before suddenly maybe like well good bad big small little old '
  + 'new long short high low first last next other another same different whole real right left wrong sure okay ok yes no '
  + 'not all some any each every both much many more most few less least own here there now today tonight later soon once '
  + 'always never sometimes often ever dream dreams dreamed dreamt dreaming woke wake waking asleep awake sleep slept '
  + 'there room home house hand hands head eyes face voice body'
).split(' ').filter(Boolean));
// Words the phone ignores and phrases it blocks (app/js/reader.js AMBIGUOUS and BLOCK), read from the app itself.
const READER = readFileSync(join(import.meta.dirname, '..', 'app', 'js', 'reader.js'), 'utf8');
const setFrom = (name) => {
  const a = READER.indexOf(`const ${name} = new Set(`);
  const b = READER.indexOf(']', a);
  if (a < 0 || b < 0) throw new Error(`app/js/reader.js: ${name} not found`);
  return new Set([...READER.slice(a, b).matchAll(/'([^']*)'/g)].map((m) => m[1]));
};
const AMBIGUOUS = setFrom('AMBIGUOUS');
const BLOCKED = setFrom('BLOCK');
// Words taken out on purpose after judges found them misleading (kb/plan/term-fixes-*.json): never added back.
const DENIED = new Set();
for (const f of (existsSync(PLAN) ? readdirSync(PLAN) : []).filter((n) => /^term-fixes-.*\.json$/.test(n))) {
  for (const r of JSON.parse(readFileSync(join(PLAN, f), 'utf8')).removed || []) DENIED.add(serverNorm(r.term));
}
// … and the words moved off wrong entries in the first round (kb/plan/alias-conflict-fixes-*.json: { removed: { id: [words] } }).
for (const f of (existsSync(PLAN) ? readdirSync(PLAN) : []).filter((n) => /^alias-conflict-fixes-.*.json$/.test(n))) {
  for (const words of Object.values(JSON.parse(readFileSync(join(PLAN, f), 'utf8')).removed || {})) for (const w of words) DENIED.add(serverNorm(w));
}

function loadEntries() {
  const out = [];
  for (const dir of ['themes', 'symbols']) {
    for (const f of readdirSync(join(KB, dir)).filter((n) => n.endsWith('.json'))) {
      out.push({ dir, file: join(KB, dir, f), e: JSON.parse(readFileSync(join(KB, dir, f), 'utf8')) });
    }
  }
  return out;
}
const termField = (e) => (e.kind === 'theme' ? 'signals' : 'aliases');
const termsOf = (e) => [e.name, ...(e.aliases || []), ...(e.signals || [])];

function batches(size = 52) {
  mkdirSync(BATCHES, { recursive: true });
  const list = loadEntries().map(({ e }) => ({
    id: e.id,
    name: e.name,
    kind: e.kind,
    category: e.category || (e.kind === 'theme' ? 'theme' : e.id.split('.')[0]),
    has: termsOf(e).map(serverNorm).filter(Boolean),
    about: String(e.answer?.meaning || e.summary || '').slice(0, 160),
  })).sort((a, b) => a.id.localeCompare(b.id));
  let n = 0;
  for (let i = 0; i < list.length; i += size) {
    n += 1;
    writeFileSync(join(BATCHES, `a${String(n).padStart(2, '0')}.json`), JSON.stringify(list.slice(i, i + size), null, 1));
  }
  console.log(`${list.length} entries in ${n} batches of up to ${size} → ${BATCHES}`);
}

function apply(dry) {
  const all = loadEntries();
  const byId = new Map(all.map((x) => [x.e.id, x]));
  const owner = new Map(); // existing normalised term → entry id
  for (const { e } of all) for (const t of termsOf(e)) { const k = serverNorm(t); if (k && !owner.has(k)) owner.set(k, e.id); }

  const wanted = new Map(); // new term → Set(entry ids)
  const drops = { unknownId: 0, tooShort: 0, tooLong: 0, generic: 0, ambiguous: 0, denied: 0, ownedByOther: 0, already: 0 };
  const files = existsSync(PROPOSALS) ? readdirSync(PROPOSALS).filter((n) => n.endsWith('.json')) : [];
  for (const f of files) {
    let data;
    try { data = JSON.parse(readFileSync(join(PROPOSALS, f), 'utf8')); } catch (err) { console.error(`skip ${f}: ${err.message}`); continue; }
    for (const p of Array.isArray(data) ? data : []) {
      if (!byId.has(p?.id)) { drops.unknownId += 1; continue; }
      for (const raw of Array.isArray(p.add) ? p.add : []) {
        const t = serverNorm(raw);
        const words = t.split(' ').filter(Boolean);
        if (t.length < 2 || (words.length === 1 && t.length < 3)) { drops.tooShort += 1; continue; }
        if (words.length > 5) { drops.tooLong += 1; continue; }
        if (words.length === 1 && GENERIC.has(t)) { drops.generic += 1; continue; }
        if (words.every((w) => GENERIC.has(w))) { drops.generic += 1; continue; }
        if (AMBIGUOUS.has(t) || BLOCKED.has(t)) { drops.ambiguous += 1; continue; }
        if (DENIED.has(t)) { drops.denied += 1; continue; }
        if (owner.has(t)) { if (owner.get(t) === p.id) drops.already += 1; else drops.ownedByOther += 1; continue; }
        if (!wanted.has(t)) wanted.set(t, new Set());
        wanted.get(t).add(p.id);
      }
    }
  }
  const contested = {};
  const added = {};
  for (const [t, ids] of wanted) {
    if (ids.size > 1) { contested[t] = [...ids]; continue; }
    const id = [...ids][0];
    (added[id] ||= []).push(t);
  }
  const count = Object.values(added).reduce((s, l) => s + l.length, 0);
  const singles = Object.entries(added).flatMap(([id, l]) => l.filter((t) => !t.includes(' ')).map((t) => `${t} → ${id}`));
  console.log(JSON.stringify({ proposalFiles: files.length, entriesGrowing: Object.keys(added).length, wordsAdded: count, contested: Object.keys(contested).length, dropped: drops }, null, 1));
  if (dry) {
    console.log(`single words (review for false hits): ${singles.length}\n${singles.slice(0, 80).join('\n')}`);
    return;
  }
  for (const [id, list] of Object.entries(added)) {
    const x = byId.get(id);
    const field = termField(x.e);
    x.e[field] = [...(x.e[field] || []), ...list];
    writeFileSync(x.file, `${JSON.stringify(x.e, null, 2)}\n`);
  }
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  const log = join(PLAN, `aliases-added-${stamp}.json`);
  writeFileSync(log, JSON.stringify({ at: new Date().toISOString(), added, contested, dropped: drops }, null, 1));
  console.log(`written; log ${log}`);
}

function undo(logFile) {
  const { added } = JSON.parse(readFileSync(logFile, 'utf8'));
  const byId = new Map(loadEntries().map((x) => [x.e.id, x]));
  let removed = 0;
  for (const [id, list] of Object.entries(added || {})) {
    const x = byId.get(id);
    if (!x) continue;
    const field = termField(x.e);
    const drop = new Set(list);
    const before = (x.e[field] || []).length;
    x.e[field] = (x.e[field] || []).filter((t) => !drop.has(serverNorm(t)));
    removed += before - x.e[field].length;
    writeFileSync(x.file, `${JSON.stringify(x.e, null, 2)}\n`);
  }
  console.log(`removed ${removed} words`);
}

const [cmd, arg] = process.argv.slice(2);
if (cmd === 'batches') batches(Number(arg) || 52);
else if (cmd === 'apply') apply(process.argv.includes('--dry'));
else if (cmd === 'undo' && arg) undo(arg);
else console.log('usage: batches [size] | apply [--dry] | undo <log.json>');
