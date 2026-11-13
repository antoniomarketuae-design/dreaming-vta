// The story of a period (Insights, owner's item 11): a short full-screen tap-through of the period's reading from
// periodreader.js. How many dreams and nights, how they felt, the main thread, people and places, a dream that stood
// out, a question to take away, then Share (a short text with counts and image names only, never dream text) and Done.
// Tap the right side or → for next, the left side or ← for back, Esc or × to close.
import { esc, icons, formatDate } from '../../ui.js';
import { getDream } from '../../store.js';
import { moodLine, nameInText } from '../../periodreader.js';

let current = null;

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const lower = nameInText;

/** The dream with the most library images in it (the newest when tied). */
function standout(r) {
  const per = new Map();
  for (const g of r.images || []) for (const id of g.ids) per.set(id, (per.get(id) || 0) + 1);
  let best = null;
  for (const d of r.dreams) if (!best || (per.get(d.id) || 0) > (per.get(best.id) || 0)) best = d;
  return best;
}

function slides(r) {
  const p = r.period;
  const word = p.id === 'all' ? 'so far' : p.id === 'week' ? 'this week' : p.id === 'month' ? 'this month' : 'this year';
  const out = [];
  out.push(`
    <p class="bst-kicker">${esc(p.title)}</p>
    <p class="bst-big">${r.dreams.length}</p>
    <p class="bst-text">${r.dreams.length === 1 ? 'dream' : 'dreams'} remembered ${esc(word)}${r.nights !== r.dreams.length ? `, on ${plural(r.nights, 'night')}` : ''}.</p>`);
  const line = moodLine(r.mood, r.dreams.length, p);
  if (line) {
    out.push(`
      <p class="bst-kicker">How they felt</p>
      <p class="bst-dots" aria-hidden="true">${r.mood.dots.map((d) => `<i class="bi-mood-${d.mood || 'none'}"></i>`).join('')}</p>
      <p class="bst-text">${esc(line)}</p>
      ${r.mood.felt.length ? `<p class="bst-small">Felt most: ${esc(r.mood.felt.join(', '))}</p>` : ''}`);
  }
  if (r.main) {
    out.push(`
      <p class="bst-kicker">The main thread</p>
      <p class="bst-name">${esc(r.main.name)}</p>
      <p class="bst-small">In ${r.main.ids.length} of your ${plural(r.dreams.length, 'dream')}</p>
      ${r.main.brief?.first ? `<p class="bst-text">${esc(r.main.brief.first)}</p>` : ''}
      <button type="button" class="bst-link" data-bst-sym="${esc(r.main.name)}">What it can mean${icons.chevronRight}</button>`);
  }
  if (r.people?.length || r.places?.length) {
    const list = (items) => items.slice(0, 3).map((g) => `<li>${esc(g.name)}${g.ids.length > 1 ? ` <small>${g.ids.length}</small>` : ''}</li>`).join('');
    out.push(`
      <p class="bst-kicker">Who and where</p>
      ${r.people?.length ? `<p class="bst-sub">People</p><ul class="bst-list">${list(r.people)}</ul>` : ''}
      ${r.places?.length ? `<p class="bst-sub">Places</p><ul class="bst-list">${list(r.places)}</ul>` : ''}`);
  }
  const d = standout(r);
  if (d) {
    out.push(`
      <p class="bst-kicker">A dream that stood out</p>
      <p class="bst-name">${esc(String(d.title || '').trim() || 'Untitled dream')}</p>
      <p class="bst-small">${esc(formatDate(d.date || String(d.createdAt || '').slice(0, 10)))}</p>
      <a class="bst-link" href="#dream/${encodeURIComponent(d.id)}" data-bst-go>Open it${icons.chevronRight}</a>`);
  }
  if (r.questions?.length) {
    out.push(`
      <p class="bst-kicker">To take with you</p>
      <p class="bst-q">${esc(r.questions[0])}</p>`);
  }
  out.push(`
    <p class="bst-kicker">That was ${esc(p.id === 'all' ? 'your journal so far' : `your ${p.label.toLowerCase()}`)}</p>
    <p class="bst-text">Keep writing your dreams down: every one makes the next reading richer.</p>
    <div class="bst-end">
      <button type="button" class="btn" data-bst-share>${icons.share}<span>Share</span></button>
      <button type="button" class="btn btn-ghost" data-bst-close>Done</button>
    </div>
    <p class="bst-small bst-status" data-bst-status role="status"></p>`);
  return out;
}

