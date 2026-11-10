// Dreaming Plus subscriptions page (#plus, #plus/redeem). Same structure as the reference: benefits, plan choice
// (yearly highlighted + monthly), how the free trial works, primary button, Restore, plus a Free-vs-Plus table.
// Payments are not connected yet (/plans says paymentsEnabled: false), so the primary button says so instead of
// pretending; a Dreaming Plus code can be redeemed today. Plus users see their plan, end date and this month's usage.
// Shown once at the end of onboarding (then Close goes Home) and from every paywall (then Close goes back).
import { getProfile } from '../store.js';
import { esc, icons } from '../ui.js';
import { getAccount, cachedAccount, getPlans, redeem, remaining } from '../account.js';
import { cachedPlans, planLimits, priceInfo, plusBenefits, formatUntil, renewDate, allowanceLine, plusPill } from '../paywall.js';

const PLUS_FLAG = 'dreaming.plusAfterOnboarding';

const ic = (body) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const UNLOCK = ic('<rect x="5" y="11" width="14" height="10" rx="2.5"/><path d="M8 11V8a4 4 0 0 1 7.7-1.5"/>');
const CARD = ic('<rect x="3" y="5.5" width="18" height="13" rx="2.5"/><path d="M3 10h18M7 15h3"/>');

// Kept while the app is open so a refresh (new prices, account event) doesn't undo what the user chose or typed.
const ui = { plan: 'yearly', codeOpen: false, code: '', error: '', busy: false, restoring: false, redeemed: '' };
let offAccount = null;
let live = 0; // render generation: async work from an older render (or after leaving) must not paint

const pct = (used, limit) => (limit ? Math.min(100, Math.round((used / limit) * 100)) : 0);

function benefitsCard(title, limits) {
  return `
    <section class="glass plus-card" aria-labelledby="plus-benefits-title">
      <h2 class="plus-card-title" id="plus-benefits-title">${esc(title)}</h2>
      <ul class="plus-benefits">
        ${plusBenefits(limits).map((b) => `
          <li>
            <span class="plus-benefit-icon">${b.icon}</span>
            <span class="plus-benefit-text"><b>${esc(b.title)}</b><span>${esc(b.text)}</span></span>
          </li>`).join('')}
      </ul>
    </section>`;
}

function plansPicker(p) {
  if (!p) {
    return `
      <section class="glass plus-card plus-offline">
        <p class="muted">Prices appear once Dreaming is online.</p>
        <button class="btn btn-ghost" type="button" data-retry>Try again</button>
      </section>`;
  }
  const option = (key, title, price, per, sub, badge) => `
    <button class="glass plus-plan${ui.plan === key ? ' is-on' : ''}${badge ? ' is-best' : ''}" type="button" role="radio"
      aria-checked="${ui.plan === key}" data-plan="${key}">
      ${badge ? `<span class="plus-plan-badge">${esc(badge)}</span>` : ''}
      <span class="plus-plan-radio" aria-hidden="true">${icons.check}</span>
      <span class="plus-plan-main"><b>${esc(title)}</b>${sub ? `<span>${esc(sub)}</span>` : ''}</span>
      <span class="plus-plan-price"><b>${esc(price)}</b><small>${esc(per)}</small></span>
    </button>`;
  return `
    <section class="plus-plans" role="radiogroup" aria-label="Choose a plan">
      ${option('yearly', p.yearly.label || 'Yearly', p.yearly.price, 'per year', `About ${p.yearly.perMonth} a month`, p.yearly.badge || 'Best value')}
      ${option('monthly', p.monthly.label || 'Monthly', p.monthly.price, 'per month', '', '')}
    </section>`;
}

function trialCard(p) {
  if (!p || !p.trialDays) return '';
  const days = p.trialDays;
  const chosen = ui.plan === 'monthly' ? `${p.monthly.price} a month` : `${p.yearly.price} a year`;
  const steps = [
    { icon: UNLOCK, when: 'Today', text: 'Full access to everything in Dreaming Plus.' },
    days >= 3 ? { icon: icons.bell, when: `Day ${days - 2}`, text: 'We remind you that your free trial ends in two days.' } : null,
    { icon: CARD, when: `Day ${days}`, text: `Billing starts: ${chosen}, unless you cancel before then.` },
  ].filter(Boolean);
  return `
    <section class="glass plus-card plus-trial" aria-labelledby="plus-trial-title">
      <h2 class="plus-card-title" id="plus-trial-title">How the free trial ${p.paymentsEnabled ? 'works' : 'will work'}</h2>
      <ol class="plus-steps">
        ${steps.map((s) => `
          <li>
            <span class="plus-step-dot">${s.icon}</span>
            <span class="plus-step-text"><b>${esc(s.when)}</b><span>${esc(s.text)}</span></span>
          </li>`).join('')}
      </ol>
      <p class="plus-nopay">${icons.check}<span>Nothing to pay during the trial. Cancel any time before day ${days} and you pay nothing.</span></p>
    </section>`;
}

