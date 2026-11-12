// New layout, Journal "Zodiac" look: each sun-sign season is a small zoomable sky map. A Milky Way band runs across
// it, the sign's constellation is drawn in thin gold, and every dream of the season sits on the figure as a badge in
// the shape of the sign's creature (a scorpion for Scorpio… signshapes.js) with its day, weekday, month and title inside,
// and its picture faintly behind. The map opens zoomed in on the newest dreams so the badges are readable; pinch with two
// fingers (or double-tap the sky) to zoom; "Whole sign" jumps out to the whole constellation (the badges shrink, their
// words hide) and "Newest dreams" back in.
// zodiacSeasonsHTML() builds the HTML (no DOM needed); wireZodiacMaps() sets each map's zoom once it is in the page and
// returns a cleanup function. Pictures are painted by the Journal (svg <image data-art> gets its href set there).
import { FIGURES, seasonOf, moonSign, placeOnFigure } from './zodiac.js';
import { SHAPES } from './signshapes.js';
import { TYPE_LOOK } from './types.js';
import { dreamType } from '../../symbols.js';
import { esc } from '../../ui.js';

const MARGIN = 0.16;     // room around a figure, in figure units
const NODE_MAX = 118;    // badge width when zoomed in (px)
const NODE_MIN = 26;     // ...and when zoomed right out
const DETAIL_AT = 86;    // badge width from which the words show
const ZOOM_MAX = 8;
const ART_PX = 160;      // picture size asked for a badge
const FALLBACK = {       // a soft rounded badge for a sign without a drawn shape yet
  vb: [120, 100],
  body: 'M20 10H100Q112 10 112 22V78Q112 90 100 90H20Q8 90 8 78V22Q8 10 20 10Z',
  lines: '',
  text: [18, 20, 84, 60],
};

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const shapeOf = (id) => SHAPES[id] || FALLBACK;

