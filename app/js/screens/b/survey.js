// New layout: "Personalise Dreaming", a step-by-step survey in a bottom sheet. It opens from the Profile tab (#me), or
// straight away with #me/survey. It brings back the first version's welcome questions (onboarding.js STEPS, read and
// written in the same profile field as at setup, so answers given then already count) together with the questions that
// used to sit in Insights (profile.survey.<id>). Where the two asked the same thing (how often you remember dreams,
// what you want from Dreaming) only the setup question stays; an answer given in Insights still shows until changed.
// Five short sections. A single choice moves on by itself after a moment; multi-choice has Next; Skip on unanswered;
// Back. The summary lists every answer (tap one to change it). Every tap is saved at once, on this iPhone only.
// Lucid dream goals picked here also go into Dream goals, as at setup. Touches the page only inside openSurvey.
import { getProfile, setProfile, addGoal, listGoals } from '../../store.js';
import { esc, icons } from '../../ui.js';
import { STEPS, MAIN_GOALS, GOAL_ROWS } from '../onboarding.js';

const ADVANCE_MS = 320; // a single choice moves on after this
const GOAL_MAX = 80;    // own lucid goal, as at setup

const SECTIONS = {
  you: 'About you',
  nights: 'Your nights',
  lucid: 'Lucid dreaming',
  meaning: 'Dream meanings',
  wishes: 'What you’d like',
};

const list = (v) => (Array.isArray(v) ? v : []);
const surveyOf = (p) => (p.survey && typeof p.survey === 'object' ? p.survey : {});

// The Insights survey asked these in its own words; such an answer shows here until it is changed.
const OLD_RECALL = { most: 'daily', often: 'weekly', sometimes: 'monthly', rarely: 'rarely' };
const OLD_MAIN = { understand: 'analysis', lucid: 'lucid' };
const OLD_LIFE = { sleep: 'sleep', nightmares: 'fewer-nightmares', creativity: 'creativity' };

// ---- Questions ----

/** A welcome question from onboarding.js, kept in the same profile field as at setup. */
function setup(stepId, section, short, extra = {}) {
  const s = STEPS.find((x) => x.id === stepId) || {};
  return {
    id: s.key,
    section,
    short,
    title: s.title,
    sub: s.sub,
    options: s.options || [],
    multi: s.kind === 'multi' || s.kind === 'grid',
    exclusive: s.exclusive,
    get: (p) => p[s.key],
    set: (v) => setProfile({ [s.key]: v }),
    ...extra,
  };
}

/** A question that used to sit in Insights, kept in profile.survey.<id>. */
function own(id, section, short, title, options, extra = {}) {
  return {
    id,
    section,
    short,
    title,
    options: options.map(([v, t]) => ({ v, t })),
    multi: false,
    get: (p) => surveyOf(p)[id],
    set: (v) => {
      const survey = { ...surveyOf(getProfile()) };
      if (v == null || (Array.isArray(v) && !v.length)) delete survey[id];
      else survey[id] = v;
      setProfile({ survey });
    },
    ...extra,
  };
}

const PRESET_GOALS = GOAL_ROWS.flat().map(([e, t]) => ({ v: t, t, e }));
const PRESET_SET = new Set(PRESET_GOALS.map((o) => o.v));

const MAIN = {
  id: 'mainGoals',
  section: 'wishes',
  short: 'What brings you here',
  title: 'What brings you to Dreaming?',
  sub: 'Pick as many as you like. The first one you pick is your main goal.',
  options: MAIN_GOALS.map(({ v, t, d }) => ({ v, t, d })),
  multi: true,
  tapOrder: true,
  get: (p) => {
    if (Array.isArray(p.mainGoals)) return p.mainGoals;
    if (p.mainGoal) return [p.mainGoal];
    const old = OLD_MAIN[surveyOf(p).goal];
    return old ? [old] : [];
  },
  set: (v) => setProfile({ mainGoal: v[0] ?? null, mainGoals: v }),
};

