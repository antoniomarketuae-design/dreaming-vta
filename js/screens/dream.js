// One dream (#dream/<id>): its picture, title and markers, then three tabs — Story · Details · Sleep —
// and an "Analyze" button that asks for the interpretation (beta). Sleep times are edited right here;
// everything else is edited in the editor (#record/edit/<id>).
// Routes: #dream/<id> · #dream/<id>/analyze (opens and starts Analyze) · #dream/<id>/edit (old link → editor).
// AI images (js/images.js): "Visualise as image" / "New image" on the picture, and Analyze also asks for one when the
// plan allows it; the interpretation card opens with that picture.
// AI videos (js/videos.js, Plus): "Visualise as video" / "New video" on the picture. A finished video plays muted and
// looping on the picture (tap → full-screen player with sound); the interpretation card links to it too.
// New layout only (js/layout.js; the page root gets .dream--new):
// - the dream type is a square under the title holding four small square tiles (general / lucid / nightmare /
//   prophetic, glyphs and colours from b/types.js); the chosen one glows in its colour, and its full name, one line and
//   "Recurring" sit to the right. One tap (or the arrow keys: a radiogroup with one tab stop) saves via setDreamType;
// - Story · Details · Sleep are three round glowing icon buttons with labels under them (same tablist / tab logic);
// - "Your day before" in Story: the day-journal note of the day before the dream, with words both share;
// - the date line also names the weekday ("09/11/2026 · 3 days ago · Monday").
// The current (classic) layout keeps the nightmare / lucid badges and the plain text tabs.
import { getDream, updateDream, deleteDream, withDefaults, SYMBOL_CATEGORIES, setSetting, getDayNote, setDayNote, localDay } from '../store.js';
import { isNewLayout } from '../layout.js';
import { dreamType, setDreamType, dreamDay } from '../symbols.js';
import { TYPE_LOOK, TYPE_IDS, RECURRING_LOOK, glyph } from './b/types.js';
import { TAGS } from '../analyze.js';
import { esc, formatDate, relativeDay, relativeDayWeekday, icons } from '../ui.js';
import { dreamArtURL } from '../dreamart.js';
import { isEnabled, isPending, isStale, requestInterpretation, sendFeedback, startPolling } from '../interpret.js';
import { hasFeature, remaining, openPaywall, handleLimit, getAccount } from '../account.js';
import {
  createImage, pollImage, resumePendingImages, dismissImageError, hasImage, isImageFailed, isPainting,
  imagesAllowed, imagesBlocked, imageBadge, hasImageConsent, giveImageConsent,
} from '../images.js';
import {
  createVideo, pollVideo, dismissVideoError, hasVideo, isVideoFailed, isFilming, videosBlocked, videoBadge,
  videoElapsed, videoWaitText, openVideoPlayer,
} from '../videos.js';
import { openVideoPicker } from '../videopicker.js';

const STOP = new Set('that this with from have were they them then there their what when where which while would could should about after again also been before being because into just like more most much only other over some such than very will your yours mine ours really thing things something nothing everything maybe still back down even ever every here know made make many might never next once same seem seemed take took went going gone came come into onto upon under felt feel feeling dream dreamed dreamt dreaming woke wake today yesterday night morning evening'.split(' '));
const stem = (w) => w.replace(/(ings?|ed|es|s)$/, '').replace(/(.)\1$/, '$1');

/** Words a day note and a dream share (up to 6), in the order they appear in the note. */
function sharedWords(note, text) {
  const words = (t) => (String(t).toLowerCase().match(/[a-z']+/g) || []).filter((w) => w.length >= 4 && !STOP.has(w));
  const inDream = new Set(words(text).map(stem));
  const out = [];
  for (const w of words(note)) {
    if (inDream.has(stem(w)) && !out.some((o) => stem(o) === stem(w))) out.push(w);
    if (out.length === 6) break;
  }
  return out;
}

/** The dream's picture: its AI image when it has one, else the generated painting. */
function artSrc(dream) {
  try { return dreamArtURL(dream, 420) || ''; } catch { return ''; }
}

/** Always the generated painting (fallback when an AI image can't load, e.g. offline). */
function paintedSrc(dream) {
  try { return dreamArtURL({ ...dream, image: null }, 420) || ''; } catch { return ''; }
}

/** "Uses your free AI image for this month." etc. for the image consent sheet. */
function imageCostLine() {
  const left = remaining('images');
  if (!hasFeature('images') && left === 1) return 'Uses your free AI image for this month.';
  if (left != null && left > 0) return `Uses 1 of the ${left} AI images you have left this month.`;
  return "Uses one of this month's AI images.";
}

/** Small label inside a tool on the picture: 'PLUS' (gold outline), '4 left', or nothing. */
const heroBadge = (badge) => (badge
  ? `<span class="dream-hero-badge${badge === 'PLUS' ? ' dream-hero-badge-plus' : ''}">${esc(badge)}</span>` : '');

/** A failed image or video on the picture: the reason, "Try again" (data-act) and × (data-act + '-dismiss'). */
const heroFailHTML = (icon, message, act) => `
  <div class="dream-hero-fail" role="alert">
    <span class="dream-hero-fail-ico" aria-hidden="true">${icon}</span>
    <p>${esc(message)}</p>
    <div class="dream-hero-fail-btns">
      <button type="button" class="dream-hero-btn" data-act="${act}">${icons.shuffle}<span>Try again</span></button>
      <button type="button" class="dream-hero-x" data-act="${act}-dismiss" aria-label="Dismiss">${icons.close}</button>
    </div>
  </div>`;

/** The phone asks for less motion: a still picture with a play button instead of the moving preview. */
const reducedMotion = () => {
  try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
};

/** Stops the preview video on the picture and lets go of its download. */
function stopPreview(layer) {
  const video = layer?.querySelector('video');
  if (!video) return;
  try {
    video.pause();
    video.removeAttribute('src');
    video.load();
  } catch {}
}

// ---- New layout: the dream type (looks shared with the Journal in b/types.js) and the three section buttons ----

/** The dream's type as one of the four squares (general when it is something types.js doesn't know). */
const typeOf = (dream) => {
  const t = dreamType(dream);
  return TYPE_LOOK[t] ? t : 'general';
};

/** Story (an open book), Details (sliders), Sleep (a moon with a "z"). */
const TAB_GLYPHS = {
  story: glyph('<path d="M12 6.8C10.2 5.4 7.8 4.8 4 4.8v12.6c3.8 0 6.2.6 8 2 1.8-1.4 4.2-2 8-2V4.8c-3.8 0-6.2.6-8 2z"/><path d="M12 6.8v12.6"/>'),
  details: glyph('<path d="M4 6.5h8M16 6.5h4M4 12h2M10 12h10M4 17.5h10M18 17.5h2"/><circle cx="14" cy="6.5" r="2"/><circle cx="8" cy="12" r="2"/><circle cx="16" cy="17.5" r="2"/>'),
  sleep: glyph('<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/><path d="M15 3.5h4l-4 4.5h4"/>'),
};

const str = (v) => (typeof v === 'string' ? v.trim() : '');
const arr = (v) => (Array.isArray(v) ? v : []);
const dayDate = (iso) => new Date(`${iso}T00:00:00`);

/**
 * Locale-based numeric date ("10.11.2026", "10/11/2026", ...) plus "Today"/"Yesterday"/"N days ago".
 * `weekday` (new layout): "09/11/2026 · 3 days ago · Monday" within the last week, else "02/11/2026 · Monday".
 */
function whenLabel(iso, weekday = false) {
  if (!iso) return '';
  const d = dayDate(iso);
  if (Number.isNaN(d.getTime())) return '';
  const num = d.toLocaleDateString(undefined, { day: '2-digit', month: '2-digit', year: 'numeric' });
  const rel = relativeDay(iso);
  const recent = rel && rel !== formatDate(iso); // today … 6 days ago
  if (weekday) return `${num} · ${recent ? relativeDayWeekday(iso) : d.toLocaleDateString(undefined, { weekday: 'long' })}`;
  return recent ? `${num} · ${rel}` : num;
}

const longDate = (iso) => {
  const d = iso ? dayDate(iso) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }) : '';
};

// ---- Display helpers for the Story / Details / Sleep tabs ----

const CATEGORY_LABELS = { people: 'People', objects: 'Objects', characters: 'Characters', places: 'Places', themes: 'Themes', actions: 'Actions' };

const SCALES = {
  rating: ['Very bad', 'Bad', 'Okay', 'Good', 'Very good'],
  length: ['Very short', 'Short', 'Medium', 'Long', 'Very long'],
  quality: ['Very poor', 'Poor', 'Okay', 'Good', 'Very good'],
  vividness: ['Very vague', 'Vague', 'Clear', 'Vivid', 'Very vivid'],
};

const level = (v) => (Number.isInteger(v) && v >= 1 && v <= 5 ? v : null);

function dots(value, scale) {
  const v = level(value);
  if (!v) return '<span class="dream-unset">Not set</span>';
  const marks = [1, 2, 3, 4, 5].map((i) => `<i class="dream-dot${i <= v ? ' dream-dot-on' : ''}"></i>`).join('');
  return `<span class="dream-dots" role="img" aria-label="${v} of 5">${marks}</span><span class="dream-dots-word">${esc(SCALES[scale][v - 1])}</span>`;
}

const yesNo = (v) => (v === true ? '<span class="dream-yes">Yes</span>'
  : v === false ? '<span class="dream-no">No</span>'
    : '<span class="dream-unset">Not answered</span>');

const row = (label, value) => `<div class="dream-row"><span class="dream-row-label">${label}</span><span class="dream-row-value">${value}</span></div>`;

const chip = (text) => `<span class="chip">${esc(text)}</span>`;
const tagChip = (id) => (TAGS[id] ? `<span class="chip" style="--hue:${TAGS[id].hue}">${esc(TAGS[id].label)}</span>` : '');

/** "23:30" → minutes after midnight, or null. */
function minutesOf(hhmm) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(hhmm ?? ''));
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h < 24 && min < 60 ? h * 60 + min : null;
}

