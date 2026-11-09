// Builds a "source pack" per planned knowledge-base entry: the exact Miller paragraphs for its headwords and the
// Freud passages (with PDF page numbers) that mention it, so writers work from real text and cite real pages.
// Usage: node tools/kb-packs.mjs <plan.json>     → Interpretation/kb/packs/<id>.json for every entry in plan.new
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'Interpretation');
const SRC = join(ROOT, 'sources');
const OUT = join(ROOT, 'kb', 'packs');

function millerEntries() {
  const map = new Map();
  let page = 0;
  let current = null;
  for (const line of readFileSync(join(SRC, 'miller-1901.txt'), 'utf8').split('\n')) {
    const p = line.match(/^=== page (\d+) ===$/);
    if (p) { page = Number(p[1]); continue; }
    const h = line.match(/^_([^_]{1,60})_\.?(\[\d+\])?\s*$/);
    if (h) {
      current = { headword: h[1].trim(), page, text: '' };
      map.set(current.headword.toLowerCase(), current);
      continue;
    }
    if (current && current.text.length < 2500) current.text += `${line.trim()} `;
  }
  for (const e of map.values()) e.text = e.text.replace(/\s+/g, ' ').trim();
  return map;
}

function freudPages(file) {
  const parts = readFileSync(join(SRC, file), 'utf8').split(/^=== page (\d+) ===$/m);
  const pages = [];
  for (let i = 1; i < parts.length; i += 2) pages.push({ page: Number(parts[i]), text: parts[i + 1].replace(/-\s*\n\s*/g, '').replace(/\s+/g, ' ') });
  return pages;
}

const MILLER = millerEntries();
const FREUD = [
  { book: 'Freud, The Interpretation of Dreams (1913)', pages: freudPages('freud-interpretation-1913.txt') },
  { book: 'Freud, Dream Psychology (1920)', pages: freudPages('freud-dream-psychology-1920.txt') },
];
const STOP = new Set(['the', 'and', 'with', 'from', 'your', 'being', 'into', 'that', 'this', 'something', 'someone', 'person', 'place', 'thing', 'other', 'very']);

function freudHits(words, limit = 6) {
  const hits = [];
  for (const { book, pages } of FREUD) {
    for (const { page, text } of pages) {
      const lower = text.toLowerCase();
      for (const w of words) {
        const re = new RegExp(`\\b${w}`, 'g');
        let m;
        while ((m = re.exec(lower)) && hits.length < limit * 3) {
          hits.push({ book, page, word: w, excerpt: text.slice(Math.max(0, m.index - 220), m.index + 280).trim() });
          break; // one excerpt per word per page
        }
      }
    }
  }
  // Prefer the 1913 book and spread across pages.
  const seen = new Set();
  return hits.filter((h) => !seen.has(`${h.book}${h.page}`) && seen.add(`${h.book}${h.page}`)).slice(0, limit);
}

const planFile = process.argv[2];
if (!planFile) { console.error('Usage: node tools/kb-packs.mjs <plan.json>'); process.exit(1); }
const plan = JSON.parse(readFileSync(planFile, 'utf8'));
mkdirSync(OUT, { recursive: true });
let withMiller = 0;
let withFreud = 0;
for (const entry of plan.new || plan) {
  const miller = (entry.miller || []).map((h) => MILLER.get(String(h).toLowerCase())).filter(Boolean)
    .map((m) => ({ source: `Miller, 10,000 Dreams Interpreted (1901), '${m.headword}'`, page: m.page, text: m.text }));
  const words = [...new Set([entry.name, ...(entry.miller || [])].join(' ').toLowerCase().split(/[^a-z]+/))]
    .filter((w) => w.length > 3 && !STOP.has(w))
    .map((w) => (w.length > 6 ? w.slice(0, w.length - 2) : w));
  const freud = words.length ? freudHits(words) : [];
  if (miller.length) withMiller += 1;
  if (freud.length) withFreud += 1;
  writeFileSync(join(OUT, `${entry.id}.json`), JSON.stringify({ id: entry.id, name: entry.name, kind: entry.kind, category: entry.category, note: entry.note || null, miller, freud }, null, 2) + '\n');
}
console.log(`packs written: ${(plan.new || plan).length} · with Miller text: ${withMiller} · with Freud passages: ${withFreud} → ${OUT}`);
