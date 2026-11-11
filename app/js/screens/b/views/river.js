// Journal view (new layout): the mood river. A ribbon meanders down the page from the newest dream back into the
// past; each dream is a pearl on it, coloured by how it felt: its mood tag, else an emotion it was given, else a soft
// lilac. Nightmares lean coral. Longer dreams make slightly bigger pearls, and the ribbon takes the colour of the
// pearls it passes. Month names mark where a month begins. Tap a pearl or its title to open the dream; tap a mood in
// the legend to pick out its pearls. One SVG for the ribbon and pearls, HTML titles on top (so they can ellipsize);
// everything is laid out once per render (and again only if the width changes).
import { dreamDay, dreamType } from '../../../symbols.js';
import { TAGS } from '../../../analyze.js';
import { esc, relativeDay, icons } from '../../../ui.js';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const TOP = 64;    // y of the first pearl (room for the first month name above it)
const STEP = 62;   // between two pearls
const GAP = 46;    // extra room where a new month begins
const CROSS = 24;  // extra room where the river crosses to the other bank, so it swings clear of the titles
const BEND = 0.35; // how much the ribbon leans sideways at a pearl (1 = plain Catmull-Rom): low keeps it off the titles
const ITEM_H = 46; // tap area of a title row

// Emotion words (the Record screen's list and a few more) and the mood whose colour they share.
const EMOTION_MOOD = {
  happy: 'happy', excited: 'happy', loved: 'happy', joy: 'happy', joyful: 'happy', free: 'happy', grateful: 'happy', playful: 'happy',
  calm: 'calm', relieved: 'calm', peaceful: 'calm', safe: 'calm', relaxed: 'calm', content: 'calm',
  curious: 'surreal', amazed: 'surreal', confused: 'surreal', awe: 'surreal', strange: 'surreal', surreal: 'surreal',
  anxious: 'anxious', ashamed: 'anxious', worried: 'anxious', nervous: 'anxious', stressed: 'anxious', embarrassed: 'anxious',
  scared: 'scared', afraid: 'scared', terrified: 'scared', angry: 'scared', frightened: 'scared', panicked: 'scared',
  sad: 'sad', lonely: 'sad', nostalgic: 'sad', grief: 'sad', lost: 'sad', heartbroken: 'sad',
};
const EMBER = [255, 159, 143];
const LILAC = [178, 168, 216];
const GOLD = '#ffd98a';

const f1 = (v) => Math.round(v * 10) / 10;
const plural = (n, word) => `${n} ${n === 1 ? word : `${word}s`}`;
const titleOf = (d) => String(d?.title || '').trim() || 'Untitled dream';
const capital = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

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

function hslRGB(h, s, l) {
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const hex = (rgb) => `#${rgb.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')}`;

/** How the dream felt: a mood id from TAGS, or 'nightmare' / 'none' when nothing says. */
function moodOf(d) {
  for (const t of Array.isArray(d?.tags) ? d.tags : []) if (TAGS[t]?.kind === 'mood') return t;
  for (const e of Array.isArray(d?.emotions) ? d.emotions : []) {
    const m = EMOTION_MOOD[String(e || '').toLowerCase().trim()];
    if (m && TAGS[m]?.kind === 'mood') return m;
  }
  return dreamType(d) === 'nightmare' ? 'nightmare' : 'none';
}

function moodRGB(mood) {
  if (mood === 'nightmare') return EMBER;
  if (mood === 'none' || !TAGS[mood]) return LILAC;
  return hslRGB(TAGS[mood].hue, 0.72, 0.72);
}

const moodLabel = (mood) => (mood === 'none' ? 'no mood' : mood === 'nightmare' ? 'nightmare' : TAGS[mood]?.label || mood);

function monthName(month) {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  return m ? `${MONTHS[Number(m[2]) - 1] || ''} ${m[1]}`.trim() : 'Undated';
}

// Where the river runs at pearl i: mostly near one bank or the other, crossing every third pearl, so each title has
// room on the open side. A slow second wave keeps the bends from looking stamped out.
function riverX(i, W) {
  const A = Math.min(W * 0.27, 140);
  const wave = Math.tanh(1.8 * Math.sin((i * Math.PI) / 3 + Math.PI / 6)) / Math.tanh(1.8);
  return W / 2 + A * (0.86 + 0.14 * Math.sin(i * 0.61 + 0.4)) * wave;
}

// A smooth curve through the points (Catmull-Rom as cubic Béziers, sideways pull softened by BEND so the ribbon
// runs nearly straight through each pearl and swings between them).
function smoothPath(pts) {
  let d = `M${f1(pts[0].x)} ${f1(pts[0].y)}`;
  for (let i = 0; i < pts.length - 1; i += 1) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    d += `C${f1(p1.x + (BEND * (p2.x - p0.x)) / 6)} ${f1(p1.y + (p2.y - p0.y) / 6)} ${f1(p2.x - (BEND * (p3.x - p1.x)) / 6)} ${f1(p2.y - (p3.y - p1.y) / 6)} ${f1(p2.x)} ${f1(p2.y)}`;
  }
  return d;
}

