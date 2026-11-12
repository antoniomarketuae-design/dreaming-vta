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
import { localDay } from '../../store.js';

const MARGIN_X = 0.12;   // room left and right of a figure, in figure units
const MARGIN_Y = 0.12;   // ...and above and below it
const BOX_MIN_AR = 0.75; // a tall figure gets side room so the whole sign fits a phone-shaped map
const STRETCH_MIN = 0.85; // the figure's height may be squeezed to this to fit the map...
const STRETCH_MAX = 1.3; // ...or stretched up to this to fill a tall map (stars stay round)
const CTL_ROOM = 44;     // px kept clear at the map's bottom for "Pinch to zoom" and the Whole sign switch
const NODE_MAX = 20;     // a night's circle at most (px): small, so a full month of dreams still reads
const NODE_MIN = 12;     // ...and when zoomed right out
const NODE_OPEN = 20;    // the size the map opens with (the whole sign mostly in view)
const NODE_SPREAD = 40;  // nights are spread on the figure as if circles (+ date) were this wide at the whole-sign view
const LABEL_ROOM = 18;   // px kept between neighbouring circles for the date under each
// Words by badge width: the day from 40 px, + weekday · month from 66 px, + the title from 92 px.
// Words by the room between neighbouring circles (px): the number always, + the date from 50, + the title from 100.
const WORDS = [[100, 'is-w3'], [50, 'is-w2'], [0, 'is-w1']];
const ZOOM_MAX = 8;
const ART_PX = 160;      // picture size asked for a badge
const FALLBACK = {       // a soft rounded badge for a sign without a drawn shape yet
  vb: [120, 100],
  body: 'M20 10H100Q112 10 112 22V78Q112 90 100 90H20Q8 90 8 78V22Q8 10 20 10Z',
  lines: '',
  text: [18, 20, 84, 60],
};

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
/** Today as "<b>12</b> Thursday · November", always in full. */
function todayHTML() {
  const d = new Date();
  const part = (o) => d.toLocaleDateString(undefined, o).replace('.', '');
  return `<b class="jr-zs-num">${d.getDate()}</b><span class="jr-zs-wd">${esc(part({ weekday: 'long' }))} · ${esc(part({ month: 'long' }))}</span>`;
}
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

