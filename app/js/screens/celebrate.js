// Save celebration (#celebrate/<dreamId>): the short sequence shown right after a new dream is saved.
// Steps: the dream card flies in + "Dream saved!" → level ring → this month's recall chart → next technique
// → one reveal per technique this save unlocked → newly unlocked analysis modules.
// Tap anywhere or Continue to advance; Skip finishes. Finishing replaces the route with #dream/<id>.
// Opening an unlocked technique does NOT mark it seen, so the Lucidity tab keeps its "new" dot.
// No DOM, window or storage access at import time.
import { getDream, listDreams, recallByDay, withDefaults } from '../store.js';
import { TECHNIQUES, levelFor, unlockState, nextTechnique, unlockedBy } from '../progress.js';
import { dreamArtURL } from '../dreamart.js';
import { esc, formatDate, icons } from '../ui.js';

// Our own one-line descriptions for the unlock reveal.
const TAGLINES = {
  'reality-checks': 'Small tests during the day that teach you to notice when you are dreaming.',
  wild: 'Drift from waking straight into a dream while part of your mind stays aware.',
  'audio-cues': 'Soft sounds while you sleep that remind you to look around.',
  mild: 'Set a clear intention to recognise your next dream as a dream.',
  wbtb: 'Wake briefly in the early morning, then go back to sleep with intent.',
  ssild: 'Cycle gently through sight, sound and touch as you fall asleep.',
  finger: 'Tiny, almost-still finger movements that keep you aware while sleep comes.',
  anchor: 'Link an everyday object to the question "am I dreaming?".',
  counting: 'Count slowly as you drift off to keep a thread of awareness.',
  conditioning: 'Train a sound cue by day so it can wake your awareness at night.',
};
const TECH_ICONS = {
  'reality-checks': 'lucidity', wild: 'moon', 'audio-cues': 'headphones', mild: 'sparkle', wbtb: 'bell',
  ssild: 'wave', finger: 'repeat', anchor: 'target', counting: 'list', conditioning: 'music',
};
const HUES = [265, 285, 205, 320, 240, 185, 300, 42, 222, 335];

const techIcon = (id) => icons[TECH_ICONS[id]] || icons.sparkle;
const hueFor = (id) => HUES[Math.max(0, TECHNIQUES.findIndex((t) => t.id === id)) % HUES.length];
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

let timers = [];
let confettiRaf = 0;
let cleanups = [];

function later(fn, ms) {
  timers.push(setTimeout(fn, ms));
}
function clearTimers() {
  for (const t of timers) clearTimeout(t);
  timers = [];
}
function teardown() {
  clearTimers();
  if (confettiRaf) cancelAnimationFrame(confettiRaf);
  confettiRaf = 0;
  for (const fn of cleanups) { try { fn(); } catch {} }
  cleanups = [];
}

const reducedMotion = () => {
  try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
};

// ---- Copy ----

function streakNights() {
  const days = recallByDay(120);
  let i = days.length - 1;
  if (days[i]?.count === 0) i -= 1; // a streak still counts if today's dream isn't in yet
  let n = 0;
  while (i >= 0 && days[i].count > 0) { n += 1; i -= 1; }
  return n;
}

function savedLine(count, milestone) {
  if (milestone === 'first') return 'Your first dream is in the journal. This is where it begins.';
  const special = {
    5: 'Five dreams written down. A habit is taking shape.',
    10: 'Ten dreams in your journal. You are building something real.',
    25: 'Twenty-five dreams. Your journal is becoming a map of your nights.',
    50: 'Fifty dreams. That is a true archive of your nights.',
    100: 'One hundred dreams. That takes real dedication.',
  };
  if (special[milestone]) return special[milestone];
  const streak = streakNights();
  if (streak >= 2) return `${streak} nights in a row with a dream. Keep it going.`;
  const lines = [
    `Dream number ${count} is safe in your journal.`,
    'Another night remembered. Nicely done.',
    'Writing it down is how a dream stays with you.',
    'Every dream you keep adds to the story of your nights.',
  ];
  return lines[count % lines.length];
}

