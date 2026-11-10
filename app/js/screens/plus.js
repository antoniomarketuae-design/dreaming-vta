// Dreaming Plus: a "coming soon" placeholder. There are no payments in Dreaming; everything is free.
// Shown once at the end of onboarding (then Close goes Home) and wherever a feature would be premium elsewhere
// (then Close goes back to where the user came from, or Home when opened directly).
import { getProfile } from '../store.js';
import { esc, icons } from '../ui.js';

const PLUS_FLAG = 'dreaming.plusAfterOnboarding';

const FREE_NOW = [
  'Unlimited dreams, by voice or typing',
  'A painting for every dream',
  'Every lucid dreaming technique as it unlocks',
  'Progress, streaks and patterns',
  'Dream goals, passcode lock and export',
];

export default {
  id: 'plus',
  hideTabbar: true,
  render(el, ctx) {
    let afterOnboarding = false;
    try { afterOnboarding = sessionStorage.getItem(PLUS_FLAG) === '1'; } catch {}
    const name = String(getProfile().name || '').trim();

    el.innerHTML = `
      <div class="plus">
        <div class="plus-top">
          <button class="icon-btn plus-close" type="button" aria-label="Close" data-close>${icons.close}</button>
        </div>
        <div class="plus-hero">
          <div class="plus-orb" aria-hidden="true">${icons.sparkle}</div>
          ${afterOnboarding ? `<p class="plus-kicker">You’re all set${name ? `, ${esc(name)}` : ''}</p>` : ''}
          <h1 class="plus-title">Dreaming <em>Plus</em></h1>
          <span class="plus-badge">Coming soon</span>
          <p class="plus-lead">We’re working on extras for later. Today there’s nothing to buy: every part of Dreaming is free, with no account and no payment.</p>
        </div>
        <section class="glass plus-card" aria-labelledby="plus-free-title">
          <h2 class="plus-card-title" id="plus-free-title">Free for you now</h2>
          <ul class="plus-list">
            ${FREE_NOW.map((t) => `<li><span class="plus-check" aria-hidden="true">${icons.check}</span><span>${esc(t)}</span></li>`).join('')}
          </ul>
        </section>
        <div class="plus-actions">
          <button class="btn plus-cta" type="button" data-close>${afterOnboarding ? 'Start my journal' : 'Continue for free'}</button>
          <p class="plus-foot">Dreaming never asks for payment details.</p>
        </div>
      </div>`;

    const close = () => {
      if (afterOnboarding) {
        try { sessionStorage.removeItem(PLUS_FLAG); } catch {}
        location.replace('#home');
      } else {
        ctx.back();
      }
    };
    for (const b of el.querySelectorAll('[data-close]')) b.addEventListener('click', close);
  },
};
