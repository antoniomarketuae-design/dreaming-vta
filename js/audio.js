// Sleep sounds made live on the phone with the Web Audio API: binaural beats (two sine tones, one per ear)
// and soundscapes (rain, ocean, wind, brown noise) shaped from filtered noise. No audio files, nothing downloaded.
// Nothing is touched at import time: the AudioContext is created on the first play(), inside a tap.

export const BINAURAL = [
  {
    id: 'delta', kind: 'binaural', name: 'Delta', beat: 2, base: 150,
    line: 'The slow rhythm of deep sleep. Many find it calming at bedtime; evidence that it changes sleep is limited.',
  },
  {
    id: 'theta', kind: 'binaural', name: 'Theta', beat: 6, base: 200,
    line: 'Linked with drowsiness and the edge of sleep. A quiet backdrop for WILD or SSILD; effects vary by person.',
  },
  {
    id: 'alpha', kind: 'binaural', name: 'Alpha', beat: 10, base: 240,
    line: 'Linked with relaxed, eyes-closed rest. Good for winding down; it will not make you lucid on its own.',
  },
];

export const SOUNDSCAPES = [
  { id: 'rain', kind: 'soundscape', name: 'Rain', line: 'Steady rain on leaves', hue: 215 },
  { id: 'ocean', kind: 'soundscape', name: 'Ocean', line: 'Slow waves rolling in', hue: 190 },
  { id: 'wind', kind: 'soundscape', name: 'Wind', line: 'A soft wind rising and falling', hue: 260 },
  { id: 'brown', kind: 'soundscape', name: 'Deep hush', line: 'Low, warm brown noise', hue: 30 },
];

export const TRACKS = [...BINAURAL, ...SOUNDSCAPES];
export const getTrack = (id) => TRACKS.find((t) => t.id === id) || null;
export const trackTitle = (t) => (t.kind === 'binaural' ? `${t.name} · ${t.beat} Hz` : t.name);

const FADE_IN = 1.5;
const FADE_OUT = 0.6;
const TIMER_FADE = 10;

let ctx = null;
let master = null;
let nodes = [];          // everything of the current track, stopped/disconnected on stop
let noiseCache = {};     // AudioBuffers by noise colour
let current = null;      // track id
let playing = false;
let timerMin = 0;        // chosen sleep timer in minutes (0 = off)
let endsAt = null;       // ms timestamp when the timer ends (while playing)
let remainingMs = null;  // timer time left while paused
let timerId = null;
let stopId = null;
let fading = [];         // nodes of a stopped track that are still fading out
const listeners = new Set();

function emit() {
  for (const fn of listeners) { try { fn(state()); } catch {} }
}

/** Called after every change (play, pause, stop, timer). Returns an unsubscribe function. */
export function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function supported() {
  return typeof window !== 'undefined' && Boolean(window.AudioContext || window.webkitAudioContext);
}

/** { id, playing, timerMin, endsAt (ms or null), remainingMs (ms or null) } */
export function state() {
  const remaining = endsAt ? Math.max(0, endsAt - Date.now()) : remainingMs;
  return { id: current, playing, timerMin, endsAt, remainingMs: remaining };
}

function ensureContext() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);
  }
  // Safari 17+: play even when the ring/silent switch is on silent.
  try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch {}
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

// ---- Noise ----

