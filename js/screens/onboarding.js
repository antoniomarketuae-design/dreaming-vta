// First launch: a short, forward-only setup (~30 steps) that fills the profile, then Dreaming Plus ("coming soon").
// Single-choice steps move on as soon as an answer is tapped; multi-choice steps show a floating Next once something
// is picked. Every answer is saved right away with setProfile(), and the step index lives in sessionStorage, so a
// reload resumes where the user left off. Nothing here asks the system for any permission.
import { getProfile, setProfile, addGoal, listGoals } from '../store.js';
import { esc, icons, formatLongDate } from '../ui.js';
import { dreamArtPreview } from '../dreamart.js';

const STEP_KEY = 'dreaming.onboarding.step';
const PLUS_FLAG = 'dreaming.plusAfterOnboarding';

/**
 * Picture styles offered at setup (our own names). Stored as profile.artStyle (the id).
 * `filter` is a CSS filter that tints the generated painting from dreamart.js; screens that show dream pictures
 * can apply it, e.g. img.style.filter = ART_STYLES.find((s) => s.id === getProfile().artStyle)?.filter.
 */
export const ART_STYLES = [
  { id: 'moonlit', name: 'Moonlit', note: 'Soft violet nights', filter: 'none' },
  { id: 'rose-dusk', name: 'Rose Dusk', note: 'Pink evening light', filter: 'hue-rotate(55deg) saturate(1.15)' },
  { id: 'ember', name: 'Ember', note: 'Warm firelit tones', filter: 'hue-rotate(110deg) saturate(1.2)' },
  { id: 'aurora', name: 'Aurora', note: 'Green northern glow', filter: 'hue-rotate(-120deg) saturate(1.1)' },
  { id: 'deep-tide', name: 'Deep Tide', note: 'Cool ocean blues', filter: 'hue-rotate(-50deg) brightness(0.94)' },
  { id: 'silver-mist', name: 'Silver Mist', note: 'Quiet black and white', filter: 'grayscale(1) contrast(1.05) brightness(1.1)' },
];

// ---------- Answers (our own wording) ----------

const RECALL = [
  { v: 'daily', e: '🌟', t: 'Most mornings' },
  { v: 'weekly', e: '📅', t: 'About once a week' },
  { v: 'monthly', e: '🌙', t: 'Once a month or so' },
  { v: 'rarely', e: '😴', t: 'Hardly ever' },
];
const GENDER = [
  { v: 'man', t: 'Man' },
  { v: 'woman', t: 'Woman' },
  { v: 'nonbinary', t: 'Non-binary' },
  { v: 'private', t: 'Prefer not to say' },
];
const AGE = [
  { v: 'under-18', t: 'Under 18' },
  { v: '18-24', t: '18–24' },
  { v: '25-34', t: '25–34' },
  { v: '35-44', t: '35–44' },
  { v: '45-54', t: '45–54' },
  { v: '55+', t: '55 or over' },
  { v: 'private', t: 'Prefer not to say' },
];
const FOUND = [
  { v: 'friend', e: '👋', t: 'A friend told me' },
  { v: 'tiktok', e: '🎵', t: 'TikTok' },
  { v: 'instagram', e: '📸', t: 'Instagram' },
  { v: 'facebook', e: '👥', t: 'Facebook' },
  { v: 'youtube', e: '▶️', t: 'YouTube' },
  { v: 'search', e: '🔎', t: 'A web search' },
  { v: 'ai', e: '🤖', t: 'An AI assistant' },
  { v: 'other', e: '✨', t: 'Somewhere else' },
];
const MAIN_GOALS = [
  { v: 'analysis', t: 'Interpret my dreams', d: 'Look for what they might be telling you', tags: ['surreal', 'night'], seed: 4021 },
  { v: 'lucid', t: 'Lucid dreaming', d: 'Notice you are dreaming, then steer', tags: ['flying'], seed: 977 },
  { v: 'journal', t: 'Keep a dream journal', d: 'Remember more of your nights', tags: ['calm', 'nature'], seed: 3310 },
];
const NIGHTMARES = [
  { v: 'never', e: '😌', t: 'Never' },
  { v: 'rarely', e: '🙂', t: 'Rarely' },
  { v: 'sometimes', e: '😕', t: 'Sometimes' },
  { v: 'often', e: '😣', t: 'Often' },
];
const LUCID_EXPERIENCE = [
  { v: 'new', e: '🌱', t: 'Brand new to it', d: 'It hasn’t happened to me yet' },
  { v: 'accidental', e: '🍀', t: 'It happened by itself', d: 'A few times, without trying' },
  { v: 'practising', e: '🧭', t: 'Practising', d: 'I’ve tried a few techniques' },
  { v: 'sometimes', e: '⚡', t: 'Sometimes on purpose', d: 'I can bring one on now and then' },
  { v: 'experienced', e: '🌌', t: 'Experienced', d: 'Lucid dreams are a regular thing' },
];
const JOURNAL_HISTORY = [
  { v: 'never', e: '📝', t: 'Never', d: 'This is my first one' },
  { v: 'lapsed', e: '📖', t: 'Tried, but it didn’t stick', d: 'Keeping it up was the hard part' },
  { v: 'paper', e: '📓', t: 'On paper', d: 'Moving it to my phone' },
  { v: 'app', e: '📱', t: 'In another app', d: 'Trying something new' },
  { v: 'active', e: '⭐', t: 'Every morning already', d: 'I want to go further' },
];
// Ids match TECHNIQUES in progress.js.
const TECHNIQUES_KNOWN = [
  { v: 'reality-checks', e: '✋', t: 'Reality checks' },
  { v: 'wbtb', e: '⏰', t: 'Wake back to bed' },
  { v: 'wild', e: '🌀', t: 'WILD' },
  { v: 'mild', e: '💭', t: 'MILD' },
  { v: 'ssild', e: '👂', t: 'SSILD' },
  { v: 'none', e: '', t: 'None yet' },
];
const GOAL_ROWS = [
  [['🕊️', 'Fly over a city'], ['🌍', 'Visit an impossible world'], ['🎹', 'Play an instrument'], ['💫', 'See someone I miss'], ['🗺️', 'Go on an adventure'], ['🌊', 'Breathe underwater']],
  [['🚀', 'Travel to space'], ['🪄', 'Do real magic'], ['🐉', 'Meet a dragon'], ['🧘', 'Find deep calm'], ['🏔️', 'Climb a mountain'], ['🎨', 'Paint something new']],
];
const PRESET_GOALS = new Set(GOAL_ROWS.flat().map(([, t]) => t));
const INTERPRETATION = [
  { v: 'psychological', e: '🧠', t: 'Psychological', d: 'A mirror of what’s on my mind' },
  { v: 'spiritual', e: '🙏', t: 'Spiritual', d: 'Dreams carry a deeper message' },
  { v: 'random', e: '🎲', t: 'Mostly random', d: 'The brain tidying up the day' },
  { v: 'curious', e: '🤔', t: 'Curious, not sure', d: 'Happy to explore' },
  { v: 'mix', e: '🌈', t: 'A bit of everything', d: 'It depends on the dream' },
];
const DREAM_TYPES = [
  { v: 'recurring', e: '🔁', t: 'Dreams that repeat' },
  { v: 'deja-vu', e: '✨', t: 'Déjà vu, or dreams that “came true”' },
  { v: 'vivid', e: '🎨', t: 'Very vivid or surreal' },
  { v: 'flying', e: '🕊️', t: 'Flying' },
  { v: 'falling', e: '⬇️', t: 'Falling' },
  { v: 'chased', e: '🏃', t: 'Being chased' },
  { v: 'teeth', e: '🦷', t: 'Losing teeth' },
  { v: 'naked', e: '🙈', t: 'Naked in public' },
  { v: 'late', e: '⏰', t: 'Running late' },
  { v: 'exams', e: '📝', t: 'Exams or tests' },
  { v: 'lost', e: '🧭', t: 'Being lost' },
  { v: 'nightmares', e: '🌑', t: 'Nightmares' },
];
const TOPICS = [
  { v: 'emotions', e: '💭', t: 'My emotions' },
  { v: 'symbols', e: '🔮', t: 'Symbols and objects' },
  { v: 'themes', e: '🔁', t: 'Themes that come back' },
  { v: 'people', e: '👥', t: 'People from my past' },
  { v: 'subconscious', e: '🧠', t: 'My subconscious' },
  { v: 'fears', e: '😨', t: 'My fears' },
  { v: 'relationships', e: '💞', t: 'Relationships' },
  { v: 'creativity', e: '💡', t: 'Creative ideas' },
];
const MINUTES = [
  { v: 1, t: '1 minute' },
  { v: 5, t: '5 minutes' },
  { v: 10, t: '10 minutes' },
];
const MONTHLY = [
  { v: 10, e: '🌒', t: '10 dreams a month' },
  { v: 15, e: '🌓', t: '15 dreams a month' },
  { v: 20, e: '🌕', t: '20 dreams a month' },
];
// Only things Dreaming really does today.
const FEATURES = [
  { v: 'journal', e: '🎙️', t: 'Voice or typed journal', d: 'Speak or write a dream the moment you wake' },
  { v: 'pictures', e: '🎨', t: 'Dream pictures', d: 'A painting for every dream, made on this iPhone' },
  { v: 'techniques', e: '👁️', t: 'Lucid dreaming techniques', d: 'Step-by-step guides that unlock as you journal' },
  { v: 'progress', e: '📊', t: 'Progress and patterns', d: 'Streaks, moods and symbols over time' },
  { v: 'goals', e: '🎯', t: 'Dream goals', d: 'Things to try in your next lucid dream' },
  { v: 'interpretation', e: '🔮', t: 'Dream interpretation (beta)', d: 'Optional, only when you ask for it' },
  { v: 'passcode', e: '🔒', t: 'Passcode lock', d: 'Keep your journal private' },
  { v: 'reminder', e: '📅', t: 'Morning reminder', d: 'A daily nudge in your Calendar' },
  { v: 'unsure', e: '🤷', t: 'Not sure yet' },
];
const LIFE_GOALS = [
  { v: 'fewer-nightmares', e: '😴', t: 'Fewer nightmares' },
  { v: 'creativity', e: '🎨', t: 'Creative inspiration' },
  { v: 'self-discovery', e: '🪞', t: 'Getting to know myself' },
  { v: 'sleep', e: '🌙', t: 'Sleeping better' },
  { v: 'recall', e: '🧠', t: 'Remembering more dreams' },
  { v: 'fun', e: '🎉', t: 'Just for fun' },
  { v: 'unsure', e: '🤷', t: 'Not sure yet' },
];

