// Dream interpretation (beta): sends ONE dream's text to Dreaming's server when the user asks,
// then checks back until an answer is ready. The journal itself never leaves the phone.
// Touches document/window/localStorage only inside functions, never at import time.
import { getDream, updateDream, getSetting } from './store.js';
import { authHeaders, applyAccount } from './account.js';

export const API_BASE = 'https://nexflowclub.com/dreaming-api';

const PENDING = new Set(['waiting', 'working']);
const FAST_MS = 5_000;          // check every 5 s at first...
const FAST_FOR_MS = 2 * 60_000; // ...for the first 2 minutes,
const SLOW_MS = 15_000;         // then every 15 s,
const GIVE_UP_MS = 45 * 60_000; // and stop after 45 minutes (resumes next time the dream is opened).
const TIMEOUT_MS = 20_000;

export function isEnabled() {
  return getSetting('interpretBeta', false) === true;
}

export const isPending = (dream) => PENDING.has(dream?.interpretation?.status);

/** Short fingerprint of the dream text, to notice edits made after an interpretation was asked for. */
export function textHash(text) {
  let h = 5381;
  const s = String(text ?? '');
  for (let i = 0; i < s.length; i += 1) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

/** True when the dream text changed after its interpretation was requested. */
export function isStale(dream) {
  const hash = dream?.interpretation?.textHash;
  return Boolean(hash) && hash !== textHash(dream.text);
}

class InterpretError extends Error {
  constructor(message, status = 0, body = null) {
    super(message);
    this.name = 'InterpretError';
    this.status = status;
    this.body = body; // the server's answer (for 402: { error, limit } → account.handleLimit)
  }
}

async function call(path, { method = 'GET', token, body, auth = false } = {}) {
  const headers = {};
  // The device account (plan limits). If it can't be set up, send without: the server still serves the request.
  if (auth) { try { Object.assign(headers, await authHeaders()); } catch {} }
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers['X-Dream-Token'] = token;
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
    throw new InterpretError("Couldn't reach Dreaming's server. Check your connection and try again.");
  } finally {
    if (timer) clearTimeout(timer);
  }
  let data = null;
  try { data = await res.json(); } catch {}
  if (!res.ok) {
    const serverMsg = typeof data?.error === 'string' ? data.error.trim() : '';
    const msg = res.status === 402 ? serverMsg || "You've used this month's interpretations."
      : res.status === 429 ? serverMsg || 'Lots of dreams are waiting right now. Please try again in a little while.'
      : res.status === 503 ? serverMsg || 'Interpretations are paused for today. Please try again tomorrow.'
      : res.status === 400 ? 'Write a little more about this dream first.'
      : res.status === 404 ? 'That interpretation could not be found.'
      : 'Something went wrong on the server. Please try again later.';
    throw new InterpretError(msg, res.status, data);
  }
  return data ?? {};
}

/**
 * Asks the server to interpret this dream. Resolves to the updated dream; throws InterpretError with a friendly
 * message (status 402 = this month's interpretations are used up; err.body goes to account.handleLimit).
 */
export async function requestInterpretation(dream) {
  const text = String(dream?.text ?? '').trim();
  if (text.length < 3) throw new InterpretError('Write a little more about this dream first.', 400);
  const data = await call('/interpretations', {
    method: 'POST',
    auth: true,
    body: {
      text,
      title: dream.title || '',
      tags: Array.isArray(dream.tags) ? dream.tags : [],
      lucid: Boolean(dream.lucid),
      recurring: Boolean(dream.recurring),
      date: dream.date || '',
      lang: 'en',
    },
  });
  if (data.account) applyAccount(data.account);
  if (!data.id || !data.token) throw new InterpretError('Something went wrong on the server. Please try again later.');
  return updateDream(dream.id, {
    interpretation: {
      id: String(data.id),
      token: String(data.token),
      status: PENDING.has(data.status) ? data.status : 'waiting',
      requestedAt: new Date().toISOString(),
      textHash: textHash(text),
    },
  });
}

/**
 * Checks the server once. Saves the dream when anything new arrived.
 * Resolves to { dream, changed }. Throws InterpretError on network/server trouble.
 */
