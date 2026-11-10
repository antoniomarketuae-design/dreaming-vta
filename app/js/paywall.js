// Dreaming Plus paywall: a bottom sheet over the current screen, opened by openPaywall() in account.js when a free
// user taps something that needs Plus, or when the server says a monthly limit was reached.
// Also exports the small shared bits the subscriptions page (#plus), Settings and the locked cards use:
// the PLUS pill, feature icons, price formatting and plan limits. No DOM or storage access at import time.
import { esc, icons } from './ui.js';
import { getSetting } from './store.js';
import { getPlans, isPlus, cachedAccount } from './account.js';

const ic = (body) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

/** Icons for the paid features (the ones ui.js lacks are drawn here). */
export const FEATURE_ICONS = {
  images: icons.image,
  analyses: ic('<path d="M12 3.5a6 6 0 0 0-3.5 10.9V17h7v-2.6A6 6 0 0 0 12 3.5z"/><path d="M9.5 20h5M10.5 17v3M13.5 17v3"/>'),
  'sounds-all': icons.headphones,
  nightmares: ic('<path d="M7 15a4 4 0 1 1 .9-7.9A5.5 5.5 0 0 1 18.5 9 3 3 0 0 1 18 15z"/><path d="M8 18.5l-1 2M12 18.5l-1 2M16 18.5l-1 2"/>'),
  correlations: ic('<rect x="9" y="3" width="6" height="5" rx="1.5"/><rect x="3" y="16" width="6" height="5" rx="1.5"/><rect x="15" y="16" width="6" height="5" rx="1.5"/><path d="M12 8v4M6 16v-2h12v2"/>'),
  'symbols-map': ic('<circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="7" r="2.5"/><circle cx="12" cy="18" r="2.5"/><path d="M8.3 7.1l7.4-.4M7.2 8.2l3.7 7.6M16.9 9.2l-3.7 6.6"/>'),
  'image-styles': ic('<path d="M12 3.5a8.5 8.5 0 1 0 0 17c1.2 0 1.8-.8 1.8-1.7 0-1.3-1-1.6-1-2.6 0-.9.7-1.5 1.7-1.5h2A4 4 0 0 0 20.5 11 8 8 0 0 0 12 3.5z"/><circle cx="7.8" cy="11" r="1.1"/><circle cx="10.5" cy="7.4" r="1.1"/><circle cx="15" cy="7.6" r="1.1"/>'),
  plus: icons.sparkle,
};

/** The moon-gold PLUS pill shown on locked items. */
export const plusPill = (extra = '') => `<span class="pw-pill${extra ? ` ${extra}` : ''}" aria-label="Dreaming Plus">Plus</span>`;

// Used only until /plans has answered once (mirrors server/plans.json); prices are never guessed.
const FALLBACK_LIMITS = { free: { images: 1, analyses: 3 }, plus: { images: 30, analyses: 100 } };

/** Last known /plans answer (instant), or null. */
export const cachedPlans = () => getSetting('plansCache', null);

/** Monthly limits per plan: { free: { images, analyses }, plus: { images, analyses } }. */
export function planLimits(plans = cachedPlans()) {
  return {
    free: { ...FALLBACK_LIMITS.free, ...(plans?.plans?.free?.limits || {}) },
    plus: { ...FALLBACK_LIMITS.plus, ...(plans?.plans?.plus?.limits || {}) },
  };
}

export function formatMoney(amount, currency = 'USD') {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amount);
  } catch {
    return `${Number(amount).toFixed(2)} ${currency}`;
  }
}

/** Prices ready to print, or null while unknown. perMonth = yearly price ÷ 12, rounded to the cent. */
export function priceInfo(plans = cachedPlans()) {
  const p = plans?.prices;
  if (!p?.yearly?.amount || !p?.monthly?.amount) return null;
  const cur = p.currency || 'USD';
  return {
    trialDays: Number(p.trialDays) || 0,
    yearly: { ...p.yearly, price: formatMoney(p.yearly.amount, cur), perMonth: formatMoney(Math.round((p.yearly.amount / 12) * 100) / 100, cur) },
    monthly: { ...p.monthly, price: formatMoney(p.monthly.amount, cur) },
    paymentsEnabled: plans.paymentsEnabled === true,
  };
}