// ---------- Steps, in order ----------
// kind: welcome · single · multi · grid · main · name · info · chips · reminder · plan · sleep · art · privacy ·
//       goaltext · hold · loader.  skip: shows the Skip link (skips just this step).  bar: false hides the progress bar.

const nameOf = (p) => String(p.name || '').trim();
const withName = (p, text) => (nameOf(p) ? `${text}, ${esc(nameOf(p))}` : text);

const STEPS = [
  { id: 'welcome', kind: 'welcome', bar: false },
  { id: 'recall', kind: 'single', key: 'recall', title: 'How often do you remember your dreams?', options: RECALL },
  {
    id: 'fact-recall', kind: 'info', icon: 'edit',
    title: 'Write it down while it’s fresh',
    text: 'Dreams start to fade the moment you wake up. Noting even a few words before you get up or reach for your phone gives your memory something to hold on to, and with the habit, mornings tend to bring back more.',
  },
  { id: 'name', kind: 'name' },
  { id: 'gender', kind: 'single', key: 'gender', title: 'How do you describe yourself?', options: GENDER },
  { id: 'age', kind: 'single', key: 'age', title: 'How old are you?', options: AGE },
  { id: 'found', kind: 'single', key: 'foundVia', title: 'How did you hear about Dreaming?', options: FOUND },
  { id: 'main', kind: 'main' },
  {
    id: 'hello', kind: 'info', icon: 'sparkle',
    title: (p) => withName(p, 'Nice to meet you'),
    text: 'Now a few questions about your nights. Your answers stay on this iPhone and help set Dreaming up around you. Skip anything you’d rather keep to yourself.',
  },
  { id: 'nightmares', kind: 'single', key: 'nightmares', skip: true, title: 'How often do you have nightmares?', options: NIGHTMARES },
  {
    id: 'fact-nightmares', kind: 'info', icon: 'moon',
    title: 'Bad dreams look smaller in daylight',
    text: 'Writing a nightmare down lets you look at it calmly: what happened, how it felt, what was going on in your life. In Dreaming you can mark a dream as a nightmare and see over time whether they come in waves.',
    foot: 'If nightmares often leave you distressed, talking to a doctor can really help.',
  },
  {
    id: 'lucid-exp', kind: 'single', key: 'lucidExperience', skip: true,
    title: 'How familiar are you with lucid dreaming?',
    sub: 'A lucid dream is one where you realise, inside the dream, that you are dreaming.',
    options: LUCID_EXPERIENCE,
  },
  {
    id: 'journal-history', kind: 'single', key: 'journalHistory', skip: true,
    title: 'Have you kept a dream journal before?', sub: 'Either way, Dreaming will help you make it a habit.', options: JOURNAL_HISTORY,
  },
  {
    id: 'techniques', kind: 'grid', key: 'techniquesKnown', skip: true, exclusive: 'none',
    title: 'Which lucid dreaming techniques have you tried?', sub: 'Pick as many as you like.', options: TECHNIQUES_KNOWN,
  },
  { id: 'lucid-goals', kind: 'chips', skip: true },
  {
    id: 'fact-lucid', kind: 'info', icon: 'lucidity',
    title: 'Lucid dreaming is a skill you can practise',
    text: 'It usually starts with two habits: remembering your dreams, and pausing during the day to ask whether you might be dreaming. Dreaming starts you with reality checks and unlocks a new technique as your journal grows.',
  },
  {
    id: 'interpretation', kind: 'single', key: 'interpretationStyle', skip: true,
    title: 'How do you see dream meanings?', sub: 'There’s no wrong answer.', options: INTERPRETATION,
  },
  {
    id: 'dream-types', kind: 'multi', key: 'dreamTypes', skip: true,
    title: 'What kinds of dreams do you have?', sub: 'Pick as many as you like.', options: DREAM_TYPES,
  },
  {
    id: 'topics', kind: 'multi', key: 'topics', skip: true,
    title: 'What would you like to explore in your dreams?', sub: 'Pick as many as you like.', options: TOPICS,
  },
  { id: 'reminder', kind: 'reminder' },
  {
    id: 'minutes', kind: 'single', key: 'dailyMinutes', skip: true, options: MINUTES,
    title: (p) => (nameOf(p) ? `${esc(nameOf(p))}, how many minutes a day would you like to give your dreams?` : 'How many minutes a day would you like to give your dreams?'),
  },
  {
    id: 'monthly', kind: 'single', key: 'monthlyGoal', skip: true, options: MONTHLY,
    title: 'How many dreams would you like to catch each month?', sub: 'A clear goal makes the habit easier to keep.',
  },
  { id: 'plan', kind: 'plan' },
  {
    id: 'features', kind: 'multi', key: 'featureInterests', skip: true, exclusive: 'unsure',
    title: 'What would you like to try first?', sub: 'Pick as many as you like.', options: FEATURES,
  },
  { id: 'sleep', kind: 'sleep' },
  { id: 'art', kind: 'art' },
  { id: 'privacy', kind: 'privacy' },
  {
    id: 'life-goals', kind: 'multi', key: 'lifeGoals', skip: true, exclusive: 'unsure',
    title: 'What are you hoping your dreams can bring you?', sub: 'Pick as many as you like.', options: LIFE_GOALS,
  },
  { id: 'personal-goal', kind: 'goaltext' },
  { id: 'hold', kind: 'hold' },
  { id: 'loader', kind: 'loader', bar: false },
];
const BAR_STEPS = STEPS.filter((s) => s.bar !== false).map((s) => s.id);