/** "7:05" → "07:05" (what <input type="time"> needs), or ''. */
function hhmm(v) {
  const m = minutesOf(v);
  return m == null ? '' : `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** Time asleep between bedtime and wake (crossing midnight), "7 h 40 min", or ''. */
function sleepLength(bedtime, wake) {
  const a = minutesOf(bedtime);
  const b = minutesOf(wake);
  if (a == null || b == null) return '';
  const diff = (b - a + 1440) % 1440;
  const h = Math.floor(diff / 60);
  const m = diff % 60;
  return h && m ? `${h} h ${m} min` : h ? `${h} h` : `${m} min`;
}

const qualityOf = (dream) => level(dream.sleep.quality) ?? level(dream.ratings.sleep);

// ---- Interpretation (beta). Every string from the server goes through esc(). ----

/** 'animal.dog' → 'Dog · animal';  'place.old_school' → 'Old school · place' */
function prettyEntry(id) {
  const raw = String(id ?? '').trim();
  const dot = raw.indexOf('.');
  const group = dot > 0 ? raw.slice(0, dot).replace(/[_-]+/g, ' ') : '';
  const name = (dot > 0 ? raw.slice(dot + 1) : raw).replace(/[._-]+/g, ' ').trim();
  const nice = name ? name[0].toUpperCase() + name.slice(1) : raw;
  return group ? `${nice} · ${group}` : nice;
}

const PERSPECTIVES = [['psychology', 'Psychology'], ['freud', 'Freud'], ['traditional', 'Traditional']];

const interpHead = (label) => `<h2 class="dream-interp-h">${label}</h2>`;

function itemList(items) {
  const rows = arr(items)
    .filter((x) => x && (str(x.name) || str(x.meaning)))
    .map((x) => `
      <li class="dream-interp-item">
        ${str(x.name) ? `<span class="dream-interp-name">${esc(str(x.name))}</span>` : ''}
        ${str(x.meaning) ? `<p class="dream-interp-meaning">${esc(str(x.meaning))}</p>` : ''}
      </li>`).join('');
  return rows ? `<ul class="dream-interp-list">${rows}</ul>` : '';
}

function timeOf(iso) {
  const d = iso ? new Date(iso) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : '';
}

// Stops the interpretation poller, timers and the video preview when leaving the screen. Module state only; nothing
// runs at import.
let cleanup = null;

export default {
  id: 'dream',
  hideTabbar: true,

  render(el, ctx, param) {
    const [id, sub] = String(param ?? '').split('/');

    // Old links (#dream/<id>/edit) now open the full editor.
    if (sub === 'edit' && id) {
      location.replace(`#record/edit/${encodeURIComponent(id)}`);
      return;
    }

    const goBack = () => (ctx.back ? ctx.back() : history.back());
    let tab = 'story';
    let stopPoll = null;
    let asking = false;        // a request is being sent
    let feedbackBusy = false;  // a rating/note is being sent
    let noteOpen = false;      // show the optional note field right after rating
    let perspKey = 'psychology';
    let savedTimer = null;
    let clock = null;          // ticks the "1:23" of a video being made

    cleanup?.();
    // Image, video and account changes can arrive while this page is open (or after leaving and coming back).
    const onImageEvent = (e) => { if (e?.detail?.dreamId === id && root.isConnected) paintImage(); };
    const onVideoEvent = (e) => { if (e?.detail?.dreamId === id && root.isConnected) paintVideo(); };
    const onAccountEvent = () => { if (root.isConnected) { paintBar(); paintImage(); paintVideo(); } };
    window.addEventListener('dreaming:image', onImageEvent);
    window.addEventListener('dreaming:video', onVideoEvent);
    window.addEventListener('dreaming:account', onAccountEvent);
    cleanup = () => {
      stopPolling();
      clearTimeout(savedTimer);
      stopClock();
      stopPreview(root.querySelector('[data-hero-video]'));
      window.removeEventListener('dreaming:image', onImageEvent);
      window.removeEventListener('dreaming:video', onVideoEvent);
      window.removeEventListener('dreaming:account', onAccountEvent);
    };

    let editingDay = false; // new layout: the day-before note is being written
    const root = document.createElement('div');
    root.className = 'dream';
    el.innerHTML = '';
    el.append(root);

    const read = () => {
      const raw = getDream(id);
      return raw ? withDefaults(raw) : null;
    };

    // ---- Page ----

    function show() {
      stopPolling();
      const dream = read();
      if (!dream) {
        root.innerHTML = `
          <header class="screen-header">
            <button type="button" class="icon-btn" data-act="back" aria-label="Back">${icons.back}</button>
          </header>
          <div class="glass dream-missing">
            <p class="dream-missing-title">This dream has drifted away.</p>
            <p class="muted">It may have been deleted, or the link is out of date.</p>
            <a class="btn btn-ghost" href="#journal">${icons.journal}<span>Open the journal</span></a>
          </div>`;
        return;
      }

      const src = artSrc(dream);
      const hue = TAGS[dream.tags?.[0]]?.hue ?? 260;
      const nightmare = dream.kind === 'nightmare';
      // The new layout shows the type as a square of four tiles instead of the nightmare / lucid badges ("Recurring"
      // moves next to it), and the sections as three glowing icon buttons.
      const typed = isNewLayout();
      root.classList.toggle('dream--new', typed);
      const badges = [
        nightmare && !typed ? `<span class="chip dream-badge-nightmare">${icons.flame}<span>Nightmare</span></span>` : '',
        dream.lucid && !typed ? `<span class="chip dream-badge-mark"><span class="star-mark">${icons.star}</span>Lucid</span>` : '',
        dream.recurring ? `<span class="chip dream-badge-mark">${icons.repeat}<span>Recurring</span></span>` : '',
      ].join('');
      const TABS = [['story', 'Story'], ['details', 'Details'], ['sleep', 'Sleep']];

      root.innerHTML = `
        <div class="dream-hero${nightmare ? ' dream-hero-nightmare' : ''}" style="--glow:${hue}">
          ${src ? `<img class="dream-hero-img" src="${esc(src)}" alt="${hasImage(dream) ? 'An AI image of this dream' : 'A picture painted from this dream'}" width="420" height="420">` : ''}
          <div class="dream-hero-paint" data-hero-paint></div>
          <div class="dream-hero-bar">
            <button type="button" class="icon-btn" data-act="back" aria-label="Back">${icons.back}</button>
            <span class="dream-hero-gap"></span>
            <button type="button" class="icon-btn" data-act="share" aria-label="Share">${icons.share}</button>
            <button type="button" class="icon-btn" data-act="edit" aria-label="Edit">${icons.edit}</button>
          </div>
        </div>

        <p class="dream-date">${esc(whenLabel(dream.date, typed))}</p>
        <h1 class="dream-title">${esc(dream.title || 'Untitled dream')}</h1>
        ${typed ? typeSquareHTML(dream) : badges ? `<div class="dream-badges">${badges}</div>` : ''}

        <div class="dream-tabs" role="tablist" aria-label="Dream sections">
          ${TABS.map(([k, label]) => `<button type="button" role="tab" class="dream-tab" id="dream-tab-${k}" data-act="tab" data-tab="${k}" aria-controls="dream-panel-${k}" aria-selected="${k === tab}">${typed ? `<span class="dream-tab-orb" aria-hidden="true">${TAB_GLYPHS[k]}</span><span class="dream-tab-label">${label}</span>` : label}</button>`).join('')}
        </div>
        ${TABS.map(([k]) => `<section class="dream-panel" id="dream-panel-${k}" role="tabpanel" aria-labelledby="dream-tab-${k}" data-panel="${k}" ${k === tab ? '' : 'hidden'}></section>`).join('')}

        <div class="dream-interp" data-interp aria-live="polite"></div>

        <button type="button" class="btn btn-danger dream-delete" data-act="delete">${icons.trash}<span>Delete dream</span></button>

        <div class="dream-bar" data-bar></div>`;

      paintPanels(dream);
      paintHero(dream);
      paintInterp();
    }

    // ---- AI image: tools on the picture (shared with the video), shimmer while painting, failure + retry ----

    function paintImage() {
      paintHero();
      const box = root.querySelector('[data-interp-pic]');
      if (box) box.innerHTML = interpPicHTML(read());
    }

    function paintHero(dream = read()) {
      const hero = root.querySelector('.dream-hero');
      if (!dream || !hero) return;
      // Swap in the AI image when it arrives (or a newer one).
      const src = artSrc(dream);
      let img = hero.querySelector('.dream-hero-img');
      if (src && !img) {
        img = document.createElement('img');
        img.className = 'dream-hero-img';
        img.width = 420;
        img.height = 420;
        hero.prepend(img);
      }
      if (img && src && img.getAttribute('src') !== src && !(img.dataset.fallback && img.dataset.failed === src)) {
        img.src = src;
        delete img.dataset.fallback;
      }
      if (img) img.alt = hasImage(dream) ? 'An AI image of this dream' : 'A picture painted from this dream';

      paintHeroVideo(hero, dream);
      // While something is being made the middle of the picture shows its progress, so the play button steps aside.
      hero.classList.toggle('dream-hero-busy', isPainting(dream) || isFilming(dream));
      const slot = hero.querySelector('[data-hero-paint]');
      if (slot) slot.innerHTML = heroToolsHTML(dream);
    }

    function heroToolsHTML(dream) {
      const painting = isPainting(dream);
      const filming = isFilming(dream);
      const imageFailed = !painting && isImageFailed(dream);
      const videoFailed = !filming && isVideoFailed(dream);
      // An image and a video can be made at the same time: one shimmer, both statuses stacked in the middle.
      const status = painting || filming ? `
        <div class="dream-hero-shimmer" aria-hidden="true"></div>
        <div class="dream-hero-status${painting && filming ? ' dream-hero-status-two' : ''}" role="status">
          <span class="dream-hero-status-icon" aria-hidden="true">${painting ? icons.moon : icons.film}</span>
          ${painting ? `
            <p class="dream-hero-status-title">Creating your dream image…</p>
            <p class="dream-hero-status-note">This can take up to a minute. You can leave this screen.</p>` : ''}
          ${filming ? `
            <p class="dream-hero-status-title${painting ? ' dream-hero-status-next' : ''}">Creating your dream video…
              <span class="dream-hero-elapsed" data-video-elapsed aria-hidden="true">${esc(videoElapsed(dream))}</span></p>
            <p class="dream-hero-status-note">${esc(videoWaitText(dream))}</p>` : ''}
        </div>` : '';
      const fails = [
        imageFailed ? heroFailHTML(icons.image, dream.imageJob.error || "The image didn't work this time.", 'image') : '',
        videoFailed ? heroFailHTML(icons.film, dream.videoJob.error || "The video didn't work this time.", 'video') : '',
      ].join('');
      const btns = [
        painting || imageFailed ? '' : imageBtnHTML(dream),
        filming || videoFailed ? '' : videoBtnHTML(dream),
      ].join('');
      // What the picture is showing, quietly in the corner (not while something new is being made).
      const mark = painting || filming ? ''
        : hasVideo(dream) ? `<span class="dream-hero-mark">${icons.film}<span>Dream video</span></span>`
          : hasImage(dream) ? `<span class="dream-hero-mark">${icons.sparkle}<span>AI image</span></span>` : '';
      if (!fails && !btns && !mark) return status;
      return `${status}
        <div class="dream-hero-tools">
          ${fails}
          ${btns || mark ? `<div class="dream-hero-tools-row">${mark}<div class="dream-hero-btns">${btns}</div></div>` : ''}
        </div>`;
    }

    function imageBtnHTML(dream) {
      const has = hasImage(dream);
      return `
        <button type="button" class="dream-hero-btn" data-act="image">
          ${has ? icons.shuffle : icons.sparkle}<span>${has ? 'New image' : 'Visualise as image'}</span>
          ${heroBadge(imagesBlocked() ? 'PLUS' : imageBadge())}
        </button>`;
    }

    function videoBtnHTML(dream) {
      return `
        <button type="button" class="dream-hero-btn" data-act="video">
          ${icons.film}<span>${hasVideo(dream) ? 'New video' : 'Visualise as video'}</span>
          ${heroBadge(videoBadge())}
        </button>`;
    }

    /** Top of the interpretation card: the AI image, a shimmer while it's painted, or an offer to make one. */
    function interpPicHTML(dream) {
      if (!dream) return '';
      const painting = isPainting(dream);
      if (hasImage(dream) && !painting) {
        return `
          <figure class="dream-interp-pic">
            <img src="${esc(dream.image.url)}" alt="An AI image of this dream">
            <figcaption class="dream-interp-pic-cap">${icons.sparkle}<span>AI image</span></figcaption>
          </figure>`;
      }
      if (painting) {
        const under = artSrc(dream);
        return `
          <figure class="dream-interp-pic dream-interp-pic-wait" role="status">
            ${under ? `<img src="${esc(under)}" alt="">` : ''}
            <span class="dream-interp-pic-shimmer" aria-hidden="true"></span>
            <figcaption class="dream-interp-pic-wait-cap">Creating your dream image…</figcaption>
          </figure>`;
      }
      if (isImageFailed(dream)) {
        return `
          <div class="dream-interp-imgrow">
            <span class="dream-interp-imgrow-ico" aria-hidden="true">${icons.image}</span>
            <span class="dream-interp-imgrow-text">${esc(dream.imageJob.error || "The image didn't work this time.")}</span>
            <button type="button" class="dream-interp-imgbtn" data-act="image">Try again</button>
          </div>`;
      }
      if (imagesBlocked()) {
        return `
          <button type="button" class="dream-interp-imgrow dream-interp-upsell" data-act="image-plus">
            <span class="dream-interp-imgrow-ico" aria-hidden="true">${icons.image}</span>
            <span class="dream-interp-imgrow-text">Add an AI image of this dream</span>
            <span class="dream-interp-plus">PLUS</span>
          </button>`;
      }
      const badge = imageBadge();
      return `
        <div class="dream-interp-imgrow">
          <span class="dream-interp-imgrow-ico" aria-hidden="true">${icons.image}</span>
          <span class="dream-interp-imgrow-text">Add an AI image of this dream${badge ? ` <span class="dream-interp-left">${esc(badge)}</span>` : ''}</span>
          <button type="button" class="dream-interp-imgbtn" data-act="image">Create</button>
        </div>`;
    }

    /** "Visualise as image" / "New image" / "Try again". */
    function onImage() {
      const dream = getDream(id);
      if (!dream || isPainting(dream)) return;
      if (imagesBlocked()) { openPaywall({ feature: 'images' }); return; }
      if (!hasImageConsent()) { openImageConsent(); return; }
      createImage(dream, { toast: ctx.toast }); // repaints through the 'dreaming:image' event
    }

    /** After Analyze: also paint the dream when the plan allows it and the user agreed to images. */
    function autoImage() {
      const dream = getDream(id);
      if (!dream || hasImage(dream) || isPainting(dream)) return;
      if (!imagesAllowed() || !hasImageConsent()) { paintImage(); return; } // the card offers it instead
      createImage(dream, { toast: ctx.toast, auto: true });
    }

    function openImageConsent() {
      closeConsent();
      const sheet = document.createElement('div');
      sheet.className = 'dream-sheet';
      sheet.dataset.sheet = '';
      sheet.innerHTML = `
        <div class="dream-sheet-scrim" data-act="sheet-close"></div>
        <div class="glass dream-sheet-card" role="dialog" aria-modal="true" aria-labelledby="dream-sheet-title">
          <div class="dream-sheet-icon" aria-hidden="true">${icons.image}</div>
          <h2 class="dream-sheet-title" id="dream-sheet-title">Create an image of this dream?</h2>
          <ul class="dream-sheet-points">
            <li>${icons.share}<span>This dream's text, title and tags are sent to Dreaming's server, where an AI image service turns it into a lifelike picture.</span></li>
            <li>${icons.lock}<span>The rest of your journal stays on this iPhone. The picture is kept on Dreaming's server behind a private link.</span></li>
            <li>${icons.sparkle}<span>${esc(imageCostLine())} If it fails, it isn't counted.</span></li>
          </ul>
          <button type="button" class="btn" data-act="image-consent-yes">${icons.check}<span>Agree and create</span></button>
          <button type="button" class="btn btn-ghost" data-act="sheet-close">Not now</button>
        </div>`;
      root.append(sheet);
      sheet.querySelector('[data-act="image-consent-yes"]')?.focus();
    }

    // ---- AI video: preview on the picture, progress, failure + retry, the full-screen player ----

    function paintVideo() {
      paintHero();
      const box = root.querySelector('[data-interp-video]');
      if (box) box.innerHTML = interpVideoHTML(read());
      tickClock();
    }

    /** What the video shows before it plays: the picture on the page (after any offline fallback). */
    function posterSrc(dream) {
      return root.querySelector('.dream-hero-img')?.getAttribute('src') || artSrc(dream);
    }

    /**
     * The dream's video on the picture, under the tools: muted and looping (a still with a play button when the
     * phone asks for less motion). Built once per video, so repaints don't restart it. Tap → the player.
     */
    function paintHeroVideo(hero, dream) {
      let layer = hero.querySelector('[data-hero-video]');
      const url = hasVideo(dream) ? dream.video.url : '';
      if (layer && layer.dataset.url !== url) {
        stopPreview(layer);
        layer.remove();
        layer = null;
      }
      if (!url) return;
      const poster = posterSrc(dream);
      if (!layer) {
        layer = document.createElement('div');
        layer.className = 'dream-hero-video';
        layer.dataset.heroVideo = '';
        layer.dataset.url = url;
        layer.dataset.act = 'video-play';
        layer.innerHTML = `
          ${reducedMotion() ? '' : `<video class="dream-hero-vid" src="${esc(url)}" muted loop playsinline autoplay preload="metadata" aria-hidden="true"></video>`}
          <button type="button" class="dream-hero-play" data-act="video-play" aria-label="Play the dream video">${icons.play}</button>`;
        hero.querySelector('[data-hero-paint]')?.before(layer);
        const video = layer.querySelector('video');
        if (video) {
          if (poster) video.poster = poster; // may be a long data: address, so set it here, not in the markup
          video.muted = true;
          video.play().catch(() => {}); // autoplay refused (Low Power Mode): the still picture and play button stay
        }
        return;
      }
      // Same video, maybe a new picture (a new AI image, or the painting after an offline fallback).
      const video = layer.querySelector('video');
      if (video && poster && video.getAttribute('poster') !== poster) video.poster = poster;
    }

    /** Under the picture in the interpretation card: the dream's video, its progress, or an offer to make one. */
    function interpVideoHTML(dream) {
      if (!dream) return '';
      const filming = isFilming(dream);
      if (hasVideo(dream) && !filming) {
        const thumb = artSrc(dream);
        const secs = Math.round(Number(dream.video.seconds) || 0);
        return `
          <button type="button" class="dream-interp-imgrow dream-interp-vidrow" data-act="video-play">
            <span class="dream-interp-vthumb" aria-hidden="true">
              ${thumb ? `<img src="${esc(thumb)}" alt="">` : ''}
              <span class="video-mark">${icons.play}</span>
            </span>
            <span class="dream-interp-imgrow-text">
              <span class="dream-interp-vtitle">Watch your dream video</span>
              <span class="dream-interp-vsub">${secs ? `${secs} seconds, with sound` : 'With sound'}</span>
            </span>
            <span class="dream-interp-vgo" aria-hidden="true">${icons.chevronRight}</span>
          </button>`;
      }
      if (filming) {
        return `
          <div class="dream-interp-imgrow" role="status">
            <span class="dream-interp-imgrow-ico dream-interp-vbusy" aria-hidden="true">${icons.film}</span>
            <span class="dream-interp-imgrow-text">Creating your dream video…
              <span class="dream-interp-left dream-interp-time" data-video-elapsed aria-hidden="true">${esc(videoElapsed(dream))}</span></span>
          </div>`;
      }
      if (isVideoFailed(dream)) {
        return `
          <div class="dream-interp-imgrow">
            <span class="dream-interp-imgrow-ico" aria-hidden="true">${icons.film}</span>
            <span class="dream-interp-imgrow-text">${esc(dream.videoJob.error || "The video didn't work this time.")}</span>
            <button type="button" class="dream-interp-imgbtn" data-act="video">Try again</button>
          </div>`;
      }
      if (!hasFeature('videos')) {
        return `
          <button type="button" class="dream-interp-imgrow dream-interp-upsell" data-act="video-plus">
            <span class="dream-interp-imgrow-ico" aria-hidden="true">${icons.film}</span>
            <span class="dream-interp-imgrow-text">Turn this dream into a video</span>
            <span class="dream-interp-plus">PLUS</span>
          </button>`;
      }
      const badge = videoBadge();
      return `
        <div class="dream-interp-imgrow">
          <span class="dream-interp-imgrow-ico" aria-hidden="true">${icons.film}</span>
          <span class="dream-interp-imgrow-text">Turn this dream into a video${badge ? ` <span class="dream-interp-left">${esc(badge)}</span>` : ''}</span>
          <button type="button" class="dream-interp-imgbtn" data-act="video">Create</button>
        </div>`;
    }

    /** "Visualise as video" / "New video" / "Try again". */
    function onVideo() {
      const dream = getDream(id);
      if (!dream || isFilming(dream)) return;
      if (videosBlocked()) { createVideo(dream, { toast: ctx.toast }); return; } // opens the paywall itself
      // Length, quality and "start from the AI photo"; it also says what is sent, so Create counts as agreeing.
      openVideoPicker(dream, { toast: ctx.toast }); // repaints through the 'dreaming:video' event
    }

    /** The full-screen player. Runs right inside the tap, so iOS lets the sound play. */
    function onPlay() {
      const dream = getDream(id);
      if (!hasVideo(dream)) return;
      openVideoPlayer(dream, { poster: posterSrc(dream) });
    }

    /** Keeps the "1:23" next to "Creating your dream video…" current; stops by itself when the video is done. */
    function tickClock() {
      const dream = getDream(id);
      if (!root.isConnected || !isFilming(dream)) { stopClock(); return; }
      if (!clock) clock = setInterval(tickClock, 1000);
      const t = videoElapsed(dream);
      for (const n of root.querySelectorAll('[data-video-elapsed]')) if (n.textContent !== t) n.textContent = t;
    }

    function stopClock() {
      clearInterval(clock);
      clock = null;
    }

    function paintPanels(dream = read()) {
      if (!dream) return;
      const p = (k) => root.querySelector(`[data-panel="${k}"]`);
      p('story').innerHTML = storyHTML(dream);
      p('details').innerHTML = detailsHTML(dream);
      p('sleep').innerHTML = sleepHTML(dream);
    }

    function selectTab(next) {
      tab = next;
      for (const t of root.querySelectorAll('[data-act="tab"]')) t.setAttribute('aria-selected', String(t.dataset.tab === tab));
      for (const panel of root.querySelectorAll('[data-panel]')) panel.hidden = panel.dataset.panel !== tab;
    }

    // ---- Story: the full text, symbols per category, emotions ----

    function storyHTML(dream) {
      const groups = SYMBOL_CATEGORIES
        .map((c) => [c, arr(dream.symbols[c]).map((s) => String(s ?? '').trim()).filter(Boolean)])
        .filter(([, list]) => list.length);
      const emotions = arr(dream.emotions).map((e) => String(e ?? '').trim()).filter(Boolean);
      const tags = arr(dream.tags).filter((t) => TAGS[t]);

      const symbols = groups.length ? `
        <h2 class="section-title">Symbols</h2>
        <div class="glass dream-card dream-groups">
          ${groups.map(([c, list]) => `
            <div class="dream-group">
              <p class="dream-group-label">${CATEGORY_LABELS[c] || esc(c)}</p>
              <div class="dream-chips">${list.map(chip).join('')}</div>
            </div>`).join('')}
        </div>` : '';

      const feelings = emotions.length ? `
        <h2 class="section-title">Emotions</h2>
        <div class="dream-chips">${emotions.map((e) => `<span class="chip dream-emotion">${esc(e)}</span>`).join('')}</div>` : '';

      const noticed = tags.length ? `
        <h2 class="section-title">Noticed in the text</h2>
        <div class="dream-chips">${tags.map(tagChip).join('')}</div>` : '';

      const empty = !groups.length && !emotions.length ? `
        <p class="dream-hint faint">No symbols or emotions added yet. <button type="button" class="dream-link" data-act="edit">Add them</button></p>` : '';

      return `
        <div class="glass dream-text">${esc(dream.text) || '<span class="faint">No words written for this dream.</span>'}</div>
        ${isNewLayout() ? dayBeforeHTML(dream) : ''}
        ${symbols}${feelings}${noticed}${empty}`;
    }

    // ---- New layout: dream type (a square of four tiles) and the day before ----

    /** The type square under the title: four tiles (a radiogroup, one tab stop) and, to its right, what is chosen. */
    function typeSquareHTML(dream) {
      const cur = typeOf(dream);
      return `
        <div class="dream-typerow">
          <div class="dream-typesq" role="radiogroup" aria-label="Dream type">
            ${TYPE_IDS.map((t) => {
              const look = TYPE_LOOK[t];
              const on = t === cur;
              return `
                <button type="button" class="dream-typesq-tile" role="radio" data-act="type" data-type="${esc(t)}"
                  aria-checked="${on}" tabindex="${on ? 0 : -1}" aria-label="${esc(`${look.name}. ${look.line}`)}" style="--tc: ${esc(look.rgb)}">
                  <span class="dream-typesq-glyph" aria-hidden="true">${look.glyph}</span>
                  <span class="dream-typesq-name" aria-hidden="true">${esc(look.short)}</span>
                </button>`;
            }).join('')}
          </div>
          <div class="dream-typeinfo" data-type-info>${typeInfoHTML(dream)}</div>
        </div>`;
    }

    /** Right of the square: the chosen type's full name and line, "Recurring" when it is, and the hint. */
    function typeInfoHTML(dream) {
      const look = TYPE_LOOK[typeOf(dream)];
      return `
        <p class="dream-typeinfo-kicker">Dream type</p>
        <p class="dream-typeinfo-name" style="--tc: ${esc(look.rgb)}">${esc(look.name)}</p>
        <p class="dream-typeinfo-line">${esc(look.line)}</p>
        ${dream.recurring ? `
          <span class="dream-typeinfo-rec" style="--tc: ${esc(RECURRING_LOOK.rgb)}">
            <span class="dream-typeinfo-rec-glyph" aria-hidden="true">${RECURRING_LOOK.glyph}</span><span>${esc(RECURRING_LOOK.name)}</span>
          </span>` : ''}
        <p class="dream-typeinfo-hint">Tap a square to change</p>`;
    }

    /**
     * A tile tapped (or reached with the arrow keys): save it (setDreamType keeps kind / lucid in step), then move the
     * glow, tab stop and words in place, with a small pop. `focus`: keyboard use, so focus follows the choice.
     */
    function chooseType(type, focus = false) {
      const before = typeOf(read());
      if (!TYPE_LOOK[type] || type === before) return;
      setDreamType(id, type);
      const fresh = read();
      if (!fresh) return;
      const now = typeOf(fresh);
      for (const tile of root.querySelectorAll('[data-act="type"]')) {
        const on = tile.dataset.type === now;
        tile.setAttribute('aria-checked', String(on));
        tile.tabIndex = on ? 0 : -1;
        tile.classList.remove('dream-typesq-pop');
        if (!on) continue;
        void tile.offsetWidth; // restart the pop when the same tile is chosen again later
        tile.classList.add('dream-typesq-pop');
        if (focus) tile.focus();
      }
      const info = root.querySelector('[data-type-info]');
      if (info) {
        info.innerHTML = typeInfoHTML(fresh);
        info.classList.remove('dream-typeinfo-swap');
        void info.offsetWidth;
        info.classList.add('dream-typeinfo-swap');
      }
      root.querySelector('.dream-hero')?.classList.toggle('dream-hero-nightmare', now === 'nightmare');
      const details = root.querySelector('[data-panel="details"]');
      if (details) details.innerHTML = detailsHTML(fresh); // "Type" and "Lucid" rows follow kind / lucid
      ctx.toast?.(`Marked as ${TYPE_LOOK[now].as}`);
    }

    /** Arrow keys in the type square: left / right step through the four, up / down jump a row; each one is chosen. */
    function onTypeKey(e) {
      const tile = e.target.closest?.('[data-act="type"]');
      const step = tile ? { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 2, ArrowUp: -2 }[e.key] : 0;
      if (!step) return;
      e.preventDefault();
      const tiles = [...root.querySelectorAll('[data-act="type"]')];
      const next = tiles[(tiles.indexOf(tile) + step + tiles.length) % tiles.length];
      if (next) chooseType(next.dataset.type, true);
    }

    /** The day before the dream (a dream recorded in the morning follows that day's events). */
    const dayBefore = (dream) => {
      const d = new Date(`${dreamDay(dream)}T12:00:00`);
      d.setDate(d.getDate() - 1);
      return localDay(d);
    };

    function dayBeforeHTML(dream) {
      const day = dayBefore(dream);
      const note = getDayNote(day);
      const when = esc(formatDate(day));
      if (editingDay) {
        return `
          <h2 class="section-title">Your day before</h2>
          <div class="glass dream-card dream-day">
            <p class="dream-day-when">${when}</p>
            <textarea class="field dream-day-input" data-day-input rows="4" maxlength="4000"
              placeholder="What happened that day? Main events, people, feelings…" aria-label="What happened on ${when}">${esc(note)}</textarea>
            <div class="dream-day-actions">
              <button type="button" class="btn" data-act="day-save">${icons.check}<span>Save</span></button>
              <button type="button" class="btn btn-ghost" data-act="day-cancel">Cancel</button>
            </div>
          </div>`;
      }
      if (!note) {
        return `
          <h2 class="section-title">Your day before</h2>
          <div class="glass dream-card dream-day dream-day-empty">
            <p>What happened on ${when}? Dreams often pick up the day before: write a few lines to see what connects.</p>
            <button type="button" class="btn btn-ghost" data-act="day-edit">${icons.edit}<span>Write about that day</span></button>
          </div>`;
      }
      const shared = sharedWords(note, `${dream.title || ''} ${dream.text || ''}`);
      return `
        <h2 class="section-title">Your day before</h2>
        <div class="glass dream-card dream-day">
          <p class="dream-day-when">${when}<button type="button" class="dream-link" data-act="day-edit">Edit</button></p>
          <p class="dream-day-text">${esc(note)}</p>
          ${shared.length ? `
            <p class="dream-day-label">In your day and in this dream</p>
            <div class="dream-chips">${shared.map((w) => `<span class="chip dream-day-chip">${esc(w)}</span>`).join('')}</div>`
            : '<p class="dream-day-label faint">No words in common this time. Connections can be in feelings rather than words.</p>'}
        </div>`;
    }

    // ---- Details: ratings as dots, kind, the yes/no questions, lucidity, notes ----

    function detailsHTML(dream) {
      const notes = str(dream.notes);
      return `
        <h2 class="section-title">General</h2>
        <div class="glass dream-card">
          ${row('Type', dream.kind === 'nightmare' ? '<span class="dream-kind-nightmare">Nightmare</span>' : 'Dream')}
          ${row('Rating', dots(dream.ratings.rating, 'rating'))}
          ${row('Length', dots(dream.ratings.length, 'length'))}
          ${row('Sleep quality', dots(qualityOf(dream), 'quality'))}
        </div>

        <h2 class="section-title">Questions</h2>
        <div class="glass dream-card">
          ${row('You were in the dream', yesNo(dream.questions.inDream))}
          ${row('It matched your mood', yesNo(dream.questions.matchesMood))}
          ${row('Linked to real life', yesNo(dream.questions.realLife))}
          ${row('Recurring dream', yesNo(typeof dream.recurring === 'boolean' ? dream.recurring : null))}
        </div>

        <h2 class="section-title">Lucidity</h2>
        <div class="glass dream-card">
          ${row('Lucid', dream.lucid ? '<span class="dream-yes">Lucid</span>' : 'Not lucid')}
          ${row('In control', yesNo(dream.lucidity.control))}
          ${row('Vividness', dots(dream.lucidity.vividness, 'vividness'))}
        </div>

        <h2 class="section-title">Notes</h2>
        <div class="glass dream-card dream-notes">${notes ? esc(notes) : '<span class="faint">No notes.</span>'}</div>
        <p class="dream-hint faint">To change these, tap <button type="button" class="dream-link" data-act="edit">Edit</button>.</p>`;
    }

    // ---- Sleep: bedtime, wake time, time asleep, quality — edited inline ----

    function sleepHTML(dream) {
      const { bedtime, wake } = dream.sleep;
      const q = qualityOf(dream);
      const len = sleepLength(bedtime, wake);
      return `
        <div class="glass dream-card dream-sleep">
          <label class="dream-row dream-sleep-row">
            <span class="dream-row-label">${icons.moon}<span>Bedtime</span></span>
            <input class="field dream-time" type="time" data-sleep="bedtime" value="${esc(hhmm(bedtime))}">
          </label>
          <label class="dream-row dream-sleep-row">
            <span class="dream-row-label">${icons.bell}<span>Woke up</span></span>
            <input class="field dream-time" type="time" data-sleep="wake" value="${esc(hhmm(wake))}">
          </label>
          <div class="dream-row">
            <span class="dream-row-label">Time asleep</span>
            <span class="dream-row-value dream-sleep-length" data-length>${len ? esc(len) : '<span class="dream-unset">Add both times</span>'}</span>
          </div>
        </div>

        <h2 class="section-title">Sleep quality</h2>
        <div class="glass dream-card dream-quality">
          <div class="dream-scale" role="group" aria-label="Sleep quality, 1 to 5">
            ${[1, 2, 3, 4, 5].map((v) => `<button type="button" class="dream-scale-btn" data-act="quality" data-value="${v}" aria-pressed="${q === v}" aria-label="${v} — ${SCALES.quality[v - 1]}">${v}</button>`).join('')}
          </div>
          <div class="dream-scale-ends faint"><span>${SCALES.quality[0]}</span><span>${SCALES.quality[4]}</span></div>
        </div>
        <p class="dream-saved" data-saved aria-live="polite"></p>
        <p class="dream-hint faint">Times are entered by hand: an app on the Home Screen can't read Apple Health.</p>`;
    }

    function saveSleep(patch) {
      const dream = read();
      if (!dream) return;
      const sleep = { ...dream.sleep, ...patch };
      const update = { sleep };
      // Keep the editor's "Sleep quality" rating in step with the Sleep tab.
      if ('quality' in patch) update.ratings = { ...dream.ratings, sleep: patch.quality };
      updateDream(id, update);
      const fresh = read();
      root.querySelector('[data-panel="details"]').innerHTML = detailsHTML(fresh);
      for (const b of root.querySelectorAll('[data-act="quality"]')) b.setAttribute('aria-pressed', String(Number(b.dataset.value) === qualityOf(fresh)));
      flashSaved();
    }

    function flashSaved() {
      const s = root.querySelector('[data-saved]');
      if (!s) return;
      s.textContent = 'Saved';
      s.classList.add('dream-saved-on');
      clearTimeout(savedTimer);
      savedTimer = setTimeout(() => { s.classList.remove('dream-saved-on'); }, 1600);
    }

    function paintLength() {
      const val = (k) => root.querySelector(`[data-sleep="${k}"]`)?.value || null;
      const len = sleepLength(val('bedtime'), val('wake'));
      const out = root.querySelector('[data-length]');
      if (out) out.innerHTML = len ? esc(len) : '<span class="dream-unset">Add both times</span>';
    }

    // ---- Share: the iOS share sheet, or copy to the clipboard ----

    async function share() {
      const dream = read();
      if (!dream) return;
      const title = dream.title || 'A dream';
      const text = [title, longDate(dream.date), '', dream.text, '', '— from my Dreaming journal'].filter((l, i) => i !== 1 || l).join('\n');
      if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
        try {
          await navigator.share({ title, text });
          return;
        } catch (err) {
          if (err?.name === 'AbortError') return; // the user closed the share sheet
        }
      }
      if (await copyText(text)) ctx.toast?.('Dream copied to the clipboard');
      else ctx.toast?.("Couldn't share this dream");
    }

    async function copyText(text) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch {}
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;';
        document.body.append(ta);
        ta.select();
        const ok = document.execCommand('copy');
        ta.remove();
        return ok;
      } catch {
        return false;
      }
    }

    // ---- Analyze: consent (first time), then request → waiting → result ----

    function onAnalyze() {
      if (asking) return;
      if (!isEnabled()) { openConsent(); return; }
      analyzeNow();
    }

    function analyzeNow() {
      const status = getDream(id)?.interpretation?.status;
      if (!status || status === 'failed') askForInterpretation(true);
      else { paintInterp(); scrollToInterp(); }
    }

    function scrollToInterp() {
      const slot = root.querySelector('[data-interp]');
      if (!slot?.childElementCount) return;
      requestAnimationFrame(() => {
        try { slot.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch { slot.scrollIntoView(); }
      });
    }

    function openConsent() {
      closeConsent();
      const sheet = document.createElement('div');
      sheet.className = 'dream-sheet';
      sheet.dataset.sheet = '';
      sheet.innerHTML = `
        <div class="dream-sheet-scrim" data-act="sheet-close"></div>
        <div class="glass dream-sheet-card" role="dialog" aria-modal="true" aria-labelledby="dream-sheet-title">
          <div class="dream-sheet-icon" aria-hidden="true">${icons.sparkle}</div>
          <h2 class="dream-sheet-title" id="dream-sheet-title">Interpret this dream?</h2>
          <ul class="dream-sheet-points">
            <li>${icons.share}<span>This dream's text, with its title, date and tags, is sent to Dreaming's server to be interpreted.</span></li>
            <li>${icons.image}<span>When your plan includes AI images, the same text is also used to create a picture of the dream.</span></li>
            <li>${icons.lock}<span>The rest of your journal stays on this iPhone.</span></li>
            <li>${icons.settings}<span>It's a beta. You can turn it off any time in Settings → Labs.</span></li>
          </ul>
          <button type="button" class="btn" data-act="consent-yes">${icons.check}<span>Agree and analyze</span></button>
          <button type="button" class="btn btn-ghost" data-act="sheet-close">Not now</button>
        </div>`;
      root.append(sheet);
      sheet.querySelector('[data-act="consent-yes"]')?.focus();
    }

    function closeConsent() {
      root.querySelector('[data-sheet]')?.remove();
    }

    function stopPolling() {
      stopPoll?.();
      stopPoll = null;
    }

    function ensurePolling() {
      if (stopPoll || !isPending(getDream(id))) return;
      stopPoll = startPolling(id, () => { if (root.isConnected) paintInterp(); });
    }

    function paintBar() {
      const bar = root.querySelector('[data-bar]');
      if (!bar) return;
      const interp = isEnabled() ? getDream(id)?.interpretation : null;
      const status = interp?.status;
      let icon = icons.sparkle;
      let label = 'Analyze';
      if (asking) label = 'Sending…';
      else if (isPending({ interpretation: interp })) { icon = icons.moon; label = 'Interpreting…'; }
      else if (status === 'done' && interp?.result) label = 'Read the interpretation';
      else if (status) label = 'Analyze again';
      // Interpretations left this month, shown quietly next to "Analyze" (free plan, or Plus when running low).
      let left = '';
      const n = remaining('analyses');
      if (!asking && (label === 'Analyze' || label === 'Analyze again') && n != null) {
        if (!hasFeature('analyses')) left = n > 0 ? `${n} left` : 'PLUS';
        else if (n <= 10) left = `${n} left`;
      }
      bar.innerHTML = `
        <button type="button" class="dream-analyze" data-act="analyze" ${asking ? 'disabled' : ''}>
          <span class="dream-analyze-icon" aria-hidden="true">${icon}</span><span>${label}</span>
          ${left ? `<span class="dream-analyze-left">${esc(left)}</span>` : ''}
        </button>`;
    }

    function paintInterp() {
      paintBar();
      const slot = root.querySelector('[data-interp]');
      if (!slot) return;
      const dream = getDream(id);
      const interp = dream?.interpretation;

      if (!isEnabled() || !interp?.status) {
        stopPolling();
        slot.innerHTML = '';
        return;
      }

      if (isPending(dream)) {
        const sent = timeOf(interp.requestedAt);
        slot.innerHTML = `
          <section class="glass dream-interp-card dream-interp-wait">
            <div data-interp-pic>${interpPicHTML(dream)}</div>
            <div data-interp-video>${interpVideoHTML(dream)}</div>
            <div class="dream-interp-moon" aria-hidden="true">${icons.moon}</div>
            <p class="dream-interp-wait-title">Interpreting your dream…</p>
            <div class="dream-interp-shimmer" aria-hidden="true"><span></span><span></span><span></span></div>
            <p class="dream-interp-wait-note faint">While we test, a reply can take a few minutes. You can leave this screen — it will be here when you come back.</p>
            ${sent ? `<p class="dream-interp-sent faint">Sent at ${esc(sent)}</p>` : ''}
          </section>`;
        ensurePolling();
        return;
      }
      stopPolling();

      if (interp.status !== 'done' || !interp.result || typeof interp.result !== 'object') {
        slot.innerHTML = `
          <section class="glass dream-interp-card dream-interp-failed">
            <p class="dream-interp-failed-title">This dream couldn't be interpreted.</p>
            <button type="button" class="btn btn-ghost" data-act="interpret" ${asking ? 'disabled' : ''}>${asking ? 'Sending…' : 'Try again'}</button>
          </section>`;
        return;
      }

      slot.innerHTML = interpretationHTML(dream);
    }

    function interpretationHTML(dream) {
      const interp = dream.interpretation;
      const r = interp.result;
      const parts = [];

      const stale = isStale(dream)
        ? `<p class="dream-interp-stale faint">The dream was edited after this interpretation · <button type="button" class="dream-interp-link" data-act="interpret" ${asking ? 'disabled' : ''}>${asking ? 'Sending…' : 'Interpret again'}</button></p>`
        : '';

      const essence = str(r.essence);
      parts.push(`
        <section class="glass dream-interp-card">
          <div data-interp-pic>${interpPicHTML(dream)}</div>
          <div data-interp-video>${interpVideoHTML(dream)}</div>
          <p class="dream-interp-kicker"><span aria-hidden="true">✨</span> What it may mean <span class="dream-interp-beta">beta</span></p>
          ${essence ? `<p class="dream-interp-essence">${esc(essence)}</p>` : ''}
          ${stale}
        </section>`);

      const symbols = itemList(r.symbols);
      if (symbols) parts.push(`<section class="glass dream-interp-card">${interpHead('Symbols')}${symbols}</section>`);

      const themes = itemList(r.themes);
      if (themes) parts.push(`<section class="glass dream-interp-card">${interpHead('Themes')}${themes}</section>`);

      const arc = str(r.feeling?.arc);
      const feel = str(r.feeling?.text);
      if (arc || feel) {
        parts.push(`
          <section class="glass dream-interp-card">
            ${interpHead('The feeling')}
            ${arc ? `<span class="chip dream-interp-arc">${esc(arc)}</span>` : ''}
            ${feel ? `<p class="dream-interp-text">${esc(feel)}</p>` : ''}
          </section>`);
      }

      const persp = PERSPECTIVES.filter(([k]) => str(r.perspectives?.[k]));
      if (persp.length) {
        if (!persp.some(([k]) => k === perspKey)) perspKey = persp[0][0];
        const tabs = persp.length > 1
          ? `<div class="dream-interp-tabs" role="tablist">${persp.map(([k, label]) => `
              <button type="button" role="tab" class="dream-interp-tab" data-act="persp" data-key="${k}" aria-selected="${k === perspKey}">${label}</button>`).join('')}
            </div>`
          : '';
        const panels = persp.map(([k]) => `
          <p class="dream-interp-text dream-interp-panel" role="tabpanel" data-ppanel="${k}" ${k === perspKey ? '' : 'hidden'}>${esc(str(r.perspectives[k]))}</p>`).join('');
        parts.push(`
          <section class="glass dream-interp-card">
            ${interpHead(persp.length > 1 ? 'Perspectives' : `Perspective · ${persp[0][1]}`)}
            ${tabs}${panels}
          </section>`);
      }

      const questions = arr(r.reflect).map(str).filter(Boolean);
      if (questions.length) {
        parts.push(`
          <section class="glass dream-interp-card">
            ${interpHead('Reflect')}
            <ul class="dream-interp-reflect">${questions.map((q) => `<li>${esc(q)}</li>`).join('')}</ul>
          </section>`);
      }

      const care = str(r.care);
      if (care) parts.push(`<section class="dream-interp-care"><p>${esc(care)}</p></section>`);

      let based = arr(r.basedOn).map((x) => String(x ?? '').trim()).filter(Boolean);
      if (!based.length) based = [...arr(r.symbols), ...arr(r.themes)].map((x) => str(x?.entry)).filter(Boolean);
      based = [...new Set(based)];
      const disclaimer = str(r.disclaimer) || 'For reflection, not prediction.';

      parts.push(`
        <section class="glass dream-interp-card dream-interp-foot">
          ${based.length ? `
            <details class="dream-interp-based">
              <summary><span>Based on ${based.length} knowledge ${based.length === 1 ? 'entry' : 'entries'}</span>${icons.chevronRight}</summary>
              <ul>${based.map((b) => `<li>${esc(prettyEntry(b))}</li>`).join('')}</ul>
            </details>` : ''}
          ${feedbackHTML(interp)}
          <p class="dream-interp-disclaimer faint">${esc(disclaimer)}</p>
        </section>`);

      return parts.join('');
    }

    function feedbackHTML(interp) {
      const rated = interp.rating === 1 || interp.rating === -1;
      const thumb = (val, emoji, label) => `
        <button type="button" class="dream-interp-thumb" data-act="rate" data-rating="${val}" aria-pressed="${interp.rating === val}" aria-label="${label}" ${feedbackBusy ? 'disabled' : ''}>${emoji}</button>`;
      const note = rated && noteOpen && !interp.feedbackNote
        ? `
          <form class="dream-interp-note" data-note novalidate>
            <input class="field" type="text" name="note" maxlength="500" autocomplete="off" placeholder="Anything to add? (optional)" aria-label="Optional note">
            <button type="submit" class="btn btn-ghost" ${feedbackBusy ? 'disabled' : ''}>Send</button>
          </form>`
        : '';
      const label = !rated ? 'Was this helpful?' : interp.feedbackNote ? 'Thanks — noted.' : 'Thanks';
      return `
        <div class="dream-interp-feedback">
          <span class="dream-interp-ask">${label}</span>
          <span class="dream-interp-thumbs">${thumb(1, '👍', 'Helpful')}${thumb(-1, '👎', 'Not helpful')}</span>
        </div>${note}`;
    }

    async function askForInterpretation(scroll = false) {
      if (asking) return;
      const dream = getDream(id);
      if (!dream) return;
      // Free interpretations used up: the paywall straight away, without asking the server.
      if (!hasFeature('analyses') && remaining('analyses') === 0) {
        openPaywall({ feature: 'analyses' });
        return;
      }
      asking = true;
      paintInterp();
      let ok = false;
      try {
        await requestInterpretation(dream);
        noteOpen = false;
        perspKey = 'psychology';
        ok = true;
      } catch (err) {
        if (err?.status === 402) handleLimit(err.body, 'analyses');
        else ctx.toast?.(err?.message || "Couldn't send the dream. Please try again.");
      } finally {
        asking = false;
      }
      if (!root.isConnected) return;
      paintInterp();
      if (ok) autoImage(); // Analyze makes the picture too (when allowed)
      if (ok && scroll) scrollToInterp();
    }

    async function rate(rating, note) {
      if (feedbackBusy) return;
      const dream = getDream(id);
      if (!dream?.interpretation) return;
      feedbackBusy = true;
      try {
        await sendFeedback(dream, rating, note);
        noteOpen = !note;
      } catch (err) {
        ctx.toast?.(err?.message || "Couldn't send feedback. Please try again.");
      } finally {
        feedbackBusy = false;
      }
      if (root.isConnected) paintInterp();
    }

    // ---- Events ----

    root.addEventListener('click', (e) => {
      const target = e.target.closest('[data-act]');
      const act = target?.dataset.act;
      if (!act) return;
      if (act === 'back') goBack();
      else if (act === 'share') share();
      else if (act === 'edit') ctx.navigate(`#record/edit/${encodeURIComponent(id)}`);
      else if (act === 'tab') selectTab(target.dataset.tab || 'story');
      else if (act === 'type') chooseType(target.dataset.type);
      else if (act === 'day-edit') { editingDay = true; paintPanels(); root.querySelector('[data-day-input]')?.focus(); }
      else if (act === 'day-cancel') { editingDay = false; paintPanels(); }
      else if (act === 'day-save') {
        const d = read();
        if (d) setDayNote(dayBefore(d), root.querySelector('[data-day-input]')?.value || '');
        editingDay = false;
        paintPanels();
        ctx.toast('Saved');
      }
      else if (act === 'quality') {
        const v = Number(target.dataset.value);
        saveSleep({ quality: qualityOf(read() || withDefaults({})) === v ? null : v }); // tap again to clear
      }
      else if (act === 'analyze') onAnalyze();
      else if (act === 'sheet-close') closeConsent();
      else if (act === 'consent-yes') {
        setSetting('interpretBeta', true);
        giveImageConsent(); // the sheet also explained the picture
        closeConsent();
        analyzeNow();
      }
      else if (act === 'image') onImage();
      else if (act === 'image-plus') openPaywall({ feature: 'images' });
      else if (act === 'image-dismiss') dismissImageError(id);
      else if (act === 'image-consent-yes') {
        giveImageConsent();
        closeConsent();
        onImage();
      }
      else if (act === 'video') onVideo();
      else if (act === 'video-play') onPlay();
      else if (act === 'video-plus') openPaywall({ feature: 'videos' });
      else if (act === 'video-dismiss') dismissVideoError(id);
      else if (act === 'interpret') askForInterpretation();
      else if (act === 'rate') rate(Number(target.dataset.rating) === -1 ? -1 : 1);
      else if (act === 'persp') {
        perspKey = target.dataset.key || 'psychology';
        const card = target.closest('.dream-interp-card');
        for (const t of card?.querySelectorAll('[data-act="persp"]') ?? []) t.setAttribute('aria-selected', String(t.dataset.key === perspKey));
        for (const p of card?.querySelectorAll('[data-ppanel]') ?? []) p.hidden = p.dataset.ppanel !== perspKey;
      }
      else if (act === 'delete') {
        // eslint-disable-next-line no-alert
        if (!confirm("Delete this dream? This can't be undone.")) return;
        stopPolling();
        deleteDream(id);
        ctx.toast?.('Dream deleted');
        ctx.navigate('#journal');
      }
    });

    root.addEventListener('input', (e) => {
      if (e.target.matches?.('[data-sleep]')) paintLength();
    });

    root.addEventListener('change', (e) => {
      const key = e.target.dataset?.sleep;
      if (key !== 'bedtime' && key !== 'wake') return;
      const v = e.target.value;
      saveSleep({ [key]: hhmm(v) || null });
      paintLength();
    });

    root.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && root.querySelector('[data-sheet]')) closeConsent();
      else onTypeKey(e);
    });

    // An AI image that can't load (offline, removed): show the generated painting instead.
    // The video on the picture can't load: hide it quietly; the still picture and the play button stay.
    root.addEventListener('error', (e) => {
      const img = e.target;
      if (img?.tagName === 'VIDEO') {
        if (img.classList.contains('dream-hero-vid')) img.hidden = true;
        return;
      }
      if (img?.tagName !== 'IMG' || img.dataset.fallback || !String(img.getAttribute('src') || '').startsWith('https://')) return;
      const dream = read();
      const alt = dream ? paintedSrc(dream) : '';
      img.dataset.fallback = '1';
      img.dataset.failed = img.getAttribute('src');
      if (alt) img.src = alt;
      // The preview video starts on the same picture.
      const video = alt && img.classList.contains('dream-hero-img') ? root.querySelector('.dream-hero-vid') : null;
      if (video) video.poster = alt;
    }, true);

    root.addEventListener('submit', (e) => {
      const form = e.target.closest?.('form[data-note]');
      if (!form) return;
      e.preventDefault();
      const note = form.elements.note?.value.trim();
      if (!note) { noteOpen = false; paintInterp(); return; }
      rate(getDream(id)?.interpretation?.rating === -1 ? -1 : 1, note);
    });

    show();
    // Keep checking a picture or video that was still being made when the user left (or closed the app).
    pollImage(id);
    resumePendingImages();
    pollVideo(id);
    tickClock();
    getAccount().catch(() => {}); // fresh plan + counts for the badges (repaints via 'dreaming:account')

    // #dream/<id>/analyze (Home's "Analyze this dream"): open the page, then start the Analyze flow straight away.
    // The address drops "/analyze" so coming Back here doesn't start it again.
    if (sub === 'analyze' && getDream(id)) {
      try { history.replaceState(null, '', `#dream/${encodeURIComponent(id)}`); } catch {}
      onAnalyze();
    }
  },

  destroy() {
    cleanup?.();
    cleanup = null;
  },
};