const levelNext = (lv, count) => (lv.nextMin != null
  ? `${plural(lv.nextMin - count, 'more dream')} to Level ${lv.level + 1} · ${esc(lv.nextName)}`
  : 'You have reached the highest level.');

// ---- Progress rings ----

function ringSVG(kind) {
  const S = 120;
  const W = kind === 'tech' ? 10 : 6;
  const r = (S - W) / 2 - 3;
  const c = 2 * Math.PI * r;
  const stops = kind === 'tech'
    ? '<stop offset="0" stop-color="#fff0c8"/><stop offset="1" stop-color="#ffd98a"/>'
    : '<stop offset="0" stop-color="#c9b4ff"/><stop offset="0.6" stop-color="#9b7bff"/><stop offset="1" stop-color="#f29a8c"/>';
  const dots = kind === 'level'
    ? `<circle class="cel-ring-dot" cx="60" cy="${60 - r}" r="2.4"/><circle class="cel-ring-dot" cx="60" cy="${60 + r}" r="2.4"/>`
    : '';
  return `<svg class="cel-ring cel-ring--${kind}" viewBox="0 0 ${S} ${S}" aria-hidden="true" focusable="false">
    <defs><linearGradient id="cel-grad-${kind}" x1="0" y1="0" x2="1" y2="1">${stops}</linearGradient></defs>
    <circle class="cel-ring-track" cx="60" cy="60" r="${r}" stroke-width="${W}"/>
    ${dots}
    <circle class="cel-ring-arc" cx="60" cy="60" r="${r}" stroke-width="${W}" stroke="url(#cel-grad-${kind})"
      stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${c.toFixed(2)}" data-c="${c}" transform="rotate(-90 60 60)" style="opacity:0"/>
  </svg>`;
}

function setRing(svg, p, instant = false) {
  const arc = svg?.querySelector('.cel-ring-arc');
  if (!arc) return;
  const c = Number(arc.dataset.c);
  const v = Math.min(1, Math.max(0, p || 0));
  if (instant) arc.style.transition = 'none';
  arc.style.strokeDashoffset = String(c * (1 - v));
  arc.style.opacity = v > 0.001 ? '1' : '0';
  if (instant) { arc.getBoundingClientRect(); arc.style.transition = ''; }
}

// ---- Confetti (canvas) ----

function confetti(canvas, { originY = 0.32, count = 90 } = {}) {
  if (!canvas || typeof window === 'undefined') return;
  if (confettiRaf) cancelAnimationFrame(confettiRaf);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = canvas.clientWidth || window.innerWidth;
  const h = canvas.clientHeight || window.innerHeight;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const g = canvas.getContext('2d');
  if (!g) return;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const colors = ['#ffd98a', '#9b7bff', '#cbb9ff', '#ff9f8f', '#9fdcff', '#f6efff'];
  const parts = Array.from({ length: count }, () => {
    const a = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.15;
    const speed = 4 + Math.random() * 8;
    return {
      x: w / 2 + (Math.random() - 0.5) * 40,
      y: h * originY,
      vx: Math.cos(a) * speed,
      vy: Math.sin(a) * speed,
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.3,
      size: 4 + Math.random() * 5,
      shape: Math.random() < 0.25 ? 'star' : Math.random() < 0.5 ? 'dot' : 'rect',
      color: colors[(Math.random() * colors.length) | 0],
    };
  });
  const start = performance.now();
  let last = start;
  const DURATION = 3200;
  const frame = (now) => {
    const dt = Math.min(3, (now - last) / 16.67);
    last = now;
    const t = now - start;
    g.clearRect(0, 0, w, h);
    const alpha = t > DURATION - 900 ? Math.max(0, (DURATION - t) / 900) : 1;
    let alive = false;
    for (const p of parts) {
      p.vx *= 0.985 ** dt;
      p.vy = p.vy * 0.985 ** dt + 0.17 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      if (p.y > h + 20) continue;
      alive = true;
      g.save();
      g.globalAlpha = alpha;
      g.translate(p.x, p.y);
      g.rotate(p.rot);
      g.fillStyle = p.color;
      if (p.shape === 'rect') g.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      else if (p.shape === 'dot') { g.beginPath(); g.arc(0, 0, p.size / 3, 0, Math.PI * 2); g.fill(); }
      else {
        const s = p.size * 0.7;
        g.beginPath();
        g.moveTo(0, -s); g.lineTo(s * 0.25, -s * 0.25); g.lineTo(s, 0); g.lineTo(s * 0.25, s * 0.25);
        g.lineTo(0, s); g.lineTo(-s * 0.25, s * 0.25); g.lineTo(-s, 0); g.lineTo(-s * 0.25, -s * 0.25);
        g.closePath();
        g.fill();
      }
      g.restore();
    }
    if (alive && t < DURATION) confettiRaf = requestAnimationFrame(frame);
    else { g.clearRect(0, 0, w, h); confettiRaf = 0; }
  };
  confettiRaf = requestAnimationFrame(frame);
}