/** "10 December 2026" for an ISO timestamp, or '' when missing. */
export function formatUntil(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
}

/** When the monthly allowance starts again: the 1st of next month (the server counts calendar months in UTC). */
export function renewDate(period = cachedAccount()?.period) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(period || ''));
  const now = new Date();
  const y = m ? Number(m[1]) : now.getUTCFullYear();
  const mo = m ? Number(m[2]) : now.getUTCMonth() + 1;
  return new Date(Date.UTC(y, mo, 1, 12)).toLocaleDateString(undefined, { day: 'numeric', month: 'long', timeZone: 'UTC' });
}

const n = (count, one, many) => `${count} ${count === 1 ? one : many}`;

/** What Plus adds, in the order shown. `features` = the account features each line stands for. */
export function plusBenefits(limits = planLimits()) {
  return [
    { key: 'images', features: ['images'], icon: FEATURE_ICONS.images,
      title: `${limits.plus.images} AI dream images a month`, text: 'A painting made from each dream you write down.' },
    { key: 'analyses', features: ['analyses'], icon: FEATURE_ICONS.analyses,
      title: `${limits.plus.analyses} dream interpretations a month`, text: 'Read what your dream may be telling you, whenever you like.' },
    { key: 'sounds-all', features: ['sounds-all'], icon: FEATURE_ICONS['sounds-all'],
      title: 'Every sleep sound and binaural beat', text: 'All soundscapes and beats for falling asleep and lucid practice.' },
    { key: 'insights', features: ['nightmares', 'correlations', 'symbols-map'], icon: FEATURE_ICONS['symbols-map'],
      title: 'Deeper analyses', text: 'Nightmares, correlations and the map of your symbols.' },
    { key: 'image-styles', features: ['image-styles'], icon: FEATURE_ICONS['image-styles'],
      title: 'Your choice of art style', text: 'Pick how your AI dream images are painted.' },
  ];
}

/** "1 free AI image left this month" style line for a free user, or '' when unknown. */
export function allowanceLine(kind, left) {
  if (left == null) return '';
  if (kind === 'images') return left > 0 ? `${n(left, 'free AI image', 'free AI images')} left this month` : 'No free AI images left this month';
  return left > 0 ? `${n(left, 'free interpretation', 'free interpretations')} left this month` : 'No free interpretations left this month';
}

// ---- The sheet ----

let open = null; // { root, close }

function priceLine(p) {
  if (!p) return '<p class="pw-price pw-price-wait">Prices appear once Dreaming is online.</p>';
  const trial = p.trialDays ? `Free for ${p.trialDays} days, then ` : '';
  return `<p class="pw-price">${trial}<b>${esc(p.yearly.price)} a year</b> (about ${esc(p.yearly.perMonth)} a month), or ${esc(p.monthly.price)} a month.</p>`;
}

function limitLead(feature, limits) {
  if (feature === 'images') return `Dreaming Plus gives you ${limits.plus.images} AI dream images every month.`;
  if (feature === 'analyses') return `Dreaming Plus gives you ${limits.plus.analyses} dream interpretations every month.`;
  return '';
}

