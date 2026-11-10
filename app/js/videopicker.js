// "Your dream video" sheet: the user picks the length (a longer dream unlocks longer videos), the quality and,
// when the dream has an AI photo, whether the video starts from it. Shows the credits it takes and about how
// long it will take, then starts the video (js/videos.js). It also says what is sent to the server, so tapping
// "Create video" counts as agreeing (replaces a separate consent sheet). Shared by the dream page and the editor.
// Touches document/storage only inside functions, never at import time.
import { getDream, getSetting, setSetting } from './store.js';
import { remaining } from './account.js';
import { hasImage } from './images.js';
import {
  createVideo, giveVideoConsent, hasVideo, videoOptions, wordCount, maxSeconds, wordsFor, videoCost,
  estimateMinutes, minutesRange, clipsFor, allLengths,
} from './videos.js';
import { esc, icons } from './ui.js';

let open = null;

/**
 * Opens the picker for `dream` (saved; may carry unsaved edits from the editor, which are what gets sent).
 * Resolves nothing; the video starts through createVideo, which repaints screens via 'dreaming:video'.
 */
export function openVideoPicker(dream, { toast } = {}) {
  if (!dream?.id || typeof document === 'undefined') return;
  open?.close();
  const opts = videoOptions();
  const words = wordCount(dream);
  const maxLen = maxSeconds(opts, words);
  const saved = getDream(dream.id);
  const photo = hasImage(saved);
  const prefs = getSetting('videoPrefs', {}) || {};
  const left = remaining('videos');

  // Start with the longest single video this dream allows that the credits cover, and the last quality used.
  // Films (several scenes, many credits) are always the user's own choice, never preselected.
  const state = {
    quality: opts.qualities.some((q) => q.id === prefs.quality) ? prefs.quality : opts.defaultQuality,
    useImage: photo && prefs.useImage !== false,
    seconds: opts.durations[0],
  };
  const fits = (s, q = state.quality) => left == null || videoCost(opts, s, q) <= left;
  const allowed = opts.durations.filter((s) => s <= maxLen);
  const films = opts.films || [];
  state.seconds = [...allowed].reverse().find((s) => fits(s)) ?? allowed[0] ?? opts.durations[0];

  const el = document.createElement('div');
  el.className = 'vpick';
  el.innerHTML = `
    <div class="vpick-scrim" data-p="close"></div>
    <div class="vpick-card glass" role="dialog" aria-modal="true" aria-labelledby="vpick-title">
      <span class="vpick-handle" aria-hidden="true"></span>
      <div class="vpick-head">
        <span class="vpick-icon" aria-hidden="true">${icons.film}</span>
        <div>
          <h2 class="vpick-title" id="vpick-title">Your dream video</h2>
          <p class="vpick-sub">${esc(String(dream.title || 'Untitled dream').slice(0, 80))}</p>
        </div>
      </div>
      <div class="vpick-body" data-p-body></div>
    </div>`;
  document.body.append(el);
  document.body.classList.add('vpick-open');

  const body = el.querySelector('[data-p-body]');

  function lengthHint() {
    const next = allLengths(opts).find((s) => s > maxLen);
    const has = `Your dream has ${words} ${words === 1 ? 'word' : 'words'}, enough for up to ${maxLen} seconds.`;
    if (!next) return has;
    const need = wordsFor(opts, next) - words;
    return `${has} Write ${need} more ${need === 1 ? 'word' : 'words'} to unlock ${next} seconds.`;
  }

  /** One length chip (a single video or a film). */
  function chip(s) {
    const locked = s > maxLen;
    const scenes = clipsFor(opts, s).length;
    const sub = locked ? `${icons.lock}${wordsFor(opts, s)}+ words`
      : `${videoCost(opts, s, state.quality)} credits${scenes > 1 ? ` · ${scenes} scenes` : ''}`;
    return `<button type="button" class="vpick-chip" role="radio" data-p="len" data-v="${s}"
        aria-checked="${s === state.seconds}" ${locked ? 'disabled' : ''}>
      <b>${s} s</b><small>${sub}</small>
    </button>`;
  }

  function paint() {
    const cost = videoCost(opts, state.seconds, state.quality);
    const enough = left == null || cost <= left;
    const fromImage = state.useImage && photo;
    const minutes = estimateMinutes(opts, state.seconds, state.quality, fromImage);
    body.innerHTML = `
      <p class="vpick-label">Length</p>
      <p class="vpick-hint">${esc(lengthHint())}</p>
      <div class="vpick-chips" role="radiogroup" aria-label="Video length">
        ${opts.durations.map(chip).join('')}
      </div>
      ${films.length ? `
        <p class="vpick-sublabel">Dream film <span>for long dreams: several scenes in one video</span></p>
        <div class="vpick-chips vpick-chips-3" role="radiogroup" aria-label="Dream film length">
          ${films.map((f) => chip(f.seconds)).join('')}
        </div>` : ''}

      <p class="vpick-label">Quality</p>
      <div class="vpick-chips vpick-chips-2" role="radiogroup" aria-label="Video quality">
        ${opts.qualities.map((q) => `
          <button type="button" class="vpick-chip" role="radio" data-p="quality" data-v="${esc(q.id)}" aria-checked="${q.id === state.quality}">
            <b>${esc(q.label)}</b><small>${esc(q.id)} · ${esc(q.note || '')}</small>
          </button>`).join('')}
      </div>

      ${photo ? `
        <button type="button" class="vpick-toggle" role="switch" data-p="photo" aria-checked="${state.useImage}">
          <span class="vpick-toggle-text"><b>Start from your AI photo</b><small>The video matches your picture. Takes longer.</small></span>
          <span class="vpick-switch" aria-hidden="true"></span>
        </button>` : ''}

      <div class="vpick-sum${enough ? '' : ' vpick-sum-short'}">
        <span>${icons.sparkle}<b>${cost} credits</b>${left == null ? '' : ` · ${enough ? `${left - cost} left after this` : `you have ${left}`}`}</span>
        <span>${icons.moon}About ${esc(minutesRange(minutes))}</span>
      </div>
      ${enough ? '' : '<p class="vpick-warn">Not enough credits for this one. Choose a shorter length or Standard quality.</p>'}
      ${clipsFor(opts, state.seconds).length > 1 ? `<p class="vpick-note">Your dream is told in ${clipsFor(opts, state.seconds).length} scenes, in order, made at the same time and joined into one film.${fromImage ? ' The first scene starts from your AI photo.' : ''}</p>` : ''}
      ${hasVideo(saved) ? '<p class="vpick-note">The new video takes the place of this dream\'s current one.</p>' : ''}
      <p class="vpick-note">This dream's text, title and tags${fromImage ? ', and its AI photo,' : ''} are sent to Dreaming's server, where an AI video service makes the video with sound. You can leave the app while it's made. If it fails, your credits come back.</p>
      <button type="button" class="btn vpick-go" data-p="go" ${enough ? '' : 'disabled'}>${icons.film}<span>Create ${state.seconds}-second ${clipsFor(opts, state.seconds).length > 1 ? 'film' : 'video'}</span></button>
      <button type="button" class="btn btn-ghost" data-p="close">Cancel</button>`;
  }

  const close = () => {
    el.remove();
    document.body.classList.remove('vpick-open');
    document.removeEventListener('keydown', onKey);
    if (open?.el === el) open = null;
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);

  el.addEventListener('click', (e) => {
    const t = e.target.closest('[data-p]');
    if (!t || t.disabled) return;
    const act = t.dataset.p;
    if (act === 'close') { close(); return; }
    if (act === 'len') state.seconds = Number(t.dataset.v);
    if (act === 'quality') state.quality = t.dataset.v;
    if (act === 'photo') state.useImage = !state.useImage;
    if (act === 'go') {
      setSetting('videoPrefs', { quality: state.quality, useImage: state.useImage });
      giveVideoConsent();
      close();
      createVideo(dream, { toast, seconds: state.seconds, quality: state.quality, useImage: state.useImage && photo });
      return;
    }
    paint();
    (el.querySelector(`[data-p="${act}"][aria-checked="true"]`) || el.querySelector(`[data-p="${act}"]`))?.focus();
  });

  paint();
  open = { el, close };
  (el.querySelector('[data-p="go"]:not([disabled])') || el.querySelector('[data-p="close"]'))?.focus();
}