/** A seamless stereo loop of white, pink or brown noise (the end is cross-faded into the start). */
function noiseBuffer(colour) {
  if (noiseCache[colour]) return noiseCache[colour];
  const rate = ctx.sampleRate;
  const len = Math.floor(rate * 8);
  const fade = Math.floor(rate * 0.5);
  const buf = ctx.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch += 1) {
    const raw = new Float32Array(len + fade);
    let b0 = 0; let b1 = 0; let b2 = 0; let b3 = 0; let b4 = 0; let b5 = 0; let b6 = 0; let last = 0;
    for (let i = 0; i < raw.length; i += 1) {
      const w = Math.random() * 2 - 1;
      if (colour === 'pink') {
        // Paul Kellet's refined pink-noise filter
        b0 = 0.99886 * b0 + w * 0.0555179;
        b1 = 0.99332 * b1 + w * 0.0750759;
        b2 = 0.96900 * b2 + w * 0.1538520;
        b3 = 0.86650 * b3 + w * 0.3104856;
        b4 = 0.55000 * b4 + w * 0.5329522;
        b5 = -0.7616 * b5 - w * 0.0168980;
        raw[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
        b6 = w * 0.115926;
      } else if (colour === 'brown') {
        last = (last + 0.02 * w) / 1.02;
        raw[i] = last * 3.5;
      } else {
        raw[i] = w * 0.5;
      }
    }
    const out = buf.getChannelData(ch);
    for (let i = 0; i < len; i += 1) out[i] = raw[i];
    for (let i = 0; i < fade; i += 1) {
      const t = i / fade;
      out[i] = raw[i] * t + raw[len + i] * (1 - t);
    }
  }
  noiseCache[colour] = buf;
  return buf;
}

function noiseSource(colour) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(colour);
  src.loop = true;
  src.start(0, Math.random() * 7);
  nodes.push(src);
  return src;
}

function filter(type, frequency, Q = 0.7) {
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = frequency;
  f.Q.value = Q;
  nodes.push(f);
  return f;
}

function gain(value) {
  const g = ctx.createGain();
  g.gain.value = value;
  nodes.push(g);
  return g;
}

/** Slow sine LFO added onto an AudioParam: param swings ±depth around its own value. */
function lfo(param, rate, depth) {
  const o = ctx.createOscillator();
  o.frequency.value = rate;
  const d = gain(depth);
  o.connect(d).connect(param);
  o.start();
  nodes.push(o);
  return o;
}

// ---- Tracks ----

function buildBinaural(t, out) {
  const merger = ctx.createChannelMerger(2);
  nodes.push(merger);
  [t.base, t.base + t.beat].forEach((freq, ear) => {
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = freq;
    const g = gain(0.22);
    o.connect(g).connect(merger, 0, ear);
    o.start();
    nodes.push(o);
  });
  merger.connect(out);
}

function buildSoundscape(id, out) {
  if (id === 'rain') {
    const body = gain(0.9);
    noiseSource('pink').connect(filter('highpass', 400)).connect(filter('lowpass', 7000)).connect(body).connect(out);
    lfo(body.gain, 0.13, 0.1);
    const hiss = gain(0.25);
    noiseSource('white').connect(filter('bandpass', 4200, 0.6)).connect(hiss).connect(out);
    lfo(hiss.gain, 0.21, 0.05);
    noiseSource('brown').connect(filter('lowpass', 250)).connect(gain(0.2)).connect(out);
  } else if (id === 'ocean') {
    const swell = gain(0.4);
    noiseSource('brown').connect(filter('lowpass', 800)).connect(swell).connect(out);
    lfo(swell.gain, 0.075, 0.32);
    const foam = gain(0.08);
    noiseSource('pink').connect(filter('bandpass', 1400, 0.5)).connect(foam).connect(out);
    lfo(foam.gain, 0.075, 0.07);
  } else if (id === 'wind') {
    const band = filter('bandpass', 520, 1.4);
    const level = gain(1.6);
    noiseSource('pink').connect(band).connect(level).connect(out);
    lfo(band.frequency, 0.06, 240);
    lfo(level.gain, 0.09, 0.6);
    noiseSource('brown').connect(filter('lowpass', 300)).connect(gain(0.3)).connect(out);
  } else {
    noiseSource('brown').connect(filter('lowpass', 1000)).connect(gain(0.45)).connect(out);
  }
}

function teardown(list) {
  for (const n of list) {
    try { n.stop?.(); } catch {}
    try { n.disconnect(); } catch {}
  }
}

function clearTimer() {
  clearTimeout(timerId);
  timerId = null;
}

