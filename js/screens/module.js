// Analysis modules opened from the Progress tab (#module/<id>): statistics, trends, nightmares, correlations,
// symbols-map. Also the two collection lists behind the Progress "Collection" cards: #module/symbols, #module/emotions.
// Everything is computed on the phone from the user's own dreams. Nothing is invented: when there is too little
// data for a finding, the screen says so instead of guessing.
import { listDreams, withDefaults, getStats, SYMBOL_CATEGORIES, markSeen, localDay } from '../store.js';
import { MODULES, unlockState } from '../progress.js';
import { TAGS } from '../analyze.js';
import { esc, icons, relativeDay, formatDate } from '../ui.js';

const ic = (body) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

/** Icons used here and on the Progress tab (not in ui.js). */
export const MOD_ICONS = {
  trend: ic('<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>'),
  cloud: ic('<path d="M7 15a4 4 0 1 1 .9-7.9A5.5 5.5 0 0 1 18.5 9 3 3 0 0 1 18 15z"/><path d="M8 18.5l-1 2M12 18.5l-1 2M16 18.5l-1 2"/>'),
  network: ic('<rect x="9" y="3" width="6" height="5" rx="1.5"/><rect x="3" y="16" width="6" height="5" rx="1.5"/><rect x="15" y="16" width="6" height="5" rx="1.5"/><path d="M12 8v4M6 16v-2h12v2"/>'),
  nodes: ic('<circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="7" r="2.5"/><circle cx="12" cy="18" r="2.5"/><circle cx="19" cy="17" r="1.5"/><path d="M8.3 7.1l7.4-.4M7.2 8.2l3.7 7.6M16.9 9.2l-3.7 6.6M14.4 18l3.2-.6"/>'),
  shapes: ic('<path d="M7 3.5l4 7H3z"/><rect x="13" y="3.5" width="7.5" height="7.5" rx="1.5"/><circle cx="12" cy="17" r="3.8"/>'),
  masks: ic('<path d="M3.5 4.5h9v5a4.5 4.5 0 0 1-9 0z"/><path d="M6 8h.01M10 8h.01M6.5 11.5c1 .8 2 .8 3 0"/><path d="M12.5 9.5h8v5a4.5 4.5 0 0 1-8.3 2.4"/><path d="M15 13h.01M18 13h.01M15 16.5c1-.8 2-.8 3 0"/>'),
  arrow: ic('<path d="M7 17 17 7M9 7h8v8"/>'),
  up: ic('<path d="M12 19V5M6 11l6-6 6 6"/>'),
  down: ic('<path d="M12 5v14M6 13l6 6 6-6"/>'),
  heart: ic('<path d="M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.4 4.3 4.3 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10z"/>'),
};

/** One-line card text and a longer "what you'll see" line for each analysis module (our own wording). */
export const MODULE_INFO = {
  statistics: { icon: icons.progress, blurb: 'Your journal in numbers',
    about: 'Totals, average ratings, the balance of dreams and nightmares, your lucid rate, best streak and busiest weekday.' },
  trends: { icon: MOD_ICONS.trend, blurb: 'How your dreams shift over time',
    about: 'Which emotions and themes are rising or fading as your journal grows.' },
  nightmares: { icon: MOD_ICONS.cloud, blurb: 'How often, and what is in them',
    about: 'How often nightmares come, how you rated them, and the symbols and feelings they share.' },
  correlations: { icon: MOD_ICONS.network, blurb: 'What tends to go together',
    about: 'Links between sleep, ratings, emotions and recurring dreams, shown only once there is enough data to say something.' },
  'symbols-map': { icon: MOD_ICONS.nodes, blurb: 'Your symbols, grouped and linked',
    about: 'Every symbol you have tagged, grouped by kind, sized by how often it appears, and the ones that travel together.' },
};

const CATEGORY = {
  people: { label: 'People', hue: 30 },
  objects: { label: 'Objects', hue: 205 },
  characters: { label: 'Characters', hue: 285 },
  places: { label: 'Places', hue: 150 },
  themes: { label: 'Themes', hue: 45 },
  actions: { label: 'Actions', hue: 340 },
};

// ---- Small helpers ----

const DAY = 86400000;
const dayNum = (iso) => { const [y, m, d] = iso.split('-').map(Number); return Math.round(Date.UTC(y, m - 1, d) / DAY); };
const dateOf = (iso) => new Date(`${iso}T00:00:00`);
const norm = (s) => String(s ?? '').toLowerCase().trim();
const capFirst = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const avg = (arr) => (arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : null);
const one = (x) => { const v = Math.round(x * 10) / 10; return Number.isInteger(v) ? String(v) : v.toFixed(1); };
const r5 = (v) => (typeof v === 'number' && v >= 1 && v <= 5 ? v : null);
const sleepQ = (d) => r5(d.ratings.sleep) ?? r5(d.sleep.quality);

/** All dreams through withDefaults, oldest first. */
function loadDreams() {
  return listDreams().map(withDefaults).filter((d) => typeof d.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d.date))
    .sort((a, b) => a.date.localeCompare(b.date) || String(a.createdAt).localeCompare(String(b.createdAt)));
}

/** Tagged symbols of a dream: [{ key: 'places:beach', cat, name, label }] (distinct). */
function symbolsOf(d) {
  const seen = new Set();
  const out = [];
  for (const cat of SYMBOL_CATEGORIES) {
    for (const raw of d.symbols[cat] || []) {
      const name = norm(raw);
      const key = `${cat}:${name}`;
      if (!name || seen.has(key)) continue;
      seen.add(key);
      out.push({ key, cat, name, label: String(raw).trim() });
    }
  }
  return out;
}
const emotionsOf = (d) => [...new Set((d.emotions || []).map(norm).filter(Boolean))];
const spotted = (d, kind) => (d.tags || []).filter((t) => TAGS[t]?.kind === kind).map((t) => TAGS[t].label);
/** Feelings: the emotions the user tagged; for a dream without any, the moods spotted in its text. */
const feelingsOf = (d) => { const e = emotionsOf(d); return e.length ? e : spotted(d, 'mood'); };
/** Themes: tagged symbols (any kind); for a dream without any, the symbols spotted in its text. */
const themesOf = (d) => { const s = symbolsOf(d).map((x) => x.name); return s.length ? [...new Set(s)] : spotted(d, 'symbol'); };

