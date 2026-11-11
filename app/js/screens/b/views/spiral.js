// Journal view (new layout): Time spiral. Today sits in the middle; older dreams wind outward along an Archimedean
// spiral, one round picture bubble per dream, spaced by date. Days without dreams leave gaps, but long quiet stretches
// are squeezed (and drawn dotted) so the spiral stays readable. Month names sit on the thread where a month begins.
// Tap a bubble for a card under the spiral; − / + zoom in (the spiral then scrolls inside its box); "Spin" turns it
// slowly, only when the phone allows motion. Everything is laid out in "bubble widths" and scaled to fit the width.
import { localDay } from '../../../store.js';
import { symbolsOf, dreamDay, dreamType, DREAM_TYPES } from '../../../symbols.js';
import { dreamArtURL } from '../../../dreamart.js';
import { hasVideo } from '../../../videos.js';
import { esc, formatDate, relativeDay, icons } from '../../../ui.js';

const SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAY_MS = 86400000;
const PITCH = 1.34;               // centre-to-centre distance between two turns, in bubble widths
const B = PITCH / (2 * Math.PI);  // the spiral: r = r0 + B·θ
const MIN_TURNS = 2.25;           // the thread is always at least this long, even for a handful of dreams
const MAX_BUBBLE = 40;            // px: few dreams never make bubbles bigger than this
const ZOOM_TARGET = 34;           // px: zoom steps are offered until a bubble is about this wide
const ZOOM_STEP = 1.5;
const ART_PX = 64;                // the List's thumbnail size, so its cached paintings are reused
const QUIET_DAYS = 21;            // a gap longer than this is drawn as a dotted "quiet stretch"
const ISO = /^\d{4}-\d{2}-\d{2}$/;

const minus = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M5 12h14"/></svg>';

// Kept between renders (the Journal redraws the view on every search keystroke and on coming back from a dream).
let keep = { zoom: 0, id: null, spin: false };
let cleanup = null;

