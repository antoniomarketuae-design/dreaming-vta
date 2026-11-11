// Journal view (new layout): the constellation sky. Every dream is a star; dreams that share a symbol are joined by
// thin lines, so the themes that keep coming back form constellations (the six biggest are drawn and named).
// Newer dreams shine brighter, analyzed ones are a little bigger, nightmares glow peach and lucid dreams sparkle gold.
// Tap a star for its dream (a card above the view switcher), a constellation's name or chip to pick it out from the
// rest, empty sky to clear. Deterministic: the same dreams always draw the same sky (positions seeded from dream ids).
// One SVG, drawn once per render; nothing runs per frame except an optional CSS twinkle.
import { symbolsOf, dreamDay, dreamType, DREAM_TYPES } from '../../../symbols.js';
import { dreamArtURL } from '../../../dreamart.js';
import { hasVideo } from '../../../videos.js';
import { esc, relativeDay, icons } from '../../../ui.js';

const MAX_GROUPS = 6;
// One colour per constellation, all soft so they sit on the night sky (gold first, like the Home wheel).
const COLORS = ['#ffd98a', '#c3adff', '#ff9f8f', '#8fe3cf', '#9cc6ff', '#f4a6d7'];
// Where each constellation gathers, as fractions of the sky, spread out so they don't pile up.
const ANCHORS = [[0.3, 0.2], [0.72, 0.36], [0.28, 0.54], [0.7, 0.7], [0.34, 0.86], [0.7, 0.1]];
const HIT_R = 17; // invisible tap circle around each star (34px across)

const f1 = (v) => Math.round(v * 10) / 10;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const plural = (n, word) => `${n} ${n === 1 ? word : `${word}s`}`;
const titleOf = (d) => String(d?.title || '').trim() || 'Untitled dream';

// relativeDay() from ui.js with one shared date formatter: formatting hundreds of dates one by one is slow.
function dayLabeller() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const cache = new Map();
  let fmt = null;
  return (isoDay) => {
    if (!isoDay) return '';
    let out = cache.get(isoDay);
    if (out !== undefined) return out;
    const date = new Date(`${isoDay}T00:00:00`);
    const days = Math.round((today - date) / 86400000);
    if (Number.isNaN(days)) out = '';
    else if (days === 0) out = 'Today';
    else if (days === 1) out = 'Yesterday';
    else if (days > 1 && days < 7) out = `${days} days ago`;
    else {
      try {
        fmt = fmt || new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
        out = fmt.format(date);
      } catch { out = relativeDay(isoDay); }
    }
    cache.set(isoDay, out);
    return out;
  };
}

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// Small seeded random generator (mulberry32): the same seed gives the same numbers.
function rng(seed) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- Layout ----------

// Push stars apart until no two are closer than `gap` (a grid keeps it fast for hundreds of stars).
function relax(pts, W, H, pad, gap) {
  const keep = (p) => { p.x = clamp(p.x, pad, W - pad); p.y = clamp(p.y, pad, H - pad); };
  pts.forEach(keep);
  const g2 = (gap - 0.5) * (gap - 0.5); // a hair of slack, so it settles instead of nudging forever
  for (let it = 0; it < 160; it += 1) {
    const grid = new Map();
    pts.forEach((p, i) => {
      const k = Math.floor(p.x / gap) * 8192 + Math.floor(p.y / gap);
      const cell = grid.get(k);
      if (cell) cell.push(i); else grid.set(k, [i]);
    });
    let moved = false;
    for (let i = 0; i < pts.length; i += 1) {
      const p = pts[i];
      const cx = Math.floor(p.x / gap);
      const cy = Math.floor(p.y / gap);
      for (let gx = cx - 1; gx <= cx + 1; gx += 1) {
        for (let gy = cy - 1; gy <= cy + 1; gy += 1) {
          const cell = grid.get(gx * 8192 + gy);
          if (!cell) continue;
          for (const j of cell) {
            if (j <= i) continue;
            const q = pts[j];
            let dx = q.x - p.x;
            let dy = q.y - p.y;
            const d2 = dx * dx + dy * dy;
            if (d2 >= g2) continue;
            let d = Math.sqrt(d2);
            if (d < 0.01) { // on top of each other: part them in a fixed direction
              const a = (i * 2.399 + j * 0.7) % (Math.PI * 2);
              dx = Math.cos(a); dy = Math.sin(a); d = 1;
            }
            const push = ((gap + 0.5 - d) / 2) / d;
            p.x -= dx * push; p.y -= dy * push;
            q.x += dx * push; q.y += dy * push;
            moved = true;
          }
        }
      }
    }
    pts.forEach(keep);
    if (!moved) break;
  }
}

