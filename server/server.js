// Dreaming interpretation inbox.
// Phones send a dream and get back an id + secret token; they poll with the token for the answer.
// C++ (from the dev PC, holding ADMIN_KEY) picks up waiting dreams, interprets them and writes
// the answer back. Later the server will call the AI itself; the phone-facing API stays the same.
// Runs behind nginx at https://www.nexflowclub.com/dreaming-api/ (nginx strips that prefix).
import http from 'node:http';
import crypto from 'node:crypto';
import { readFileSync, createReadStream, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { buildPrompt, generateImage } from './images.js';
import { buildVideoPrompt, generateVideo, generateFilm, splitScenes } from './videos.js';
import { publicVideoOptions, wordCount, maxSeconds, videoCost, estimateMinutes, isLength, clipsFor } from './video-options.js';
import { loadLibrary, librarySize, findEntry, publicEntry, libraryIndex } from './library.js';
import { DASH_SCHEMA, createDashboard } from './dashboard.js';

try { process.loadEnvFile(fileURLToPath(new URL('./.env', import.meta.url))); } catch {}

const PORT = Number(process.env.PORT) || 3020;
const ADMIN_KEY = process.env.ADMIN_KEY || '';
const IP_SALT = process.env.IP_SALT || '';
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
const KEEP_DAYS = Number(process.env.KEEP_DAYS) || 60;
const VERSION = '3';
const HERE = fileURLToPath(new URL('.', import.meta.url));
const IMAGE_DIR = process.env.IMAGE_DIR || join(HERE, 'images');
const VIDEO_DIR = process.env.VIDEO_DIR || join(HERE, 'videos');
const PLANS = JSON.parse(readFileSync(join(HERE, 'plans.json'), 'utf8'));
// The symbol library (private: copied to the server only, never in the repo). See library.js.
const LIBRARY_DIR = process.env.LIBRARY_DIR || join(HERE, 'library');
console.log(`library: ${loadLibrary(LIBRARY_DIR)} entries from ${LIBRARY_DIR}`);

if (ADMIN_KEY.length < 32) {
  console.error('ADMIN_KEY is missing or too short');
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 5 });

const SCHEMA = `
  create table if not exists interpretations (
    id          text primary key,
    token_hash  text not null,
    status      text not null default 'waiting' check (status in ('waiting', 'working', 'done', 'failed')),
    dream       jsonb not null,
    result      jsonb,
    error       text,
    ip_hash     text,
    created_at  timestamptz not null default now(),
    claimed_at  timestamptz,
    answered_at timestamptz,
    rating      smallint check (rating in (-1, 1)),
    feedback    text,
    feedback_at timestamptz
  );
  create index if not exists interpretations_status_created on interpretations (status, created_at);
  alter table interpretations add column if not exists device_id text;

  -- Anonymous device accounts: the phone keeps id + secret token; no personal data.
  create table if not exists devices (
    id          text primary key,
    token_hash  text not null,
    plan        text not null default 'free',
    plus_until  timestamptz,
    created_at  timestamptz not null default now(),
    last_seen   timestamptz
  );
  -- Usage per device per calendar month, for plan limits.
  create table if not exists usage (
    device_id text not null,
    period    text not null,
    images    int not null default 0,
    analyses  int not null default 0,
    primary key (device_id, period)
  );
  create table if not exists images (
    id          text primary key,
    device_id   text not null,
    status      text not null default 'pending' check (status in ('pending', 'done', 'failed')),
    style       text,
    prompt      text,
    provider    text,
    model       text,
    units       numeric,
    file        text,
    error       text,
    created_at  timestamptz not null default now(),
    finished_at timestamptz
  );
  create index if not exists images_created on images (created_at);
  alter table usage add column if not exists videos int not null default 0;
  create table if not exists videos (
    id          text primary key,
    device_id   text not null,
    status      text not null default 'pending' check (status in ('pending', 'done', 'failed')),
    style       text,
    image_id    text,
    prompt      text,
    provider    text,
    model       text,
    units       numeric,
    file        text,
    bytes       bigint,
    error       text,
    created_at  timestamptz not null default now(),
    finished_at timestamptz
  );
  create index if not exists videos_created on videos (created_at);
  alter table videos add column if not exists seconds int;
  alter table videos add column if not exists quality text;
  alter table videos add column if not exists credits int;
  alter table videos add column if not exists scenes int not null default 1;
  alter table videos add column if not exists scenes_done int not null default 0;
  -- Redeem codes (testers, gifts): grant Plus for N days.
  create table if not exists codes (
    code_hash  text primary key,
    days       int not null,
    uses_left  int not null default 1,
    note       text,
    created_at timestamptz not null default now()
  );
`;

