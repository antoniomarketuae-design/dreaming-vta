// Dreaming Admin: the managers' dashboard (served by dreaming-api at /dashboard/, API at /dashboard/api/*).
// Plain ES module, no build step. No inline styles or handlers (the page runs under a strict CSP).

const app = document.getElementById('app');
const toastEl = document.getElementById('toast');
let me = null;
let navCounts = {};

// ---- Helpers ----
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = (n, d = 0) => (n == null || Number.isNaN(Number(n)) ? '–' : Number(n).toLocaleString(undefined, { maximumFractionDigits: d }));
const short = (id) => (id ? `${String(id).slice(0, 10)}…` : '–');
const ROLE_NAMES = { owner: 'Owner', manager: 'Manager', viewer: 'Viewer' };
const ROLE_LINES = {
  owner: 'Everything, including users\u2019 private content, the team and the activity log.',
  manager: 'Sees all numbers and can change accounts (Plus, pause) and redeem codes. No private content.',
  viewer: 'Sees all numbers and lists, but cannot change anything. No private content.',
};

function when(v) {
  if (!v) return '–';
  const d = new Date(v);
  return d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}
function ago(v) {
  if (!v) return 'never';
  const s = Math.round((Date.now() - new Date(v).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  if (s < 86400 * 30) return `${Math.round(s / 86400)} days ago`;
  return when(v);
}
function bytes(b) {
  if (b == null) return '–';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let n = Number(b);
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i += 1; }
  return `${n.toLocaleString(undefined, { maximumFractionDigits: n < 10 && i ? 1 : 0 })} ${u[i]}`;
}
function secs(s) {
  if (s == null) return '–';
  s = Math.round(s);
  if (s < 90) return `${s} s`;
  if (s < 5400) return `${Math.round(s / 60)} min`;
  if (s < 172800) return `${Math.round(s / 3600)} h`;
  return `${Math.round(s / 86400)} days`;
}
const took = (a, b) => (a && b ? secs((new Date(b) - new Date(a)) / 1000) : '–');
const statusBadge = (s) => `<span class="badge ${{ done: 'good', failed: 'bad', pending: 'warn', waiting: 'warn', working: 'warn' }[s] || ''}">${esc({ done: 'Done', failed: 'Failed', pending: 'Running', waiting: 'Waiting', working: 'Being answered' }[s] || s)}</span>`;
const can = (role) => me && ({ viewer: 1, manager: 2, owner: 3 }[me.role] >= { viewer: 1, manager: 2, owner: 3 }[role]);

function toast(text, bad = false) {
  toastEl.textContent = text;
  toastEl.classList.toggle('bad', bad);
  toastEl.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { toastEl.hidden = true; }, 3200);
}

