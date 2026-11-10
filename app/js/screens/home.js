// Home: the daily landing page over the night sky.
// Greeting · "Logged today" · last dream + Analyze · big record button (+ voice) · "Get started" checklist ·
// Explore (a random past dream and a random symbol, both unlocked by progress) · recent dreams strip.
import {
  listDreams, withDefaults, loggedToday, getProfile, getSetting, listGoals, SYMBOL_CATEGORIES,
} from '../store.js';
import { exploreState } from '../progress.js';
import { TAGS } from '../analyze.js';
import { esc, greeting, formatDate, formatLongDate, relativeDay, icons } from '../ui.js';
import { dreamArtURL } from '../dreamart.js';

// What the Explore cards currently show. Kept in memory only (a fresh pick per app launch, shuffle re-rolls).
const picked = { dream: null, symbol: null };

const CATEGORY_LABEL = {
  people: 'Person', objects: 'Object', characters: 'Character', places: 'Place', themes: 'Theme', actions: 'Action',
};

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// ---------- pictures ----------

/** The dream's generated picture, or a soft gradient if it can't be drawn. */
function picture(dream, px, cls) {
  let url = '';
  try { url = dreamArtURL(dream, px) || ''; } catch { url = ''; }
  if (url) return `<img class="${cls}" src="${esc(url)}" alt="" decoding="async">`;
  const hue = (Number(dream.seed) || 0) % 360;
  return `<div class="${cls} home-art-fallback" style="--h:${hue}"></div>`;
}

function starMark(dream) {
  if (!dream.lucid && !dream.recurring) return '';
  const label = [dream.lucid && 'Lucid', dream.recurring && 'Recurring'].filter(Boolean).join(', ');
  return `<span class="star-mark" role="img" aria-label="${label}" title="${label}">${icons.star}</span>`;
}

function chips(dream, max = 2) {
  return (dream.tags || [])
    .filter((id) => TAGS[id])
    .slice(0, max)
    .map((id) => `<span class="chip" style="--hue:${TAGS[id].hue}">${esc(TAGS[id].label)}</span>`)
    .join('');
}

function when(dream) {
  const rel = relativeDay(dream.date);
  const abs = formatDate(dream.date);
  return rel && rel !== abs ? `${rel} · ${abs}` : abs;
}

// Crescent moon, a few stars and a soft cloud: the empty-journal illustration.
const EMPTY_ART = `
  <svg class="home-empty-art" viewBox="0 0 240 150" aria-hidden="true">
    <defs>
      <radialGradient id="home-moon-glow" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stop-color="#ffd98a" stop-opacity="0.35"/>
        <stop offset="100%" stop-color="#ffd98a" stop-opacity="0"/>
      </radialGradient>
      <linearGradient id="home-moon-fill" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#fff0c8"/>
        <stop offset="100%" stop-color="#ffd98a"/>
      </linearGradient>
      <linearGradient id="home-cloud-fill" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#c9b6ff" stop-opacity="0.55"/>
        <stop offset="100%" stop-color="#ff9f8f" stop-opacity="0.35"/>
      </linearGradient>
      <mask id="home-crescent">
        <rect width="240" height="150" fill="#fff"/>
        <circle cx="137" cy="52" r="30" fill="#000"/>
      </mask>
    </defs>
    <circle cx="120" cy="64" r="58" fill="url(#home-moon-glow)"/>
    <circle cx="120" cy="64" r="32" fill="url(#home-moon-fill)" mask="url(#home-crescent)"/>
    <g fill="#f0eaff">
      <circle cx="44" cy="30" r="1.6" opacity="0.8"/>
      <circle cx="70" cy="62" r="1.1" opacity="0.6"/>
      <circle cx="190" cy="26" r="1.4" opacity="0.75"/>
      <circle cx="206" cy="70" r="1" opacity="0.5"/>
      <circle cx="168" cy="96" r="1.2" opacity="0.55"/>
      <circle cx="28" cy="88" r="1" opacity="0.45"/>
    </g>
    <g fill="#ffd98a" opacity="0.9">
      <path d="M176 44l1.6 4 4 1.6-4 1.6-1.6 4-1.6-4-4-1.6 4-1.6z"/>
      <path d="M58 40l1.2 3 3 1.2-3 1.2-1.2 3-1.2-3-3-1.2 3-1.2z"/>
    </g>
    <path class="home-empty-cloud" fill="url(#home-cloud-fill)"
      d="M62 128c-11 0-18-7-18-15s7-14 16-14c3-11 13-18 25-18 11 0 20 6 24 15 3-2 7-3 11-3 11 0 19 8 19 18 0 1 0 2-.2 3 7 1 12 7 12 14z" transform="translate(22 0)"/>
  </svg>`;

