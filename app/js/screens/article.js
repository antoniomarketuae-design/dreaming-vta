// Article reader (#article/<id>): one of Dreaming's own short articles, then a few more to read.
import { esc, icons } from '../ui.js';
import { ARTICLES, getArticle } from '../content/articles.js';

function block(b) {
  if (b.h) return `<h2 class="art-h">${esc(b.h)}</h2>`;
  if (b.ul) return `<ul class="art-list">${b.ul.map((li) => `<li>${esc(li)}</li>`).join('')}</ul>`;
  if (b.note) return `<p class="glass art-note">${icons.sparkle}<span>${esc(b.note)}</span></p>`;
  return `<p>${esc(b.p || '')}</p>`;
}

function more(current) {
  const i = ARTICLES.findIndex((a) => a.id === current.id);
  const list = [1, 2, 3].map((k) => ARTICLES[(i + k) % ARTICLES.length]).filter((a) => a && a.id !== current.id);
  return `
    <section class="art-more">
      <h2 class="art-more-title">More to read</h2>
      ${list.map((a) => `
        <a class="glass art-link" href="#article/${esc(a.id)}">
          <span class="art-link-icon" style="--h:${a.hue}">${icons[a.icon] || icons.book}</span>
          <span class="art-link-text"><b>${esc(a.title)}</b><span>${a.minutes} min read</span></span>
          ${icons.chevronRight}
        </a>`).join('')}
    </section>`;
}

export default {
  id: 'article',
  hideTabbar: true,

  render(el, ctx, param) {
    const a = getArticle(param);
    if (!a) {
      el.innerHTML = `
        <div class="art">
          <header class="screen-header"><button type="button" class="icon-btn" data-back aria-label="Back">${icons.back}</button></header>
          <p class="muted art-missing">This article could not be found.</p>
          <a class="btn btn-ghost" href="#lucidity">Open Lucidity</a>
        </div>`;
      el.querySelector('[data-back]').addEventListener('click', () => ctx.back());
      return;
    }

    el.innerHTML = `
      <article class="art" style="--h:${a.hue}">
        <header class="screen-header">
          <button type="button" class="icon-btn" data-back aria-label="Back">${icons.back}</button>
          <p class="art-kicker">Article</p>
        </header>
        <div class="art-hero">
          <span class="art-hero-icon">${icons[a.icon] || icons.book}</span>
        </div>
        <h1 class="art-title">${esc(a.title)}</h1>
        <p class="art-meta">${a.minutes} min read</p>
        <p class="art-lead">${esc(a.summary)}</p>
        <div class="art-body">${a.body.map(block).join('')}</div>
        ${more(a)}
      </article>`;

    el.querySelector('[data-back]').addEventListener('click', () => ctx.back());
  },
};
