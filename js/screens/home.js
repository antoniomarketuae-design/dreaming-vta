// Home: a calm morning page over the night sky. Greeting, last dream, one big "record" button.
import { listDreams, getStats, getSetting, setSetting } from '../store.js';
import { TAGS } from '../analyze.js';
import { esc, greeting, formatLongDate, relativeDay, icons } from '../ui.js';
import { dreamArtURL } from '../dreamart.js';

/** The dream's picture, or '' if it can't be drawn (then a soft gradient stands in). */
function art(dream, px) {
  try { return dreamArtURL(dream, px) || ''; } catch { return ''; }
}

function picture(dream, px, cls) {
  const url = art(dream, px);
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

function statsLine() {
  const { total, streak } = getStats();
  if (!total) return '';
  const parts = [`${total} ${total === 1 ? 'dream' : 'dreams'} recorded`];
  if (streak) parts.push(`${streak}-night streak`);
  return `<p class="home-stats">${parts.join(' · ')}</p>`;
}

function hero(dream) {
  if (!dream) {
    return `
      <section class="glass home-hero home-empty" aria-label="Your last dream">
        ${EMPTY_ART}
        <p class="home-empty-text">Your first dream will appear here</p>
      </section>`;
  }
  return `
    <a class="glass home-hero" href="#dream/${esc(dream.id)}" aria-label="Last dream: ${esc(dream.title)}">
      ${picture(dream, 340, 'home-hero-art')}
      <div class="home-hero-body">
        <h2 class="home-hero-title">${esc(dream.title)} ${starMark(dream)}</h2>
        <div class="home-hero-meta">
          <span class="home-hero-when">${esc(relativeDay(dream.date))}</span>
          ${chips(dream)}
        </div>
      </div>
    </a>`;
}

function recent(dreams) {
  if (!dreams.length) return '';
  const thumbs = dreams.map((d) => `
    <a class="home-thumb" href="#dream/${esc(d.id)}" aria-label="${esc(d.title)}, ${esc(relativeDay(d.date))}">
      ${picture(d, 72, 'home-thumb-art')}
      ${d.lucid || d.recurring ? `<span class="home-thumb-star">${starMark(d)}</span>` : ''}
    </a>`).join('');
  return `
    <section class="home-recent">
      <div class="home-recent-head">
        <h2 class="section-title">Recent</h2>
        <a class="home-see-all" href="#journal">See all</a>
      </div>
      <div class="home-strip">${thumbs}</div>
    </section>`;
}

function reminderCard() {
  if (getSetting('reminderAsked', false)) return '';
  return `
    <section class="glass home-reminder" aria-label="Morning reminder">
      <div class="home-reminder-row">
        <span class="home-reminder-icon">${icons.bell}</span>
        <p class="home-reminder-text">Dreams fade within minutes of waking. Want a gentle morning reminder?</p>
      </div>
      <div class="home-reminder-actions">
        <button type="button" class="btn btn-ghost home-reminder-btn" data-reminder="later">Not now</button>
        <button type="button" class="btn home-reminder-btn" data-reminder="set">Set reminder</button>
      </div>
    </section>`;
}

// Crescent moon, a few stars and a soft cloud, in the app's moon-gold / violet / ember palette.
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

export default {
  id: 'home',
  label: 'Home',
  icon: icons.home,

  render(el, ctx) {
    const dreams = listDreams();
    const now = new Date();

    el.innerHTML = `
      <div class="home">
        <header class="home-top">
          <p class="home-greeting">${esc(greeting(now))}</p>
          <p class="home-date">${esc(formatLongDate(now))}</p>
          ${statsLine()}
        </header>

        ${hero(dreams[0])}

        <div class="home-action">
          <a class="btn home-record" href="#record">${icons.mic}<span>Record last night's dream</span></a>
          <a class="home-type" href="#record/type">or type it</a>
        </div>

        ${recent(dreams.slice(1, 8))}
        ${reminderCard()}
      </div>`;

    const card = el.querySelector('.home-reminder');
    if (card) {
      card.querySelector('[data-reminder="set"]').addEventListener('click', () => {
        setSetting('reminderAsked', true);
        ctx.navigate('#profile');
      });
      card.querySelector('[data-reminder="later"]').addEventListener('click', () => {
        setSetting('reminderAsked', true);
        card.remove();
      });
    }
  },
};
