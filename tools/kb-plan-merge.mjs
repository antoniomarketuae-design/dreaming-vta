// Merges the planners' files in Interpretation/kb/plan/*.json into one master plan.
//   - same id from several planners → one entry (Miller headwords joined, best priority kept)
//   - ids already in the knowledge base are skipped
//   - likely duplicates (same name, or same slug in another category) are listed for review
// Usage: node tools/kb-plan-merge.mjs   → Interpretation/kb/plan/master.json
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadKb } from './kb.mjs';

const PLAN = join(dirname(fileURLToPath(import.meta.url)), '..', 'Interpretation', 'kb', 'plan');
const files = readdirSync(PLAN).filter((f) => f.endsWith('.json') && !['master.json', 'merge-map.json'].includes(f));
let resolve = { into: {}, rename: {}, moveHeadwords: [] };
try { resolve = { ...resolve, ...JSON.parse(readFileSync(join(PLAN, 'merge-map.json'), 'utf8')) }; } catch {}
const existing = new Set(loadKb().entries.map((e) => e.id));
const merged = new Map();
const attach = []; // Miller headwords for entries that already exist

for (const f of files) {
  const plan = JSON.parse(readFileSync(join(PLAN, f), 'utf8'));
  for (const x of plan.existing || []) attach.push({ ...x, from: f });
  for (const e of plan.new || []) {
    const raw = String(e.id).toLowerCase().trim();
    const id = resolve.into[raw] || raw;
    if (existing.has(id)) { for (const h of e.miller || []) attach.push({ headword: h, id, from: f }); continue; }
    const prev = merged.get(id);
    if (!prev) {
      // A merged-away entry may arrive before its target: take the target's kind/category from the target id.
      const kind = id.startsWith('theme.') ? 'theme' : e.kind;
      merged.set(id, { ...e, id, kind, category: kind === 'theme' ? 'theme' : id.split('.')[0], miller: [...(e.miller || [])], from: [f] });
      continue;
    }
    prev.miller = [...new Set([...prev.miller, ...(e.miller || [])])];
    prev.priority = Math.min(prev.priority || 3, e.priority || 3);
    prev.note = [prev.note, e.note].filter(Boolean).join(' | ') || undefined;
    prev.from.push(f);
  }
}

for (const [id, name] of Object.entries(resolve.rename)) if (merged.has(id)) merged.get(id).name = name;
for (const { headword, from, to } of resolve.moveHeadwords) {
  if (!merged.has(from) || !merged.has(to)) continue;
  merged.get(from).miller = merged.get(from).miller.filter((h) => h !== headword);
  merged.get(to).miller = [...new Set([...merged.get(to).miller, headword])];
}

const list = [...merged.values()].sort((a, b) => (a.priority || 3) - (b.priority || 3) || a.id.localeCompare(b.id));
const byName = new Map();
const bySlug = new Map();
for (const e of list) {
  const name = String(e.name).toLowerCase();
  const slug = e.id.split('.').slice(1).join('.');
  byName.set(name, [...(byName.get(name) || []), e.id]);
  bySlug.set(slug, [...(bySlug.get(slug) || []), e.id]);
}
const dupes = [...new Set([...byName.values(), ...bySlug.values()].filter((ids) => ids.length > 1).map((ids) => [...new Set(ids)].sort().join(' = ')))]
  .filter((s) => s.includes(' = '));

writeFileSync(join(PLAN, 'master.json'), JSON.stringify({ new: list, attach, possibleDuplicates: dupes }, null, 2) + '\n');
const count = (p) => list.filter((e) => (e.priority || 3) === p).length;
const themes = list.filter((e) => e.kind === 'theme').length;
console.log(`plans merged: ${files.join(', ')}`);
console.log(`new entries: ${list.length} (priority 1: ${count(1)}, 2: ${count(2)}, 3: ${count(3)}; themes: ${themes})`);
console.log(`Miller headwords to attach to existing entries: ${attach.length}`);
console.log(`possible duplicates to review: ${dupes.length}`);
for (const d of dupes.slice(0, 30)) console.log(`  ${d}`);
