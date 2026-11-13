// New layout: the symbol meaning sheet, shared by Home ("What you dream about") and Insights (Recurring symbols and
// the dream sky's "Read more"). A bottom sheet on <body>:
//   1. the meaning from Dreaming's dream library (GET ${API_BASE}/library/symbol?name=…, built from dream books and
//      research): summary, common situations, perspectives (psychology, Freud, traditional dream books…), questions to
//      ask yourself, sources and related symbols (tapping one shows that symbol here, with a way back). It does not
//      depend on the user's dreams, so there is always a second view next to their own interpretation;
//   2. below it, clearly apart: "From your interpretation" (only when one of the user's interpreted dreams gave a
//      meaning) and the user's dreams with this symbol.
// openSymbolSheet({ key, name, count, dreamIds, meaning, meaningFrom, navigate }): any of count / dreamIds / meaning /
// meaningFrom left out is filled from all the user's dreams (recurringSymbols, all time). navigate(hash) is optional
// (dream links work as plain links too). One sheet at a time; it closes on Escape, the ×, the backdrop, a swipe down
// and any route change. closeSymbolSheet() closes it at once (screens call it when they go away).
// Library answers are cached for the session by lower-cased name. Styles: css/b-symbolsheet.css (bss-).
import { API_BASE } from '../../interpret.js';
import { getDream } from '../../store.js';
import { recurringSymbols, dreamDay } from '../../symbols.js';
import { esc, icons, relativeDay } from '../../ui.js';

const TIMEOUT_MS = 15000;
const CONTEXTS_SHOWN = 3;
const DREAMS_SHOWN = 5;
const PERSPECTIVE_NAMES = { psychology: 'Psychology', freud: 'Freud', traditional: 'Traditional dream books', jung: 'Jung' };
const PERSPECTIVE_ORDER = ['psychology', 'freud', 'traditional'];

const str = (v) => (typeof v === 'string' ? v.trim() : '');
const capital = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const titleOf = (d) => String(d?.title || '').trim() || 'Untitled dream';
// Same key as symbols.js gives a symbol, so a name typed anywhere finds the user's own symbol.
const normKey = (s) => String(s || '').toLowerCase().replace(/[-_]+/g, ' ').replace(/^(the|a|an|my|your)\s+/, '').trim();
const titleCase = (k) => capital(String(k).replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase());

// ---- The library (cached for the session) ----

const cache = new Map();    // lower-cased name → { entry } | { missing: true }
const inflight = new Map(); // lower-cased name → Promise

async function loadEntry(name) {
  const k = name.toLowerCase();
  if (cache.has(k)) return cache.get(k);
  if (inflight.has(k)) return inflight.get(k);
  const run = (async () => {
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), TIMEOUT_MS) : null;
    let res;
    try {
      res = await fetch(`${API_BASE}/library/symbol?name=${encodeURIComponent(name)}`, {
        headers: { Accept: 'application/json' },
        credentials: 'omit',
        signal: ctrl?.signal,
      });
    } finally {
      if (timer) clearTimeout(timer);
    }
    let data = null;
    try { data = await res.json(); } catch {}
    if (res.status === 404) {
      const out = { missing: true };
      if (data?.error === 'not_found') cache.set(k, out); // a bare 404 (no such route yet) is not remembered
      return out;
    }
    if (!res.ok || !data?.ok || !data.entry || typeof data.entry !== 'object') throw new Error(`library ${res.status}`);
    const out = { entry: data.entry };
    cache.set(k, out);
    return out;
  })();
  inflight.set(k, run);
  try { return await run; } finally { inflight.delete(k); }
}

// ---- The user's own side ----

/** Fills what the caller left out from all the user's dreams. */
function withMine(opts) {
  const name = str(opts.name) || capital(str(opts.key));
  const key = normKey(opts.key || name);
  const need = ['count', 'dreamIds', 'meaning', 'meaningFrom'].some((f) => opts[f] === undefined);
  let s = null;
  if (need && key) { try { s = recurringSymbols({ days: 0 }).find((x) => x.key === key) || null; } catch {} }
  return {
    key,
    name,
    count: Number(opts.count ?? s?.count ?? 0) || 0,
    dreamIds: Array.isArray(opts.dreamIds) ? opts.dreamIds : s?.dreamIds || [],
    meaning: str(opts.meaning === undefined ? s?.meaning : opts.meaning),
    meaningFrom: opts.meaningFrom === undefined ? s?.meaningFrom ?? null : opts.meaningFrom,
  };
}

