// After merges: points every "related" reference at the entry that was kept, and drops references to ids that
// no longer exist. Reads Interpretation/kb/plan/merge-log.json ([{ kept, removed: [...] }, …]).
// Usage: node tools/kb-relink.mjs [--apply]
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadKb } from './kb.mjs';

const KB = join(dirname(fileURLToPath(import.meta.url)), '..', 'Interpretation', 'kb');
const logFile = join(KB, 'plan', 'merge-log.json');
const moved = new Map();
if (existsSync(logFile)) {
  for (const d of JSON.parse(readFileSync(logFile, 'utf8'))) for (const r of d.removed || []) moved.set(r, d.kept);
}
const { entries } = loadKb();
const ids = new Set(entries.map((e) => e.id));
let touched = 0;
let repointed = 0;
let dropped = 0;
for (const e of entries) {
  const before = JSON.stringify(e.related || []);
  const next = [];
  for (const r of e.related || []) {
    const target = moved.get(r) || r;
    if (target !== r) repointed += 1;
    if (!ids.has(target) || target === e.id) { dropped += 1; continue; }
    if (!next.includes(target)) next.push(target);
  }
  if (JSON.stringify(next) !== before) {
    e.related = next;
    touched += 1;
    if (process.argv.includes('--apply')) {
      const { _file, ...data } = e;
      writeFileSync(join(KB, _file), JSON.stringify(data, null, 2) + '\n');
    }
  }
}
console.log(`${repointed} references re-pointed to kept entries · ${dropped} references to missing ids dropped · ${touched} entries ${process.argv.includes('--apply') ? 'updated' : 'would change (dry run: add --apply)'}`);