// ---- Helpers ----

const httpError = (status, message) => Object.assign(new Error(message), { status });
const errorLog = [];
function logError(where, message) {
  errorLog.unshift({ at: new Date().toISOString(), where, message: String(message || '').slice(0, 300) });
  if (errorLog.length > 50) errorLog.length = 50;
}
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const newId = () => crypto.randomBytes(9).toString('base64url');
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function clientIp(req) {
  const raw = req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
  return String(raw).split(',')[0].trim();
}

// Sliding-window limits per client, kept in memory (reset on restart, which is fine for an inbox).
const hits = new Map();
function limited(key, max, windowMs) {
  const now = Date.now();
  const recent = (hits.get(key) || []).filter((t) => now - t < windowMs);
  recent.push(now);
  hits.set(key, recent);
  return recent.length > max;
}
setInterval(() => {
  const now = Date.now();
  for (const [key, times] of hits) if (!times.some((t) => now - t < 3600000)) hits.delete(key);
}, 600000).unref();

function corsHeaders(req) {
  const origin = req.headers.origin;
  if (!origin || !ALLOWED_ORIGINS.includes(origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Dream-Token, X-Device-Id, X-Device-Token, X-App-Version',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function readJson(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooBig = false;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) tooBig = true;
      else chunks.push(chunk);
    });
    req.on('end', () => {
      if (tooBig) return reject(httpError(413, 'Request too large'));
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(httpError(400, 'Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

function cleanDream(body) {
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (text.length < 3 || text.length > 6000) throw httpError(400, 'Dream text must be 3 to 6000 characters');
  const str = (v, max) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);
  const tags = Array.isArray(body.tags)
    ? body.tags.filter((t) => typeof t === 'string').slice(0, 10).map((t) => t.slice(0, 30))
    : [];
  return {
    text,
    title: str(body.title, 200),
    tags,
    lucid: body.lucid === true,
    recurring: body.recurring === true,
    date: str(body.date, 10),
    lang: str(body.lang, 12),
  };
}

// What the phone may see about its own dream.
function publicView(row) {
  return {
    id: row.id,
    status: row.status,
    result: row.status === 'done' ? row.result : null,
    error: row.status === 'failed' ? 'This dream could not be interpreted.' : null,
    createdAt: row.created_at,
    answeredAt: row.answered_at,
    rating: row.rating,
  };
}

// ---- Devices, plans and limits ----

const period = () => new Date().toISOString().slice(0, 7); // calendar month, UTC

/** The calling device, or null. Phones send X-Device-Id + X-Device-Token. */
async function deviceOf(req) {
  const id = String(req.headers['x-device-id'] || '');
  const token = String(req.headers['x-device-token'] || '');
  if (!/^[\w-]{10,40}$/.test(id) || token.length < 20) return null;
  const { rows: [d] } = await pool.query('select * from devices where id = $1', [id]);
  if (!d || !safeEqual(sha256(token), d.token_hash)) return null;
  const appVersion = String(req.headers['x-app-version'] || '').replace(/[^\w.-]/g, '').slice(0, 12) || null;
  pool.query('update devices set last_seen = now(), app_version = coalesce($2, app_version) where id = $1', [id, appVersion]).catch(() => {});
  pool.query('insert into activity (day, device_id) values (current_date, $1) on conflict do nothing', [id]).catch(() => {});
  // Paused by the team (dashboard): 403, not 401, so the phone keeps its account instead of making a new one.
  if (d.blocked) throw httpError(403, 'This account is paused. Please contact Dreaming support.');
  return d;
}

const planOf = (d) => (d && d.plan === 'plus' && (!d.plus_until || new Date(d.plus_until) > new Date()) ? 'plus' : 'free');

async function usageOf(deviceId) {
  const { rows: [u] } = await pool.query('select images, analyses, videos from usage where device_id = $1 and period = $2', [deviceId, period()]);
  return { images: u?.images || 0, analyses: u?.analyses || 0, videos: u?.videos || 0 };
}

async function addUsage(deviceId, field, amount = 1) {
  await pool.query(
    `insert into usage (device_id, period, ${field}) values ($1, $2, $3)
     on conflict (device_id, period) do update set ${field} = usage.${field} + $3`,
    [deviceId, period(), amount],
  );
}

/** What the app needs to show plan state, counters and locks. */
async function accountView(d) {
  const plan = planOf(d);
  const p = PLANS.plans[plan];
  const used = await usageOf(d.id);
  return {
    deviceId: d.id,
    plan,
    planLabel: p.label,
    plusUntil: plan === 'plus' ? d.plus_until : null,
    features: p.features,
    limits: p.limits,
    used,
    remaining: {
      images: Math.max(0, p.limits.images - used.images),
      analyses: Math.max(0, p.limits.analyses - used.analyses),
      videos: Math.max(0, (p.limits.videos || 0) - used.videos),
    },
    period: period(),
  };
}

/** Refuses with 402 + a reason the app can show in its paywall. */
/** need: how much of the allowance this use takes (video credits for videos, 1 otherwise). */
async function checkLimit(d, field, need = 1) {
  const view = await accountView(d);
  if (view.remaining[field] >= need) return view;
  if (field === 'videos' && view.remaining.videos > 0) {
    throw Object.assign(httpError(402, `This video needs ${need} credits and you have ${view.remaining.videos} left this month. Choose a shorter length or Standard quality.`),
      { limit: { field, plan: view.plan, need, left: view.remaining.videos } });
  }
  const word = { images: ['AI image', 'image'], analyses: ['interpretations', 'interpretation'], videos: ['AI video', 'video'] }[field];
  const message = view.plan === 'free'
    ? (view.limits[field] ? `You've used your free ${word[0]} for this month.` : 'AI dream videos come with Dreaming Plus.')
    : `You've reached this month's ${word[1]} limit.`;
  throw Object.assign(httpError(402, message), { limit: { field, plan: view.plan } });
}

async function dailyCount(table) {
  const { rows: [r] } = await pool.query(`select count(*)::int as n from ${table} where created_at > now() - interval '1 day'`);
  return r.n;
}

// Image generation runs in the background; the phone polls GET /images/:id.
async function runImage(id, prompt, deviceId) {
  try {
    const out = await generateImage({ id, prompt, dir: IMAGE_DIR, cfg: PLANS.images, env: process.env });
    await pool.query(
      `update images set status = 'done', file = $2, provider = $3, model = $4, units = $5, finished_at = now() where id = $1`,
      [id, out.file, out.provider, out.model, out.units],
    );
  } catch (err) {
    console.error('image failed', id, err.message);
    logError('image', `${id}: ${err.message}`);
    await pool.query(`update images set status = 'failed', error = $2, finished_at = now() where id = $1`, [id, err.message.slice(0, 500)]);
    // A failed image does not count against the month's allowance.
    await pool.query('update usage set images = greatest(images - 1, 0) where device_id = $1 and period = $2', [deviceId, period()]);
  }
}

// Video generation runs in the background too (5–15 minutes); the phone polls GET /videos/:id.
async function runVideo(id, { prompt, textPrompt, imagePath, seconds, quality, credits, scenes }, deviceId) {
  try {
    const cfg = PLANS.videos || {};
    const out = scenes
      ? await generateFilm({
        id, scenes, imagePath, quality, dir: VIDEO_DIR, cfg, env: process.env,
        onProgress: (done) => pool.query('update videos set scenes_done = $2 where id = $1', [id, done]).catch(() => {}),
      })
      : await generateVideo({ id, prompt, textPrompt, imagePath, seconds, quality, dir: VIDEO_DIR, cfg, env: process.env });
    // image_id stays only when the picture really was the first frame.
    await pool.query(
      `update videos set status = 'done', file = $2, provider = $3, model = $4, units = $5, bytes = $6,
         image_id = case when $7 then image_id else null end, finished_at = now() where id = $1`,
      [id, out.file, out.provider, out.model, out.units, out.bytes, out.fromImage],
    );
  } catch (err) {
    console.error('video failed', id, err.message);
    logError('video', `${id}: ${err.message}`);
    await pool.query(`update videos set status = 'failed', error = $2, finished_at = now() where id = $1`, [id, err.message.slice(0, 500)]);
    // A failed video does not count against the month's allowance: its credits come back.
    await pool.query('update usage set videos = greatest(videos - $3, 0) where device_id = $1 and period = $2', [deviceId, period(), credits]);
  }
}

/** Sends a file with HTTP Range support (iPhones only play video that can be fetched in ranges). */
function sendFile(req, res, path, type, cors) {
  const size = statSync(path).size;
  const base = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, max-age=31536000, immutable', ...cors };
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || ''));
  if (m && (m[1] || m[2])) {
    const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
    const end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
    if (start >= size || start > end) {
      res.writeHead(416, { 'Content-Range': `bytes */${size}`, ...cors });
      res.end();
      return;
    }
    res.writeHead(206, { ...base, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 });
    if (req.method === 'HEAD') { res.end(); return; }
    createReadStream(path, { start, end }).pipe(res);
    return;
  }
  res.writeHead(200, { ...base, 'Content-Length': size });
  if (req.method === 'HEAD') { res.end(); return; }
  createReadStream(path).pipe(res);
}

// ---- Routes ----

async function handle(req, res) {
  const cors = corsHeaders(req);
  if (req.method === 'OPTIONS') {
    res.writeHead(204, cors);
    res.end();
    return;
  }

  const send = (status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...cors });
    res.end(JSON.stringify(body));
  };
  const url = new URL(req.url, 'http://localhost');
  const parts = url.pathname.split('/').filter(Boolean);
  const ip = clientIp(req);

  if (parts[0] === 'dashboard') return dashboard.handle(req, res, url, parts, ip);

  if (req.method === 'GET' && url.pathname === '/health') {
    return send(200, { ok: true, service: 'dreaming', version: VERSION });
  }

  // Plans and prices for the subscriptions page (public).
  if (req.method === 'GET' && url.pathname === '/plans') {
    return send(200, { plans: PLANS.plans, prices: PLANS.prices, videos: publicVideoOptions(PLANS.videos), paymentsEnabled: Boolean(process.env.PAYMENTS_ENABLED) });
  }

  // The library's word list for the phone's Dream Reader (names and matching words only, no meanings).
  if (req.method === 'GET' && url.pathname === '/library/index') {
    if (limited(`library-index:${ip}`, 60, 3600000)) throw httpError(429, 'Too many requests. Please wait a while.');
    if (!librarySize()) throw httpError(503, 'The library is not available right now.');
    return send(200, libraryIndex());
  }

  // General meaning of one symbol from the library (public, no account needed): ?name=Ocean
  if (req.method === 'GET' && url.pathname === '/library/symbol') {
    if (limited(`library:${ip}`, 600, 3600000)) throw httpError(429, 'Too many requests. Please wait a while.');
    const name = String(url.searchParams.get('name') || '').slice(0, 80);
    if (!name.trim()) throw httpError(400, 'Which symbol?');
    if (!librarySize()) throw httpError(503, 'The library is not available right now.');
    const e = findEntry(name);
    pool.query(
      `insert into library_hits (day, name, found, hits) values (current_date, $1, $2, 1)
       on conflict (day, name) do update set hits = library_hits.hits + 1, found = excluded.found`,
      [name.trim().toLowerCase().slice(0, 60), Boolean(e)],
    ).catch(() => {});
    if (!e) return send(404, { ok: false, error: 'not_found' });
    return send(200, { ok: true, entry: publicEntry(e) });
  }

  // A phone registers once and keeps its id + secret token.
  if (req.method === 'POST' && url.pathname === '/devices') {
    if (limited(`device:${ip}`, 10, 3600000)) throw httpError(429, 'Too many new devices from this network.');
    const id = `dv${crypto.randomBytes(9).toString('base64url')}`;
    const token = crypto.randomBytes(24).toString('base64url');
    await pool.query('insert into devices (id, token_hash) values ($1, $2)', [id, sha256(token)]);
    const { rows: [d] } = await pool.query('select * from devices where id = $1', [id]);
    return send(201, { token, ...(await accountView(d)) });
  }

  if (req.method === 'GET' && url.pathname === '/me') {
    const d = await deviceOf(req);
    if (!d) throw httpError(401, 'Unknown device');
    return send(200, await accountView(d));
  }

  if (req.method === 'POST' && url.pathname === '/redeem') {
    const d = await deviceOf(req);
    if (!d) throw httpError(401, 'Unknown device');
    if (limited(`redeem:${ip}`, 10, 3600000)) throw httpError(429, 'Too many tries. Please wait a while.');
    const body = await readJson(req, 2048);
    const code = String(body.code || '').trim().toUpperCase().replace(/\s+/g, '');
    const { rows: [c] } = await pool.query('select * from codes where code_hash = $1', [sha256(code)]);
    if (!c || c.uses_left < 1) throw httpError(400, 'That code is not valid.');
    await pool.query('update codes set uses_left = uses_left - 1 where code_hash = $1', [c.code_hash]);
    const base = planOf(d) === 'plus' && d.plus_until ? new Date(d.plus_until) : new Date();
    const until = new Date(base.getTime() + c.days * 86400000);
    await pool.query(`update devices set plan = 'plus', plus_until = $2 where id = $1`, [d.id, until]);
    const { rows: [fresh] } = await pool.query('select * from devices where id = $1', [d.id]);
    return send(200, await accountView(fresh));
  }

  // AI dream images.
  if (parts[0] === 'images') {
    if (req.method === 'POST' && parts.length === 1) {
      const d = await deviceOf(req);
      if (!d) throw httpError(401, 'Unknown device');
      if (limited(`image:${d.id}`, 6, 600000)) throw httpError(429, 'Please wait a moment before creating another image.');
      if ((await dailyCount('images')) >= (PLANS.budget?.imagesPerDay || 300)) throw httpError(503, 'Image creation is paused for today. Please try again tomorrow.');
      await checkLimit(d, 'images');
      const body = await readJson(req, 16 * 1024);
      const dream = cleanDream(body);
      const style = typeof body.style === 'string' ? body.style.slice(0, 30) : 'moonlit';
      const prompt = buildPrompt({ ...dream, kind: body.kind === 'nightmare' ? 'nightmare' : 'dream', style, look: PLANS.images?.look || 'photo' });
      const id = `im${crypto.randomBytes(15).toString('base64url')}`;
      await pool.query('insert into images (id, device_id, style, prompt) values ($1, $2, $3, $4)', [id, d.id, style, prompt]);
      await addUsage(d.id, 'images');
      runImage(id, prompt, d.id); // background
      return send(202, { id, status: 'pending', account: await accountView(d) });
    }
    // GET /images/<id>            → status for the owner (device headers)
    // GET /images/<id>.<ext>      → the picture itself (the long random id is the access key)
    const m = /^(im[\w-]{16,30})(\.(jpg|png|webp))?$/.exec(parts[1] || '');
    if (req.method === 'GET' && m && parts.length === 2) {
      const { rows: [im] } = await pool.query('select * from images where id = $1', [m[1]]);
      if (!im) throw httpError(404, 'Not found');
      if (m[2]) {
        if (im.status !== 'done' || !im.file || !existsSync(join(IMAGE_DIR, im.file))) throw httpError(404, 'Not found');
        let file = im.file;
        if (m[3] === 'jpg' && !file.endsWith('.jpg')) {
          file = `${im.id}.jpg`;
          if (!existsSync(join(IMAGE_DIR, file))) {
            const sharp = (await import('sharp')).default;
            await sharp(join(IMAGE_DIR, im.file)).jpeg({ quality: 88 }).toFile(join(IMAGE_DIR, file));
          }
        }
        const type = file.endsWith('.png') ? 'image/png' : file.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
        res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'private, max-age=31536000, immutable', ...cors });
        createReadStream(join(IMAGE_DIR, file)).pipe(res);
        return undefined;
      }
      const d = await deviceOf(req);
      if (!d || d.id !== im.device_id) throw httpError(404, 'Not found');
      return send(200, {
        id: im.id,
        status: im.status,
        url: im.status === 'done' ? `${im.id}.${im.file.split('.').pop()}` : null,
        style: im.style,
        error: im.status === 'failed' ? 'The image could not be created. Your allowance was not used up.' : null,
      });
    }
    throw httpError(404, 'Not found');
  }

  // AI dream videos (Plus). The dream's AI image, when it has one, becomes the first frame.
  if (parts[0] === 'videos') {
    if (req.method === 'POST' && parts.length === 1) {
      const d = await deviceOf(req);
      if (!d) throw httpError(401, 'Unknown device');
      if ((await dailyCount('videos')) >= (PLANS.budget?.videosPerDay || 50)) throw httpError(503, 'Video creation is paused for today. Please try again tomorrow.');
      const body = await readJson(req, 16 * 1024);
      const dream = cleanDream(body);
      const style = typeof body.style === 'string' ? body.style.slice(0, 30) : 'moonlit';
      // Length and quality the user picked. A longer dream unlocks longer videos (checked here too, not just in the app).
      const vcfg = PLANS.videos || {};
      const words = wordCount(dream.text);
      const seconds = Number(body.seconds) || Math.min(5, maxSeconds(vcfg, words));
      if (!isLength(vcfg, seconds)) throw httpError(400, 'That video length is not available.');
      if (seconds > maxSeconds(vcfg, words)) throw httpError(400, `A ${seconds}-second video needs a longer dream. Write a little more first.`);
      const quality = typeof body.quality === 'string' ? body.quality : vcfg.defaultQuality || '720p';
      const credits = videoCost(vcfg, seconds, quality);
      if (!credits) throw httpError(400, 'That video quality is not available.');
      await checkLimit(d, 'videos', credits);
      // Counted only for videos that really start (a refused choice must not lock the user out).
      if (limited(`video:${d.id}`, 3, 600000)) throw httpError(429, 'Please wait a moment before creating another video.');
      let imageId = null;
      let imagePath = null;
      if (body.useImage !== false && typeof body.imageId === 'string' && /^im[\w-]{16,30}$/.test(body.imageId)) {
        const { rows: [im] } = await pool.query('select id, device_id, status, file from images where id = $1', [body.imageId]);
        if (im && im.device_id === d.id && im.status === 'done' && im.file && existsSync(join(IMAGE_DIR, im.file))) {
          imageId = im.id;
          imagePath = join(IMAGE_DIR, im.file);
        }
      }
      const kind = body.kind === 'nightmare' ? 'nightmare' : 'dream';
      // A film: one clip per scene of the dream, in order; only the first may start from the AI photo.
      const clips = clipsFor(vcfg, seconds);
      const scenes = clips.length > 1
        ? splitScenes(dream.text, clips.length).map((text, i) => {
          const part = { index: i + 1, total: clips.length };
          const scene = { ...dream, text, kind, style, seconds: clips[i], part };
          const sceneText = buildVideoPrompt(scene);
          return { seconds: clips[i], textPrompt: sceneText, prompt: i === 0 && imagePath ? buildVideoPrompt({ ...scene, fromImage: true }) : sceneText };
        })
        : null;
      const textPrompt = buildVideoPrompt({ ...dream, kind, style, seconds });
      const prompt = scenes ? scenes.map((s) => s.prompt).join('\n---\n') : imagePath ? buildVideoPrompt({ ...dream, kind, style, seconds, fromImage: true }) : textPrompt;
      const id = `vd${crypto.randomBytes(15).toString('base64url')}`;
      await pool.query(
        'insert into videos (id, device_id, style, image_id, prompt, seconds, quality, credits, scenes) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
        [id, d.id, style, imageId, prompt, seconds, quality, credits, clips.length],
      );
      await addUsage(d.id, 'videos', credits);
      runVideo(id, { prompt, textPrompt, imagePath, seconds, quality, credits, scenes }, d.id); // background
      return send(202, {
        id, status: 'pending', fromImage: Boolean(imageId), seconds, quality, credits, scenes: clips.length,
        minutes: Math.round(estimateMinutes(vcfg, seconds, quality, Boolean(imageId)) * 10) / 10,
        account: await accountView(d),
      });
    }
    // GET /videos/<id>       → status for the owner (device headers)
    // GET /videos/<id>.mp4   → the video itself, with Range support (the long random id is the access key)
    const m = /^(vd[\w-]{16,30})(\.mp4)?$/.exec(parts[1] || '');
    if ((req.method === 'GET' || req.method === 'HEAD') && m && parts.length === 2) {
      const { rows: [v] } = await pool.query('select * from videos where id = $1', [m[1]]);
      if (!v) throw httpError(404, 'Not found');
      if (m[2]) {
        if (v.status !== 'done' || !v.file || !existsSync(join(VIDEO_DIR, v.file))) throw httpError(404, 'Not found');
        sendFile(req, res, join(VIDEO_DIR, v.file), 'video/mp4', cors);
        return undefined;
      }
      const d = await deviceOf(req);
      if (!d || d.id !== v.device_id) throw httpError(404, 'Not found');
      return send(200, {
        id: v.id,
        status: v.status,
        url: v.status === 'done' ? v.file : null,
        style: v.style,
        imageId: v.image_id,
        seconds: v.seconds || null,
        quality: v.quality || null,
        scenes: v.scenes || 1,
        scenesDone: v.scenes_done || 0,
        error: v.status === 'failed' ? 'The video could not be created. Your allowance was not used up.' : null,
      });
    }
    throw httpError(404, 'Not found');
  }

  // Phone-facing: send a dream, read its answer, rate it.
  if (parts[0] === 'interpretations') {
    if (req.method === 'POST' && parts.length === 1) {
      if (limited(`submit:${ip}`, 20, 3600000)) throw httpError(429, 'Too many dreams sent. Please try again later.');
      // Newer app versions identify the device so plan limits apply; older ones are served as before.
      const d = await deviceOf(req);
      if (d) await checkLimit(d, 'analyses');
      if ((await dailyCount('interpretations')) >= (PLANS.budget?.analysesPerDay || 1000)) throw httpError(503, 'Interpretations are paused for today. Please try again tomorrow.');
      const dream = cleanDream(await readJson(req, 32 * 1024));
      const id = newId();
      const token = crypto.randomBytes(24).toString('base64url');
      await pool.query(
        'insert into interpretations (id, token_hash, dream, ip_hash, device_id) values ($1, $2, $3, $4, $5)',
        [id, sha256(token), dream, sha256(IP_SALT + ip), d?.id || null],
      );
      if (d) await addUsage(d.id, 'analyses');
      return send(201, { id, token, status: 'waiting', account: d ? await accountView(d) : null });
    }

    const id = parts[1];
    if (!id || !/^[\w-]{6,40}$/.test(id)) throw httpError(404, 'Not found');
    if (limited(`read:${ip}`, 1500, 3600000)) throw httpError(429, 'Too many requests. Please slow down.');
    const token = String(req.headers['x-dream-token'] || '');
    const { rows: [row] } = await pool.query('select * from interpretations where id = $1', [id]);
    if (!row || !token || !safeEqual(sha256(token), row.token_hash)) throw httpError(404, 'Not found');

    if (req.method === 'GET' && parts.length === 2) return send(200, publicView(row));

    if (req.method === 'POST' && parts[2] === 'feedback' && parts.length === 3) {
      const body = await readJson(req, 8 * 1024);
      if (body.rating !== 1 && body.rating !== -1) throw httpError(400, 'rating must be 1 or -1');
      const note = typeof body.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 2000) : null;
      await pool.query(
        'update interpretations set rating = $2, feedback = $3, feedback_at = now() where id = $1',
        [id, body.rating, note],
      );
      return send(200, { ok: true });
    }
    throw httpError(404, 'Not found');
  }

  // Admin-key API (C++ on the dev PC). Never reachable from the app.
  if (parts[0] === 'admin') {
    const auth = String(req.headers.authorization || '');
    if (!auth.startsWith('Bearer ') || !safeEqual(auth.slice(7), ADMIN_KEY)) {
      if (limited(`admin-fail:${ip}`, 10, 3600000)) throw httpError(429, 'Too many failed attempts');
      throw httpError(401, 'Unauthorized');
    }

    if (req.method === 'GET' && parts[1] === 'queue') {
      const limit = Math.min(Number(url.searchParams.get('limit')) || 20, 100);
      const { rows } = await pool.query(
        `select id, status, dream, created_at, claimed_at from interpretations
          where status = 'waiting' or (status = 'working' and claimed_at < now() - interval '15 minutes')
          order by created_at limit $1`,
        [limit],
      );
      return send(200, { items: rows });
    }

    if (req.method === 'GET' && parts[1] === 'recent') {
      const limit = Math.min(Number(url.searchParams.get('limit')) || 50, 200);
      const { rows } = await pool.query(
        `select id, status, dream, result, error, created_at, answered_at, rating, feedback, feedback_at
           from interpretations order by created_at desc limit $1`,
        [limit],
      );
      return send(200, { items: rows });
    }

    // Redeem codes for testers and gifts: POST /admin/codes { days, uses, note } → { code } (shown once).
    if (req.method === 'POST' && parts[1] === 'codes') {
      const body = await readJson(req, 4096);
      const days = Math.min(Math.max(Number(body.days) || 30, 1), 3650);
      const uses = Math.min(Math.max(Number(body.uses) || 1, 1), 10000);
      const raw = crypto.randomBytes(6).toString('base64url').toUpperCase().replace(/[^A-Z0-9]/g, 'X');
      const code = `DREAM-${raw.slice(0, 4)}-${raw.slice(4, 8)}`;
      await pool.query('insert into codes (code_hash, days, uses_left, uses_total, note, hint, created_by) values ($1, $2, $3, $3, $4, $5, $6)',
        [sha256(code), days, uses, String(body.note || '').slice(0, 200), code.slice(-4), 'C++']);
      return send(201, { code, days, uses });
    }

    // A one-time link for a new dashboard member (used to make the Owner's first login): { email, name, role }.
    if (req.method === 'POST' && parts[1] === 'staff-invite') {
      const body = await readJson(req, 4096);
      const out = await dashboard.createInvite({ email: body.email, name: body.name, role: String(body.role || 'owner'), createdBy: 'C++' });
      await pool.query('insert into audit_log (staff_email, action, target, details) values ($1, $2, $3, $4)', ['C++', 'invited', out.email, { role: out.role }]);
      return send(201, out);
    }

    if (req.method === 'GET' && parts[1] === 'accounts') {
      const { rows } = await pool.query(
        `select (select count(*)::int from devices) as devices,
                (select count(*)::int from devices where plan = 'plus' and (plus_until is null or plus_until > now())) as plus,
                (select count(*)::int from images where created_at > now() - interval '1 day') as images_24h,
                (select count(*)::int from images where status = 'failed' and created_at > now() - interval '1 day') as images_failed_24h,
                (select coalesce(sum(units), 0)::float from images where status = 'done' and created_at > date_trunc('month', now())) as image_units_month,
                (select count(*)::int from videos where created_at > now() - interval '1 day') as videos_24h,
                (select count(*)::int from videos where status = 'failed' and created_at > now() - interval '1 day') as videos_failed_24h,
                (select coalesce(sum(units), 0)::float from videos where status = 'done' and created_at > date_trunc('month', now())) as video_units_month`,
      );
      return send(200, rows[0]);
    }

    if (req.method === 'GET' && parts[1] === 'stats') {
      const { rows } = await pool.query(
        `select status, count(*)::int as count, avg(rating)::float as avg_rating
           from interpretations group by status`,
      );
      return send(200, { byStatus: rows });
    }

    if (parts[1] === 'interpretations' && parts[2] && parts.length === 4 && req.method === 'POST') {
      const id = parts[2];
      const action = parts[3];
      let result;
      if (action === 'claim') {
        result = await pool.query(
          `update interpretations set status = 'working', claimed_at = now()
            where id = $1 and status in ('waiting', 'working') returning id`, [id]);
      } else if (action === 'release') {
        result = await pool.query(
          `update interpretations set status = 'waiting', claimed_at = null where id = $1 returning id`, [id]);
      } else if (action === 'answer') {
        const body = await readJson(req, 64 * 1024);
        if (!isPlainObject(body.result)) throw httpError(400, 'result must be an object');
        result = await pool.query(
          `update interpretations set status = 'done', result = $2, error = null, answered_at = now()
            where id = $1 returning id`, [id, body.result]);
      } else if (action === 'fail') {
        const body = await readJson(req, 8 * 1024);
        const reason = typeof body.error === 'string' ? body.error.slice(0, 500) : 'failed';
        result = await pool.query(
          `update interpretations set status = 'failed', error = $2, answered_at = now()
            where id = $1 returning id`, [id, reason]);
      } else if (action === 'delete') {
        result = await pool.query('delete from interpretations where id = $1 returning id', [id]);
      } else {
        throw httpError(404, 'Not found');
      }
      if (!result.rowCount) throw httpError(404, 'Not found');
      return send(200, { ok: true, id });
    }
    throw httpError(404, 'Not found');
  }

  throw httpError(404, 'Not found');
}

// ---- Start ----

const dashboard = createDashboard({
  pool, plans: PLANS, imageDir: IMAGE_DIR, videoDir: VIDEO_DIR, librarySize, version: VERSION,
  readJson, limited, errorLog, period,
});

const server = http.createServer((req, res) => {
  handle(req, res).catch((err) => {
    const status = err.status || 500;
    if (status >= 500) { console.error(err); logError(`${req.method} ${String(req.url).split('?')[0]}`, err.message); }
    if (!res.headersSent) {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...corsHeaders(req) });
      res.end(JSON.stringify({ error: status >= 500 ? 'Server error' : err.message, ...(err.limit ? { limit: err.limit } : {}) }));
    }
  });
});

async function cleanup() {
  try {
    await pool.query('delete from interpretations where created_at < now() - make_interval(days => $1)', [KEEP_DAYS]);
  } catch (err) {
    console.error('cleanup failed', err.message);
  }
}

await pool.query(SCHEMA);
await pool.query(DASH_SCHEMA);
await cleanup();
setInterval(cleanup, 24 * 3600000).unref();

server.listen(PORT, '127.0.0.1', () => {
  console.log(`dreaming-api ${VERSION} listening on 127.0.0.1:${PORT}`);
});