const dreamHref = (d) => `#dream/${encodeURIComponent(d.id)}`;

function yoursHTML(s) {
  if (!s.meaning) return '';
  const from = s.meaningFrom != null ? getDream(s.meaningFrom) : null;
  return `
    <section class="bss-yours" aria-labelledby="bss-yours-title">
      <h3 class="bss-label" id="bss-yours-title">From your interpretation</h3>
      <div class="bss-yours-card">
        <p class="bss-yours-text">${esc(s.meaning)}</p>
        ${from
          ? `<a class="bss-yours-link" href="${dreamHref(from)}" data-bss-go>
              <span>From “${esc(titleOf(from))}” · ${esc(relativeDay(dreamDay(from)))}</span>${icons.chevronRight}
            </a>`
          : ''}
      </div>
    </section>`;
}

function dreamsHTML(s, all) {
  const list = [...new Set(s.dreamIds.map(String))].map((id) => getDream(id)).filter(Boolean)
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  if (!list.length) return '';
  const shown = all ? list : list.slice(0, DREAMS_SHOWN);
  const more = list.length - shown.length;
  return `
    <section class="bss-mine" aria-labelledby="bss-mine-title">
      <h3 class="bss-label" id="bss-mine-title">${list.length === 1 ? 'Your dream with this symbol' : 'Your dreams with this symbol'}</h3>
      <ul class="bss-dreams">${shown.map((d) => `
        <li><a class="bss-dream" href="${dreamHref(d)}" data-bss-go>
          <span class="bss-dream-title">${esc(titleOf(d))}</span>
          <span class="bss-dream-day">${esc(relativeDay(dreamDay(d)))}</span>${icons.chevronRight}
        </a></li>`).join('')}
      </ul>
      ${more > 0 ? `<button type="button" class="bss-more" data-bss-dreams>Show all ${list.length}</button>` : ''}
    </section>`;
}

// ---- The library section ----

const LOADING_HTML = `
  <div class="bss-skel" aria-hidden="true">
    <i style="width:92%"></i><i style="width:100%"></i><i style="width:78%"></i>
    <i class="bss-skel-gap" style="width:40%"></i><i style="width:96%"></i><i style="width:64%"></i>
  </div>`;

const ERROR_HTML = `
  <div class="bss-state">
    <span class="bss-state-icon" aria-hidden="true">${icons.moon}</span>
    <p class="bss-state-text">Couldn't load the meaning. Check your connection and try again.</p>
    <button type="button" class="btn btn-ghost bss-retry" data-bss-retry>Try again</button>
  </div>`;

const MISSING_HTML = `
  <div class="bss-state">
    <span class="bss-state-icon" aria-hidden="true">${icons.book}</span>
    <p class="bss-state-text">This symbol isn't in our library yet. We're adding more sources.</p>
  </div>`;

/** A perspective's text and source: a string, or { text, source }. */
function perspective(v) {
  if (typeof v === 'string') return { text: v.trim(), source: '' };
  if (v && typeof v === 'object') return { text: str(v.text), source: str(v.source) };
  return { text: '', source: '' };
}

const KIND_ORDER = ['research', 'psychology', 'tradition', 'modern'];
const KIND_NAMES = { research: 'Dream research', psychology: 'Psychology', tradition: 'Dream books and traditions', modern: 'Modern writers' };
const CULTURE_NAMES = {
  greek: 'Greek', roman: 'Roman', islamic: 'Islamic', arabic: 'Arabic', persian: 'Persian', jewish: 'Jewish', chinese: 'Chinese',
  japanese: 'Japanese', indian: 'Indian', hindu: 'Hindu', buddhist: 'Buddhist', tibetan: 'Tibetan', slavic: 'Slavic', russian: 'Russian',
  egyptian: 'Egyptian', mesopotamian: 'Mesopotamian', byzantine: 'Byzantine', european: 'European', english: 'English', french: 'French',
  german: 'German', american: 'American', african: 'African', zulu: 'Zulu', 'native-american': 'Native American', western: 'Western',
  'greco-roman': 'Greek', 'indian-hindu': 'Indian', 'indian-ayurveda': 'Indian', 'slavic-russian': 'Slavic', 'medieval-european': 'European',
  jain: 'Jain', norse: 'Norse',
};
/** "Greek, Islamic and Chinese" */
const andList = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

