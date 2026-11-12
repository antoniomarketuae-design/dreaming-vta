// AI dream videos (Dreaming Plus): made on Dreaming's server by a video service (poyo.ai Seedance 2.0, fal.ai as
// fallback) from ONE dream's text, title, tags and kind, only when the user asks. When the dream has an AI image,
// the server uses it as the first frame so the video matches the picture. Same pattern as js/images.js:
//   dream.videoJob = { id, status: 'pending' | 'failed', style, requestedAt, fromImage, error? }   (removed when done)
//   dream.video    = { id, url, style, seconds, createdAt }
// Screens listen for window 'dreaming:video' ({ detail: { dreamId } }) to repaint.
// The user picks length and quality (js/videopicker.js); a longer dream unlocks longer videos. The plan's video
// allowance is counted in CREDITS: 1 credit = 1 second at Standard quality, HD costs more (numbers from GET /plans).
// A very long dream can become a "dream film" (20–45 s): 2–3 scenes made at the same time and joined on the server;
// while it's made the job shows how many scenes are ready.
// openVideoPlayer(dream) shows the full-screen player (sound toggle, Save to Photos via the share sheet).
// Touches document/window/storage only inside functions, never at import time.
import { getDream, updateDream, listDreams, getProfile, getSetting, setSetting } from './store.js';
import { API_BASE } from './interpret.js';
import { authHeaders, applyAccount, hasFeature, remaining, openPaywall, handleLimit, getAccount, getPlans } from './account.js';
import { hasImage } from './images.js';
import { esc, icons } from './ui.js';

const TIMEOUT_MS = 20_000;
const FIRST_MS = 20_000;         // a video takes 5–15 minutes: first check after 20 s,
const GROW = 1.25;               // then a little slower each time,
const MAX_MS = 20_000;           // at most every 20 s.
const GIVE_UP_MIN = 30;          // Still "pending" this long after sending (or 3× the usual time) → treat as failed.
const STOP_MS = 60 * 60_000;     // Offline that long → stop checking (resumes when the dream is opened again).
const FILE_RE = /^vd[\w-]{16,30}\.mp4$/;
const NET_ERROR = "Couldn't reach Dreaming's server. Check your connection and try again.";
const SERVER_ERROR = 'Something went wrong on the server. Please try again later.';

/** How long a video usually takes, for progress text (uses the job's own estimate when there is one). */
export const VIDEO_WAIT_TEXT = 'Usually 5–15 minutes. You can leave this screen; it keeps going.';
export function videoWaitText(dream) {
  const job = dream?.videoJob;
  const min = job?.minutes;
  const scenes = job?.scenes > 1 ? `${job.scenesDone || 0} of ${job.scenes} scenes ready. ` : '';
  return Number.isFinite(min) ? `${scenes}Usually ${minutesRange(min)}. You can leave this screen; it keeps going.` : scenes + VIDEO_WAIT_TEXT;
}

// ---- Length, quality and credits ----

// Mirrors server/plans.json "videos" until GET /plans has answered once.
const DEFAULT_OPTIONS = {
  durations: [5, 8, 10, 15],
  lengthByWords: [
    { words: 0, max: 5 }, { words: 40, max: 8 }, { words: 100, max: 10 }, { words: 180, max: 15 },
    { words: 250, max: 20 }, { words: 350, max: 30 }, { words: 500, max: 45 },
  ],
  films: [{ seconds: 20, clips: [10, 10] }, { seconds: 30, clips: [10, 10, 10] }, { seconds: 45, clips: [15, 15, 15] }],
  qualities: [
    { id: '480p', label: 'Standard', note: 'Faster', perSecond: 1 },
    { id: '720p', label: 'HD', note: 'Sharper', perSecond: 2 },
  ],
  defaultQuality: '720p',
  minutesPerSecond: { '480p': 0.65, '720p': 1 },
  photoFactor: 2.5,
  filmJoinMinutes: 1,
};

/** Video options from the last GET /plans (refreshed in the background), else the built-in copy. */
export function videoOptions() {
  getPlans().catch(() => {});
  const o = getSetting('plansCache', null)?.videos;
  return o?.durations?.length && o?.qualities?.length ? { ...DEFAULT_OPTIONS, ...o } : DEFAULT_OPTIONS;
}

/** The clip lengths a video of `seconds` is made of: [seconds], or one per scene for a film. */
export const clipsFor = (opts, seconds) => (opts.films || []).find((f) => f.seconds === seconds)?.clips || [seconds];
/** Every length on offer, single videos first, then films. */
export const allLengths = (opts) => [...opts.durations, ...(opts.films || []).map((f) => f.seconds)];