// ---------- Small helpers ----------

const SUN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/></svg>';

const reducedMotion = () => {
  try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
};

function art(tags, seed, px) {
  try { return dreamArtPreview(tags, seed, px) || ''; } catch { return ''; }
}

function picture(tags, seed, px, cls) {
  const url = art(tags, seed, px);
  if (url) return `<img class="${cls}" src="${esc(url)}" alt="" decoding="async">`;
  return `<span class="${cls} ob-art-fallback" style="--h:${seed % 360}"></span>`;
}

const titleOf = (step, p) => (typeof step.title === 'function' ? step.title(p) : esc(step.title || ''));

const head = (step, p, title = titleOf(step, p), sub = step.sub) => `
  <h1 class="ob-title ob-anim" id="ob-title" style="--i:0">${title}</h1>
  ${sub ? `<p class="ob-sub ob-anim" style="--i:0">${esc(sub)}</p>` : ''}`;

const option = (o, n, checked, role) => `
  <button class="ob-opt ob-anim" type="button" role="${role}" aria-checked="${checked}" data-n="${n}" style="--i:${n + 1}">
    ${o.e ? `<span class="ob-emoji" aria-hidden="true">${o.e}</span>` : ''}
    <span class="ob-opt-text"><span class="ob-opt-label">${esc(o.t)}</span>${o.d ? `<span class="ob-opt-desc">${esc(o.d)}</span>` : ''}</span>
    <span class="ob-radio" aria-hidden="true"></span>
  </button>`;

const tile = (o, n, checked) => `
  <button class="ob-tile ob-anim" type="button" role="checkbox" aria-checked="${checked}" data-n="${n}" style="--i:${n + 1}">
    <span class="ob-tile-label">${esc(o.t)}</span>
    <span class="ob-radio" aria-hidden="true"></span>
    ${o.e ? `<span class="ob-tile-emoji" aria-hidden="true">${o.e}</span>` : ''}
  </button>`;

// The floating primary button. `late` delays its entrance a little, like the reference (title, content, then button).
const floatNext = ({ label = 'Next', on = true, late = true, icon = 'chevronRight', lead = false } = {}) => `
  <div class="ob-float${on ? ' is-on' : ''}${late ? ' is-late' : ''}">
    <button class="btn ob-next" type="button" data-next${on ? '' : ' tabindex="-1" aria-hidden="true"'}>
      ${lead ? icons[icon] : ''}<span>${label}</span>${lead ? '' : icons[icon]}
    </button>
  </div>`;

function setFloat(stage, on) {
  const wrap = stage.querySelector('.ob-float');
  const btn = wrap?.querySelector('[data-next]');
  if (!wrap || !btn) return;
  wrap.classList.remove('is-late');
  wrap.classList.toggle('is-on', on);
  btn.tabIndex = on ? 0 : -1;
  if (on) btn.removeAttribute('aria-hidden'); else btn.setAttribute('aria-hidden', 'true');
}

const toMin = (hhmm) => {
  const [h, m] = String(hhmm || '').split(':').map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null;
};

function durationLabel(bed, wake) {
  const b = toMin(bed);
  const w = toMin(wake);
  if (b === null || w === null) return '–';
  const d = (w - b + 1440) % 1440;
  const h = Math.floor(d / 60);
  const m = d % 60;
  return `${h} h${m ? ` ${m} min` : ''}`;
}