// Minimum spanning tree (Prim) over a few points: the fewest, shortest lines that join them all.
function spanningTree(points) {
  const k = points.length;
  if (k < 2) return [];
  const inTree = new Uint8Array(k);
  const best = new Float64Array(k).fill(Infinity);
  const from = new Int32Array(k).fill(-1);
  best[0] = 0;
  const edges = [];
  for (let step = 0; step < k; step += 1) {
    let u = -1;
    for (let v = 0; v < k; v += 1) if (!inTree[v] && (u < 0 || best[v] < best[u])) u = v;
    inTree[u] = 1;
    if (from[u] >= 0) edges.push([from[u], u]);
    for (let v = 0; v < k; v += 1) {
      if (inTree[v]) continue;
      const dx = points[v].x - points[u].x;
      const dy = points[v].y - points[u].y;
      const d = dx * dx + dy * dy;
      if (d < best[v]) { best[v] = d; from[v] = u; }
    }
  }
  return edges;
}

// Put each constellation's name near its middle, where it covers the fewest stars and no other name.
function placeLabels(groups, stars, W, H) {
  const placed = [];
  for (const g of groups) {
    const members = g.idx.map((i) => stars[i]);
    const cx = members.reduce((s, p) => s + p.x, 0) / members.length;
    const cy = members.reduce((s, p) => s + p.y, 0) / members.length;
    const name = g.name.length > 16 ? `${g.name.slice(0, 15)}…` : g.name;
    const text = name.toUpperCase();
    const w = Math.round(text.length * 8.2 + 10);
    const h = 16;
    let best = null;
    for (const rad of [0, 16, 28, 42, 58]) {
      for (let a = 0; a < (rad ? 8 : 1); a += 1) {
        const ang = Math.PI / 2 + (a * Math.PI) / 4;
        const x = clamp(cx + Math.cos(ang) * rad * 1.5, w / 2 + 10, W - w / 2 - 10);
        const y = clamp(cy + Math.sin(ang) * rad, h / 2 + 12, H - h / 2 - 12);
        const L = x - w / 2;
        const T = y - h / 2;
        let near = 18;
        for (const s of stars) {
          const ex = Math.max(L - s.x, 0, s.x - (L + w));
          const ey = Math.max(T - s.y, 0, s.y - (T + h));
          const dd = Math.hypot(ex, ey) - s.r;
          if (dd < near) near = dd;
        }
        let score = near * 3 - Math.hypot(x - cx, y - cy) * 0.12;
        for (const p of placed) {
          if (L < p.L + p.w + 6 && L + w + 6 > p.L && T < p.T + p.h + 10 && T + h + 10 > p.T) score -= 500;
        }
        if (!best || score > best.score) best = { score, x, y, L, T, w, h, text };
      }
    }
    placed.push(best);
    g.label = { x: best.x, y: best.y, w: best.w, h: best.h, text: best.text };
  }
}

