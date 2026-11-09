import home from './screens/home.js';
import about from './screens/about.js';
import { icons } from './ui.js';

// Every screen in the app, in tab-bar order. A new screen is a new file in screens/ plus one entry here.
const SCREENS = [home, about];

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
};

// ---- Screens and tab bar ----

function currentScreen() {
  const id = location.hash.slice(1);
  return SCREENS.find((s) => s.id === id) ?? SCREENS[0];
}

function renderTabs() {
  tabbarEl.innerHTML = SCREENS.map((s) => `
    <a class="tab" href="#${s.id}" data-id="${s.id}">${s.icon}<span>${s.label}</span></a>
  `).join('');
}

function render() {
  const screen = currentScreen();
  screen.render(screenEl, ctx);
  for (const tab of tabbarEl.querySelectorAll('.tab')) {
    if (tab.dataset.id === screen.id) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  }
}

window.addEventListener('hashchange', () => { render(); window.scrollTo(0, 0); });

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
    render();
    return;
  }
  if (latest.version === state.version.version) {
    if (reason === 'manual') toast('You have the latest version');
    return;
  }
  // Coming back to the app is a natural moment to switch over without interrupting anything.
  if (reason === 'resume' || reason === 'manual') {
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
  if (document.visibilityState !== 'visible') return;
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
      <h1>Install Dreaming VTA</h1>
      <p class="install-lead">Put it on your Home Screen and it opens like a real app: full screen, with its own icon.</p>
      <ol class="steps">
        <li><span class="step-icon">${icons.compass}</span><span>Open this page in <b>Safari</b>.</span></li>
        <li><span class="step-icon">${icons.share}</span><span>Tap <b>Share</b>. On iOS 26, tap <b>•••</b> first, then <b>Share</b>.</span></li>
        <li><span class="step-icon">${icons.addSquare}</span><span>Choose <b>Add to Home Screen</b>, then tap <b>Add</b>.</span></li>
      </ol>
      <p class="install-after">Then open <b>Dreaming VTA</b> from your Home Screen.</p>
      <button class="btn btn-ghost" type="button" data-skip>Continue in the browser</button>
    </div>
  `;
  el.querySelector('[data-skip]').addEventListener('click', () => {
    try { sessionStorage.setItem('skip-install', '1'); } catch {}
    el.remove();
  });
  document.body.append(el);
}

renderTabs();
render();
checkForUpdate('boot');
maybeShowInstallGuide();
