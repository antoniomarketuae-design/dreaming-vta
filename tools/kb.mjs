// Knowledge-base helper for dream interpretation.
//   node tools/kb.mjs check              validate every entry; report problems and coverage
//   node tools/kb.mjs match "<dream>"    entries whose aliases/signals appear in the text (whole words)
//   node tools/kb.mjs get <id> [<id>…]   full entries as JSON
//   node tools/kb.mjs list               all ids with names
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const KB = join(dirname(fileURLToPath(import.meta.url)), '..', 'Interpretation', 'kb');
const DIRS = ['symbols', 'themes'];

export function loadKb() {
  const entries = [];
  const problems = [];
  for (const dir of DIRS) {
    const folder = join(KB, dir);
    if (!existsSync(folder)) continue;
    for (const file of readdirSync(folder).filter((f) => f.endsWith('.json')).sort()) {
      try {
        const entry = JSON.parse(readFileSync(join(folder, file), 'utf8'));
        entry._file = `${dir}/${file}`;
        entries.push(entry);
      } catch (err) {
        problems.push(`${dir}/${file}: invalid JSON (${err.message})`);
      }
    }
  }
  return { entries, problems };
}

const normalize = (s) => ` ${String(s).toLowerCase().replace(/[’']/g, "'").replace(/[^a-z0-9']+/g, ' ').replace(/\s+/g, ' ').trim()} `;
const termsOf = (e) => [e.name, ...(e.aliases || []), ...(e.signals || [])].filter(Boolean);

/**
 * Entries mentioned in the text, themes first, most matches first. Whole-word, with simple plural tolerance.
 * A match inside a longer match of the same kind is dropped ("teeth falling" hides the falling theme,
 * "ex boyfriend" hides the partner symbol), but a theme phrase never hides a symbol ("at the funeral" keeps Funeral).
 */
export function match(text, entries) {
  const hay = normalize(text);
  const hits = [];
  for (const e of entries) {
    for (const term of termsOf(e)) {
      const t = normalize(term).trim();
      if (!t) continue;
      for (const v of t.includes(' ') ? [t] : [t, `${t}s`, `${t}es`]) {
        for (let i = hay.indexOf(` ${v} `); i !== -1; i = hay.indexOf(` ${v} `, i + 1)) {
          hits.push({ id: e.id, kind: e.kind, term: term.toLowerCase(), start: i + 1, end: i + 1 + v.length });
        }
      }
    }
  }
  const kept = hits.filter((h) => !hits.some((o) => o.kind === h.kind && o.end - o.start > h.end - h.start && o.start <= h.start && o.end >= h.end));
  const byEntry = new Map();
  for (const h of kept) {
    if (!byEntry.has(h.id)) byEntry.set(h.id, new Set());
    byEntry.get(h.id).add(h.term);
  }
  const entryById = new Map(entries.map((e) => [e.id, e]));
  const found = [...byEntry].map(([id, terms]) => {
    const e = entryById.get(id);
    return { id, kind: e.kind, name: e.name, matched: [...terms], summary: e.summary };
  });
  found.sort((a, b) => (a.kind === b.kind ? b.matched.length - a.matched.length : a.kind === 'theme' ? -1 : 1));
  const matchedIds = new Set(found.map((f) => f.id));
  const byId = new Map(entries.map((e) => [e.id, e]));
  const related = [...new Set(found.flatMap((f) => byId.get(f.id)?.related || []))]
    .filter((id) => !matchedIds.has(id) && byId.has(id))
    .map((id) => ({ id, name: byId.get(id).name }));
  return { found, related };
}

// Real predictions only. Debunking ("such dreams foretell a death has no basis") and "dangers you cannot predict" pass.
const PREDICTION = /\b(you will (soon )?(meet|marry|die|become|get|lose|win|receive|inherit|travel|fall ill|be (rich|wealthy|sick|ill|pregnant|married|lucky))|will bring you (luck|money|wealth|misfortune)|(is|as) an omen|a (bad|good) omen|brings? (good|bad) luck|this (dream )?(predicts|foretells|means you will))\b/i;

