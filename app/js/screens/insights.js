// Progress tab: the dreamer's level, how often they remember (recall chart), what they have collected,
// and the analysis modules that open up as the journal grows. Thresholds and levels come from progress.js.
import { listDreams, getStats, getProfile, collection, recallByDay, isSeen, markSeen } from '../store.js';
import { LEVELS, MODULES, levelFor, unlockState } from '../progress.js';
import { esc, icons } from '../ui.js';
import { MODULE_INFO, MOD_ICONS } from './module.js';

const DAY = 86400000;
let period = 'M'; // recall chart: 'W' | 'M' | 'Y' (kept while the app is open)

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// ---- Orb: a small night sky. One star per dream; the moon fills in as the level rises; the ring shows the way
// to the next level. ----

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function orbHTML(total, lv) {
  const R = 92;
  const C = 2 * Math.PI * R;
  const p = Math.max(0, Math.min(1, lv.progress));
  const ang = (-90 + p * 360) * (Math.PI / 180);
  const ex = 100 + R * Math.cos(ang);
  const ey = 100 + R * Math.sin(ang);

  // Stars sit at fixed places, so the sky keeps its shape and only gains stars.
  const rand = rng(20261110);
  const stars = [];
  for (let i = 0; stars.length < Math.min(total, 60) && i < 600; i += 1) {
    const a = rand() * Math.PI * 2;
    const d = Math.sqrt(rand()) * 64;
    const x = 100 + d * Math.cos(a);
    const y = 100 + d * Math.sin(a);
    const size = 0.6 + rand() * 1.1;
    if (Math.hypot(x - 100, y - 96) < 32) continue; // keep the moon clear
    stars.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${size.toFixed(2)}" style="--d:${(rand() * 4).toFixed(2)}s"/>`);
  }

  // Moon phase: a thin crescent at level 1, full at the top level.
  const lit = (lv.level - 1) / Math.max(1, LEVELS.length - 1);
  const mr = 22;
  const shadow = lit >= 1 ? '' : `<circle cx="${(100 + mr * (0.5 + 1.55 * lit)).toFixed(1)}" cy="92" r="${mr}" fill="#000"/>`;

  return `
    <div class="ins-orb" role="img" aria-label="Level ${lv.level}, ${Math.round(p * 100)}% of the way to the next level">
      <svg viewBox="0 0 200 200" aria-hidden="true">
        <defs>
          <radialGradient id="ins-sky" cx="50%" cy="38%" r="65%">
            <stop offset="0" stop-color="#3a2a86"/>
            <stop offset="0.65" stop-color="#1b1350"/>
            <stop offset="1" stop-color="#0d0928"/>
          </radialGradient>
          <linearGradient id="ins-arc" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="#ffd98a"/>
            <stop offset="1" stop-color="#c79bff"/>
          </linearGradient>
          <radialGradient id="ins-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0" stop-color="rgba(255,217,138,0.45)"/>
            <stop offset="1" stop-color="rgba(255,217,138,0)"/>
          </radialGradient>
          <clipPath id="ins-sky-clip"><circle cx="100" cy="100" r="74"/></clipPath>
          <mask id="ins-moon-mask"><rect width="200" height="200" fill="#fff"/>${shadow}</mask>
        </defs>
        <circle cx="100" cy="100" r="${R}" class="ins-orb-track"/>
        <circle cx="100" cy="100" r="${R}" class="ins-orb-arc" stroke="url(#ins-arc)"
          style="--c:${C.toFixed(1)};stroke-dasharray:${C.toFixed(1)};stroke-dashoffset:${(C * (1 - p)).toFixed(1)}"
          transform="rotate(-90 100 100)"/>
        <circle cx="100" cy="100" r="74" fill="url(#ins-sky)" class="ins-orb-sky"/>
        <g clip-path="url(#ins-sky-clip)">
        <g class="ins-orb-stars">${stars.join('')}</g>
        <circle cx="100" cy="92" r="44" fill="url(#ins-glow)" class="ins-orb-glow" style="opacity:${(0.35 + 0.65 * lit).toFixed(2)}"/>
        <circle cx="100" cy="92" r="${mr}" class="ins-orb-moonbase"/>
        <circle cx="100" cy="92" r="${mr}" class="ins-orb-moon" mask="url(#ins-moon-mask)"/>
        <path d="M34 134 Q100 116 166 134 L166 160 Q100 190 34 160 Z" class="ins-orb-hill"/>
        </g>
        <circle cx="100" cy="${100 - R}" r="4.5" class="ins-orb-start"/>
        ${p > 0 && p < 1 ? `<circle cx="${ex.toFixed(1)}" cy="${ey.toFixed(1)}" r="3.6" class="ins-orb-end"/>` : ''}
      </svg>
    </div>`;
}

