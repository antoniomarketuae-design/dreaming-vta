// Journal view (new layout): Story cards. Every dream as a tall picture card, swiped sideways like stories, newest
// first, with "3 / 15" and a progress line on top, previous / next buttons and the arrow keys. A dream with an AI
// video plays it muted and looping inside its card while that card is in view (never with Reduce Motion); "Watch"
// opens the full player with sound. Kept light for long journals: every card is in the DOM, but pictures are only
// set for the card in view and its neighbours, and only the card in view ever has a <video>.
import { symbolsOf, dreamDay, dreamType, DREAM_TYPES } from '../../../symbols.js';
import { dreamArtURL } from '../../../dreamart.js';
import { hasImage } from '../../../images.js';
import { hasVideo, openVideoPlayer } from '../../../videos.js';
import { esc, icons } from '../../../ui.js';

const ART_PX = 420;      // picture size asked of dreamArtURL (CSS px)

/** The exact date, e.g. "Mon 9 Nov 2026" (the team asked for dates, not "2 days ago"). */
function exactDay(iso) {
  const date = new Date(`${iso}T12:00:00`);
  if (!iso || Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}
const SEGMENTS_MAX = 20; // up to this many dreams the progress line has one segment per dream, above it one bar

let resumeId = null; // dream opened from a card: coming back to the view starts at that card again
let live = null;     // the drawn view, for destroy()

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

function cardHTML(d, i, n) {
  const type = dreamType(d);
  const typeLabel = type === 'general' ? '' : DREAM_TYPES.find((t) => t.id === type)?.label || '';
  const syms = symbolsOf(d).slice(0, 3);
  const title = String(d.title || '').trim() || 'Untitled dream';
  const when = exactDay(dreamDay(d)) || 'No date';
  const video = hasVideo(d);
  return `
    <article class="bv-stories-card${type === 'nightmare' ? ' is-night' : ''}" data-bvs-i="${i}"
      role="group" aria-roledescription="story" aria-label="${esc(`${i + 1} of ${n}: ${title}`)}">
      <img class="bv-stories-img" alt="" loading="lazy" decoding="async">
      <div class="bv-stories-shade" aria-hidden="true"></div>
      ${video ? `<span class="bv-stories-badge">${icons.film}<span>Video</span></span>` : ''}
      <div class="bv-stories-info">
        <p class="bv-stories-meta">
          <span>${esc(when)}</span>${typeLabel ? `<span class="bv-stories-type bv-stories-type-${type}">${esc(typeLabel)}</span>` : ''}
        </p>
        <h3 class="bv-stories-title">${esc(title)}</h3>
        ${syms.length ? `<p class="bv-stories-syms">${syms.map((s) => `<span class="bv-stories-sym">${esc(s.name)}</span>`).join('')}</p>` : ''}
        <div class="bv-stories-actions">
          <button type="button" class="bv-stories-btn bv-stories-open" data-bvs-open="${i}" aria-label="${esc(`Open ${title}`)}">
            <span>Open</span>${icons.chevronRight}
          </button>
          ${video ? `<button type="button" class="bv-stories-btn bv-stories-watch" data-bvs-watch="${i}" aria-label="${esc(`Watch the video of ${title}`)}">${icons.play}<span>Watch</span></button>` : ''}
        </div>
      </div>
    </article>`;
}

function progressHTML(n) {
  if (n > SEGMENTS_MAX) return '<span class="bv-stories-bar"><span class="bv-stories-fill"></span></span>';
  return Array.from({ length: n }, () => '<span class="bv-stories-seg"></span>').join('');
}

function emptyHTML(filtering) {
  return `
    <div class="bv-stories-empty">
      <p>${filtering ? 'No dreams match, so there are no stories to show.' : 'No dreams yet. Each one you record becomes a story here.'}</p>
      ${filtering ? '<button type="button" class="btn btn-ghost" data-clear-all>Show all dreams</button>' : ''}
    </div>`;
}

function cleanup() {
  if (!live) return;
  const s = live;
  live = null;
  s.stopVideo();
  for (const o of s.observers) o.disconnect();
  if (s.raf) cancelAnimationFrame(s.raf);
  for (const [target, type, fn, opt] of s.listeners) target.removeEventListener(type, fn, opt);
}

export default {
  id: 'stories',
  label: 'Stories',
  icon: icons.cards,

  render(el, { dreams = [], filtering = false, navigate } = {}) {
    cleanup();
    const n = dreams.length;
    if (!n) {
      el.innerHTML = emptyHTML(filtering);
      return;
    }

    el.innerHTML = `
      <div class="bv-stories">
        <div class="bv-stories-top">
          <button type="button" class="bv-stories-nav" data-bvs-step="-1" aria-label="Newer dream">${icons.back}</button>
          <div class="bv-stories-progress" aria-hidden="true">${progressHTML(n)}</div>
          <span class="bv-stories-count" aria-live="polite">1 / ${n}</span>
          <button type="button" class="bv-stories-nav bv-stories-nav-next" data-bvs-step="1" aria-label="Older dream">${icons.back}</button>
        </div>
        <div class="bv-stories-track" tabindex="0" role="region" aria-roledescription="carousel"
          aria-label="Your dreams as stories, newest first. Swipe or use the arrow keys.">
          ${dreams.map((d, i) => cardHTML(d, i, n)).join('')}
        </div>
      </div>`;

    const root = el.firstElementChild;
    const track = root.querySelector('.bv-stories-track');
    const cards = [...track.children];
    const segs = [...root.querySelectorAll('.bv-stories-seg')];
    const fill = root.querySelector('.bv-stories-fill');
    const countEl = root.querySelector('.bv-stories-count');
    const prevBtn = root.querySelector('[data-bvs-step="-1"]');
    const nextBtn = root.querySelector('[data-bvs-step="1"]');

    const s = {
      observers: [],
      listeners: [],
      raf: 0,
      active: -1,
      video: null,      // the <video> in the card in view, if any
      videoAt: -1,
      trackVisible: true,
      playerOpen: false,
      stopVideo() {
        const v = s.video;
        s.video = null;
        s.videoAt = -1;
        if (!v) return;
        try { v.pause(); v.removeAttribute('src'); v.load(); } catch {}
        v.remove();
      },
    };
    live = s;
    const on = (target, type, fn, opt) => { target.addEventListener(type, fn, opt); s.listeners.push([target, type, fn, opt]); };

    const artURL = (d) => { try { return dreamArtURL(d, ART_PX) || ''; } catch { return ''; } };
    const loadArt = (i) => {
      const img = cards[i]?.querySelector('.bv-stories-img');
      if (!img || img.getAttribute('src')) return;
      const url = artURL(dreams[i]);
      if (url) img.src = url;
    };

    // The muted loop in the card in view: only while that card, the track and the app are on screen and the full
    // player is closed. Moving to another card removes it.
    const syncVideo = () => {
      const i = s.active;
      const d = dreams[i];
      const allowed = Boolean(d) && hasVideo(d) && !reducedMotion();
      if (s.video && (s.videoAt !== i || !allowed)) s.stopVideo();
      if (!allowed) return;
      const play = s.trackVisible && !document.hidden && !s.playerOpen;
      if (s.video) {
        if (play) s.video.play().catch(() => {});
        else s.video.pause();
        return;
      }
      if (!play) return;
      loadArt(i);
      const v = document.createElement('video');
      v.className = 'bv-stories-video';
      v.muted = true;
      v.defaultMuted = true;
      v.loop = true;
      v.playsInline = true;
      v.autoplay = true;
      for (const a of ['muted', 'loop', 'playsinline', 'autoplay']) v.setAttribute(a, '');
      v.setAttribute('aria-hidden', 'true');
      v.preload = 'auto';
      const poster = cards[i].querySelector('.bv-stories-img')?.getAttribute('src') || artURL(d);
      if (poster) v.poster = poster;
      v.addEventListener('playing', () => v.classList.add('is-on'));
      v.addEventListener('error', () => v.classList.remove('is-on'));
      v.src = d.video.url;
      cards[i].querySelector('.bv-stories-shade').before(v);
      s.video = v;
      s.videoAt = i;
      v.play().catch(() => {});
    };

    const setActive = (i) => {
      if (i === s.active || i < 0 || i >= n) return;
      const was = s.active;
      s.active = i;
      if (segs.length) {
        for (let j = Math.max(0, Math.min(was, i)); j < segs.length; j += 1) {
          segs[j].classList.toggle('is-done', j < i);
          segs[j].classList.toggle('is-now', j === i);
        }
      } else if (fill) {
        fill.style.setProperty('--p', String((i + 1) / n));
      }
      countEl.textContent = `${i + 1} / ${n}`;
      prevBtn.disabled = i === 0;
      nextBtn.disabled = i === n - 1;
      for (const j of [i - 1, i, i + 1]) loadArt(j);
      syncVideo();
    };

    const leftFor = (i) => {
      const c = cards[i];
      return c ? c.offsetLeft - (track.clientWidth - c.offsetWidth) / 2 : 0;
    };
    const goTo = (i) => {
      const to = Math.max(0, Math.min(n - 1, i));
      track.scrollTo({ left: leftFor(to), behavior: reducedMotion() ? 'auto' : 'smooth' });
      setActive(to);
    };

    // Start at the newest dream, or at the one just opened when coming back from it.
    let start = 0;
    if (resumeId != null) {
      const at = dreams.findIndex((d) => String(d.id) === String(resumeId));
      if (at > 0) start = at;
      resumeId = null;
    }
    if (start) track.scrollLeft = leftFor(start);
    setActive(start);

    if (typeof IntersectionObserver === 'function') {
      // The card in view: at least 60% of it inside the track.
      const seen = new IntersectionObserver((entries) => {
        for (const en of entries) {
          if (en.isIntersecting && en.intersectionRatio >= 0.6) setActive(Number(en.target.dataset.bvsI));
        }
      }, { root: track, threshold: [0.6] });
      // Pictures: the card in view and one card either side.
      const near = new IntersectionObserver((entries) => {
        for (const en of entries) {
          if (!en.isIntersecting) continue;
          near.unobserve(en.target);
          loadArt(Number(en.target.dataset.bvsI));
        }
      }, { root: track, rootMargin: '0px 100%' });
      // The whole track scrolled off the page: the video waits.
      const page = new IntersectionObserver(([en]) => {
        const visible = Boolean(en?.isIntersecting) && en.intersectionRatio >= 0.3;
        if (visible === s.trackVisible) return;
        s.trackVisible = visible;
        syncVideo();
      }, { threshold: [0, 0.3, 0.6] });
      for (const c of cards) { seen.observe(c); near.observe(c); }
      page.observe(track);
      s.observers.push(seen, near, page);
    } else {
      on(track, 'scroll', () => {
        if (s.raf) return;
        s.raf = requestAnimationFrame(() => {
          s.raf = 0;
          const mid = track.scrollLeft + track.clientWidth / 2;
          let best = 0;
          for (let j = 0; j < n; j += 1) {
            if (Math.abs(cards[j].offsetLeft + cards[j].offsetWidth / 2 - mid) < Math.abs(cards[best].offsetLeft + cards[best].offsetWidth / 2 - mid)) best = j;
          }
          setActive(best);
        });
      }, { passive: true });
    }

    on(root, 'click', (ev) => {
      const b = ev.target.closest('button');
      if (!b || !root.contains(b)) return;
      if (b.dataset.bvsStep) {
        goTo(s.active + Number(b.dataset.bvsStep));
      } else if (b.dataset.bvsOpen) {
        const d = dreams[Number(b.dataset.bvsOpen)];
        if (!d) return;
        resumeId = d.id;
        navigate?.(`#dream/${encodeURIComponent(d.id)}`);
      } else if (b.dataset.bvsWatch) {
        const i = Number(b.dataset.bvsWatch);
        const d = dreams[i];
        if (!d || !hasVideo(d)) return;
        s.playerOpen = true;
        syncVideo(); // pause the muted loop behind the player
        openVideoPlayer(d, { poster: cards[i].querySelector('.bv-stories-img')?.getAttribute('src') || artURL(d) });
        if (!document.body.classList.contains('vplayer-open')) { s.playerOpen = false; syncVideo(); return; }
        // The player has no close callback: watch for it taking its body class away, then carry on.
        const mo = new MutationObserver(() => {
          if (document.body.classList.contains('vplayer-open')) return;
          mo.disconnect();
          s.observers = s.observers.filter((o) => o !== mo);
          if (live !== s) return;
          s.playerOpen = false;
          syncVideo();
        });
        mo.observe(document.body, { attributes: true, attributeFilter: ['class'] });
        s.observers.push(mo);
      }
    });

    // Arrow keys step through the cards, unless typing in a field, in a dialog (filters), or the video player is open.
    on(document, 'keydown', (ev) => {
      if (ev.defaultPrevented || ev.altKey || ev.ctrlKey || ev.metaKey || ev.shiftKey || !root.isConnected) return;
      const t = ev.target instanceof Element ? ev.target : null;
      if (t?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="dialog"]')) return;
      if (document.body.classList.contains('vplayer-open')) return;
      const inside = Boolean(t && root.contains(t));
      let to = null;
      if (ev.key === 'ArrowRight') to = s.active + 1;
      else if (ev.key === 'ArrowLeft') to = s.active - 1;
      else if (inside && ev.key === 'Home') to = 0;
      else if (inside && ev.key === 'End') to = n - 1;
      if (to === null) return;
      ev.preventDefault();
      goTo(to);
    });

    on(document, 'visibilitychange', syncVideo);

    // A picture that can't load (offline, removed) shows the dream's painting instead. 'error' doesn't bubble.
    on(root, 'error', (ev) => {
      const img = ev.target;
      if (!img?.classList?.contains('bv-stories-img') || img.dataset.fallback) return;
      img.dataset.fallback = '1';
      const d = dreams[Number(img.closest('[data-bvs-i]')?.dataset.bvsI)];
      if (!d || !hasImage(d)) return;
      const url = artURL({ ...d, image: null });
      if (url) img.src = url;
    }, true);
  },

  destroy() {
    cleanup();
  },
};