/** "Based on 18 sources": dream research, psychology and the traditions they come from; the full list folds open. */
function basedOnHTML(a) {
  const list = Array.isArray(a.sources) ? a.sources : [];
  if (!list.length) return '';
  const groups = KIND_ORDER.map((k) => ({ k, items: list.filter((s) => s.kind === k) })).filter((g) => g.items.length);
  const cultures = [...new Set(list.filter((s) => s.kind === 'tradition').flatMap((s) => String(s.culture || '').split(/[,;/]\s*/))
    .map((c) => CULTURE_NAMES[c.trim().toLowerCase()]).filter(Boolean))];
  const line = groups.map((g) => (g.k === 'tradition' && cultures.length ? `${cultures.length > 5 ? `${cultures.slice(0, 5).join(', ')} and other` : andList(cultures)} dream books` : KIND_NAMES[g.k].toLowerCase())).join(' · ');
  const n = Math.max(list.length, Number(a.sourceCount) || 0);
  return `
    <section class="bss-sec" aria-labelledby="bss-based-title">
      <h3 class="bss-label" id="bss-based-title">Based on ${n} sources</h3>
      <p class="bss-based">${esc(capital(line))}</p>
      <details class="bss-srclist">
        <summary>See all sources</summary>
        ${groups.map((g) => `
          <p class="bss-srcgroup">${esc(KIND_NAMES[g.k])}</p>
          <ul class="bss-srcs">${g.items.map((s) => `<li class="bss-src">${esc([s.author, s.title].filter(Boolean).join(', '))}${s.year ? ` (${esc(s.year)})` : ''}</li>`).join('')}</ul>`).join('')}
      </details>
    </section>`;
}

/** The one combined answer: meaning · it depends on · ask yourself · based on. */
function answerHTML(entry, title, allContexts) {
  const a = entry.answer;
  const out = [];
  const name = str(entry.name);
  const other = name && normKey(name) !== normKey(title) ? name : '';
  out.push(`
    <div class="bss-lead">
      <p class="bss-lead-label">${icons.book}<span>From our dream library${other ? ` · ${esc(other)}` : ''}</span></p>
      <p class="bss-summary bss-meaning">${esc(a.meaning)}</p>
    </div>`);
  const depends = (Array.isArray(a.depends) ? a.depends : []).filter((d) => d && str(d.meaning));
  if (depends.length) {
    const shown = allContexts ? depends : depends.slice(0, CONTEXTS_SHOWN);
    out.push(`
      <section class="bss-sec" aria-labelledby="bss-ctx-title">
        <h3 class="bss-label" id="bss-ctx-title">It depends on…</h3>
        <ul class="bss-ctx">${shown.map((c) => `
          <li class="bss-ctx-item">
            ${str(c.when) ? `<p class="bss-ctx-when">${esc(capital(str(c.when)))}</p>` : ''}
            <p class="bss-ctx-meaning">${esc(str(c.meaning))}</p>
          </li>`).join('')}
        </ul>
        ${depends.length > CONTEXTS_SHOWN && !allContexts ? `<button type="button" class="bss-more" data-bss-contexts>Show all ${depends.length}</button>` : ''}
      </section>`);
  }
  const ask = (Array.isArray(a.ask) ? a.ask : []).map(str).filter(Boolean);
  if (ask.length) {
    out.push(`
      <section class="bss-sec" aria-labelledby="bss-q-title">
        <h3 class="bss-label" id="bss-q-title">Ask yourself</h3>
        <ul class="bss-qs">${ask.map((q) => `<li><span class="bss-q-mark" aria-hidden="true">?</span><span>${esc(q)}</span></li>`).join('')}</ul>
      </section>`);
  }
  out.push(basedOnHTML(a));
  return out.join('');
}