/** Words in the dream's text. */
export const wordCount = (dream) => (String(dream?.text || '').trim().match(/\S+/g) || []).length;

/** Longest video (seconds) this dream may have: longer dreams unlock longer videos. */
export function maxSeconds(opts, words) {
  let max = opts.durations[0];
  for (const step of opts.lengthByWords) if (words >= step.words) max = step.max;
  return max;
}

/** Words needed for a length (0 when any dream may have it). */
export function wordsFor(opts, seconds) {
  return opts.lengthByWords.find((s) => s.max >= seconds)?.words ?? 0;
}

/** Credits a video takes (a film: what its scenes cost together). */
export function videoCost(opts, seconds, quality) {
  const q = opts.qualities.find((x) => x.id === quality) || opts.qualities[0];
  return clipsFor(opts, seconds).reduce((sum, s) => sum + Math.ceil(s * q.perSecond), 0);
}

/** Usual time in minutes to make a video. A film's scenes are made at the same time (only the first starts from
 *  the photo), so it takes as long as its slowest scene, plus joining. */
export function estimateMinutes(opts, seconds, quality, fromImage) {
  const perSecond = opts.minutesPerSecond[quality] ?? 1;
  const clips = clipsFor(opts, seconds);
  const slowest = Math.max(...clips.map((s, i) => s * perSecond * (fromImage && i === 0 ? opts.photoFactor : 1)));
  return slowest + (clips.length > 1 ? opts.filmJoinMinutes ?? 1 : 0);
}

/** "about 4–7 minutes" style range around an estimate. */
export function minutesRange(min) {
  const lo = Math.max(1, Math.floor(min * 0.7));
  const hi = Math.max(lo + 1, Math.ceil(min * 1.3));
  return `${lo}–${hi} minutes`;
}

export class VideoError extends Error {
  constructor(message, status = 0, body = null) {
    super(message);
    this.name = 'VideoError';
    this.status = status;
    this.body = body;
  }
}

// ---- State helpers ----

export const hasVideo = (dream) => typeof dream?.video?.url === 'string' && dream.video.url.startsWith('https://');
export const isVideoPending = (dream) => dream?.videoJob?.status === 'pending';
export const isVideoFailed = (dream) => dream?.videoJob?.status === 'failed';

const sending = new Set(); // dream ids with a request on its way
export const isVideoSending = (dreamId) => sending.has(dreamId);
/** True while a video is being asked for or made. */
export const isFilming = (dream) => Boolean(dream) && (isVideoSending(dream.id) || isVideoPending(dream));

/** May a video be created now? Videos are a Plus feature with monthly video credits (the server enforces it). */
export const videosAllowed = () => (remaining('videos') ?? (hasFeature('videos') ? 1 : 0)) > 0;
/** Known not to be allowed (the paywall opens without asking the server). */
export const videosBlocked = () => !hasFeature('videos') || remaining('videos') === 0;

/** Small label for "Visualise as video" buttons: 'PLUS', '44 credits', or '' when unknown. */
export function videoBadge() {
  if (!hasFeature('videos')) return 'PLUS';
  const left = remaining('videos');
  return left == null ? '' : `${left} ${left === 1 ? 'credit' : 'credits'}`;
}