function sheetHTML({ feature, reason, info }, plans) {
  const limits = planLimits(plans);
  const p = priceInfo(plans);
  const plus = isPlus();
  const icon = FEATURE_ICONS[feature] || FEATURE_ICONS.plus;
  const isLimit = Boolean(reason) && (feature === 'images' || feature === 'analyses');

  // Already on Plus and the month's allowance is used up: nothing to sell, just say when it renews.
  if (plus && reason) {
    return `
      <div class="pw-icon">${icon}</div>
      <h2 class="pw-title" id="pw-title">${esc(reason)}</h2>
      <p class="pw-lead">Your Dreaming Plus allowance starts again on ${esc(renewDate())}.</p>
      <div class="pw-actions">
        <button class="btn pw-cta" type="button" data-pw-close>OK</button>
      </div>`;
  }

  const title = reason || info?.title || 'Dreaming Plus';
  const lead = isLimit
    ? `${limitLead(feature, limits)} Your free allowance starts again on ${renewDate()}.`
    : (info?.benefit || 'More from every dream you write down.');
  const all = plusBenefits(limits);
  const first = all.find((b) => b.features.includes(feature));
  const list = [first, ...all.filter((b) => b !== first)].filter(Boolean).slice(0, 4);
  const payOpen = p?.paymentsEnabled === true;

  return `
    <div class="pw-icon">${icon}</div>
    <p class="pw-kicker">${plusPill()}<span>${plus ? 'Included in your plan' : 'Dreaming Plus'}</span></p>
    <h2 class="pw-title" id="pw-title">${esc(title)}</h2>
    <p class="pw-lead">${esc(lead)}</p>
    <ul class="pw-list">
      ${list.map((b) => `<li><span class="pw-list-icon">${b.icon}</span><span>${esc(b.title)}</span></li>`).join('')}
    </ul>
    ${plus ? '' : priceLine(p)}
    <div class="pw-actions">
      <a class="btn pw-cta" href="#plus">${plus ? 'See my plan' : payOpen ? 'Start free trial' : 'See Dreaming Plus'}</a>
      <button class="pw-later" type="button" data-pw-close>Not now</button>
    </div>
    ${plus || payOpen ? '' : '<p class="pw-note">Subscriptions open soon. Nothing can be charged yet.</p>'}`;
}

/** Opens the paywall sheet. `info` = FEATURE_INFO[feature]; `reason` = the server's limit message, if any. */
export function showPaywall({ feature, reason, info } = {}) {
  if (typeof document === 'undefined') return;
  open?.close(true);

  const opts = { feature, reason, info };
  const root = document.createElement('div');
  root.className = 'pw';
  root.innerHTML = `
    <div class="pw-backdrop" data-pw-close></div>
    <section class="pw-sheet" role="dialog" aria-modal="true" aria-labelledby="pw-title" tabindex="-1">
      <div class="pw-grab" aria-hidden="true"></div>
      <button class="icon-btn pw-x" type="button" data-pw-close aria-label="Close">${icons.close}</button>
      <div class="pw-body" data-pw-body>${sheetHTML(opts, cachedPlans())}</div>
    </section>`;
  document.body.append(root);
  document.body.classList.add('pw-open');
  const sheet = root.querySelector('.pw-sheet');
  const before = document.activeElement;
  requestAnimationFrame(() => root.classList.add('is-in'));
  try { sheet.focus({ preventScroll: true }); } catch {}

  let closed = false;
  function close(now = false) {
    if (closed) return;
    closed = true;
    if (open?.root === root) open = null;
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('hashchange', onHash);
    document.body.classList.remove('pw-open');
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (now || reduce) { root.remove(); } else {
      root.classList.remove('is-in');
      root.classList.add('is-out');
      setTimeout(() => root.remove(), 260);
    }
    try { if (before && document.contains(before)) before.focus({ preventScroll: true }); } catch {}
  }
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const onHash = () => close(true); // "See Dreaming Plus" or any navigation takes the sheet away
  document.addEventListener('keydown', onKey);
  window.addEventListener('hashchange', onHash);
  root.addEventListener('click', (e) => { if (e.target.closest('[data-pw-close]')) close(); });

  // Swipe down to close (from the top of the sheet, or anywhere once it is scrolled to the top).
  let startY = null;
  let dy = 0;
  sheet.addEventListener('touchstart', (e) => {
    startY = sheet.scrollTop <= 0 ? e.touches[0].clientY : null;
    dy = 0;
  }, { passive: true });
  sheet.addEventListener('touchmove', (e) => {
    if (startY == null) return;
    dy = Math.max(0, e.touches[0].clientY - startY);
    if (dy > 0) { sheet.style.transition = 'none'; sheet.style.transform = `translateY(${dy}px)`; }
  }, { passive: true });
  sheet.addEventListener('touchend', () => {
    if (startY == null) return;
    sheet.style.transition = '';
    if (dy > 90) { sheet.style.transform = 'translateY(110%)'; close(); } else sheet.style.transform = '';
    startY = null;
  });

  open = { root, close };

  // Fresh prices (the first paint used the cached ones).
  getPlans().then((plans) => {
    if (closed || !plans) return;
    const body = root.querySelector('[data-pw-body]');
    if (body) body.innerHTML = sheetHTML(opts, plans);
  }).catch(() => {});
}