function countBy(dreams, fn) {
  const m = new Map();
  for (const d of dreams) for (const k of new Set(fn(d))) m.set(k, (m.get(k) || 0) + 1);
  return m;
}
const topOf = (map, n = 6) => [...map.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))).slice(0, n);

function pairsBy(dreams, fn, limit = 12) {
  const m = new Map();
  for (const d of dreams) {
    const items = [...new Set(fn(d))].slice(0, limit).sort();
    for (let i = 0; i < items.length; i += 1) for (let j = i + 1; j < items.length; j += 1) {
      const k = `${items[i]}\u0000${items[j]}`;
      m.set(k, (m.get(k) || 0) + 1);
    }
  }
  return m;
}

function bestStreak(dreams) {
  const days = [...new Set(dreams.map((d) => dayNum(d.date)))].sort((a, b) => a - b);
  let best = 0;
  let run = 0;
  let prev = null;
  for (const n of days) { run = prev !== null && n === prev + 1 ? run + 1 : 1; best = Math.max(best, run); prev = n; }
  return best;
}

function sleepHours(d) {
  const ok = (t) => typeof t === 'string' && /^\d{1,2}:\d{2}$/.test(t);
  if (!ok(d.sleep.bedtime) || !ok(d.sleep.wake)) return null;
  const [bh, bm] = d.sleep.bedtime.split(':').map(Number);
  const [wh, wm] = d.sleep.wake.split(':').map(Number);
  let mins = wh * 60 + wm - (bh * 60 + bm);
  if (mins <= 0) mins += 1440;
  const h = mins / 60;
  return h >= 1 && h <= 16 ? h : null;
}

function pearson(pairs) {
  const mx = avg(pairs.map((p) => p[0]));
  const my = avg(pairs.map((p) => p[1]));
  let sxy = 0; let sxx = 0; let syy = 0;
  for (const [x, y] of pairs) { sxy += (x - mx) * (y - my); sxx += (x - mx) ** 2; syy += (y - my) ** 2; }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : null;
}
const strength = (r) => { const a = Math.abs(r); return a < 0.2 ? null : a < 0.4 ? 'a slight' : a < 0.6 ? 'a clear' : 'a strong'; };

/** Weekly buckets for a young journal, monthly ones otherwise; each gets its dreams. */
function timeBuckets(dreams, max = 8) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const first = dreams.length ? dateOf(dreams[0].date) : today;
  const span = Math.max(0, Math.round((today - first) / DAY));
  const buckets = [];
  if (span <= 63) {
    const mon = new Date(today);
    mon.setDate(today.getDate() - ((today.getDay() + 6) % 7));
    const n = Math.min(max, Math.max(4, Math.floor(span / 7) + 1));
    for (let i = n - 1; i >= 0; i -= 1) {
      const s = new Date(mon); s.setDate(mon.getDate() - 7 * i);
      const e = new Date(s); e.setDate(s.getDate() + 7);
      buckets.push({ start: localDay(s), end: localDay(e), unit: 'week', current: i === 0,
        label: i === 0 ? 'Now' : s.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }),
        title: `Week of ${s.toLocaleDateString(undefined, { day: 'numeric', month: 'long' })}` });
    }
  } else {
    const months = (today.getFullYear() - first.getFullYear()) * 12 + today.getMonth() - first.getMonth() + 1;
    const n = Math.min(max, Math.max(4, months));
    for (let i = n - 1; i >= 0; i -= 1) {
      const s = new Date(today.getFullYear(), today.getMonth() - i, 1);
      const e = new Date(today.getFullYear(), today.getMonth() - i + 1, 1);
      buckets.push({ start: localDay(s), end: localDay(e), unit: 'month', current: i === 0,
        label: s.toLocaleDateString(undefined, { month: 'short' }),
        title: s.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) });
    }
  }
  for (const b of buckets) b.dreams = dreams.filter((d) => d.date >= b.start && d.date < b.end);
  return buckets;
}

// ---- Shared pieces of markup ----

const card = (title, body, extra = '') => `<section class="mod-card glass${extra}">${title ? `<h2 class="mod-card-title">${title}</h2>` : ''}${body}</section>`;
const note = (text) => `<p class="mod-note">${text}</p>`;
/** An honest "not enough data yet" box. */
const needMore = (text) => `<p class="mod-need">${icons.info}<span>${text}</span></p>`;

function tilesHTML(tiles) {
  return `<div class="mod-tiles">${tiles.map(([value, label, unit]) => `
    <div class="mod-tile glass">
      <div class="mod-tile-value">${value}${unit ? `<span class="mod-tile-unit">${unit}</span>` : ''}</div>
      <div class="mod-tile-label">${label}</div>
    </div>`).join('')}</div>`;
}

/** Vertical columns. items: [{ label, value, part?, hot?, title? }]; part is drawn in ember at the bottom. */
function colsHTML(items, { values = true } = {}) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return `<div class="mod-cols" style="--n:${items.length}">${items.map((i) => {
    const h = i.value ? Math.max(6, (i.value / max) * 100) : 0;
    const part = i.part && i.value ? (i.part / i.value) * 100 : 0;
    return `
      <div class="mod-col${i.hot ? ' is-hot' : ''}"${i.title ? ` title="${esc(i.title)}"` : ''}>
        <span class="mod-col-area">
          ${i.value ? `<span class="mod-col-bar" style="height:${h.toFixed(1)}%">${values ? `<span class="mod-col-val">${i.value}</span>` : ''}${part ? `<span class="mod-col-part" style="height:${part.toFixed(1)}%"></span>` : ''}</span>` : '<span class="mod-col-ghost"></span>'}
        </span>
        <span class="mod-col-label">${esc(i.label)}</span>
      </div>`;
  }).join('')}</div>`;
}