function headerHTML(total, lv) {
  const name = String(getProfile().name || '').trim() || 'Dreamer';
  const toNext = lv.nextMin != null ? lv.nextMin - total : 0;
  return `
    <header class="ins-head">
      ${orbHTML(total, lv)}
      <h1 class="ins-name">${esc(name)}</h1>
      <p class="ins-count">${plural(total, 'dream')}</p>
      <span class="ins-level">${icons.star}<span>Level ${lv.level} · ${esc(lv.name)}</span></span>
      <p class="ins-next">${lv.nextMin != null
        ? `<b>${toNext}</b> ${toNext === 1 ? 'dream' : 'dreams'} to the next level · ${esc(lv.nextName)}`
        : 'Highest level reached. Every dream still adds a star.'}</p>
    </header>`;
}

// ---- Recall chart ----

function recallModel(mode) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (mode === 'W') {
    const idx = (today.getDay() + 6) % 7; // Monday = 0
    const days = recallByDay(idx + 1);
    const bars = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(today);
      d.setDate(today.getDate() - idx + i);
      return {
        label: d.toLocaleDateString(undefined, { weekday: 'narrow' }),
        count: days[i]?.count || 0,
        future: i > idx,
        current: i === idx,
        title: d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' }),
      };
    });
    return { heading: 'This week', when: 'this week', bars, values: true };
  }

  if (mode === 'Y') {
    const start = new Date(today.getFullYear(), today.getMonth() - 11, 1);
    const days = recallByDay(Math.round((today - start) / DAY) + 1);
    const byMonth = new Map();
    for (const r of days) byMonth.set(r.date.slice(0, 7), (byMonth.get(r.date.slice(0, 7)) || 0) + r.count);
    const bars = Array.from({ length: 12 }, (_, i) => {
      const m = new Date(today.getFullYear(), today.getMonth() - 11 + i, 1);
      const key = `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}`;
      return {
        label: m.toLocaleDateString(undefined, { month: 'narrow' }),
        count: byMonth.get(key) || 0,
        future: false,
        current: i === 11,
        title: m.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
      };
    });
    return { heading: 'Past 12 months', when: 'in the past 12 months', bars, values: true };
  }

  const dim = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  const days = recallByDay(today.getDate());
  const bars = Array.from({ length: dim }, (_, i) => ({
    label: [0, 7, 14, 21, 28].includes(i) ? String(i + 1) : '',
    count: days[i]?.count || 0,
    future: i + 1 > today.getDate(),
    current: i + 1 === today.getDate(),
    title: new Date(today.getFullYear(), today.getMonth(), i + 1).toLocaleDateString(undefined, { day: 'numeric', month: 'long' }),
  }));
  const month = today.toLocaleDateString(undefined, { month: 'long' });
  return { heading: month, when: `in ${month}`, bars, values: false };
}

function recallHTML() {
  const m = recallModel(period);
  const total = m.bars.reduce((s, b) => s + b.count, 0);
  const max = Math.max(1, ...m.bars.map((b) => b.count));
  const nights = m.bars.filter((b) => b.count).length;
  const cols = m.bars.map((b) => {
    const h = b.count ? Math.max(8, (b.count / max) * 100) : 0;
    return `
      <div class="ins-col${b.current ? ' is-now' : ''}${b.future ? ' is-future' : ''}" title="${esc(b.title)}: ${plural(b.count, 'dream')}">
        <span class="ins-col-area">
          ${b.count
            ? `<span class="ins-col-bar" style="height:${h.toFixed(1)}%">${m.values ? `<span class="ins-col-val">${b.count}</span>` : ''}</span>`
            : '<span class="ins-col-ghost"></span>'}
        </span>
        <span class="ins-col-label">${esc(b.label)}</span>
      </div>`;
  }).join('');

  return `
    <div class="ins-recall-head">
      <h2 class="ins-recall-title">Recall <span aria-hidden="true">·</span> ${esc(m.heading)}</h2>
      <div class="ins-switch" role="group" aria-label="Chart period">
        ${[['W', 'Week'], ['M', 'Month'], ['Y', 'Year']].map(([k, label]) => `<button type="button" data-period="${k}" aria-pressed="${period === k}" aria-label="${label}">${k}</button>`).join('')}
      </div>
    </div>
    <p class="ins-recall-sum">${total
      ? `<b>${plural(total, 'dream')}</b> ${m.when}${period === 'W' ? '' : ` · ${plural(nights, period === 'Y' ? 'active month' : 'night')}`}`
      : `No dreams ${m.when} yet`}</p>
    <div class="ins-chart ins-chart-${period}" style="--n:${m.bars.length}">
      ${cols}
      ${total ? '' : '<p class="ins-chart-empty">Write down what you remember each morning and your recall builds up here.</p>'}
    </div>`;
}

