// Whole-knowledge-base cleanup, run after a writing wave (never while writers are still working).
//   node tools/kb-cleanup.mjs            dry run: show what would change
//   node tools/kb-cleanup.mjs --apply    write the changes
// 1. Shared words: when an alias/signal is shared by two entries and it IS the name (or id slug) of one of them,
//    the more general entry drops it ("eagle" stays with Eagle, leaves Bird).
// 2. Freud views that only say Freud did not write about the subject are removed (the Freud tab should only
//    appear where he actually said something about it); "Freud 1913/1920" is dropped from sources if unused.
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadKb } from './kb.mjs';

const KB = join(dirname(fileURLToPath(import.meta.url)), '..', 'Interpretation', 'kb');
const apply = process.argv.includes('--apply');
const norm = (s) => String(s).toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/[^a-z0-9']+/g, ' ').trim();
const { entries } = loadKb();
const changed = new Set();
const log = [];

// 1. Shared words
const owners = new Map();
for (const e of entries) {
  for (const field of ['aliases', 'signals']) {
    for (const t of e[field] || []) {
      const k = norm(t);
      if (!owners.has(k)) owners.set(k, []);
      owners.get(k).push({ e, field, raw: t });
    }
  }
}
for (const [word, list] of owners) {
  if (list.length < 2) continue;
  const specific = list.filter(({ e }) => norm(e.name) === word || e.id.split('.').slice(1).join(' ').replace(/-/g, ' ') === word);
  if (specific.length !== 1) continue; // ambiguous: leave for a person to decide
  for (const { e, field, raw } of list) {
    if (e === specific[0].e) continue;
    if (e.kind !== specific[0].e.kind) continue; // a symbol and a theme are meant to match together (pregnant + giving birth)
    e[field] = e[field].filter((t) => t !== raw);
    changed.add(e);
    log.push(`word  "${word}": removed from ${e.id} (kept by ${specific[0].e.id})`);
  }
}

// 1b. A general entry still holding the exact name of a newer specific entry of the same kind
//     ("taxi" in Car while a Taxi entry exists, "nurse" in Doctor, "desk" in Office): the word goes to the specific one.
// Full name or id slug only: a name's first word is NOT enough ("Hand fan" must not take "hand" from Hands).
const slugOf = (e) => e.id.split('.').slice(1).join(' ').replace(/-/g, ' ');
for (const b of entries) {
  const keys = new Set([norm(b.name), slugOf(b)].filter(Boolean));
  for (const a of entries) {
    if (a === b || a.kind !== b.kind) continue;
    if (keys.has(norm(a.name)) || keys.has(slugOf(a))) continue; // the two are near-duplicates: leave for the merge review
    for (const field of ['aliases', 'signals']) {
      const drop = (a[field] || []).filter((t) => keys.has(norm(t)) && !keys.has(norm(a.name)));
      if (!drop.length) continue;
      a[field] = a[field].filter((t) => !drop.includes(t));
      changed.add(a);
      for (const t of drop) log.push(`word  "${norm(t)}": removed from ${a.id} (it is the name of ${b.id})`);
    }
  }
}

// 2. Freud views that only state an absence (opt-in with --drop-absent-freud: many carry a useful related idea,
//    e.g. ocean → "water stands for birth", so by default the interpreter decides whether to show them).
const ABSENCE = /\b(did not|didn't|does not|never) (write|discuss|mention|address|treat)/i;
for (const e of process.argv.includes('--drop-absent-freud') ? entries : []) {
  const f = e.perspectives?.freud;
  if (!f?.text || !ABSENCE.test(f.text)) continue;
  e.perspectives.freud = null;
  e.sources = (e.sources || []).filter((s) => !/^Freud/i.test(s));
  changed.add(e);
  log.push(`freud ${e.id}: absence-only view removed`);
}

for (const line of log) console.log(line);
const words = log.filter((l) => l.startsWith('word')).length;
const freud = log.filter((l) => l.startsWith('freud')).length;
console.log(`\n${words} shared words resolved · ${freud} absence-only Freud views removed · ${changed.size} entries touched${apply ? '' : ' (dry run: add --apply to write)'}`);
if (apply) {
  for (const e of changed) {
    const { _file, ...data } = e;
    writeFileSync(join(KB, _file), JSON.stringify(data, null, 2) + '\n');
  }
}