function layout(dreams, W) {
  const n = dreams.length;
  const gap = n <= 40 ? 44 : n <= 120 ? 38 : 34; // nearest two stars may come
  const pad = 26;
  const H = Math.max(Math.round(W * 1.3), Math.round((n * gap * gap * 1.25) / (W - 2 * pad)) + 2 * pad);

  // Symbols shared by at least two dreams; the biggest few become constellations.
  const bySym = new Map();
  const symsOf = dreams.map((d, i) => {
    let list = [];
    try { list = symbolsOf(d); } catch {}
    for (const s of list) {
      let g = bySym.get(s.key);
      if (!g) bySym.set(s.key, (g = { key: s.key, name: s.name, idx: [], meaning: '' }));
      if (g.idx[g.idx.length - 1] !== i) g.idx.push(i);
      if (!g.meaning && s.meaning) g.meaning = s.meaning;
    }
    return list;
  });
  const groups = [...bySym.values()]
    .filter((g) => g.idx.length >= 2)
    .sort((a, b) => b.idx.length - a.idx.length || a.name.localeCompare(b.name))
    .slice(0, MAX_GROUPS);
  const turn = hash(groups.map((g) => g.key).join('|')) % ANCHORS.length;
  groups.forEach((g, j) => {
    const [fx, fy] = ANCHORS[(j + turn) % ANCHORS.length];
    g.color = COLORS[j];
    g.ax = pad + fx * (W - 2 * pad);
    g.ay = pad + fy * (H - 2 * pad);
  });
  const memberOf = dreams.map(() => []);
  groups.forEach((g, j) => g.idx.forEach((i) => memberOf[i].push(j)));

  // Seeded start positions: loose stars anywhere, constellation stars around their constellation's anchor.
  const stars = dreams.map((d, i) => {
    const r = rng(hash(`sky:${d.id ?? i}`));
    const ux = r(), uy = r(), ua = r() * Math.PI * 2, ur = Math.sqrt(r()), tw = r();
    let x = pad + ux * (W - 2 * pad);
    let y = pad + uy * (H - 2 * pad);
    if (memberOf[i].length) {
      let ax = 0, ay = 0, R = 0;
      for (const j of memberOf[i]) {
        ax += groups[j].ax; ay += groups[j].ay;
        R = Math.max(R, gap * Math.sqrt(groups[j].idx.length) * 0.62);
      }
      x = ax / memberOf[i].length + Math.cos(ua) * ur * R;
      y = ay / memberOf[i].length + Math.sin(ua) * ur * R;
    }
    const fresh = n > 1 ? 1 - i / (n - 1) : 1; // 1 newest … 0 oldest
    const done = d?.interpretation?.status === 'done';
    return {
      d, i, x, y, tw,
      type: dreamType(d),
      done,
      r: 1.4 + 2.4 * Math.pow(fresh, 1.4) + (done ? 0.9 : 0),
      op: 0.5 + 0.5 * Math.pow(fresh, 0.8),
      syms: symsOf[i],
      groups: memberOf[i],
    };
  });
  relax(stars, W, H, pad, gap);
  for (const g of groups) {
    const pts = g.idx.map((i) => stars[i]);
    g.edges = spanningTree(pts).map(([a, b]) => [pts[a], pts[b]]);
  }
  placeLabels(groups, stars, W, H);
  return { W, H, pad, stars, groups };
}

// ---------- Drawing ----------

const dot = (x, y, r) => `M${f1(x - r)} ${f1(y)}a${r} ${r} 0 1 0 ${f1(r * 2)} 0a${r} ${r} 0 1 0 ${f1(-r * 2)} 0`;
const sparkle = (a) => `M0 ${f1(-a)}Q0 0 ${f1(a)} 0Q0 0 0 ${f1(a)}Q0 0 ${f1(-a)} 0Q0 0 0 ${f1(-a)}Z`;

