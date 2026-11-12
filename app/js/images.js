// AI dream images: painted on Dreaming's server (by an image service: poyo.ai, fal.ai as fallback) from ONE dream's
// text, title, tags and kind, only when the user asks. The picture is kept on the server under a long random id;
// the phone stores its address on the dream (dream.image) and the job in progress (dream.imageJob).
//   dream.imageJob = { id, status: 'pending' | 'failed', style, requestedAt, error? }   (removed when done)
//   dream.image    = { id, url, style, createdAt }   → js/dreamart.js shows it on every screen
// Screens listen for window 'dreaming:image' ({ detail: { dreamId } }) to repaint.
// Touches document/window/storage only inside functions, never at import time.
import { getDream, updateDream, listDreams, getProfile, getSetting, setSetting } from './store.js';
import { API_BASE } from './interpret.js';
import { authHeaders, applyAccount, hasFeature, remaining, openPaywall, handleLimit, getAccount } from './account.js';

const TIMEOUT_MS = 20_000;
const FIRST_MS = 4_000;          // first check 4 s after sending,
const GROW = 1.35;               // then a little slower each time,
const MAX_MS = 15_000;           // at most every 15 s.
const GIVE_UP_MS = 10 * 60_000;  // Still "pending" on the server 10 min after sending → treat as failed.
const STOP_MS = 30 * 60_000;     // Offline that long → stop checking (resumes when the dream is opened again).
const FILE_RE = /^im[\w-]{16,30}\.(jpg|png|webp)$/;
const NET_ERROR = "Couldn't reach Dreaming's server. Check your connection and try again.";
const SERVER_ERROR = 'Something went wrong on the server. Please try again later.';

export class ImageError extends Error {
  constructor(message, status = 0, body = null) {
    super(message);
    this.name = 'ImageError';
    this.status = status;
    this.body = body;
  }
}

// ---- State helpers ----

export const hasImage = (dream) => typeof dream?.image?.url === 'string' && dream.image.url.startsWith('https://');
export const isImagePending = (dream) => dream?.imageJob?.status === 'pending';
export const isImageFailed = (dream) => dream?.imageJob?.status === 'failed';

const sending = new Set(); // dream ids with a request on its way
export const isSending = (dreamId) => sending.has(dreamId);
/** True while a picture is being asked for or painted. */
export const isPainting = (dream) => Boolean(dream) && (isSending(dream.id) || isImagePending(dream));

/** May an image be created now? Plus (the server enforces its monthly cap) or free uses left this month. */
export const imagesAllowed = () => hasFeature('images') || (remaining('images') ?? 0) > 0;
/** Known to be out of free images (the paywall opens without asking the server). */
export const imagesBlocked = () => !hasFeature('images') && remaining('images') === 0;

/** Small label for "Visualise as image" buttons: 'PLUS', '1 free left', '28 left', or '' when unknown. */
export function imageBadge() {
  const left = remaining('images');
  if (hasFeature('images')) return left == null ? '' : `${left} left`;
  if (left == null) return '';
  return left > 0 ? `${left} free left` : 'PLUS';
}

/** The user agreed that dream text may be sent to be painted (asked once, see the dream page). */
export const hasImageConsent = () => getSetting('imageConsent', false) === true;
export const giveImageConsent = () => setSetting('imageConsent', true);

/** Public address of a finished picture file (usable directly in <img src>). */
export const imageFileURL = (file) => `${API_BASE}/images/${encodeURIComponent(file)}`;

function emit(dreamId) {
  try { window.dispatchEvent(new CustomEvent('dreaming:image', { detail: { dreamId } })); } catch {}
}

// ---- Server ----

function friendly(status) {
  if (status === 400) return 'Write a little more about this dream first.';
  if (status === 402) return "You've used this month's AI images.";
  if (status === 429) return 'Please wait a moment before creating another image.';
  if (status === 503) return 'Image creation is paused for today. Please try again tomorrow.';
  if (status === 404) return 'This image could not be found.';
  return SERVER_ERROR;
}

async function call(path, { method = 'GET', body, retry = true } = {}) {
  let headers;
  try {
    headers = { ...(await authHeaders()) };
  } catch (err) {
    throw new ImageError(err?.message || NET_ERROR);
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
    throw new ImageError(NET_ERROR);
  } finally {
    if (timer) clearTimeout(timer);
  }
  let data = null;
  try { data = await res.json(); } catch {}
  // The server forgot this phone (e.g. a reset): register again once and retry.
  if (res.status === 401 && retry) {
    setSetting('device', null);
    return call(path, { method, body, retry: false });
  }
  if (!res.ok) {
    // The server's own words for limits and pauses; ours for everything else.
    const serverMsg = typeof data?.error === 'string' ? data.error.trim() : '';
    const msg = serverMsg && [402, 429, 503].includes(res.status) ? serverMsg : friendly(res.status);
    throw new ImageError(msg, res.status, data);
  }
  return data ?? {};
}

/**
 * Asks the server to paint this dream. `dream` must be saved (its id is where the job is kept); its text, title,
 * tags and kind are used as given, so the editor can pass unsaved edits. Resolves to the updated dream.
 * Throws ImageError (status 402 = monthly limit; body is the server's answer).
 */