function layout(dreams, W, filtering) {
  const rows = [];
  const months = [];
  dreams.forEach((d, i) => {
    const day = dreamDay(d);
    const month = String(day || '').slice(0, 7);
    const x = riverX(i, W);
    let y = TOP;
    if (i === 0) months.push({ y: 24, month });
    else {
      const prev = rows[i - 1];
      y = prev.y + STEP + ((x > W / 2) !== (prev.x > W / 2) ? CROSS : 0);
      if (month !== prev.month) {
        y += GAP;
        months.push({ y: (prev.y + y) / 2, month });
      }
    }
    const mood = moodOf(d);
    const type = dreamType(d);
    const base = moodRGB(mood);
    const rgb = type === 'nightmare' && mood !== 'nightmare' ? mix(base, EMBER, 0.4) : base;
    const words = (String(d?.text || '').trim().match(/\S+/g) || []).length;
    rows.push({
      d, i, y, x, day, month, mood, type,
      color: hex(rgb),
      r: 5.5 + 5 * Math.min(1, Math.sqrt(words / 400)),
      side: x > W / 2 ? 'left' : 'right', // the title goes where the river leaves room
    });
  });
  const last = rows[rows.length - 1];
  const H = Math.round(last.y + (filtering ? 72 : 104));
  const pts = [{ x: riverX(-1, W), y: 0 }, ...rows, { x: riverX(rows.length, W), y: H }];

  const counts = new Map();
  for (const r of rows) counts.set(r.mood, (counts.get(r.mood) || 0) + 1);
  const moods = [...counts.entries()]
    .map(([id, n]) => ({ id, n, color: hex(moodRGB(id)), label: moodLabel(id) }))
    .sort((a, b) => (a.id === 'none') - (b.id === 'none') || b.n - a.n || a.label.localeCompare(b.label)); // 'no mood' last
  return { W, H, rows, months, path: smoothPath(pts), moods, last };
}

// ---------- Drawing ----------