// Thin gold frame with tick marks, a ring pair and an ecliptic: the star-chart look of the Home wheel.
function chartSVG(W, H) {
  const ticks = [];
  for (let y = 22, k = 1; y < H - 14; y += 22, k += 1) {
    const len = k % 5 ? 3 : 7;
    ticks.push(`M8 ${y}h${len}M${W - 8} ${y}h${-len}`);
  }
  for (let x = 22, k = 1; x < W - 14; x += 22, k += 1) {
    const len = k % 5 ? 3 : 7;
    ticks.push(`M${x} 8v${len}M${x} ${H - 8}v${-len}`);
  }
  const cx = W / 2, cy = H / 2, r1 = W * 0.36, r2 = W * 0.48;
  const ring = [];
  for (let k = 0; k < 48; k += 1) {
    const a = (k / 48) * Math.PI * 2;
    const len = k % 4 ? 3 : 6;
    ring.push(`M${f1(cx + Math.sin(a) * r2)} ${f1(cy - Math.cos(a) * r2)}L${f1(cx + Math.sin(a) * (r2 - len))} ${f1(cy - Math.cos(a) * (r2 - len))}`);
  }
  const eY = Math.min(H * 0.22, W * 0.5);
  return `
    <g class="bv-sky-chart">
      <rect class="bv-sky-edge" x="8" y="8" width="${W - 16}" height="${H - 16}" rx="16"/>
      <path class="bv-sky-ticks" d="${ticks.join('')}"/>
      <circle class="bv-sky-ring" cx="${f1(cx)}" cy="${f1(cy)}" r="${f1(r1)}"/>
      <circle class="bv-sky-ring is-dash" cx="${f1(cx)}" cy="${f1(cy)}" r="${f1(r2)}"/>
      <path class="bv-sky-ticks" d="${ring.join('')}"/>
      <path class="bv-sky-ring is-dash" d="M8 ${f1(eY + 30)}Q${f1(W / 2)} ${f1(eY - 40)} ${W - 8} ${f1(eY + 10)}"/>
    </g>`;
}

// Hundreds of faint tiny stars, merged into three paths (cheap to draw), plus a few that twinkle.
function dustSVG(W, H) {
  const rnd = rng(hash(`dust:${W}x${H}`));
  const count = Math.min(420, Math.round((W * H) / 1100));
  const paths = ['', '', ''];
  const sizes = [0.45, 0.7, 1];
  for (let k = 0; k < count; k += 1) {
    const x = rnd() * W, y = rnd() * H, v = rnd();
    const b = v < 0.62 ? 0 : v < 0.9 ? 1 : 2;
    paths[b] += dot(x, y, sizes[b]);
  }
  const tw = [];
  const twCount = Math.min(30, Math.round(count / 10));
  for (let k = 0; k < twCount; k += 1) {
    const x = f1(rnd() * W), y = f1(rnd() * H), r = f1(0.8 + rnd() * 0.5);
    tw.push(`<circle class="bv-sky-twk" cx="${x}" cy="${y}" r="${r}" style="animation-duration:${f1(3 + rnd() * 4)}s;animation-delay:-${f1(rnd() * 6)}s"/>`);
  }
  return `
    <g class="bv-sky-dust">
      <path d="${paths[0]}" opacity="0.22"/><path d="${paths[1]}" opacity="0.34"/><path d="${paths[2]}" opacity="0.5"/>
      ${tw.join('')}
    </g>`;
}

const GLOW = { general: 'bv-sky-gw', nightmare: 'bv-sky-gn', lucid: 'bv-sky-gl', prophetic: 'bv-sky-gp' };

function starSVG(s, twinkle) {
  const glow = f1(s.r * 3.6);
  const tw = twinkle
    ? ` class="bv-sky-glow bv-sky-twk" style="animation-duration:${f1(3.5 + s.tw * 3)}s;animation-delay:-${f1(s.tw * 5)}s"`
    : ' class="bv-sky-glow"';
  return `
    <g class="bv-sky-star is-${s.type}" transform="translate(${f1(s.x)} ${f1(s.y)})" opacity="${s.op.toFixed(2)}">
      <circle${tw} r="${glow}" fill="url(#${GLOW[s.type] || GLOW.general})"/>
      ${s.type === 'lucid' ? `<path class="bv-sky-spark" d="${sparkle(s.r * 3.3)}"/>` : ''}
      <circle class="bv-sky-core" r="${f1(s.r)}"/>
    </g>`;
}

