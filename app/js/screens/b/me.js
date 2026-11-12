// New layout: Profile tab (#me), following the owner's structure, top to bottom:
//   you (picture, name, dreams recorded, days on the app) · your plan with this month's balance
//   (video credits, AI images, interpretations) and Get more / Redeem a code · Personalise Dreaming (how many
//   questions are answered, and a button that opens the survey sheet from survey.js: the first version's welcome
//   questions plus the ones that used to sit in Insights) · Notifications · Settings (#profile, where everything else
//   lives: app layout, passcode, export, about) · "Kept only on this iPhone" (no account, no cloud copy; links to
//   Export, moved here from the Journal).
// #me/survey opens the survey straight away, then the address goes back to #me.
// The picture is saved on the profile as `avatar`: one of the emoji below, or a 160×160 JPEG data URL made on this
// phone from a photo. It never leaves the iPhone. Settings' own name / plan code stays in profile.js; this tab only
// reads the same data. Touches document/window/storage only inside render and event handlers, never at import time.
import { getProfile, setProfile, getStats, getSetting, listDreams, onChange } from '../../store.js';
import { esc, icons } from '../../ui.js';
import { getAccount, cachedAccount } from '../../account.js';
import { plusPill, planLimits, renewDate, formatUntil } from '../../paywall.js';
import { openSurvey, surveyProgress } from './survey.js';

const AVATAR_PX = 160;   // saved photo size (square), about 8 KB as JPEG
const AVATAR_Q = 0.8;    // JPEG quality
const NAME_MAX = 40;

const AVATARS = [
  { e: '🌙', label: 'Moon' }, { e: '⭐', label: 'Star' }, { e: '☁️', label: 'Cloud' }, { e: '🦉', label: 'Owl' },
  { e: '🐱', label: 'Cat' }, { e: '🌊', label: 'Wave' }, { e: '🦋', label: 'Butterfly' }, { e: '🔮', label: 'Crystal ball' },
  { e: '🪐', label: 'Planet' }, { e: '🦊', label: 'Fox' }, { e: '🌸', label: 'Blossom' }, { e: '🐋', label: 'Whale' },
];

const isPhoto = (a) => typeof a === 'string' && /^data:image\/(jpeg|png|webp);base64,/.test(a);
const isEmoji = (a) => typeof a === 'string' && !isPhoto(a) && a.length > 0 && a.length <= 16;
const hasPicture = (p) => isPhoto(p.avatar) || isEmoji(p.avatar);

// Kept while the screen is open; reset each time the tab is opened.
let pickerOpen = false;
let cleanup = null;
let survey = null; // the open survey sheet, if any

// ---- Picture ----

/** What fills the round picture: the photo, the emoji, the name's first letter, or a moon. */
function faceHTML(p) {
  if (isPhoto(p.avatar)) return `<img class="bm-avatar-photo" src="${esc(p.avatar)}" alt="" width="72" height="72">`;
  if (isEmoji(p.avatar)) return `<span class="bm-avatar-emoji">${esc(p.avatar)}</span>`;
  const name = String(p.name ?? '').trim();
  return name ? `<span class="bm-avatar-initial">${esc([...name][0].toUpperCase())}</span>` : icons.moon;
}

const loadImage = (url) => new Promise((resolve, reject) => {
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = () => reject(new Error('unreadable'));
  img.src = url;
});

