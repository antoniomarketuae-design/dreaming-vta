import { esc, formatDate, icons } from '../ui.js';

export default {
  id: 'about',
  label: 'About',
  icon: icons.info,

  render(el, ctx) {
    const v = ctx.version;
    const notes = v?.notes ?? [];

    el.innerHTML = `
      <h1 class="large-title">About</h1>
      <p class="subtitle">How this copy of the app is doing.</p>

      <section class="card list">
        <div class="row"><span>Version</span><span>${v ? esc(v.version) : '—'}</span></div>
        <div class="row"><span>Last updated</span><span>${v ? esc(formatDate(v.updated)) : '—'}</span></div>
        <div class="row"><span>On Home Screen</span><span>${ctx.isStandalone() ? 'Yes' : 'Not yet'}</span></div>
      </section>

      <button class="btn" type="button" data-check>Check for updates</button>

      <h3 class="section-title">Build log</h3>
      <section class="card log">
        ${notes.length ? notes.map((n) => `
          <div class="log-item">
            <div class="note-meta">v${esc(n.version)} · ${esc(formatDate(n.date))}</div>
            <p class="note-text">${esc(n.text)}</p>
          </div>`).join('') : '<p class="muted">The log loads when you are online.</p>'}
      </section>
    `;

    el.querySelector('[data-check]').addEventListener('click', () => ctx.checkForUpdate('manual'));
  },
};