const LUCID_GOALS = {
  id: 'lucidGoals',
  section: 'lucid',
  short: 'Lucid dream goals',
  title: 'What will you do in your lucid dreams?',
  sub: 'Pick a few, or add your own. New ones also go into your dream goals.',
  // The ideas from setup, then the user's own.
  options: (p) => [...PRESET_GOALS, ...list(p.lucidGoals).filter((t) => typeof t === 'string' && t && !PRESET_SET.has(t)).map((t) => ({ v: t, t }))],
  multi: true,
  tapOrder: true,
  chips: true,
  custom: true,
  get: (p) => p.lucidGoals,
  set: (v) => setProfile({ lucidGoals: v }),
  /** Goals picked during this visit go into Dream goals (once), as at setup. */
  leave(fresh) {
    if (!fresh.size) return;
    const have = new Set(listGoals().map((g) => String(g.text).toLowerCase()));
    for (const g of list(getProfile().lucidGoals)) {
      if (!fresh.has(g) || have.has(g.toLowerCase())) continue;
      addGoal(g);
      have.add(g.toLowerCase());
    }
    fresh.clear();
  },
};

export const QUESTIONS = [
  setup('gender', 'you', 'Gender'),
  setup('age', 'you', 'Age'),
  setup('found', 'you', 'Heard about Dreaming'),
  own('life', 'you', 'Life right now', 'What is going on in your life right now?',
    [['work', 'Work or study'], ['relationships', 'Relationships'], ['health', 'Health'], ['family', 'Family'], ['change', 'A big change'], ['none', 'Nothing in particular']],
    { multi: true, exclusive: 'none' }),
  own('stress', 'you', 'Stress lately', 'How stressful does life feel lately?',
    [['calm', 'Calm'], ['little', 'A little'], ['quite', 'Quite a lot'], ['very', 'Very']]),

  setup('recall', 'nights', 'Remembering dreams', { get: (p) => p.recall || OLD_RECALL[surveyOf(p).recall] }),
  setup('journal-history', 'nights', 'Dream journal before'),
  own('waking', 'nights', 'Waking up', 'How do you usually feel when you wake up?',
    [['rested', 'Rested'], ['okay', 'Okay'], ['tired', 'Tired'], ['unsettled', 'Unsettled'], ['varies', 'It changes a lot']]),
  setup('nightmares', 'nights', 'Nightmares'),
  own('recurring', 'nights', 'Recurring dreams', 'Do you have dreams that keep coming back?',
    [['often', 'Yes, often'], ['sometimes', 'Sometimes'], ['no', 'Not really']]),
  own('comeTrue', 'nights', 'Dreams coming true', 'Do your dreams ever seem to come true?',
    [['often', 'Often'], ['sometimes', 'Sometimes'], ['once', 'Once or twice'], ['never', 'Never']],
    { sub: 'Some people notice a dream that later seems to match real events.' }),
  setup('dream-types', 'nights', 'Kinds of dreams'),

  setup('lucid-exp', 'lucid', 'Lucid dreaming so far'),
  setup('techniques', 'lucid', 'Techniques tried'),
  LUCID_GOALS,

  setup('interpretation', 'meaning', 'How you see meanings'),
  own('tone', 'meaning', 'Interpretation tone', 'How should interpretations speak to you?',
    [['gentle', 'Gentle and warm'], ['direct', 'Clear and direct']]),
  setup('topics', 'meaning', 'Things to explore'),

  MAIN,
  setup('life-goals', 'wishes', 'Hoping for', {
    get: (p) => (Array.isArray(p.lifeGoals) ? p.lifeGoals : OLD_LIFE[surveyOf(p).goal] ? [OLD_LIFE[surveyOf(p).goal]] : []),
  }),
  setup('features', 'wishes', 'To try first'),
  setup('minutes', 'wishes', 'Minutes a day'),
  setup('monthly', 'wishes', 'Dreams a month'),
].filter((q) => q.id && (typeof q.options === 'function' || q.options.length));

