// Dreaming interpretation inbox.
// Phones send a dream and get back an id + secret token; they poll with the token for the answer.
// Claude (from the dev PC, holding ADMIN_KEY) picks up waiting dreams, interprets them and writes
// the answer back. Later the server will call the AI itself; the phone-facing API stays the same.
// Runs behind nginx at https://www.nexflowclub.com/dreaming-api/ (nginx strips that prefix).
import http from 'node:http';
import crypto from 'node:crypto';
import { readFileSync, createReadStream, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { buildPrompt, generateImage } from './images.js';

try { process.loadEnvFile(fileURLToPath(new URL('./.env', import.meta.url))); } catch {}

const PORT = Number(process.env.PORT) || 3020;
const ADMIN_KEY = process.env.ADMIN_KEY || '';
const IP_SALT = process.env.IP_SALT || '';
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
const KEEP_DAYS = Number(process.env.KEEP_DAYS) || 60;
const VERSION = '2';
const HERE = fileURLToPath(new URL('.', import.meta.url));
const IMAGE_DIR = process.env.IMAGE_DIR || join(HERE, 'images');
const PLANS = JSON.parse(readFileSync(join(HERE, 'plans.json'), 'utf8'));

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
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Dream-Token, X-Device-Id, X-Device-Token',
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
  pool.query('update devices set last_seen = now() where id = $1', [id]).catch(() => {});
  return d;
}

const planOf = (d) => (d && d.plan === 'plus' && (!d.plus_until || new Date(d.plus_until) > new Date()) ? 'plus' : 'free');

async function usageOf(deviceId) {
  const { rows: [u] } = await pool.query('select images, analyses from usage where device_id = $1 and period = $2', [deviceId, period()]);
  return { images: u?.images || 0, analyses: u?.analyses || 0 };
}

async function addUsage(deviceId, field) {
  await pool.query(
    `insert into usage (device_id, period, ${field}) values ($1, $2, 1)
     on conflict (device_id, period) do update set ${field} = usage.${field} + 1`,
    [deviceId, period()],
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
    remaining: { images: Math.max(0, p.limits.images - used.images), analyses: Math.max(0, p.limits.analyses - used.analyses) },
    period: period(),
  };
}

/** Refuses with 402 + a reason the app can show in its paywall. */
async function checkLimit(d, field) {
  const view = await accountView(d);
  if (view.remaining[field] > 0) return view;
  throw Object.assign(httpError(402, view.plan === 'free'
    ? `You've used your free ${field === 'images' ? 'AI image' : 'interpretations'} for this month.`
    : `You've reached this month's ${field === 'images' ? 'image' : 'interpretation'} limit.`), { limit: { field, plan: view.plan } });
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
    await pool.query(`update images set status = 'failed', error = $2, finished_at = now() where id = $1`, [id, err.message.slice(0, 500)]);
    // A failed image does not count against the month's allowance.
    await pool.query('update usage set images = greatest(images - 1, 0) where device_id = $1 and period = $2', [deviceId, period()]);
  }
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

  if (req.method === 'GET' && url.pathname === '/health') {
    return send(200, { ok: true, service: 'dreaming', version: VERSION });
  }

  // Plans and prices for the subscriptions page (public).
  if (req.method === 'GET' && url.pathname === '/plans') {
    return send(200, { plans: PLANS.plans, prices: PLANS.prices, paymentsEnabled: Boolean(process.env.PAYMENTS_ENABLED) });
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
        const type = im.file.endsWith('.png') ? 'image/png' : im.file.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
        res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'private, max-age=31536000, immutable', ...cors });
        createReadStream(join(IMAGE_DIR, im.file)).pipe(res);
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

  // Claude-facing: needs the admin key. Never reachable from the app.
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
      await pool.query('insert into codes (code_hash, days, uses_left, note) values ($1, $2, $3, $4)', [sha256(code), days, uses, String(body.note || '').slice(0, 200)]);
      return send(201, { code, days, uses });
    }

    if (req.method === 'GET' && parts[1] === 'accounts') {
      const { rows } = await pool.query(
        `select (select count(*)::int from devices) as devices,
                (select count(*)::int from devices where plan = 'plus' and (plus_until is null or plus_until > now())) as plus,
                (select count(*)::int from images where created_at > now() - interval '1 day') as images_24h,
                (select count(*)::int from images where status = 'failed' and created_at > now() - interval '1 day') as images_failed_24h,
                (select coalesce(sum(units), 0)::float from images where status = 'done' and created_at > date_trunc('month', now())) as image_units_month`,
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

const server = http.createServer((req, res) => {
  handle(req, res).catch((err) => {
    const status = err.status || 500;
    if (status >= 500) console.error(err);
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
await cleanup();
setInterval(cleanup, 24 * 3600000).unref();

server.listen(PORT, '127.0.0.1', () => {
  console.log(`dreaming-api ${VERSION} listening on 127.0.0.1:${PORT}`);
});