/** The text shared: counts and image names only. */
function shareText(r) {
  const p = r.period;
  const parts = [`${p.title} (Dreaming): ${plural(r.dreams.length, 'dream')}${r.nights !== r.dreams.length ? ` on ${plural(r.nights, 'night')}` : ''}.`];
  if (r.main) parts.push(`Main thread: ${lower(r.main.name)}.`);
  const line = moodLine(r.mood, r.dreams.length, p);
  if (line) parts.push(line);
  return parts.join(' ');
}

export function closeStory() {
  current?.close();
}

/** Opens the story of a reading (status 'ok'). opts.onSymbol(name) opens a symbol's meaning. */
export function openStory(r, opts = {}) {
  closeStory();
  const list = slides(r);
  const root = document.createElement('div');
  root.className = 'bst';
  root.innerHTML = `
    <section class="bst-panel" role="dialog" aria-modal="true" aria-label="${esc(r.period.title)}" tabindex="-1">
      <div class="bst-bars" aria-hidden="true">${list.map(() => '<i><b></b></i>').join('')}</div>
      <button type="button" class="icon-btn bst-x" data-bst-close aria-label="Close">${icons.close}</button>
      <div class="bst-slide" data-bst-slide aria-live="polite"></div>
      <div class="bst-nav">
        <button type="button" class="bst-tap bst-prev" data-bst-prev aria-label="Back"></button>
        <button type="button" class="bst-tap bst-next" data-bst-next aria-label="Next"></button>
      </div>
    </section>`;
  const panel = root.querySelector('.bst-panel');
  const slide = root.querySelector('[data-bst-slide]');
  const bars = [...root.querySelectorAll('.bst-bars i')];
  const before = document.activeElement;
  let at = 0;

  const show = (i) => {
    at = Math.max(0, Math.min(list.length - 1, i));
    slide.innerHTML = `<div class="bst-in">${list[at]}</div>`;
    bars.forEach((b, k) => b.classList.toggle('is-done', k <= at));
    root.classList.toggle('is-last', at === list.length - 1);
  };
  const close = () => {
    if (!current) return;
    document.removeEventListener('keydown', onKey, true);
    root.remove();
    document.documentElement.classList.remove('bst-open');
    current = null;
    try { before?.focus?.(); } catch {}
  };
  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); show(at + 1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); show(at - 1); }
  };
  root.addEventListener('click', async (e) => {
    const hit = (sel) => e.target.closest(sel);
    let b;
    if (hit('[data-bst-close]')) { close(); return; }
    if (hit('[data-bst-go]')) { close(); return; } // the link itself navigates
    if ((b = hit('[data-bst-sym]'))) { close(); opts.onSymbol?.(b.dataset.bstSym); return; }
    if (hit('[data-bst-share]')) {
      const status = root.querySelector('[data-bst-status]');
      const text = shareText(r);
      try {
        if (navigator.share) await navigator.share({ title: r.period.title, text });
        else { await navigator.clipboard.writeText(text); if (status) status.textContent = 'Copied. Paste it wherever you like.'; }
      } catch {}
      return;
    }
    if (hit('[data-bst-next]')) { if (at < list.length - 1) show(at + 1); return; }
    if (hit('[data-bst-prev]')) { show(at - 1); }
  });
  document.addEventListener('keydown', onKey, true);
  document.body.appendChild(root);
  document.documentElement.classList.add('bst-open');
  show(0);
  try { panel.focus({ preventScroll: true }); } catch {}
  current = { close };
  return current;
}