/** Horizontal comparison bars: rows [{ label, value, max, text, hue? }]. */
function barsHTML(rows) {
  return `<div class="mod-bars">${rows.map((row) => `
    <div class="mod-bar-row">
      <span class="mod-bar-label">${row.label}</span>
      <span class="mod-bar-track"><span class="mod-bar" style="width:${Math.max(row.value ? 4 : 0, (row.value / (row.max || 1)) * 100).toFixed(1)}%${row.hue != null ? `;--hue:${row.hue}` : ''}"></span></span>
      <span class="mod-bar-text">${row.text}</span>
    </div>`).join('')}</div>`;
}

function chipsHTML(entries, hue) {
  return `<div class="mod-chips">${entries.map(([name, n]) => `<span class="chip"${hue != null ? ` style="--hue:${hue}"` : ''}>${esc(capFirst(name))}<b class="mod-chip-n">${n}</b></span>`).join('')}</div>`;
}

const chevron = icons.chevronRight;
function dreamLinks(dreams) {
  return `<ul class="mod-dreams">${[...dreams].reverse().map((d) => `
    <li><a class="mod-dream" href="#dream/${encodeURIComponent(d.id)}">
      <span class="mod-dream-main">
        <span class="mod-dream-title">${esc(d.title || 'Untitled dream')}</span>
        <span class="mod-dream-date">${esc(relativeDay(d.date))}${d.kind === 'nightmare' ? ' · nightmare' : ''}${d.lucid ? ' · lucid' : ''}</span>
      </span>${chevron}
    </a></li>`).join('')}</ul>`;
}

// ---- Statistics ----

const RATING_ROWS = [
  ['Dream rating', (d) => r5(d.ratings.rating)],
  ['Dream length', (d) => r5(d.ratings.length)],
  ['Sleep quality', sleepQ],
  ['Vividness', (d) => r5(d.lucidity.vividness)],
];
const WEEKDAYS = Array.from({ length: 7 }, (_, i) => new Date(2024, 0, 1 + i)); // 1 Jan 2024 was a Monday

function statisticsHTML(dreams) {
  const n = dreams.length;
  const nightmares = dreams.filter((d) => d.kind === 'nightmare').length;
  const lucid = dreams.filter((d) => d.lucid).length;
  const recurring = dreams.filter((d) => d.recurring).length;
  const nights = new Set(dreams.map((d) => d.date)).size;
  const best = bestStreak(dreams);
  const { streak } = getStats();
  const weeks = Math.max(1, (dayNum(localDay()) - dayNum(dreams[0].date) + 1) / 7);
  const words = avg(dreams.map((d) => (String(d.text || '').match(/\S+/g) || []).length)) || 0;
  const hours = dreams.map(sleepHours).filter((h) => h != null);

  const tiles = tilesHTML([
    [n, 'Dreams recorded'],
    [nights, 'Nights with a dream'],
    [best, 'Best streak', best === 1 ? 'night' : 'nights'],
    [`${pct(lucid, n)}%`, `Lucid rate · ${lucid} of ${n}`],
  ]);

  const dreamsN = n - nightmares;
  const split = card('Dreams and nightmares', `
    <div class="mod-split" role="img" aria-label="${dreamsN} dreams, ${nightmares} nightmares">
      ${dreamsN ? `<span class="mod-split-a" style="flex:${dreamsN}"></span>` : ''}
      ${nightmares ? `<span class="mod-split-b" style="flex:${nightmares}"></span>` : ''}
    </div>
    <div class="mod-legend">
      <span><i class="mod-key mod-key-a"></i>Dreams · ${dreamsN} (${pct(dreamsN, n)}%)</span>
      <span><i class="mod-key mod-key-b"></i>Nightmares · ${nightmares} (${pct(nightmares, n)}%)</span>
    </div>
    ${note(recurring ? `${plural(recurring, 'dream')} marked as recurring.` : 'No dreams marked as recurring yet.')}`);

  const rated = RATING_ROWS.map(([label, get]) => {
    const vals = dreams.map(get).filter((v) => v != null);
    return { label, vals };
  }).filter((x) => x.vals.length);
  const ratings = card('Average ratings', rated.length
    ? `${barsHTML(rated.map((x) => ({ label: x.label, value: avg(x.vals), max: 5, text: `<b>${one(avg(x.vals))}</b>/5` })))}
       ${note(rated.map((x) => `${x.label}: ${x.vals.length} of ${n} rated`).join(' · '))}`
    : needMore('None of your dreams have ratings yet. Add a rating, length or sleep quality in a dream’s details and averages appear here.'));

  const byDay = Array(7).fill(0);
  for (const d of dreams) byDay[(dateOf(d.date).getDay() + 6) % 7] += 1;
  const top = Math.max(...byDay);
  const topNames = WEEKDAYS.filter((_, i) => byDay[i] === top).map((d) => d.toLocaleDateString(undefined, { weekday: 'long' }));
  const weekday = card('When you remember', `
    <p class="mod-lead">${topNames.length === 1
      ? `Most active day: <b>${esc(topNames[0])}</b>, with ${plural(top, 'dream')}.`
      : topNames.length < 7 ? `Most active days: <b>${esc(topNames.join(', '))}</b> (${plural(top, 'dream')} each).` : 'Your dreams are spread evenly across the week.'}</p>
    ${colsHTML(WEEKDAYS.map((d, i) => ({ label: d.toLocaleDateString(undefined, { weekday: 'short' }), value: byDay[i], hot: byDay[i] === top && top > 0 })))}`);

  const rhythm = card('Rhythm', `
    <dl class="mod-facts">
      <div><dt>Current streak</dt><dd>${plural(streak, 'night')}</dd></div>
      <div><dt>Best streak</dt><dd>${plural(best, 'night')}</dd></div>
      <div><dt>Dreams per week</dt><dd>${one(n / weeks)}</dd></div>
      <div><dt>Words per dream</dt><dd>${Math.round(words)}</dd></div>
      ${hours.length ? `<div><dt>Average sleep</dt><dd>${one(avg(hours))} h <small>(${hours.length} nights)</small></dd></div>` : ''}
      <div><dt>First dream</dt><dd>${esc(formatDate(dreams[0].date))}</dd></div>
    </dl>`);

  return tiles + split + ratings + weekday + rhythm;
}

// ---- Trends ----