/** The months a season covers, e.g. "Sep – Oct" (with the year when it isn't this year). */
function seasonMonths(season) {
  const f = new Date(`${season.from}T12:00:00`);
  const t = new Date(`${season.to}T12:00:00`);
  const m = (d) => d.toLocaleDateString(undefined, { month: 'short' }).replace('.', '');
  const yr = t.getFullYear() !== new Date().getFullYear() ? ` ${t.getFullYear()}` : '';
  return `${m(f)} – ${m(t)}${yr}`;
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

/**
 * One night as a small circle on the sign's figure: its day number inside, its date ("MON · NOV") under it, and the
 * dream's title under that when zoomed in. The ring takes the dream type's colour (a night with a nightmare: coral).
 * `night`: that day's dreams, newest first. One dream: the circle opens it. Several: a gold count, and the circle opens
 * the night's sheet with all of them (data-zday, handled by the Journal).
 */
function badgeHTML(night, season, x, y, newest) {
  const e = night[0];
  const d = e.d;
  const many = night.length > 1;
  const date = new Date(`${e.day}T12:00:00`);
  const ok = !Number.isNaN(date.getTime());
  const wk = ok ? date.toLocaleDateString(undefined, { weekday: 'short' }).replace('.', '') : '';
  const mon = ok ? date.toLocaleDateString(undefined, { month: 'short' }).replace('.', '') : '';
  const type = night.some((x) => dreamType(x.d) === 'nightmare') ? 'nightmare' : dreamType(d);
  const look = TYPE_LOOK[type] || TYPE_LOOK.general;
  const moon = moonSign(e.day);
  const title = many ? `${night.length} dreams` : String(d.title || '').trim() || 'Untitled dream';
  // Several dreams that night (written at different times, maybe different dreams): one arc of the ring per dream.
  const arcs = many ? arcsCSS(night.map((x) => (TYPE_LOOK[dreamType(x.d)] || TYPE_LOOK.general).rgb)) : '';
  const titles = many
    ? night.slice(0, 3).map((x) => `<i>${esc(String(x.d.title || '').trim() || 'Untitled dream')}</i>`).join('')
      + (night.length > 3 ? `<i>+${night.length - 3} more</i>` : '')
    : esc(title);
  const label = [many ? `${night.length} dreams: ${night.map((x) => String(x.d.title || '').trim() || 'Untitled dream').join('; ')}` : title,
    ok ? date.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }) : '',
    type !== 'general' ? look.name : '', moon ? `Moon in ${moon.name}` : ''].filter(Boolean).join(', ');
  return `
    <a class="jr-zn jr-zn-dot${many ? ' is-many' : ''}${newest ? ' is-newest' : ''}" href="${many ? '#journal' : `#dream/${encodeURIComponent(d.id)}`}" data-zn${many ? ` data-zday="${esc(e.day)}" role="button"` : ''}
      style="left:${x.toFixed(3)}%;top:${y.toFixed(3)}%;--tc:${look.rgb};--ratio:1${many ? `;--s:${nightScale(night.length)};--arcs:${arcs}` : ''}" aria-label="${esc(label)}">
      <span class="jr-zn-ring" aria-hidden="true">${ok ? date.getDate() : '?'}</span>
      <span class="jr-zn-date" aria-hidden="true">${esc(wk)} · ${esc(mon)}</span>
      <span class="jr-zn-sub" aria-hidden="true">${titles}</span>
      ${many ? `<span class="jr-zn-count" aria-hidden="true">${night.length}</span>` : ''}
    </a>`;
}

/** How much bigger a night's circle is for its number of dreams: 2 → ×1.2, 3 → ×1.35, 4 or more → ×1.5. */
function nightScale(n) {
  return n <= 1 ? 1 : n === 2 ? 1.2 : n === 3 ? 1.35 : 1.5;
}

/** A conic gradient: the ring cut into one arc per dream, a small gap between arcs. `rgbs`: "r, g, b" strings. */
function arcsCSS(rgbs) {
  const step = 360 / rgbs.length;
  const gap = Math.min(10, step * 0.18);
  return `conic-gradient(${rgbs.map((c, i) => {
    const a = i * step;
    return `transparent ${a.toFixed(1)}deg ${(a + gap / 2).toFixed(1)}deg, rgb(${c}) ${(a + gap / 2).toFixed(1)}deg ${(a + step - gap / 2).toFixed(1)}deg, transparent ${(a + step - gap / 2).toFixed(1)}deg ${(a + step).toFixed(1)}deg`;
  }).join(', ')})`;
}

/** The sign's emblem near the top-left of its map: the owner's picture when there is one, else the big sign symbol. */
function emblemHTML(season) {
  const shape = shapeOf(season.sign.id);
  if (shape.art) {
    return `<span class="jr-zm-emblem" aria-hidden="true" style="aspect-ratio:${(1 / shape.ratio).toFixed(4)}"><span class="jr-zm-emblem-art" style="-webkit-mask-image:url(${shape.art});mask-image:url(${shape.art})"></span></span>`;
  }
  return `<span class="jr-zm-emblem jr-zm-emblem-glyph" aria-hidden="true">${season.sign.glyph}</span>`;
}

/** One season: its heading and its map. `items`: the season's dreams, newest first. */
function seasonMapHTML(season, items) {
  const fig = FIGURES[season.sign.id];
  const n = items.length;
  const now = seasonOf(localDay())?.key === season.key; // the sign the Sun is in today
  const hb = fig.h + 2 * MARGIN_Y;
  const wb = Math.max(fig.w + 2 * MARGIN_X, hb * BOX_MIN_AR);
  const ox = (wb - fig.w) / 2;
  const oy = MARGIN_Y;
  const ar = wb / hb;
  const VB = 1000;
  const VH = Math.round(VB / ar);
  const sx = (x) => ((ox + x) / wb) * VB;
  const sy = (y) => ((oy + y) / hb) * VH;
  const lines = fig.lines.map(([a, b]) => `M${sx(fig.stars[a][0]).toFixed(0)} ${sy(fig.stars[a][1]).toFixed(0)}L${sx(fig.stars[b][0]).toFixed(0)} ${sy(fig.stars[b][1]).toFixed(0)}`).join('');
  const stars = fig.stars.map(([x, y, mag]) => `<circle cx="${sx(x).toFixed(0)}" cy="${sy(y).toFixed(0)}" r="${Math.max(2.5, 7 - mag * 1.1).toFixed(1)}"/>`).join('');
  // Spread the dreams so that, fully zoomed out on a phone (~340 px wide), the small badges still don't pile up.
  // One badge per night, oldest first along the figure.
  const byDay = new Map();
  for (const e of items) {
    if (!byDay.has(e.day)) byDay.set(e.day, []);
    byDay.get(e.day).push(e);
  }
  const nights = [...byDay.values()].reverse();
  const spots = placeOnFigure(fig, nights.length, { minGap: ((NODE_SPREAD + 6) / 340) * wb, room: MARGIN_X * 0.35 }); // circles may leave the lines a little, never off the screen
  const badges = nights.map((night, i) => badgeHTML(night, season, ((ox + spots[i][0]) / wb) * 100, ((oy + spots[i][1]) / hb) * 100, i === nights.length - 1)).join('');
  return `
    <section class="jr-month jr-zs" aria-label="${esc(`${season.sign.name} season, ${seasonRange(season)}, ${plural(n, 'dream')}`)}">
      <h2 class="jr-zs-head${now ? ' is-now' : ''}">
        <span class="jr-zs-glyph" role="img" aria-label="${esc(`${season.sign.name} season`)}">${season.sign.glyph}</span>
        <span class="jr-zs-line">${now
          ? `<span class="jr-zs-today" aria-label="${esc(`Today, ${new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}`)}">${todayHTML()}</span>`
          : `<span class="jr-zs-dates">${esc(seasonMonths(season))}</span>`}</span>
        <button type="button" class="jr-zs-n" data-zseason="${esc(season.key)}"
          aria-label="${esc(`See the ${plural(n, 'dream')} of ${season.sign.name} season`)}">${plural(n, 'dream')}<span aria-hidden="true">›</span></button>
      </h2>
      <div class="jr-zm" data-zm data-ar="${ar.toFixed(4)}">
        ${emblemHTML(season)}
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
  const scale = badges.map((b) => Number(b.style.getPropertyValue('--s')) || 1); // nights with several dreams are bigger

  let z = 1;
  let vw = 0;
  let vh = 0;
  let k = 1;    // the figure's height stretch: the whole sign fills the map's height (see STRETCH_*)
  let dmin = 1; // the closest two circles, in layer widths, edge to edge for bigger circles
  /** After vw / vh are known: the stretch, and the closest circles with it. */
  const measure = () => {
    k = Math.min(STRETCH_MAX, Math.max(STRETCH_MIN, ((vh - CTL_ROOM) * ar) / vw));
    layer.style.setProperty('--unstretch', (1 / k).toFixed(4));
    dmin = Infinity;
    for (let i = 0; i < pts.length; i += 1) {
      for (let j = i + 1; j < pts.length; j += 1) {
        dmin = Math.min(dmin, Math.hypot(pts[i][0] - pts[j][0], ((pts[i][1] - pts[j][1]) * k) / ar) / ((scale[i] + scale[j]) / 2));
      }
    }
    if (!Number.isFinite(dmin)) dmin = 1;
  };
  // Room between the two closest circles (px) at a zoom; a circle leaves LABEL_ROOM of it for the date underneath.
  const roomAt = (zoom) => dmin * vw * zoom;
  const nodeAt = (zoom) => Math.max(NODE_MIN, Math.min(NODE_MAX, roomAt(zoom) - LABEL_ROOM));
  const openZoom = () => Math.min(ZOOM_MAX, Math.max(1, (NODE_OPEN + LABEL_ROOM) / Math.max(1e-6, dmin * vw)));

  /** Zoom to `next`, keeping the point under (fx, fy) (viewport px) where it is. */
  const apply = (next, fx = vw / 2, fy = vh / 2) => {
    const oldW = layer.offsetWidth || vw;
    const oldH = layer.offsetHeight || (vw / ar) * k;
    const lx = (scroller.scrollLeft + fx) / oldW;
    const ly = (scroller.scrollTop + fy) / oldH;
    z = Math.min(ZOOM_MAX, Math.max(1, next));
    const w = vw * z;
    const h = (w / ar) * k;
    layer.style.width = `${w}px`;
    layer.style.height = `${h}px`;
    // Centred in the map, but never over the bottom row (hint, Whole sign).
    layer.style.marginTop = h < vh ? `${Math.max(0, Math.min((vh - h) / 2, vh - h - CTL_ROOM))}px` : '0px';
    const node = nodeAt(z);
    layer.style.setProperty('--node', `${node.toFixed(1)}px`);
    const words = WORDS.find(([at]) => roomAt(z) >= at)?.[1] || '';
    layer.classList.remove('is-w1', 'is-w2', 'is-w3');
    if (words) layer.classList.add(words);
    layer.classList.toggle('is-detail', Boolean(words));
    scroller.scrollLeft = lx * w - fx;
    scroller.scrollTop = ly * h - fy;
    const whole = z <= 1.01;
    toggle.textContent = whole ? 'Newest dreams' : 'Whole sign';
    el.classList.toggle('is-whole', whole);
  };

  /** Open on the newest dream, zoomed only enough for the badges to show their date. */
  const focusNewest = () => {
    apply(openZoom());
    const i = pts.length - 1; // badges are in time order: the last is the newest
    if (i < 0) return;
    scroller.scrollLeft = pts[i][0] * layer.offsetWidth - vw / 2;
    scroller.scrollTop = pts[i][1] * layer.offsetHeight - vh / 2;
  };

  const refit = () => {
    const w = scroller.clientWidth;
    if (!w || Math.abs(w - vw) < 1) return;
    const first = !vw; // drawn before it had a size: open it the usual way now
    const wasWhole = z <= 1.01;
    vw = w;
    vh = scroller.clientHeight;
    measure();
    if (wasWhole && !first) apply(1); else focusNewest();
  };

  vw = scroller.clientWidth;
  vh = scroller.clientHeight;
  if (vw) { measure(); focusNewest(); }
  // Measure again whenever the map gets (or changes) its width, e.g. when it was drawn before the page was laid out.
  const watch = typeof ResizeObserver === 'function' ? new ResizeObserver(() => refit()) : null;
  watch?.observe(scroller);

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
      watch?.disconnect();
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
