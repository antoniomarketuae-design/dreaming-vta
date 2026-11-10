// AI dream images: poyo.ai first (usually cheaper), fal.ai as fallback — the same pattern as the NexFlow platform.
// Providers and models come from plans.json so we can switch to whichever is cheaper without code changes.
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const POYO_BASE = 'https://api.poyo.ai/api/generate';

/**
 * The look of the picture styles chosen in onboarding (ids match the app's ART_STYLES).
 * In "photo" mode they are lighting / colour grading; in "painting" mode, palettes.
 */
const STYLE_PROMPTS = {
  photo: {
    moonlit: 'night scene lit by bright moonlight, cool blue-violet colour grading, stars visible',
    'rose-dusk': 'golden-hour to dusk light, soft pink and rose sky, warm haze',
    ember: 'warm amber firelight and candle glow, deep shadows',
    aurora: 'night sky with green and teal aurora borealis lighting the scene',
    'deep-tide': 'cool deep-blue tones, soft underwater-like light',
    'silver-mist': 'black and white photograph, soft mist, fine film grain',
  },
  painting: {
    moonlit: 'soft violet night palette, moonlight glow, gentle stars',
    'rose-dusk': 'pink and rose dusk light, warm soft haze',
    ember: 'warm amber and ember tones, firelit glow',
    aurora: 'green and teal aurora light, northern-sky glow',
    'deep-tide': 'cool deep-blue ocean tones, calm luminous water light',
    'silver-mist': 'black and white, silver mist, fine film grain',
  },
};

/** Photographic lighting / colour grading for a picture style (shared with the video prompts). */
export const lightFor = (style) => STYLE_PROMPTS.photo[style] || STYLE_PROMPTS.photo.moonlit;

/**
 * Builds the image prompt from the dream. look = 'photo' (photorealistic, the default) or 'painting'.
 * Never names real people; nightmares are softened.
 */
export function buildPrompt({ title, text, tags = [], kind, style, look = 'photo' }) {
  const scene = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 450);
  const mood = tags.length ? `Mood: ${tags.slice(0, 5).join(', ')}.` : '';
  const soft = kind === 'nightmare'
    ? 'Tense and eerie but not graphic: atmosphere, shadow and suspense; no gore, no blood, no injuries.'
    : '';
  const styles = STYLE_PROMPTS[look] || STYLE_PROMPTS.photo;
  const light = styles[style] || styles.moonlit;
  if (look === 'painting') {
    return [
      `A dreamlike painted illustration of a dream titled "${String(title || 'a dream').slice(0, 80)}".`,
      `Scene: ${scene}`, mood, soft,
      `Style: ${light}, painterly, surreal, cinematic composition.`,
      'No text, no letters, no watermark, no logos. People appear as anonymous figures, never as real or famous individuals.',
    ].filter(Boolean).join(' ');
  }
  return [
    `A photorealistic cinematic photograph of this scene from a dream: ${scene}`,
    mood, soft,
    `Lighting and colour: ${light}.`,
    'Shot on a full-frame camera with a 35mm lens, natural realistic lighting, true-to-life textures and materials, shallow depth of field, high detail, slightly dreamlike atmosphere but fully realistic, as if it really happened.',
    'Not a painting, not an illustration, not a cartoon, not 3D render, not anime.',
    'No text, no letters, no watermark, no logos. Any people are ordinary, anonymous adults who do not resemble any real or famous person.',
  ].filter(Boolean).join(' ');
}

