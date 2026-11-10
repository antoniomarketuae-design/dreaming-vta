// Lucidity: the lucid-dreaming hub. Dream goals, techniques that unlock as dreams are logged,
// sleep sounds and binaural beats generated on the phone (js/audio.js), and short articles.
// Touches document/storage only inside render, handlers and badge(), never at import time.
import { listGoals, addGoal, updateGoal, isSeen, markSeen, getSetting, setSetting } from '../store.js';
import { TECHNIQUES, unlockState, dreamCount } from '../progress.js';
import { esc, icons } from '../ui.js';
import { TECHNIQUE_CONTENT, techniqueGlyph } from '../content/techniques.js';
import { ARTICLES } from '../content/articles.js';
import * as audio from '../audio.js';

// The tab dot clears once the tab has been opened after an unlock; the card's NEW tag stays until the guide is opened.
const listedKey = (id) => `lucidity-tab:${id}`;
const seenKey = (id) => `technique:${id}`;
const GOALS_OPEN = 'lucidityGoalsOpen';
const SCROLL_KEY = 'dreaming.lucidityScroll';
const SUB_ROUTES = ['#technique/', '#article/', '#goals'];

const svg = (body, fill = 'none') => `<svg viewBox="0 0 24 24" fill="${fill}" stroke="${fill === 'none' ? 'currentColor' : 'none'}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const PLAY = svg('<path d="M8 5.2v13.6L19 12z"/>', 'currentColor');
const PAUSE = svg('<rect x="6.5" y="5" width="4" height="14" rx="1.2"/><rect x="13.5" y="5" width="4" height="14" rx="1.2"/>', 'currentColor');
const CIRCLE_PLUS = svg('<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>');
const SOUND_ART = {
  rain: svg('<path d="M7 14a4.5 4.5 0 0 1 .6-9 5.5 5.5 0 0 1 10.3 1.6A3.8 3.8 0 0 1 17.5 14z"/><path d="M8 17.5l-1 2.5M12 17.5l-1 2.5M16 17.5l-1 2.5"/>'),
  ocean: svg('<path d="M2.5 9c2 0 2-1.8 4-1.8S8.5 9 10.5 9s2-1.8 4-1.8 2 1.8 4 1.8 2-1.8 3-1.8"/><path d="M2.5 14c2 0 2-1.8 4-1.8s2 1.8 4 1.8 2-1.8 4-1.8 2 1.8 4 1.8 2-1.8 3-1.8"/><path d="M2.5 19c2 0 2-1.8 4-1.8s2 1.8 4 1.8 2-1.8 4-1.8 2 1.8 4 1.8 2-1.8 3-1.8"/>'),
  wind: svg('<path d="M3 9h11a3 3 0 1 0-3-3"/><path d="M3 14h15a3 3 0 1 1-3 3"/><path d="M3 19h6"/>'),
  brown: svg('<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>'),
};

let cleanup = [];

function addCleanup(fn) { cleanup.push(fn); }

// ---- Dream goals ----

function goalsSection() {
  const open = getSetting(GOALS_OPEN, true);
  const goals = listGoals();
  const top = [...goals].sort((a, b) => Number(a.done) - Number(b.done)).slice(0, 3);
  const body = goals.length
    ? `<ul class="glass luc-goal-list">${top.map((g) => `
        <li class="luc-goal${g.done ? ' is-done' : ''}">
          <button type="button" class="luc-goal-tick" data-goal-tick="${esc(g.id)}" aria-pressed="${g.done ? 'true' : 'false'}" aria-label="${g.done ? 'Mark as not done' : 'Mark as done'}">${g.done ? icons.check : ''}</button>
          <span class="luc-goal-text">${esc(g.text)}</span>
        </li>`).join('')}
      </ul>`
    : `<div class="glass luc-goals-intro">
        <p>Write down what you want to do once you realise you are dreaming. A clear wish makes it more likely you notice the dream, and gives you a plan when it happens.</p>
        <p class="luc-goals-ideas-title">Some ideas</p>
        <ul class="luc-goals-ideas">
          <li>Fly above the clouds at sunrise</li>
          <li>Breathe underwater and explore a reef</li>
          <li>Ask a dream character what they stand for</li>
          <li>Visit a place from your childhood</li>
        </ul>
      </div>`;
  return `
    <section class="luc-goals" aria-label="Dream goals">
      <h2 class="luc-goals-head">
        <button type="button" class="luc-sec-toggle" data-goals-toggle aria-expanded="${open ? 'true' : 'false'}">
          <span class="luc-h2">Dream goals</span>
          ${goals.length ? `<span class="luc-count">${goals.filter((g) => g.done).length}/${goals.length}</span>` : ''}
          <span class="luc-chevron">${icons.chevronRight}</span>
        </button>
      </h2>
      <div class="luc-goals-body"${open ? '' : ' hidden'}>
        ${body}
        <form class="luc-goal-form" data-goal-form hidden>
          <input class="field" name="goal" maxlength="140" placeholder="In my next lucid dream I will…" autocomplete="off" enterkeyhint="done" aria-label="New dream goal">
          <button class="btn luc-goal-save" type="submit">Add</button>
        </form>
        <button type="button" class="glass luc-add-row" data-goal-add>${CIRCLE_PLUS}<span>Add a goal</span></button>
        ${goals.length ? `<a class="luc-see-all" href="#goals">See all${goals.length > 3 ? ` (${goals.length})` : ''} ${icons.chevronRight}</a>` : ''}
      </div>
    </section>`;
}

// ---- Techniques ----

function progressBar(t) {
  const pct = Math.round(Math.max(0, Math.min(1, t.progress)) * 100);
  return `
    <div class="luc-progress">
      <span class="luc-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><i style="width:${pct}%"></i></span>
      <span class="luc-togo">${t.toGo} to go</span>
    </div>`;
}

const threshold = (t) => `<span class="luc-badge">${icons.lock}${t.unlockAt} ${t.unlockAt === 1 ? 'dream' : 'dreams'}</span>`;
const isNew = (t) => t.unlocked && !isSeen(seenKey(t.id));
const newTag = '<span class="luc-new">New</span>';

function wideCard(t) {
  const c = TECHNIQUE_CONTENT[t.id] || {};
  return `
    <a class="glass luc-tech${t.unlocked ? '' : ' is-locked'}${t.isNext ? ' is-next' : ''}" href="#technique/${esc(t.id)}" style="--h:${c.hue ?? 268}">
      <div class="luc-tech-text">
        ${isNew(t) ? newTag : ''}
        <h3 class="luc-tech-name">${esc(t.name)}</h3>
        <p class="luc-tech-line">${esc(c.tagline || '')}</p>
        ${t.unlocked ? '' : threshold(t)}
        ${t.isNext ? progressBar(t) : ''}
      </div>
      <div class="luc-tech-art">${techniqueGlyph(t.id)}</div>
    </a>`;
}

function tileCard(t) {
  const c = TECHNIQUE_CONTENT[t.id] || {};
  return `
    <a class="glass luc-tile${t.unlocked ? '' : ' is-locked'}${t.isNext ? ' is-next' : ''}" href="#technique/${esc(t.id)}" style="--h:${c.hue ?? 268}">
      <div class="luc-tile-top">
        ${isNew(t) ? newTag : t.unlocked ? '' : threshold(t)}
      </div>
      <div class="luc-tile-art">${techniqueGlyph(t.id)}</div>
      <h3 class="luc-tile-name">${esc(t.name)}</h3>
      ${t.isNext ? progressBar(t) : ''}
    </a>`;
}

// "Only the next item of each section shows N to go + a bar", as in each section of the reference.
function sectionState(section, count) {
  return unlockState(TECHNIQUES.filter((t) => t.section === section), count);
}

// ---- Sounds ----

function soundTile(t, st) {
  const on = st.id === t.id && st.playing;
  return `
    <button type="button" class="luc-sound" data-track="${t.id}" aria-pressed="${on ? 'true' : 'false'}" style="--h:${t.hue}">
      <span class="luc-sound-art">${SOUND_ART[t.id] || icons.music}<span class="luc-sound-state">${on ? PAUSE : PLAY}</span></span>
      <span class="luc-sound-name">${esc(t.name)}</span>
      <span class="luc-sound-line">${esc(t.line)}</span>
    </button>`;
}

function beatTile(t, st) {
  const on = st.id === t.id && st.playing;
  return `
    <button type="button" class="glass luc-beat" data-track="${t.id}" aria-pressed="${on ? 'true' : 'false'}">
      <span class="luc-beat-top"><span class="luc-beat-icon">${icons.headphones}</span><span class="luc-beat-state">${on ? PAUSE : PLAY}</span></span>
      <span class="luc-beat-name">${esc(audio.trackTitle(t))}</span>
      <span class="luc-beat-base">${t.base} Hz base tone</span>
      <span class="luc-beat-line">${esc(t.line)}</span>
    </button>`;
}

const TIMER_CHOICES = [0, 15, 30, 60];

function nowPlaying(st) {
  const t = st.id ? audio.getTrack(st.id) : null;
  if (!t) return '';
  const status = st.playing
    ? (st.endsAt ? `Stops in <span data-remaining>${audio.formatRemaining(st.remainingMs)}</span>` : 'Playing')
    : (st.remainingMs != null && st.timerMin ? `Paused · ${audio.formatRemaining(st.remainingMs)} left` : 'Paused');
  return `
    <div class="glass luc-now" role="region" aria-label="Now playing">
      <div class="luc-now-row">
        <span class="luc-now-icon" style="--h:${t.hue ?? 268}">${t.kind === 'binaural' ? icons.headphones : SOUND_ART[t.id]}</span>
        <div class="luc-now-text">
          <b>${esc(audio.trackTitle(t))}</b>
          <span>${status}</span>
        </div>
        <button type="button" class="icon-btn luc-now-btn" data-now="toggle" aria-label="${st.playing ? 'Pause' : 'Play'}">${st.playing ? PAUSE : PLAY}</button>
        <button type="button" class="icon-btn luc-now-btn" data-now="stop" aria-label="Stop">${icons.close}</button>
      </div>
      <div class="luc-now-timer">
        <span class="luc-now-label">Sleep timer</span>
        ${TIMER_CHOICES.map((m) => `<button type="button" class="chip luc-timer" data-timer="${m}" aria-pressed="${st.timerMin === m ? 'true' : 'false'}">${m ? `${m} min` : 'Off'}</button>`).join('')}
      </div>
      ${t.kind === 'binaural' ? `<p class="luc-now-note">${icons.headphones}<span>Headphones needed: each ear hears a different tone.</span></p>` : ''}
    </div>`;
}

// ---- Articles ----

function articleCard(a) {
  return `
    <a class="luc-article" href="#article/${esc(a.id)}" style="--h:${a.hue}">
      <span class="luc-article-art">${icons[a.icon] || icons.book}</span>
      <span class="luc-article-title">${esc(a.title)}</span>
      <span class="luc-article-meta">${a.minutes} min read</span>
    </a>`;
}

// ---- Screen ----

function markListed(count) {
  for (const t of TECHNIQUES) if (count >= t.unlockAt) markSeen(listedKey(t.id));
}

export default {
  id: 'lucidity',
  label: 'Lucidity',
  icon: icons.lucidity,

  badge() {
    const count = dreamCount();
    return TECHNIQUES.some((t) => count >= t.unlockAt && !isSeen(seenKey(t.id)) && !isSeen(listedKey(t.id)));
  },

  render(el, ctx) {
    const count = dreamCount();
    const techs = sectionState('techniques', count);
    const asleep = sectionState('falling-asleep', count);
    const night = sectionState('night-training', count);
    const st = audio.state();
    const canPlay = audio.supported();

    el.innerHTML = `
      <div class="luc">
        <h1 class="screen-title">Lucidity</h1>

        ${goalsSection()}

        <section class="luc-section" aria-label="Techniques">
          <h2 class="luc-h2">Techniques</h2>
          <p class="luc-sub">Keep writing dreams to unlock new techniques.</p>
          <div class="luc-stack">${techs.map(wideCard).join('')}</div>
        </section>

        <section class="luc-section" aria-label="While falling asleep">
          <h2 class="luc-h2">While falling asleep</h2>
          <p class="luc-sub">Methods for the moment between waking and sleep.</p>
          <div class="luc-grid">${asleep.map(tileCard).join('')}</div>
        </section>

        <section class="luc-section" aria-label="Soundtracks">
          <h2 class="luc-h2">Soundtracks</h2>
          <p class="luc-sub">Calm sounds to fall asleep to, made live on your phone. Nothing to download.</p>
          <div class="luc-sounds" data-sounds>${audio.SOUNDSCAPES.map((t) => soundTile(t, st)).join('')}</div>
          ${canPlay ? '' : '<p class="luc-note">Sound is not available in this browser.</p>'}
        </section>

        <section class="luc-section" aria-label="Night training">
          <h2 class="luc-h2">Night training</h2>
          <p class="luc-sub">Longer practice that pays off in the night.</p>
          <div class="luc-stack">${night.map(wideCard).join('')}</div>
        </section>

        <section class="luc-section" aria-label="Binaural beats">
          <h2 class="luc-h2">Binaural beats</h2>
          <p class="luc-sub">Two slightly different tones, one in each ear, are heard as a slow pulse. Use headphones at low volume. Research on their effects is limited, so treat them as a relaxing backdrop.</p>
          <div class="luc-rail" data-beats>${audio.BINAURAL.map((t) => beatTile(t, st)).join('')}</div>
        </section>

        <section class="luc-section" aria-label="Articles">
          <h2 class="luc-h2">Articles</h2>
          <div class="luc-rail">${ARTICLES.map(articleCard).join('')}</div>
        </section>

        <p class="luc-note luc-foot">Sounds play while Dreaming is open. Your iPhone may pause them when the screen locks.</p>
        <div class="luc-now-slot" data-now-slot>${nowPlaying(st)}</div>
      </div>`;

    // Opening the tab clears its dot (the router drew the tab bar just before this render).
    markListed(count);
    try { document.querySelector('#tabbar .tab[data-id="lucidity"] .tab-dot')?.remove(); } catch {}

    const refreshAudio = () => {
      const s = audio.state();
      for (const btn of el.querySelectorAll('[data-track]')) {
        const on = s.id === btn.dataset.track && s.playing;
        btn.setAttribute('aria-pressed', on ? 'true' : 'false');
        const icon = btn.querySelector('.luc-sound-state, .luc-beat-state');
        if (icon) icon.innerHTML = on ? PAUSE : PLAY;
      }
      const slot = el.querySelector('[data-now-slot]');
      if (slot) slot.innerHTML = nowPlaying(s);
      el.querySelector('.luc')?.classList.toggle('has-player', Boolean(s.id));
    };
    refreshAudio();
    addCleanup(audio.onChange(refreshAudio));

    const tick = setInterval(() => {
      const span = el.querySelector('[data-remaining]');
      const s = audio.state();
      if (span && s.endsAt) span.textContent = audio.formatRemaining(s.remainingMs);
    }, 1000);
    addCleanup(() => clearInterval(tick));

    const repaintGoals = () => {
      const sec = el.querySelector('.luc-goals');
      if (sec) sec.outerHTML = goalsSection();
    };

    const onClick = (e) => {
      const target = e.target.closest('button, a');
      if (!target || !el.contains(target)) return;

      if (target.matches('[data-goals-toggle]')) {
        const open = !getSetting(GOALS_OPEN, true);
        setSetting(GOALS_OPEN, open);
        target.setAttribute('aria-expanded', open ? 'true' : 'false');
        el.querySelector('.luc-goals-body').hidden = !open;
        return;
      }
      if (target.matches('[data-goal-add]')) {
        const form = el.querySelector('[data-goal-form]');
        form.hidden = false;
        target.hidden = true;
        form.querySelector('input').focus();
        return;
      }
      if (target.dataset.goalTick) {
        const goal = listGoals().find((g) => g.id === target.dataset.goalTick);
        if (goal) {
          updateGoal(goal.id, { done: !goal.done, doneAt: goal.done ? null : new Date().toISOString() });
          repaintGoals();
          if (!goal.done) ctx.toast('Goal achieved. Well dreamt!');
        }
        return;
      }
      if (target.dataset.track) {
        if (!canPlay) { ctx.toast('Sound is not available in this browser'); return; }
        audio.toggle(target.dataset.track);
        return;
      }
      if (target.dataset.now === 'toggle') {
        const s = audio.state();
        if (s.id) audio.toggle(s.id);
        return;
      }
      if (target.dataset.now === 'stop') { audio.stop(); return; }
      if (target.dataset.timer != null) {
        setSetting('sleepTimerMin', Number(target.dataset.timer));
        audio.setTimer(Number(target.dataset.timer));
      }
    };

    const onSubmit = (e) => {
      if (!e.target.matches('[data-goal-form]')) return;
      e.preventDefault();
      const input = e.target.querySelector('input');
      const text = input.value.trim();
      if (!text) { input.focus(); return; }
      addGoal(text);
      setSetting(GOALS_OPEN, true);
      repaintGoals();
      ctx.toast('Goal added');
    };

    el.addEventListener('click', onClick);
    el.addEventListener('submit', onSubmit);
    addCleanup(() => {
      el.removeEventListener('click', onClick);
      el.removeEventListener('submit', onSubmit);
    });

    // First use: apply the remembered sleep timer (30 minutes unless changed).
    if (!audio.state().id) audio.setTimer(getSetting('sleepTimerMin', 30));

    // Coming back from a guide, an article or the goals list returns to the same place on the page.
    let saved = null;
    try { saved = sessionStorage.getItem(SCROLL_KEY); sessionStorage.removeItem(SCROLL_KEY); } catch {}
    if (saved) requestAnimationFrame(() => window.scrollTo(0, Number(saved) || 0));
  },

  destroy() {
    for (const fn of cleanup) { try { fn(); } catch {} }
    cleanup = [];
    try {
      if (SUB_ROUTES.some((r) => location.hash.startsWith(r))) sessionStorage.setItem(SCROLL_KEY, String(window.scrollY));
      else sessionStorage.removeItem(SCROLL_KEY);
    } catch {}
  },
};
