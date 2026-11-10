// AI dream videos: poyo.ai first (Seedance 2.0), fal.ai as fallback — the same pattern as images.js.
// Providers, lengths, qualities and timing come from plans.json "videos" (see video-options.js); the user picks
// the length and quality of each video.
// When the dream already has an AI image, it becomes the first frame (image-to-video), so the video matches it:
// the picture is cropped to the video's shape on this server and uploaded to the provider (poyo can't always
// reach our public address). If every provider refuses the picture, the video is made from the text alone.
import { createWriteStream } from 'node:fs';
import { mkdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { lightFor } from './images.js';
import { estimateMinutes } from './video-options.js';

const POYO_BASE = 'https://api.poyo.ai/api/generate';
const MAX_BYTES = 80 * 1024 * 1024;
// How long to wait for one provider job: well past the usual time (see estimateMinutes), at least 20 minutes.
// Never abandon a running job early: poyo charges for it anyway.
const waitMs = (minutes) => Math.min(90, Math.max(20, Math.ceil(minutes * 2.5))) * 60 * 1000;

/** Builds the video prompt from the dream. fromImage: the dream's AI image is the first frame. Longer videos
 *  carry more of the dream and follow its events in order. */
export function buildVideoPrompt({ text, tags = [], kind, style, fromImage = false, seconds = 5 }) {
  const room = seconds >= 15 ? 1400 : seconds >= 10 ? 1000 : seconds >= 8 ? 800 : 450;
  const scene = String(text || '').replace(/\s+/g, ' ').trim().slice(0, room);
  const flow = seconds >= 8 ? 'Show what happens in the order it happens, as one continuous dreamlike sequence.' : '';
  const mood = tags.length ? `Mood: ${tags.slice(0, 5).join(', ')}.` : '';
  const soft = kind === 'nightmare'
    ? 'Tense and eerie but not graphic: atmosphere, shadow and suspense; no gore, no blood, no injuries.'
    : '';
  return [
    fromImage
      ? `Bring this photo to life as a short scene from a dream: ${scene}`
      : `A photorealistic cinematic video of this scene from a dream: ${scene}`,
    flow, mood, soft,
    `Lighting and colour: ${lightFor(style)}.`,
    'Slow, smooth camera movement such as a gentle push-in or drift, natural realistic motion, true-to-life textures and materials, soft ambient sound, slightly dreamlike atmosphere but fully realistic, as if filmed on a cinema camera.',
    'Not a cartoon, not animation, not a 3D render.',
    'No text, no subtitles, no watermark, no logos. Any people are ordinary, anonymous adults who do not resemble any real or famous person.',
  ].filter(Boolean).join(' ');
}

function urlsIn(d) {
  const out = [];
  const push = (u) => { if (typeof u === 'string' && u.startsWith('http') && !out.includes(u)) out.push(u); };
  push(d?.video_url); push(d?.output?.video_url); push(d?.output?.url); push(d?.video?.url);
  for (const f of d?.files || []) { push(f?.file_url); push(f?.url); }
  for (const v of d?.videos || []) push(typeof v === 'string' ? v : v?.url);
  for (const o of Array.isArray(d?.output) ? d.output : []) push(typeof o === 'string' ? o : o?.url);
  return out;
}

/** The first-frame picture as a JPEG data URL, centre-cropped to the video's aspect (e.g. 9:16 → 720×1280). */
async function firstFrame(imagePath, aspect) {
  const [w, h] = String(aspect || '9:16').split(':').map(Number);
  const height = 1280;
  const width = Math.round((height * (w || 9)) / (h || 16) / 2) * 2;
  const sharp = (await import('sharp')).default;
  const jpg = await sharp(imagePath).resize(width, height, { fit: 'cover' }).jpeg({ quality: 88 }).toBuffer();
  return `data:image/jpeg;base64,${jpg.toString('base64')}`;
}

/** Uploads a data URL to poyo's own storage and returns its address there. */
async function poyoUpload(dataUrl, key) {
  const res = await fetch('https://api.poyo.ai/api/common/upload/base64', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ base64_data: dataUrl }),
    signal: AbortSignal.timeout(60000),
  });
  const data = await res.json().catch(() => null);
  const url = data?.data?.file_url || data?.file_url || data?.url;
  if (!res.ok || !url) throw new Error(`poyo upload ${res.status}: ${JSON.stringify(data).slice(0, 160)}`);
  return url;
}

async function poyo(p, { prompt, frame, cfg, wait }, key) {
  const input = { prompt, duration: cfg.duration, resolution: cfg.resolution, aspect_ratio: cfg.aspect };
  if (frame) input.image_urls = [await poyoUpload(frame, key)];
  const submit = await fetch(`${POYO_BASE}/submit`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: p.model, input }),
    signal: AbortSignal.timeout(30000),
  });
  if (!submit.ok) throw new Error(`poyo submit ${submit.status}: ${(await submit.text()).slice(0, 200)}`);
  const data = await submit.json();
  // poyo reports errors (low balance, bad input) with HTTP 200 and a code field.
  if (data.code && data.code >= 400) throw new Error(`poyo ${data.code}: ${data.error?.message || data.message || 'error'}`);
  const taskId = data.data?.task_id || data.task_id || data.id;
  console.log('video task', p.model, taskId, frame ? 'from image' : 'from text');
  if (!taskId) {
    const direct = urlsIn(data.data || data)[0];
    if (direct) return direct;
    throw new Error(`poyo: unexpected reply ${JSON.stringify(data).slice(0, 160)}`);
  }
  const started = Date.now();
  while (Date.now() - started < wait) {
    await new Promise((r) => setTimeout(r, 6000));
    let body;
    try {
      const res = await fetch(`${POYO_BASE}/status/${taskId}`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(20000) });
      if (!res.ok) continue;
      body = await res.json();
    } catch { continue; }
    const status = String(body.data?.status || body.status || '').toLowerCase();
    if (['completed', 'succeeded', 'success', 'finished'].includes(status)) {
      const urls = urlsIn(body.data || body);
      const url = urls.find((u) => /\.mp4(\?|$)/i.test(u)) || urls[0];
      if (!url) throw new Error('poyo finished without a video url');
      return url;
    }
    if (status === 'failed' || status === 'error') {
      const e = body.data?.error_message || body.data?.error || body.error;
      throw new Error(`poyo failed: ${typeof e === 'string' ? e : JSON.stringify(e || 'unknown').slice(0, 200)}`);
    }
  }
  throw new Error('poyo timed out');
}