/** The chosen photo as a centre-cropped AVATAR_PX square JPEG data URL. */
async function photoAvatar(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    if (!w || !h) throw new Error('unreadable');
    let src = img;
    let s = Math.min(w, h);
    let sx = (w - s) / 2;
    let sy = (h - s) / 2;
    // Halve in steps so a large photo shrinks smoothly instead of in one jagged jump.
    while (s > AVATAR_PX * 2) {
      const n = Math.round(s / 2);
      const step = document.createElement('canvas');
      step.width = n;
      step.height = n;
      step.getContext('2d').drawImage(src, sx, sy, s, s, 0, 0, n, n);
      if (src !== img) { src.width = 0; src.height = 0; } // frees canvas memory early (iOS keeps a tight budget)
      src = step;
      s = n;
      sx = 0;
      sy = 0;
    }
    const out = document.createElement('canvas');
    out.width = AVATAR_PX;
    out.height = AVATAR_PX;
    const c = out.getContext('2d');
    c.fillStyle = '#1c1442'; // behind transparent PNGs
    c.fillRect(0, 0, AVATAR_PX, AVATAR_PX);
    c.imageSmoothingEnabled = true;
    c.imageSmoothingQuality = 'high';
    c.drawImage(src, sx, sy, s, s, 0, 0, AVATAR_PX, AVATAR_PX);
    if (src !== img) { src.width = 0; src.height = 0; }
    const data = out.toDataURL('image/jpeg', AVATAR_Q);
    out.width = 0;
    out.height = 0;
    if (!isPhoto(data)) throw new Error('unreadable');
    return data;
  } finally {
    URL.revokeObjectURL(url);
  }
}

// ---- You ----

/** Days on the app, counting the first one: since onboarding, or the oldest dream if that came earlier. */
function daysOnApp() {
  let first = Date.parse(getProfile().onboardedAt);
  for (const d of listDreams()) {
    const t = Date.parse(d.createdAt);
    if (Number.isFinite(t) && (!Number.isFinite(first) || t < first)) first = t;
  }
  const start = Number.isFinite(first) ? new Date(first) : new Date();
  const midnight = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return Math.max(1, Math.round((midnight(new Date()) - midnight(start)) / 86400000) + 1);
}

function statsHTML() {
  const total = getStats().total;
  const days = daysOnApp();
  return `
    <div class="bm-stats" data-stats>
      <div class="bm-stat">
        <span class="bm-stat-num">${total}</span>
        <span class="bm-stat-label">${total === 1 ? 'Dream recorded' : 'Dreams recorded'}</span>
      </div>
      <div class="bm-stat">
        <span class="bm-stat-num">${days}</span>
        <span class="bm-stat-label">${days === 1 ? 'Day on the app' : 'Days on the app'}</span>
      </div>
    </div>`;
}

function userCard() {
  const p = getProfile();
  const name = String(p.name ?? '').trim();
  const pictured = hasPicture(p);
  return `
    <section class="glass bm-user" data-user aria-label="You">
      <div class="bm-user-top">
        <button class="bm-avatar" type="button" data-avatar aria-controls="bm-picker" aria-expanded="${pickerOpen}"
          aria-label="${pictured ? 'Change your picture' : 'Choose a picture'}">
          <span class="bm-avatar-face">${faceHTML(p)}</span>
          <span class="bm-avatar-badge" aria-hidden="true">${icons.edit}</span>
        </button>
        <div class="bm-who" data-who>
          <div class="bm-name-row">
            <h2 class="bm-name${name ? '' : ' is-empty'}"${name ? '' : ' data-edit-name'}>${name ? esc(name) : 'Add your name'}</h2>
            <button class="bm-edit" type="button" data-edit-name aria-label="${name ? 'Edit your name' : 'Add your name'}">${icons.edit}</button>
          </div>
          ${pictured ? '' : '<p class="bm-hint">Tap the circle to choose a picture.</p>'}
          <form class="bm-name-form" data-name-form hidden>
            <input class="field bm-name-input" type="text" name="name" maxlength="${NAME_MAX}" autocomplete="nickname"
              enterkeyhint="done" placeholder="Your name" value="${esc(name)}" aria-label="Your name">
            <div class="bm-name-actions">
              <button class="btn btn-ghost" type="button" data-cancel-name>Cancel</button>
              <button class="btn" type="submit">Save</button>
            </div>
          </form>
        </div>
      </div>

      <div class="bm-picker" id="bm-picker" data-picker ${pickerOpen ? '' : 'hidden'}>
        <p class="bm-kicker">Choose a picture</p>
        <div class="bm-emojis" role="group" aria-label="Pictures">
          ${AVATARS.map((a, i) => `<button class="bm-emoji" type="button" data-emoji="${i}" aria-label="${esc(a.label)}" aria-pressed="${p.avatar === a.e}">${a.e}</button>`).join('')}
        </div>
        <div class="bm-picker-actions">
          <button class="btn btn-ghost" type="button" data-photo>${icons.image}<span>Choose a photo</span></button>
          ${pictured ? '<button class="btn btn-ghost bm-remove" type="button" data-remove-picture>Remove picture</button>' : ''}
        </div>
        <input type="file" accept="image/*" hidden data-file>
        <p class="bm-picker-note">Your picture stays on this iPhone.</p>
      </div>

      ${statsHTML()}
    </section>`;
}

