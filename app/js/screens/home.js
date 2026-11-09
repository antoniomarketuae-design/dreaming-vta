import { esc, formatDate, icons } from '../ui.js';

function greeting() {
  const h = new Date().getHours();
  if (h < 5) return 'Good night';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

export default {
  id: 'home',
  label: 'Home',
  icon: icons.home,

  render(el, ctx) {
    const v = ctx.version;
    const latest = v?.notes?.[0];

    el.innerHTML = `
      <p class="eyebrow">${greeting()}</p>
      <h1 class="large-title">Dreaming VTA</h1>

      <section class="card hero">
        <div class="moon" aria-hidden="true"></div>
        <h2>Your app is live</h2>
        <p>${v ? `Version ${esc(v.version)}` : 'Offline'} · ${ctx.isStandalone() ? 'On your Home Screen' : 'Running in the browser'}</p>
      </section>

      ${latest ? `
        <h3 class="section-title">Latest change</h3>
        <section class="card">
          <div class="note-meta">v${esc(latest.version)} · ${esc(formatDate(latest.date))}</div>
          <p class="note-text">${esc(latest.text)}</p>
        </section>` : ''}

      <h3 class="section-title">Your space</h3>
      <section class="card empty">
        <p class="empty-title">Nothing here yet</p>
        <p>The first thing you ask Claude to build will show up here.</p>
      </section>
    `;
  },
};