async function api(path, { method = 'GET', body } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET') headers['X-Dash'] = '1';
  const res = await fetch(`api/${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'same-origin', cache: 'no-store' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `Something went wrong (${res.status}).`), { status: res.status });
  return data;
}

async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast('Copied'); } catch { toast('Select the text and copy it', true); }
}

/** Bars for the last 30 days (SVG attributes only, no inline styles). */
function barsSVG(values) {
  const max = Math.max(1, ...values);
  const w = 100 / values.length;
  return `<svg viewBox="0 0 100 64" preserveAspectRatio="none" aria-hidden="true">${values.map((v, i) => {
    const h = v ? Math.max(2, (v / max) * 60) : 0;
    return `<rect x="${(i * w + w * 0.15).toFixed(2)}" y="${(64 - h).toFixed(2)}" width="${(w * 0.7).toFixed(2)}" height="${h.toFixed(2)}" rx="0.6"${i === values.length - 1 ? ' class="today"' : ''}/>`;
  }).join('')}</svg>`;
}
function chartHTML(title, series, key) {
  const values = series.map((d) => Number(d[key]) || 0);
  const total = values.reduce((a, b) => a + b, 0);
  return `<div class="panel chart">
    <div class="chart-head"><span class="muted">${esc(title)}</span><b>${num(values[values.length - 1])}</b></div>
    ${barsSVG(values)}
    <div class="chart-foot"><span>30 days: ${num(total)}</span><span>today</span></div>
  </div>`;
}
const kpi = (label, value, sub = '') => `<div class="panel kpi"><span class="label">${esc(label)}</span><span class="value">${value}</span>${sub ? `<span class="sub">${sub}</span>` : ''}</div>`;
const meterRow = (label, value, max, right) => `<div class="bar-row"><span>${esc(label)}</span><span class="muted">${right ?? `${num(value)} / ${num(max)}`}</span><meter min="0" max="${Number(max) || 1}" value="${Number(value) || 0}" low="${(Number(max) || 1) * 0.7}" high="${(Number(max) || 1) * 0.9}" optimum="0"></meter></div>`;

// ---- Sign in / invitation ----

function authShell(inner) {
  app.className = '';
  app.innerHTML = `<main class="auth"><div class="auth-card">
    <div class="auth-logo"><img src="icon.svg" alt=""><div><h1>Dreaming Admin</h1><span class="faint">For the Dreaming team</span></div></div>
    ${inner}
  </div></main>`;
}

function showLogin(message = '') {
  authShell(`
    <form data-form="login" novalidate>
      <label class="field"><span>Your name or email</span><input class="input" name="email" type="text" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" required></label>
      <label class="field"><span>Password</span><input class="input" name="password" type="password" autocomplete="current-password" required></label>
      <p class="err" data-err>${esc(message)}</p>
      <button class="btn btn-gold btn-wide" type="submit">Sign in</button>
    </form>
    <p class="faint">No login yet? The Owner sends you an invitation link.</p>`);
  app.querySelector('[name=email]').focus();
}

async function showInvite(token) {
  let info;
  try {
    info = await api(`invite-info?token=${encodeURIComponent(token)}`);
  } catch (err) {
    authShell(`<p>${esc(err.message)}</p><a class="btn btn-wide" href="./">Go to sign in</a>`);
    return;
  }
  authShell(`
    <p>Welcome to the Dreaming team. You are joining as <b>${esc(ROLE_NAMES[info.role])}</b> with <b>${esc(info.email)}</b>.</p>
    <p class="faint">${esc(ROLE_LINES[info.role])}</p>
    <form data-form="accept" novalidate>
      <input type="hidden" name="token" value="${esc(token)}">
      <input class="sr" name="username" type="email" autocomplete="username" value="${esc(info.email)}" tabindex="-1" aria-hidden="true">
      <label class="field"><span>Your name (you can sign in with it, or with your email)</span><input class="input" name="name" autocomplete="name" value="${esc(info.name || '')}" required></label>
      <label class="field"><span>Choose a password (at least 10 characters)</span><input class="input" name="password" type="password" autocomplete="new-password" minlength="10" required></label>
      <label class="field"><span>Type it again</span><input class="input" name="again" type="password" autocomplete="new-password" minlength="10" required></label>
      <p class="err" data-err></p>
      <button class="btn btn-gold btn-wide" type="submit">Create my login</button>
    </form>`);
}

// ---- The shell ----

const PAGES = [
  ['overview', 'Overview', 'viewer'],
  ['users', 'Users', 'viewer'],
  ['ai', 'AI pictures & videos', 'viewer'],
  ['interpretations', 'Interpretations', 'viewer'],
  ['codes', 'Redeem codes', 'viewer'],
  ['library', 'Symbol library', 'viewer'],
  ['plans', 'Plans & limits', 'viewer'],
  ['system', 'Server health', 'viewer'],
  ['team', 'Team', 'owner'],
  ['activity', 'Activity log', 'owner'],
];

function shell(current) {
  app.className = '';
  app.innerHTML = `<div class="shell">
    <aside class="side">
      <div class="brand"><img src="icon.svg" alt=""><div><b>Dreaming Admin</b><small>${esc(me.name)} · ${esc(ROLE_NAMES[me.role])}</small></div></div>
      <nav class="nav" aria-label="Sections">
        ${PAGES.filter(([, , role]) => can(role)).map(([id, label]) => `<a href="#/${id}" ${id === current ? 'aria-current="page"' : ''}>${esc(label)}${navCounts[id] ? `<span class="count">${navCounts[id]}</span>` : ''}</a>`).join('')}
        <a href="#/account" class="phone-only" ${current === 'account' ? 'aria-current="page"' : ''}>My account</a>
      </nav>
      <div class="side-foot">
        <div class="who"><b>${esc(me.name)}</b><span class="faint">${esc(me.email)}</span><span><span class="badge role-${esc(me.role)}">${esc(ROLE_NAMES[me.role])}</span></span></div>
        <div class="actions"><a class="btn btn-sm" href="#/account">My account</a><button class="btn btn-sm" data-act="logout">Sign out</button></div>
      </div>
    </aside>
    <main class="main" id="main"><p class="muted">Loading…</p></main>
  </div>`;
  return document.getElementById('main');
}

function head(title, sub = '', right = '') {
  return `<div class="page-head"><div><h1>${esc(title)}</h1>${sub ? `<p class="muted">${sub}</p>` : ''}</div>${right}</div>`;
}

// ---- Pages ----

const state = { users: { q: '', plan: '', sort: 'seen', offset: 0 }, ai: { kind: 'images', status: '', offset: 0 }, interp: { status: '', offset: 0 }, newCode: null, newInvite: null };

async function pageOverview(main) {
  const d = await api('overview');
  const n = d.numbers;
  navCounts.interpretations = n.interp_waiting || 0;
  main.innerHTML = `${head('Overview', 'The whole platform at a glance. Dreams in people\u2019s journals stay on their phones and never appear here.')}
    <div class="grid grid-kpi">
      ${kpi('Users', num(n.users), `<b>+${num(n.new_1d)}</b> today · <b>+${num(n.new_7d)}</b> this week`)}
      ${kpi('Active today', num(n.active_1d), `<b>${num(n.active_7d)}</b> this week · <b>${num(n.active_30d)}</b> this month`)}
      ${kpi('Dreaming Plus', num(n.plus), `${n.users ? num((n.plus / n.users) * 100, 1) : 0}% of users · ${num(n.codes_active)} codes open`)}
      ${kpi('AI pictures', num(n.images_month), `this month · <b>${num(n.images_1d)}</b> today${n.images_failed_1d ? ` · <b>${num(n.images_failed_1d)}</b> failed` : ''}`)}
      ${kpi('AI videos', num(n.videos_month), `this month · <b>${num(n.videos_1d)}</b> today${n.videos_running ? ` · <b>${num(n.videos_running)}</b> running` : ''}`)}
      ${kpi('Interpretations', num(n.interp_waiting), `waiting · <b>${num(n.interp_done_month)}</b> answered this month${n.interp_rated ? ` · rating ${n.interp_rating >= 0 ? '+' : ''}${num(n.interp_rating, 2)}` : ''}`)}
      ${kpi('Provider cost', num(n.image_units_month + n.video_units_month), `credits this month · pictures ${num(n.image_units_month)} · videos ${num(n.video_units_month)}`)}
      ${kpi('App version', d.app ? `v${num(d.app.version)}` : '–', d.app ? `live since ${esc(d.app.updated)}` : 'could not reach GitHub')}
    </div>
    <div class="grid grid-2">
      ${chartHTML('New users per day', d.series, 'new_users')}
      ${chartHTML('Active users per day', d.series, 'active')}
      ${chartHTML('AI pictures per day', d.series, 'images')}
      ${chartHTML('AI videos per day', d.series, 'videos')}
      ${chartHTML('Interpretations asked per day', d.series, 'interpretations')}
      <div class="panel"><h3>Today\u2019s safety limits</h3>
        ${meterRow('AI pictures (last 24 h)', n.images_1d, d.budget.imagesPerDay)}
        ${meterRow('AI videos (last 24 h)', n.videos_1d, d.budget.videosPerDay)}
        <p class="faint">When a limit is reached, creating stops until the next day (protects the budget).</p>
      </div>
    </div>
    ${n.blocked ? `<p class="note">${num(n.blocked)} paused account(s).</p>` : ''}`;
}

async function pageUsers(main) {
  const s = state.users;
  const d = await api(`users?q=${encodeURIComponent(s.q)}&plan=${s.plan}&sort=${s.sort}&offset=${s.offset}&limit=50`);
  main.innerHTML = `${head('Users', `${num(d.total)} account(s). Each phone is an anonymous account (no names, emails or journals).`)}
    <div class="panel">
      <form class="toolbar" data-form="user-search">
        <input class="input" name="q" placeholder="Find by account id (starts with dv…)" value="${esc(s.q)}" autocomplete="off">
        <select class="input" name="sort" aria-label="Sort by">
          ${[['seen', 'Last seen'], ['joined', 'Newest'], ['images', 'Most pictures'], ['videos', 'Most videos'], ['analyses', 'Most interpretations']].map(([v, l]) => `<option value="${v}" ${s.sort === v ? 'selected' : ''}>${l}</option>`).join('')}
        </select>
        <button class="btn btn-sm" type="submit">Find</button>
      </form>
      <div class="chips" role="group" aria-label="Plan">
        ${[['', 'All'], ['plus', 'Plus'], ['free', 'Free'], ['blocked', 'Paused']].map(([v, l]) => `<button class="chip" data-act="users-plan" data-v="${v}" aria-pressed="${s.plan === v}">${l}</button>`).join('')}
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th>Account</th><th>Plan</th><th>Last seen</th><th>Joined</th><th class="num">Pictures</th><th class="num">Videos</th><th class="num">Interpr.</th><th>App</th></tr></thead>
        <tbody>${d.items.map((u) => `<tr class="click" data-href="#/user/${esc(u.id)}">
          <td class="mono nowrap">${esc(short(u.id))}${u.blocked ? ' <span class="badge bad">Paused</span>' : ''}</td>
          <td>${u.is_plus ? `<span class="badge plus">Plus</span>${u.plus_until ? `<div class="faint">until ${esc(when(u.plus_until))}</div>` : ''}` : '<span class="badge">Free</span>'}</td>
          <td class="nowrap">${esc(ago(u.last_seen))}</td>
          <td class="nowrap">${esc(when(u.created_at))}</td>
          <td class="num">${num(u.images_total)}<div class="faint">${num(u.images_month)} this month</div></td>
          <td class="num">${num(u.videos_total)}<div class="faint">${num(u.video_credits_month)} cr. this month</div></td>
          <td class="num">${num(u.analyses_total)}</td>
          <td>${u.app_version ? `v${esc(u.app_version)}` : '<span class="faint">–</span>'}</td>
        </tr>`).join('') || `<tr><td colspan="8" class="empty">No accounts match.</td></tr>`}</tbody>
      </table></div>
      ${pager(s.offset, 50, d.total, 'users')}
    </div>`;
}

function pager(offset, size, total, key) {
  if (total <= size) return '';
  return `<div class="pager"><button class="btn btn-sm" data-act="page" data-key="${key}" data-to="${Math.max(0, offset - size)}" ${offset ? '' : 'disabled'}>‹ Newer</button>
    <span class="faint">${num(offset + 1)}–${num(Math.min(total, offset + size))} of ${num(total)}</span>
    <button class="btn btn-sm" data-act="page" data-key="${key}" data-to="${offset + size}" ${offset + size < total ? '' : 'disabled'}>Older ›</button></div>`;
}

async function pageUser(main, id) {
  const d = await api(`users/${encodeURIComponent(id)}`);
  const u = d.user;
  const usage = d.usage[0] && d.usage[0].period === new Date().toISOString().slice(0, 7) ? d.usage[0] : { images: 0, analyses: 0, videos: 0 };
  const manage = can('manager') ? `
    <div class="panel"><h3>Change this account</h3>
      <div class="actions">
        <label class="sr" for="plus-days">Days of Plus</label>
        <input class="input" id="plus-days" type="number" min="1" max="3650" value="30" inputmode="numeric">
        <button class="btn btn-gold" data-act="user-plus" data-id="${esc(u.id)}">Give Plus (days)</button>
        ${u.is_plus ? `<button class="btn" data-act="user-free" data-id="${esc(u.id)}">Remove Plus</button>` : ''}
        <button class="btn" data-act="user-reset" data-id="${esc(u.id)}">Reset this month\u2019s usage</button>
        ${u.blocked ? `<button class="btn" data-act="user-unblock" data-id="${esc(u.id)}">Unpause</button>` : `<button class="btn btn-danger" data-act="user-block" data-id="${esc(u.id)}">Pause account</button>`}
      </div>
      <p class="faint">Giving Plus adds days on top of any Plus they already have. Pausing stops AI pictures, videos and interpretations for this phone. Every change is logged with your name.</p>
    </div>` : '';
  const pics = d.images.length ? (d.canSeeContent
    ? `<div class="thumbs">${d.images.map((r) => `<figure>${r.url ? `<a href="${esc(r.url)}" target="_blank" rel="noopener"><img src="${esc(r.url)}" alt="AI picture" loading="lazy"></a>` : `<div class="empty">${statusBadge(r.status)}</div>`}<figcaption>${esc(when(r.created_at))} · ${esc(r.provider || '')}</figcaption></figure>`).join('')}</div>`
    : jobsTable(d.images, 'images', false)) : '<p class="empty">No AI pictures.</p>';
  const vids = d.videos.length ? jobsTable(d.videos, 'videos', d.canSeeContent) : '<p class="empty">No AI videos.</p>';
  main.innerHTML = `${head('Account', `<span class="mono">${esc(u.id)}</span>`, '<a class="btn btn-sm" href="#/users">‹ All users</a>')}
    <div class="grid grid-2">
      <div class="panel"><dl class="kv">
        <dt>Plan</dt><dd>${u.is_plus ? '<span class="badge plus">Dreaming Plus</span>' : '<span class="badge">Free</span>'}${u.blocked ? ' <span class="badge bad">Paused</span>' : ''}</dd>
        ${u.is_plus ? `<dt>Plus until</dt><dd>${u.plus_until ? esc(when(u.plus_until)) : 'no end date'}</dd>` : ''}
        <dt>Joined</dt><dd>${esc(when(u.created_at))}</dd>
        <dt>Last seen</dt><dd>${esc(ago(u.last_seen))}</dd>
        <dt>App version</dt><dd>${u.app_version ? `v${esc(u.app_version)}` : 'not reported yet'}</dd>
      </dl></div>
      <div class="panel"><h3>This month</h3>
        ${meterRow('AI pictures', usage.images, d.limits.images)}
        ${meterRow('Interpretations', usage.analyses, d.limits.analyses)}
        ${meterRow('Video credits', usage.videos, d.limits.videos || 0)}
      </div>
    </div>
    ${manage}
    <div class="panel"><h3>AI pictures</h3>${d.canSeeContent ? '' : '<p class="faint">Only the Owner can see the pictures themselves.</p>'}${pics}</div>
    <div class="panel"><h3>AI videos</h3>${vids}</div>
    <div class="panel"><h3>Interpretations</h3>${interpTable(d.interpretations, d.canSeeContent, false)}</div>
    <div class="panel"><h3>Usage by month</h3><div class="table-wrap"><table>
      <thead><tr><th>Month</th><th class="num">Pictures</th><th class="num">Interpretations</th><th class="num">Video credits</th></tr></thead>
      <tbody>${d.usage.map((r) => `<tr><td>${esc(r.period)}</td><td class="num">${num(r.images)}</td><td class="num">${num(r.analyses)}</td><td class="num">${num(r.videos)}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">Nothing used yet.</td></tr>'}</tbody>
    </table></div></div>`;
}

function jobsTable(items, kind, content) {
  return `<div class="table-wrap"><table>
    <thead><tr><th>When</th><th>Status</th>${kind === 'videos' ? '<th>Length</th>' : ''}<th>Made by</th><th class="num">Cost</th><th class="num">Took</th>${content ? '<th>Open</th>' : ''}</tr></thead>
    <tbody>${items.map((r) => `<tr>
      <td class="nowrap">${esc(when(r.created_at))}${r.device_id ? `<div><a class="mono" href="#/user/${esc(r.device_id)}">${esc(short(r.device_id))}</a></div>` : ''}</td>
      <td>${statusBadge(r.status)}${r.status === 'pending' && r.scenes > 1 ? `<div class="faint">${num(r.scenes_done)} of ${num(r.scenes)} scenes</div>` : ''}${r.error ? `<div class="err-text">${esc(r.error)}</div>` : ''}</td>
      ${kind === 'videos' ? `<td class="nowrap">${r.seconds ? `${num(r.seconds)} s` : '–'} · ${esc(r.quality === 'hd' ? 'HD' : 'Standard')}${r.scenes > 1 ? ` · ${num(r.scenes)} scenes` : ''}<div class="faint">${num(r.credits)} credits</div></td>` : ''}
      <td>${esc(r.provider || '–')}<div class="faint">${esc(r.model || '')}</div></td>
      <td class="num">${r.units == null ? '–' : num(r.units)}</td>
      <td class="num nowrap">${esc(took(r.created_at, r.finished_at))}</td>
      ${content ? `<td>${r.url ? `<a href="${esc(r.url)}" target="_blank" rel="noopener">Open</a>` : ''}${r.prompt ? `<details><summary>Prompt</summary><div class="content-box">${esc(r.prompt)}</div></details>` : ''}</td>` : ''}
    </tr>`).join('')}</tbody>
  </table></div>`;
}

async function pageAI(main) {
  const s = state.ai;
  const d = await api(`jobs/${s.kind}?status=${s.status}&offset=${s.offset}&limit=50`);
  const word = s.kind === 'images' ? 'pictures' : 'videos';
  main.innerHTML = `${head('AI pictures & videos', 'Every picture and video the AI services made: who made it, how long it took, what it cost and what went wrong.')}
    <div class="chips" role="group" aria-label="Kind">
      <button class="chip" data-act="ai-kind" data-v="images" aria-pressed="${s.kind === 'images'}">Pictures</button>
      <button class="chip" data-act="ai-kind" data-v="videos" aria-pressed="${s.kind === 'videos'}">Videos</button>
    </div>
    <div class="panel"><h3>AI services, last 30 days</h3><div class="table-wrap"><table>
      <thead><tr><th>Service</th><th class="num">Jobs</th><th class="num">Done</th><th class="num">Failed</th><th class="num">Success</th><th class="num">Avg time</th><th class="num">Cost</th></tr></thead>
      <tbody>${d.providers.map((p) => `<tr><td>${p.provider === '(none)' ? 'None: stopped before a service took it' : esc(p.provider)}<div class="faint">${esc(p.model)}</div></td><td class="num">${num(p.jobs)}</td><td class="num">${num(p.done)}</td><td class="num">${num(p.failed)}</td><td class="num">${p.jobs ? num((p.done / p.jobs) * 100) : 0}%</td><td class="num">${esc(secs(p.avg_seconds))}</td><td class="num">${num(p.units)}</td></tr>`).join('') || `<tr><td colspan="7" class="empty">No ${word} in the last 30 days.</td></tr>`}</tbody>
    </table></div><p class="faint">Cost is in the AI service\u2019s own credits.</p></div>
    <div class="panel">
      <div class="toolbar"><div class="chips" role="group" aria-label="Status">
        ${[['', 'All'], ['done', 'Done'], ['pending', 'Running'], ['failed', 'Failed']].map(([v, l]) => `<button class="chip" data-act="ai-status" data-v="${v}" aria-pressed="${s.status === v}">${l}</button>`).join('')}
      </div><span class="faint">${num(d.total)} ${word}</span></div>
      ${d.items.length ? jobsTable(d.items, s.kind, d.canSeeContent) : `<p class="empty">No ${word} here.</p>`}
      ${pager(s.offset, 50, d.total, 'ai')}
      ${d.canSeeContent ? '' : '<p class="faint">Only the Owner can open the pictures, videos and the text sent to the AI.</p>'}
    </div>`;
}

function interpTable(items, content, actions) {
  if (!items.length) return '<p class="empty">None.</p>';
  return `<div class="table-wrap"><table>
    <thead><tr><th>Asked</th><th>Status</th><th>Answered</th><th>Rating</th>${content ? '<th>Dream and answer</th>' : '<th class="num">Length</th>'}${actions ? '<th></th>' : ''}</tr></thead>
    <tbody>${items.map((r) => `<tr>
      <td class="nowrap">${esc(when(r.created_at))}${r.device_id ? `<div><a class="mono" href="#/user/${esc(r.device_id)}">${esc(short(r.device_id))}</a></div>` : ''}</td>
      <td>${statusBadge(r.status)}${content && r.error ? `<div class="err-text">${esc(r.error)}</div>` : ''}</td>
      <td class="nowrap">${r.answered_at ? esc(took(r.created_at, r.answered_at)) : '–'}</td>
      <td>${r.rating == null ? '–' : r.rating > 0 ? '<span class="badge good">Helpful</span>' : '<span class="badge bad">Not helpful</span>'}${content && r.feedback ? `<div class="content-box">${esc(r.feedback)}</div>` : ''}</td>
      ${content ? `<td>${r.dream ? `<details><summary>${esc(r.dream.title || String(r.dream.text || '').slice(0, 40) || 'Dream')}</summary><div class="content-box">${esc(r.dream.text)}</div>${r.result ? `<div class="content-box">${esc(resultText(r.result))}</div>` : ''}</details>` : ''}</td>` : `<td class="num">${num(r.chars)} chars</td>`}
      ${actions ? `<td class="actions">${['waiting', 'working'].includes(r.status) ? `<button class="btn btn-sm" data-act="interp" data-do="release" data-id="${esc(r.id)}">Put back</button><button class="btn btn-sm" data-act="interp" data-do="fail" data-id="${esc(r.id)}">Close</button>` : ''}<button class="btn btn-sm btn-danger" data-act="interp" data-do="delete" data-id="${esc(r.id)}">Delete</button></td>` : ''}
    </tr>`).join('')}</tbody>
  </table></div>`;
}
function resultText(r) {
  if (typeof r === 'string') return r;
  const parts = [r.title, r.summary, r.meaning, r.reflection, ...(Array.isArray(r.sections) ? r.sections.map((s) => `${s.title || ''}\n${s.text || s.body || ''}`) : [])].filter(Boolean);
  return parts.length ? parts.join('\n\n') : JSON.stringify(r, null, 2);
}

async function pageInterpretations(main) {
  const s = state.interp;
  const d = await api(`interpretations?status=${s.status}&offset=${s.offset}&limit=50`);
  const count = (st) => d.counts.find((c) => c.status === st)?.n || 0;
  navCounts.interpretations = count('waiting');
  main.innerHTML = `${head('Interpretations', 'Dreams people sent to be interpreted (the beta). They are deleted after 60 days.')}
    <div class="grid grid-kpi">
      ${kpi('Waiting', num(count('waiting')))}${kpi('Being answered', num(count('working')))}${kpi('Answered', num(count('done')))}${kpi('Closed', num(count('failed')))}
    </div>
    <div class="panel">
      <div class="chips" role="group" aria-label="Status">
        ${[['', 'All'], ['waiting', 'Waiting'], ['working', 'Being answered'], ['done', 'Answered'], ['failed', 'Closed']].map(([v, l]) => `<button class="chip" data-act="interp-status" data-v="${v}" aria-pressed="${s.status === v}">${l}</button>`).join('')}
      </div>
      ${interpTable(d.items, d.canSeeContent, can('owner'))}
      ${d.canSeeContent ? '' : '<p class="faint">Only the Owner can read the dreams, the answers and people\u2019s comments.</p>'}
    </div>`;
}

async function pageCodes(main) {
  const d = await api('codes');
  const fresh = state.newCode;
  state.newCode = null;
  main.innerHTML = `${head('Redeem codes', 'Codes that give Dreaming Plus for a number of days (for testers, gifts and partners).')}
    ${can('manager') ? `<div class="panel"><h3>Make a code</h3>
      <form class="form-row" data-form="code">
        <label class="field"><span>Days of Plus</span><input class="input" name="days" type="number" min="1" max="3650" value="30" inputmode="numeric"></label>
        <label class="field"><span>How many people can use it</span><input class="input" name="uses" type="number" min="1" max="10000" value="1" inputmode="numeric"></label>
        <label class="field"><span>Note (who it is for)</span><input class="input" name="note" maxlength="200" placeholder="e.g. Beta tester Anna"></label>
        <button class="btn btn-gold" type="submit">Make code</button>
      </form>
      ${fresh ? `<div class="secret"><code>${esc(fresh.code)}</code><button class="btn btn-sm" data-act="copy" data-text="${esc(fresh.code)}">Copy</button><span class="faint">Shown only now: copy it. ${num(fresh.days)} days, ${num(fresh.uses)} use(s).</span></div>` : ''}
    </div>` : ''}
    <div class="panel"><div class="table-wrap"><table>
      <thead><tr><th>Code</th><th class="num">Days</th><th class="num">Uses left</th><th>Note</th><th>Made by</th><th>Made</th><th></th></tr></thead>
      <tbody>${d.items.map((c) => `<tr>
        <td class="mono nowrap">${c.hint ? `DREAM-…${esc(c.hint)}` : '<span class="faint">older code</span>'}${c.disabled_at ? ' <span class="badge bad">Off</span>' : c.uses_left < 1 ? ' <span class="badge">Used up</span>' : ''}</td>
        <td class="num">${num(c.days)}</td>
        <td class="num">${num(c.uses_left)}${c.uses_total ? ` / ${num(c.uses_total)}` : ''}</td>
        <td>${esc(c.note || '')}</td><td>${esc(c.created_by || '–')}</td><td class="nowrap">${esc(when(c.created_at))}</td>
        <td>${can('manager') && c.uses_left > 0 && !c.disabled_at ? `<button class="btn btn-sm" data-act="code-off" data-id="${esc(c.code_hash)}">Turn off</button>` : ''}</td>
      </tr>`).join('') || '<tr><td colspan="7" class="empty">No codes yet.</td></tr>'}</tbody>
    </table></div></div>`;
}

async function pageLibrary(main) {
  const d = await api('library');
  const list = (items, empty) => (items.length ? items.map((r) => meterRow(r.name, r.hits, items[0].hits, num(r.hits))).join('') : `<p class="empty">${empty}</p>`);
  main.innerHTML = `${head('Symbol library', 'What people look up when they tap a symbol in the app (a daily count per word; nothing about who).')}
    <div class="grid grid-kpi">
      ${kpi('Entries in the library', num(d.entries))}
      ${kpi('Lookups, last 30 days', num(d.month.hits), `${num(d.month.names)} different words`)}
    </div>
    <div class="grid grid-2">
      <div class="panel"><h3>Most looked up</h3>${list(d.top, 'No lookups yet.')}</div>
      <div class="panel"><h3>Looked for but missing</h3><p class="faint">Good candidates to add to the library next.</p>${list(d.missing, 'Nothing missing so far.')}</div>
    </div>`;
}

async function pagePlans(main) {
  const d = await api('plans');
  const planCard = (id) => {
    const p = d.plans[id];
    return `<div class="panel"><h2>${esc(p.label)}</h2><dl class="kv">
      <dt>AI pictures</dt><dd>${num(p.limits.images)} a month</dd>
      <dt>Interpretations</dt><dd>${num(p.limits.analyses)} a month</dd>
      <dt>Video credits</dt><dd>${num(p.limits.videos || 0)} a month</dd>
      <dt>Features</dt><dd>${esc((p.features || []).join(', '))}</dd>
    </dl></div>`;
  };
  const pr = d.prices || {};
  main.innerHTML = `${head('Plans & limits', 'What each plan includes and the daily safety limits. Changing them is done on the server (ask C++).')}
    <div class="grid grid-2">${Object.keys(d.plans).map(planCard).join('')}</div>
    <div class="grid grid-2">
      <div class="panel"><h3>Prices shown in the app</h3><dl class="kv">
        ${['monthly', 'yearly'].filter((k) => pr[k]).map((k) => `<dt>${esc(pr[k].label || k)}</dt><dd>${esc(pr.currency || '')} ${num(pr[k].amount, 2)}</dd>`).join('')}
        <dt>Free trial</dt><dd>${num(pr.trialDays)} days</dd>
        <dt>Payments</dt><dd>${d.paymentsEnabled ? '<span class="badge good">On</span>' : '<span class="badge warn">Not connected yet</span>'}</dd>
      </dl></div>
      <div class="panel"><h3>Daily safety limits</h3><dl class="kv">
        ${Object.entries(d.budget).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${num(v)}</dd>`).join('') || '<dt>–</dt><dd>none set</dd>'}
      </dl></div>
      <div class="panel"><h3>AI services in order</h3><dl class="kv">
        <dt>Pictures</dt><dd>${esc((d.images?.providers || []).map((p) => `${p.name || p.provider} ${p.model || ''}`).join(' → ') || '–')}</dd>
        <dt>Videos</dt><dd>${esc((d.videos?.providers || []).map((p) => `${p.name || p.provider} ${p.model || ''}`).join(' → ') || '–')}</dd>
        <dt>Picture look</dt><dd>${esc(d.images?.look || '–')}</dd>
      </dl></div>
    </div>`;
}

async function pageSystem(main) {
  const d = await api('system');
  const disk = d.storage.disk;
  main.innerHTML = `${head('Server health', 'The Dreaming server, its database and storage, and the latest errors.')}
    <div class="grid grid-kpi">
      ${kpi('Server', `v${esc(d.server.version)}`, `running for ${esc(secs(d.server.uptimeSeconds))} · Node ${esc(d.server.node)}`)}
      ${kpi('Memory', bytes(d.server.memoryBytes))}
      ${kpi('Database', bytes(d.database.bytes))}
      ${kpi('Live app', d.app ? `v${num(d.app.version)}` : '–', d.app ? esc(d.app.updated) : 'could not reach GitHub')}
    </div>
    <div class="grid grid-2">
      <div class="panel"><h3>Storage</h3>
        ${meterRow('AI pictures', d.storage.images.bytes, disk ? disk.total : d.storage.images.bytes, `${num(d.storage.images.files)} files · ${bytes(d.storage.images.bytes)}`)}
        ${meterRow('AI videos', d.storage.videos.bytes, disk ? disk.total : d.storage.videos.bytes, `${num(d.storage.videos.files)} files · ${bytes(d.storage.videos.bytes)}`)}
        ${disk ? meterRow('Disk used', disk.total - disk.free, disk.total, `${bytes(disk.free)} free of ${bytes(disk.total)}`) : ''}
      </div>
      <div class="panel"><h3>AI service keys</h3><dl class="kv">
        <dt>poyo.ai</dt><dd>${d.providers.poyo ? '<span class="badge good">Set</span>' : '<span class="badge bad">Missing</span>'}</dd>
        <dt>fal.ai</dt><dd>${d.providers.fal ? '<span class="badge good">Set</span>' : '<span class="badge bad">Missing</span>'}</dd>
      </dl><p class="faint">Only whether a key is set; keys are never shown.</p></div>
      <div class="panel"><h3>App versions in use (last 30 days)</h3>
        ${d.appVersions.length ? d.appVersions.map((v) => meterRow(v.version === 'unknown' ? 'Not reported (older app)' : `v${v.version}`, v.users, d.appVersions[0].users, `${num(v.users)} users`)).join('') : '<p class="empty">No data yet.</p>'}
      </div>
      <div class="panel"><h3>Database tables</h3><dl class="kv">${d.database.tables.map((t) => `<dt>${esc(t.name)}</dt><dd>${num(t.rows)} rows</dd>`).join('')}</dl></div>
    </div>
    <div class="panel"><h3>Latest server errors</h3>
      ${d.errors.length ? `<div class="table-wrap"><table><thead><tr><th>When</th><th>Where</th><th>Error</th></tr></thead><tbody>${d.errors.map((e) => `<tr><td class="nowrap">${esc(when(e.at))}</td><td class="mono">${esc(e.where)}</td><td class="err-text">${esc(e.message)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="empty">No errors since the server last started.</p>'}
    </div>`;
}

async function pageTeam(main) {
  const d = await api('staff');
  const fresh = state.newInvite;
  state.newInvite = null;
  main.innerHTML = `${head('Team', 'Who can open this dashboard and what each person can do.')}
    <div class="panel"><h3>Invite someone</h3>
      <form class="form-row" data-form="invite">
        <label class="field"><span>Their email</span><input class="input" name="email" type="email" required autocomplete="off"></label>
        <label class="field"><span>Name</span><input class="input" name="name" autocomplete="off"></label>
        <label class="field"><span>Role</span><select class="input" name="role">
          <option value="viewer">Viewer: looks only</option><option value="manager">Manager: can change accounts and codes</option><option value="owner">Owner: everything</option>
        </select></label>
        <button class="btn btn-gold" type="submit">Make invitation link</button>
      </form>
      ${fresh ? `<div class="secret"><code>${esc(fresh.link)}</code><button class="btn btn-sm" data-act="copy" data-text="${esc(fresh.link)}">Copy link</button>
        <span class="faint">Send this link to ${esc(fresh.email)} yourself (message or email). It works once, for ${num(fresh.expiresInDays)} days. They choose their own password.</span></div>` : ''}
      <ul class="faint">${Object.entries(ROLE_LINES).map(([r, l]) => `<li><b>${ROLE_NAMES[r]}</b>: ${esc(l)}</li>`).join('')}</ul>
    </div>
    <div class="panel"><h3>Members</h3><div class="table-wrap"><table>
      <thead><tr><th>Name</th><th>Role</th><th>Last sign-in</th><th>Status</th><th></th></tr></thead>
      <tbody>${d.staff.map((t) => `<tr>
        <td>${esc(t.name)}${t.id === d.you ? ' <span class="faint">(you)</span>' : ''}<div class="faint">${esc(t.email)}</div></td>
        <td><select class="input" data-act="role" data-id="${esc(t.id)}" aria-label="Role of ${esc(t.name)}">${Object.keys(ROLE_NAMES).map((r) => `<option value="${r}" ${t.role === r ? 'selected' : ''}>${ROLE_NAMES[r]}</option>`).join('')}</select></td>
        <td class="nowrap">${esc(ago(t.last_login))}</td>
        <td>${t.disabled ? '<span class="badge bad">Off</span>' : '<span class="badge good">Active</span>'}</td>
        <td>${t.id === d.you ? '' : `<button class="btn btn-sm ${t.disabled ? '' : 'btn-danger'}" data-act="member-toggle" data-id="${esc(t.id)}" data-off="${t.disabled ? '0' : '1'}">${t.disabled ? 'Turn on' : 'Turn off'}</button>`}</td>
      </tr>`).join('')}</tbody>
    </table></div></div>
    ${d.invites.length ? `<div class="panel"><h3>Invitations not used yet</h3><div class="table-wrap"><table>
      <thead><tr><th>Email</th><th>Role</th><th>Expires</th><th></th></tr></thead>
      <tbody>${d.invites.map((i) => `<tr><td>${esc(i.email)}</td><td>${esc(ROLE_NAMES[i.role])}</td><td class="nowrap">${esc(when(i.expires_at))}</td><td><button class="btn btn-sm" data-act="invite-cancel" data-id="${esc(i.token_hash)}">Cancel</button></td></tr>`).join('')}</tbody>
    </table></div></div>` : ''}`;
}

const ACTION_NAMES = {
  login: 'Signed in', 'login-failed': 'Failed sign-in', logout: 'Signed out', joined: 'Joined the team', invited: 'Invited',
  'cancelled-invite': 'Cancelled an invitation', 'changed-member': 'Changed a member', 'password-changed': 'Changed their password',
  'gave-plus': 'Gave Plus', 'removed-plus': 'Removed Plus', 'reset-usage': 'Reset monthly usage', 'paused-user': 'Paused an account',
  'unpaused-user': 'Unpaused an account', 'created-code': 'Made a redeem code', 'disabled-code': 'Turned off a code',
  'interpretation-release': 'Put an interpretation back', 'interpretation-fail': 'Closed an interpretation', 'interpretation-delete': 'Deleted an interpretation',
};
async function pageActivity(main) {
  const d = await api('audit?limit=300');
  main.innerHTML = `${head('Activity log', 'Every sign-in and every change made in this dashboard, with who did it.')}
    <div class="panel"><div class="table-wrap"><table>
      <thead><tr><th>When</th><th>Who</th><th>What</th><th>On</th><th>Details</th></tr></thead>
      <tbody>${d.items.map((a) => `<tr>
        <td class="nowrap">${esc(when(a.at))}</td><td>${esc(a.staff_email)}</td>
        <td>${a.action === 'login-failed' ? '<span class="badge bad">Failed sign-in</span>' : esc(ACTION_NAMES[a.action] || a.action)}</td>
        <td>${a.target && /^dv/.test(a.target) ? `<a class="mono" href="#/user/${esc(a.target)}">${esc(short(a.target))}</a>` : esc(a.target || '')}</td>
        <td class="faint">${a.details ? esc(Object.entries(a.details).map(([k, v]) => `${k}: ${typeof v === 'string' && /T\d\d:/.test(v) ? when(v) : v}`).join(', ')) : ''}</td>
      </tr>`).join('') || '<tr><td colspan="5" class="empty">Nothing yet.</td></tr>'}</tbody>
    </table></div></div>`;
}

function pageAccount(main) {
  main.innerHTML = `${head('My account', `${esc(me.name)} · ${esc(me.email)} · <span class="badge role-${esc(me.role)}">${esc(ROLE_NAMES[me.role])}</span>`)}
    <div class="panel"><h3>Change my password</h3>
      <form data-form="password" novalidate>
        <input class="sr" name="username" type="email" autocomplete="username" value="${esc(me.email)}" tabindex="-1" aria-hidden="true">
        <label class="field"><span>Current password</span><input class="input" name="current" type="password" autocomplete="current-password" required></label>
        <label class="field"><span>New password (at least 10 characters)</span><input class="input" name="next" type="password" autocomplete="new-password" minlength="10" required></label>
        <p class="err" data-err></p>
        <button class="btn btn-gold" type="submit">Change password</button>
      </form>
      <p class="faint">Changing it signs you out everywhere else.</p>
    </div>
    <div class="panel"><button class="btn" data-act="logout">Sign out</button></div>`;
}

// ---- Router ----

const ROUTES = {
  overview: pageOverview, users: pageUsers, ai: pageAI, interpretations: pageInterpretations, codes: pageCodes,
  library: pageLibrary, plans: pagePlans, system: pageSystem, team: pageTeam, activity: pageActivity,
};

async function route() {
  const hash = location.hash || '';
  if (hash.startsWith('#invite=')) return showInvite(hash.slice(8));
  if (!me) {
    try { ({ me } = await api('me')); } catch (err) {
      if (err.status === 401) return showLogin();
      app.innerHTML = `<main class="auth"><div class="auth-card"><p>${esc(err.message)}</p><button class="btn" data-act="retry">Try again</button></div></main>`;
      return null;
    }
  }
  const [, page = 'overview', arg] = /^#\/([\w-]+)(?:\/(.+))?$/.exec(hash) || [];
  const allowed = PAGES.find(([id]) => id === page);
  const current = page === 'user' ? 'users' : allowed && can(allowed[2]) ? page : page === 'account' ? 'account' : 'overview';
  const main = shell(current);
  try {
    if (page === 'user' && arg) await pageUser(main, decodeURIComponent(arg));
    else if (current === 'account') pageAccount(main);
    else await ROUTES[current](main);
    // Refresh the menu's waiting count without redrawing the page.
    const link = app.querySelector('.nav a[href="#/interpretations"]');
    if (link && navCounts.interpretations && !link.querySelector('.count')) link.insertAdjacentHTML('beforeend', `<span class="count">${navCounts.interpretations}</span>`);
  } catch (err) {
    if (err.status === 401) { me = null; return showLogin('Please sign in again.'); }
    main.innerHTML = `<div class="panel"><p>${esc(err.message)}</p><button class="btn" data-act="retry">Try again</button></div>`;
  }
  return null;
}

window.addEventListener('hashchange', () => { route(); window.scrollTo(0, 0); });

// ---- Forms ----

app.addEventListener('submit', async (ev) => {
  const form = ev.target.closest('form[data-form]');
  if (!form) return;
  ev.preventDefault();
  const f = Object.fromEntries(new FormData(form));
  const errEl = form.querySelector('[data-err]');
  const btn = form.querySelector('button[type=submit]');
  const fail = (msg) => { if (errEl) errEl.textContent = msg; else toast(msg, true); };
  btn && (btn.disabled = true);
  try {
    switch (form.dataset.form) {
      case 'login':
        ({ me } = await api('login', { method: 'POST', body: { email: f.email, password: f.password } }));
        location.hash = '#/overview';
        await route();
        break;
      case 'accept':
        if (f.password !== f.again) { fail('The two passwords are not the same.'); break; }
        ({ me } = await api('accept', { method: 'POST', body: { token: f.token, name: f.name, password: f.password } }));
        history.replaceState(null, '', location.pathname + '#/overview');
        await route();
        toast('Welcome! Your login is ready.');
        break;
      case 'password':
        await api('password', { method: 'POST', body: { current: f.current, next: f.next } });
        form.reset();
        toast('Password changed');
        break;
      case 'user-search':
        Object.assign(state.users, { q: f.q.trim(), sort: f.sort, offset: 0 });
        await route();
        break;
      case 'code':
        state.newCode = await api('codes', { method: 'POST', body: { days: f.days, uses: f.uses, note: f.note } });
        await route();
        break;
      case 'invite':
        state.newInvite = await api('staff/invite', { method: 'POST', body: { email: f.email, name: f.name, role: f.role } });
        await route();
        break;
      default:
    }
  } catch (err) {
    fail(err.message);
  } finally {
    if (btn && btn.isConnected) btn.disabled = false;
  }
});

// ---- Buttons ----

app.addEventListener('click', async (ev) => {
  const row = ev.target.closest('tr[data-href]');
  if (row && !ev.target.closest('a, button')) { location.hash = row.dataset.href; return; }
  const b = ev.target.closest('[data-act]');
  if (!b || b.tagName === 'SELECT') return;
  const act = b.dataset.act;
  const run = async (fn, done) => {
    b.disabled = true;
    try { await fn(); if (done) toast(done); await route(); } catch (err) { toast(err.message, true); b.disabled = false; }
  };
  switch (act) {
    case 'logout':
      try { await api('logout', { method: 'POST' }); } catch {}
      me = null;
      location.hash = '';
      showLogin();
      break;
    case 'retry': route(); break;
    case 'copy': copy(b.dataset.text); break;
    case 'page': state[b.dataset.key === 'users' ? 'users' : b.dataset.key === 'ai' ? 'ai' : 'interp'].offset = Number(b.dataset.to); route(); break;
    case 'users-plan': Object.assign(state.users, { plan: b.dataset.v, offset: 0 }); route(); break;
    case 'ai-kind': Object.assign(state.ai, { kind: b.dataset.v, status: '', offset: 0 }); route(); break;
    case 'ai-status': Object.assign(state.ai, { status: b.dataset.v, offset: 0 }); route(); break;
    case 'interp-status': Object.assign(state.interp, { status: b.dataset.v, offset: 0 }); route(); break;
    case 'user-plus': {
      const days = Number(document.getElementById('plus-days')?.value) || 30;
      if (!confirm(`Give this account ${days} days of Dreaming Plus?`)) return;
      run(() => api(`users/${b.dataset.id}/plus`, { method: 'POST', body: { days } }), `Gave ${days} days of Plus`);
      break;
    }
    case 'user-free':
      if (!confirm('Remove Dreaming Plus from this account now?')) return;
      run(() => api(`users/${b.dataset.id}/free`, { method: 'POST', body: {} }), 'Plus removed');
      break;
    case 'user-reset':
      if (!confirm('Reset this month\u2019s usage (pictures, interpretations, video credits) to zero?')) return;
      run(() => api(`users/${b.dataset.id}/reset-usage`, { method: 'POST', body: {} }), 'Usage reset');
      break;
    case 'user-block': {
      const reason = prompt('Pause this account? It will not be able to make AI pictures, videos or interpretations.\n\nReason (for the log):', '');
      if (reason === null) return;
      run(() => api(`users/${b.dataset.id}/block`, { method: 'POST', body: { reason } }), 'Account paused');
      break;
    }
    case 'user-unblock':
      run(() => api(`users/${b.dataset.id}/unblock`, { method: 'POST', body: {} }), 'Account unpaused');
      break;
    case 'code-off':
      if (!confirm('Turn this code off? Nobody will be able to use it any more.')) return;
      run(() => api(`codes/${b.dataset.id}/disable`, { method: 'POST', body: {} }), 'Code turned off');
      break;
    case 'interp': {
      const words = { release: 'Put this dream back in the waiting list?', fail: 'Close this request without an answer?', delete: 'Delete this request and its answer for good?' };
      if (!confirm(words[b.dataset.do])) return;
      run(() => api(`interpretations/${b.dataset.id}/${b.dataset.do}`, { method: 'POST', body: {} }), 'Done');
      break;
    }
    case 'member-toggle':
      if (b.dataset.off === '1' && !confirm('Turn off this member\u2019s login? They will be signed out.')) return;
      run(() => api(`staff/${b.dataset.id}`, { method: 'POST', body: { disabled: b.dataset.off === '1' } }), 'Saved');
      break;
    case 'invite-cancel':
      run(() => api(`staff/invites/${b.dataset.id}/cancel`, { method: 'POST', body: {} }), 'Invitation cancelled');
      break;
    default:
  }
});

app.addEventListener('change', async (ev) => {
  const sel = ev.target.closest('select[data-act="role"]');
  if (!sel) return;
  if (!confirm(`Change this member\u2019s role to ${ROLE_NAMES[sel.value]}?`)) { route(); return; }
  try {
    await api(`staff/${sel.dataset.id}`, { method: 'POST', body: { role: sel.value } });
    toast('Role changed');
  } catch (err) {
    toast(err.message, true);
  }
  route();
});

route();
