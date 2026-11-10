// Dream goals (#goals): the full list of things to do in a lucid dream. Add, tick off, delete.
import { listGoals, addGoal, updateGoal, deleteGoal } from '../store.js';
import { esc, icons } from '../ui.js';

const IDEAS = [
  'Fly above the clouds at sunrise',
  'Breathe underwater and explore a reef',
  'Ask a dream character what they stand for',
  'Visit a place from my childhood',
  'Walk through a wall',
  'Look at myself in a mirror',
  'Walk on the surface of the moon',
  'Ask the dream to show me something important',
];

function row(g) {
  return `
    <li class="goal-row${g.done ? ' is-done' : ''}">
      <button type="button" class="goal-tick" data-tick="${esc(g.id)}" aria-pressed="${g.done ? 'true' : 'false'}" aria-label="${g.done ? 'Mark as not done' : 'Mark as done'}">${g.done ? icons.check : ''}</button>
      <span class="goal-text">${esc(g.text)}</span>
      <button type="button" class="goal-del" data-del="${esc(g.id)}" aria-label="Delete goal">${icons.trash}</button>
    </li>`;
}

function content() {
  const goals = listGoals();
  const open = goals.filter((g) => !g.done);
  const done = goals.filter((g) => g.done);
  const taken = new Set(goals.map((g) => g.text.toLowerCase()));
  const ideas = IDEAS.filter((i) => !taken.has(i.toLowerCase())).slice(0, 5);
  return `
    <p class="goal-intro muted">What will you do once you know you are dreaming? Keep a few clear goals here and read them before you sleep.</p>

    <form class="goal-form" data-form>
      <input class="field" name="goal" maxlength="140" placeholder="In my next lucid dream I will…" autocomplete="off" enterkeyhint="done" aria-label="New dream goal">
      <button class="btn goal-add" type="submit" aria-label="Add goal">${icons.plus}</button>
    </form>

    ${ideas.length ? `
      <div class="goal-ideas" aria-label="Ideas">
        ${ideas.map((i) => `<button type="button" class="chip goal-idea" data-idea="${esc(i)}">${icons.plus}${esc(i)}</button>`).join('')}
      </div>` : ''}

    ${goals.length ? '' : '<p class="goal-empty faint">No goals yet. Write one above or tap an idea.</p>'}

    ${open.length ? `
      <h2 class="section-title">To do · ${open.length}</h2>
      <ul class="glass goal-list">${open.map(row).join('')}</ul>` : ''}

    ${done.length ? `
      <h2 class="section-title">Achieved · ${done.length}</h2>
      <ul class="glass goal-list">${done.map(row).join('')}</ul>` : ''}`;
}

let cleanup = [];

export default {
  id: 'goals',
  hideTabbar: true,

  render(el, ctx) {
    el.innerHTML = `
      <div class="goal">
        <header class="screen-header">
          <button type="button" class="icon-btn" data-back aria-label="Back">${icons.back}</button>
          <h1 class="screen-title">Dream goals</h1>
        </header>
        <div class="goal-content" data-content>${content()}</div>
      </div>`;

    const box = el.querySelector('[data-content]');
    const repaint = (focus) => {
      box.innerHTML = content();
      if (focus) box.querySelector('input')?.focus();
    };
    let armed = null;
    let armTimer = null;

    const onClick = (e) => {
      const btn = e.target.closest('button');
      if (!btn || !el.contains(btn)) return;
      if (btn.matches('[data-back]')) { ctx.back(); return; }
      if (btn.dataset.idea) {
        addGoal(btn.dataset.idea);
        repaint();
        ctx.toast('Goal added');
        return;
      }
      if (btn.dataset.tick) {
        const g = listGoals().find((x) => x.id === btn.dataset.tick);
        if (!g) return;
        updateGoal(g.id, { done: !g.done, doneAt: g.done ? null : new Date().toISOString() });
        repaint();
        if (!g.done) ctx.toast('Goal achieved. Well dreamt!');
        return;
      }
      if (btn.dataset.del) {
        // Two taps to delete, so a stray tap never loses a goal.
        if (armed !== btn.dataset.del) {
          for (const b of el.querySelectorAll('.goal-del.is-armed')) { b.classList.remove('is-armed'); b.innerHTML = icons.trash; }
          armed = btn.dataset.del;
          btn.classList.add('is-armed');
          btn.textContent = 'Delete';
          clearTimeout(armTimer);
          armTimer = setTimeout(() => {
            armed = null;
            btn.classList.remove('is-armed');
            btn.innerHTML = icons.trash;
          }, 3000);
          return;
        }
        clearTimeout(armTimer);
        armed = null;
        deleteGoal(btn.dataset.del);
        repaint();
        ctx.toast('Goal deleted');
      }
    };

    const onSubmit = (e) => {
      if (!e.target.matches('[data-form]')) return;
      e.preventDefault();
      const input = e.target.querySelector('input');
      const text = input.value.trim();
      if (!text) { input.focus(); return; }
      addGoal(text);
      repaint(true);
      ctx.toast('Goal added');
    };

    // #screen outlives this page, so delegated listeners are removed in destroy().
    el.addEventListener('click', onClick);
    el.addEventListener('submit', onSubmit);
    cleanup.push(() => {
      el.removeEventListener('click', onClick);
      el.removeEventListener('submit', onSubmit);
      clearTimeout(armTimer);
    });
  },

  destroy() {
    for (const fn of cleanup) { try { fn(); } catch {} }
    cleanup = [];
  },
};