function trendRows(dreams, fn) {
  const mid = Math.floor(dreams.length / 2);
  const older = dreams.slice(0, mid);
  const newer = dreams.slice(mid);
  const a = countBy(older, fn);
  const b = countBy(newer, fn);
  const rows = [...new Set([...a.keys(), ...b.keys()])].map((k) => {
    const ca = a.get(k) || 0;
    const cb = b.get(k) || 0;
    const sa = ca / older.length;
    const sb = cb / newer.length;
    return { k, ca, cb, sa, sb, total: ca + cb, delta: sb - sa };
  }).filter((x) => x.total >= 2);
  return {
    rising: rows.filter((x) => x.delta >= 0.15 && x.cb >= 2).sort((x, y) => y.delta - x.delta).slice(0, 4),
    fading: rows.filter((x) => x.delta <= -0.15 && x.ca >= 2).sort((x, y) => x.delta - y.delta).slice(0, 4),
    steady: rows.filter((x) => Math.abs(x.delta) < 0.15 && x.ca && x.cb).sort((x, y) => y.total - x.total).slice(0, 4),
    olderN: older.length,
    newerN: newer.length,
  };
}

function trendList(t) {
  const row = (x, dir) => `
    <li class="mod-trend mod-trend-${dir}">
      <span class="mod-trend-icon">${dir === 'up' ? MOD_ICONS.up : dir === 'down' ? MOD_ICONS.down : '<i></i>'}</span>
      <span class="mod-trend-name">${esc(capFirst(x.k))}</span>
      <span class="mod-trend-text">${pct(x.cb, t.newerN)}% of recent <small>was ${pct(x.ca, t.olderN)}%</small></span>
    </li>`;
  const parts = [];
  if (t.rising.length) parts.push(`<p class="mod-sub">Rising</p><ul class="mod-trends">${t.rising.map((x) => row(x, 'up')).join('')}</ul>`);
  if (t.fading.length) parts.push(`<p class="mod-sub">Fading</p><ul class="mod-trends">${t.fading.map((x) => row(x, 'down')).join('')}</ul>`);
  if (t.steady.length) parts.push(`<p class="mod-sub">Steady</p><ul class="mod-trends">${t.steady.map((x) => row(x, 'flat')).join('')}</ul>`);
  return parts.join('');
}

function heatHTML(buckets, items, fn) {
  const labelEvery = buckets[0]?.unit === 'week' ? 2 : 1;
  const last = buckets.length - 1;
  return `<div class="mod-heat" style="--n:${buckets.length}">
    ${items.map((name) => `
      <span class="mod-heat-label">${esc(capFirst(name))}</span>
      ${buckets.map((b) => {
        if (!b.dreams.length) return `<span class="mod-heat-cell is-empty" title="${esc(b.title)}: no dreams"></span>`;
        const c = b.dreams.filter((d) => fn(d).includes(name)).length;
        const s = c / b.dreams.length;
        return `<span class="mod-heat-cell" style="--a:${c ? (0.18 + s * 0.82).toFixed(2) : 0}" title="${esc(b.title)}: ${c} of ${b.dreams.length}"></span>`;
      }).join('')}`).join('')}
    <span></span>${buckets.map((b, i) => `<span class="mod-heat-x">${(last - i) % labelEvery === 0 ? esc(b.label) : ''}</span>`).join('')}
  </div>`;
}

function trendsHTML(dreams) {
  const buckets = timeBuckets(dreams, 8);
  const unit = buckets[0].unit;
  const activity = card(`Dreams per ${unit}`, `
    ${colsHTML(buckets.map((b) => ({ label: b.label, value: b.dreams.length, hot: b.current, title: b.title })))}
    ${note(`Last ${buckets.length} ${unit}s. Dreams older than that still count in the comparisons below.`)}`);

  const blocks = [];
  for (const [title, fn, empty] of [
    ['Emotions', feelingsOf, 'No emotions yet. Tag how a dream felt in its details, or describe the feeling in your words, and this fills in.'],
    ['Themes and symbols', themesOf, 'No symbols yet. Add people, places or themes to a dream, or describe them in the text, and this fills in.'],
  ]) {
    const totals = countBy(dreams, fn);
    if (!totals.size) { blocks.push(card(title, needMore(empty))); continue; }
    const t = trendRows(dreams, fn);
    const list = trendList(t);
    const topNames = topOf(totals, 5).map(([k]) => k);
    blocks.push(card(title, `
      ${list || needMore('Nothing has appeared often enough yet to call it rising or fading. Patterns need something to show up at least twice.')}
      <p class="mod-sub">Over time</p>
      ${heatHTML(buckets, topNames, fn)}
      ${note(`“Recent” means your newest ${t.newerN} dreams, compared with the ${t.olderN} before them.`)}`));
  }

  const mid = Math.floor(dreams.length / 2);
  const older = dreams.slice(0, mid);
  const newer = dreams.slice(mid);
  const lines = [];
  const ra = older.map((d) => r5(d.ratings.rating)).filter((v) => v != null);
  const rb = newer.map((d) => r5(d.ratings.rating)).filter((v) => v != null);
  if (ra.length >= 3 && rb.length >= 3) {
    const diff = avg(rb) - avg(ra);
    lines.push(Math.abs(diff) < 0.3
      ? `Your dream ratings have stayed about the same (${one(avg(ra))} → ${one(avg(rb))}).`
      : `Your dream ratings went ${diff > 0 ? 'up' : 'down'} from ${one(avg(ra))} to ${one(avg(rb))} on average.`);
  } else {
    lines.push('Rate at least three older and three newer dreams to see how your ratings change.');
  }
  const la = older.filter((d) => d.lucid).length;
  const lb = newer.filter((d) => d.lucid).length;
  lines.push(la || lb
    ? `Lucid dreams: ${pct(la, older.length)}% of earlier dreams, ${pct(lb, newer.length)}% of recent ones.`
    : 'No lucid dreams yet. The Lucidity tab has techniques to try.');
  const na = older.filter((d) => d.kind === 'nightmare').length;
  const nb = newer.filter((d) => d.kind === 'nightmare').length;
  if (na || nb) lines.push(`Nightmares: ${pct(na, older.length)}% of earlier dreams, ${pct(nb, newer.length)}% of recent ones.`);
  const shifts = card('Other shifts', `<ul class="mod-lines">${lines.map((l) => `<li>${l}</li>`).join('')}</ul>`);

  return `${activity}${blocks.join('')}${shifts}
    ${note('Emotions come from the ones you tagged; for dreams without tags, from moods spotted in your writing. The same goes for symbols.')}`;
}

