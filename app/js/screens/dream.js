// One dream: its picture, title, tags and full text, with inline editing and delete.
import { getDream, updateDream, deleteDream } from '../store.js';
import { TAGS } from '../analyze.js';
import { esc, formatDate, relativeDay, icons } from '../ui.js';
import { dreamArtURL } from '../dreamart.js';
import { isEnabled, isPending, isStale, requestInterpretation, sendFeedback, startPolling } from '../interpret.js';

function artSrc(dream) {
  try { return dreamArtURL(dream, 360) || ''; } catch { return ''; }
}

const tagChip = (id) => (TAGS[id]
  ? `<span class="chip" style="--hue:${TAGS[id].hue}">${esc(TAGS[id].label)}</span>`
  : '');

const flagChip = (label) => `<span class="chip dream-flag"><span class="star-mark">${icons.star}</span>${label}</span>`;

// ---- Interpretation (beta). Every string from the server goes through esc(). ----

const str = (v) => (typeof v === 'string' ? v.trim() : '');
const arr = (v) => (Array.isArray(v) ? v : []);

/** 'animal.dog' → 'Dog · animal';  'place.old_school' → 'Old school · place' */
function prettyEntry(id) {
  const raw = String(id ?? '').trim();
  const dot = raw.indexOf('.');
  const group = dot > 0 ? raw.slice(0, dot).replace(/[_-]+/g, ' ') : '';
  const name = (dot > 0 ? raw.slice(dot + 1) : raw).replace(/[._-]+/g, ' ').trim();
  const nice = name ? name[0].toUpperCase() + name.slice(1) : raw;
  return group ? `${nice} · ${group}` : nice;
}

const PERSPECTIVES = [['psychology', 'Psychology'], ['freud', 'Freud'], ['traditional', 'Traditional']];

const interpHead = (label) => `<h2 class="dream-interp-h">${label}</h2>`;

function itemList(items) {
  const rows = arr(items)
    .filter((x) => x && (str(x.name) || str(x.meaning)))
    .map((x) => `
      <li class="dream-interp-item">
        ${str(x.name) ? `<span class="dream-interp-name">${esc(str(x.name))}</span>` : ''}
        ${str(x.meaning) ? `<p class="dream-interp-meaning">${esc(str(x.meaning))}</p>` : ''}
      </li>`).join('');
  return rows ? `<ul class="dream-interp-list">${rows}</ul>` : '';
}

function timeOf(iso) {
  const d = iso ? new Date(iso) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : '';
}

// Stops the interpretation poller when leaving the screen. Module state only; nothing runs at import.
let cleanup = null;