function primary(p, afterOnboarding) {
  const open = p?.paymentsEnabled === true;
  return `
    <div class="plus-actions">
      ${open
        ? `<button class="btn plus-cta" type="button" data-buy>${p.trialDays ? `Start ${p.trialDays}-day free trial` : 'Get Dreaming Plus'}</button>`
        : `<button class="btn plus-cta is-soon" type="button" aria-disabled="true" data-soon>${icons.moon}<span>Payments open soon</span></button>
           <p class="plus-honest">Subscriptions aren’t open yet, so nothing can be bought or charged today. Everything in Free stays free. If you were given a Dreaming Plus code, you can use it below.</p>`}
      ${afterOnboarding ? '<button class="btn btn-ghost plus-later" type="button" data-close>Start my journal</button>' : ''}
    </div>`;
}

function codeSection(plus) {
  return `
    <section class="plus-code" aria-label="Redeem a code">
      <button class="plus-link plus-code-toggle" type="button" data-code-toggle aria-expanded="${ui.codeOpen}">
        ${plus ? 'Add time with a code' : 'Have a code? Redeem it'}
      </button>
      <form class="glass plus-code-form" data-code-form ${ui.codeOpen ? '' : 'hidden'}>
        <label class="plus-code-label" for="plus-code-input">Dreaming Plus code</label>
        <div class="plus-code-row">
          <input class="field plus-code-input" id="plus-code-input" name="code" value="${esc(ui.code)}" maxlength="40"
            autocomplete="off" autocapitalize="characters" spellcheck="false" enterkeyhint="go" placeholder="e.g. DREAM-1234">
          <button class="btn plus-code-btn" type="submit" ${ui.busy ? 'disabled' : ''}>${ui.busy ? 'Checking…' : 'Redeem'}</button>
        </div>
        ${ui.error ? `<p class="plus-code-error" role="alert">${esc(ui.error)}</p>` : ''}
      </form>
    </section>`;
}

