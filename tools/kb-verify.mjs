// Verifies the sources cited by knowledge-base entries against the actual book texts.
//   Freud: every cited PDF page (±1, paragraphs run across pages) must mention the entry's name or one of its aliases.
//   Miller: every quoted headword must exist in the dictionary.
// Usage: node tools/kb-verify.mjs [--list] [id-prefix]     (--list prints every unverified citation)
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadKb } from './kb.mjs';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'Interpretation', 'sources');

function pagesOf(file) {
  const pages = new Map();
  const text = readFileSync(join(SRC, file), 'utf8');
  for (const part of text.split(/^=== page (\d+) ===$/m).slice(1).reduce((acc, v, i, arr) => (i % 2 ? acc : [...acc, [Number(v), arr[i + 1]]]), [])) {
    pages.set(part[0], part[1].toLowerCase().replace(/-\s*\n\s*/g, '').replace(/\s+/g, ' '));
  }
  return pages;
}

const BOOKS = { 1913: pagesOf('freud-interpretation-1913.txt'), 1920: pagesOf('freud-dream-psychology-1920.txt') };
const MILLER = new Set(
  readFileSync(join(SRC, 'miller-1901.txt'), 'utf8')
    .split('\n')
    .map((l) => l.match(/^_([^_]{1,60})_\.?(\[\d+\])?\s*$/)?.[1]?.trim().toLowerCase()) // headwords may carry a footnote: _Rabbit_.[182]
    .filter(Boolean),
);