/** Problems with an interpretation result, checked against the knowledge base. Empty list = OK to send. */
export function checkResult(result, entries) {
  const problems = [];
  if (typeof result?.essence !== 'string' || !result.essence.trim()) problems.push('essence missing');
  if (!Array.isArray(result?.reflect) || result.reflect.length !== 2) problems.push('reflect must have exactly 2 questions');
  if (typeof result?.perspectives?.psychology !== 'string') problems.push('perspectives.psychology missing');
  const ids = new Set(entries.map((e) => e.id));
  const used = [...(result?.symbols || []), ...(result?.themes || [])].map((s) => s.entry);
  for (const id of new Set([...used, ...(result?.basedOn || [])])) if (!ids.has(id)) problems.push(`"${id}" is not in the knowledge base`);
  for (const id of used) if (!(result.basedOn || []).includes(id)) problems.push(`"${id}" used but not listed in basedOn`);
  const shown = { ...result };
  delete shown.gaps;
  if (PREDICTION.test(JSON.stringify(shown))) problems.push('possible prediction language');
  return problems;
}

/** Words the dreamer reads (everything except ids, gaps and the fixed disclaimer). */
export function wordCount(result) {
  const parts = [result.essence, result.feeling?.text, result.care, ...Object.values(result.perspectives || {}), ...(result.reflect || []),
    ...[...(result.symbols || []), ...(result.themes || [])].flatMap((s) => [s.name, s.meaning])];
  return parts.filter(Boolean).join(' ').split(/\s+/).filter(Boolean).length;
}

function check(entries, problems) {
  const ids = new Set();
  const aliasOwner = new Map();
  const warnings = [];
  for (const e of entries) {
    const where = e._file;
    const need = (cond, msg) => { if (!cond) problems.push(`${where}: ${msg}`); };
    need(typeof e.id === 'string' && `${e.id}.json` === where.split('/')[1], 'id must match the file name');
    need(!ids.has(e.id), 'duplicate id');
    ids.add(e.id);
    need(e.kind === (where.startsWith('themes/') ? 'theme' : 'symbol'), 'wrong kind for its folder');
    need(typeof e.name === 'string' && e.name, 'name missing');
    need(typeof e.summary === 'string' && e.summary.length > 20, 'summary missing or too short');
    const terms = e.kind === 'theme' ? e.signals : e.aliases;
    need(Array.isArray(terms) && terms.length >= 3, `${e.kind === 'theme' ? 'signals' : 'aliases'} need at least 3 items`);
    const cases = e.kind === 'theme' ? e.variations : e.contexts;
    need(Array.isArray(cases) && cases.length >= 3 && cases.every((c) => c.when && c.meaning), `${e.kind === 'theme' ? 'variations' : 'contexts'} need 3+ items with when/meaning`);
    need(typeof e.perspectives?.psychology === 'string' && e.perspectives.psychology.length > 40, 'psychology perspective missing');
    for (const p of ['freud', 'traditional']) {
      const v = e.perspectives?.[p];
      need(v === null || v === undefined || (v.text && v.source), `${p} must be null or {text, source}`);
    }
    need(Array.isArray(e.questions) && e.questions.length >= 2, 'need 2+ questions');
    for (const t of terms || []) {
      const key = normalize(t).trim();
      if (aliasOwner.has(key) && aliasOwner.get(key) !== e.id) warnings.push(`"${key}" is used by both ${aliasOwner.get(key)} and ${e.id}`);
      else aliasOwner.set(key, e.id);
    }
  }
  for (const e of entries) for (const r of e.related || []) if (!ids.has(r)) warnings.push(`${e.id}: related "${r}" does not exist (yet)`);
  const count = (fn) => entries.filter(fn).length;
  return {
    entries: entries.length,
    symbols: count((e) => e.kind === 'symbol'),
    themes: count((e) => e.kind === 'theme'),
    withFreud: count((e) => e.perspectives?.freud),
    withTraditional: count((e) => e.perspectives?.traditional),
    withCare: count((e) => e.care),
    problems,
    warnings,
  };
}

// ---- CLI ----
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [cmd, ...args] = process.argv.slice(2);
  const { entries, problems } = loadKb();
  const out = (v) => console.log(JSON.stringify(v, null, 2));
  const strip = (e) => { const { _file, ...rest } = e; return rest; };

  if (cmd === 'check') {
    const report = check(entries, problems);
    out(report);
    process.exit(report.problems.length ? 1 : 0);
  } else if (cmd === 'match') {
    out(match(args.join(' '), entries));
  } else if (cmd === 'get') {
    const byId = new Map(entries.map((e) => [e.id, e]));
    out(args.map((id) => (byId.has(id) ? strip(byId.get(id)) : { id, error: 'not in the knowledge base' })));
  } else if (cmd === 'list') {
    for (const e of entries) console.log(`${e.id.padEnd(28)} ${e.name}`);
  } else {
    console.error('Usage: node tools/kb.mjs check | match "<dream text>" | get <id>… | list');
    process.exit(1);
  }
}