// ---- Step markup ----

function savedHTML(dream, count, milestone) {
  const art = dreamArtURL(dream, 260);
  return `<div class="cel-saved">
    <div class="cel-cardwrap">
      <span class="cel-cardglow" aria-hidden="true"></span>
      <span class="cel-frame" aria-hidden="true"></span>
      <article class="cel-card">
        ${art ? `<img class="cel-card-img" src="${art}" alt="">` : '<div class="cel-card-img"></div>'}
        <div class="cel-card-body">
          <i class="cel-dash" aria-hidden="true"></i>
          <h3 class="cel-card-title">${esc(dream.title || 'Untitled dream')}</h3>
          <p class="cel-card-date">${esc(formatDate(dream.date))}</p>
        </div>
      </article>
    </div>
    <h1 class="cel-h">Dream saved!</h1>
    <p class="cel-sub">${esc(savedLine(count, milestone))}</p>
  </div>`;
}

function chartHTML() {
  const now = new Date();
  const today = now.getDate();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const counts = recallByDay(today).map((d) => d.count); // the 1st of this month … today
  const max = Math.max(1, ...counts);
  const total = counts.reduce((a, b) => a + b, 0);
  const nights = counts.filter(Boolean).length;
  const month = now.toLocaleDateString(undefined, { month: 'long' });
  const marks = [1, 8, 15, 22, 29];
  let cols = '';
  for (let day = 1; day <= daysInMonth; day += 1) {
    const c = day <= today ? counts[day - 1] || 0 : null;
    const isToday = day === today;
    const state = c === null ? 'is-future' : c > 0 ? 'is-on' : 'is-empty';
    const bar = c > 0
      ? `<i class="cel-bar" style="--h:${Math.max(12, Math.round((c / max) * 96))}px;--i:${day}"></i>`
      : '<i class="cel-bar"></i>';
    const label = isToday || (marks.includes(day) && Math.abs(day - today) > 2) ? day : '';
    cols += `<div class="cel-col ${state}${isToday ? ' is-today' : ''}">
      <span class="cel-barslot">${isToday && c > 0 ? `<b class="cel-val">${c}</b>` : ''}${bar}</span>
      <span class="cel-day">${label}</span>
    </div>`;
  }
  return `<h2 class="cel-chart-title">Recall <span aria-hidden="true">·</span> ${esc(month)}</h2>
    <div class="cel-bars" role="img" aria-label="${esc(`${plural(total, 'dream')} recorded in ${month} so far`)}">${cols}</div>
    <p class="cel-chart-sum">${plural(total, 'dream')} this month · ${plural(nights, 'night')} with a dream</p>`;
}

function levelHTML(lvShown, sub) {
  return `<div class="cel-levelbox">
      <div class="cel-ringbox">
        ${ringSVG('level')}
        <div class="cel-orb" aria-hidden="true">
          <span class="cel-orb-star s1"></span><span class="cel-orb-star s2"></span><span class="cel-orb-star s3"></span>
          <span class="cel-orb-moon">${icons.moon}</span>
          <span class="cel-orb-horizon"></span>
        </div>
      </div>
      <p class="cel-levelup">Level up!</p>
      <span class="cel-pill">${icons.star}<b>Level ${lvShown.level} · ${esc(lvShown.name)}</b></span>
      <p class="cel-levelsub">${sub}</p>
    </div>
    <section class="cel-chart glass" aria-label="Dreams recorded this month">${chartHTML()}</section>`;
}