// Words to look for on a cited page: the name and aliases, plus a short stem for single words (teeth/tooth, fall/falling).
function keywords(entry) {
  const words = new Set();
  for (const raw of [entry.name, ...(entry.aliases || []), ...(entry.signals || [])]) {
    const t = String(raw || '').toLowerCase().replace(/[^a-z' ]/g, ' ').trim();
    if (!t) continue;
    for (const w of t.split(/\s+/)) {
      // Everyday words would "verify" anything ("out" matched by chance once), so they don't count.
      if (w.length < 3 || ['out', 'for', 'the', 'and', 'was', 'had', 'her', 'his', 'one', 'two', 'but', 'not', 'all', 'can', 'get', 'got', 'see', 'saw', 'man', 'new', 'old', 'way', 'day', 'run', 'own', 'off', 'put', 'set', 'top', 'end', 'far', 'few', 'its', 'our', 'who', 'why', 'how', 'any', 'may', 'now', 'too', 'yet', 'use', 'you'].includes(w) || ['the', 'and', 'with', 'from', 'your', 'into', 'that', 'were', 'have', 'being', 'some', 'over', 'under', 'down', 'back', 'front', 'inside', 'outside', 'there', 'their', 'them', 'they', 'what', 'when', 'where', 'which', 'while', 'about', 'after', 'before', 'again', 'just', 'like', 'made', 'make', 'many', 'more', 'most', 'much', 'only', 'other', 'very', 'will', 'would', 'could', 'should', 'something', 'someone', 'getting', 'going', 'coming', 'falling', 'little', 'large', 'small', 'big', 'dream', 'dreams', 'dreaming'].includes(w)) continue;
      words.add(w.length > 5 ? w.slice(0, w.length - 2) : w.length <= 4 ? `=${w}` : w); // "=" marks short words: whole-word match only
    }
  }
  return [...words];
}

const squash = (s) => s.toLowerCase().replace(/[^a-z]+/g, ' ').trim();

// Phrases of 3+ words the entry presents in quotation marks as Freud's own words. Quote marks are paired in order
// first ("cipher" … "vexation" are two quotes, not one), then short ones are dropped.
const quotesIn = (text) => [...String(text || '').matchAll(/["“]([^"”]*)["”]/g)].map((m) => squash(m[1])).filter((q) => q.split(' ').length >= 3);
const BOOK_TEXT = Object.fromEntries(Object.entries(BOOKS).map(([k, pages]) => [k, squash([...pages.values()].join(' '))]));

function checkFreud(entry) {
  const freud = entry.perspectives?.freud;
  const src = freud?.source;
  if (!src) return null;
  const book = /1920|dream psychology/i.test(src) ? 1920 : 1913;
  const nums = [...src.replace(/\(1913\)|\(1920\)/g, '').matchAll(/\d{1,3}/g)].map((m) => Number(m[0]));
  if (!nums.length) return { ok: false, why: `no page number in "${src}"` };
  const pages = BOOKS[book];
  const around = nums.map((n) => squash([n - 1, n, n + 1].map((p) => pages.get(p) || '').join(' '))).join(' ');

  // Every quotation attributed to Freud must literally appear on the cited pages (OCR noise tolerated by
  // accepting a quote when its first or last 4 words are found).
  const misquoted = quotesIn(freud.text).filter((q) => {
    if (around.includes(q)) return false;
    if (q.split(' ').length <= 3 && BOOK_TEXT[book].includes(q)) return false; // a name or title used in the book, e.g. "Irma's injection"
    const w = q.split(' ');
    return !(around.includes(w.slice(0, 4).join(' ')) || around.includes(w.slice(-4).join(' ')));
  });
  if (misquoted.length) return { ok: false, why: `${book} p.${nums.join(',')}: quote not found: "${misquoted[0]}"` };

  // A quotation found word for word on the cited page is the strongest proof the citation is real.
  if (quotesIn(freud.text).length) return { ok: true, quotes: quotesIn(freud.text).length };

  // Otherwise the subject must be on the page, unless the entry honestly says Freud didn't write about it.
  // Keywords must start a word ("stol" must not match inside "histological"); short ones must be the whole word
  // ("cat" must not match "catch").
  const keys = keywords(entry).map((k) => (k.startsWith('=') ? new RegExp(`\\b${k.slice(1)}s?\\b`) : new RegExp(`\\b${k.replace(/[^a-z']/g, '')}`)));
  const missing = nums.filter((n) => !keys.some((re) => re.test([n - 1, n, n + 1].map((p) => pages.get(p) || '').join(' '))));
  if (!missing.length) return { ok: true, quotes: quotesIn(freud.text).length };
  const honest = /\b(did not|didn't|does not|never) (write|discuss|mention|address)/i.test(freud.text) && quotesIn(freud.text).length > 0;
  return honest
    ? { ok: true, quotes: quotesIn(freud.text).length, indirect: true }
    : { ok: false, why: `${book} p.${nums.join(',')}: none of [${keys.slice(0, 6).join(', ')}] on ${missing.join(',')}` };
}

function checkMiller(entry) {
  const src = entry.perspectives?.traditional?.source;
  if (!src) return null;
  const heads = [...src.matchAll(/['‘’"“”]([^'‘’"“”]{1,60})['‘’"“”]/g)].map((m) => m[1].trim().toLowerCase());
  if (!heads.length) return { ok: false, why: `no quoted headword in "${src}"` };
  const missing = heads.filter((h) => !MILLER.has(h));
  return missing.length ? { ok: false, why: `headword not in Miller: ${missing.join(', ')}` } : { ok: true };
}

const prefix = process.argv.slice(2).find((a) => !a.startsWith('--')) || '';
const list = process.argv.includes('--list');
// --ids=<file> limits the check to the ids listed in that file (one per line, or a JSON array).
const idsArg = process.argv.find((a) => a.startsWith('--ids='));
const onlyIds = idsArg
  ? new Set(readFileSync(idsArg.slice(6), 'utf8').trim().startsWith('[')
    ? JSON.parse(readFileSync(idsArg.slice(6), 'utf8'))
    : readFileSync(idsArg.slice(6), 'utf8').split(/\s+/).filter(Boolean))
  : null;
const all = loadKb().entries;
const entries = onlyIds ? all.filter((e) => onlyIds.has(e.id)) : all;
const tally = { freud: [0, 0], miller: [0, 0] };
let quotes = 0;
let indirect = 0;
const bad = [];
for (const e of entries.filter((x) => x.id.startsWith(prefix))) {
  for (const [kind, fn] of [['freud', checkFreud], ['miller', checkMiller]]) {
    const r = fn(e);
    if (!r) continue;
    tally[kind][r.ok ? 0 : 1] += 1;
    quotes += r.quotes || 0;
    indirect += r.indirect ? 1 : 0;
    if (!r.ok) bad.push(`${e.id.padEnd(28)} ${kind.padEnd(6)} ${r.why}`);
  }
}
const pct = ([ok, no]) => `${ok}/${ok + no} verified${ok + no ? ` (${Math.round((100 * ok) / (ok + no))}%)` : ''}`;
console.log(`Freud citations:  ${pct(tally.freud)} · ${quotes} quotations found on their pages · ${indirect} honest "Freud did not write about this" notes`);
console.log(`Miller citations: ${pct(tally.miller)}`);
if (list || bad.length <= 40) console.log(bad.length ? `\nUnverified:\n${bad.join('\n')}` : '\nAll citations verified.');
else console.log(`\n${bad.length} unverified (use --list to see all)`);
