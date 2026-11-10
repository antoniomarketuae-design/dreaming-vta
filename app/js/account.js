// The phone's anonymous Dreaming account: device id + secret token, plan (free / plus), monthly limits and usage.
// Everything paid or limited goes through here. No DOM or storage access at import time.
import { getSetting, setSetting } from './store.js';
import { API_BASE } from './interpret.js';

// Until the server has answered once, assume the free plan (mirrors server/plans.json).
const FREE_FEATURES = ['journal', 'voice', 'techniques', 'articles', 'reminders', 'passcode', 'export', 'statistics', 'trends', 'sounds-basic'];

/** Paywall copy per paid feature (our own wording). */
export const FEATURE_INFO = {
  images: { title: 'AI dream images', benefit: 'Turn every dream into a lifelike picture made just for it.' },
  analyses: { title: 'Dream interpretations', benefit: 'Understand what your dreams are telling you, as often as you like.' },
  'sounds-all': { title: 'All sleep sounds', benefit: 'Every soundscape and binaural beat for falling asleep and lucid practice.' },
  nightmares: { title: 'Nightmare analysis', benefit: 'See what your nightmares have in common and what helps.' },
  correlations: { title: 'Correlations', benefit: 'Discover how sleep, moods and symbols connect in your dreams.' },
  'symbols-map': { title: 'Symbols map', benefit: 'A map of every symbol in your dream world.' },
  'image-styles': { title: 'Image styles', benefit: 'Choose the art style for your AI dream images.' },
};

let pending = null;

/** The device credentials, registering this phone with the server the first time. */
export async function getDevice() {
  const saved = getSetting('device', null);
  if (saved?.id && saved?.token) return saved;
  if (!pending) {
    pending = (async () => {
      const res = await fetch(`${API_BASE}/devices`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      if (!res.ok) throw new Error('Could not connect to Dreaming. Check your internet connection.');
      const { token, ...view } = await res.json();
      const device = { id: view.deviceId, token };
      setSetting('device', device);
      applyAccount(view);
      return device;
    })().finally(() => { pending = null; });
  }
  return pending;
}

export async function authHeaders() {
  const d = await getDevice();
  return { 'X-Device-Id': d.id, 'X-Device-Token': d.token };
}

/** Stores the account view the server sent (any response may carry one). */
export function applyAccount(view) {
  if (view && view.plan) setSetting('account', { ...view, fetchedAt: Date.now() });
  try { window.dispatchEvent(new CustomEvent('dreaming:account', { detail: view })); } catch {}
}

/** Cached account (instant), refreshed from the server at most once a minute or when `refresh` is set. */
export async function getAccount({ refresh = false } = {}) {
  const cached = getSetting('account', null);
  if (!refresh && cached && Date.now() - (cached.fetchedAt || 0) < 60000) return cached;
  try {
    const res = await fetch(`${API_BASE}/me`, { headers: await authHeaders() });
    if (res.status === 401) { setSetting('device', null); return getAccount({ refresh: true }); }
    if (!res.ok) throw new Error(String(res.status));
    const view = await res.json();
    applyAccount(view);
    return view;
  } catch {
    return cached; // offline: last known state
  }
}

export const cachedAccount = () => getSetting('account', null);
export const isPlus = () => cachedAccount()?.plan === 'plus';
export const hasFeature = (f) => (cachedAccount()?.features || FREE_FEATURES).includes(f);
/** Remaining uses this month for 'images' or 'analyses' (null when unknown yet). */
export const remaining = (kind) => cachedAccount()?.remaining?.[kind] ?? null;

/** Plans and prices for the subscriptions page. */
export async function getPlans() {
  try {
    const res = await fetch(`${API_BASE}/plans`);
    if (!res.ok) throw new Error();
    const plans = await res.json();
    setSetting('plansCache', plans);
    return plans;
  } catch {
    return getSetting('plansCache', null);
  }
}

export async function redeem(code) {
  const res = await fetch(`${API_BASE}/redeem`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
    body: JSON.stringify({ code }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || 'That code did not work.');
  applyAccount(body);
  return body;
}

/** Shows the paywall sheet (implemented in js/paywall.js). `reason` overrides the default text. */
export async function openPaywall({ feature, reason } = {}) {
  const { showPaywall } = await import('./paywall.js');
  showPaywall({ feature, reason, info: FEATURE_INFO[feature] });
}

/** True when the feature may be used now; otherwise opens the paywall and returns false. */
export function requireFeature(feature) {
  if (hasFeature(feature)) return true;
  openPaywall({ feature });
  return false;
}

/** For server answers with status 402 (limit reached): shows the paywall with the server's reason. */
export function handleLimit(body, feature) {
  openPaywall({ feature: body?.limit?.field || feature, reason: body?.error });
}