/** Elapsed time of a pending video as "1:23" (for the progress line). */
export function videoElapsed(dream) {
  const t = Date.parse(dream?.videoJob?.requestedAt || '');
  if (!Number.isFinite(t)) return '';
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** The user agreed that dream text may be sent to make a video (asked once, see the dream page). */
export const hasVideoConsent = () => getSetting('videoConsent', false) === true;
export const giveVideoConsent = () => setSetting('videoConsent', true);

/** Public address of a finished video file (usable directly in <video src>). */
export const videoFileURL = (file) => `${API_BASE}/videos/${encodeURIComponent(file)}`;

function emit(dreamId) {
  try { window.dispatchEvent(new CustomEvent('dreaming:video', { detail: { dreamId } })); } catch {}
}

// ---- Server ----

function friendly(status) {
  if (status === 400) return 'Write a little more about this dream first.';
  if (status === 402) return 'AI dream videos come with Dreaming Plus.';
  if (status === 429) return 'Please wait a moment before creating another video.';
  if (status === 503) return 'Video creation is paused for today. Please try again tomorrow.';
  if (status === 404) return 'This video could not be found.';
  return SERVER_ERROR;
}

async function call(path, { method = 'GET', body, retry = true } = {}) {
  let headers;
  try {
    headers = { ...(await authHeaders()) };
  } catch (err) {
    throw new VideoError(err?.message || NET_ERROR);
  }
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), TIMEOUT_MS) : null;
  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl?.signal,
      cache: 'no-store',
      credentials: 'omit',
    });
  } catch {
    throw new VideoError(NET_ERROR);
  } finally {
    if (timer) clearTimeout(timer);
  }
  let data = null;
  try { data = await res.json(); } catch {}
  if (res.status === 401 && retry) {
    setSetting('device', null);
    return call(path, { method, body, retry: false });
  }
  if (!res.ok) {
    const serverMsg = typeof data?.error === 'string' ? data.error.trim() : '';
    const msg = serverMsg && [402, 429, 503].includes(res.status) ? serverMsg : friendly(res.status);
    throw new VideoError(msg, res.status, data);
  }
  return data ?? {};
}

/**
 * Asks the server to make a video of this dream. `dream` must be saved; its text, title, tags and kind are used
 * as given. choice = { seconds, quality, useImage } from the picker; with useImage its AI image (if any) is the
 * first frame. Resolves to the updated dream.
 * Throws VideoError (status 402 = not on Plus / not enough credits; body is the server's answer).
 */
export async function requestVideo(dream, { seconds, quality, useImage = true } = {}) {
  if (!dream?.id || !getDream(dream.id)) throw new VideoError('Save this dream first.');
  const text = String(dream.text ?? '').trim() || String(dream.title ?? '').trim();
  if (text.length < 3) throw new VideoError('Write a little more about this dream first.', 400);
  const style = getProfile()?.artStyle || 'moonlit';
  const saved = getDream(dream.id);
  const data = await call('/videos', {
    method: 'POST',
    body: {
      text: text.slice(0, 6000),
      title: String(dream.title ?? '').slice(0, 200),
      tags: Array.isArray(dream.tags) ? dream.tags.filter((t) => typeof t === 'string').slice(0, 10) : [],
      kind: dream.kind === 'nightmare' ? 'nightmare' : 'dream',
      style,
      seconds,
      quality,
      useImage,
      imageId: useImage && hasImage(saved) ? saved.image.id : undefined,
    },
  });
  if (data.account) applyAccount(data.account);
  if (!data.id || typeof data.id !== 'string') throw new VideoError(SERVER_ERROR);
  return updateDream(dream.id, {
    videoJob: {
      id: data.id,
      status: 'pending',
      style,
      fromImage: Boolean(data.fromImage),
      seconds: Number.isFinite(data.seconds) ? data.seconds : seconds,
      quality: typeof data.quality === 'string' ? data.quality : quality,
      minutes: Number.isFinite(data.minutes) ? data.minutes : undefined,
      scenes: Number.isFinite(data.scenes) ? data.scenes : 1,
      scenesDone: 0,
      requestedAt: new Date().toISOString(),
    },
  });
}

/**
 * What the screens call. Opens the paywall without asking the server when videos aren't on the plan (or used up),
 * sends the request, starts checking for the result and reports problems through `toast`.
 * Resolves to the updated dream, or null when nothing was started.
 */
export async function createVideo(dream, { toast, seconds, quality, useImage } = {}) {
  if (!dream?.id || sending.has(dream.id) || isVideoPending(getDream(dream.id))) return null;
  if (videosBlocked()) {
    openPaywall({ feature: 'videos' });
    return null;
  }
  sending.add(dream.id);
  emit(dream.id);
  let out = null;
  try {
    out = await requestVideo(dream, { seconds, quality, useImage });
  } catch (err) {
    if (err?.status === 402 && err.body?.limit?.left > 0) {
      // Some credits left, just not enough for this choice: say so instead of the paywall.
      getAccount({ refresh: true }).catch(() => {});
      toast?.(err.message);
    } else if (err?.status === 402) {
      getAccount({ refresh: true }).catch(() => {});
      handleLimit(err.body, 'videos');
    } else {
      toast?.(err?.message || SERVER_ERROR);
    }
  } finally {
    sending.delete(dream.id);
  }
  if (out) pollVideo(out.id);
  emit(dream.id);
  return out;
}