const optionsOf = (q, p) => (typeof q.options === 'function' ? q.options(p) : q.options);
const titleHTML = (q, p) => (typeof q.title === 'function' ? q.title(p) : esc(q.title || '')); // setup titles come escaped

/** The chosen values that are still real options, in saved order. */
function picked(q, p) {
  const opts = optionsOf(q, p);
  const ok = (x) => opts.some((o) => o.v === x);
  if (q.multi) return list(q.get(p)).filter(ok);
  const v = q.get(p);
  return ok(v) ? [v] : [];
}

const answered = (q, p) => picked(q, p).length > 0;

/** How many questions have an answer (setup answers count too). */
export function surveyProgress(p = getProfile()) {
  return { done: QUESTIONS.filter((q) => answered(q, p)).length, total: QUESTIONS.length };
}

function nextUnanswered(from, p = getProfile()) {
  for (let i = from; i < QUESTIONS.length; i += 1) if (!answered(QUESTIONS[i], p)) return i;
  return -1;
}

function answerText(q, p) {
  const opts = optionsOf(q, p);
  const labels = picked(q, p).map((v) => opts.find((o) => o.v === v)?.t).filter(Boolean);
  return labels.length > 3 ? `${labels.slice(0, 3).join(', ')} +${labels.length - 3} more` : labels.join(', ');
}

// ---- Sheet parts ----

const optionHTML = (o, n, on, q) => (q.chips
  ? `<button type="button" class="bsv-chip" role="checkbox" aria-checked="${on}" data-n="${n}">
      ${o.e ? `<span class="bsv-emoji" aria-hidden="true">${o.e}</span>` : ''}<span>${esc(o.t)}</span><span class="bsv-chip-tick" aria-hidden="true">${icons.check}</span>
    </button>`
  : `<button type="button" class="bsv-opt" role="${q.multi ? 'checkbox' : 'radio'}" aria-checked="${on}" data-n="${n}">
      ${o.e ? `<span class="bsv-emoji" aria-hidden="true">${o.e}</span>` : ''}
      <span class="bsv-opt-text"><span class="bsv-opt-label">${esc(o.t)}</span>${o.d ? `<span class="bsv-opt-desc">${esc(o.d)}</span>` : ''}</span>
      <span class="bsv-tick" aria-hidden="true">${icons.check}</span>
    </button>`);

const addFormHTML = () => `
  <form class="bsv-add" data-add novalidate>
    <input class="field bsv-add-input" type="text" maxlength="${GOAL_MAX}" enterkeyhint="done" placeholder="Add your own goal" aria-label="Add your own goal">
    <button class="bsv-add-btn" type="submit" disabled>Add</button>
  </form>`;

const headHTML = () => `
  <p class="bsv-kicker"><span class="bsv-kicker-section" data-section></span><span class="bsv-kicker-count" data-count></span></p>
  <div class="bsv-progress" role="progressbar" aria-label="Questions" aria-valuemin="1" aria-valuemax="${QUESTIONS.length}"><i></i></div>`;

function questionHTML(q, p, shown) {
  const chosen = picked(q, p);
  const hint = q.sub || (q.multi ? 'Pick all that fit.' : 'Pick one.');
  return `
    <h2 class="bsv-q" id="bsv-title" tabindex="-1">${titleHTML(q, p)}</h2>
    <p class="bsv-hint">${esc(hint)}</p>
    <div class="${q.chips ? 'bsv-chips' : 'bsv-list'}" role="${q.multi ? 'group' : 'radiogroup'}" aria-labelledby="bsv-title">
      ${shown.map((o, n) => optionHTML(o, n, chosen.includes(o.v), q)).join('')}
    </div>
    ${q.custom ? addFormHTML() : ''}`;
}

