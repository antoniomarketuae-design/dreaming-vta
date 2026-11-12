import home from './screens/home.js';
import journal from './screens/journal.js';
import lucidity from './screens/lucidity.js';
import insights from './screens/insights.js';
import profile from './screens/profile.js';
import record from './screens/record.js';
import dream from './screens/dream.js';
import onboarding, { ART_STYLES } from './screens/onboarding.js';
import celebrate from './screens/celebrate.js';
import technique from './screens/technique.js';
import article from './screens/article.js';
import goals from './screens/goals.js';
import moduleScreen from './screens/module.js';
import plus from './screens/plus.js';
import lock from './screens/lock.js';
import homeNew from './screens/b/home.js';
import insightsNew from './screens/b/insights.js';
import me from './screens/b/me.js';
import calendar from './screens/b/calendar.js';
import { getLayout } from './layout.js';
import { icons } from './ui.js';
import { getProfile, getSetting } from './store.js';
import { resumePendingImages } from './images.js';
import { resumePendingVideos } from './videos.js';
import { getAccount } from './account.js';

// Two layouts (Settings → App layout, js/layout.js), same dreams and account:
//   current: Home · Journal · Lucidity · Progress · Settings
//   new:     Home · Journal · Insights · Profile (#me) · Calendar — Settings (#profile) and Lucidity stay reachable by link.
// Other screens are reached by link: #record[/voice|/edit/<id>], #dream/<id>[/analyze], #celebrate/<id>, #technique/<id>,
// #article/<id>, #goals, #module/<id>, #onboarding, #plus, #lock.
const TABS_CURRENT = [home, journal, lucidity, insights, profile];
const TABS_NEW = [homeNew, journal, insightsNew, calendar, me];
const SHARED = [record, dream, onboarding, celebrate, technique, article, goals, moduleScreen, plus, lock];
const tabs = () => (getLayout() === 'new' ? TABS_NEW : TABS_CURRENT);
const screens = () => (getLayout() === 'new' ? [...TABS_NEW, profile, lucidity, ...SHARED] : [...TABS_CURRENT, ...SHARED]);
const UNLOCKED_KEY = 'dreaming.unlocked';

const screenEl = document.getElementById('screen');
const tabbarEl = document.getElementById('tabbar');
const toastEl = document.getElementById('toast');

const state = { version: null };

const isStandalone = () => navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

const ctx = {
  get version() { return state.version; },
  isStandalone,
  checkForUpdate: (reason) => checkForUpdate(reason),
  toast: (message) => toast(message),
  navigate(hash) {
    if (location.hash === hash) render();
    else location.hash = hash;
  },
  // Goes back within the app; a screen opened directly (fresh launch, shared link) goes Home instead.
  back() {
    if (inAppMoves > 0) history.back();
    else ctx.navigate('#home');
  },
};

let inAppMoves = 0;

// ---- Screens and tab bar ----

function parseRoute() {
  const [id, ...rest] = location.hash.slice(1).split('/');
  const screen = screens().find((s) => s.id === id) ?? tabs()[0];
  const param = rest.length ? decodeURIComponent(rest.join('/')) : null;
  return { screen, param };
}

// A tab shows a dot while its screen's badge() says there is something new (e.g. a technique just unlocked).
function renderTabs() {
  tabbarEl.innerHTML = tabs().map((s) => {
    let dot = false;
    try { dot = Boolean(s.badge?.()); } catch {}
    return `<a class="tab" href="#${s.id}" data-id="${s.id}">${s.icon}<span>${s.label}</span>${dot ? '<i class="tab-dot" aria-label="New"></i>' : ''}</a>`;
  }).join('');
}

const isLocked = () => {
  if (!getSetting('passcode', null)) return false;
  try { return sessionStorage.getItem(UNLOCKED_KEY) !== '1'; } catch { return false; }
};

let active = null;

function render() {
  const route = parseRoute();
  // Passcode first, then first-launch onboarding; both replace the route so Back doesn't return to a gated screen.
  if (isLocked() && route.screen.id !== 'lock') {
    try { sessionStorage.setItem('dreaming.afterUnlock', location.hash || '#home'); } catch {}
    location.replace('#lock');
    return;
  }
  if (!isLocked() && !getProfile().onboarded && !['onboarding', 'plus', 'lock'].includes(route.screen.id)) {
    location.replace('#onboarding');
    return;
  }
  const { screen, param } = route;
  try { active?.destroy?.(); } catch {}
  active = screen;

  document.body.dataset.screen = screen.id;
  document.body.dataset.tabbar = screen.hideTabbar ? 'hidden' : 'shown';
  // The picture style chosen in onboarding tints every generated dream picture (see .css rule for data: images).
  const style = ART_STYLES.find((s) => s.id === getProfile().artStyle);
  document.documentElement.style.setProperty('--art-filter', style?.filter || 'none');
  tabbarEl.hidden = Boolean(screen.hideTabbar);
  renderTabs();
  // In the new layout Settings (#profile) belongs to the Profile tab.
  const current = getLayout() === 'new' && screen.id === 'profile' ? 'me' : screen.id;
  for (const tab of tabbarEl.querySelectorAll('.tab')) {
    if (tab.dataset.id === current) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  }

  try {
    screen.render(screenEl, ctx, param);
  } catch (err) {
    console.error(err);
    screenEl.innerHTML = '<p class="muted" style="padding-top:40px">Something went wrong on this screen.</p>';
  }
}