// ---------- 1. greeting ----------

function header(now, name, today) {
  const hello = name
    ? `${esc(greeting(now))}, <span class="home-name">${esc(name)}</span>`
    : esc(greeting(now));
  return `
    <header class="home-top">
      <h1 class="home-greeting">${hello}</h1>
      <p class="home-date">${esc(formatLongDate(now))}</p>
      ${today ? `<p class="home-today">${icons.check}<span>Logged today</span></p>` : ''}
    </header>`;
}

// ---------- 2. last dream + Analyze, or the first-dream invitation ----------

function lead(dreams, today) {
  const last = dreams[0];
  if (!last) {
    return `
      <section class="home-intro" aria-label="Welcome">
        ${EMPTY_ART}
        <p class="home-headline">Write down any dream you remember, from last night or from years ago.</p>
      </section>`;
  }
  return `
    ${today ? '' : '<p class="home-headline home-headline-small">Anything left from last night? Even a fragment is worth keeping.</p>'}
    <a class="glass home-hero" href="#dream/${esc(last.id)}" aria-label="Your last dream: ${esc(last.title || 'Untitled dream')}">
      ${picture(last, 340, 'home-hero-art')}
      <div class="home-hero-body">
        <h2 class="home-hero-title">${esc(last.title || 'Untitled dream')} ${starMark(last)}</h2>
        <div class="home-hero-meta">
          <span class="home-hero-when">${esc(when(last))}</span>
          ${chips(last)}
        </div>
      </div>
    </a>
    <a class="btn btn-ghost home-analyze" href="#dream/${esc(last.id)}/analyze">${icons.sparkle}<span>Analyze this dream</span></a>`;
}

// ---------- 3. the record action ----------

function action(hasDreams) {
  return `
    <div class="home-action">
      <a class="btn home-record" href="#record">${icons.plus}<span>${hasDreams ? 'Add another dream' : 'Add a dream'}</span></a>
      <a class="home-voice" href="#record/voice" aria-label="Record a dream by voice">${icons.mic}</a>
    </div>`;
}

// ---------- 4. "Get started" checklist ----------

function steps(dreams) {
  return [
    { done: dreams.length > 0, href: '#record', icon: icons.edit, label: 'Write down your first dream' },
    { done: Boolean(getSetting('reminderMorning', false)), href: '#profile/notifications', icon: icons.bell, label: 'Turn on a morning reminder' },
    { done: Boolean(getSetting('realityReminders', false)), href: '#technique/reality-checks', icon: icons.lucidity, label: 'Set up reality-check reminders' },
    { done: listGoals().length > 0, href: '#goals', icon: icons.target, label: 'Choose a dream goal' },
  ];
}