function armTimer(ms) {
  clearTimer();
  if (!ms) { endsAt = null; return; }
  endsAt = Date.now() + ms;
  remainingMs = null;
  timerId = setTimeout(() => stop({ fade: TIMER_FADE }), ms);
}

/** Starts a track (stops whatever was playing). Call it directly from a tap so iPhone allows sound. */
export function play(id) {
  const t = getTrack(id);
  if (!t || !supported()) return false;
  ensureContext();
  clearTimeout(stopId);
  teardown([...fading, ...nodes]);
  fading = [];
  nodes = [];
  const now = ctx.currentTime;
  master.gain.cancelScheduledValues(now);
  master.gain.setValueAtTime(0, now);
  master.gain.linearRampToValueAtTime(1, now + FADE_IN);
  const out = gain(1);
  out.connect(master);
  if (t.kind === 'binaural') buildBinaural(t, out);
  else buildSoundscape(t.id, out);
  current = id;
  playing = true;
  armTimer(timerMin * 60000);
  emit();
  return true;
}

export function pause() {
  if (!ctx || !playing) return;
  playing = false;
  if (endsAt) remainingMs = Math.max(0, endsAt - Date.now());
  endsAt = null;
  clearTimer();
  ctx.suspend().catch(() => {});
  emit();
}

export function resume() {
  if (!ctx || !current || playing) return;
  ensureContext();
  playing = true;
  if (remainingMs != null && timerMin) armTimer(remainingMs);
  emit();
}

/** Play/pause: the same track toggles, another track switches. */
export function toggle(id) {
  if (id === current && playing) pause();
  else if (id === current && ctx) resume();
  else play(id);
}

/** Stops with a fade (seconds). The timer uses a long, gentle fade. */
export function stop({ fade = FADE_OUT } = {}) {
  clearTimer();
  endsAt = null;
  remainingMs = null;
  if (!ctx) { current = null; playing = false; emit(); return; }
  fading.push(...nodes);
  nodes = [];
  clearTimeout(stopId);
  const finish = () => { teardown(fading); fading = []; };
  if (ctx.state === 'suspended') {
    finish();
  } else {
    const now = ctx.currentTime;
    master.gain.cancelScheduledValues(now);
    master.gain.setValueAtTime(master.gain.value, now);
    master.gain.linearRampToValueAtTime(0, now + fade);
    stopId = setTimeout(finish, fade * 1000 + 100);
  }
  current = null;
  playing = false;
  emit();
}

/** Sleep timer in minutes (0 = off). Restarts the countdown if a track is playing. */
export function setTimer(minutes) {
  timerMin = Math.max(0, Number(minutes) || 0);
  if (playing) armTimer(timerMin * 60000);
  else { remainingMs = timerMin && current ? timerMin * 60000 : null; }
  emit();
}

/** A soft bell, the cue for Audio cues and Sound conditioning. Mixes over a playing track. */
export function playCue(volume = 0.35) {
  if (!supported()) return false;
  // Resuming the context for the cue would also un-pause a paused track, so end that track first.
  if (current && !playing) stop();
  ensureContext();
  const now = ctx.currentTime;
  const out = ctx.createGain();
  out.gain.value = volume;
  out.connect(ctx.destination);
  const partials = [[660, 1], [660 * 2.01, 0.45], [660 * 2.76, 0.25], [660 * 4.07, 0.12]];
  for (const [freq, amp] of partials) {
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = freq;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, now);
    env.gain.linearRampToValueAtTime(amp, now + 0.015);
    env.gain.exponentialRampToValueAtTime(0.0001, now + 2.8 / (1 + Math.log2(freq / 660)));
    o.connect(env).connect(out);
    o.start(now);
    o.stop(now + 3);
  }
  setTimeout(() => { try { out.disconnect(); } catch {} }, 3200);
  return true;
}

/** "29:41" style countdown text. */
export function formatRemaining(ms) {
  if (ms == null) return '';
  const s = Math.ceil(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const pad = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m % 60)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
}