function skySVG(sky, n) {
  const { W, H, stars, groups } = sky;
  const lines = groups.map((g, j) => `<path class="bv-sky-line" data-c="${j}" style="--c:${g.color}" d="${
    g.edges.map(([a, b]) => `M${f1(a.x)} ${f1(a.y)}L${f1(b.x)} ${f1(b.y)}`).join('')}"/>`).join('');
  const starEls = stars.map((s) => starSVG(s, s.i < 10)).join('');
  // Hits in reverse so a newer (brighter) star wins where two tap circles overlap.
  const dayOf = dayLabeller();
  const hits = stars.slice().reverse().map((s) => {
    const when = dayOf(dreamDay(s.d));
    return `<circle class="bv-sky-hit" cx="${f1(s.x)}" cy="${f1(s.y)}" r="${HIT_R}" data-sky-star="${esc(s.d.id)}" role="button" tabindex="0"
      aria-label="${esc(`${titleOf(s.d)}${when ? `, ${when}` : ''}`)}"/>`;
  }).join('');
  const labels = groups.map((g, j) => {
    const { x, y, w, text } = g.label;
    return `
      <g class="bv-sky-label" data-sky-sym="${j}" style="--c:${g.color}" role="button" tabindex="0"
        aria-label="${esc(`${g.name}: ${plural(g.idx.length, 'dream')}`)}">
        <rect x="${f1(x - w / 2 - 4)}" y="${f1(y - 16)}" width="${f1(w + 8)}" height="32" rx="10"/>
        <text x="${f1(x)}" y="${f1(y)}" text-anchor="middle" dominant-baseline="central">${esc(text)}</text>
      </g>`;
  }).join('');
  return `
    <svg class="bv-sky-svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" style="aspect-ratio:${W} / ${H}"
      role="group" aria-label="${esc(`A sky of ${plural(n, 'dream')}`)}">
      <defs>
        <radialGradient id="bv-sky-gw"><stop offset="0" stop-color="#ece6ff" stop-opacity="0.6"/><stop offset="0.35" stop-color="#b7a3ff" stop-opacity="0.2"/><stop offset="1" stop-color="#9b7bff" stop-opacity="0"/></radialGradient>
        <radialGradient id="bv-sky-gn"><stop offset="0" stop-color="#ffd0c6" stop-opacity="0.65"/><stop offset="0.35" stop-color="#ff9f8f" stop-opacity="0.24"/><stop offset="1" stop-color="#ff9f8f" stop-opacity="0"/></radialGradient>
        <radialGradient id="bv-sky-gl"><stop offset="0" stop-color="#fff1c8" stop-opacity="0.7"/><stop offset="0.35" stop-color="#ffd98a" stop-opacity="0.26"/><stop offset="1" stop-color="#ffd98a" stop-opacity="0"/></radialGradient>
        <radialGradient id="bv-sky-gp"><stop offset="0" stop-color="#efe6ff" stop-opacity="0.65"/><stop offset="0.35" stop-color="#c9b6ff" stop-opacity="0.26"/><stop offset="1" stop-color="#c9b6ff" stop-opacity="0"/></radialGradient>
      </defs>
      ${chartSVG(W, H)}
      ${dustSVG(W, H)}
      <g class="bv-sky-lines">${lines}</g>
      <g class="bv-sky-stars">${starEls}</g>
      <circle class="bv-sky-sel" r="12" cx="0" cy="0"/>
      <g class="bv-sky-hits">${hits}</g>
      <g class="bv-sky-labels">${labels}</g>
    </svg>`;
}

function picture(d, px, cls) {
  let url = '';
  try { url = dreamArtURL(d, px) || ''; } catch {}
  return url
    ? `<img class="${cls}" src="${esc(url)}" alt="" width="${px}" height="${px}" decoding="async">`
    : `<span class="${cls} bv-sky-pic-none"></span>`;
}