function riverSVG(lay) {
  const { W, H, rows, path, last } = lay;
  const stop = (y, color, op = 1) => `<stop offset="${Math.max(0, Math.min(1, y / H)).toFixed(4)}" stop-color="${color}"${op < 1 ? ` stop-opacity="${op}"` : ''}/>`;
  const stops = [
    stop(0, rows[0].color, 0),
    stop(rows[0].y - 26, rows[0].color),
    ...rows.map((r) => stop(r.y, r.color)),
    stop(last.y + 26, last.color),
    stop(H, last.color, 0),
  ].join('');
  const pearls = rows.map((r) => {
    const ring = r.type === 'nightmare' ? 'is-night' : r.type === 'lucid' ? 'is-lucid' : '';
    return `
      <g class="bv-river-pearl" transform="translate(${f1(r.x)} ${f1(r.y)})">
        <circle class="bv-river-halo" r="${f1(r.r * 2.3)}" fill="${r.color}"/>
        <circle class="bv-river-core" r="${f1(r.r)}" fill="${r.color}"/>
        <circle r="${f1(r.r)}" fill="url(#bv-river-sheen)"/>
        ${ring ? `<circle class="bv-river-ring ${ring}" r="${f1(r.r + 3)}"/>` : ''}
      </g>`;
  }).join('');
  return `
    <svg class="bv-river-svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="bv-river-flow" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="${H}">${stops}</linearGradient>
        <radialGradient id="bv-river-sheen" cx="0.36" cy="0.3" r="0.78">
          <stop offset="0" stop-color="#fff" stop-opacity="0.9"/>
          <stop offset="0.28" stop-color="#fff" stop-opacity="0.28"/>
          <stop offset="0.65" stop-color="#fff" stop-opacity="0"/>
          <stop offset="1" stop-color="#140a32" stop-opacity="0.38"/>
        </radialGradient>
      </defs>
      <path class="bv-river-glow" d="${path}" stroke="url(#bv-river-flow)"/>
      <path class="bv-river-body" d="${path}" stroke="url(#bv-river-flow)"/>
      <path class="bv-river-shine" d="${path}"/>
      <g class="bv-river-pearls">${pearls}</g>
    </svg>`;
}

function itemsHTML(lay) {
  const { W, rows } = lay;
  const dayOf = dayLabeller();
  return rows.map((r) => {
    const reach = 22; // the row's tap area also covers the pearl
    const pad = Math.round(reach + r.r + 15);
    const left = r.side === 'right' ? Math.max(0, Math.round(r.x - reach)) : 0;
    const width = r.side === 'right' ? W - left : Math.min(W, Math.round(r.x + reach));
    const when = dayOf(r.day);
    const feel = r.mood === 'none' ? '' : moodLabel(r.mood);
    const meta = [when, feel].filter(Boolean).join(' · ');
    const aria = [titleOf(r.d), when, feel, r.type === 'nightmare' && r.mood !== 'nightmare' ? 'nightmare' : ''].filter(Boolean).join(', ');
    return `
      <button type="button" class="bv-river-item is-${r.side}" data-river-open="${esc(r.d.id)}" aria-label="${esc(aria)}"
        style="top:${Math.round(r.y - ITEM_H / 2)}px;left:${left}px;width:${width}px;--pad:${pad}px">
        <span class="bv-river-title">${esc(titleOf(r.d))}</span>
        ${meta ? `<span class="bv-river-when">${esc(meta)}</span>` : ''}
      </button>`;
  }).join('');
}

function monthsHTML(lay) {
  return lay.months.map((m) => `
    <div class="bv-river-month" style="top:${Math.round(m.y)}px" aria-hidden="true"><span>${esc(monthName(m.month))}</span></div>`).join('');
}

function legendHTML(moods) {
  return `
    <div class="bv-river-legend" role="group" aria-label="Moods">
      ${moods.map((m) => `
        <button type="button" class="bv-river-chip" data-river-mood="${esc(m.id)}" aria-pressed="false" style="--c:${m.color}">
          <span class="bv-river-dot" aria-hidden="true"></span>${esc(m.label)}<b>${m.n}</b>
        </button>`).join('')}
    </div>`;
}

function emptyHTML(filtering) {
  return `
    <div class="bv-river-empty">
      <span class="bv-river-empty-icon" aria-hidden="true">${icons.wave}</span>
      <p class="bv-river-empty-title">${filtering ? 'The river is dry here' : 'Your river starts with a dream'}</p>
      <p class="bv-river-empty-hint">${filtering
        ? 'No dream fits this search or filter. Clear it to see the whole river again.'
        : 'Record a dream and its pearl will appear here.'}</p>
    </div>`;
}

// ---------- The view ----------

let state = null;