export default {
  id: 'dream',

  render(el, ctx, param) {
    const [id, sub] = String(param ?? '').split('/');
    const goBack = () => (ctx.back ? ctx.back() : history.back());
    let editing = sub === 'edit';
    let stopPoll = null;
    let asking = false;        // a request is being sent
    let feedbackBusy = false;  // a rating/note is being sent
    let noteOpen = false;      // show the optional note field right after rating
    let perspKey = 'psychology';

    cleanup?.();
    cleanup = () => stopPolling();

    const root = document.createElement('div');
    root.className = 'dream';
    el.innerHTML = '';
    el.append(root);

    const header = (dream) => {
      const rel = dream ? relativeDay(dream.date) : '';
      const abs = dream ? formatDate(dream.date) : '';
      const when = rel && rel !== abs ? `${esc(rel)} · ${esc(abs)}` : esc(abs);
      return `
        <header class="screen-header">
          <button type="button" class="icon-btn" data-act="back" aria-label="Back">${icons.back}</button>
          <p class="dream-when faint">${when}</p>
        </header>`;
    };

    function show() {
      stopPolling();
      const dream = getDream(id);
      if (!dream) {
        root.innerHTML = `
          ${header(null)}
          <div class="glass dream-missing">
            <p class="dream-missing-title">This dream has drifted away.</p>
            <p class="muted">It may have been deleted, or the link is out of date.</p>
            <a class="btn btn-ghost" href="#home">${icons.home}<span>Go home</span></a>
          </div>`;
        return;
      }
      if (editing) showEdit(dream);
      else showView(dream);
    }

    function showView(dream) {
      const src = artSrc(dream);
      const hue = TAGS[dream.tags?.[0]]?.hue ?? 260;
      const chips = [
        dream.lucid ? flagChip('Lucid') : '',
        dream.recurring ? flagChip('Recurring') : '',
        ...(dream.tags || []).map(tagChip),
      ].join('');

      root.innerHTML = `
        ${header(dream)}
        <figure class="dream-art" style="--glow:${hue}">
          ${src ? `<img src="${src}" alt="A picture made from this dream" width="360" height="360">` : ''}
        </figure>
        <h1 class="dream-title">${esc(dream.title || 'Untitled dream')}</h1>
        ${chips ? `<div class="dream-chips">${chips}</div>` : ''}
        <div class="glass dream-text">${esc(dream.text) || '<span class="faint">No words written for this dream.</span>'}</div>
        ${isEnabled() ? '<div class="dream-interp" data-interp aria-live="polite"></div>' : ''}
        <div class="dream-actions">
          <button type="button" class="btn btn-ghost" data-act="edit">${icons.edit}<span>Edit</span></button>
          <button type="button" class="btn btn-danger" data-act="delete">${icons.trash}<span>Delete</span></button>
        </div>`;
      paintInterp();
    }

    // ---- Interpretation ----

    function stopPolling() {
      stopPoll?.();
      stopPoll = null;
    }

    function ensurePolling() {
      if (stopPoll || !isPending(getDream(id))) return;
      stopPoll = startPolling(id, () => { if (root.isConnected) paintInterp(); });
    }

    function paintInterp() {
      const slot = root.querySelector('[data-interp]');
      if (!slot) return;
      const dream = getDream(id);
      const interp = dream?.interpretation;

      if (!interp?.status) {
        slot.innerHTML = `
          <button type="button" class="dream-ask" data-act="interpret" ${asking ? 'disabled' : ''}>
            <span class="dream-ask-spark" aria-hidden="true">✨</span><span>${asking ? 'Sending…' : 'What does it mean?'}</span>
          </button>`;
        return;
      }

      if (isPending(dream)) {
        const sent = timeOf(interp.requestedAt);
        slot.innerHTML = `
          <section class="glass dream-interp-card dream-interp-wait">
            <div class="dream-interp-moon" aria-hidden="true">${icons.moon}</div>
            <p class="dream-interp-wait-title">Interpreting your dream…</p>
            <div class="dream-interp-shimmer" aria-hidden="true"><span></span><span></span><span></span></div>
            <p class="dream-interp-wait-note faint">While we test, a reply can take a few minutes. You can leave this screen — it will be here when you come back.</p>
            ${sent ? `<p class="dream-interp-sent faint">Sent at ${esc(sent)}</p>` : ''}
          </section>`;
        ensurePolling();
        return;
      }
      stopPolling();

      if (interp.status !== 'done' || !interp.result || typeof interp.result !== 'object') {
        slot.innerHTML = `
          <section class="glass dream-interp-card dream-interp-failed">
            <p class="dream-interp-failed-title">This dream couldn't be interpreted.</p>
            <button type="button" class="btn btn-ghost" data-act="interpret" ${asking ? 'disabled' : ''}>${asking ? 'Sending…' : 'Try again'}</button>
          </section>`;
        return;
      }

      slot.innerHTML = interpretationHTML(dream);
    }

    function interpretationHTML(dream) {
      const interp = dream.interpretation;
      const r = interp.result;
      const parts = [];

      const stale = isStale(dream)
        ? `<p class="dream-interp-stale faint">The dream was edited after this interpretation · <button type="button" class="dream-interp-link" data-act="interpret" ${asking ? 'disabled' : ''}>${asking ? 'Sending…' : 'Interpret again'}</button></p>`
        : '';

      const essence = str(r.essence);
      parts.push(`
        <section class="glass dream-interp-card">
          <p class="dream-interp-kicker"><span aria-hidden="true">✨</span> What it may mean <span class="dream-interp-beta">beta</span></p>
          ${essence ? `<p class="dream-interp-essence">${esc(essence)}</p>` : ''}
          ${stale}
        </section>`);

      const symbols = itemList(r.symbols);
      if (symbols) parts.push(`<section class="glass dream-interp-card">${interpHead('Symbols')}${symbols}</section>`);

      const themes = itemList(r.themes);
      if (themes) parts.push(`<section class="glass dream-interp-card">${interpHead('Themes')}${themes}</section>`);

      const arc = str(r.feeling?.arc);
      const feel = str(r.feeling?.text);
      if (arc || feel) {
        parts.push(`
          <section class="glass dream-interp-card">
            ${interpHead('The feeling')}
            ${arc ? `<span class="chip dream-interp-arc">${esc(arc)}</span>` : ''}
            ${feel ? `<p class="dream-interp-text">${esc(feel)}</p>` : ''}
          </section>`);
      }

      const persp = PERSPECTIVES.filter(([k]) => str(r.perspectives?.[k]));
      if (persp.length) {
        if (!persp.some(([k]) => k === perspKey)) perspKey = persp[0][0];
        const tabs = persp.length > 1
          ? `<div class="dream-interp-tabs" role="tablist">${persp.map(([k, label]) => `
              <button type="button" role="tab" class="dream-interp-tab" data-act="persp" data-key="${k}" aria-selected="${k === perspKey}">${label}</button>`).join('')}
            </div>`
          : '';
        const panels = persp.map(([k]) => `
          <p class="dream-interp-text dream-interp-panel" role="tabpanel" data-panel="${k}" ${k === perspKey ? '' : 'hidden'}>${esc(str(r.perspectives[k]))}</p>`).join('');
        parts.push(`
          <section class="glass dream-interp-card">
            ${interpHead(persp.length > 1 ? 'Perspectives' : `Perspective · ${persp[0][1]}`)}
            ${tabs}${panels}
          </section>`);
      }

      const questions = arr(r.reflect).map(str).filter(Boolean);
      if (questions.length) {
        parts.push(`
          <section class="glass dream-interp-card">
            ${interpHead('Reflect')}
            <ul class="dream-interp-reflect">${questions.map((q) => `<li>${esc(q)}</li>`).join('')}</ul>
          </section>`);
      }

      const care = str(r.care);
      if (care) parts.push(`<section class="dream-interp-care"><p>${esc(care)}</p></section>`);

      let based = arr(r.basedOn).map((x) => String(x ?? '').trim()).filter(Boolean);
      if (!based.length) based = [...arr(r.symbols), ...arr(r.themes)].map((x) => str(x?.entry)).filter(Boolean);
      based = [...new Set(based)];
      const disclaimer = str(r.disclaimer) || 'For reflection, not prediction.';

      parts.push(`
        <section class="glass dream-interp-card dream-interp-foot">
          ${based.length ? `
            <details class="dream-interp-based">
              <summary><span>Based on ${based.length} knowledge ${based.length === 1 ? 'entry' : 'entries'}</span>${icons.chevronRight}</summary>
              <ul>${based.map((b) => `<li>${esc(prettyEntry(b))}</li>`).join('')}</ul>
            </details>` : ''}
          ${feedbackHTML(interp)}
          <p class="dream-interp-disclaimer faint">${esc(disclaimer)}</p>
        </section>`);

      return parts.join('');
    }

    function feedbackHTML(interp) {
      const rated = interp.rating === 1 || interp.rating === -1;
      const thumb = (val, emoji, label) => `
        <button type="button" class="dream-interp-thumb" data-act="rate" data-rating="${val}" aria-pressed="${interp.rating === val}" aria-label="${label}" ${feedbackBusy ? 'disabled' : ''}>${emoji}</button>`;
      const note = rated && noteOpen && !interp.feedbackNote
        ? `
          <form class="dream-interp-note" data-note novalidate>
            <input class="field" type="text" name="note" maxlength="500" autocomplete="off" placeholder="Anything to add? (optional)" aria-label="Optional note">
            <button type="submit" class="btn btn-ghost" ${feedbackBusy ? 'disabled' : ''}>Send</button>
          </form>`
        : '';
      const label = !rated ? 'Was this helpful?' : interp.feedbackNote ? 'Thanks — noted.' : 'Thanks';
      return `
        <div class="dream-interp-feedback">
          <span class="dream-interp-ask">${label}</span>
          <span class="dream-interp-thumbs">${thumb(1, '👍', 'Helpful')}${thumb(-1, '👎', 'Not helpful')}</span>
        </div>${note}`;
    }

    async function askForInterpretation() {
      if (asking) return;
      const dream = getDream(id);
      if (!dream) return;
      asking = true;
      paintInterp();
      try {
        await requestInterpretation(dream);
        noteOpen = false;
        perspKey = 'psychology';
      } catch (err) {
        ctx.toast?.(err?.message || "Couldn't send the dream. Please try again.");
      } finally {
        asking = false;
      }
      if (root.isConnected) paintInterp();
    }

    async function rate(rating, note) {
      if (feedbackBusy) return;
      const dream = getDream(id);
      if (!dream?.interpretation) return;
      feedbackBusy = true;
      try {
        await sendFeedback(dream, rating, note);
        noteOpen = !note;
      } catch (err) {
        ctx.toast?.(err?.message || "Couldn't send feedback. Please try again.");
      } finally {
        feedbackBusy = false;
      }
      if (root.isConnected) paintInterp();
    }

    function showEdit(dream) {
      const draft = { tags: [...(dream.tags || [])], lucid: !!dream.lucid, recurring: !!dream.recurring };

      root.innerHTML = `
        ${header(dream)}
        <form class="dream-edit" novalidate>
          <div class="glass dream-card">
            <label class="dream-label" for="dream-title-input">Title</label>
            <input id="dream-title-input" class="field dream-title-input" type="text" autocomplete="off" value="${esc(dream.title)}">

            <label class="dream-label" for="dream-text-input">Dream</label>
            <textarea id="dream-text-input" class="field dream-textarea" rows="8">${esc(dream.text)}</textarea>

            <p class="dream-label">Tags</p>
            <div class="dream-chips dream-chips-edit">
              ${Object.keys(TAGS).map((t) => `<button type="button" class="chip" data-tag="${t}" aria-pressed="${draft.tags.includes(t)}" style="--hue:${TAGS[t].hue}">${esc(TAGS[t].label)}</button>`).join('')}
            </div>

            <div class="dream-toggles">
              <button type="button" class="dream-toggle" data-act="lucid"></button>
              <button type="button" class="dream-toggle" data-act="recurring"></button>
            </div>
          </div>
          <div class="dream-actions">
            <button type="button" class="btn btn-ghost" data-act="cancel">Cancel</button>
            <button type="submit" class="btn">${icons.check}<span>Save</span></button>
          </div>
        </form>`;

      const form = root.querySelector('form');
      const titleInput = form.querySelector('#dream-title-input');
      const textInput = form.querySelector('#dream-text-input');

      const paintToggles = () => {
        const l = form.querySelector('[data-act="lucid"]');
        const r = form.querySelector('[data-act="recurring"]');
        l.setAttribute('aria-pressed', String(draft.lucid));
        l.innerHTML = `${draft.lucid ? icons.star : icons.starOutline}<span>Lucid</span>`;
        r.setAttribute('aria-pressed', String(draft.recurring));
        r.innerHTML = `${icons.repeat}<span>Recurring</span>`;
      };
      paintToggles();

      form.addEventListener('click', (e) => {
        const chip = e.target.closest('button.chip[data-tag]');
        if (chip) {
          const t = chip.dataset.tag;
          const on = chip.getAttribute('aria-pressed') !== 'true';
          chip.setAttribute('aria-pressed', String(on));
          draft.tags = on ? [...draft.tags.filter((x) => x !== t), t] : draft.tags.filter((x) => x !== t);
          return;
        }
        const act = e.target.closest('[data-act]')?.dataset.act;
        if (act === 'lucid') { draft.lucid = !draft.lucid; paintToggles(); }
        if (act === 'recurring') { draft.recurring = !draft.recurring; paintToggles(); }
      });

      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const text = textInput.value.trim();
        if (!text) {
          ctx.toast?.('Write a few words about the dream first');
          textInput.focus();
          return;
        }
        const patch = { text, tags: draft.tags, lucid: draft.lucid, recurring: draft.recurring };
        const title = titleInput.value.trim();
        if (title !== dream.title) {
          if (title) patch.title = title;
          else patch.titleEdited = false; // cleared: go back to an automatic title
        }
        updateDream(dream.id, patch);
        leaveEdit();
        ctx.toast?.('Dream saved');
      });
    }

    function leaveEdit() {
      editing = false;
      // Drop "/edit" from the address without triggering a new route.
      if (sub === 'edit') {
        try { history.replaceState(null, '', `#dream/${id}`); } catch {}
      }
      show();
      window.scrollTo(0, 0);
    }

    root.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'back') goBack();
      else if (act === 'edit') { editing = true; show(); window.scrollTo(0, 0); }
      else if (act === 'cancel') leaveEdit();
      else if (act === 'interpret') askForInterpretation();
      else if (act === 'rate') rate(Number(e.target.closest('[data-rating]')?.dataset.rating) === -1 ? -1 : 1);
      else if (act === 'persp') {
        perspKey = e.target.closest('[data-key]')?.dataset.key || 'psychology';
        const card = e.target.closest('.dream-interp-card');
        for (const t of card?.querySelectorAll('[data-act="persp"]') ?? []) t.setAttribute('aria-selected', String(t.dataset.key === perspKey));
        for (const p of card?.querySelectorAll('[data-panel]') ?? []) p.hidden = p.dataset.panel !== perspKey;
      }
      else if (act === 'delete') {
        // eslint-disable-next-line no-alert
        if (!confirm('Delete this dream?')) return;
        deleteDream(id);
        ctx.toast?.('Dream deleted');
        ctx.navigate('#journal');
      }
    });

    root.addEventListener('submit', (e) => {
      const form = e.target.closest?.('form[data-note]');
      if (!form) return;
      e.preventDefault();
      const note = form.elements.note?.value.trim();
      if (!note) { noteOpen = false; paintInterp(); return; }
      rate(getDream(id)?.interpretation?.rating === -1 ? -1 : 1, note);
    });

    show();
  },

  destroy() {
    cleanup?.();
    cleanup = null;
  },
};