export async function fetchStatus(dream) {
  const interp = dream?.interpretation;
  if (!interp?.id || !interp.token) return { dream, changed: false };
  let data;
  try {
    data = await call(`/interpretations/${encodeURIComponent(interp.id)}`, { token: interp.token });
  } catch (err) {
    // The server no longer knows this request (or refuses the token): treat it as failed so the user can retry.
    if ([401, 403, 404, 410].includes(err.status)) data = { status: 'failed', error: 'not found' };
    else throw err;
  }

  // Re-read: the dream may have been deleted, or a new request made, while we waited.
  const fresh = getDream(dream.id);
  const cur = fresh?.interpretation;
  if (!cur || cur.id !== interp.id) return { dream: fresh, changed: false };

  const status = ['waiting', 'working', 'done', 'failed'].includes(data.status) ? data.status : cur.status;
  const patch = {};
  if (status !== cur.status) patch.status = status;
  if (status === 'done' && data.result && typeof data.result === 'object' && !cur.result) patch.result = data.result;
  if (data.answeredAt && data.answeredAt !== cur.answeredAt) patch.answeredAt = data.answeredAt;
  if (status === 'failed' && data.error && data.error !== cur.error) patch.error = String(data.error);
  if ((data.rating === 1 || data.rating === -1) && cur.rating == null) patch.rating = data.rating;
  if (!Object.keys(patch).length) return { dream: fresh, changed: false };

  return { dream: updateDream(fresh.id, { interpretation: { ...cur, ...patch } }), changed: true };
}

/** Sends 👍 (1) or 👎 (-1), with an optional note, and remembers it on the phone. Throws InterpretError. */
export async function sendFeedback(dream, rating, note) {
  const interp = dream?.interpretation;
  if (!interp?.id || !interp.token) throw new InterpretError('This interpretation is no longer available.');
  const r = rating === -1 ? -1 : 1;
  const body = { rating: r };
  const cleanNote = String(note ?? '').trim().slice(0, 1000);
  if (cleanNote) body.note = cleanNote;
  await call(`/interpretations/${encodeURIComponent(interp.id)}/feedback`, { method: 'POST', token: interp.token, body });
  const fresh = getDream(dream.id);
  if (!fresh?.interpretation || fresh.interpretation.id !== interp.id) return fresh;
  const next = { ...fresh.interpretation, rating: r };
  if (cleanNote) next.feedbackNote = cleanNote;
  return updateDream(fresh.id, { interpretation: next });
}

/**
 * Polls a pending interpretation: every 5 s for 2 minutes, then every 15 s, for up to 45 minutes.
 * Pauses while the app is hidden and checks straight away when it is visible again.
 * Network errors are swallowed (it simply tries again). onUpdate(dream) runs whenever something changed.
 * Returns stop().
 */
export function startPolling(dreamId, onUpdate) {
  const started = Date.now();
  let timer = null;
  let stopped = false;
  let inFlight = false;
  const hasDoc = typeof document !== 'undefined';

  const stop = () => {
    if (stopped) return;
    stopped = true;
    clearTimeout(timer);
    if (hasDoc) document.removeEventListener('visibilitychange', onVisible);
  };

  const schedule = () => {
    clearTimeout(timer);
    if (stopped) return;
    timer = setTimeout(tick, Date.now() - started < FAST_FOR_MS ? FAST_MS : SLOW_MS);
  };

  async function tick() {
    timer = null;
    if (stopped) return;
    if (Date.now() - started > GIVE_UP_MS) { stop(); return; }
    if (hasDoc && document.hidden) return; // onVisible picks it up again
    if (inFlight) { schedule(); return; }
    const dream = getDream(dreamId);
    if (!isPending(dream)) { stop(); return; }
    inFlight = true;
    try {
      const { dream: next, changed } = await fetchStatus(dream);
      if (stopped) return;
      if (changed) { try { onUpdate?.(next); } catch {} }
      if (!isPending(next)) { stop(); return; }
    } catch {
      // Quiet: offline or server hiccup. Try again on the next beat.
    } finally {
      inFlight = false;
    }
    schedule();
  }

  function onVisible() {
    if (stopped || document.hidden) return;
    clearTimeout(timer);
    tick();
  }

  if (hasDoc) document.addEventListener('visibilitychange', onVisible);
  tick();
  return stop;
}