// ---- Nightmares ----

function nightmaresHTML(dreams) {
  const nm = dreams.filter((d) => d.kind === 'nightmare');
  const others = dreams.filter((d) => d.kind !== 'nightmare');
  const today = dayNum(localDay());
  const inRange = (d, from, to) => { const ago = today - dayNum(d.date); return ago >= from && ago < to; };
  const last30 = nm.filter((d) => inRange(d, 0, 30)).length;
  const prev30 = nm.filter((d) => inRange(d, 30, 60)).length;

  if (!nm.length) {
    return card('', `
      <div class="mod-calm">${icons.moon}</div>
      <p class="mod-lead mod-center">No nightmares logged so far.</p>
      ${note('When a dream frightens or upsets you, set its type to Nightmare in the details. Then you will see here how often they come and what they have in common.')}`);
  }

  const tiles = tilesHTML([
    [nm.length, 'Nightmares logged'],
    [`${pct(nm.length, dreams.length)}%`, 'Of all your dreams'],
    [last30, 'Last 30 days'],
    [prev30, 'The 30 days before'],
  ]);

  const buckets = timeBuckets(dreams, 8);
  const freq = card('How often', `
    ${colsHTML(buckets.map((b) => {
      const k = b.dreams.filter((d) => d.kind === 'nightmare').length;
      return { label: b.label, value: b.dreams.length, part: k, hot: false, title: `${b.title}: ${k} of ${b.dreams.length}` };
    }), { values: false })}
    <div class="mod-legend">
      <span><i class="mod-key mod-key-b"></i>Nightmares</span>
      <span><i class="mod-key mod-key-a"></i>Other dreams</span>
    </div>
    ${note(last30 === prev30 ? 'About the same as the month before.' : last30 > prev30 ? `More than the month before (${prev30} → ${last30}).` : `Fewer than the month before (${prev30} → ${last30}).`)}`);

  const nr = nm.map((d) => r5(d.ratings.rating)).filter((v) => v != null);
  const or = others.map((d) => r5(d.ratings.rating)).filter((v) => v != null);
  const vivN = nm.map((d) => r5(d.lucidity.vividness)).filter((v) => v != null);
  const sq = nm.map(sleepQ).filter((v) => v != null);
  const rows = [];
  if (nr.length) rows.push({ label: 'Nightmare rating', value: avg(nr), max: 5, text: `<b>${one(avg(nr))}</b>/5`, hue: 8 });
  if (or.length) rows.push({ label: 'Other dreams', value: avg(or), max: 5, text: `<b>${one(avg(or))}</b>/5` });
  if (vivN.length) rows.push({ label: 'Vividness', value: avg(vivN), max: 5, text: `<b>${one(avg(vivN))}</b>/5`, hue: 8 });
  if (sq.length) rows.push({ label: 'Sleep quality', value: avg(sq), max: 5, text: `<b>${one(avg(sq))}</b>/5`, hue: 8 });
  const intensity = card('How they felt', nr.length >= 2
    ? `${barsHTML(rows)}${note(`From ${plural(nr.length, 'rated nightmare')}. A lower rating means it felt worse.`)}`
    : `${rows.length ? barsHTML(rows) : ''}${needMore('Rate at least two nightmares in their details to see how intense they tend to be.')}`);

  const sym = topOf(countBy(nm, themesOf), 8);
  const emo = topOf(countBy(nm, feelingsOf), 8);
  const recurringN = nm.filter((d) => d.recurring).length;
  const common = card('What they share', `
    <p class="mod-sub">Symbols and themes</p>
    ${sym.length ? chipsHTML(sym, 8) : needMore('No symbols in your nightmares yet.')}
    <p class="mod-sub">Feelings</p>
    ${emo.length ? chipsHTML(emo, 340) : needMore('No feelings noted in your nightmares yet.')}
    ${note(recurringN ? `${plural(recurringN, 'nightmare')} marked as recurring.` : 'None of them are marked as recurring.')}`);

  const frequent = last30 >= 4 || (nm.length >= 5 && nm.length / dreams.length >= 0.4);
  const care = frequent ? card('', `
    <div class="mod-care-head">${MOD_ICONS.heart}<h2 class="mod-card-title">Nightmares have been frequent</h2></div>
    <p class="mod-lead">That happens to many people, often in stressful stretches. A few gentle things that can help:</p>
    <ul class="mod-lines">
      <li><b>Give it a new ending.</b> Write the nightmare again with a calmer outcome, then picture that version for a few minutes during the day.</li>
      <li><b>Wind down.</b> A steady bedtime, dim light and something calm before sleep make rough nights less likely.</li>
      <li><b>Practise noticing.</b> Realising you are dreaming can let you step out of a scene. The <a href="#lucidity">Lucidity tab</a> has techniques.</li>
      <li><b>You don’t have to manage it alone.</b> If nightmares disturb your sleep or your days, talking to a doctor or therapist can really help.</li>
    </ul>`, ' mod-care') : '';

  return tiles + care + freq + intensity + common + `<p class="mod-sub mod-sub-out">Your nightmares</p>${card('', dreamLinks(nm.slice(-10)))}`;
}

// ---- Correlations ----

const MIN_PAIRS = 8;
const MIN_GROUP = 3;