function techPlan(count, got) {
  const before = Math.max(0, count - 1);
  const crossed = got.techniques;
  const target = crossed.length ? crossed[crossed.length - 1] : nextTechnique(count);
  if (!target) return null;
  const prev = unlockState(TECHNIQUES, before).find((x) => x.id === target.id);
  return {
    target,
    unlocking: crossed.length > 0,
    fromP: prev?.unlocked ? 0 : prev?.progress ?? 0,
    toP: crossed.length ? 1 : target.progress,
    fromToGo: prev?.toGo ?? target.toGo,
    toGo: crossed.length ? 0 : target.toGo,
    before,
  };
}

function techHTML(plan) {
  if (!plan) {
    return `<p class="cel-eyebrow">Lucid dreaming</p>
      <div class="cel-tech glass is-unlocked">
        <div class="cel-tech-row">
          <span class="cel-tech-icon">${icons.check}</span>
          <div class="cel-tech-text"><p class="cel-tech-cap">Techniques</p>
            <h2 class="cel-tech-name">Every technique is unlocked</h2>
            <p class="cel-tech-status">Keep practising them in the Lucidity tab.</p></div>
          <div class="cel-tech-ringbox">${ringSVG('tech')}<span class="cel-tech-check">${icons.check}</span></div>
        </div>
      </div>`;
  }
  const { target, before, unlocking } = plan;
  const sorted = [...TECHNIQUES].sort((a, b) => a.unlockAt - b.unlockAt);
  const ti = sorted.findIndex((x) => x.id === target.id);
  const start = Math.max(0, Math.min(ti - 2, sorted.length - 5));
  const win = sorted.slice(start, start + 5);
  const nodes = win.map((x) => {
    const cls = x.id === target.id ? 'is-target' : before >= x.unlockAt ? 'is-done' : 'is-locked';
    return `<span class="cel-path-node ${cls}" data-id="${esc(x.id)}" title="${esc(x.name)}">${techIcon(x.id)}</span>`;
  }).join('<i class="cel-path-dash"></i>');
  const edgeL = start > 0 ? '<i class="cel-path-dash is-edge"></i>' : '';
  const edgeR = start + win.length < sorted.length ? '<i class="cel-path-dash is-edge"></i>' : '';
  return `<p class="cel-eyebrow">Lucid dreaming</p>
    <div class="cel-tech glass">
      <div class="cel-path" aria-hidden="true">${edgeL}${nodes}${edgeR}</div>
      <div class="cel-tech-row">
        <span class="cel-tech-icon">${techIcon(target.id)}</span>
        <div class="cel-tech-text">
          <p class="cel-tech-cap">Next technique</p>
          <h2 class="cel-tech-name">${esc(target.name)}</h2>
          <p class="cel-tech-status" aria-live="polite">${plural(plan.fromToGo, 'dream')} to go</p>
        </div>
        <div class="cel-tech-ringbox">${ringSVG('tech')}<span class="cel-tech-check">${icons.check}</span></div>
      </div>
    </div>
    <p class="cel-tech-foot">${unlocking ? 'Tap to see what you just unlocked.' : 'Keep writing dreams to unlock new techniques.'}</p>`;
}

function revealHTML(t) {
  return `<div class="cel-reveal">
    <p class="cel-new">${icons.sparkle}New technique unlocked</p>
    <div class="cel-tcard" style="--hue:${hueFor(t.id)}">
      <div class="cel-tcard-art" aria-hidden="true">${techIcon(t.id)}</div>
      <h2 class="cel-tcard-name">${esc(t.name)}</h2>
    </div>
    <p class="cel-tagline">${esc(TAGLINES[t.id] || 'A new way to become aware inside your dreams.')}</p>
    <p class="cel-reveal-note">It is waiting for you in the Lucidity tab.</p>
  </div>`;
}