export async function requestImage(dream) {
  if (!dream?.id || !getDream(dream.id)) throw new ImageError('Save this dream first.');
  const text = String(dream.text ?? '').trim() || String(dream.title ?? '').trim();
  if (text.length < 3) throw new ImageError('Write a little more about this dream first.', 400);
  const style = getProfile()?.artStyle || 'moonlit';
  const data = await call('/images', {
    method: 'POST',
    body: {
      text: text.slice(0, 6000),
      title: String(dream.title ?? '').slice(0, 200),
      tags: Array.isArray(dream.tags) ? dream.tags.filter((t) => typeof t === 'string').slice(0, 10) : [],
      kind: dream.kind === 'nightmare' ? 'nightmare' : 'dream',
      style,
    },
  });
  if (data.account) applyAccount(data.account);
  if (!data.id || typeof data.id !== 'string') throw new ImageError(SERVER_ERROR);
  return updateDream(dream.id, {
    imageJob: { id: data.id, status: 'pending', style, requestedAt: new Date().toISOString() },
  });
}

/**
 * What the screens call. Opens the paywall without asking the server when the free images are used up,
 * sends the request, starts checking for the result and reports problems through `toast`.
 * auto: started by Analyze or Save rather than a tap on "Visualise as image": a limit then shows a toast, not the paywall.
 * Resolves to the updated dream, or null when nothing was started.
 */
export async function createImage(dream, { toast, auto = false } = {}) {
  if (!dream?.id || sending.has(dream.id) || isImagePending(getDream(dream.id))) return null;
  if (imagesBlocked()) {
    if (!auto) openPaywall({ feature: 'images' });
    return null;
  }
  sending.add(dream.id);
  emit(dream.id);
  let out = null;
  try {
    out = await requestImage(dream);
  } catch (err) {
    if (err?.status === 402) {
      getAccount({ refresh: true }).catch(() => {});
      if (auto) toast?.(err.message);
      else handleLimit(err.body, 'images');
    } else {
      toast?.(err?.message || SERVER_ERROR);
    }
  } finally {
    sending.delete(dream.id);
  }
  if (out) pollImage(out.id);
  emit(dream.id);
  return out;
}

/** Forgets a failed attempt (the dream keeps its current picture). */
export function dismissImageError(dreamId) {
  const d = getDream(dreamId);
  if (!isImageFailed(d)) return;
  updateDream(dreamId, { imageJob: null });
  emit(dreamId);
}

// ---- Checking for the result ----

const age = (job) => {
  const t = Date.parse(job?.requestedAt || '');
  return Number.isFinite(t) ? Date.now() - t : 0;
};

/** One check. Resolves to { dream, changed, finished }. Throws ImageError on network trouble. */
async function checkOnce(dreamId) {
  const job = getDream(dreamId)?.imageJob;
  if (!job?.id || job.status !== 'pending') return { dream: getDream(dreamId), changed: false, finished: true };
  let data;
  try {
    data = await call(`/images/${encodeURIComponent(job.id)}`, { retry: false });
  } catch (err) {
    if ([401, 403, 404, 410].includes(err.status)) data = { status: 'failed', error: 'This image could not be found. Please try again.' };
    else throw err;
  }

  // Re-read: the dream may have been deleted, or a new image asked for, while we waited.
  const fresh = getDream(dreamId);
  const cur = fresh?.imageJob;
  if (!cur || cur.id !== job.id) return { dream: fresh, changed: false, finished: true };

  if (data.status === 'done' && typeof data.url === 'string' && FILE_RE.test(data.url)) {
    const style = typeof data.style === 'string' && data.style.length <= 30 ? data.style : cur.style || 'moonlit';
    const dream = updateDream(dreamId, {
      image: { id: cur.id, url: imageFileURL(data.url), style, createdAt: new Date().toISOString() },
      imageJob: null,
    });
    return { dream, changed: true, finished: true };
  }
  const failed = data.status === 'failed' || data.status === 'done'; // done without a usable file counts as failed
  const tooLong = !failed && age(cur) > GIVE_UP_MS;
  if (failed || tooLong) {
    const error = tooLong ? 'This took too long. Please try again.'
      : String(typeof data.error === 'string' && data.error ? data.error : "The image didn't work this time.").slice(0, 300);
    const dream = updateDream(dreamId, { imageJob: { ...cur, status: 'failed', error } });
    return { dream, changed: true, finished: true };
  }
  return { dream: fresh, changed: false, finished: false };
}

const pollers = new Map(); // dreamId → { listeners, timer, delay, inFlight }

/**
 * Keeps checking a pending image until it is done or failed: after 4 s, then gradually slower (max every 15 s).
 * Pauses while the app is hidden and checks straight away when it is visible again. One loop per dream, shared
 * by every caller, and it keeps running when the screen that started it closes (so the picture is saved anyway).
 * onUpdate(dream) runs when the job finished. Returns a function that removes onUpdate (the loop goes on).
 */
export function pollImage(dreamId, onUpdate) {
  let p = pollers.get(dreamId);
  if (!p) {
    if (!isImagePending(getDream(dreamId))) return () => {};
    p = startLoop(dreamId);
  }
  if (typeof onUpdate === 'function') p.listeners.add(onUpdate);
  return () => { p.listeners.delete(onUpdate); };
}

/** Resumes checking every dream whose image was still being painted (e.g. after the app was closed). */
export function resumePendingImages() {
  let n = 0;
  try {
    for (const d of listDreams()) if (isImagePending(d)) { pollImage(d.id); n += 1; }
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
    if (hasDoc && document.hidden) return; // onVisible picks it up again
    if (p.inFlight) return;
    p.inFlight = true;
    let res = null;
    try {
      res = await checkOnce(dreamId);
    } catch {
      // Offline or a server hiccup: try again on the next beat, unless it has been far too long.
      if (age(getDream(dreamId)?.imageJob) > STOP_MS) res = { finished: true };
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
  schedule(Math.max(300, FIRST_MS - age(getDream(dreamId)?.imageJob)));
  return p;
}