function questionFootHTML(i, editing, p) {
  const isAnswered = answered(QUESTIONS[i], p);
  const last = nextUnanswered(i + 1, p) < 0;
  return `
    <button type="button" class="btn btn-ghost bsv-back" data-sv="back"${!editing && i === 0 ? ' disabled' : ''}>Back</button>
    ${editing ? '' : `<button type="button" class="bsv-skip" data-sv="skip"${isAnswered ? ' hidden' : ''}>Skip</button>`}
    <button type="button" class="btn bsv-next" data-sv="next"${!editing && !isAnswered ? ' disabled' : ''}>${editing ? 'Done' : last ? 'Finish' : 'Next'}</button>`;
}

/** Every answer, by section, each tappable to change it. `thanked`: reached by going through the questions. */
function summaryHTML(p, thanked) {
  const { done, total } = surveyProgress(p);
  const all = done === total;
  const title = thanked ? (all ? 'Thank you' : 'Thanks so far') : done ? 'Your answers' : 'No answers yet';
  const lead = all
    ? 'Every question is answered. Tap any answer to change it.'
    : `${done} of ${total} answered. Answer the rest now or whenever you like.`;
  const groups = Object.entries(SECTIONS).map(([id, label]) => {
    const rows = QUESTIONS.map((q, i) => [q, i]).filter(([q]) => q.section === id).map(([q, i]) => {
      const a = answerText(q, p);
      return `
        <li><button type="button" class="bsv-answer" data-edit="${i}">
          <span class="bsv-answer-q">${esc(q.short)}</span>
          <span class="bsv-answer-a${a ? '' : ' is-none'}">${esc(a || 'Not answered')}</span>${icons.chevronRight}
        </button></li>`;
    }).join('');
    return rows ? `<p class="bsv-group">${esc(label)}</p><ul class="bsv-answers">${rows}</ul>` : '';
  }).join('');
  return `
    <div class="bsv-thanks">
      <span class="bsv-thanks-icon" aria-hidden="true">${all ? icons.check : icons.sparkle}</span>
      <h2 class="bsv-title" id="bsv-title" tabindex="-1">${title}</h2>
      <p class="bsv-lead">${esc(lead)}</p>
      <p class="bsv-private">Your answers stay on this iPhone.</p>
    </div>
    ${groups}`;
}

const summaryFootHTML = (p) => {
  const { done, total } = surveyProgress(p);
  return `
    ${done < total ? '<button type="button" class="btn btn-ghost" data-sv="rest">Answer the rest</button>' : ''}
    <button type="button" class="btn" data-close>Done</button>`;
};

// ---- Sheet ----

let current = null; // the open sheet's handle

/**
 * Opens the survey. `start`: a question index, 'summary', or nothing for the first unanswered question (the summary
 * when all are answered). `onClose(byUser)` runs when it closes; byUser is false when closed by leaving the screen.
 * Returns { close(now) }.
 */