function modulesHTML(mods) {
  return `<div class="cel-modules">
    <span class="cel-mod-badge" aria-hidden="true">${icons.progress}</span>
    <p class="cel-new">${icons.sparkle}New on your Progress tab</p>
    <h1 class="cel-h">${mods.length > 1 ? 'New analyses unlocked' : 'New analysis unlocked'}</h1>
    <p class="cel-sub">Your journal now holds enough dreams for a closer look.</p>
    <div class="cel-mod-list">${mods.map((m) => `
      <button type="button" class="cel-mod glass" data-act="module" data-id="${esc(m.id)}">
        <span class="cel-mod-icon">${icons.progress}</span>
        <span class="cel-mod-name">${esc(m.name)}</span>${icons.chevronRight}
      </button>`).join('')}
    </div>
  </div>`;
}

function skyHTML() {
  let stars = '';
  for (let i = 0; i < 30; i += 1) {
    stars += `<i style="left:${(Math.random() * 100).toFixed(1)}%;top:${(Math.random() * 100).toFixed(1)}%;--s:${(1 + Math.random() * 1.8).toFixed(1)}px;--d:${(Math.random() * 4).toFixed(2)}s"></i>`;
  }
  return `<div class="cel-sky" aria-hidden="true">${stars}</div>`;
}

// ---- Screen ----

