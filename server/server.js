// Dreaming interpretation inbox.
// Phones send a dream and get back an id + secret token; they poll with the token for the answer.
// Claude (from the dev PC, holding ADMIN_KEY) picks up waiting dreams, interprets them and writes
// the answer back. Later the server will call the AI itself; the phone-facing API stays the same.
// Runs behind nginx at https://www.nexflowclub.com/dreaming-api/ (nginx strips that prefix).
import http from 'node:http';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

try { process.loadEnvFile(fileURLToPath(new URL('./.env', import.meta.url))); } catch {}

const PORT = Number(process.env.PORT) || 3020;
const ADMIN_KEY = process.env.ADMIN_KEY || '';
const IP_SALT = process.env.IP_SALT || '';
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
const KEEP_DAYS = Number(process.env.KEEP_DAYS) || 60;
const VERSION = '1';

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
    'Access-Control-Allow-Headers': 'Content-Type, X-Dream-Token',
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

  // Phone-facing: send a dream, read its answer, rate it.
  if (parts[0] === 'interpretations') {
    if (req.method === 'POST' && parts.length === 1) {
      if (limited(`submit:${ip}`, 20, 3600000)) throw httpError(429, 'Too many dreams sent. Please try again later.');
      const dream = cleanDream(await readJson(req, 32 * 1024));
      const id = newId();
      const token = crypto.randomBytes(24).toString('base64url');
      await pool.query(
        'insert into interpretations (id, token_hash, dream, ip_hash) values ($1, $2, $3, $4)',
        [id, sha256(token), dream, sha256(IP_SALT + ip)],
      );
      return send(201, { id, token, status: 'waiting' });
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
      res.end(JSON.stringify({ error: status >= 500 ? 'Server error' : err.message }));
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