/** A 24-hour ring (0 at the top) with the sleep arc from bedtime to wake time. Display only; the inputs set it. */
function dialSvg(bed, wake) {
  const c = 120;
  const r = 92;
  const C = 2 * Math.PI * r;
  const b = toMin(bed) ?? 1380;
  const w = toMin(wake) ?? 420;
  const dur = (w - b + 1440) % 1440;
  const at = (min, rad) => {
    const a = (min / 1440) * 2 * Math.PI;
    return [c + rad * Math.sin(a), c - rad * Math.cos(a)].map((v) => v.toFixed(1));
  };
  const [bx, by] = at(b, r);
  const [wx, wy] = at(w, r);
  const labels = [0, 6, 12, 18].map((h) => {
    const [x, y] = at(h * 60, 64);
    return `<text x="${x}" y="${y}" class="ob-dial-num" text-anchor="middle" dominant-baseline="central">${h}</text>`;
  }).join('');
  const ticks = Array.from({ length: 24 }, (_, h) => {
    const [x1, y1] = at(h * 60, 76);
    const [x2, y2] = at(h * 60, h % 6 ? 79 : 82);
    return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="ob-dial-tick"/>`;
  }).join('');
  return `
    <svg viewBox="0 0 240 240" role="img" aria-label="Sleep from ${esc(bed)} to ${esc(wake)}, ${esc(durationLabel(bed, wake))}">
      <defs><linearGradient id="ob-arc" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#9b7bff"/><stop offset="1" stop-color="#ffd98a"/></linearGradient></defs>
      <circle cx="${c}" cy="${c}" r="${r}" class="ob-dial-track"/>
      <circle cx="${c}" cy="${c}" r="${r}" class="ob-dial-arc" stroke="url(#ob-arc)"
        stroke-dasharray="${((dur / 1440) * C).toFixed(1)} ${C.toFixed(1)}" transform="rotate(${((b / 1440) * 360 - 90).toFixed(2)} ${c} ${c})"/>
      ${ticks}${labels}
      <circle cx="${bx}" cy="${by}" r="13" class="ob-dial-knob"/>
      <g transform="translate(${bx - 8} ${by - 8}) scale(0.667)" class="ob-dial-moon">${icons.moon.replace('<svg ', '<svg width="24" height="24" ')}</g>
      <circle cx="${wx}" cy="${wy}" r="13" class="ob-dial-knob"/>
      <g transform="translate(${wx - 8} ${wy - 8}) scale(0.667)" class="ob-dial-sun">${SUN.replace('<svg ', '<svg width="24" height="24" ')}</g>
      <text x="${c}" y="${c - 6}" class="ob-dial-dur" text-anchor="middle">${esc(durationLabel(bed, wake))}</text>
      <text x="${c}" y="${c + 18}" class="ob-dial-cap" text-anchor="middle">of sleep</text>
    </svg>`;
}

// ---------- Screen state ----------

let root = null;
let index = 0;
let busy = false;
let stepCleanup = [];

function clearStep() {
  for (const fn of stepCleanup.splice(0)) { try { fn(); } catch {} }
}
function on(target, type, fn, opts) {
  target.addEventListener(type, fn, opts);
  stepCleanup.push(() => target.removeEventListener(type, fn, opts));
}
function wait(ms, fn) {
  const t = setTimeout(fn, ms);
  stepCleanup.push(() => clearTimeout(t));
}
function frame(fn) {
  const id = requestAnimationFrame(fn);
  stepCleanup.push(() => cancelAnimationFrame(id));
  return id;
}

const clamp = (i) => Math.max(0, Math.min(STEPS.length - 1, Number.isFinite(i) ? Math.floor(i) : 0));

function saveStep(i) {
  try { sessionStorage.setItem(STEP_KEY, String(i)); } catch {}
}

function updateTop(i) {
  if (!root) return;
  const step = STEPS[i];
  const top = root.querySelector('.ob-top');
  const fill = root.querySelector('.ob-bar i');
  const bar = root.querySelector('.ob-bar');
  const skip = root.querySelector('.ob-skip');
  top.hidden = step.bar === false;
  const pos = BAR_STEPS.indexOf(step.id);
  const pct = pos < 0 ? 0 : Math.round(((pos + 1) / (BAR_STEPS.length + 1)) * 100);
  fill.style.width = `${pct}%`;
  bar.setAttribute('aria-valuenow', String(pct));
  skip.hidden = !step.skip;
}

function show(i) {
  if (!root) return;
  clearStep();
  busy = false;
  index = clamp(i);
  saveStep(index);
  const step = STEPS[index];
  const p = getProfile();
  updateTop(index);
  root.dataset.kind = step.kind;
  const stage = root.querySelector('.ob-stage');
  const view = VIEWS[step.kind](step, p);
  stage.className = `ob-stage ob-in ob-k-${step.kind}`;
  stage.innerHTML = view.html;
  try { window.scrollTo(0, 0); } catch {}
  view.wire?.(stage, step, p);
}

/** Moves to step i: the bar advances at once, the content fades out, then the new step fades in. */
function go(i, delay = 0) {
  if (busy || !root) return;
  busy = true;
  const target = clamp(i);
  updateTop(target);
  const kind = STEPS[target].kind;
  // Text steps render inside the same tap so iOS still opens the keyboard on focus.
  if (!delay && (kind === 'name' || kind === 'goaltext')) { show(target); return; }
  const stage = root.querySelector('.ob-stage');
  const fade = reducedMotion() ? 0 : 220;
  wait(delay, () => {
    stage.classList.remove('ob-in');
    stage.classList.add('ob-out');
    wait(fade, () => show(target));
  });
}
const next = (delay = 0) => go(index + 1, delay);

function finish() {
  setProfile({ onboarded: true, onboardedAt: new Date().toISOString() });
  try {
    sessionStorage.removeItem(STEP_KEY);
    sessionStorage.setItem(PLUS_FLAG, '1');
  } catch {}
  location.replace('#plus');
}

// ---------- Views: each returns { html, wire(stage, step, p) } ----------

const COLLAGE = [
  [
    { t: 'A glass city above the clouds', tags: ['flying', 'surreal'], seed: 11 },
    { t: 'Swimming through the library', tags: ['water', 'home'], seed: 230 },
    { t: 'The fox who knew my name', tags: ['animals', 'nature'], seed: 77 },
  ],
  [
    { t: 'Baking bread by the sea', tags: ['family', 'calm'], seed: 512 },
    { t: 'Stairs that led into the stars', tags: ['night', 'surreal'], seed: 64 },
    { t: 'The train that never stopped', tags: ['travel', 'anxious'], seed: 905 },
  ],
  [
    { t: 'A garden of glowing flowers', tags: ['nature', 'happy'], seed: 341 },
    { t: 'Falling, then floating', tags: ['falling', 'calm'], seed: 18 },
    { t: 'Dancing round a beach fire', tags: ['fire', 'happy'], seed: 702 },
  ],
];

const VIEWS = {
  welcome() {
    const cards = (col) => col.map((c) => `
      <div class="ob-card">
        ${picture(c.tags, c.seed, 110, 'ob-card-art')}
        <span class="ob-card-title">${esc(c.t)}</span>
      </div>`).join('');
    const cols = COLLAGE.map((col, n) => `
      <div class="ob-col ob-col-${n}"><div class="ob-col-track">${cards(col)}${cards(col)}</div></div>`).join('');
    return {
      html: `
        <div class="ob-welcome">
          <div class="ob-collage" aria-hidden="true">${cols}</div>
          <p class="ob-collage-cap ob-anim" style="--i:1">Every dream gets a title and a picture of its own.</p>
          <div class="ob-welcome-body">
            <h1 class="ob-head ob-anim" style="--i:2">Catch your dreams <em>before they fade.</em></h1>
            <p class="ob-lead ob-anim" style="--i:3">A private dream journal for your iPhone. Free, no account, and it all stays on this phone.</p>
            <div class="ob-anim" style="--i:4">
              <button class="btn ob-next ob-cta" type="button" data-start><span>Get started</span></button>
              <button class="ob-textbtn" type="button" data-account>Already have an account?</button>
            </div>
          </div>
        </div>
        <div class="ob-sheet" hidden>
          <div class="ob-sheet-backdrop" data-close></div>
          <div class="ob-sheet-panel glass" role="dialog" aria-modal="true" aria-labelledby="ob-sheet-title">
            <div class="ob-orb ob-orb-sm" aria-hidden="true">${icons.lock}</div>
            <h2 class="ob-sheet-title" id="ob-sheet-title">No account needed</h2>
            <p class="ob-sheet-text">Dreaming doesn’t use accounts. Your dreams are saved right here on this iPhone and nowhere else, so there’s nothing to sign in to.</p>
            <p class="ob-sheet-text">Coming from another phone? Export your journal there from Settings, then import the file here once setup is done.</p>
            <button class="btn ob-next" type="button" data-close><span>Got it</span></button>
          </div>
        </div>`,
      wire(stage) {
        const sheet = stage.querySelector('.ob-sheet');
        on(stage.querySelector('[data-start]'), 'click', () => next());
        on(stage.querySelector('[data-account]'), 'click', () => {
          sheet.hidden = false;
          stage.querySelector('.ob-sheet-panel [data-close]').focus();
        });
        for (const el of stage.querySelectorAll('.ob-sheet [data-close]')) {
          on(el, 'click', () => {
            sheet.hidden = true;
            stage.querySelector('[data-account]').focus();
          });
        }
      },
    };
  },

  single(step, p) {
    return {
      html: `${head(step, p)}
        <div class="ob-list" role="radiogroup" aria-labelledby="ob-title">
          ${step.options.map((o, n) => option(o, n, p[step.key] === o.v, 'radio')).join('')}
        </div>`,
      wire(stage) {
        for (const btn of stage.querySelectorAll('.ob-opt')) {
          on(btn, 'click', () => {
            if (busy) return;
            const o = step.options[Number(btn.dataset.n)];
            for (const b of stage.querySelectorAll('.ob-opt')) b.setAttribute('aria-checked', String(b === btn));
            setProfile({ [step.key]: o.v });
            next(260);
          });
        }
      },
    };
  },

  multi(step, p) {
    const valid = new Set(step.options.map((o) => o.v));
    const chosen = new Set((Array.isArray(p[step.key]) ? p[step.key] : []).filter((v) => valid.has(v)));
    const grid = step.kind === 'grid';
    const items = step.options.map((o, n) => (grid ? tile(o, n, chosen.has(o.v)) : option(o, n, chosen.has(o.v), 'checkbox'))).join('');
    return {
      html: `${head(step, p)}
        <div class="${grid ? 'ob-grid' : 'ob-list'}" role="group" aria-labelledby="ob-title">${items}</div>
        ${floatNext({ on: chosen.size > 0, late: false })}`,
      wire(stage) {
        const buttons = [...stage.querySelectorAll('[data-n]')];
        const sync = () => {
          for (const b of buttons) b.setAttribute('aria-checked', String(chosen.has(step.options[Number(b.dataset.n)].v)));
          setFloat(stage, chosen.size > 0);
        };
        for (const btn of buttons) {
          on(btn, 'click', () => {
            if (busy) return;
            const v = step.options[Number(btn.dataset.n)].v;
            if (chosen.has(v)) chosen.delete(v);
            else if (v === step.exclusive) { chosen.clear(); chosen.add(v); }
            else { chosen.delete(step.exclusive); chosen.add(v); }
            sync();
          });
        }
        on(stage.querySelector('[data-next]'), 'click', () => {
          if (!chosen.size) return;
          setProfile({ [step.key]: step.options.map((o) => o.v).filter((v) => chosen.has(v)) });
          next();
        });
      },
    };
  },

  grid(step, p) { return VIEWS.multi(step, p); },

  main(step, p) {
    const valid = new Set(MAIN_GOALS.map((g) => g.v));
    const saved = Array.isArray(p.mainGoals) ? p.mainGoals : p.mainGoal ? [p.mainGoal] : [];
    const picked = saved.filter((v) => valid.has(v)); // tap order; the first is the main goal
    return {
      html: `${head(step, p, 'What brings you to Dreaming?', 'Pick as many as you like.')}
        <div class="ob-goals" role="group" aria-labelledby="ob-title">
          ${MAIN_GOALS.map((g, n) => `
            <button class="ob-goal ob-anim" type="button" role="checkbox" aria-checked="${picked.includes(g.v)}" data-v="${g.v}" style="--i:${n + 1}">
              ${picture(g.tags, g.seed, 180, 'ob-goal-art')}
              <span class="ob-goal-text"><span class="ob-goal-title">${esc(g.t)}</span><span class="ob-goal-desc">${esc(g.d)}</span></span>
              <span class="ob-radio" aria-hidden="true"></span>
            </button>`).join('')}
        </div>
        ${floatNext({ on: picked.length > 0, late: false })}`,
      wire(stage) {
        for (const btn of stage.querySelectorAll('.ob-goal')) {
          on(btn, 'click', () => {
            if (busy) return;
            const v = btn.dataset.v;
            const at = picked.indexOf(v);
            if (at >= 0) picked.splice(at, 1); else picked.push(v);
            btn.setAttribute('aria-checked', String(at < 0));
            setFloat(stage, picked.length > 0);
          });
        }
        on(stage.querySelector('[data-next]'), 'click', () => {
          if (!picked.length) return;
          setProfile({ mainGoal: picked[0], mainGoals: [...picked] });
          next();
        });
      },
    };
  },

  name(step, p) {
    const value = nameOf(p);
    return {
      html: `${head(step, p, 'What should we call you?')}
        <form class="ob-form ob-anim" style="--i:1" novalidate>
          <input class="field ob-input" type="text" name="name" placeholder="Your first name" maxlength="40"
            autocomplete="given-name" autocapitalize="words" autocorrect="off" spellcheck="false" enterkeyhint="done"
            value="${esc(value)}" aria-labelledby="ob-title">
          <button class="btn ob-next ob-next-inline" type="submit"${value ? '' : ' disabled'}><span>Next</span>${icons.chevronRight}</button>
        </form>`,
      wire(stage) {
        const form = stage.querySelector('form');
        const input = form.querySelector('input');
        const btn = form.querySelector('button');
        on(input, 'input', () => { btn.disabled = !input.value.trim(); });
        on(form, 'submit', (e) => {
          e.preventDefault();
          const v = input.value.trim();
          if (!v || busy) return;
          setProfile({ name: v });
          input.blur();
          next();
        });
        try { input.focus({ preventScroll: true }); } catch {}
      },
    };
  },

  info(step, p) {
    return {
      html: `
        <div class="ob-info">
          <div class="ob-orb ob-anim" style="--i:0" aria-hidden="true">${icons[step.icon] || icons.sparkle}</div>
          <h1 class="ob-info-title ob-anim" id="ob-title" style="--i:1">${titleOf(step, p)}</h1>
          <p class="ob-info-text ob-anim" style="--i:2">${esc(step.text)}</p>
          ${step.foot ? `<p class="ob-info-foot ob-anim" style="--i:3">${esc(step.foot)}</p>` : ''}
        </div>
        ${floatNext()}`,
      wire(stage) {
        on(stage.querySelector('[data-next]'), 'click', () => next());
      },
    };
  },

  chips(step, p) {
    const chosen = new Set(Array.isArray(p.lucidGoals) ? p.lucidGoals : []);
    const custom = [...chosen].filter((t) => !PRESET_GOALS.has(t));
    const chip = (emoji, label, dup) => `<button class="ob-chip" type="button" data-goal="${esc(label)}" aria-pressed="${chosen.has(label)}"${dup ? ' tabindex="-1"' : ''}>${emoji ? `<span aria-hidden="true">${emoji}</span>` : ''}${esc(label)}</button>`;
    const row = (items, dir) => {
      const set = (dup) => items.map(([e, t]) => chip(e, t, dup)).join('');
      return `<div class="ob-row ob-row-${dir}"><div class="ob-row-track"><span class="ob-row-set">${set(false)}</span><span class="ob-row-set ob-row-dup" aria-hidden="true">${set(true)}</span></div></div>`;
    };
    const mine = (t) => `<button class="ob-chip ob-chip-mine" type="button" data-goal="${esc(t)}" aria-pressed="true">${esc(t)}<span class="ob-chip-x" aria-hidden="true">${icons.close}</span></button>`;
    return {
      html: `${head(step, p, 'What will you do in your lucid dreams?', 'Pick a few, or add your own. They go into your dream goals, so you’ll have something to try the moment you realise you’re dreaming.')}
        <div class="ob-marquee ob-anim" style="--i:1" role="group" aria-label="Goal ideas">
          ${row(GOAL_ROWS[0], 'left')}${row(GOAL_ROWS[1], 'right')}
        </div>
        <div class="ob-mine" aria-label="Your own goals">${custom.map(mine).join('')}</div>
        <form class="ob-add glass ob-anim" style="--i:2" novalidate>
          <span class="ob-add-icon" aria-hidden="true">${icons.plus}</span>
          <input class="ob-add-input" type="text" placeholder="Add your own goal" maxlength="80" enterkeyhint="done" aria-label="Add your own goal">
          <button class="ob-add-btn" type="submit" disabled>Add</button>
        </form>
        ${floatNext()}`,
      wire(stage) {
        const marquee = stage.querySelector('.ob-marquee');
        const mineEl = stage.querySelector('.ob-mine');
        const form = stage.querySelector('.ob-add');
        const input = form.querySelector('input');
        const addBtn = form.querySelector('button');
        const syncChip = (label) => {
          for (const c of stage.querySelectorAll('.ob-chip')) {
            if (c.dataset.goal === label) c.setAttribute('aria-pressed', String(chosen.has(label)));
          }
        };
        // :active (which pauses the marquee) needs a touch listener on iOS.
        on(marquee, 'touchstart', () => {}, { passive: true });
        on(marquee, 'click', (e) => {
          const c = e.target.closest('.ob-chip');
          if (!c) return;
          const label = c.dataset.goal;
          if (chosen.has(label)) chosen.delete(label); else chosen.add(label);
          syncChip(label);
        });
        on(mineEl, 'click', (e) => {
          const c = e.target.closest('.ob-chip');
          if (!c) return;
          chosen.delete(c.dataset.goal);
          c.remove();
        });
        on(input, 'input', () => { addBtn.disabled = !input.value.trim(); });
        on(form, 'submit', (e) => {
          e.preventDefault();
          const t = input.value.trim().replace(/\s+/g, ' ');
          if (!t) return;
          const existing = [...chosen].find((x) => x.toLowerCase() === t.toLowerCase());
          const preset = [...PRESET_GOALS].find((x) => x.toLowerCase() === t.toLowerCase());
          if (preset) { chosen.add(preset); syncChip(preset); }
          else if (!existing) {
            chosen.add(t);
            mineEl.insertAdjacentHTML('beforeend', mine(t));
          }
          input.value = '';
          addBtn.disabled = true;
        });
        on(stage.querySelector('[data-next]'), 'click', () => {
          const goals = [...chosen];
          setProfile({ lucidGoals: goals });
          const have = new Set(listGoals().map((g) => String(g.text).toLowerCase()));
          for (const g of goals) if (!have.has(g.toLowerCase())) addGoal(g);
          next();
        });
      },
    };
  },

  reminder(step, p) {
    const wake = p.sleepSchedule?.wake || '07:00';
    let today = '';
    try { today = formatLongDate(new Date()); } catch {}
    return {
      html: `
        <div class="ob-center">
          <h1 class="ob-title ob-anim" id="ob-title" style="--i:0">A nudge before the dream fades</h1>
          <p class="ob-sub ob-anim" style="--i:0">Home Screen apps can’t send notifications on their own, so Dreaming puts a daily reminder in your Calendar instead, timed for when you wake up.</p>
        </div>
        <div class="ob-phone ob-anim" style="--i:1" aria-hidden="true">
          <p class="ob-phone-date">${esc(today)}</p>
          <p class="ob-phone-time">${esc(wake)}</p>
          <div class="ob-notif">
            <span class="ob-notif-icon">${icons.calendar}</span>
            <span class="ob-notif-body">
              <span class="ob-notif-top"><b>Calendar</b><span>now</span></span>
              <span class="ob-notif-title">Record your dream 🌙</span>
              <span class="ob-notif-text">Open Dreaming and write down last night’s dream before it fades.</span>
            </span>
          </div>
        </div>
        <p class="ob-note ob-anim" style="--i:2">Nothing changes on your iPhone yet: you’ll add it from Settings in one tap.</p>
        <div class="ob-float is-on is-late ob-float-stack">
          <button class="btn ob-next" type="button" data-yes><span>Yes, remind me</span>${icons.chevronRight}</button>
          <button class="ob-textbtn" type="button" data-later>Later</button>
        </div>
        <div class="ob-confirm" hidden>
          <div class="ob-confirm-panel" role="dialog" aria-modal="true" aria-labelledby="ob-confirm-title">
            <h2 class="ob-confirm-title" id="ob-confirm-title">Are you sure?</h2>
            <p class="ob-confirm-text">Dreams slip away within minutes of waking. A morning reminder helps you catch them while they’re still clear. You can always add one later in Settings.</p>
            <button class="btn ob-next" type="button" data-yes><span>Remind me</span></button>
            <button class="ob-textbtn" type="button" data-skip-reminder>Skip for now</button>
          </div>
        </div>`,
      wire(stage) {
        const confirm = stage.querySelector('.ob-confirm');
        for (const b of stage.querySelectorAll('[data-yes]')) {
          on(b, 'click', () => {
            if (busy) return;
            setProfile({ wantsReminder: true });
            next();
          });
        }
        on(stage.querySelector('[data-later]'), 'click', () => {
          confirm.hidden = false;
          confirm.querySelector('[data-yes]').focus();
        });
        on(stage.querySelector('[data-skip-reminder]'), 'click', () => {
          if (busy) return;
          setProfile({ wantsReminder: false });
          confirm.classList.add('is-leaving');
          next();
        });
      },
    };
  },

  plan(step, p) {
    const goals = (Array.isArray(p.mainGoals) ? p.mainGoals : p.mainGoal ? [p.mainGoal] : [])
      .map((v) => MAIN_GOALS.find((g) => g.v === v)?.t).filter(Boolean);
    const month = Number(p.monthlyGoal) || 0;
    const mins = Number(p.dailyMinutes) || 0;
    const rows = [
      ['🌙', month ? `${month} dreams a month` : 'Dreams at your own pace', month ? `About ${Math.ceil(month / 4.3)} a week` : 'No target, just the habit'],
      ['⏱️', mins ? `${mins} ${mins === 1 ? 'minute' : 'minutes'} a day` : 'A few minutes a day', 'Right after you wake up'],
      ['🎯', 'Your focus', goals.length ? goals.join(' · ') : 'Journaling'],
      ['📅', p.wantsReminder ? 'Morning reminder' : 'No reminder for now', p.wantsReminder ? 'Add it from Settings after setup' : 'You can add one in Settings anytime'],
    ];
    const road = [
      ['This week', 'Write something every morning, even a single line.'],
      ['As your journal grows', 'Reality checks are ready from day one; more lucid techniques unlock as you log dreams.'],
      ['Over the weeks', 'Progress shows your streaks, moods and the symbols that keep coming back.'],
    ];
    return {
      html: `${head(step, p, withName(p, 'Here’s your plan'), 'Recall is a habit, so be patient with yourself: it gets easier with practice.')}
        <div class="ob-plan glass ob-anim" style="--i:1">
          ${rows.map(([e, t, d]) => `
            <div class="ob-plan-row">
              <span class="ob-emoji" aria-hidden="true">${e}</span>
              <span class="ob-opt-text"><span class="ob-opt-label">${esc(t)}</span><span class="ob-opt-desc">${esc(d)}</span></span>
            </div>`).join('')}
        </div>
        <ol class="ob-road ob-anim" style="--i:2">
          ${road.map(([t, d]) => `<li><span class="ob-road-dot" aria-hidden="true"></span><span><b>${esc(t)}</b>${esc(d)}</span></li>`).join('')}
        </ol>
        ${floatNext()}`,
      wire(stage) {
        on(stage.querySelector('[data-next]'), 'click', () => next());
      },
    };
  },

  sleep(step, p) {
    const s = { bedtime: '23:00', wake: '07:00', ...(p.sleepSchedule || {}) };
    return {
      html: `${head(step, p, 'What’s your usual sleep schedule?', 'Dreaming can’t read Apple Health, so set your usual times here. You can change them later.')}
        <div class="ob-sleep ob-anim" style="--i:1">
          <label class="ob-time glass">
            <span class="ob-time-label"><span class="ob-time-icon ob-time-moon">${icons.moon}</span>Bedtime</span>
            <input class="ob-time-input" type="time" value="${esc(s.bedtime)}" data-bed>
          </label>
          <label class="ob-time glass">
            <span class="ob-time-label"><span class="ob-time-icon ob-time-sun">${SUN}</span>Wake up</span>
            <input class="ob-time-input" type="time" value="${esc(s.wake)}" data-wake>
          </label>
        </div>
        <div class="ob-dial ob-anim" style="--i:2">${dialSvg(s.bedtime, s.wake)}</div>
        ${floatNext()}`,
      wire(stage) {
        const bed = stage.querySelector('[data-bed]');
        const wake = stage.querySelector('[data-wake]');
        const dial = stage.querySelector('.ob-dial');
        const redraw = () => { dial.innerHTML = dialSvg(bed.value || s.bedtime, wake.value || s.wake); };
        for (const el of [bed, wake]) { on(el, 'input', redraw); on(el, 'change', redraw); }
        on(stage.querySelector('[data-next]'), 'click', () => {
          setProfile({ sleepSchedule: { bedtime: bed.value || s.bedtime, wake: wake.value || s.wake } });
          next();
        });
      },
    };
  },

  art(step, p) {
    const samples = [[['flying', 'night'], 702], [['water', 'calm'], 133], [['nature', 'surreal'], 2048]]
      .map(([tags, seed]) => art(tags, seed, 120));
    const start = Math.max(0, ART_STYLES.findIndex((s) => s.id === p.artStyle));
    const stack = (s) => samples.map((url, n) => (url
      ? `<img class="ob-stack-img ob-stack-${n}" src="${esc(url)}" alt="" decoding="async">`
      : `<span class="ob-stack-img ob-stack-${n} ob-art-fallback" style="--h:${260 + n * 30}"></span>`)).join('');
    return {
      html: `${head(step, p, 'Choose a style for your dream pictures', 'Every dream you save gets its own painting, made on this iPhone.')}
        <div class="ob-carousel ob-anim" style="--i:1" role="listbox" aria-label="Picture styles">
          ${ART_STYLES.map((s, n) => `
            <button class="ob-style" type="button" role="option" aria-selected="${n === start}" aria-label="${esc(s.name)}" data-n="${n}">
              <span class="ob-stack" style="filter:${s.filter}">${stack(s)}</span>
            </button>`).join('')}
        </div>
        <p class="ob-style-name ob-anim" style="--i:2" aria-live="polite">${esc(ART_STYLES[start].name)}</p>
        <p class="ob-style-note ob-anim" style="--i:2">${esc(ART_STYLES[start].note)}</p>
        ${floatNext({ label: 'Select', icon: 'check', lead: true })}`,
      wire(stage) {
        const scroller = stage.querySelector('.ob-carousel');
        const cards = [...scroller.querySelectorAll('.ob-style')];
        const nameEl = stage.querySelector('.ob-style-name');
        const noteEl = stage.querySelector('.ob-style-note');
        let current = start;
        const centerOn = (n, smooth) => {
          const card = cards[n];
          const left = card.offsetLeft - (scroller.clientWidth - card.offsetWidth) / 2;
          try { scroller.scrollTo({ left, behavior: smooth && !reducedMotion() ? 'smooth' : 'auto' }); } catch { scroller.scrollLeft = left; }
        };
        const setCurrent = (n) => {
          if (n === current) return;
          current = n;
          cards.forEach((c, k) => c.setAttribute('aria-selected', String(k === n)));
          nameEl.textContent = ART_STYLES[n].name;
          noteEl.textContent = ART_STYLES[n].note;
        };
        let pending = 0;
        stepCleanup.push(() => cancelAnimationFrame(pending));
        on(scroller, 'scroll', () => {
          if (pending) return;
          pending = requestAnimationFrame(() => {
            pending = 0;
            const mid = scroller.scrollLeft + scroller.clientWidth / 2;
            let best = 0;
            let dist = Infinity;
            cards.forEach((c, k) => {
              const d = Math.abs(c.offsetLeft + c.offsetWidth / 2 - mid);
              if (d < dist) { dist = d; best = k; }
            });
            setCurrent(best);
          });
        }, { passive: true });
        for (const c of cards) on(c, 'click', () => { const n = Number(c.dataset.n); setCurrent(n); centerOn(n, true); });
        frame(() => centerOn(start, false));
        on(stage.querySelector('[data-next]'), 'click', () => {
          setProfile({ artStyle: ART_STYLES[current].id });
          next();
        });
      },
    };
  },

  privacy(step, p) {
    const points = [
      ['lock', 'Kept on this iPhone', 'Your journal is saved in this phone’s own storage. No account, no cloud copy.'],
      ['sparkle', 'Free, nothing to unlock', 'Every feature in Dreaming is free right now.'],
      ['share', 'Shared only when you ask', 'Interpretation (beta) stays off unless you switch it on, and then sends only the dream you ask about.'],
      ['book', 'Yours to take with you', 'Export your whole journal as a file from Settings whenever you like.'],
    ];
    return {
      html: `${head(step, p, 'Your dreams stay yours', 'How Dreaming looks after what you write.')}
        <ul class="ob-points">
          ${points.map(([ic, t, d], n) => `
            <li class="ob-point glass ob-anim" style="--i:${n + 1}">
              <span class="ob-point-icon" aria-hidden="true">${icons[ic]}</span>
              <span class="ob-opt-text"><span class="ob-opt-label">${esc(t)}</span><span class="ob-opt-desc">${esc(d)}</span></span>
            </li>`).join('')}
        </ul>
        ${floatNext({ label: 'Continue' })}`,
      wire(stage) {
        on(stage.querySelector('[data-next]'), 'click', () => next());
      },
    };
  },

  goaltext(step, p) {
    const value = String(p.personalGoal || '');
    return {
      html: `${head(step, p, 'In your own words, what would you like from Dreaming?', 'Write as much or as little as you like. It stays on this iPhone, as a note to yourself.')}
        <form class="ob-goalbox glass ob-anim" style="--i:1" novalidate>
          <textarea class="ob-textarea" name="goal" rows="5" maxlength="500" placeholder="I’d like to…" aria-labelledby="ob-title">${esc(value)}</textarea>
          <button class="btn ob-next ob-next-inline" type="submit"${value.trim() ? '' : ' disabled'}><span>Next</span>${icons.chevronRight}</button>
        </form>`,
      wire(stage) {
        const form = stage.querySelector('form');
        const area = form.querySelector('textarea');
        const btn = form.querySelector('button');
        on(area, 'input', () => { btn.disabled = !area.value.trim(); });
        on(form, 'submit', (e) => {
          e.preventDefault();
          const v = area.value.trim();
          if (!v || busy) return;
          setProfile({ personalGoal: v });
          area.blur();
          next();
        });
        try { area.focus({ preventScroll: true }); } catch {}
      },
    };
  },

  hold(step, p) {
    const goals = Array.isArray(p.mainGoals) ? p.mainGoals : p.mainGoal ? [p.mainGoal] : [];
    const what = goals.includes('lucid') ? 'Ready to start lucid dreaming'
      : goals.includes('analysis') ? 'Ready to explore your dreams' : 'Ready to start your dream journal';
    return {
      html: `
        <div class="ob-hold">
          <div class="ob-orb ob-anim" style="--i:0" aria-hidden="true">${icons.moon}</div>
          <h1 class="ob-hold-title ob-anim" id="ob-title" style="--i:1">${withName(p, what)}?</h1>
        </div>
        <div class="ob-float is-on is-late ob-hold-foot">
          <p class="ob-hold-hint" aria-hidden="true">Keep holding…</p>
          <button class="ob-hold-btn" type="button" aria-describedby="ob-hold-help">
            <span class="ob-hold-fill" aria-hidden="true"></span>
            <span class="ob-hold-label">I’m ready</span>
          </button>
          <p class="ob-hold-help" id="ob-hold-help">Press and hold to begin</p>
        </div>`,
      wire(stage) {
        const btn = stage.querySelector('.ob-hold-btn');
        const foot = stage.querySelector('.ob-hold-foot');
        const HOLD_MS = 1800;
        let startAt = 0;
        let raf = 0;
        let done = false;
        let holding = false;
        const set = (v) => btn.style.setProperty('--p', v.toFixed(3));
        const tick = (now) => {
          if (!holding) return;
          const v = Math.min(1, (now - startAt) / HOLD_MS);
          set(v);
          if (v >= 1) complete();
          else raf = requestAnimationFrame(tick);
        };
        const begin = (e) => {
          if (done || holding || busy) return;
          holding = true;
          try { if (e?.pointerId !== undefined) btn.setPointerCapture(e.pointerId); } catch {}
          foot.classList.add('is-holding');
          startAt = performance.now();
          raf = requestAnimationFrame(tick);
        };
        const cancel = () => {
          if (done || !holding) return;
          holding = false;
          cancelAnimationFrame(raf);
          foot.classList.remove('is-holding');
          set(0); // released early: the fill slides back to empty
        };
        const complete = () => {
          done = true;
          holding = false;
          foot.classList.remove('is-holding');
          foot.classList.add('is-done');
          try { navigator.vibrate?.(25); } catch {}
          next(260);
        };
        stepCleanup.push(() => cancelAnimationFrame(raf));
        on(btn, 'pointerdown', (e) => { e.preventDefault(); begin(e); });
        for (const t of ['pointerup', 'pointercancel', 'lostpointercapture']) on(btn, t, cancel);
        on(btn, 'contextmenu', (e) => e.preventDefault());
        on(btn, 'keydown', (e) => {
          if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); begin(); }
        });
        on(btn, 'keyup', (e) => { if (e.key === ' ' || e.key === 'Enter') cancel(); });
        on(btn, 'blur', cancel);
      },
    };
  },

  loader() {
    const STAGES = [
      ['📝', 'Saving your answers…'],
      ['📖', 'Setting up your journal…'],
      ['👁️', 'Getting your techniques ready…'],
      ['✨', 'Almost ready…'],
    ];
    const r = 54;
    const C = 2 * Math.PI * r;
    return {
      html: `
        <div class="ob-loader" role="status">
          <div class="ob-ring">
            <svg viewBox="0 0 128 128" aria-hidden="true">
              <defs><linearGradient id="ob-ring-g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#9b7bff"/><stop offset="1" stop-color="#ffd98a"/></linearGradient></defs>
              <circle cx="64" cy="64" r="${r}" class="ob-ring-track"/>
              <circle cx="64" cy="64" r="${r}" class="ob-ring-bar" stroke="url(#ob-ring-g)" stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${C.toFixed(1)}" transform="rotate(-90 64 64)"/>
            </svg>
            <span class="ob-ring-emoji" aria-hidden="true">${STAGES[0][0]}</span>
          </div>
          <p class="ob-loader-text">${STAGES[0][1]}</p>
          <p class="ob-loader-pct">0%</p>
        </div>`,
      wire(stage) {
        const bar = stage.querySelector('.ob-ring-bar');
        const emoji = stage.querySelector('.ob-ring-emoji');
        const text = stage.querySelector('.ob-loader-text');
        const pctEl = stage.querySelector('.ob-loader-pct');
        const TOTAL = reducedMotion() ? 2000 : 5000;
        let startAt = 0;
        let shown = 0;
        let raf = 0;
        stepCleanup.push(() => cancelAnimationFrame(raf));
        const tick = (now) => {
          if (!startAt) startAt = now;
          const t = Math.min(1, (now - startAt) / TOTAL);
          const eased = t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2;
          const pct = Math.round(eased * 100);
          bar.setAttribute('stroke-dashoffset', (C * (1 - eased)).toFixed(1));
          pctEl.textContent = `${pct}%`;
          const s = Math.min(STAGES.length - 1, Math.floor(pct / 25));
          if (s !== shown) {
            shown = s;
            text.classList.remove('is-swap');
            void text.offsetWidth; // restart the crossfade
            text.classList.add('is-swap');
            text.textContent = STAGES[s][1];
            emoji.textContent = STAGES[s][0];
          }
          if (t < 1) raf = requestAnimationFrame(tick);
          else wait(450, finish);
        };
        raf = requestAnimationFrame(tick);
      },
    };
  },
};

export default {
  id: 'onboarding',
  hideTabbar: true,
  render(el) {
    clearStep();
    el.innerHTML = `
      <div class="ob">
        <header class="ob-top" hidden>
          <div class="ob-bar" role="progressbar" aria-label="Setup progress" aria-valuemin="0" aria-valuemax="100"><i></i></div>
          <button class="ob-skip" type="button" hidden>Skip</button>
        </header>
        <div class="ob-stage"></div>
      </div>`;
    root = el.querySelector('.ob');
    root.querySelector('.ob-skip').addEventListener('click', () => next());
    let start = 0;
    try { start = Number(sessionStorage.getItem(STEP_KEY)) || 0; } catch {}
    busy = false;
    show(start);
  },
  destroy() {
    clearStep();
    busy = false;
    root = null;
  },
};