// ---- Your plan and this month's balance ----

/** One allowance: what is left this month ("50 left of 60"), as in Settings; the bar empties as it is used. */
function balanceLine(label, left, limit) {
  const pct = limit ? Math.min(100, Math.round((left / limit) * 100)) : 0;
  return `
    <div class="bm-use">
      <span class="bm-use-label">${esc(label)}</span>
      <span class="bm-use-num"><b>${left}</b> left of ${limit}</span>
      <span class="bm-bar" role="progressbar" aria-label="${esc(label)} left this month" aria-valuemin="0" aria-valuemax="${limit}" aria-valuenow="${left}"><i style="width:${pct}%"></i></span>
    </div>`;
}

/** Not part of this plan (videos on the free plan): its name and the PLUS pill instead of a bar. */
function lockedLine(label) {
  return `
    <div class="bm-use bm-use-locked">
      <span class="bm-use-label">${esc(label)}</span>
      ${plusPill()}
    </div>`;
}

function planCard() {
  const acc = cachedAccount();
  const plus = acc?.plan === 'plus';
  const until = plus ? formatUntil(acc.plusUntil) : '';
  // An older cached answer may lack a limit (videos came later): the plan's known limits fill the gap.
  const lim = { ...planLimits()[plus ? 'plus' : 'free'], ...(acc?.limits || {}) };
  const used = acc?.used || null;
  const left = (kind) => {
    const r = acc?.remaining?.[kind];
    return Number.isFinite(r) ? Math.max(0, r) : Math.max(0, (lim[kind] ?? 0) - (used?.[kind] || 0));
  };
  const line = (kind, label) => (lim[kind] > 0 ? balanceLine(label, left(kind), lim[kind]) : lockedLine(label));
  return `
    <section class="glass bm-plan${plus ? ' is-plus' : ''}" data-plan aria-label="Your plan">
      <div class="bm-plan-head">
        <span class="bm-plan-icon">${icons.sparkle}</span>
        <span class="bm-plan-who">
          <span class="bm-kicker">Your plan</span>
          <span class="bm-plan-title">${plus ? `Dreaming Plus ${plusPill()}` : 'Free'}</span>
          <span class="bm-plan-sub">${plus ? (until ? `Until ${esc(until)}` : 'Active') : 'Plus adds AI videos, more pictures and more interpretations.'}</span>
        </span>
      </div>
      ${used
        ? `<div class="bm-balance">
            <p class="bm-balance-title">Left this month</p>
            ${line('videos', 'Video credits')}
            ${line('images', 'AI images')}
            ${line('analyses', 'Interpretations')}
            <p class="bm-plan-note">1 video credit = 1 second of Standard video. HD uses 2 per second.</p>
            <p class="bm-plan-note">Everything fills up again on ${esc(renewDate(acc.period))}.</p>
          </div>`
        : '<p class="bm-plan-note bm-plan-offline">Your balance shows once Dreaming is online.</p>'}
      <div class="bm-plan-actions">
        <a class="btn${plus ? ' btn-ghost' : ''}" href="#plus">${plus ? 'View plan' : 'Get more'}</a>
        <a class="btn btn-ghost" href="#profile/redeem">Redeem a code</a>
      </div>
    </section>`;
}

// ---- Personalise Dreaming (the survey itself is in survey.js) ----

