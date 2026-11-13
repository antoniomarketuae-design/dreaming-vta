// The managers' dashboard: a private web page served by this API at /dashboard/ (public URL
// https://nexflowclub.com/dreaming-api/dashboard/), with its own JSON API at /dashboard/api/*.
// Each manager signs in with their own email + password (invited by the Owner; nobody else ever sees the password).
// Roles: owner (everything, including users' private content and the team), manager (can change accounts and codes),
// viewer (looks only). Every change is written to the activity log with who did it.
// Dreams in users' journals never reach the server, so they can never appear here.
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { readFileSync, readdirSync, statSync, statfsSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const scrypt = promisify(crypto.scrypt);
const HERE = fileURLToPath(new URL('.', import.meta.url));
const STATIC_DIR = join(HERE, 'dashboard');
const STATIC = {
  'index.html': 'text/html; charset=utf-8',
  'dash.js': 'text/javascript; charset=utf-8',
  'dash.css': 'text/css; charset=utf-8',
  'icon.svg': 'image/svg+xml',
};
const COOKIE = 'dd_sess';
const SESSION_DAYS = 7;
const IDLE_HOURS = 24;
const INVITE_DAYS = 3;
const ROLES = ['owner', 'manager', 'viewer'];
const RANK = { viewer: 1, manager: 2, owner: 3 };
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export const DASH_SCHEMA = `
  create table if not exists staff (
    id          text primary key,
    email       text not null unique,
    name        text not null default '',
    role        text not null check (role in ('owner', 'manager', 'viewer')),
    pass_hash   text not null,
    disabled    boolean not null default false,
    invited_by  text,
    created_at  timestamptz not null default now(),
    last_login  timestamptz
  );
  create table if not exists staff_sessions (
    token_hash  text primary key,
    staff_id    text not null references staff(id) on delete cascade,
    created_at  timestamptz not null default now(),
    last_used   timestamptz not null default now(),
    expires_at  timestamptz not null,
    agent       text
  );
  create table if not exists staff_invites (
    token_hash  text primary key,
    email       text not null,
    name        text not null default '',
    role        text not null check (role in ('owner', 'manager', 'viewer')),
    created_by  text,
    created_at  timestamptz not null default now(),
    expires_at  timestamptz not null,
    used_at     timestamptz
  );
  create table if not exists audit_log (
    id          bigserial primary key,
    staff_id    text,
    staff_email text,
    action      text not null,
    target      text,
    details     jsonb,
    at          timestamptz not null default now()
  );
  create index if not exists audit_log_at on audit_log (at desc);
  -- Which symbols people look up (no device, no person: a daily count per name), and which ones the library lacks.
  create table if not exists library_hits (
    day   date not null,
    name  text not null,
    found boolean not null,
    hits  int not null default 0,
    primary key (day, name)
  );
  -- Active devices per day (for the daily-active chart).
  create table if not exists activity (
    day       date not null,
    device_id text not null,
    primary key (day, device_id)
  );
  alter table devices add column if not exists blocked boolean not null default false;
  alter table devices add column if not exists app_version text;
  alter table codes add column if not exists hint text;
  alter table codes add column if not exists uses_total int;
  alter table codes add column if not exists created_by text;
  alter table codes add column if not exists disabled_at timestamptz;
`;

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const httpError = (status, message) => Object.assign(new Error(message), { status });
const cleanEmail = (v) => String(v || '').trim().toLowerCase().slice(0, 200);
const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const clamp = (v, lo, hi, dflt) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : dflt;
};

async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const h = await scrypt(pw, salt, 64, SCRYPT);
  return `scrypt$${salt.toString('base64')}$${h.toString('base64')}`;
}
async function checkPassword(pw, stored) {
  const [kind, salt, hash] = String(stored || '').split('$');
  if (kind !== 'scrypt' || !salt || !hash) return false;
  const h = await scrypt(pw, Buffer.from(salt, 'base64'), 64, SCRYPT);
  const want = Buffer.from(hash, 'base64');
  return want.length === h.length && crypto.timingSafeEqual(h, want);
}
const DUMMY_HASH = 'scrypt$AAAAAAAAAAAAAAAAAAAAAA==$' + Buffer.alloc(64).toString('base64');

function cookieOf(req, name) {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return '';
}

/**
 * ctx: { pool, plans, imageDir, videoDir, librarySize, version, readJson, limited, errorLog, period }
 * Returns { handle(req, res, url, parts, ip), createInvite(opts) }.
 */