function gridHTML(pairs, xs, ys, xTitle, yTitle) {
  const cells = new Map();
  for (const [x, y] of pairs) cells.set(`${x},${y}`, (cells.get(`${x},${y}`) || 0) + 1);
  const max = Math.max(1, ...cells.values());
  let html = '';
  for (let yi = ys.length - 1; yi >= 0; yi -= 1) {
    html += `<span class="mod-grid-y">${esc(ys[yi])}</span>`;
    for (let xi = 0; xi < xs.length; xi += 1) {
      const c = cells.get(`${xi},${yi}`) || 0;
      html += `<span class="mod-grid-cell">${c ? `<i style="--s:${(0.35 + 0.65 * (c / max)).toFixed(2)}" title="${c}"></i>` : ''}</span>`;
    }
  }
  html += `<span></span>${xs.map((x) => `<span class="mod-grid-x">${esc(x)}</span>`).join('')}`;
  return `<div class="mod-grid-wrap">
    <span class="mod-grid-ytitle">${yTitle}</span>
    <div class="mod-grid" style="--n:${xs.length}">${html}</div>
    <span class="mod-grid-xtitle">${xTitle}</span>
  </div>`;
}

function linkSentence(r, up, down) {
  const s = strength(r);
  if (!s) return 'No clear link so far.';
  return `${capFirst(s)} link: ${r > 0 ? up : down}`;
}

function correlationsHTML(dreams) {
  const out = [];

  // 1. Sleep quality ↔ dream rating
  const p1 = dreams.map((d) => [sleepQ(d), r5(d.ratings.rating)]).filter(([a, b]) => a != null && b != null);
  let body1;
  if (p1.length < MIN_PAIRS) {
    body1 = needMore(`Needs ${MIN_PAIRS} dreams with both sleep quality and a dream rating. You have ${p1.length}.`);
  } else {
    const r = pearson(p1);
    body1 = r == null
      ? needMore('Every answer so far is the same, so there is nothing to compare yet.')
      : `<p class="mod-lead">${linkSentence(r, 'better nights tended to bring better-rated dreams.', 'better nights tended to come with lower-rated dreams.')}</p>
         ${gridHTML(p1.map(([a, b]) => [a - 1, b - 1]), ['1', '2', '3', '4', '5'], ['1', '2', '3', '4', '5'], 'Sleep quality', 'Rating')}
         ${note(`Based on ${p1.length} dreams · r = ${r.toFixed(2)}`)}`;
  }
  out.push(card('Sleep quality and dream rating', body1));

  // 2. Hours slept ↔ dream length
  const HBINS = ['<5', '5–6', '6–7', '7–8', '8–9', '9+'];
  const bin = (h) => (h < 5 ? 0 : h < 6 ? 1 : h < 7 ? 2 : h < 8 ? 3 : h < 9 ? 4 : 5);
  const p2 = dreams.map((d) => [sleepHours(d), r5(d.ratings.length)]).filter(([a, b]) => a != null && b != null);
  let body2;
  if (p2.length < MIN_PAIRS) {
    body2 = needMore(`Needs ${MIN_PAIRS} dreams with bedtime, wake time and a dream length. You have ${p2.length}.`);
  } else {
    const r = pearson(p2);
    body2 = r == null
      ? needMore('Every answer so far is the same, so there is nothing to compare yet.')
      : `<p class="mod-lead">${linkSentence(r, 'longer nights tended to bring longer dreams.', 'longer nights tended to bring shorter dreams.')}</p>
         ${gridHTML(p2.map(([h, l]) => [bin(h), l - 1]), HBINS, ['1', '2', '3', '4', '5'], 'Hours slept', 'Length')}
         ${note(`Based on ${p2.length} dreams · r = ${r.toFixed(2)}`)}`;
  }
  out.push(card('Hours slept and dream length', body2));

  // 3 + 4. Sleep quality on lucid nights / nightmare nights
  const compareSleep = (title, isA, aLabel, bLabel, hue) => {
    const a = dreams.filter(isA).map(sleepQ).filter((v) => v != null);
    const b = dreams.filter((d) => !isA(d)).map(sleepQ).filter((v) => v != null);
    if (a.length < MIN_GROUP || b.length < MIN_GROUP) {
      return card(title, needMore(`Needs sleep quality on at least ${MIN_GROUP} ${aLabel.toLowerCase()} and ${MIN_GROUP} ${bLabel.toLowerCase()}. You have ${a.length} and ${b.length}.`));
    }
    const diff = avg(a) - avg(b);
    return card(title, `
      <p class="mod-lead">${Math.abs(diff) < 0.5 ? 'About the same either way.' : `Sleep quality was ${diff > 0 ? 'higher' : 'lower'} on ${aLabel.toLowerCase()}.`}</p>
      ${barsHTML([
        { label: aLabel, value: avg(a), max: 5, text: `<b>${one(avg(a))}</b>/5`, hue },
        { label: bLabel, value: avg(b), max: 5, text: `<b>${one(avg(b))}</b>/5` },
      ])}
      ${note(`Average sleep quality · ${a.length} and ${b.length} nights`)}`);
  };
  out.push(compareSleep('Lucid nights and sleep', (d) => d.lucid, 'Lucid nights', 'Other nights', 45));
  out.push(compareSleep('Nightmares and sleep', (d) => d.kind === 'nightmare', 'Nightmare nights', 'Other nights', 8));

  // 5. Recurring ↔ linked to real life
  const answered = dreams.filter((d) => d.questions.realLife === true || d.questions.realLife === false);
  const rec = answered.filter((d) => d.recurring);
  const non = answered.filter((d) => !d.recurring);
  if (rec.length < MIN_GROUP || non.length < MIN_GROUP) {
    out.push(card('Recurring dreams and real life', needMore(`Needs the “linked to real life” answer on at least ${MIN_GROUP} recurring and ${MIN_GROUP} other dreams. You have ${rec.length} and ${non.length}.`)));
  } else {
    const a = pct(rec.filter((d) => d.questions.realLife).length, rec.length);
    const b = pct(non.filter((d) => d.questions.realLife).length, non.length);
    out.push(card('Recurring dreams and real life', `
      <p class="mod-lead">${Math.abs(a - b) < 20 ? 'Recurring dreams felt linked to real life about as often as the others.' : `Recurring dreams felt linked to real life ${a > b ? 'more' : 'less'} often than the others.`}</p>
      ${barsHTML([
        { label: 'Recurring', value: a, max: 100, text: `<b>${a}%</b>`, hue: 285 },
        { label: 'Other dreams', value: b, max: 100, text: `<b>${b}%</b>` },
      ])}
      ${note(`Share answered “yes” · ${rec.length} recurring, ${non.length} other`)}`));
  }

  // 6. Emotions that come together
  const emoPairs = topOf(pairsBy(dreams, emotionsOf), 6).filter(([, c]) => c >= 2);
  out.push(card('Emotions that come together', emoPairs.length
    ? `<ul class="mod-pairs">${emoPairs.map(([k, c]) => { const [a, b] = k.split('\u0000'); return `<li><span>${esc(capFirst(a))} <i>+</i> ${esc(capFirst(b))}</span><b>${plural(c, 'dream')}</b></li>`; }).join('')}</ul>`
    : needMore('No two tagged emotions have shared more than one dream yet.')));

  // 7. Symbols and feelings
  const sf = new Map();
  for (const d of dreams) {
    const emos = emotionsOf(d);
    for (const s of symbolsOf(d).slice(0, 12)) for (const e of emos) {
      const k = `${s.name}\u0000${e}`;
      sf.set(k, (sf.get(k) || 0) + 1);
    }
  }
  const sfTop = topOf(sf, 6).filter(([, c]) => c >= 2);
  out.push(card('Symbols and the feelings they bring', sfTop.length
    ? `<ul class="mod-pairs">${sfTop.map(([k, c]) => { const [a, b] = k.split('\u0000'); return `<li><span>${esc(capFirst(a))} <i>→</i> ${esc(b)}</span><b>${plural(c, 'dream')}</b></li>`; }).join('')}</ul>`
    : needMore('No symbol and emotion have appeared together in more than one dream yet. Tag both in your dreams to see links here.')));

  return `<p class="mod-intro">Findings appear only when there is enough data to say something. A link is not proof that one thing causes the other.</p>${out.join('')}`;
}