function surveyCard() {
  const { done, total } = surveyProgress();
  const all = done >= total;
  const pct = total ? Math.round((done / total) * 100) : 0;
  return `
    <section class="glass bm-survey${all ? ' is-done' : ''}" data-survey-card aria-labelledby="bm-survey-title">
      <div class="bm-survey-head">
        <span class="bm-survey-icon" aria-hidden="true">${all ? icons.check : icons.target}</span>
        <span class="bm-survey-who">
          <h2 class="bm-survey-title" id="bm-survey-title">Personalise Dreaming</h2>
          <span class="bm-survey-sub">${all ? 'All answered. Change them anytime.' : 'Answer a few questions so Dreaming suits you better.'}</span>
        </span>
      </div>
      <div class="bm-survey-progress">
        <span class="bm-survey-count"><b>${done}</b> of ${total} answered</span>
        <span class="bm-bar" role="progressbar" aria-label="Questions answered" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${done}"><i style="width:${pct}%"></i></span>
      </div>
      <button class="btn${all ? ' btn-ghost' : ''} bm-survey-btn" type="button" data-survey="${all ? 'edit' : 'go'}">${all ? 'Edit answers' : done ? 'Continue' : 'Start'}</button>
    </section>`;
}

// ---- Notifications · Settings ----

const row =({ href, icon, hue, label, sub, value = '' }) => `
  <a class="bm-row" href="${href}">
    <span class="bm-tile" style="--bm-hue:${hue}">${icon}</span>
    <span class="bm-row-text">
      <span class="bm-row-label">${esc(label)}</span>
      <span class="bm-row-sub">${esc(sub)}</span>
    </span>
    ${value ? `<span class="bm-row-value">${esc(value)}</span>` : ''}
    <span class="bm-chev">${icons.chevronRight}</span>
  </a>`;

function rowsHTML() {
  // Same rule as Settings: on when either kind of reminder was sent to Calendar.
  const on = getSetting('reminderMorning', false) === true || getSetting('realityReminders', false) === true;
  return `
    <div class="glass bm-group">
      ${row({ href: '#profile/notifications', icon: icons.bell, hue: 265, label: 'Notifications', sub: 'Morning recall and reality checks', value: on ? 'On' : 'Off' })}
      ${row({ href: '#profile', icon: icons.settings, hue: 220, label: 'Settings', sub: 'Layout, passcode, export and more' })}
    </div>`;
}

// ---- Kept only on this iPhone (moved here from the Journal; always shown) ----

const keptNote = () => `
  <section class="glass bm-note" aria-labelledby="bm-note-title">
    <span class="bm-note-icon" aria-hidden="true">${icons.info}</span>
    <div class="bm-note-body">
      <h2 class="bm-note-title" id="bm-note-title">Kept only on this iPhone</h2>
      <p class="bm-note-text">There is no account and no cloud copy. If this phone is lost or the app is removed, your dreams go with it.</p>
      <a class="bm-note-link" href="#profile/export">Export a backup in Settings${icons.chevronRight}</a>
    </div>
  </section>`;

// ---- Screen ----

/** Opens the survey sheet; when the user closes it, the card shows the new count and gets the focus back. */
function startSurvey(el, start) {
  survey = openSurvey(start, {
    onClose(byUser) {
      survey = null;
      if (!byUser) return;
      const card = el.querySelector('.bm [data-survey-card]');
      if (!card) return;
      card.outerHTML = surveyCard();
      try { el.querySelector('.bm [data-survey]')?.focus({ preventScroll: true }); } catch {}
    },
  });
}