// fal's queue API: submit, poll the status url, then read the result.
async function fal(p, { prompt, frame, cfg, wait }, key) {
  const model = frame && p.imageModel ? p.imageModel : p.model;
  const input = { prompt, duration: String(cfg.duration), resolution: cfg.resolution, aspect_ratio: cfg.aspect };
  if (frame && p.imageModel) input.image_url = frame; // fal accepts data URLs
  const headers = { Authorization: `Key ${key}`, 'Content-Type': 'application/json' };
  const submit = await fetch(`https://queue.fal.run/${model}`, { method: 'POST', headers, body: JSON.stringify(input), signal: AbortSignal.timeout(30000) });
  if (!submit.ok) throw new Error(`fal ${submit.status}: ${(await submit.text()).slice(0, 200)}`);
  const job = await submit.json();
  if (!job.status_url || !job.response_url) throw new Error('fal: no request id');
  const started = Date.now();
  while (Date.now() - started < wait) {
    await new Promise((r) => setTimeout(r, 6000));
    let st;
    try {
      const res = await fetch(job.status_url, { headers, signal: AbortSignal.timeout(20000) });
      if (!res.ok) continue;
      st = await res.json();
    } catch { continue; }
    if (st.status === 'COMPLETED') {
      const out = await (await fetch(job.response_url, { headers, signal: AbortSignal.timeout(30000) })).json();
      const url = out.video?.url || urlsIn(out)[0];
      if (!url) throw new Error(`fal finished without a video: ${JSON.stringify(out).slice(0, 160)}`);
      return url;
    }
    if (st.status === 'FAILED' || st.error) throw new Error(`fal failed: ${String(st.error || 'unknown').slice(0, 200)}`);
  }
  throw new Error('fal timed out');
}

/**
 * Generates one video and stores it in `dir` as <id>.mp4. Returns { file, provider, model, units, bytes, fromImage }.
 * imagePath: the dream's AI image on this server (optional) → first frame, used with `prompt`; `textPrompt` is
 * used when there is no picture or every provider refused it.
 * cfg = plans.json "videos" block: { duration, resolution, aspect, providers: [{ name, model, imageModel?, units }] }
 */
export async function generateVideo({ id, prompt, textPrompt, imagePath, seconds, quality, dir, cfg, env }) {
  const errors = [];
  const settings = { duration: seconds || 5, resolution: quality || cfg.defaultQuality || '720p', aspect: cfg.aspect || '9:16' };
  let frame = null;
  if (imagePath) {
    try { frame = await firstFrame(imagePath, settings.aspect); } catch (err) { errors.push(`first frame: ${err.message}`); }
  }
  const text = { frame: null, prompt: textPrompt || prompt };
  const rounds = frame ? [{ frame, prompt }, text] : [text];
  for (const round of rounds) {
    const out = await tryProviders({ id, round, settings, dir, cfg, env, errors });
    if (out) return { ...out, fromImage: Boolean(round.frame) };
  }
  throw new Error(errors.join(' | ') || 'no video provider configured');
}

async function tryProviders({ id, round, settings, dir, cfg, env, errors }) {
  for (const p of cfg.providers || []) {
    const key = p.name === 'poyo' ? env.POYO_API_KEY : env.FAL_API_KEY;
    if (!key) { errors.push(`${p.name}: no key`); continue; }
    const file = `${id}.mp4`;
    const path = join(dir, file);
    try {
      const wait = waitMs(estimateMinutes(cfg, settings.duration, settings.resolution, Boolean(round.frame)));
      const args = { prompt: round.prompt, frame: round.frame, cfg: settings, wait };
      const url = p.name === 'poyo' ? await poyo(p, args, key) : await fal(p, args, key);
      const res = await fetch(url, { signal: AbortSignal.timeout(180000) });
      if (!res.ok || !res.body) throw new Error(`download ${res.status}`);
      if (Number(res.headers.get('content-length')) > MAX_BYTES) throw new Error('video too large');
      await mkdir(dir, { recursive: true });
      await pipeline(Readable.fromWeb(res.body), createWriteStream(path));
      const { size } = await stat(path);
      if (size < 10 * 1024 || size > MAX_BYTES) throw new Error(`video size ${size}`);
      return { file, provider: p.name, model: p.model, units: p.units ?? 1, bytes: size };
    } catch (err) {
      await rm(path, { force: true }).catch(() => {});
      errors.push(`${p.name}${round.frame ? ' (from image)' : ''}: ${err.message}`);
    }
  }
  return null;
}