function legendHTML(groups) {
  if (!groups.length) {
    return '<p class="bv-sky-hint">When two dreams share a symbol, a line joins them into a constellation.</p>';
  }
  return `
    <div class="bv-sky-chips" role="group" aria-label="Constellations">
      ${groups.map((g, j) => `
        <button type="button" class="bv-sky-chip" data-sky-sym="${j}" aria-pressed="false" style="--c:${g.color}">
          <span class="bv-sky-chip-dot" aria-hidden="true"></span>${esc(g.name)}<b>${g.idx.length}</b>
        </button>`).join('')}
    </div>`;
}

function defaultCaption(n, groups) {
  return `${plural(n, 'star')}${groups ? ` · ${plural(groups, 'constellation')}` : ''}`;
}

function emptyHTML(filtering) {
  return `
    <div class="bv-sky-empty">
      <span class="bv-sky-empty-icon" aria-hidden="true">${icons.starOutline}</span>
      <p class="bv-sky-empty-title">${filtering ? 'No stars match' : 'Your sky is still dark'}</p>
      <p class="bv-sky-empty-hint">${filtering
        ? 'Nothing fits this search or filter. Clear it to see your whole sky again.'
        : 'Record a dream and the first star will appear here.'}</p>
    </div>`;
}

function dreamCardHTML(s, groups) {
  const d = s.d;
  const type = s.type;
  const typeLabel = type === 'general' ? '' : DREAM_TYPES.find((t) => t.id === type)?.label || '';
  const when = relativeDay(dreamDay(d));
  const groupOf = new Map(s.groups.map((j) => [groups[j].key, j]));
  const syms = (s.syms || []).slice(0, 4);
  return `
    <span class="bv-sky-card-pic">${picture(d, 56, 'bv-sky-card-img')}${hasVideo(d) ? `<span class="video-mark" aria-hidden="true">${icons.play}</span>` : ''}</span>
    <div class="bv-sky-card-body">
      <p class="bv-sky-card-when">${esc(when)}${typeLabel ? `${when ? ' · ' : ''}<span class="bv-sky-t-${type}">${esc(typeLabel)}</span>` : ''}${s.done ? `${when || typeLabel ? ' · ' : ''}Analyzed` : ''}</p>
      <p class="bv-sky-card-title">${esc(titleOf(d))}</p>
      ${syms.length ? `<p class="bv-sky-card-syms">${syms.map((x) => (groupOf.has(x.key)
        ? `<button type="button" class="bv-sky-sym is-c" data-sky-sym="${groupOf.get(x.key)}" style="--c:${groups[groupOf.get(x.key)].color}">${esc(x.name)}</button>`
        : `<span class="bv-sky-sym">${esc(x.name)}</span>`)).join('')}</p>` : ''}
    </div>
    <button type="button" class="bv-sky-open" data-sky-open="${esc(d.id)}">Open</button>
    <button type="button" class="bv-sky-x" data-sky-close aria-label="Close">${icons.close}</button>`;
}

function groupCardHTML(g, stars) {
  const members = g.idx.map((i) => stars[i]);
  const shown = members.slice(0, 6);
  const more = members.length - shown.length;
  return `
    <div class="bv-sky-card-body">
      <p class="bv-sky-card-when"><span class="bv-sky-chip-dot" style="--c:${g.color}" aria-hidden="true"></span>Constellation</p>
      <p class="bv-sky-card-title">${esc(g.name)} · ${plural(g.idx.length, 'dream')}</p>
      ${g.meaning ? `<p class="bv-sky-card-meaning">${esc(g.meaning)}</p>` : ''}
      <div class="bv-sky-thumbs">
        ${shown.map((s) => `<button type="button" class="bv-sky-thumb" data-sky-star="${esc(s.d.id)}" aria-label="${esc(titleOf(s.d))}">${picture(s.d, 34, 'bv-sky-thumb-img')}</button>`).join('')}
        ${more > 0 ? `<span class="bv-sky-more">+${more}</span>` : ''}
      </div>
    </div>
    <button type="button" class="bv-sky-x" data-sky-close aria-label="Close">${icons.close}</button>`;
}

// ---------- The view ----------

let state = null;

