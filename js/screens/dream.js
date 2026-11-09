// One dream: its picture, title, tags and full text, with inline editing and delete.
import { getDream, updateDream, deleteDream } from '../store.js';
import { TAGS } from '../analyze.js';
import { esc, formatDate, relativeDay, icons } from '../ui.js';
import { dreamArtURL } from '../dreamart.js';

function artSrc(dream) {
  try { return dreamArtURL(dream, 360) || ''; } catch { return ''; }
}

const tagChip = (id) => (TAGS[id]
  ? `<span class="chip" style="--hue:${TAGS[id].hue}">${esc(TAGS[id].label)}</span>`
  : '');

const flagChip = (label) => `<span class="chip dream-flag"><span class="star-mark">${icons.star}</span>${label}</span>`;

export default {
  id: 'dream',

  render(el, ctx, param) {
    const [id, sub] = String(param ?? '').split('/');
    const goBack = () => (ctx.back ? ctx.back() : history.back());
    let editing = sub === 'edit';

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
        <div class="dream-actions">
          <button type="button" class="btn btn-ghost" data-act="edit">${icons.edit}<span>Edit</span></button>
          <button type="button" class="btn btn-danger" data-act="delete">${icons.trash}<span>Delete</span></button>
        </div>`;
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
      else if (act === 'delete') {
        // eslint-disable-next-line no-alert
        if (!confirm('Delete this dream?')) return;
        deleteDream(id);
        ctx.toast?.('Dream deleted');
        ctx.navigate('#journal');
      }
    });

    show();
  },
};