window.addEventListener('hashchange', () => { inAppMoves += 1; render(); window.scrollTo(0, 0); });
// Switching layout starts again from Home.
window.addEventListener('dreaming:layout', () => { inAppMoves = 0; if (location.hash === '#home') render(); else location.hash = '#home'; });

// ---- Messages at the top of the screen ----

let toastTimer;
function toast(message, { action, onAction, sticky } = {}) {
  clearTimeout(toastTimer);
  toastEl.innerHTML = '';
  toastEl.append(document.createTextNode(message));
  if (action) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = action;
    btn.addEventListener('click', onAction);
    toastEl.append(btn);
  }
  toastEl.hidden = false;
  if (!sticky) toastTimer = setTimeout(() => { toastEl.hidden = true; }, 2600);
}

// ---- Updates: each time Claude publishes a change, version.json goes up by one ----

let announced = null;

async function checkForUpdate(reason) {
  let latest;
  try {
    const res = await fetch('version.json', { cache: 'no-store' });
    if (!res.ok) throw new Error(String(res.status));
    latest = await res.json();
  } catch {
    if (reason === 'manual') toast('Offline: could not check for updates');
    return;
  }

  if (!state.version) {
    state.version = latest;
    globalThis.DREAMING_VERSION = latest.version; // sent to the server (X-App-Version) for the team dashboard
    // Only screens that show version info need a refresh; recording must never be interrupted.
    if (active?.id === 'profile') render();
    return;
  }
  if (latest.version === state.version.version) {
    if (reason === 'manual') toast('You have the latest version');
    return;
  }
  // Coming back to the app is a natural moment to switch over, unless a dream is being recorded.
  if ((reason === 'resume' && active?.id !== 'record') || reason === 'manual') {
    location.reload();
    return;
  }
  if (announced === latest.version) return;
  announced = latest.version;
  toast(`Version ${latest.version} is ready`, { action: 'Update', onAction: () => location.reload(), sticky: true });
}

let swRegistration = null;
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js')
    .then((reg) => { swRegistration = reg; })
    .catch(() => {});
}

document.addEventListener('visibilitychange', () => {
  // With a passcode set, leaving the app locks it again.
  if (document.visibilityState === 'hidden' && getSetting('passcode', null)) {
    try { sessionStorage.removeItem(UNLOCKED_KEY); } catch {}
    return;
  }
  if (document.visibilityState !== 'visible') return;
  if (isLocked() && active?.id !== 'lock') { render(); return; }
  swRegistration?.update().catch(() => {});
  checkForUpdate('resume');
});
setInterval(() => { if (document.visibilityState === 'visible') checkForUpdate('poll'); }, 30000);

// ---- First visit in Safari: show how to put the app on the Home Screen ----

function maybeShowInstallGuide() {
  // ?install previews the guide on any device.
  const forced = new URLSearchParams(location.search).has('install');
  if (!forced && (isStandalone() || !isIOS)) return;
  try { if (!forced && sessionStorage.getItem('skip-install')) return; } catch {}

  const el = document.createElement('div');
  el.className = 'install';
  el.innerHTML = `
    <div class="install-inner">
      <img class="install-icon" src="icons/icon-180.png" alt="" width="88" height="88">
      <h1>Install Dreaming</h1>
      <p class="install-lead">Put it on your Home Screen and it opens like a real app: full screen, with its own icon.</p>
      <ol class="steps">
        <li><span class="step-icon">${icons.compass}</span><span>Open this page in <b>Safari</b>.</span></li>
        <li><span class="step-icon">${icons.share}</span><span>Tap <b>Share</b>. On iOS 26, tap <b>•••</b> first, then <b>Share</b>.</span></li>
        <li><span class="step-icon">${icons.addSquare}</span><span>Choose <b>Add to Home Screen</b>, then tap <b>Add</b>.</span></li>
      </ol>
      <p class="install-after">Then open <b>Dreaming</b> from your Home Screen.</p>
      <button class="btn btn-ghost" type="button" data-skip>Continue in the browser</button>
    </div>
  `;
  el.querySelector('[data-skip]').addEventListener('click', () => {
    try { sessionStorage.setItem('skip-install', '1'); } catch {}
    el.remove();
  });
  document.body.append(el);
}

render();
checkForUpdate('boot');
// Finish AI images and videos that were still being made when the app was closed, and refresh the plan/allowance quietly.
try { resumePendingImages(); } catch {}
try { resumePendingVideos(); } catch {}
getAccount().catch(() => {});
maybeShowInstallGuide();