function teardown() {
  if (!state) return;
  for (const off of state.offs) off();
  if (state.raf) cancelAnimationFrame(state.raf);
  state = null;
}

const reduceMotion = () => {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
};

function setCaption(text, clearable) {
  state.cap.innerHTML = `<span class="bv-sky-cap-text">${esc(text)}</span>${clearable
    ? '<button type="button" class="bv-sky-clear" data-sky-clear>Show all</button>'
    : '<span class="bv-sky-cap-hint">Tap a star</span>'}`;
}

function showCard(html, mode) {
  const { card, root } = state;
  card.innerHTML = html;
  card.dataset.mode = mode;
  if (card.hidden) {
    card.hidden = false;
    root.classList.add('has-card');
  }
}

function closeCard() {
  if (!state) return;
  state.card.hidden = true;
  state.card.innerHTML = '';
  state.root.classList.remove('has-card');
  state.selId = null;
  state.sel.classList.remove('is-on');
}

// Scroll a little when the chosen star sits under the card. A star chosen from the card's pictures may be anywhere,
// so that one is brought to the middle of the open sky when it is out of sight.
function keepVisible(id, fromCard) {
  if (state.raf) cancelAnimationFrame(state.raf);
  state.raf = requestAnimationFrame(() => {
    if (!state) return;
    state.raf = 0;
    const hit = state.hitById.get(id);
    if (!hit || state.card.hidden) return;
    const r = hit.getBoundingClientRect();
    const top = state.card.getBoundingClientRect().top;
    let dy = 0;
    if (fromCard && (r.bottom > top - 10 || r.top < 96)) dy = (r.top + r.bottom) / 2 - (96 + top) / 2;
    else if (r.bottom > top - 10) dy = r.bottom - top + 28;
    if (dy) window.scrollBy({ top: dy, behavior: reduceMotion() ? 'auto' : 'smooth' });
  });
}

function selectStar(id, fromCard = false) {
  const s = state.byId.get(id);
  if (!s) return;
  state.selId = id;
  state.sel.setAttribute('cx', f1(s.x));
  state.sel.setAttribute('cy', f1(s.y));
  state.sel.setAttribute('r', f1(Math.max(9, s.r * 2.6)));
  state.sel.classList.add('is-on');
  showCard(dreamCardHTML(s, state.sky.groups), 'dream');
  keepVisible(id, fromCard);
}

function setGroup(j) {
  const { sky, root } = state;
  const g = j == null ? null : sky.groups[j];
  state.hl = g ? j : null;
  root.classList.toggle('is-focus', Boolean(g));
  const members = g ? new Set(g.idx) : null;
  state.starEls.forEach((el, i) => el.classList.toggle('is-hl', Boolean(members?.has(i))));
  state.lineEls.forEach((el, k) => el.classList.toggle('is-hl', k === state.hl));
  state.labelEls.forEach((el, k) => el.classList.toggle('is-hl', k === state.hl));
  state.chipEls.forEach((el, k) => el.setAttribute('aria-pressed', String(k === state.hl)));
  if (g) {
    setCaption(`${g.name} · ${plural(g.idx.length, 'dream')}`, true);
    state.sel.classList.remove('is-on');
    state.selId = null;
    showCard(groupCardHTML(g, sky.stars), 'group');
    const chip = state.chipEls[j];
    const row = chip?.parentElement;
    if (row && row.scrollWidth > row.clientWidth) { // sideways only: never move the page
      row.scrollLeft = Math.max(0, chip.offsetLeft - row.offsetLeft - (row.clientWidth - chip.offsetWidth) / 2);
    }
  } else {
    setCaption(defaultCaption(sky.stars.length, sky.groups.length), false);
  }
}

function clearAll() {
  if (state.hl != null) setGroup(null);
  closeCard();
}