async function poyo(model, prompt, key) {
  const submit = await fetch(`${POYO_BASE}/submit`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, input: { prompt, size: '1:1', num_images: 1 } }),
    signal: AbortSignal.timeout(30000),
  });
  if (!submit.ok) throw new Error(`poyo submit ${submit.status}: ${(await submit.text()).slice(0, 200)}`);
  const data = await submit.json();
  // poyo reports errors (e.g. low balance, unknown model) with HTTP 200 and a code field.
  if (data.code && data.code >= 400) throw new Error(`poyo ${data.code}: ${data.error?.message || data.message || 'error'}`);
  const direct = urlsIn(data.data || data)[0];
  const taskId = data.data?.task_id || data.data?.taskId || data.task_id || data.taskId || data.data?.id || data.id;
  if (!taskId && !direct) throw new Error(`poyo: unexpected reply ${JSON.stringify(data).slice(0, 160)}`);
  if (!taskId) {
    if (direct) return direct;
    throw new Error('poyo returned no task id');
  }
  const started = Date.now();
  while (Date.now() - started < 3 * 60 * 1000) {
    await new Promise((r) => setTimeout(r, 4000));
    const res = await fetch(`${POYO_BASE}/status/${taskId}`, { headers: { Authorization: `Bearer ${key}` } });
    if (!res.ok) continue;
    let body;
    try { body = await res.json(); } catch { continue; }
    const status = String(body.data?.status || body.status || '').toLowerCase();
    if (['completed', 'succeeded', 'success', 'finished'].includes(status)) {
      const url = urlsIn(body.data || body)[0];
      if (!url) throw new Error('poyo finished without an image url');
      return url;
    }
    if (status === 'failed' || status === 'error') throw new Error(`poyo failed: ${body.data?.error || body.error || 'unknown'}`);
  }
  throw new Error('poyo timed out');
}

async function fal(model, prompt, key) {
  const res = await fetch(`https://fal.run/${model}`, {
    method: 'POST',
    headers: { Authorization: `Key ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, image_size: { width: 1024, height: 1024 }, num_images: 1 }),
    signal: AbortSignal.timeout(120000),
  });
  if (!res.ok) throw new Error(`fal ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = await res.json();
  const url = body.images?.[0]?.url;
  if (!url) throw new Error('fal returned no image');
  return url;
}

function urlsIn(d) {
  const out = [];
  const push = (u) => { if (typeof u === 'string' && u.startsWith('http') && !out.includes(u)) out.push(u); };
  push(d?.image_url); push(d?.output?.url); push(d?.output?.image_url);
  for (const f of d?.files || []) { push(f?.file_url); push(f?.url); }
  for (const i of d?.images || []) push(typeof i === 'string' ? i : i?.url);
  for (const o of Array.isArray(d?.output) ? d.output : []) push(typeof o === 'string' ? o : o?.url);
  return out;
}

/**
 * Generates one image and stores it in `dir` as <id>.<ext>. Returns { file, provider, model, units }.
 * cfg = plans.json "images" block: { providers: [{ name: 'poyo'|'fal', model, units }] }
 */
export async function generateImage({ id, prompt, dir, cfg, env }) {
  const errors = [];
  for (const p of cfg.providers || []) {
    const key = p.name === 'poyo' ? env.POYO_API_KEY : env.FAL_API_KEY;
    if (!key) { errors.push(`${p.name}: no key`); continue; }
    try {
      const url = p.name === 'poyo' ? await poyo(p.model, prompt, key) : await fal(p.model, prompt, key);
      const img = await fetch(url, { signal: AbortSignal.timeout(60000) });
      if (!img.ok) throw new Error(`download ${img.status}`);
      const original = Buffer.from(await img.arrayBuffer());
      await mkdir(dir, { recursive: true });
      // Providers return 2048px PNGs of ~6 MB; phones get a 1024px WebP of ~100–200 KB.
      let file;
      try {
        const sharp = (await import('sharp')).default;
        const small = await sharp(original).resize(1024, 1024, { fit: 'cover' }).webp({ quality: 82 }).toBuffer();
        file = `${id}.webp`;
        await writeFile(join(dir, file), small);
      } catch {
        const type = img.headers.get('content-type') || 'image/jpeg';
        file = `${id}.${type.includes('png') ? 'png' : type.includes('webp') ? 'webp' : 'jpg'}`;
        await writeFile(join(dir, file), original);
      }
      return { file, provider: p.name, model: p.model, units: p.units ?? 1 };
    } catch (err) {
      errors.push(`${p.name}: ${err.message}`);
    }
  }
  throw new Error(errors.join(' | ') || 'no image provider configured');
}