// ---- Symbols: map and collection ----

/** Index of tagged symbols: key → { key, cat, label, dreams[] } */
function symbolIndex(dreams) {
  const idx = new Map();
  for (const d of dreams) for (const s of symbolsOf(d)) {
    if (!idx.has(s.key)) idx.set(s.key, { key: s.key, cat: s.cat, label: s.label || s.name, dreams: [] });
    idx.get(s.key).dreams.push(d);
  }
  return idx;
}

function symbolsMapHTML(dreams, items) {
  const idx = symbolIndex(dreams);
  for (const [k, v] of idx) items.set(k, v);
  const spottedIdx = new Map();
  for (const d of dreams) for (const t of new Set(d.tags || [])) {
    if (TAGS[t]?.kind !== 'symbol') continue;
    const key = `spotted:${t}`;
    if (!spottedIdx.has(key)) spottedIdx.set(key, { key, label: TAGS[t].label, hue: TAGS[t].hue, dreams: [] });
    spottedIdx.get(key).dreams.push(d);
  }
  for (const [k, v] of spottedIdx) items.set(k, v);

  const max = Math.max(1, ...[...idx.values(), ...spottedIdx.values()].map((x) => x.dreams.length));
  const chip = (x, hue) => {
    const t = max === 1 ? 0 : (x.dreams.length - 1) / (max - 1);
    return `<button type="button" class="mod-sym" data-item="${esc(x.key)}" aria-expanded="false" style="--hue:${hue};font-size:${(13 + t * 10).toFixed(1)}px">${esc(x.label)}<b>${x.dreams.length}</b></button>`;
  };
  const sortFn = (a, b) => b.dreams.length - a.dreams.length || a.label.localeCompare(b.label);

  const groups = SYMBOL_CATEGORIES.map((cat) => {
    const list = [...idx.values()].filter((x) => x.cat === cat).sort(sortFn);
    if (!list.length) return '';
    return `<section class="mod-card glass" data-detail-host>
      <h2 class="mod-card-title" style="--hue:${CATEGORY[cat].hue}"><i class="mod-dot"></i>${CATEGORY[cat].label} <span class="mod-count">${list.length}</span></h2>
      <div class="mod-cloud">${list.map((x) => chip(x, CATEGORY[cat].hue)).join('')}</div>
      <div class="mod-detail" hidden></div>
    </section>`;
  }).join('');

  const spottedList = [...spottedIdx.values()].sort(sortFn);
  const spottedCard = spottedList.length ? `<section class="mod-card glass" data-detail-host>
      <h2 class="mod-card-title"><i class="mod-dot"></i>Spotted in your writing <span class="mod-count">${spottedList.length}</span></h2>
      <div class="mod-cloud">${spottedList.map((x) => chip(x, x.hue)).join('')}</div>
      ${note('Found automatically in the text of your dreams, separate from the symbols you tagged.')}
      <div class="mod-detail" hidden></div>
    </section>` : '';

  const pairs = topOf(pairsBy(dreams, (d) => symbolsOf(d).map((s) => s.key)), 6).filter(([, c]) => c >= 2);
  const together = idx.size ? card('Often together', pairs.length
    ? `<ul class="mod-pairs">${pairs.map(([k, c]) => {
        const [a, b] = k.split('\u0000').map((x) => idx.get(x)?.label || x);
        return `<li><span>${esc(a)} <i>+</i> ${esc(b)}</span><b>${plural(c, 'dream')}</b></li>`;
      }).join('')}</ul>`
    : needMore('No two symbols have shared more than one dream yet.')) : '';

  if (!idx.size && !spottedIdx.size) {
    return card('', needMore('No symbols yet. Add people, places, objects and more in a dream’s Symbols tab, and your map grows here.'));
  }
  return `<p class="mod-intro">${idx.size ? `${plural(idx.size, 'symbol')} tagged across your dreams. Bigger means more frequent.` : 'You have not tagged any symbols yet. A dream’s Symbols tab is where to add them.'} Tap one to see its dreams.</p>
    ${groups}${together}${spottedCard}`;
}