function checklist(dreams) {
  const list = steps(dreams);
  const done = list.filter((s) => s.done).length;
  if (done === list.length) return '';
  const rows = list.map((s) => `
    <li>
      <a class="home-step${s.done ? ' is-done' : ''}" href="${s.href}">
        <span class="home-step-icon">${s.done ? icons.check : s.icon}</span>
        <span class="home-step-label">${esc(s.label)}${s.done ? '<span class="home-sr"> (done)</span>' : ''}</span>
        <span class="home-step-go">${icons.chevronRight}</span>
      </a>
    </li>`).join('');
  return `
    <section class="home-section home-start" aria-labelledby="home-start-title">
      <div class="home-head">
        <h2 class="home-h2" id="home-start-title">Get started</h2>
        <span class="home-count" aria-label="${done} of ${list.length} done">${done}/${list.length}</span>
      </div>
      <div class="home-bar" role="progressbar" aria-label="Get started progress"
        aria-valuemin="0" aria-valuemax="${list.length}" aria-valuenow="${done}">
        <span style="width:${Math.round((done / list.length) * 100)}%"></span>
      </div>
      <ul class="glass home-steps">${rows}</ul>
    </section>`;
}

// ---------- 5. Explore ----------

/** Every distinct symbol: { key, cat, name, count (dreams that contain it) }. */
function symbolIndex(dreams) {
  const map = new Map();
  for (const d of dreams) {
    for (const cat of SYMBOL_CATEGORIES) {
      for (const raw of d.symbols[cat] || []) {
        const name = String(raw ?? '').trim();
        if (!name) continue;
        const key = `${cat}:${name.toLowerCase()}`;
        if (!map.has(key)) map.set(key, { key, cat, name, ids: new Set() });
        map.get(key).ids.add(d.id);
      }
    }
  }
  return [...map.values()].map(({ ids, ...s }) => ({ ...s, count: ids.size }));
}

/** A random item, avoiding `avoid` when there is any other choice. */
function pickFrom(items, avoid) {
  const pool = items.length > 1 ? items.filter((x) => x !== avoid) : items;
  return pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;
}

/** Past dreams for the Explore card: everything but the newest one (already shown at the top), when possible. */
const pastDreams = (dreams) => (dreams.length > 1 ? dreams.slice(1) : dreams);

function chooseDream(dreams, reroll = false) {
  const pool = pastDreams(dreams);
  const ids = pool.map((d) => d.id);
  if (reroll || !ids.includes(picked.dream)) picked.dream = pickFrom(ids, picked.dream);
  return pool.find((d) => d.id === picked.dream) || null;
}

function chooseSymbol(symbols, reroll = false) {
  const keys = symbols.map((s) => s.key);
  if (reroll || !keys.includes(picked.symbol)) picked.symbol = pickFrom(keys, picked.symbol);
  return symbols.find((s) => s.key === picked.symbol) || null;
}

function lockedCard(kind, text) {
  return `
    <div class="home-card home-card-${kind} is-locked" data-card="${kind}">
      <span class="home-card-tag">${kind === 'dream' ? 'Dream' : 'Symbol'}</span>
      <span class="home-lock home-lock-${kind === 'dream' ? 'circle' : 'diamond'}">${icons.lock}</span>
      <span class="home-card-lockline">${esc(text)}</span>
    </div>`;
}

function dreamCard(state, dreams, reroll = false) {
  if (!state.unlocked) return lockedCard('dream', `Unlocks after ${plural(state.unlockAt, 'dream')}`);
  const d = chooseDream(dreams, reroll);
  if (!d) return lockedCard('dream', 'No dreams to show yet');
  return `
    <a class="home-card home-card-dream" data-card="dream" href="#dream/${esc(d.id)}"
      aria-label="A dream from your journal: ${esc(d.title || 'Untitled dream')}, ${esc(relativeDay(d.date))}">
      ${picture(d, 200, 'home-card-art')}
      <span class="home-card-shade"></span>
      <span class="home-card-tag">Dream</span>
      <span class="home-card-foot">
        <span class="home-card-title">${esc(d.title || 'Untitled dream')}</span>
        <span class="home-card-meta">${esc(relativeDay(d.date))}</span>
      </span>
    </a>`;
}