export default {
  id: 'celebrate',
  hideTabbar: true,

  render(el, ctx, param) {
    teardown();
    const raw = param ? getDream(param) : null;
    if (!raw) { location.replace('#journal'); return; }

    const dream = withDefaults(raw);
    const count = Math.max(1, listDreams().length);
    const got = unlockedBy(count);
    const lvBefore = levelFor(Math.max(0, count - 1));
    const lv = levelFor(count);
    const plan = techPlan(count, got);
    const still = reducedMotion();
    const steps = [
      { kind: 'saved' },
      { kind: 'level' },
      { kind: 'recall' },
      { kind: 'technique' },
      ...got.techniques.map((t) => ({ kind: 'reveal', t })),
      ...(got.modules.length ? [{ kind: 'modules' }] : []),
    ];

    el.innerHTML = `<div class="cel" role="dialog" aria-modal="true" aria-label="Dream saved">
      ${skyHTML()}
      <canvas class="cel-confetti" aria-hidden="true"></canvas>
      <header class="cel-top">
        <div class="cel-dots" aria-hidden="true">${steps.map(() => '<i></i>').join('')}</div>
        <button type="button" class="cel-skip" data-act="skip">Skip</button>
      </header>
      <div class="cel-stage"></div>
      <footer class="cel-foot"></footer>
    </div>`;

    const root = el.querySelector('.cel');
    const stage = root.querySelector('.cel-stage');
    const foot = root.querySelector('.cel-foot');
    const canvas = root.querySelector('.cel-confetti');
    const dots = [...root.querySelectorAll('.cel-dots i')];

    let index = -1;
    let finalize = null;
    let shownAt = 0;

    const go = (hash) => { teardown(); location.replace(hash); };
    const finish = () => go(`#dream/${encodeURIComponent(dream.id)}`);
    const advance = () => (index >= steps.length - 1 ? finish() : show(index + 1));

    // Level ring: fills from where it stood before this save; a level-up fills it and swaps the pill.
    function mountLevel() {
      const box = stage.querySelector('.cel-levelbox');
      const svg = box.querySelector('.cel-ring');
      const up = got.levelUp;
      const target = up ? 1 : lv.progress;
      let leveled = false;
      const applyLevelUp = (burst) => {
        if (!up || leveled) return;
        leveled = true;
        box.classList.add('is-levelup');
        box.querySelector('.cel-pill b').textContent = `Level ${up.level} · ${up.name}`;
        box.querySelector('.cel-levelsub').innerHTML = levelNext(up, count);
        if (burst && !still) confetti(canvas, { originY: 0.3, count: 70 });
      };
      setRing(svg, lvBefore.progress, true);
      if (still) { setRing(svg, target, true); applyLevelUp(false); return null; }
      later(() => setRing(svg, target), 380);
      if (up) later(() => applyLevelUp(true), 1650);
      return () => { setRing(svg, target, true); applyLevelUp(false); };
    }

    function mountRecall() {
      stage.classList.add('is-recall');
      const chart = stage.querySelector('.cel-chart');
      if (still) { chart?.classList.add('is-in'); return null; }
      later(() => chart?.classList.add('is-in'), 420);
      return () => chart?.classList.add('is-in');
    }

    function mountTech() {
      const svg = stage.querySelector('.cel-ring');
      if (!plan) { setRing(svg, 1, true); return null; }
      const card = stage.querySelector('.cel-tech');
      const status = stage.querySelector('.cel-tech-status');
      const done = () => {
        setRing(svg, plan.toP, true);
        if (plan.unlocking) {
          card.classList.add('is-unlocked');
          stage.querySelector('.cel-path-node.is-target')?.classList.add('is-done');
          status.textContent = 'Unlocked!';
        } else {
          status.textContent = `${plural(plan.toGo, 'dream')} to go`;
        }
      };
      setRing(svg, plan.fromP, true);
      if (still) { done(); return null; }
      later(() => setRing(svg, plan.toP), 420);
      later(() => { status.textContent = `${plural(plan.toGo, 'dream')} to go`; }, 1550);
      if (plan.unlocking) later(done, 2300);
      else later(done, 1550);
      return done;
    }

    function renderFoot(step, last) {
      const nextLabel = last ? 'View my dream' : 'Continue';
      if (step.kind === 'reveal') {
        foot.innerHTML = `<button type="button" class="btn" data-act="open">${icons.lucidity}Open technique</button>
          <button type="button" class="btn btn-ghost" data-act="next">${nextLabel}</button>`;
      } else {
        foot.innerHTML = `<button type="button" class="btn" data-act="next">${nextLabel}</button>
          ${step.kind === 'saved' ? '<p class="cel-hint">or tap anywhere</p>' : ''}`;
      }
    }

    function show(i) {
      try { finalize?.(); } catch {}
      clearTimers();
      finalize = null;
      const prev = steps[index];
      index = i;
      const step = steps[i];
      shownAt = Date.now();
      dots.forEach((d, n) => { d.className = n === i ? 'is-active' : n < i ? 'is-past' : ''; });

      if (step.kind === 'recall' && prev?.kind === 'level') {
        finalize = mountRecall();
      } else {
        stage.className = 'cel-stage';
        stage.scrollTop = 0;
        if (step.kind === 'saved') stage.innerHTML = savedHTML(dream, count, got.milestone);
        else if (step.kind === 'level' || step.kind === 'recall') {
          stage.innerHTML = levelHTML(got.levelUp ? lvBefore : lv, got.levelUp ? '&nbsp;' : levelNext(lv, count));
          finalize = mountLevel();
          if (step.kind === 'recall') { try { finalize?.(); } catch {} finalize = mountRecall(); }
        } else if (step.kind === 'technique') {
          stage.innerHTML = techHTML(plan);
          finalize = mountTech();
        } else if (step.kind === 'reveal') {
          stage.innerHTML = revealHTML(step.t);
          if (!still) later(() => confetti(canvas, { originY: 0.34, count: 110 }), 260);
        } else if (step.kind === 'modules') {
          stage.innerHTML = modulesHTML(got.modules);
          if (!still && !got.techniques.length) later(() => confetti(canvas, { originY: 0.3, count: 80 }), 260);
        }
      }
      renderFoot(step, i === steps.length - 1);
      foot.querySelector('button')?.focus({ preventScroll: true });
    }

    root.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-act]');
      if (btn) {
        const act = btn.dataset.act;
        if (act === 'skip') finish();
        else if (act === 'next') advance();
        else if (act === 'open') go(`#technique/${encodeURIComponent(steps[index].t.id)}`);
        else if (act === 'module') go(`#module/${encodeURIComponent(btn.dataset.id)}`);
        return;
      }
      if (e.target.closest('button, a')) return;
      if (Date.now() - shownAt < 350) return; // ignore an accidental double tap
      advance();
    });

    const onKey = (e) => {
      if (e.key === 'Escape') finish();
      else if (e.key === 'ArrowRight') advance();
    };
    document.addEventListener('keydown', onKey);
    cleanups.push(() => document.removeEventListener('keydown', onKey));

    show(0);
  },

  destroy() {
    teardown();
  },
};