function rowsHTML(list, hueFor) {
  const max = Math.max(1, ...list.map((x) => x.dreams.length));
  return `<div class="mod-rows">${list.map((x) => `
    <div class="mod-row-host" data-detail-host>
      <button type="button" class="mod-row" data-item="${esc(x.key)}" aria-expanded="false" style="--hue:${hueFor(x)}">
        <span class="mod-row-name">${esc(capFirst(x.label))}</span>
        <span class="mod-row-track"><span class="mod-row-bar" style="width:${((x.dreams.length / max) * 100).toFixed(1)}%"></span></span>
        <span class="mod-row-n">${x.dreams.length}</span>
      </button>
      <div class="mod-detail" hidden></div>
    </div>`).join('')}</div>`;
}

function symbolsCollectionHTML(dreams, items) {
  const idx = symbolIndex(dreams);
  for (const [k, v] of idx) items.set(k, v);
  if (!idx.size) return card('', needMore('Your collection is empty. When you add people, places, objects, characters, themes or actions to a dream, each new one is collected here.'));
  const sortFn = (a, b) => b.dreams.length - a.dreams.length || a.label.localeCompare(b.label);
  return `<p class="mod-intro">${plural(idx.size, 'different symbol')} collected. Tap one to see its dreams.</p>` + SYMBOL_CATEGORIES.map((cat) => {
    const list = [...idx.values()].filter((x) => x.cat === cat).sort(sortFn);
    return list.length ? `<p class="mod-sub mod-sub-out">${CATEGORY[cat].label} · ${list.length}</p>${card('', rowsHTML(list, () => CATEGORY[cat].hue))}` : '';
  }).join('');
}

function emotionsCollectionHTML(dreams, items) {
  const idx = new Map();
  for (const d of dreams) for (const raw of new Set(d.emotions || [])) {
    const name = norm(raw);
    if (!name) continue;
    const key = `emotion:${name}`;
    if (!idx.has(key)) idx.set(key, { key, label: String(raw).trim(), dreams: [] });
    if (!idx.get(key).dreams.includes(d)) idx.get(key).dreams.push(d);
  }
  for (const [k, v] of idx) items.set(k, v);
  if (!idx.size) return card('', needMore('No emotions collected yet. Pick how a dream felt in its details and each new emotion is collected here.'));
  const list = [...idx.values()].sort((a, b) => b.dreams.length - a.dreams.length || a.label.localeCompare(b.label));
  const hue = (x) => TAGS[norm(x.label)]?.hue ?? 265;
  return `<p class="mod-intro">${plural(idx.size, 'different emotion')} collected. Tap one to see its dreams.</p>${card('', rowsHTML(list, hue))}`;
}

// ---- Locked and unknown routes ----

function lockedHTML(mod, count) {
  const info = MODULE_INFO[mod.id];
  return `<section class="mod-card glass mod-lock">
    <div class="mod-lock-icon">${info.icon}<span class="mod-lock-badge">${icons.lock}</span></div>
    ${mod.isNext ? '<p class="mod-lock-next">Next unlock</p>' : ''}
    <h2 class="mod-lock-title">Opens at ${plural(mod.unlockAt, 'dream')}</h2>
    <p class="mod-lead mod-center">You have recorded ${plural(count, 'dream')}. ${plural(mod.toGo, 'more dream')} to go.</p>
    <span class="mod-lock-bar"><i style="width:${Math.min(100, (count / mod.unlockAt) * 100).toFixed(1)}%"></i></span>
    <p class="mod-lock-about">${esc(info.about)}</p>
    <a class="btn" href="#record">${icons.plus}<span>Record a dream</span></a>
  </section>`;
}

// ---- Screen ----

const TITLES = { symbols: 'Symbols', emotions: 'Emotions' };
const BUILDERS = { statistics: statisticsHTML, trends: trendsHTML, nightmares: nightmaresHTML, correlations: correlationsHTML, 'symbols-map': symbolsMapHTML };

export default {
  id: 'module',
  hideTabbar: true,

  render(el, ctx, param) {
    const id = String(param || '').split('/')[0];
    const dreams = loadDreams();
    const items = new Map(); // tappable symbols / emotions → their dreams
    const mod = unlockState(MODULES, listDreams().length).find((m) => m.id === id);
    let title;
    let body;

    if (id === 'symbols') {
      title = TITLES.symbols;
      body = symbolsCollectionHTML(dreams, items);
    } else if (id === 'emotions') {
      title = TITLES.emotions;
      body = emotionsCollectionHTML(dreams, items);
    } else if (!mod) {
      title = 'Not found';
      body = card('', `<p class="mod-lead mod-center">This page does not exist.</p><a class="btn btn-ghost" href="#insights">Back to Progress</a>`);
    } else if (!mod.unlocked || !dreams.length) {
      title = mod.name;
      body = lockedHTML(mod, listDreams().length);
    } else {
      title = mod.name;
      markSeen(`module:${id}`);
      body = BUILDERS[id](dreams, items);
    }

    el.innerHTML = `
      <div class="mod">
        <header class="screen-header">
          <button class="icon-btn" type="button" data-back aria-label="Back">${icons.back}</button>
          <h1 class="screen-title">${esc(title)}</h1>
          ${mod && MODULE_INFO[id] ? `<span class="mod-head-icon">${MODULE_INFO[id].icon}</span>` : ''}
        </header>
        ${body}
      </div>`;

    const root = el.querySelector('.mod');
    root.querySelector('[data-back]').addEventListener('click', () => ctx.back());

    // Tap a symbol or emotion: list the dreams that contain it, right below it.
    root.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-item]');
      if (!btn) return;
      const panel = btn.closest('[data-detail-host]')?.querySelector('.mod-detail');
      if (!panel) return;
      const wasOpen = btn.getAttribute('aria-expanded') === 'true';
      for (const b of root.querySelectorAll('[data-item][aria-expanded="true"]')) b.setAttribute('aria-expanded', 'false');
      for (const p of root.querySelectorAll('.mod-detail')) { p.hidden = true; p.innerHTML = ''; }
      const item = items.get(btn.dataset.item);
      if (wasOpen || !item) return;
      btn.setAttribute('aria-expanded', 'true');
      panel.innerHTML = `<p class="mod-detail-title">${esc(capFirst(item.label))} · ${plural(item.dreams.length, 'dream')}</p>${dreamLinks(item.dreams)}`;
      panel.hidden = false;
    });
  },
};