// ---- Collection ----

function collectionHTML() {
  const c = collection();
  const s = getStats();
  const cardHTML = (href, icon, name, n) => `
    <a class="ins-coll-card glass" href="${href}">
      <span class="ins-coll-icon">${icon}</span>
      <span class="ins-coll-arrow">${MOD_ICONS.arrow}</span>
      <span class="ins-coll-name">${name}</span>
      <span class="ins-coll-count">${n}</span>
    </a>`;
  const tally = (n, label) => `<div class="ins-tally"><b>${n}</b><span>${label}</span></div>`;
  return `
    <h2 class="section-title">Collection</h2>
    <div class="ins-coll">
      ${cardHTML('#module/symbols', MOD_ICONS.shapes, 'Symbols', c.symbols)}
      ${cardHTML('#module/emotions', MOD_ICONS.masks, 'Emotions', c.emotions)}
    </div>
    <div class="ins-tallies glass">
      ${tally(s.total, s.total === 1 ? 'Dream' : 'Dreams')}
      ${tally(s.lucid, 'Lucid')}
      ${tally(s.nightmares, s.nightmares === 1 ? 'Nightmare' : 'Nightmares')}
      ${tally(s.streak, 'Streak')}
    </div>`;
}

// ---- Analysis modules ----

function analysisHTML(total) {
  const cards = unlockState(MODULES, total).map((m) => {
    const info = MODULE_INFO[m.id];
    const wide = m.id === 'symbols-map' ? ' ins-mod-wide' : '';
    if (m.unlocked) {
      const fresh = !isSeen(`module:${m.id}`);
      return `
        <a class="ins-mod glass ins-mod-open${wide}" href="#module/${m.id}">
          <span class="ins-mod-top"><span class="ins-mod-icon">${info.icon}</span>${fresh ? '<span class="ins-mod-new">New</span>' : `<span class="ins-mod-go">${MOD_ICONS.arrow}</span>`}</span>
          <span class="ins-mod-name">${esc(m.name)}</span>
          <span class="ins-mod-blurb">${esc(info.blurb)}</span>
        </a>`;
    }
    if (m.isNext) {
      return `
        <a class="ins-mod glass ins-mod-next${wide}" href="#module/${m.id}" aria-label="${esc(m.name)}: next unlock, ${plural(m.toGo, 'dream')} to go">
          <span class="ins-mod-top"><span class="ins-mod-icon">${info.icon}</span><span class="ins-mod-togo"><b>${m.toGo}</b><small>to go</small></span></span>
          <span class="ins-mod-tag">Next unlock</span>
          <span class="ins-mod-name">${esc(m.name)}</span>
          <span class="ins-mod-bar"><i style="width:${(m.progress * 100).toFixed(1)}%"></i></span>
        </a>`;
    }
    return `
      <a class="ins-mod glass ins-mod-locked${wide}" href="#module/${m.id}" aria-label="${esc(m.name)}: opens at ${plural(m.unlockAt, 'dream')}">
        <span class="ins-mod-top"><span class="ins-mod-icon">${info.icon}</span><span class="ins-mod-badge">${icons.lock}${m.unlockAt}</span></span>
        <span class="ins-mod-name">${esc(m.name)}</span>
        <span class="ins-mod-blurb">${esc(info.blurb)}</span>
      </a>`;
  }).join('');
  return `
    <h2 class="section-title">Analysis</h2>
    <div class="ins-mods">${cards}</div>
    <p class="ins-foot">Each analysis opens as your journal grows, and works only with the dreams on this phone.</p>`;
}

// ---- Screen ----

export default {
  id: 'insights',
  label: 'Progress',
  icon: icons.progress,

  // A dot on the tab while a newly opened analysis has not been seen on this tab yet.
  badge() {
    const n = listDreams().length;
    return MODULES.some((m) => n >= m.unlockAt && !isSeen(`progress:${m.id}`));
  },

  render(el) {
    const total = listDreams().length;
    const lv = levelFor(total);

    el.innerHTML = `
      <div class="ins">
        ${headerHTML(total, lv)}
        <section class="ins-recall glass">${recallHTML()}</section>
        ${collectionHTML()}
        ${analysisHTML(total)}
      </div>`;

    // Visiting the tab clears its dot; each card keeps its "New" tag until the analysis is opened.
    for (const m of MODULES) if (total >= m.unlockAt) markSeen(`progress:${m.id}`);
    document.querySelector('#tabbar .tab[data-id="insights"] .tab-dot')?.remove();

    const recall = el.querySelector('.ins-recall');
    recall.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-period]');
      if (!btn || btn.dataset.period === period) return;
      period = btn.dataset.period;
      recall.innerHTML = recallHTML();
    });
  },
};