export function openSurvey(start, { onClose } = {}) {
  current?.close(true);
  const total = QUESTIONS.length;
  let step = start === 'summary' || (Number.isInteger(start) && start >= 0 && start < total) ? start : nextUnanswered(0);
  if (step === -1) step = 'summary';
  let editing = false;  // changing one answer from the summary: Back and Done return there
  let thanked = false;  // the summary was reached by going through the questions
  let shown = [];       // the options on screen, as drawn (the tap targets' data-n)
  let timer = null;
  let closed = false;
  const fresh = new Set(); // lucid goals picked during this visit

  const root = document.createElement('div');
  root.className = 'bsv';
  root.innerHTML = `
    <div class="bsv-backdrop" data-close></div>
    <section class="bsv-panel" role="dialog" aria-modal="true" aria-labelledby="bsv-title" tabindex="-1">
      <div class="bsv-top">
        <div class="bsv-grab" aria-hidden="true"></div>
        <button type="button" class="icon-btn bsv-x" data-close aria-label="Close">${icons.close}</button>
        <div class="bsv-head" data-head></div>
      </div>
      <div class="bsv-scroll" data-scroll></div>
      <div class="bsv-foot" data-foot></div>
    </section>`;
  const panel = root.querySelector('.bsv-panel');
  const head = root.querySelector('[data-head]');
  const scroll = root.querySelector('[data-scroll]');
  const foot = root.querySelector('[data-foot]');
  const before = document.activeElement;

  const draw = (moved) => {
    const p = getProfile();
    if (step === 'summary') {
      shown = [];
      head.innerHTML = '';
      scroll.innerHTML = summaryHTML(p, thanked);
      foot.innerHTML = summaryFootHTML(p);
    } else {
      const q = QUESTIONS[step];
      shown = optionsOf(q, p);
      // The bar stays in place between questions, so it slides along.
      if (!head.querySelector('.bsv-progress')) head.innerHTML = headHTML();
      head.querySelector('[data-section]').textContent = SECTIONS[q.section] || '';
      head.querySelector('[data-count]').textContent = `${step + 1} of ${total}`;
      const bar = head.querySelector('.bsv-progress');
      bar.setAttribute('aria-valuenow', String(step + 1));
      bar.setAttribute('aria-valuetext', `Question ${step + 1} of ${total}`);
      bar.querySelector('i').style.width = `${(((step + 1) / total) * 100).toFixed(1)}%`;
      scroll.innerHTML = questionHTML(q, p, shown);
      foot.innerHTML = questionFootHTML(step, editing, p);
    }
    root.classList.toggle('is-summary', step === 'summary');
    if (moved) {
      scroll.scrollTop = 0;
      try { scroll.querySelector('#bsv-title')?.focus({ preventScroll: true }); } catch {}
    }
  };

  /** After a tap: ticks, Skip and Next follow the saved answer without redrawing the question. */
  const sync = () => {
    if (step === 'summary') return;
    const p = getProfile();
    const q = QUESTIONS[step];
    const chosen = picked(q, p);
    for (const b of scroll.querySelectorAll('[data-n]')) b.setAttribute('aria-checked', String(chosen.includes(shown[Number(b.dataset.n)]?.v)));
    const skip = foot.querySelector('[data-sv="skip"]');
    if (skip) skip.hidden = chosen.length > 0;
    const next = foot.querySelector('[data-sv="next"]');
    if (next && !editing) next.disabled = !chosen.length;
  };

  const leave = () => { if (step !== 'summary') QUESTIONS[step].leave?.(fresh); };

  const go = (to, edit = editing) => {
    clearTimeout(timer);
    leave();
    if (to === 'summary' && !editing) thanked = true;
    step = to;
    editing = edit;
    draw(true);
  };

  // Next and Skip go on to the next unanswered question; when changing one answer, back to the summary.
  const after = (i) => {
    if (editing) return 'summary';
    const n = nextUnanswered(i + 1);
    return n < 0 ? 'summary' : n;
  };

  const choose = (n) => {
    const q = QUESTIONS[step];
    const o = shown[n];
    if (!q || !o) return;
    clearTimeout(timer);
    if (q.multi) {
      let next = picked(q, getProfile());
      if (next.includes(o.v)) next = next.filter((x) => x !== o.v);
      else if (o.v === q.exclusive) next = [o.v];
      else {
        next = [...next.filter((x) => x !== q.exclusive), o.v];
        if (q.custom) fresh.add(o.v);
      }
      if (!q.tapOrder) next = shown.map((x) => x.v).filter((v) => next.includes(v));
      q.set(next);
      sync();
      return;
    }
    q.set(o.v);
    sync();
    // A single choice moves on by itself after a moment, unless this was the last one left (Finish stays a choice).
    const to = after(step);
    if (editing || to !== 'summary') {
      const at = step;
      timer = setTimeout(() => { if (!closed && step === at) go(to); }, ADVANCE_MS);
    }
  };

  const addOwnGoal = (form) => {
    const q = QUESTIONS[step];
    const input = form.querySelector('input');
    const t = input.value.trim().replace(/\s+/g, ' ').slice(0, GOAL_MAX);
    if (!q?.custom || !t) return;
    const same = (x) => x.toLowerCase() === t.toLowerCase();
    const chosen = picked(q, getProfile());
    const label = PRESET_GOALS.find((o) => same(o.v))?.v || chosen.find(same) || t;
    if (!chosen.includes(label)) chosen.push(label);
    fresh.add(label);
    q.set(chosen);
    draw(false);
    try { scroll.querySelector('[data-add] input')?.focus({ preventScroll: true }); } catch {}
  };

  root.addEventListener('click', (e) => {
    const hit = (sel) => e.target.closest(sel);
    let b;
    if (hit('[data-close]')) { close(); return; }
    if ((b = hit('[data-n]')) && step !== 'summary') { choose(Number(b.dataset.n)); return; }
    if ((b = hit('[data-sv]'))) {
      const act = b.dataset.sv;
      if (act === 'back') go(editing ? 'summary' : Math.max(0, step - 1));
      else if (act === 'skip' || act === 'next') go(after(step));
      else if (act === 'rest') {
        const n = nextUnanswered(0);
        go(n < 0 ? 'summary' : n, false);
      }
      return;
    }
    if ((b = hit('[data-edit]'))) go(Number(b.dataset.edit), true);
  });
  root.addEventListener('input', (e) => {
    const form = e.target.closest('[data-add]');
    if (form) form.querySelector('button').disabled = !e.target.value.trim();
  });
  root.addEventListener('submit', (e) => {
    const form = e.target.closest('[data-add]');
    if (!form) return;
    e.preventDefault();
    addOwnGoal(form);
  });

  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);

  // Swipe down to close: from the top of the sheet, or from the question once it is scrolled to the top.
  let startY = null;
  let dy = 0;
  panel.addEventListener('touchstart', (e) => {
    const t = e.target;
    const ok = !t.closest('[data-foot], input') && (!t.closest('[data-scroll]') || scroll.scrollTop <= 0);
    startY = ok ? e.touches[0].clientY : null;
    dy = 0;
  }, { passive: true });
  panel.addEventListener('touchmove', (e) => {
    if (startY == null) return;
    dy = Math.max(0, e.touches[0].clientY - startY);
    if (dy > 6) { panel.style.transition = 'none'; panel.style.transform = `translateY(${dy}px)`; }
  }, { passive: true });
  const release = () => {
    if (startY == null) return;
    panel.style.transition = '';
    if (dy > 90) { panel.style.transform = 'translateY(110%)'; close(); } else panel.style.transform = '';
    startY = null;
  };
  panel.addEventListener('touchend', release);
  panel.addEventListener('touchcancel', release);

  function close(now = false) {
    if (closed) return;
    closed = true;
    clearTimeout(timer);
    leave();
    if (current === handle) current = null;
    document.removeEventListener('keydown', onKey);
    document.body.classList.remove('bsv-lock');
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (now || reduce) root.remove();
    else {
      root.classList.remove('is-in');
      root.classList.add('is-out');
      setTimeout(() => root.remove(), 260);
    }
    if (!now) { try { if (before?.isConnected) before.focus({ preventScroll: true }); } catch {} }
    try { onClose?.(!now); } catch (err) { console.error(err); } // after the focus, so the opener can move it
  }

  const handle = { close };
  current = handle;
  draw(false);
  document.body.append(root);
  document.body.classList.add('bsv-lock');
  requestAnimationFrame(() => { if (!closed) root.classList.add('is-in'); });
  try { panel.focus({ preventScroll: true }); } catch {}
  return handle;
}