export function createDashboard(ctx) {
  const { pool, plans, imageDir, videoDir, librarySize, version, readJson, limited, errorLog, period } = ctx;
  const cookiePath = process.env.DASH_COOKIE_PATH || '/dreaming-api/dashboard';
  const publicUrl = (process.env.DASH_PUBLIC_URL || 'https://nexflowclub.com/dreaming-api/dashboard/').replace(/\/?$/, '/');
  const secureCookie = process.env.DASH_INSECURE_COOKIE ? '' : '; Secure';

  const audit = (who, action, target, details) => pool.query(
    'insert into audit_log (staff_id, staff_email, action, target, details) values ($1, $2, $3, $4, $5)',
    [who?.id || null, who?.email || 'system', action, target == null ? null : String(target).slice(0, 200), details || null],
  ).catch((err) => console.error('audit failed', err.message));

  /** A one-time link that lets a new team member choose their own password. */
  async function createInvite({ email, name, role, createdBy }) {
    const e = cleanEmail(email);
    if (!validEmail(e)) throw httpError(400, 'Please enter a valid email address.');
    if (!ROLES.includes(role)) throw httpError(400, 'Unknown role.');
    const { rows: [taken] } = await pool.query('select 1 from staff where email = $1', [e]);
    if (taken) throw httpError(409, 'That email already has a login.');
    const token = crypto.randomBytes(24).toString('base64url');
    await pool.query(
      `insert into staff_invites (token_hash, email, name, role, created_by, expires_at)
       values ($1, $2, $3, $4, $5, now() + make_interval(days => $6))`,
      [sha256(token), e, String(name || '').trim().slice(0, 80), role, createdBy || null, INVITE_DAYS],
    );
    return { link: `${publicUrl}#invite=${token}`, email: e, role, expiresInDays: INVITE_DAYS };
  }

  async function startSession(res, staff, req) {
    const token = crypto.randomBytes(32).toString('base64url');
    await pool.query(
      `insert into staff_sessions (token_hash, staff_id, expires_at, agent)
       values ($1, $2, now() + make_interval(days => $3), $4)`,
      [sha256(token), staff.id, SESSION_DAYS, String(req.headers['user-agent'] || '').slice(0, 200)],
    );
    await pool.query('update staff set last_login = now() where id = $1', [staff.id]);
    res.setHeader('Set-Cookie', `${COOKIE}=${token}; Path=${cookiePath}; HttpOnly${secureCookie}; SameSite=Strict; Max-Age=${SESSION_DAYS * 86400}`);
  }

  async function staffOf(req) {
    const token = cookieOf(req, COOKIE);
    if (!token || token.length < 30) return null;
    const { rows: [s] } = await pool.query(
      `select t.id, t.email, t.name, t.role, t.disabled, s.token_hash, s.last_used, s.expires_at
         from staff_sessions s join staff t on t.id = s.staff_id where s.token_hash = $1`, [sha256(token)]);
    if (!s || s.disabled) return null;
    const now = Date.now();
    if (new Date(s.expires_at).getTime() < now || now - new Date(s.last_used).getTime() > IDLE_HOURS * 3600000) {
      pool.query('delete from staff_sessions where token_hash = $1', [s.token_hash]).catch(() => {});
      return null;
    }
    if (now - new Date(s.last_used).getTime() > 5 * 60000) {
      pool.query('update staff_sessions set last_used = now() where token_hash = $1', [s.token_hash]).catch(() => {});
    }
    return { id: s.id, email: s.email, name: s.name, role: s.role, tokenHash: s.token_hash };
  }

  const need = (who, role) => {
    if (!who) throw httpError(401, 'Please sign in.');
    if (RANK[who.role] < RANK[role]) throw httpError(403, 'Your role cannot do this.');
  };
  const isOwner = (who) => who?.role === 'owner';

  // ---- Static page ----
  function sendStatic(res, name) {
    const type = STATIC[name];
    if (!type) throw httpError(404, 'Not found');
    const body = readFileSync(join(STATIC_DIR, name));
    res.writeHead(200, {
      'Content-Type': type,
      'Cache-Control': name === 'index.html' ? 'no-store' : 'no-cache',
      'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
      'X-Frame-Options': 'DENY',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'X-Robots-Tag': 'noindex, nofollow',
    });
    res.end(body);
  }

  // ---- Small helpers for the data pages ----
  const contentOf = (who, row, fields) => {
    if (isOwner(who)) return row;
    const out = { ...row };
    for (const f of fields) delete out[f];
    return out;
  };

  let liveVersion = { at: 0, value: null };
  async function appLiveVersion() {
    if (Date.now() - liveVersion.at < 5 * 60000) return liveVersion.value;
    try {
      const r = await fetch('https://antoniomarketuae-design.github.io/dreaming-vta/version.json', { signal: AbortSignal.timeout(3000) });
      const v = await r.json();
      liveVersion = { at: Date.now(), value: { version: v.version, updated: v.updated, note: v.notes?.[0]?.text || '' } };
    } catch {
      liveVersion = { at: Date.now(), value: null };
    }
    return liveVersion.value;
  }

  function dirSize(dir) {
    if (!existsSync(dir)) return { files: 0, bytes: 0 };
    let files = 0;
    let bytes = 0;
    for (const name of readdirSync(dir)) {
      try {
        const st = statSync(join(dir, name));
        if (st.isFile()) { files += 1; bytes += st.size; }
      } catch {}
      if (files > 50000) break;
    }
    return { files, bytes };
  }

  // ---- API ----
  async function api(req, res, url, rest, ip, send) {
    const route = rest.join('/');
    const method = req.method;

    // Changes need our own page: same origin and a custom header (a form on another site can send neither).
    if (method !== 'GET') {
      const origin = req.headers.origin;
      const proto = String(req.headers['x-forwarded-proto'] || 'http').split(',')[0].trim();
      if (req.headers['x-dash'] !== '1' || (origin && origin !== `${proto}://${req.headers.host}`)) throw httpError(403, 'Forbidden');
    }

    // -- Signing in --
    if (method === 'POST' && route === 'login') {
      const body = await readJson(req, 4096);
      // Email or name (names are unique, any case, and never contain "@").
      const ident = String(body.email || '').trim().slice(0, 200);
      const pw = String(body.password || '');
      if (limited(`dash-login:${ip}`, 20, 900000) || limited(`dash-login:${ident.toLowerCase()}`, 10, 900000)) {
        throw httpError(429, 'Too many tries. Please wait 15 minutes.');
      }
      let s;
      if (ident.includes('@')) {
        ({ rows: [s] } = await pool.query('select * from staff where email = $1', [cleanEmail(ident)]));
      } else {
        const { rows } = await pool.query('select * from staff where lower(name) = lower($1) or lower(email) = lower($1)', [ident]);
        if (rows.length === 1) [s] = rows;
      }
      const ok = await checkPassword(pw, s ? s.pass_hash : DUMMY_HASH);
      if (!s || !ok || s.disabled) {
        await audit({ email: ident || '(empty)' }, 'login-failed', null, null);
        throw httpError(401, 'That name or email and password do not match.');
      }
      await startSession(res, s, req);
      await audit(s, 'login', null, null);
      return send(200, { me: { email: s.email, name: s.name, role: s.role } });
    }

    if (method === 'POST' && route === 'accept') {
      const body = await readJson(req, 4096);
      if (limited(`dash-accept:${ip}`, 10, 3600000)) throw httpError(429, 'Too many tries. Please wait a while.');
      const token = String(body.token || '');
      const pw = String(body.password || '');
      const name = String(body.name || '').trim().slice(0, 80);
      if (name.includes('@')) throw httpError(400, 'Your name can\'t contain @ (it is also what you sign in with).');
      if (pw.length < 10) throw httpError(400, 'Choose a password of at least 10 characters.');
      const { rows: [inv] } = await pool.query(
        'select * from staff_invites where token_hash = $1 and used_at is null and expires_at > now()', [sha256(token)]);
      if (!inv) throw httpError(400, 'This invitation link is not valid any more. Ask the Owner for a new one.');
      const { rows: [taken] } = await pool.query('select 1 from staff where email = $1', [inv.email]);
      if (taken) throw httpError(409, 'That email already has a login.');
      const finalName = name || inv.name || inv.email.split('@')[0];
      const { rows: [dup] } = await pool.query('select 1 from staff where lower(name) = lower($1) or lower(email) = lower($1)', [finalName]);
      if (dup) throw httpError(409, 'Another team member already uses that name. Please choose a different one.');
      const id = `st${crypto.randomBytes(9).toString('base64url')}`;
      await pool.query(
        'insert into staff (id, email, name, role, pass_hash, invited_by) values ($1, $2, $3, $4, $5, $6)',
        [id, inv.email, finalName, inv.role, await hashPassword(pw), inv.created_by],
      );
      await pool.query('update staff_invites set used_at = now() where token_hash = $1', [inv.token_hash]);
      const { rows: [s] } = await pool.query('select * from staff where id = $1', [id]);
      await startSession(res, s, req);
      await audit(s, 'joined', s.email, { role: s.role });
      return send(201, { me: { email: s.email, name: s.name, role: s.role } });
    }

    if (method === 'GET' && route === 'invite-info') {
      const token = String(url.searchParams.get('token') || '');
      const { rows: [inv] } = await pool.query(
        'select email, name, role from staff_invites where token_hash = $1 and used_at is null and expires_at > now()', [sha256(token)]);
      if (!inv) throw httpError(404, 'This invitation link is not valid any more. Ask the Owner for a new one.');
      return send(200, inv);
    }

    const who = await staffOf(req);

    if (method === 'POST' && route === 'logout') {
      if (who) {
        await pool.query('delete from staff_sessions where token_hash = $1', [who.tokenHash]);
        await audit(who, 'logout', null, null);
      }
      res.setHeader('Set-Cookie', `${COOKIE}=; Path=${cookiePath}; HttpOnly${secureCookie}; SameSite=Strict; Max-Age=0`);
      return send(200, { ok: true });
    }

    need(who, 'viewer');

    if (method === 'GET' && route === 'me') return send(200, { me: { email: who.email, name: who.name, role: who.role } });

    if (method === 'POST' && route === 'password') {
      const body = await readJson(req, 4096);
      const { rows: [s] } = await pool.query('select pass_hash from staff where id = $1', [who.id]);
      if (!(await checkPassword(String(body.current || ''), s.pass_hash))) throw httpError(400, 'Your current password is not right.');
      const next = String(body.next || '');
      if (next.length < 10) throw httpError(400, 'Choose a password of at least 10 characters.');
      await pool.query('update staff set pass_hash = $2 where id = $1', [who.id, await hashPassword(next)]);
      await pool.query('delete from staff_sessions where staff_id = $1 and token_hash <> $2', [who.id, who.tokenHash]);
      await audit(who, 'password-changed', who.email, null);
      return send(200, { ok: true });
    }

    // -- Overview --
    if (method === 'GET' && route === 'overview') {
      const { rows: [n] } = await pool.query(`
        select
          (select count(*)::int from devices) as users,
          (select count(*)::int from devices where created_at > now() - interval '1 day') as new_1d,
          (select count(*)::int from devices where created_at > now() - interval '7 days') as new_7d,
          (select count(*)::int from devices where created_at > now() - interval '30 days') as new_30d,
          (select count(*)::int from devices where last_seen > now() - interval '1 day') as active_1d,
          (select count(*)::int from devices where last_seen > now() - interval '7 days') as active_7d,
          (select count(*)::int from devices where last_seen > now() - interval '30 days') as active_30d,
          (select count(*)::int from devices where plan = 'plus' and (plus_until is null or plus_until > now())) as plus,
          (select count(*)::int from devices where blocked) as blocked,
          (select count(*)::int from images where created_at > now() - interval '1 day') as images_1d,
          (select count(*)::int from images where status = 'failed' and created_at > now() - interval '1 day') as images_failed_1d,
          (select count(*)::int from images where status = 'done' and created_at > date_trunc('month', now())) as images_month,
          (select coalesce(sum(units), 0)::float from images where status = 'done' and created_at > date_trunc('month', now())) as image_units_month,
          (select count(*)::int from videos where created_at > now() - interval '1 day') as videos_1d,
          (select count(*)::int from videos where status = 'failed' and created_at > now() - interval '1 day') as videos_failed_1d,
          (select count(*)::int from videos where status = 'done' and created_at > date_trunc('month', now())) as videos_month,
          (select coalesce(sum(units), 0)::float from videos where status = 'done' and created_at > date_trunc('month', now())) as video_units_month,
          (select count(*)::int from videos where status = 'pending') as videos_running,
          (select count(*)::int from images where status = 'pending') as images_running,
          (select count(*)::int from interpretations where status = 'waiting') as interp_waiting,
          (select count(*)::int from interpretations where status = 'working') as interp_working,
          (select count(*)::int from interpretations where status = 'done' and answered_at > date_trunc('month', now())) as interp_done_month,
          (select count(*)::int from interpretations where rating is not null) as interp_rated,
          (select avg(rating)::float from interpretations where rating is not null) as interp_rating,
          (select count(*)::int from codes where uses_left > 0 and disabled_at is null) as codes_active`);
      const { rows: series } = await pool.query(`
        with days as (select generate_series(current_date - 29, current_date, interval '1 day')::date as day)
        select d.day,
          (select count(*)::int from devices where created_at::date = d.day) as new_users,
          (select count(*)::int from activity where day = d.day) as active,
          (select count(*)::int from images where created_at::date = d.day) as images,
          (select count(*)::int from videos where created_at::date = d.day) as videos,
          (select count(*)::int from interpretations where created_at::date = d.day) as interpretations
        from days d order by d.day`);
      return send(200, {
        numbers: n,
        series,
        budget: {
          imagesPerDay: plans.budget?.imagesPerDay || 300,
          videosPerDay: plans.budget?.videosPerDay || 50,
        },
        app: await appLiveVersion(),
      });
    }

    // -- Users (anonymous phone accounts) --
    if (method === 'GET' && route === 'users') {
      const q = String(url.searchParams.get('q') || '').trim().slice(0, 40);
      const plan = String(url.searchParams.get('plan') || '');
      const sorts = { seen: 'd.last_seen', joined: 'd.created_at', images: 'images_total', videos: 'videos_total', analyses: 'analyses_total' };
      const sort = sorts[url.searchParams.get('sort')] || sorts.seen;
      const limit = clamp(url.searchParams.get('limit'), 1, 200, 50);
      const offset = clamp(url.searchParams.get('offset'), 0, 1e6, 0);
      // Filters use $1.. first; the main query adds the month, limit and offset after them.
      const where = [];
      const fargs = [];
      if (q) { fargs.push(`${q}%`); where.push(`d.id ilike $${fargs.length}`); }
      if (plan === 'plus') where.push(`d.plan = 'plus' and (d.plus_until is null or d.plus_until > now())`);
      else if (plan === 'free') where.push(`not (d.plan = 'plus' and (d.plus_until is null or d.plus_until > now()))`);
      else if (plan === 'blocked') where.push('d.blocked');
      const w = where.length ? `where ${where.join(' and ')}` : '';
      const { rows: [{ total }] } = await pool.query(`select count(*)::int as total from devices d ${w}`, fargs);
      const p = fargs.length + 1;
      const { rows } = await pool.query(`
        select d.id, d.plan, d.plus_until, d.created_at, d.last_seen, d.blocked, d.app_version,
          (d.plan = 'plus' and (d.plus_until is null or d.plus_until > now())) as is_plus,
          coalesce(u.images, 0) as images_month, coalesce(u.analyses, 0) as analyses_month, coalesce(u.videos, 0) as video_credits_month,
          (select count(*)::int from images i where i.device_id = d.id) as images_total,
          (select count(*)::int from videos v where v.device_id = d.id) as videos_total,
          (select count(*)::int from interpretations n where n.device_id = d.id) as analyses_total
        from devices d left join usage u on u.device_id = d.id and u.period = $${p}
        ${w}
        order by ${sort} desc nulls last
        limit $${p + 1} offset $${p + 2}`, [...fargs, period(), limit, offset]);
      return send(200, { total, items: rows, period: period() });
    }

    const userMatch = /^users\/(dv[\w-]{6,40})(?:\/(plus|free|reset-usage|block|unblock))?$/.exec(route);
    if (userMatch) {
      const id = userMatch[1];
      const action = userMatch[2];
      const { rows: [d] } = await pool.query('select id, plan, plus_until, created_at, last_seen, blocked, app_version from devices where id = $1', [id]);
      if (!d) throw httpError(404, 'No such user.');
      if (method === 'GET' && !action) {
        const [usage, images, videos, interps] = await Promise.all([
          pool.query('select period, images, analyses, videos from usage where device_id = $1 order by period desc limit 24', [id]),
          pool.query('select id, status, style, provider, model, units, error, prompt, created_at, finished_at from images where device_id = $1 order by created_at desc limit 30', [id]),
          pool.query('select id, status, seconds, quality, credits, scenes, provider, model, units, error, prompt, image_id, created_at, finished_at from videos where device_id = $1 order by created_at desc limit 30', [id]),
          pool.query('select id, status, created_at, answered_at, rating, feedback, dream from interpretations where device_id = $1 order by created_at desc limit 30', [id]),
        ]);
        const plus = d.plan === 'plus' && (!d.plus_until || new Date(d.plus_until) > new Date());
        return send(200, {
          user: { ...d, is_plus: plus },
          limits: plans.plans[plus ? 'plus' : 'free']?.limits || {},
          usage: usage.rows,
          images: images.rows.map((r) => contentOf(who, { ...r, url: r.status === 'done' ? `../images/${r.id}.webp` : null }, ['prompt', 'url'])),
          videos: videos.rows.map((r) => contentOf(who, { ...r, url: r.status === 'done' ? `../videos/${r.id}.mp4` : null }, ['prompt', 'url'])),
          interpretations: interps.rows.map((r) => contentOf(who, r, ['dream', 'feedback'])),
          canSeeContent: isOwner(who),
        });
      }
      if (method === 'POST') {
        need(who, 'manager');
        const body = await readJson(req, 4096);
        if (action === 'plus') {
          const days = clamp(body.days, 1, 3650, 30);
          const base = d.plan === 'plus' && d.plus_until && new Date(d.plus_until) > new Date() ? new Date(d.plus_until) : new Date();
          const until = new Date(base.getTime() + days * 86400000);
          await pool.query(`update devices set plan = 'plus', plus_until = $2 where id = $1`, [id, until]);
          await audit(who, 'gave-plus', id, { days, until });
        } else if (action === 'free') {
          await pool.query(`update devices set plan = 'free', plus_until = null where id = $1`, [id]);
          await audit(who, 'removed-plus', id, null);
        } else if (action === 'reset-usage') {
          await pool.query('delete from usage where device_id = $1 and period = $2', [id, period()]);
          await audit(who, 'reset-usage', id, { period: period() });
        } else if (action === 'block' || action === 'unblock') {
          await pool.query('update devices set blocked = $2 where id = $1', [id, action === 'block']);
          await audit(who, action === 'block' ? 'paused-user' : 'unpaused-user', id, body.reason ? { reason: String(body.reason).slice(0, 200) } : null);
        } else throw httpError(404, 'Not found');
        return send(200, { ok: true });
      }
    }

    // -- AI pictures and videos --
    if (method === 'GET' && (route === 'jobs/images' || route === 'jobs/videos')) {
      const table = route.endsWith('images') ? 'images' : 'videos';
      const status = String(url.searchParams.get('status') || '');
      const limit = clamp(url.searchParams.get('limit'), 1, 200, 50);
      const offset = clamp(url.searchParams.get('offset'), 0, 1e6, 0);
      const args = [limit, offset];
      let w = '';
      if (['pending', 'done', 'failed'].includes(status)) { args.push(status); w = 'where status = $3'; }
      const cols = table === 'images'
        ? 'id, device_id, status, style, provider, model, units, error, prompt, created_at, finished_at'
        : 'id, device_id, status, style, seconds, quality, credits, scenes, scenes_done, provider, model, units, bytes, error, prompt, image_id, created_at, finished_at';
      const [{ rows }, { rows: [{ total }] }, { rows: providers }] = await Promise.all([
        pool.query(`select ${cols} from ${table} ${w} order by created_at desc limit $1 offset $2`, args),
        pool.query(`select count(*)::int as total from ${table} ${w ? 'where status = $1' : ''}`, w ? [status] : []),
        pool.query(`select coalesce(provider, '(none)') as provider, coalesce(model, '') as model,
            count(*)::int as jobs,
            count(*) filter (where status = 'done')::int as done,
            count(*) filter (where status = 'failed')::int as failed,
            coalesce(sum(units) filter (where status = 'done'), 0)::float as units,
            avg(extract(epoch from finished_at - created_at)) filter (where status = 'done')::float as avg_seconds
          from ${table} where created_at > now() - interval '30 days' group by 1, 2 order by jobs desc`),
      ]);
      const ext = table === 'images' ? 'webp' : 'mp4';
      return send(200, {
        total,
        providers,
        canSeeContent: isOwner(who),
        items: rows.map((r) => contentOf(who, { ...r, url: r.status === 'done' ? `../${table}/${r.id}.${ext}` : null }, ['prompt', 'url'])),
      });
    }

    // -- Interpretations --
    if (method === 'GET' && route === 'interpretations') {
      const status = String(url.searchParams.get('status') || '');
      const limit = clamp(url.searchParams.get('limit'), 1, 200, 50);
      const offset = clamp(url.searchParams.get('offset'), 0, 1e6, 0);
      const args = [limit, offset];
      let w = '';
      if (['waiting', 'working', 'done', 'failed'].includes(status)) { args.push(status); w = 'where status = $3'; }
      const [{ rows }, { rows: counts }] = await Promise.all([
        pool.query(`select id, status, device_id, created_at, claimed_at, answered_at, rating, feedback, feedback_at, error,
            length(dream->>'text')::int as chars, dream, result
          from interpretations ${w} order by created_at desc limit $1 offset $2`, args),
        pool.query('select status, count(*)::int as n from interpretations group by status'),
      ]);
      return send(200, {
        counts,
        canSeeContent: isOwner(who),
        items: rows.map((r) => contentOf(who, r, ['dream', 'result', 'feedback', 'error'])),
      });
    }
    const interpMatch = /^interpretations\/([\w-]{6,40})\/(release|fail|delete)$/.exec(route);
    if (method === 'POST' && interpMatch) {
      need(who, 'owner');
      const [, id, action] = interpMatch;
      let r;
      if (action === 'release') r = await pool.query(`update interpretations set status = 'waiting', claimed_at = null where id = $1 returning id`, [id]);
      else if (action === 'fail') r = await pool.query(`update interpretations set status = 'failed', error = 'Closed by the team', answered_at = now() where id = $1 returning id`, [id]);
      else r = await pool.query('delete from interpretations where id = $1 returning id', [id]);
      if (!r.rowCount) throw httpError(404, 'Not found');
      await audit(who, `interpretation-${action}`, id, null);
      return send(200, { ok: true });
    }

    // -- Redeem codes --
    if (method === 'GET' && route === 'codes') {
      const { rows } = await pool.query(`select code_hash, hint, days, uses_left, uses_total, note, created_by, created_at, disabled_at
        from codes order by created_at desc limit 300`);
      return send(200, { items: rows });
    }
    if (method === 'POST' && route === 'codes') {
      need(who, 'manager');
      const body = await readJson(req, 4096);
      const days = clamp(body.days, 1, 3650, 30);
      const uses = clamp(body.uses, 1, 10000, 1);
      const note = String(body.note || '').trim().slice(0, 200);
      const raw = crypto.randomBytes(6).toString('base64url').toUpperCase().replace(/[^A-Z0-9]/g, 'X');
      const code = `DREAM-${raw.slice(0, 4)}-${raw.slice(4, 8)}`;
      await pool.query('insert into codes (code_hash, days, uses_left, uses_total, note, hint, created_by) values ($1, $2, $3, $3, $4, $5, $6)',
        [crypto.createHash('sha256').update(code).digest('hex'), days, uses, note, code.slice(-4), who.email]);
      await audit(who, 'created-code', `…${code.slice(-4)}`, { days, uses, note });
      return send(201, { code, days, uses });
    }
    const codeMatch = /^codes\/([0-9a-f]{64})\/disable$/.exec(route);
    if (method === 'POST' && codeMatch) {
      need(who, 'manager');
      const r = await pool.query('update codes set uses_left = 0, disabled_at = now() where code_hash = $1 returning hint', [codeMatch[1]]);
      if (!r.rowCount) throw httpError(404, 'Not found');
      await audit(who, 'disabled-code', `…${r.rows[0].hint || ''}`, null);
      return send(200, { ok: true });
    }

    // -- Symbol library --
    if (method === 'GET' && route === 'library') {
      const [top, missing, total] = await Promise.all([
        pool.query(`select name, sum(hits)::int as hits from library_hits where found and day > current_date - 30 group by name order by hits desc limit 30`),
        pool.query(`select name, sum(hits)::int as hits from library_hits where not found and day > current_date - 30 group by name order by hits desc limit 30`),
        pool.query(`select coalesce(sum(hits), 0)::int as hits, count(distinct name)::int as names from library_hits where day > current_date - 30`),
      ]);
      return send(200, { entries: librarySize(), top: top.rows, missing: missing.rows, month: total.rows[0] });
    }

    // -- Plans, prices and limits (from plans.json) --
    if (method === 'GET' && route === 'plans') {
      return send(200, { plans: plans.plans, prices: plans.prices, budget: plans.budget || {}, images: plans.images, videos: plans.videos, paymentsEnabled: Boolean(process.env.PAYMENTS_ENABLED) });
    }

    // -- Server health --
    if (method === 'GET' && route === 'system') {
      const [{ rows: [db] }, { rows: tables }, { rows: versions }] = await Promise.all([
        pool.query('select pg_database_size(current_database())::bigint as bytes'),
        pool.query(`select 'devices' as name, count(*)::int as rows from devices union all
          select 'images', count(*)::int from images union all select 'videos', count(*)::int from videos union all
          select 'interpretations', count(*)::int from interpretations union all select 'codes', count(*)::int from codes union all
          select 'activity', count(*)::int from activity union all select 'audit_log', count(*)::int from audit_log`),
        pool.query(`select coalesce(app_version, 'unknown') as version, count(*)::int as users from devices
          where last_seen > now() - interval '30 days' group by 1 order by 2 desc limit 20`),
      ]);
      let disk = null;
      try {
        const s = statfsSync(HERE);
        disk = { total: s.blocks * s.bsize, free: s.bavail * s.bsize };
      } catch {}
      return send(200, {
        server: { version, node: process.version, uptimeSeconds: Math.round(process.uptime()), memoryBytes: process.memoryUsage().rss },
        database: { bytes: Number(db.bytes), tables },
        storage: { images: dirSize(imageDir), videos: dirSize(videoDir), disk },
        providers: { poyo: Boolean(process.env.POYO_API_KEY), fal: Boolean(process.env.FAL_API_KEY) },
        app: await appLiveVersion(),
        appVersions: versions,
        errors: errorLog.slice(0, 30),
      });
    }

    // -- Team and activity log (Owner) --
    if (method === 'GET' && route === 'staff') {
      need(who, 'owner');
      const [{ rows: staff }, { rows: invites }] = await Promise.all([
        pool.query('select id, email, name, role, disabled, invited_by, created_at, last_login from staff order by created_at'),
        pool.query(`select token_hash, email, name, role, created_by, created_at, expires_at from staff_invites
          where used_at is null and expires_at > now() order by created_at desc`),
      ]);
      return send(200, { staff, invites, you: who.id });
    }
    if (method === 'POST' && route === 'staff/invite') {
      need(who, 'owner');
      const body = await readJson(req, 4096);
      const out = await createInvite({ email: body.email, name: body.name, role: String(body.role || 'viewer'), createdBy: who.email });
      await audit(who, 'invited', out.email, { role: out.role });
      return send(201, out);
    }
    const inviteMatch = /^staff\/invites\/([0-9a-f]{64})\/cancel$/.exec(route);
    if (method === 'POST' && inviteMatch) {
      need(who, 'owner');
      const r = await pool.query('delete from staff_invites where token_hash = $1 and used_at is null returning email', [inviteMatch[1]]);
      if (!r.rowCount) throw httpError(404, 'Not found');
      await audit(who, 'cancelled-invite', r.rows[0].email, null);
      return send(200, { ok: true });
    }
    const staffMatch = /^staff\/(st[\w-]{6,40})$/.exec(route);
    if (method === 'POST' && staffMatch) {
      need(who, 'owner');
      const id = staffMatch[1];
      const body = await readJson(req, 4096);
      const { rows: [t] } = await pool.query('select * from staff where id = $1', [id]);
      if (!t) throw httpError(404, 'Not found');
      const role = body.role === undefined ? t.role : String(body.role);
      const disabled = body.disabled === undefined ? t.disabled : Boolean(body.disabled);
      if (!ROLES.includes(role)) throw httpError(400, 'Unknown role.');
      if (t.role === 'owner' && (role !== 'owner' || disabled)) {
        const { rows: [{ n }] } = await pool.query(`select count(*)::int as n from staff where role = 'owner' and not disabled`);
        if (n <= 1) throw httpError(400, 'There must always be at least one Owner.');
      }
      await pool.query('update staff set role = $2, disabled = $3 where id = $1', [id, role, disabled]);
      if (disabled) await pool.query('delete from staff_sessions where staff_id = $1', [id]);
      await audit(who, 'changed-member', t.email, { role, disabled });
      return send(200, { ok: true });
    }
    if (method === 'GET' && route === 'audit') {
      need(who, 'owner');
      const limit = clamp(url.searchParams.get('limit'), 1, 500, 200);
      const { rows } = await pool.query('select id, staff_email, action, target, details, at from audit_log order by at desc limit $1', [limit]);
      return send(200, { items: rows });
    }

    throw httpError(404, 'Not found');
  }

  /** Handles everything under /dashboard. parts[0] === 'dashboard'. */
  async function handle(req, res, url, parts, ip) {
    const send = (status, body) => {
      res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'X-Robots-Tag': 'noindex, nofollow',
      });
      res.end(JSON.stringify(body));
    };
    if (parts[1] === 'api') {
      try {
        await api(req, res, url, parts.slice(2), ip, send);
      } catch (err) {
        const status = err.status || 500;
        if (status >= 500) console.error('dashboard', err);
        if (!res.headersSent) send(status, { error: status >= 500 ? 'Server error' : err.message });
      }
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') throw httpError(405, 'Method not allowed');
    // /dashboard → /dashboard/ so the page's relative links resolve under it.
    if (parts.length === 1 && !url.pathname.endsWith('/')) {
      res.writeHead(301, { Location: 'dashboard/' });
      res.end();
      return;
    }
    sendStatic(res, parts[1] || 'index.html');
  }

  return { handle, createInvite };
}