function draw(el, ctx) {
  el.innerHTML = `
    <div class="bm">
      <h1 class="screen-title">Profile</h1>
      ${userCard()}
      ${planCard()}
      ${surveyCard()}
      ${rowsHTML()}
      ${keptNote()}
    </div>`;

  const root = el.querySelector('.bm');
  const $ = (sel) => root.querySelector(sel);
  const repaintUser = () => {
    const card = $('[data-user]');
    if (card) card.outerHTML = userCard();
  };

  const setPicker = (open) => {
    pickerOpen = open;
    const panel = $('[data-picker]');
    if (panel) panel.hidden = !open;
    $('[data-avatar]')?.setAttribute('aria-expanded', String(open));
  };

  const openName = () => {
    setPicker(false);
    const form = $('[data-name-form]');
    if (!form) return;
    $('[data-who]').classList.add('is-editing');
    form.hidden = false;
    const input = form.querySelector('input');
    input.value = String(getProfile().name ?? '').trim();
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  };

  const closeName = () => {
    const form = $('[data-name-form]');
    if (!form || form.hidden) return;
    form.hidden = true;
    $('[data-who]').classList.remove('is-editing');
    $('.bm-edit')?.focus({ preventScroll: true });
  };

  /** Saves the picture and says so, or says it couldn't (storage full: setSetting fails quietly). */
  const savePicture = (avatar, done) => {
    setProfile({ avatar });
    pickerOpen = false;
    if (root.isConnected) repaintUser();
    ctx.toast((getProfile().avatar ?? null) === avatar ? done : 'Could not save the picture on this iPhone');
  };

  root.addEventListener('click', (ev) => {
    const hit = (sel) => ev.target.closest(sel);
    let b;
    if (hit('[data-avatar]')) {
      closeName();
      setPicker(!pickerOpen);
    } else if ((b = hit('[data-emoji]'))) {
      const a = AVATARS[Number(b.dataset.emoji)];
      if (a) savePicture(a.e, 'Picture saved');
    } else if (hit('[data-photo]')) {
      $('[data-file]')?.click();
    } else if (hit('[data-remove-picture]')) {
      savePicture(null, 'Picture removed');
    } else if (hit('[data-edit-name]')) {
      openName();
    } else if (hit('[data-cancel-name]')) {
      closeName();
    } else if ((b = hit('[data-survey]'))) {
      startSurvey(el, b.dataset.survey === 'edit' ? 'summary' : undefined);
    }
  });

  root.addEventListener('submit', (ev) => {
    const form = ev.target.closest('[data-name-form]');
    if (!form) return;
    ev.preventDefault();
    const value = form.querySelector('input').value.trim().slice(0, NAME_MAX);
    const before = String(getProfile().name ?? '').trim();
    setProfile({ name: value });
    repaintUser();
    if (value !== before) ctx.toast(value ? 'Name saved' : 'Name removed');
  });

  root.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && ev.target.closest('[data-name-form]')) closeName();
  });

  root.addEventListener('change', async (ev) => {
    const input = ev.target.closest('[data-file]');
    if (!input) return;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    const btn = $('[data-photo]');
    const label = btn?.querySelector('span');
    if (btn) btn.disabled = true;
    if (label) label.textContent = 'Preparing…';
    try {
      savePicture(await photoAvatar(file), 'Picture saved');
    } catch {
      if (btn?.isConnected) btn.disabled = false;
      if (label?.isConnected) label.textContent = 'Choose a photo';
      ctx.toast('That photo could not be opened. Try another one.');
    }
  });
}

export default {
  id: 'me',
  label: 'Profile',
  icon: icons.profile,

  // #me/survey opens the survey straight away (for links from other screens).
  render(el, ctx, param) {
    cleanup?.();
    pickerOpen = false;
    draw(el, ctx);

    // The balance follows the account (redeemed code, new month, a video made) without redrawing the page;
    // the counts follow the journal. Neither touches the name being edited.
    const onAccount = () => {
      const card = el.querySelector('.bm [data-plan]');
      if (card) card.outerHTML = planCard();
    };
    const offDreams = onChange(() => {
      const stats = el.querySelector('.bm [data-stats]');
      if (stats) stats.outerHTML = statsHTML();
    });
    window.addEventListener('dreaming:account', onAccount);
    cleanup = () => {
      offDreams();
      window.removeEventListener('dreaming:account', onAccount);
      survey?.close(true);
      cleanup = null;
    };
    // Fresh plan state; a new answer arrives as a 'dreaming:account' event and repaints the card.
    getAccount().catch(() => {});

    if (param === 'survey') {
      try { history.replaceState(null, '', '#me'); } catch {}
      startSurvey(el);
    }
  },

  destroy() {
    cleanup?.();
  },
};