// Small seeded random numbers, so a sign's sky looks the same every time.
function rng(seed) {
  let a = 0;
  for (const ch of String(seed)) a = (Math.imul(a ^ ch.charCodeAt(0), 2654435761) >>> 0);
  a = a || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seasonRange(season) {
  const f = new Date(`${season.from}T12:00:00`);
  const t = new Date(`${season.to}T12:00:00`);
  const opt = { day: 'numeric', month: 'short' };
  const thisYear = new Date().getFullYear();
  const yr = f.getFullYear() !== thisYear || t.getFullYear() !== thisYear ? ` ${t.getFullYear()}` : '';
  return `${f.toLocaleDateString(undefined, opt)} – ${t.toLocaleDateString(undefined, opt)}${yr}`;
}

/** The Milky Way behind a map (viewBox 1000 × H): a soft band with a dark lane, and star dust thickest in the band. */
function milkyWaySVG(H, seed) {
  const r = rng(`mw:${seed}`);
  const y0 = H * (0.72 + r() * 0.2);
  const y1 = H * (0.08 + r() * 0.2);
  const c1 = [300 + r() * 120, H * (0.45 + r() * 0.3)];
  const c2 = [620 + r() * 120, H * (0.25 + r() * 0.3)];
  const band = `M-80 ${y0.toFixed(0)}C${c1[0].toFixed(0)} ${c1[1].toFixed(0)} ${c2[0].toFixed(0)} ${c2[1].toFixed(0)} 1080 ${y1.toFixed(0)}`;
  // Points along the band for the dust (a cubic Bézier sampled by t).
  const bez = (t) => {
    const u = 1 - t;
    const x = u ** 3 * -80 + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t ** 3 * 1080;
    const y = u ** 3 * y0 + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t ** 3 * y1;
    return [x, y];
  };
  let dust = '';
  let bright = '';
  for (let i = 0; i < 230; i += 1) {
    const inBand = i < 170;
    let x;
    let y;
    if (inBand) {
      const [bx, by] = bez(r());
      const spread = H * 0.16 * (r() + r() - 1);
      x = bx + spread * 0.35;
      y = by + spread;
    } else {
      x = r() * 1000;
      y = r() * H;
    }
    const big = r() < 0.08;
    const rad = big ? 2.4 + r() * 1.4 : 0.8 + r() * 1.2;
    const d = `M${(x - rad).toFixed(1)} ${y.toFixed(1)}a${rad.toFixed(1)} ${rad.toFixed(1)} 0 1 0 ${(rad * 2).toFixed(1)} 0a${rad.toFixed(1)} ${rad.toFixed(1)} 0 1 0 ${(-rad * 2).toFixed(1)} 0`;
    if (big) bright += d; else dust += d;
  }
  // Many wide, faint strokes on top of each other: the band brightens smoothly towards its middle, with no edges.
  const haze = [0.8, 0.68, 0.57, 0.47, 0.38, 0.3, 0.23, 0.17, 0.12, 0.08]
    .map((w, k) => `<path d="${band}" stroke-width="${(H * w).toFixed(0)}" class="${k < 5 ? 'jr-zm-mw-haze' : 'jr-zm-mw-core'}"/>`).join('');
  const lane = [0.06, 0.035, 0.018]
    .map((w) => `<path d="${band}" stroke-width="${(H * w).toFixed(0)}" class="jr-zm-mw-lane" transform="translate(0 ${(H * 0.022).toFixed(0)})"/>`).join('');
  return `
    <g class="jr-zm-mw">
      ${haze}
      ${lane}
      <path d="${dust}" class="jr-zm-dust"/>
      <path d="${bright}" class="jr-zm-dust-big"/>
    </g>`;
}

/** One dream as a badge shaped like its sign's creature, with its day, weekday, month and title inside. */
function badgeHTML(e, season, x, y, newest) {
  const d = e.d;
  const shape = shapeOf(season.sign.id);
  const [W, H] = shape.vb;
  const [tx, ty, tw, th] = shape.text;
  const date = new Date(`${e.day}T12:00:00`);
  const ok = !Number.isNaN(date.getTime());
  const wk = ok ? date.toLocaleDateString(undefined, { weekday: 'short' }).replace('.', '') : '';
  const mon = ok ? date.toLocaleDateString(undefined, { month: 'short' }).replace('.', '') : '';
  const type = dreamType(d);
  const look = TYPE_LOOK[type] || TYPE_LOOK.general;
  const moon = moonSign(e.day);
  const title = String(d.title || '').trim() || 'Untitled dream';
  const label = [title, ok ? date.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }) : '',
    type !== 'general' ? look.name : '', moon ? `Moon in ${moon.name}` : ''].filter(Boolean).join(', ');
  const cid = `zc-${String(d.id).replace(/[^\w-]/g, '')}`;
  return `
    <a class="jr-zn${newest ? ' is-newest' : ''}" href="#dream/${encodeURIComponent(d.id)}" data-zn
      style="left:${x.toFixed(3)}%;top:${y.toFixed(3)}%;--tc:${look.rgb};--ratio:${(H / W).toFixed(4)}" aria-label="${esc(label)}">
      <svg class="jr-zn-svg" viewBox="0 0 ${W} ${H}" aria-hidden="true" focusable="false">
        <defs><clipPath id="${cid}"><path d="${shape.body}"/></clipPath></defs>
        <path class="jr-zn-fill" d="${shape.body}"/>
        <image class="jr-zn-img" data-art="${esc(d.id)}" data-px="${ART_PX}" clip-path="url(#${cid})" x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice"/>
        <path class="jr-zn-shade" d="${shape.body}"/>
        ${shape.lines ? `<path class="jr-zn-lines" d="${shape.lines}"/>` : ''}
        <path class="jr-zn-edge" d="${shape.body}"/>
      </svg>
      <span class="jr-zn-text" aria-hidden="true"
        style="left:${((tx / W) * 100).toFixed(2)}%;top:${((ty / H) * 100).toFixed(2)}%;width:${((tw / W) * 100).toFixed(2)}%;height:${((th / H) * 100).toFixed(2)}%">
        <b>${ok ? date.getDate() : ''}</b>
        <small>${esc(wk)} · ${esc(mon)}</small>
        <em>${esc(title)}</em>
      </span>
      ${moon ? `<span class="jr-zn-moon" aria-hidden="true" title="Moon in ${esc(moon.name)}">${moon.glyph}</span>` : ''}
    </a>`;
}