/** Forgets a failed attempt. */
export function dismissVideoError(dreamId) {
  const d = getDream(dreamId);
  if (!isVideoFailed(d)) return;
  updateDream(dreamId, { videoJob: null });
  emit(dreamId);
}

// ---- Checking for the result ----

const age = (job) => {
  const t = Date.parse(job?.requestedAt || '');
  return Number.isFinite(t) ? Date.now() - t : 0;
};

async function checkOnce(dreamId) {
  const job = getDream(dreamId)?.videoJob;
  if (!job?.id || job.status !== 'pending') return { dream: getDream(dreamId), changed: false, finished: true };
  let data;
  try {
    data = await call(`/videos/${encodeURIComponent(job.id)}`, { retry: false });
  } catch (err) {
    if ([401, 403, 404, 410].includes(err.status)) data = { status: 'failed', error: 'This video could not be found. Please try again.' };
    else throw err;
  }
  const fresh = getDream(dreamId);
  const cur = fresh?.videoJob;
  if (!cur || cur.id !== job.id) return { dream: fresh, changed: false, finished: true };

  if (data.status === 'done' && typeof data.url === 'string' && FILE_RE.test(data.url)) {
    const style = typeof data.style === 'string' && data.style.length <= 30 ? data.style : cur.style || 'moonlit';
    const seconds = Number.isFinite(data.seconds) ? data.seconds : null;
    const dream = updateDream(dreamId, {
      video: { id: cur.id, url: videoFileURL(data.url), style, seconds, createdAt: new Date().toISOString() },
      videoJob: null,
    });
    return { dream, changed: true, finished: true };
  }
  // A film reports its scenes as they finish: save that so the progress line moves.
  if (data.status === 'pending' && Number.isFinite(data.scenesDone) && data.scenesDone !== (cur.scenesDone || 0)) {
    const dream = updateDream(dreamId, { videoJob: { ...cur, scenesDone: data.scenesDone, scenes: data.scenes || cur.scenes } });
    return { dream, changed: true, finished: false };
  }
  const failed = data.status === 'failed' || data.status === 'done';
  const giveUpMs = Math.max(GIVE_UP_MIN, Math.min(150, (cur.minutes || 10) * 3)) * 60_000;
  const tooLong = !failed && age(cur) > giveUpMs;
  if (failed || tooLong) {
    const error = tooLong ? 'This took too long. Please try again.'
      : String(typeof data.error === 'string' && data.error ? data.error : "The video didn't work this time.").slice(0, 300);
    const dream = updateDream(dreamId, { videoJob: { ...cur, status: 'failed', error } });
    return { dream, changed: true, finished: true };
  }
  return { dream: fresh, changed: false, finished: false };
}

const pollers = new Map();

/**
 * Keeps checking a pending video until it is done or failed (every ~20 s, paused while the app is hidden).
 * One loop per dream, shared by every caller; it keeps running when the screen that started it closes.
 * onUpdate(dream) runs when the job finished. Returns a function that removes onUpdate.
 */
export function pollVideo(dreamId, onUpdate) {
  let p = pollers.get(dreamId);
  if (!p) {
    if (!isVideoPending(getDream(dreamId))) return () => {};
    p = startLoop(dreamId);
  }
  if (typeof onUpdate === 'function') p.listeners.add(onUpdate);
  return () => { p.listeners.delete(onUpdate); };
}

/** Resumes checking every dream whose video was still being made (e.g. after the app was closed). */
export function resumePendingVideos() {
  let n = 0;
  try {
    for (const d of listDreams()) if (isVideoPending(d)) { pollVideo(d.id); n += 1; }
  } catch {}
  return n;
}

function startLoop(dreamId) {
  const hasDoc = typeof document !== 'undefined';
  const p = { listeners: new Set(), timer: null, delay: FIRST_MS, inFlight: false };
  const finish = () => {
    clearTimeout(p.timer);
    if (hasDoc) document.removeEventListener('visibilitychange', onVisible);
    pollers.delete(dreamId);
  };
  const schedule = (ms = p.delay) => {
    clearTimeout(p.timer);
    p.timer = setTimeout(tick, ms);
    p.delay = Math.min(MAX_MS, Math.round(p.delay * GROW));
  };
  async function tick() {
    p.timer = null;
    if (hasDoc && document.hidden) return;
    if (p.inFlight) return;
    p.inFlight = true;
    let res = null;
    try {
      res = await checkOnce(dreamId);
    } catch {
      if (age(getDream(dreamId)?.videoJob) > STOP_MS) res = { finished: true };
    } finally {
      p.inFlight = false;
    }
    if (res?.changed) {
      for (const fn of [...p.listeners]) { try { fn(res.dream); } catch {} }
      emit(dreamId);
    }
    if (res?.finished) { finish(); return; }
    schedule();
  }
  function onVisible() {
    if (document.hidden || p.inFlight) return;
    clearTimeout(p.timer);
    tick();
  }
  if (hasDoc) document.addEventListener('visibilitychange', onVisible);
  pollers.set(dreamId, p);
  schedule(Math.max(1000, FIRST_MS - age(getDream(dreamId)?.videoJob)));
  return p;
}