function compareTable(limits) {
  const yes = `<span class="plus-yes" aria-label="Included">${icons.check}</span>`;
  const no = '<span class="plus-no" aria-label="Not included">–</span>';
  const rows = [
    ['Dream journal, by voice or typing', yes, yes],
    ['Techniques, articles and reminders', yes, yes],
    ['Statistics and trends', yes, yes],
    ['Passcode lock and export', yes, yes],
    ['AI dream images', `${limits.free.images} a month`, `${limits.plus.images} a month`],
    ['AI dream videos', limits.free.videos ? `${limits.free.videos} a month` : no, `${limits.plus.videos} a month`],
    ['Dream interpretations', `${limits.free.analyses} a month`, `${limits.plus.analyses} a month`],
    ['Sleep sounds', '1 soundscape and 1 beat', 'All of them'],
    ['Nightmares, correlations, symbols map', no, yes],
    ['Choice of art style', no, yes],
  ];
  return `
    <h2 class="section-title">Free and Plus</h2>
    <div class="glass plus-compare-wrap">
      <table class="plus-compare">
        <thead><tr><th scope="col"><span class="plus-sr">Feature</span></th><th scope="col">Free</th><th scope="col">${plusPill()}</th></tr></thead>
        <tbody>
          ${rows.map(([label, free, plus]) => `<tr><th scope="row">${esc(label)}</th><td>${free}</td><td class="plus-col-plus">${plus}</td></tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

function usageRow(label, used, limit) {
  return `
    <div class="plus-usage-row">
      <span class="plus-usage-label">${esc(label)}</span>
      <span class="plus-usage-num"><b>${used}</b> / ${limit}</span>
      <span class="plus-usage-bar" role="progressbar" aria-label="${esc(label)} used" aria-valuemin="0" aria-valuemax="${limit}" aria-valuenow="${used}"><i style="width:${pct(used, limit)}%"></i></span>
    </div>`;
}

function mineCard(acc, limits) {
  const until = formatUntil(acc.plusUntil);
  const used = acc.used || {};
  const lim = acc.limits || limits.plus;
  return `
    ${ui.redeemed ? `<p class="plus-success" role="status">${icons.check}<span>Dreaming Plus is active${ui.redeemed === '-' ? '' : ` until ${esc(ui.redeemed)}`}.</span></p>` : ''}
    <section class="glass plus-card plus-mine" aria-labelledby="plus-mine-title">
      <p class="plus-mine-kicker">${plusPill()}<span>Your plan</span></p>
      <h2 class="plus-mine-title" id="plus-mine-title">You have Dreaming Plus${until ? ` until ${esc(until)}` : ''}</h2>
      <h3 class="plus-card-title plus-usage-title">This month</h3>
      ${usageRow('AI images', used.images || 0, lim.images ?? limits.plus.images)}
      ${usageRow('AI videos', used.videos || 0, lim.videos ?? limits.plus.videos)}
      ${usageRow('Interpretations', used.analyses || 0, lim.analyses ?? limits.plus.analyses)}
      <p class="plus-usage-note">Counts start again on ${esc(renewDate(acc.period))}.</p>
    </section>`;
}

function freeStatus(acc) {
  if (!acc) return '';
  const lines = [allowanceLine('images', remaining('images')), allowanceLine('analyses', remaining('analyses'))].filter(Boolean);
  return lines.length ? `<p class="plus-status"><span>You’re on Free</span>${lines.map((l) => `<span>${esc(l)}</span>`).join('')}</p>` : '';
}

function pageHTML(afterOnboarding, first) {
  const acc = cachedAccount();
  const plus = acc?.plan === 'plus';
  const plans = cachedPlans();
  const limits = planLimits(plans);
  const p = priceInfo(plans);
  const name = String(getProfile().name || '').trim();

  const hero = `
    <div class="plus-hero">
      <div class="plus-orb" aria-hidden="true">${icons.sparkle}</div>
      ${afterOnboarding ? `<p class="plus-kicker">You’re all set${name ? `, ${esc(name)}` : ''}</p>` : ''}
      <h1 class="plus-title">Dreaming <em>Plus</em></h1>
      <p class="plus-lead">${plus
        ? 'Thank you for supporting Dreaming. Here is what your plan includes.'
        : 'More from every dream: AI images and videos, interpretations, every sleep sound and deeper analyses.'}</p>
    </div>`;

  const body = plus
    ? `${mineCard(acc, limits)}
       ${benefitsCard('Included in your plan', limits)}
       ${compareTable(limits)}
       ${codeSection(true)}
       ${afterOnboarding ? '<div class="plus-actions"><button class="btn plus-cta" type="button" data-close>Start my journal</button></div>' : ''}`
    : `${freeStatus(acc)}
       ${benefitsCard('What Plus adds', limits)}
       ${plansPicker(p)}
       ${trialCard(p)}
       ${primary(p, afterOnboarding)}
       ${codeSection(false)}
       ${compareTable(limits)}`;

  return `
    <div class="plus${first ? ' is-first' : ''}">
      <div class="plus-top">
        <button class="icon-btn plus-close" type="button" aria-label="Close" data-close>${icons.close}</button>
      </div>
      ${hero}
      ${body}
      <footer class="plus-foot">
        <div class="plus-foot-links">
          <button class="plus-link" type="button" data-restore ${ui.restoring ? 'disabled' : ''}>${ui.restoring ? 'Checking…' : 'Restore'}</button>
          <span aria-hidden="true">·</span>
          <button class="plus-link" type="button" data-code-toggle="open">Redeem a code</button>
        </div>
        <p>Plus belongs to this iPhone’s anonymous Dreaming ID. There is no account, and your dreams stay on this phone.</p>
      </footer>
    </div>`;
}

const offline = (err) => err instanceof TypeError || /fetch|network|load failed/i.test(String(err?.message || ''));

export default {
  id: 'plus',
  hideTabbar: true,

  render(el, ctx, param) {
    let afterOnboarding = false;
    try { afterOnboarding = sessionStorage.getItem(PLUS_FLAG) === '1'; } catch {}
    if (param === 'redeem') ui.codeOpen = true;
    ui.error = '';
    ui.redeemed = '';

    const gen = ++live;
    let painted = '';
    const paint = () => {
      if (gen !== live) return;
      const input = el.querySelector('#plus-code-input');
      const hadFocus = input && document.activeElement === input;
      if (input) ui.code = input.value;
      // Same content as on screen: leave it alone (no flicker, entrance animation plays once).
      const html = pageHTML(afterOnboarding, !painted);
      if (painted && html === painted) return;
      el.innerHTML = html;
      painted = pageHTML(afterOnboarding, false);
      if (hadFocus) el.querySelector('#plus-code-input')?.focus({ preventScroll: true });
    };

    const close = () => {
      if (afterOnboarding) {
        try { sessionStorage.removeItem(PLUS_FLAG); } catch {}
        location.replace('#home');
      } else {
        ctx.back();
      }
    };

    const refresh = () => {
      getPlans().then(() => paint()).catch(() => {});
      getAccount().then(() => paint()).catch(() => {});
    };

    const openCode = (always) => {
      ui.codeOpen = always ? true : !ui.codeOpen;
      paint();
      if (ui.codeOpen) {
        const input = el.querySelector('#plus-code-input');
        input?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        input?.focus({ preventScroll: true });
      }
    };

    const onClick = async (e) => {
      const t = e.target.closest('button');
      if (!t || !el.contains(t)) return;
      if (t.matches('[data-close]')) { close(); return; }
      if (t.dataset.plan) { ui.plan = t.dataset.plan; paint(); return; }
      if (t.matches('[data-retry]')) { refresh(); return; }
      if (t.matches('[data-soon]')) { ctx.toast('Payments aren’t open yet. Nothing has been charged.'); return; }
      if (t.matches('[data-buy]')) { ctx.toast('Checkout isn’t available in this version yet.'); return; }
      if (t.matches('[data-code-toggle]')) { openCode(t.dataset.codeToggle === 'open'); return; }
      if (t.matches('[data-restore]')) {
        if (ui.restoring) return;
        ui.restoring = true;
        paint();
        const asked = Date.now();
        const acc = await getAccount({ refresh: true });
        ui.restoring = false;
        const reached = (cachedAccount()?.fetchedAt || 0) >= asked;
        paint();
        if (!reached) ctx.toast('Could not reach Dreaming. Check your connection.');
        else if (acc?.plan === 'plus') ctx.toast(`Dreaming Plus is active${acc.plusUntil ? ` until ${formatUntil(acc.plusUntil)}` : ''}`);
        else ctx.toast('No Dreaming Plus found for this iPhone');
      }
    };

    const onSubmit = async (e) => {
      if (!e.target.matches('[data-code-form]')) return;
      e.preventDefault();
      const code = e.target.querySelector('input').value.trim();
      ui.code = code;
      if (!code) { ui.error = 'Type your code first.'; paint(); return; }
      if (ui.busy) return;
      ui.busy = true;
      ui.error = '';
      paint();
      try {
        const view = await redeem(code);
        ui.redeemed = formatUntil(view?.plusUntil) || '-';
        ui.code = '';
        ui.codeOpen = false;
        ctx.toast(`Dreaming Plus is active${ui.redeemed === '-' ? '' : ` until ${ui.redeemed}`}`);
      } catch (err) {
        ui.error = offline(err) ? 'Could not reach Dreaming. Check your connection and try again.' : (err?.message || 'That code did not work.');
      }
      ui.busy = false;
      paint();
      if (ui.redeemed) window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    paint();
    el.addEventListener('click', onClick);
    el.addEventListener('submit', onSubmit);
    offAccount?.();
    const onAccount = () => paint();
    window.addEventListener('dreaming:account', onAccount);
    offAccount = () => {
      window.removeEventListener('dreaming:account', onAccount);
      el.removeEventListener('click', onClick);
      el.removeEventListener('submit', onSubmit);
    };
    refresh();

    if (ui.codeOpen && param === 'redeem') {
      requestAnimationFrame(() => {
        const input = el.querySelector('#plus-code-input');
        input?.scrollIntoView({ block: 'center' });
        input?.focus({ preventScroll: true });
      });
    }
  },

  destroy() {
    live += 1;
    offAccount?.();
    offAccount = null;
    ui.busy = false;
    ui.restoring = false;
  },
};