function entryHTML(entry, title, allContexts) {
  // The new library: one combined answer (older entries keep the summary + perspectives layout until rewritten).
  if (entry.answer && str(entry.answer.meaning)) return answerHTML(entry, title, allContexts) + relatedHTML(entry, title);
  const out = [];
  const name = str(entry.name);
  const other = name && normKey(name) !== normKey(title) ? name : '';
  const summary = str(entry.summary);
  out.push(`
    <div class="bss-lead">
      <p class="bss-lead-label">${icons.book}<span>From our dream library${other ? ` · ${esc(other)}` : ''}</span></p>
      ${summary ? `<p class="bss-summary">${esc(summary)}</p>` : ''}
    </div>`);

  const contexts = (Array.isArray(entry.contexts) ? entry.contexts : [])
    .map((c) => ({ when: str(c?.when), meaning: str(c?.meaning) })).filter((c) => c.when || c.meaning);
  if (contexts.length) {
    const shown = allContexts ? contexts : contexts.slice(0, CONTEXTS_SHOWN);
    out.push(`
      <section class="bss-sec" aria-labelledby="bss-ctx-title">
        <h3 class="bss-label" id="bss-ctx-title">Common situations</h3>
        <ul class="bss-ctx">${shown.map((c) => `
          <li class="bss-ctx-item">
            ${c.when ? `<p class="bss-ctx-when">${esc(capital(c.when))}</p>` : ''}
            ${c.meaning ? `<p class="bss-ctx-meaning">${esc(c.meaning)}</p>` : ''}
          </li>`).join('')}
        </ul>
        ${contexts.length > CONTEXTS_SHOWN && !allContexts ? `<button type="button" class="bss-more" data-bss-contexts>Show all ${contexts.length}</button>` : ''}
      </section>`);
  }

  const p = entry.perspectives && typeof entry.perspectives === 'object' ? entry.perspectives : {};
  const keys = [...PERSPECTIVE_ORDER.filter((k) => k in p), ...Object.keys(p).filter((k) => !PERSPECTIVE_ORDER.includes(k))];
  const cards = keys.map((k) => ({ k, ...perspective(p[k]) })).filter((x) => x.text);
  if (cards.length) {
    out.push(`
      <section class="bss-sec" aria-labelledby="bss-persp-title">
        <h3 class="bss-label" id="bss-persp-title">Perspectives</h3>
        <div class="bss-persp">${cards.map((c) => `
          <article class="bss-pcard bss-p-${PERSPECTIVE_ORDER.includes(c.k) ? c.k : 'other'}">
            <h4 class="bss-ptitle">${esc(PERSPECTIVE_NAMES[c.k] || titleCase(c.k))}</h4>
            <p class="bss-ptext">${esc(c.text)}</p>
            ${c.source ? `<p class="bss-psrc">${esc(c.source)}</p>` : ''}
          </article>`).join('')}
        </div>
      </section>`);
  }

  const questions = (Array.isArray(entry.questions) ? entry.questions : []).map(str).filter(Boolean);
  if (questions.length) {
    out.push(`
      <section class="bss-sec" aria-labelledby="bss-q-title">
        <h3 class="bss-label" id="bss-q-title">Questions to ask yourself</h3>
        <ul class="bss-qs">${questions.map((q) => `<li><span class="bss-q-mark" aria-hidden="true">?</span><span>${esc(q)}</span></li>`).join('')}</ul>
      </section>`);
  }

  const sources = [...new Set((Array.isArray(entry.sources) ? entry.sources : []).map(str).filter(Boolean))];
  if (sources.length) {
    out.push(`
      <section class="bss-sec" aria-labelledby="bss-src-title">
        <h3 class="bss-label" id="bss-src-title">Sources</h3>
        <ul class="bss-srcs">${sources.map((s) => `<li class="bss-src">${esc(s)}</li>`).join('')}</ul>
      </section>`);
  }

  out.push(relatedHTML(entry, title));
  return out.join('');
}

/** Related symbols (both layouts). */
function relatedHTML(entry, title) {
  const out = [];
  const related = (Array.isArray(entry.related) ? entry.related : [])
    .map((r) => str(typeof r === 'string' ? r : r?.name)).filter(Boolean)
    .filter((n, i, all) => all.findIndex((x) => x.toLowerCase() === n.toLowerCase()) === i)
    .filter((n) => normKey(n) !== normKey(title));
  if (related.length) {
    out.push(`
      <section class="bss-sec" aria-labelledby="bss-rel-title">
        <h3 class="bss-label" id="bss-rel-title">Related</h3>
        <div class="bss-rels">${related.map((n) => `
          <button type="button" class="bss-rel" data-bss-rel="${esc(n)}">${esc(n)}${icons.chevronRight}</button>`).join('')}
        </div>
      </section>`);
  }
  return out.join('');
}