const motionOK = () => {
  try { return !window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
};

const dayNum = (iso) => Math.round(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / DAY_MS);

// Extra room along the thread for `g` empty days: a little per day at first, then slower and slower, capped.
const quietRoom = (g) => (g <= 0 ? 0 : Math.min(3.4, 0.3 * Math.min(g, 5) + 0.55 * Math.log2(1 + Math.max(0, g - 5) / 5)));

// Room a month label needs on the thread, in px (9px uppercase text, its padding, a little air).
const labelPx = (text) => text.length * 6.4 + 18;

const plural = (n, word) => `${n} ${n === 1 ? word : `${word}s`}`;
const typeLabel = (type) => (type === 'general' ? '' : DREAM_TYPES.find((t) => t.id === type)?.label || '');
const pct = (v, H) => (((v + H) / (2 * H)) * 100).toFixed(3);

/** The dreams as spiral items, newest first: { d, day, n (day number), month 'YYYY-MM', type }. */
function prepare(dreams, today) {
  return dreams
    .map((d, order) => {
      const raw = dreamDay(d);
      const day = ISO.test(raw) ? raw : today;
      return { d, day, n: dayNum(day), month: day.slice(0, 7), type: dreamType(d), order };
    })
    .sort((a, b) => b.n - a.n || a.order - b.order);
}

/**
 * Places every item on the spiral for bubbles `u` px wide (month labels are sized in px, so they depend on u).
 * Arc length along r = r0 + Bθ is about r0·θ + Bθ²/2, which inverts in closed form.
 */
function layout(items, today, u) {
  const r0 = Math.max(1.3, 30 / u); // room in the middle for the "Today" badge
  const sAt = (th) => r0 * th + (B * th * th) / 2;
  const thAt = (s) => (Math.sqrt(r0 * r0 + 2 * B * Math.max(0, s)) - r0) / B;
  const rAt = (s) => r0 + B * thAt(s);
  let s = 0;
  let prevN = dayNum(today);
  let prevMonth = today.slice(0, 7);
  let yearShown = today.slice(0, 4);
  const bubbles = [];
  const labels = [];
  const quiet = [];
  items.forEach((it, i) => {
    const g = Math.max(0, prevN - it.n);
    let gap = (i ? 1.12 : 0.6) + quietRoom(g);
    let text = '';
    if (it.month !== prevMonth) {
      const y = it.month.slice(0, 4);
      text = SHORT[Number(it.month.slice(5, 7)) - 1] + (y !== yearShown ? ` ${y}` : '');
      yearShown = y;
      gap += labelPx(text) / u;
    }
    const from = s;
    s += gap;
    // A label sits in the middle of the gap between two bubbles (the first one: between the start and the bubble).
    if (text) labels.push({ text, s: i ? from + gap / 2 : (s - 0.5) / 2 });
    if (g > QUIET_DAYS) quiet.push([i ? from + 0.55 : 0, s - 0.55]);
    bubbles.push({ it, s });
    prevN = it.n;
    prevMonth = it.month;
  });
  const lastS = bubbles.length ? bubbles[bubbles.length - 1].s : 0;
  const endS = Math.max(lastS + 1.4, sAt(MIN_TURNS * 2 * Math.PI));
  return { r0, sAt, thAt, rAt, bubbles, labels, quiet, lastS, endS, H: rAt(endS) + 0.8 };
}

/** Lays out for a stage `width` px wide: returns the layout and the bubble size u (px) at that width. */
function fit(items, today, width) {
  let u = 30;
  let L = layout(items, today, u);
  for (let k = 0; k < 6; k++) {
    const next = width / (2 * L.H);
    if (Math.abs(next - u) < 0.05) break;
    u = next;
    L = layout(items, today, u);
  }
  u = width / (2 * L.H);
  if (u > MAX_BUBBLE) {
    // Few dreams: keep bubbles at a sensible size, and let the thread run on towards the edge.
    L = layout(items, today, MAX_BUBBLE);
    const H = Math.max(L.H, width / (2 * MAX_BUBBLE));
    L.endS = L.sAt((H - 0.8 - L.r0) / B);
    L.H = H;
    u = width / (2 * H);
  }
  return { L, u };
}

// The thread between arc positions a and b, as SVG path data (spiral units, centre at 0,0).
function thread(L, a, b) {
  if (b - a < 0.02) return '';
  const t0 = L.thAt(a);
  const t1 = L.thAt(b);
  const steps = Math.max(2, Math.ceil((t1 - t0) / 0.07));
  let out = '';
  for (let k = 0; k <= steps; k++) {
    const th = t0 + ((t1 - t0) * k) / steps;
    const r = L.r0 + B * th;
    out += `${k ? 'L' : 'M'}${(r * Math.sin(th)).toFixed(3)} ${(-r * Math.cos(th)).toFixed(3)}`;
  }
  return out;
}

const pointAt = (L, s) => {
  const th = L.thAt(s);
  const r = L.r0 + B * th;
  return { th, r, x: r * Math.sin(th), y: -r * Math.cos(th) };
};

function svgHTML(L, u) {
  const { r0, H } = L;
  // Solid thread with the quiet stretches cut out (they become dots), then a fading tail past the oldest dream.
  let solid = `M0 0C0 ${(-r0 * 0.55).toFixed(3)} ${(-r0 * 0.55).toFixed(3)} ${(-r0).toFixed(3)} 0 ${(-r0).toFixed(3)}`;
  let cursor = 0;
  const dots = [];
  const dotR = (1.1 / u).toFixed(3);
  for (const [a, b] of L.quiet) {
    solid += thread(L, cursor, a);
    for (let s = a + 0.18; s < b; s += 0.36) {
      const p = pointAt(L, s);
      dots.push(`<circle cx="${p.x.toFixed(3)}" cy="${p.y.toFixed(3)}" r="${dotR}"/>`);
    }
    cursor = b;
  }
  const end = L.lastS + 0.5;
  solid += thread(L, cursor, end);
  const tail = thread(L, Math.max(cursor, end), L.endS);

  // A few faint stars, the same every time.
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const stars = Array.from({ length: 26 }, () => {
    const x = (rnd() * 2 - 1) * H * 0.96;
    const y = (rnd() * 2 - 1) * H * 0.96;
    return `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${((0.5 + rnd() * 0.7) / u).toFixed(3)}"/>`;
  }).join('');

  const v = (2 * H).toFixed(3);
  return `
    <svg class="bv-spiral-svg" viewBox="${(-H).toFixed(3)} ${(-H).toFixed(3)} ${v} ${v}" aria-hidden="true">
      <defs>
        <radialGradient id="bv-spiral-glow">
          <stop offset="0%" stop-color="#ffd98a" stop-opacity="0.45"/>
          <stop offset="100%" stop-color="#ffd98a" stop-opacity="0"/>
        </radialGradient>
      </defs>
      <g class="bv-spiral-stars">${stars}</g>
      <circle class="bv-spiral-core" r="${(r0 * 0.95).toFixed(3)}" fill="url(#bv-spiral-glow)"/>
      <path class="bv-spiral-glowline" d="${solid}" vector-effect="non-scaling-stroke"/>
      <path class="bv-spiral-line" d="${solid}" vector-effect="non-scaling-stroke"/>
      <path class="bv-spiral-tail" d="${tail}" vector-effect="non-scaling-stroke"/>
      <g class="bv-spiral-quiet">${dots.join('')}</g>
    </svg>`;
}

function bubbleLabel(it) {
  const t = typeLabel(it.type);
  return `${String(it.d.title || '').trim() || 'Untitled dream'}, ${formatDate(it.day)}${t ? `, ${t.toLowerCase()}` : ''}`;
}

function stageHTML(L, u, sel) {
  const { H } = L;
  const bubbles = L.bubbles.map(({ it, s }, i) => {
    const p = pointAt(L, s);
    it.fx = (p.x + H) / (2 * H);
    it.fy = (p.y + H) / (2 * H);
    return `<button type="button" class="bv-spiral-bub t-${it.type}${it.d.id === sel ? ' is-sel' : ''}" style="left:${pct(p.x, H)}%;top:${pct(p.y, H)}%"
      data-sp="${i}" aria-label="${esc(bubbleLabel(it))}" aria-pressed="${it.d.id === sel}"><img data-sp-img="${i}" alt="" decoding="async"></button>`;
  }).join('');
  const labels = L.labels.map(({ text, s }) => {
    const p = pointAt(L, s);
    // Along the thread: the tangent of (r sinθ, −r cosθ), turned so the text never reads upside down.
    const dx = B * Math.sin(p.th) + p.r * Math.cos(p.th);
    const dy = -B * Math.cos(p.th) + p.r * Math.sin(p.th);
    let a = (Math.atan2(dy, dx) * 180) / Math.PI;
    if (a > 90) a -= 180;
    if (a < -90) a += 180;
    return `<span class="bv-spiral-month" style="left:${pct(p.x, H)}%;top:${pct(p.y, H)}%;transform:translate(-50%,-50%) rotate(${a.toFixed(1)}deg)">${esc(text)}</span>`;
  }).join('');
  return `
    <div class="bv-spiral-rot">
      ${svgHTML(L, u)}
      ${labels}
      ${bubbles}
    </div>
    <span class="bv-spiral-today" aria-hidden="true">Today</span>`;
}

function cardHTML(it, i, count) {
  const d = it.d;
  const rel = relativeDay(it.day);
  const abs = formatDate(it.day);
  const t = typeLabel(it.type);
  const title = String(d.title || '').trim() || 'Untitled dream';
  const syms = symbolsOf(d).slice(0, 4);
  const text = String(d.text || '').trim().replace(/\s+/g, ' ');
  const excerpt = text.length > 170 ? `${text.slice(0, 165).trimEnd()}…` : text;
  let url = '';
  try { url = dreamArtURL(d, ART_PX) || ''; } catch {}
  return `
    <div class="bv-spiral-card glass">
      <button type="button" class="bv-spiral-x" data-sp-close aria-label="Close">${icons.close}</button>
      <div class="bv-spiral-card-top">
        <span class="bv-spiral-card-pic t-${it.type}">
          ${url ? `<img src="${esc(url)}" alt="" width="64" height="64" decoding="async" data-sp-card-img>` : ''}
          ${hasVideo(d) ? `<span class="video-mark" aria-hidden="true">${icons.play}</span>` : ''}
        </span>
        <div class="bv-spiral-card-head">
          <p class="bv-spiral-card-when">${esc(rel === abs ? abs : `${rel} · ${abs}`)}${t ? ` · <span class="bv-spiral-type-${it.type}">${esc(t)}</span>` : ''}</p>
          <h3 class="bv-spiral-card-title">${esc(title)}</h3>
        </div>
      </div>
      ${syms.length ? `<div class="bv-spiral-syms">${syms.map((s) => `<span class="bv-spiral-sym">${esc(s.name)}</span>`).join('')}</div>` : ''}
      ${excerpt ? `<p class="bv-spiral-card-text">${esc(excerpt)}</p>` : ''}
      <div class="bv-spiral-card-row">
        <button type="button" class="bv-spiral-step" data-sp-step="-1" aria-label="Newer dream" ${i === 0 ? 'disabled' : ''}>${icons.back}<span>Newer</span></button>
        <button type="button" class="btn bv-spiral-open" data-sp-open>Open dream</button>
        <button type="button" class="bv-spiral-step bv-spiral-step-older" data-sp-step="1" aria-label="Older dream" ${i >= count - 1 ? 'disabled' : ''}><span>Older</span>${icons.chevronRight}</button>
      </div>
    </div>`;
}

function emptyHTML(filtering) {
  return filtering
    ? `<div class="jr-none glass bv-spiral-empty">
        <p>No dreams match, so the spiral is empty for now.</p>
        <button type="button" class="btn btn-ghost" data-clear-all>Show all dreams</button>
      </div>`
    : `<div class="jr-none glass bv-spiral-empty"><p>No dreams yet. Your first one will sit right in the middle.</p></div>`;
}

export default {
  id: 'spiral',
  label: 'Spiral',
  icon: icons.spiral,

  render(el, { dreams, filtering, navigate }) {
    cleanup?.();
    cleanup = null;
    if (!dreams.length) {
      el.innerHTML = emptyHTML(filtering);
      return;
    }

    const today = localDay();
    const items = prepare(dreams, today);
    if (keep.id && !items.some((x) => x.d.id === keep.id)) keep.id = null;
    const canSpin = motionOK();
    if (!canSpin) keep.spin = false;
    const oldest = items[items.length - 1];
    const since = oldest.month === today.slice(0, 7) ? 'this month' : `since ${LONG[Number(oldest.month.slice(5, 7)) - 1]} ${oldest.month.slice(0, 4)}`;
    const types = new Set(items.map((x) => x.type));

    el.innerHTML = `
      <div class="bv-spiral${keep.spin ? ' is-spinning' : ''}">
        <div class="bv-spiral-head">
          <div class="bv-spiral-head-text">
            <h2 class="bv-spiral-title">Time spiral</h2>
            <p class="bv-spiral-sub">${esc(`${filtering ? `${plural(items.length, 'matching dream')}` : plural(items.length, 'dream')} ${since}`)}</p>
          </div>
          <div class="bv-spiral-tools">
            ${canSpin ? `<button type="button" class="bv-spiral-spin" data-sp-spin aria-pressed="${keep.spin}">${keep.spin ? 'Stop' : 'Spin'}</button>` : ''}
            <button type="button" class="icon-btn bv-spiral-zoom" data-sp-zoom="-1" aria-label="Zoom out" hidden>${minus}</button>
            <button type="button" class="icon-btn bv-spiral-zoom" data-sp-zoom="1" aria-label="Zoom in" hidden>${icons.plus}</button>
          </div>
        </div>
        <div class="bv-spiral-box" role="group" aria-label="Your dreams on a spiral, today in the middle">
          <div class="bv-spiral-stage"></div>
        </div>
        <div class="bv-spiral-legend" hidden>
          ${types.has('lucid') ? '<span><i class="bv-spiral-key t-lucid"></i>Lucid</span>' : ''}
          ${types.has('nightmare') ? '<span><i class="bv-spiral-key t-nightmare"></i>Nightmare</span>' : ''}
          <span class="bv-spiral-key-quiet" hidden><i class="bv-spiral-key-dots"></i>Quiet stretch</span>
        </div>
        <div class="bv-spiral-detail" aria-live="polite"></div>
      </div>`;

    const root = el.firstElementChild;
    const box = root.querySelector('.bv-spiral-box');
    const stage = root.querySelector('.bv-spiral-stage');
    const detail = root.querySelector('.bv-spiral-detail');
    const zoomOut = root.querySelector('[data-sp-zoom="-1"]');
    const zoomIn = root.querySelector('[data-sp-zoom="1"]');
    const quietKey = root.querySelector('.bv-spiral-key-quiet');
    const legend = root.querySelector('.bv-spiral-legend');
    let job = 0;
    let levels = [1];
    let width = 0;

    // Pictures arrive a few at a time so a long journal never freezes the screen.
    const fillPictures = () => {
      const mine = ++job;
      const imgs = [...stage.querySelectorAll('img[data-sp-img]')];
      let k = 0;
      const step = () => {
        if (mine !== job || !root.isConnected) return;
        const stop = performance.now() + 8;
        while (k < imgs.length && performance.now() < stop) {
          const img = imgs[k++];
          let url = '';
          try { url = dreamArtURL(items[Number(img.dataset.spImg)]?.d, ART_PX) || ''; } catch {}
          if (url) img.src = url;
        }
        if (k < imgs.length) requestAnimationFrame(step);
      };
      step();
    };

    const paintZoomButtons = () => {
      const many = levels.length > 1;
      zoomOut.hidden = !many;
      zoomIn.hidden = !many;
      zoomOut.disabled = keep.zoom <= 0;
      zoomIn.disabled = keep.zoom >= levels.length - 1;
    };

    // Sets the zoom, keeping the point (fx, fy) of the spiral (fractions of the stage) in the middle of the box.
    const applyZoom = (fx, fy) => {
      const z = levels[keep.zoom] || 1;
      stage.style.width = z > 1 ? `${(z * 100).toFixed(2)}%` : '';
      box.classList.toggle('is-zoomed', z > 1);
      const w = stage.offsetWidth;
      box.scrollLeft = Math.max(0, fx * w - box.clientWidth / 2);
      box.scrollTop = Math.max(0, fy * w - box.clientHeight / 2);
      paintZoomButtons();
    };

    const selectedIndex = () => items.findIndex((x) => x.d.id === keep.id);

    const paintCard = () => {
      const i = selectedIndex();
      detail.innerHTML = i < 0
        ? `<p class="bv-spiral-hint">${levels.length > 1 ? 'Tap a dream to see it here. Use + to zoom in, then drag to look around.' : 'Tap a dream to see it here. The further out, the longer ago.'}</p>`
        : cardHTML(items[i], i, items.length);
    };

    const paintStage = () => {
      width = box.clientWidth || 340;
      const { L, u } = fit(items, today, width);
      levels = [1];
      while (u * levels[levels.length - 1] < ZOOM_TARGET && levels.length < 6) levels.push(levels[levels.length - 1] * ZOOM_STEP);
      keep.zoom = Math.min(keep.zoom, levels.length - 1);
      stage.style.setProperty('--d', `${(100 / (2 * L.H)).toFixed(4)}%`);
      stage.innerHTML = stageHTML(L, u, keep.id);
      quietKey.hidden = !L.quiet.length;
      legend.hidden = !L.quiet.length && !types.has('lucid') && !types.has('nightmare');
      const i = selectedIndex();
      applyZoom(i >= 0 ? items[i].fx : 0.5, i >= 0 ? items[i].fy : 0.5);
      paintCard();
      fillPictures();
    };

    // Shows bubble i (when zoomed, scrolls the box to it if it is out of sight).
    const reveal = (i) => {
      if (!box.classList.contains('is-zoomed')) return;
      const it = items[i];
      const w = stage.offsetWidth;
      const x = it.fx * w;
      const y = it.fy * w;
      const pad = 30;
      if (x < box.scrollLeft + pad || x > box.scrollLeft + box.clientWidth - pad
        || y < box.scrollTop + pad || y > box.scrollTop + box.clientHeight - pad) {
        box.scrollTo({ left: x - box.clientWidth / 2, top: y - box.clientHeight / 2, behavior: motionOK() ? 'smooth' : 'auto' });
      }
    };

    const select = (i, { scrollCard = false } = {}) => {
      const prev = stage.querySelector('.bv-spiral-bub.is-sel');
      if (prev) { prev.classList.remove('is-sel'); prev.setAttribute('aria-pressed', 'false'); }
      keep.id = i >= 0 ? items[i].d.id : null;
      if (i >= 0) {
        const b = stage.querySelector(`[data-sp="${i}"]`);
        b?.classList.add('is-sel');
        b?.setAttribute('aria-pressed', 'true');
      }
      paintCard();
      if (i >= 0 && scrollCard) detail.scrollIntoView?.({ block: 'nearest', behavior: motionOK() ? 'smooth' : 'auto' });
    };

    const onClick = (e) => {
      let b;
      if ((b = e.target.closest('[data-sp]'))) {
        const i = Number(b.dataset.sp);
        select(items[i]?.d.id === keep.id ? -1 : i, { scrollCard: true });
      } else if (e.target.closest('[data-sp-close]')) {
        const i = selectedIndex();
        select(-1);
        if (i >= 0) stage.querySelector(`[data-sp="${i}"]`)?.focus({ preventScroll: true });
      } else if ((b = e.target.closest('[data-sp-step]'))) {
        const i = selectedIndex() + Number(b.dataset.spStep);
        if (i < 0 || i >= items.length) return;
        select(i);
        reveal(i);
        detail.querySelector(`[data-sp-step="${b.dataset.spStep}"]:not(:disabled)`)?.focus({ preventScroll: true });
      } else if (e.target.closest('[data-sp-open]')) {
        const i = selectedIndex();
        if (i < 0) return;
        const hash = `#dream/${encodeURIComponent(items[i].d.id)}`;
        if (typeof navigate === 'function') navigate(hash);
        else location.hash = hash;
      } else if ((b = e.target.closest('[data-sp-zoom]'))) {
        const next = Math.max(0, Math.min(levels.length - 1, keep.zoom + Number(b.dataset.spZoom)));
        if (next === keep.zoom) return;
        // Zoom around the chosen dream when it is in sight, otherwise around the middle of the box.
        const w = stage.offsetWidth;
        let fx = (box.scrollLeft + box.clientWidth / 2) / w;
        let fy = (box.scrollTop + box.clientHeight / 2) / w;
        const i = selectedIndex();
        if (i >= 0) {
          const x = items[i].fx * w - box.scrollLeft;
          const y = items[i].fy * w - box.scrollTop;
          if (x >= 0 && x <= box.clientWidth && y >= 0 && y <= box.clientHeight) { fx = items[i].fx; fy = items[i].fy; }
        }
        keep.zoom = next;
        applyZoom(fx, fy);
      } else if ((b = e.target.closest('[data-sp-spin]'))) {
        keep.spin = !keep.spin && motionOK();
        root.classList.toggle('is-spinning', keep.spin);
        b.setAttribute('aria-pressed', String(keep.spin));
        b.textContent = keep.spin ? 'Stop' : 'Spin';
      }
    };

    // A picture that can't load (offline, removed) shows the dream's painting instead. 'error' doesn't bubble.
    const onError = (e) => {
      const img = e.target;
      if (!(img instanceof HTMLImageElement) || img.dataset.fallback) return;
      const i = img.dataset.spImg !== undefined ? Number(img.dataset.spImg) : img.hasAttribute('data-sp-card-img') ? selectedIndex() : -1;
      const d = items[i]?.d;
      if (!d) return;
      img.dataset.fallback = '1';
      let url = '';
      try { url = dreamArtURL({ ...d, image: null }, ART_PX) || ''; } catch {}
      if (url) img.src = url;
    };

    // Turning the phone (or resizing a window) re-fits the spiral.
    let resizeTimer = 0;
    const onResize = () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (root.isConnected && Math.abs((box.clientWidth || 0) - width) > 16) paintStage();
      }, 220);
    };

    root.addEventListener('click', onClick);
    root.addEventListener('error', onError, true);
    window.addEventListener('resize', onResize);
    cleanup = () => {
      job += 1;
      clearTimeout(resizeTimer);
      root.removeEventListener('click', onClick);
      root.removeEventListener('error', onError, true);
      window.removeEventListener('resize', onResize);
    };

    paintStage();
  },

  destroy() {
    cleanup?.();
    cleanup = null;
  },
};