// ---- Full-screen player ----

let openPlayer = null;

/**
 * Full-screen vertical player for a dream's video. Call it from a tap, so sound may start right away
 * (iOS only allows sound after a tap; if refused, it plays muted and the sound button turns it on).
 * Close: × button, Escape, or the browser Back gesture is not used (no route change).
 */
export function openVideoPlayer(dream, { poster = '' } = {}) {
  if (!hasVideo(dream) || typeof document === 'undefined') return;
  openPlayer?.close();
  const el = document.createElement('div');
  el.className = 'vplayer';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-label', 'Dream video');
  const title = String(dream.title || 'Your dream').slice(0, 80);
  el.innerHTML = `
    <video class="vplayer-video" src="${esc(dream.video.url)}" ${poster ? `poster="${esc(poster)}"` : ''} playsinline loop preload="auto"></video>
    <div class="vplayer-wait" data-v-wait><span class="vplayer-spin" aria-hidden="true"></span></div>
    <div class="vplayer-top">
      <button type="button" class="vplayer-btn" data-v="close" aria-label="Close">${icons.close}</button>
      <p class="vplayer-title">${esc(title)}</p>
      <button type="button" class="vplayer-btn" data-v="sound" aria-label="Turn sound on">${icons.volumeOff}</button>
    </div>
    <div class="vplayer-bottom">
      <span class="vplayer-tag">${icons.film}<span>AI dream video</span></span>
      <button type="button" class="vplayer-save" data-v="save">${icons.download}<span>Save video</span></button>
    </div>`;
  document.body.append(el);
  document.body.classList.add('vplayer-open');
  const video = el.querySelector('video');
  const soundBtn = el.querySelector('[data-v="sound"]');
  const wait = el.querySelector('[data-v-wait]');

  const paintSound = () => {
    soundBtn.innerHTML = video.muted ? icons.volumeOff : icons.volumeOn;
    soundBtn.setAttribute('aria-label', video.muted ? 'Turn sound on' : 'Turn sound off');
  };
  video.muted = false;
  video.play().catch(() => { video.muted = true; paintSound(); video.play().catch(() => {}); });
  paintSound();
  video.addEventListener('playing', () => { wait.hidden = true; });
  video.addEventListener('waiting', () => { wait.hidden = false; });
  video.addEventListener('error', () => {
    wait.hidden = false;
    wait.innerHTML = '<p class="vplayer-err">This video can\'t be played right now. Check your connection.</p>';
  });
  video.addEventListener('click', () => { if (video.paused) video.play().catch(() => {}); else video.pause(); });

  // Save: the share sheet needs the file ready at tap time, so fetch it in the background now.
  let file = null;
  const name = `${title.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 40) || 'dream'}.mp4`;
  fetch(dream.video.url, { credentials: 'omit' })
    .then((r) => (r.ok ? r.blob() : null))
    .then((b) => { if (b) file = new File([b], name, { type: 'video/mp4' }); })
    .catch(() => {});

  const close = () => {
    video.pause();
    video.removeAttribute('src');
    video.load();
    el.remove();
    document.body.classList.remove('vplayer-open');
    document.removeEventListener('keydown', onKey);
    if (openPlayer?.el === el) openPlayer = null;
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);

  el.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-v]')?.dataset.v;
    if (act === 'close') close();
    if (act === 'sound') {
      video.muted = !video.muted;
      if (video.paused) video.play().catch(() => {});
      paintSound();
    }
    if (act === 'save') {
      if (file && navigator.canShare?.({ files: [file] })) {
        try { await navigator.share({ files: [file], title }); } catch {}
        return;
      }
      // No share sheet (or the file isn't ready yet): open the video itself; long-press there to save it.
      window.open(dream.video.url, '_blank', 'noopener');
    }
  });
  openPlayer = { el, close };
  el.querySelector('[data-v="close"]').focus();
}