// ---- The sheet ----

let current = null;

/** Closes the open sheet, if any. `now`: without the slide-out (a route change, a screen going away). */
export function closeSymbolSheet(now = true) {
  current?.close(now);
}

export function openSymbolSheet(opts = {}) {
  const first = withMine(opts);
  if (!first.name) return null;
  current?.close(true);

  const navigate = typeof opts.navigate === 'function' ? opts.navigate : null;
  const root = document.createElement('div');
  root.className = 'bss';
  root.innerHTML = `
    <div class="bss-backdrop" data-bss-close></div>
    <section class="bss-panel" role="dialog" aria-modal="true" aria-labelledby="bss-title" tabindex="-1">
      <div class="bss-grab" aria-hidden="true"></div>
      <button type="button" class="icon-btn bss-x" data-bss-close aria-label="Close">${icons.close}</button>
      <div class="bss-body" data-bss-body></div>
    </section>`;
  const panel = root.querySelector('.bss-panel');
  const body = root.querySelector('[data-bss-body]');
  const before = document.activeElement;

  // What is shown: the symbol, the way back (related symbols opened from here) and what is expanded.
  let s = first;
  const back = [];
  let allContexts = false;
  let allDreams = false;
  let lib = { state: 'loading' };
  let token = 0;

  const sheet = { closed: false, close };

  const libHTML = () => {
    if (lib.state === 'ok') return entryHTML(lib.entry, s.name, allContexts);
    if (lib.state === 'missing') return MISSING_HTML;
    if (lib.state === 'error') return ERROR_HTML;
    return LOADING_HTML;
  };
  // The section itself is not live (a whole entry read aloud is too much); a short status line says what happened.
  const STATUS = { loading: 'Loading the meaning', ok: 'Meaning loaded', missing: 'Not in our library yet', error: "Couldn't load the meaning" };
  const paintLib = () => {
    const host = body.querySelector('[data-bss-lib]');
    if (!host) return;
    host.innerHTML = libHTML();
    host.setAttribute('aria-busy', String(lib.state === 'loading'));
    const status = body.querySelector('[data-bss-status]');
    if (status && status.textContent !== STATUS[lib.state]) status.textContent = STATUS[lib.state] || '';
  };
  const paintMine = () => {
    const host = body.querySelector('[data-bss-mine]');
    if (host) host.innerHTML = dreamsHTML(s, allDreams);
  };

  const draw = () => {
    const prev = back[back.length - 1];
    const count = s.count === 1 ? 'In one of your dreams' : s.count > 1 ? `In ${s.count} of your dreams` : '';
    const yours = yoursHTML(s);
    const dreams = dreamsHTML(s, allDreams);
    body.innerHTML = `
      ${prev ? `<button type="button" class="bss-back" data-bss-back aria-label="${esc(`Back to ${prev.name}`)}">${icons.back}<span>${esc(prev.name)}</span></button>` : ''}
      <header class="bss-head">
        <p class="bss-kicker">${icons.sparkle}<span>Symbol meaning</span></p>
        <h2 class="bss-title" id="bss-title" tabindex="-1">${esc(s.name)}</h2>
        ${count ? `<p class="bss-count">${esc(count)}</p>` : ''}
      </header>
      <p class="bss-sr" role="status" data-bss-status></p>
      <section class="bss-lib" data-bss-lib aria-busy="true" aria-label="Meaning from our dream library"></section>
      ${yours || dreams ? `
        <div class="bss-split" aria-hidden="true"><span>${icons.moon}</span></div>
        <div class="bss-own">${yours}<div data-bss-mine>${dreams}</div></div>` : ''}`;
    paintLib();
  };

  const load = async () => {
    const mine = ++token;
    const name = s.name;
    const hit = cache.get(name.toLowerCase());
    lib = hit ? (hit.entry ? { state: 'ok', entry: hit.entry } : { state: 'missing' }) : { state: 'loading' };
    paintLib();
    if (hit) return;
    let next;
    try {
      const res = await loadEntry(name);
      next = res.entry ? { state: 'ok', entry: res.entry } : { state: 'missing' };
    } catch {
      next = { state: 'error' };
    }
    if (sheet.closed || mine !== token) return;
    lib = next;
    paintLib();
  };

  const show = (next, moved) => {
    s = next;
    allContexts = false;
    allDreams = false;
    lib = { state: 'loading' };
    token += 1;
    draw();
    load();
    if (moved) {
      panel.scrollTop = 0;
      try { body.querySelector('#bss-title')?.focus({ preventScroll: true }); } catch {}
    }
  };

  function close(now = false) {
    if (sheet.closed) return;
    sheet.closed = true;
    token += 1;
    if (current === sheet) current = null;
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('hashchange', onRoute);
    document.body.classList.remove('bss-lock');
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (now || reduce) root.remove();
    else {
      root.classList.remove('bss-in');
      root.classList.add('bss-out');
      setTimeout(() => root.remove(), 260);
    }
    if (!now) { try { if (before && document.contains(before)) before.focus({ preventScroll: true }); } catch {} }
  }

  // Escape closes; Tab stays inside the sheet.
  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (e.key !== 'Tab') return;
    const items = [...panel.querySelectorAll('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])')]
      .filter((el) => el.offsetParent !== null);
    if (!items.length) return;
    const firstEl = items[0];
    const lastEl = items[items.length - 1];
    if (e.shiftKey && (document.activeElement === firstEl || !panel.contains(document.activeElement))) { e.preventDefault(); lastEl.focus(); }
    else if (!e.shiftKey && (document.activeElement === lastEl || !panel.contains(document.activeElement))) { e.preventDefault(); firstEl.focus(); }
  };
  const onRoute = () => close(true);
  document.addEventListener('keydown', onKey);
  window.addEventListener('hashchange', onRoute);

  root.addEventListener('click', (e) => {
    const hit = (sel) => e.target.closest(sel);
    let b;
    if (hit('[data-bss-close]')) { close(); return; }
    if ((b = hit('[data-bss-go]'))) {
      if (!navigate) return; // a plain link: the route change closes the sheet
      e.preventDefault();
      const href = b.getAttribute('href');
      close(true);
      navigate(href);
      return;
    }
    if ((b = hit('[data-bss-rel]'))) {
      back.push(s);
      show(withMine({ name: b.dataset.bssRel }), true);
      return;
    }
    if (hit('[data-bss-back]')) {
      const prev = back.pop();
      if (prev) show(prev, true);
      return;
    }
    if (hit('[data-bss-retry]')) { load(); return; }
    if (hit('[data-bss-contexts]')) {
      allContexts = true;
      paintLib();
      body.querySelectorAll('.bss-ctx-item')[CONTEXTS_SHOWN]?.setAttribute('tabindex', '-1');
      try { body.querySelectorAll('.bss-ctx-item')[CONTEXTS_SHOWN]?.focus({ preventScroll: true }); } catch {}
      return;
    }
    if (hit('[data-bss-dreams]')) {
      allDreams = true;
      paintMine();
      try { body.querySelectorAll('.bss-dream')[DREAMS_SHOWN]?.focus({ preventScroll: true }); } catch {}
    }
  });

  // Swipe down to close (once the sheet is scrolled to the top).
  let startY = null;
  let dy = 0;
  panel.addEventListener('touchstart', (e) => { startY = panel.scrollTop <= 0 ? e.touches[0].clientY : null; dy = 0; }, { passive: true });
  panel.addEventListener('touchmove', (e) => {
    if (startY == null) return;
    dy = Math.max(0, e.touches[0].clientY - startY);
    if (dy > 6) { panel.style.transition = 'none'; panel.style.transform = `translateY(${dy}px)`; }
  }, { passive: true });
  const release = () => {
    if (startY == null) return;
    panel.style.transition = '';
    if (dy > 90) { panel.style.transform = 'translateY(110%)'; close(); } else panel.style.transform = '';
    startY = null;
  };
  panel.addEventListener('touchend', release);
  panel.addEventListener('touchcancel', release);

  document.body.append(root);
  document.body.classList.add('bss-lock');
  current = sheet;
  show(first, false);
  requestAnimationFrame(() => root.classList.add('bss-in'));
  try { panel.focus({ preventScroll: true }); } catch {}
  return sheet;
}