/** One season: its heading and its map. `items`: the season's dreams, newest first. */
function seasonMapHTML(season, items) {
  const fig = FIGURES[season.sign.id];
  const n = items.length;
  const hb = fig.h + 2 * MARGIN;
  const wb = Math.max(fig.w + 2 * MARGIN, hb * 1.05);
  const ox = (wb - fig.w) / 2;
  const ar = wb / hb;
  const VB = 1000;
  const VH = Math.round(VB / ar);
  const sx = (x) => ((ox + x) / wb) * VB;
  const sy = (y) => ((MARGIN + y) / hb) * VH;
  const lines = fig.lines.map(([a, b]) => `M${sx(fig.stars[a][0]).toFixed(0)} ${sy(fig.stars[a][1]).toFixed(0)}L${sx(fig.stars[b][0]).toFixed(0)} ${sy(fig.stars[b][1]).toFixed(0)}`).join('');
  const stars = fig.stars.map(([x, y, mag]) => `<circle cx="${sx(x).toFixed(0)}" cy="${sy(y).toFixed(0)}" r="${Math.max(2.5, 7 - mag * 1.1).toFixed(1)}"/>`).join('');
  // Spread the dreams so that, fully zoomed out on a phone (~340 px wide), the small badges still don't pile up.
  const chrono = items.slice().reverse();
  const spots = placeOnFigure(fig, n, { minGap: ((NODE_MIN + 8) / 340) * wb, room: MARGIN * 0.7 });
  const badges = chrono.map((e, i) => badgeHTML(e, season, ((ox + spots[i][0]) / wb) * 100, ((MARGIN + spots[i][1]) / hb) * 100, i === n - 1)).join('');
  return `
    <section class="jr-month jr-zs" aria-label="${esc(`${season.sign.name} season, ${seasonRange(season)}, ${plural(n, 'dream')}`)}">
      <h2 class="jr-zs-head">
        <span class="jr-zs-glyph" aria-hidden="true">${season.sign.glyph}</span>
        <span class="jr-zs-titles"><span class="jr-zs-name">${esc(season.sign.name)}</span><span class="jr-zs-dates">${esc(seasonRange(season))}</span></span>
        <span class="jr-zs-n">${plural(n, 'dream')}</span>
      </h2>
      <div class="jr-zm" data-zm data-ar="${ar.toFixed(4)}">
        <div class="jr-zm-scroll" data-zm-scroll>
          <div class="jr-zm-layer" data-zm-layer>
            <svg class="jr-zm-sky" viewBox="0 0 ${VB} ${VH}" preserveAspectRatio="none" aria-hidden="true" focusable="false">
              ${milkyWaySVG(VH, season.key)}
              <path class="jr-zm-glow" d="${lines}" vector-effect="non-scaling-stroke"/>
              <path class="jr-zm-line" d="${lines}" vector-effect="non-scaling-stroke"/>
              <g class="jr-zm-stars">${stars}</g>
            </svg>
            ${badges}
          </div>
        </div>
        <p class="jr-zm-hint" aria-hidden="true">Pinch to zoom</p>
        <div class="jr-zm-ctl">
          <button type="button" data-zm-act="toggle" class="jr-zm-toggle">Whole sign</button>
        </div>
      </div>
    </section>`;
}

/** The Zodiac look for the Journal's dreams (newest first): one map per sign season, newest season first. */
export function zodiacSeasonsHTML(entries, undatedHTML) {
  const groups = new Map();
  const undated = [];
  for (const e of entries) {
    const season = seasonOf(e.day);
    if (!season) { undated.push(e); continue; }
    if (!groups.has(season.key)) groups.set(season.key, { season, items: [] });
    groups.get(season.key).items.push(e);
  }
  return [...groups.values()].map(({ season, items }) => seasonMapHTML(season, items)).join('')
    + (undated.length && undatedHTML ? undatedHTML(undated) : '');
}

// ---- Zoom ----

/** Sets up every map inside `root`: opens it zoomed on its newest dreams; pinch and the buttons zoom. Returns cleanup. */
export function wireZodiacMaps(root) {
  const maps = [...root.querySelectorAll('[data-zm]')].map((el) => setupMap(el)).filter(Boolean);
  const onResize = () => maps.forEach((m) => m.refit());
  window.addEventListener('resize', onResize);
  return () => {
    window.removeEventListener('resize', onResize);
    maps.forEach((m) => m.destroy());
  };
}