function teardown() {
  if (!state) return;
  for (const off of state.offs) off();
  if (state.raf) cancelAnimationFrame(state.raf);
  state = null;
}

function setCaption(mood) {
  const m = mood ? state.lay.moods.find((x) => x.id === mood) : null;
  state.cap.innerHTML = m
    ? `<span class="bv-river-cap-text">${esc(capital(m.label))} · ${plural(m.n, 'dream')}</span>
       <button type="button" class="bv-river-clear" data-river-all>Show all</button>`
    : `<span class="bv-river-cap-text">${plural(state.lay.rows.length, 'dream')} · newest at the top</span>`;
}

function setMood(mood) {
  const m = mood && state.lay.moods.some((x) => x.id === mood) ? mood : null;
  state.mood = m;
  state.root.classList.toggle('is-focus', Boolean(m));
  state.lay.rows.forEach((r, i) => {
    const on = Boolean(m) && r.mood === m;
    state.pearlEls[i]?.classList.toggle('is-hl', on);
    state.itemEls[i]?.classList.toggle('is-hl', on);
  });
  for (const c of state.chipEls) c.setAttribute('aria-pressed', String(c.dataset.riverMood === m));
  setCaption(m);
}

function render(el, args = {}) {
  teardown();
  const { dreams = [], filtering = false, navigate } = args;
  const list = (Array.isArray(dreams) ? dreams : []).filter((d) => d && d.id != null);
  if (!list.length) {
    el.innerHTML = emptyHTML(filtering);
    return;
  }
  const W = Math.max(260, Math.round(el.clientWidth || 350));
  const lay = layout(list, W, filtering);
  el.innerHTML = `
    <div class="bv-river">
      ${legendHTML(lay.moods)}
      <p class="bv-river-cap" aria-live="polite"></p>
      <div class="bv-river-flow" style="height:${lay.H}px">
        ${riverSVG(lay)}
        ${monthsHTML(lay)}
        ${itemsHTML(lay)}
        ${filtering ? '' : `<p class="bv-river-source" style="top:${Math.round(lay.last.y + 58)}px">Where your river begins</p>`}
      </div>
    </div>`;
  const root = el.querySelector('.bv-river');
  state = {
    el,
    args,
    root,
    lay,
    W,
    cap: root.querySelector('.bv-river-cap'),
    pearlEls: [...root.querySelectorAll('.bv-river-pearl')],
    itemEls: [...root.querySelectorAll('.bv-river-item')],
    chipEls: [...root.querySelectorAll('.bv-river-chip')],
    mood: null,
    raf: 0,
    offs: [],
  };
  setCaption(null);

  const on = (target, type, fn, opts) => {
    target.addEventListener(type, fn, opts);
    state.offs.push(() => target.removeEventListener(type, fn, opts));
  };
  on(root, 'click', (ev) => {
    let b;
    if ((b = ev.target.closest('[data-river-open]'))) {
      navigate?.(`#dream/${encodeURIComponent(b.dataset.riverOpen)}`);
    } else if ((b = ev.target.closest('[data-river-mood]'))) {
      const m = b.dataset.riverMood;
      setMood(state.mood === m ? null : m);
    } else if (ev.target.closest('[data-river-all]')) {
      setMood(null);
    }
  });
  on(document, 'keydown', (ev) => {
    if (ev.key === 'Escape' && state.mood) setMood(null);
  });
  // Titles are placed in pixels, so lay the river out again if the width changes (e.g. the phone turns).
  on(window, 'resize', () => {
    if (state.raf) return;
    state.raf = requestAnimationFrame(() => {
      if (!state) return;
      state.raf = 0;
      if (!el.isConnected) return;
      const w = Math.round(el.clientWidth || 0);
      if (!w || Math.abs(w - state.W) <= 2) return;
      const keep = state.mood;
      render(el, state.args);
      if (keep && state) setMood(keep);
    });
  });
}

export default {
  id: 'river',
  label: 'River',
  icon: icons.wave,
  render,
  destroy() { teardown(); },
};