function symbolCard(state, symbols, reroll = false) {
  if (!state.unlocked) return lockedCard('symbol', `Unlocks after ${plural(state.unlockAt, 'symbol')}`);
  const s = chooseSymbol(symbols, reroll);
  if (!s) return lockedCard('symbol', 'No symbols to show yet');
  return `
    <div class="home-card home-card-symbol" data-card="symbol">
      <span class="home-card-tag">Symbol</span>
      <span class="home-glyph">${icons.sparkle}</span>
      <span class="home-card-foot">
        <span class="home-card-title home-symbol-name">${esc(s.name)}</span>
        <span class="home-card-meta">${esc(CATEGORY_LABEL[s.cat] || s.cat)}</span>
        <span class="home-card-meta home-card-count">In ${esc(plural(s.count, 'dream'))}</span>
      </span>
    </div>`;
}

function explore(state, dreams, symbols) {
  const anyLocked = !state.dream.unlocked || !state.symbol.unlocked;
  return `
    <section class="home-section home-explore" aria-labelledby="home-explore-title">
      <h2 class="home-h2" id="home-explore-title">Explore</h2>
      <p class="home-sub">A dream and a symbol drawn at random from your own journal.</p>
      <div class="home-cards">
        ${dreamCard(state.dream, dreams)}
        ${symbolCard(state.symbol, symbols)}
      </div>
      ${anyLocked ? '<p class="home-caption">More of your journal opens up here as it grows.</p>' : ''}
      <div class="home-shuffles">
        <button type="button" class="btn btn-ghost home-shuffle" data-shuffle="dream" ${state.dream.unlocked ? '' : 'disabled'}>
          ${icons.shuffle}<span>Random dream</span>
        </button>
        <button type="button" class="btn btn-ghost home-shuffle" data-shuffle="symbol" ${state.symbol.unlocked ? '' : 'disabled'}>
          ${icons.shuffle}<span>Random symbol</span>
        </button>
      </div>
    </section>`;
}

// ---------- 6. recent dreams strip ----------

function recent(dreams) {
  const list = dreams.slice(1, 9);
  if (!list.length) return '';
  const thumbs = list.map((d) => `
    <a class="home-thumb" href="#dream/${esc(d.id)}" aria-label="${esc(d.title || 'Untitled dream')}, ${esc(relativeDay(d.date))}">
      ${picture(d, 96, 'home-thumb-art')}
      ${d.lucid || d.recurring ? `<span class="home-thumb-star">${starMark(d)}</span>` : ''}
    </a>`).join('');
  return `
    <section class="home-section home-recent" aria-labelledby="home-recent-title">
      <div class="home-head">
        <h2 class="home-h2" id="home-recent-title">Recent dreams</h2>
        <a class="home-see-all" href="#journal">See all</a>
      </div>
      <div class="home-strip">${thumbs}</div>
    </section>`;
}

export default {
  id: 'home',
  label: 'Home',
  icon: icons.home,

  render(el) {
    const dreams = listDreams().map(withDefaults);
    const name = String(getProfile()?.name ?? '').trim();
    const now = new Date();
    const today = loggedToday();
    const symbols = symbolIndex(dreams);
    const state = exploreState(dreams.length);

    el.innerHTML = `
      <div class="home">
        ${header(now, name, today)}
        ${lead(dreams, today)}
        ${action(dreams.length > 0)}
        ${checklist(dreams)}
        ${explore(state, dreams, symbols)}
        ${recent(dreams)}
      </div>`;

    // Listeners live on our own root (the screen element is shared with other screens).
    const root = el.querySelector('.home');
    root.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-shuffle]');
      if (!btn || btn.disabled) return;
      const kind = btn.dataset.shuffle;
      const card = root.querySelector(`[data-card="${kind}"]`);
      if (!card) return;
      const fresh = listDreams().map(withDefaults);
      const html = kind === 'dream'
        ? dreamCard(exploreState(fresh.length).dream, fresh, true)
        : symbolCard(exploreState(fresh.length).symbol, symbolIndex(fresh), true);
      const tpl = document.createElement('template');
      tpl.innerHTML = html.trim();
      const next = tpl.content.firstElementChild;
      next.classList.add('is-new');
      card.replaceWith(next);
    });
  },
};