function act(target) {
  let b;
  if ((b = target.closest('[data-sky-open]'))) {
    const id = b.dataset.skyOpen;
    state.navigate?.(`#dream/${encodeURIComponent(id)}`);
    return true;
  }
  if (target.closest('[data-sky-close]')) { clearAll(); return true; }
  if (target.closest('[data-sky-clear]')) { clearAll(); return true; }
  if ((b = target.closest('[data-sky-star]'))) { selectStar(b.dataset.skyStar, Boolean(b.closest('.bv-sky-card'))); return true; }
  if ((b = target.closest('[data-sky-sym]'))) {
    const j = Number(b.dataset.skySym);
    if (state.hl === j) clearAll(); else setGroup(j);
    return true;
  }
  return false;
}

function render(el, { dreams = [], filtering = false, navigate } = {}) {
  teardown();
  const list = (Array.isArray(dreams) ? dreams : []).filter((d) => d && d.id != null);
  if (!list.length) {
    el.innerHTML = emptyHTML(filtering);
    return;
  }
  const W = Math.max(260, Math.round(el.clientWidth || 350));
  const sky = layout(list, W);
  el.innerHTML = `
    <div class="bv-sky">
      ${legendHTML(sky.groups)}
      <p class="bv-sky-cap" aria-live="polite"></p>
      <div class="bv-sky-frame">${skySVG(sky, list.length)}</div>
      <p class="bv-sky-key">
        <span><i class="bv-sky-k-new" aria-hidden="true"></i>Brighter is newer</span>
        <span><i class="bv-sky-k-lucid" aria-hidden="true"></i>Lucid</span>
        <span><i class="bv-sky-k-night" aria-hidden="true"></i>Nightmare</span>
      </p>
      <div class="bv-sky-card" role="region" aria-label="Chosen in the sky" hidden></div>
    </div>`;
  const root = el.querySelector('.bv-sky');
  const svg = root.querySelector('.bv-sky-svg');
  state = {
    root,
    sky,
    navigate,
    cap: root.querySelector('.bv-sky-cap'),
    card: root.querySelector('.bv-sky-card'),
    sel: svg.querySelector('.bv-sky-sel'),
    starEls: [...svg.querySelectorAll('.bv-sky-star')],
    lineEls: [...svg.querySelectorAll('.bv-sky-line')],
    labelEls: [...svg.querySelectorAll('.bv-sky-label')],
    chipEls: [...root.querySelectorAll('.bv-sky-chip')],
    hitById: new Map([...svg.querySelectorAll('.bv-sky-hit')].map((h) => [h.dataset.skyStar, h])),
    byId: new Map(sky.stars.map((s) => [String(s.d.id), s])),
    hl: null,
    selId: null,
    raf: 0,
    offs: [],
  };
  setCaption(defaultCaption(sky.stars.length, sky.groups.length), false);

  const on = (target, type, fn, opts) => {
    target.addEventListener(type, fn, opts);
    state.offs.push(() => target.removeEventListener(type, fn, opts));
  };
  on(root, 'click', (ev) => {
    if (act(ev.target)) return;
    if (ev.target.closest('.bv-sky-svg')) clearAll(); // empty sky
  });
  // The SVG stars and names act as buttons for the keyboard too; Escape clears.
  on(document, 'keydown', (ev) => {
    if (ev.key === 'Escape') {
      if (state.hl != null || !state.card.hidden) clearAll();
      return;
    }
    if ((ev.key === 'Enter' || ev.key === ' ') && ev.target instanceof Element && root.contains(ev.target)
      && ev.target.closest('svg [data-sky-star], svg [data-sky-sym]')) {
      ev.preventDefault();
      act(ev.target);
    }
  });
  // A picture that can't load (offline) falls back to a soft gradient. 'error' doesn't bubble: capture it.
  on(root, 'error', (ev) => {
    const img = ev.target;
    if (!(img instanceof HTMLImageElement) || !root.contains(img)) return;
    const span = document.createElement('span');
    span.className = `${img.className} bv-sky-pic-none`;
    img.replaceWith(span);
  }, true);
}

export default {
  id: 'sky',
  label: 'Sky',
  icon: icons.star,
  render,
  destroy() { teardown(); },
};