function setupMap(el) {
  const scroller = el.querySelector('[data-zm-scroll]');
  const layer = el.querySelector('[data-zm-layer]');
  const badges = [...layer.querySelectorAll('[data-zn]')];
  const toggle = el.querySelector('.jr-zm-toggle');
  const ar = Number(el.dataset.ar) || 1.4;
  if (!scroller || !layer) return null;

  // Badge centres as fractions of the layer; distances measured in layer widths.
  const pts = badges.map((b) => [parseFloat(b.style.left) / 100, parseFloat(b.style.top) / 100]);
  let dmin = Infinity;
  for (let i = 0; i < pts.length; i += 1) {
    for (let j = i + 1; j < pts.length; j += 1) {
      dmin = Math.min(dmin, Math.hypot(pts[i][0] - pts[j][0], (pts[i][1] - pts[j][1]) / ar));
    }
  }
  if (!Number.isFinite(dmin)) dmin = 1;

  let z = 1;
  let vw = 0;
  let vh = 0;
  const nodeAt = (zoom) => Math.max(NODE_MIN, Math.min(NODE_MAX, 0.9 * dmin * vw * zoom));
  const fullZoom = () => Math.min(ZOOM_MAX, Math.max(1, NODE_MAX / Math.max(1e-6, 0.9 * dmin * vw)));

  /** Zoom to `next`, keeping the point under (fx, fy) (viewport px) where it is. */
  const apply = (next, fx = vw / 2, fy = vh / 2) => {
    const oldW = layer.offsetWidth || vw;
    const oldH = layer.offsetHeight || vw / ar;
    const lx = (scroller.scrollLeft + fx) / oldW;
    const ly = (scroller.scrollTop + fy) / oldH;
    z = Math.min(ZOOM_MAX, Math.max(1, next));
    const w = vw * z;
    const h = w / ar;
    layer.style.width = `${w}px`;
    layer.style.height = `${h}px`;
    layer.style.marginTop = h < vh ? `${(vh - h) / 2}px` : '0px';
    const node = nodeAt(z);
    layer.style.setProperty('--node', `${node.toFixed(1)}px`);
    layer.classList.toggle('is-detail', node >= DETAIL_AT);
    scroller.scrollLeft = lx * w - fx;
    scroller.scrollTop = ly * h - fy;
    const whole = z <= 1.01;
    toggle.textContent = whole ? 'Newest dreams' : 'Whole sign';
    el.classList.toggle('is-whole', whole);
  };

  /** Open on the newest dream, zoomed so the badges are full size. */
  const focusNewest = () => {
    apply(fullZoom());
    const i = pts.length - 1; // badges are in time order: the last is the newest
    if (i < 0) return;
    scroller.scrollLeft = pts[i][0] * layer.offsetWidth - vw / 2;
    scroller.scrollTop = pts[i][1] * layer.offsetHeight - vh / 2;
  };

  const refit = () => {
    const w = scroller.clientWidth;
    if (!w || Math.abs(w - vw) < 1) return;
    const wasWhole = z <= 1.01;
    vw = w;
    vh = scroller.clientHeight;
    if (wasWhole && vw) apply(1); else focusNewest();
  };

  vw = scroller.clientWidth;
  vh = scroller.clientHeight;
  if (vw) focusNewest();

  const onClick = (ev) => {
    const btn = ev.target.closest('[data-zm-act]');
    if (!btn) return;
    if (z <= 1.01) focusNewest();
    else apply(1);
  };
  el.addEventListener('click', onClick);

  // Double tap on the sky (not on a dream): zoom in there, or back out when already close.
  let lastTap = 0;
  const onDbl = (ev) => {
    if (ev.target.closest('[data-zn], [data-zm-act]')) return;
    const now = Date.now();
    if (now - lastTap < 320) {
      const rect = scroller.getBoundingClientRect();
      const fx = ev.clientX - rect.left;
      const fy = ev.clientY - rect.top;
      apply(z >= ZOOM_MAX * 0.7 ? 1 : z * 2, fx, fy);
      el.classList.add('is-pinched');
      lastTap = 0;
    } else lastTap = now;
  };
  scroller.addEventListener('click', onDbl);

  // Pinch with two fingers zooms the map (not the page); one finger scrolls it as usual.
  let pinch = null;
  const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  const onStart = (ev) => {
    if (ev.touches.length !== 2) return;
    const rect = scroller.getBoundingClientRect();
    pinch = {
      d: dist(ev.touches), z,
      fx: (ev.touches[0].clientX + ev.touches[1].clientX) / 2 - rect.left,
      fy: (ev.touches[0].clientY + ev.touches[1].clientY) / 2 - rect.top,
    };
  };
  const onMove = (ev) => {
    if (!pinch || ev.touches.length !== 2) return;
    ev.preventDefault();
    apply(pinch.z * (dist(ev.touches) / pinch.d), pinch.fx, pinch.fy);
    el.classList.add('is-pinched'); // the hint has done its job
  };
  const onEnd = (ev) => { if (ev.touches.length < 2) pinch = null; };
  const stopGesture = (ev) => ev.preventDefault(); // Safari's own pinch would zoom the whole page
  scroller.addEventListener('touchstart', onStart, { passive: true });
  scroller.addEventListener('touchmove', onMove, { passive: false });
  scroller.addEventListener('touchend', onEnd);
  scroller.addEventListener('touchcancel', onEnd);
  scroller.addEventListener('gesturestart', stopGesture);
  scroller.addEventListener('gesturechange', stopGesture);

  return {
    refit,
    destroy() {
      el.removeEventListener('click', onClick);
      scroller.removeEventListener('click', onDbl);
      scroller.removeEventListener('touchstart', onStart);
      scroller.removeEventListener('touchmove', onMove);
      scroller.removeEventListener('touchend', onEnd);
      scroller.removeEventListener('touchcancel', onEnd);
      scroller.removeEventListener('gesturestart', stopGesture);
      scroller.removeEventListener('gesturechange', stopGesture);
    },
  };
}
