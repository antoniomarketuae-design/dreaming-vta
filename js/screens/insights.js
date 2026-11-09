// Insights: patterns across the journal — totals, recurring symbols, moods by week, common words.
import { listDreams, getStats, localDay } from '../store.js';
import { TAGS } from '../analyze.js';
import { esc, icons } from '../ui.js';

const DAY = 86400000;
const WEEKS = 8;

const STOPWORDS = new Set(`
about above across after again against almost along already also although always among another anyone anything
anyway anywhere around away back because been before began behind being below beside besides between both bring
came cannot come comes coming could couldnt didnt does doesnt doing done dont down during each either else enough
even ever every everyone everything exactly felt feel feeling find found from gave give goes going gone gonna got
gotten have having hear heard here herself himself into isnt itself just keep kept knew know last later like looked
looking made make makes making many maybe might mine more most much must myself near never next nobody none nothing
once only onto other others ours over really right said same seem seemed seems shall should since some someone
something somehow somewhere soon started still such suddenly sure take taking than that thats their theirs them
themselves then there theres these they thing things think this those though thought through thru told took toward
towards tried trying under until upon very wanted wants wasnt were werent what whatever when where which while whole
whom whose will with within without wont would wouldnt yeah your yours yourself dream dreams dreamt dreamed dreaming
dreamy again also became become becomes kind sort lots quite rather tell telling went want each every than ive youre
theyre were wasn weren didn couldn wouldn could should shouldnt instead around while
`.trim().split(/\s+/));

const dayDate = (iso) => new Date(`${iso}T00:00:00`);
const daysBetween = (a, b) => Math.round((b - a) / DAY);

// Word -> tag hue, so cloud words that are also tag words share the tag's colour.
let wordHue = null;
function hueForWord(w) {
  if (!wordHue) {
    wordHue = new Map();
    for (const tag of Object.values(TAGS)) for (const t of tag.words) if (!wordHue.has(t)) wordHue.set(t, tag.hue);
  }
  return wordHue.get(w);
}

function chip(id) {
  return `<span class="chip" style="--hue:${TAGS[id].hue}">${esc(TAGS[id].label)}</span>`;
}

// ---- Sections ----

function tilesHTML(dreams) {
  const s = getStats();
  const tile = (value, label, extra = '') => `
    <div class="ins-tile glass">
      <div class="ins-tile-value">${value}${extra ? `<span class="ins-tile-unit">${extra}</span>` : ''}</div>
      <div class="ins-tile-label">${label}</div>
    </div>`;
  return `
    <div class="ins-tiles">
      ${tile(s.total ?? dreams.length, 'Dreams recorded')}
      ${tile(s.streak, 'Current streak', s.streak === 1 ? 'night' : 'nights')}
      ${tile(s.lucid, 'Lucid dreams')}
      ${tile(s.thisMonth, 'This month')}
    </div>`;
}

function symbolsHTML(dreams) {
  const counts = new Map();
  for (const d of dreams) for (const t of new Set(d.tags || [])) {
    if (TAGS[t]?.kind === 'symbol') counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 7);
  const recurring = dreams.filter((d) => d.recurring).length;
  const max = ranked[0]?.[1] || 1;
  const bars = ranked.length
    ? ranked.map(([id, n]) => {
      const { hue, label } = TAGS[id];
      return `
        <div class="ins-bar-row">
          <span class="ins-bar-label">${esc(label)}</span>
          <span class="ins-bar-track">
            <span class="ins-bar" style="width:${Math.max(6, (n / max) * 100).toFixed(1)}%;--hue:${hue}"></span>
          </span>
          <span class="ins-bar-count">${n}</span>
        </div>`;
    }).join('')
    : '<p class="muted ins-empty-line">No symbols spotted yet — they appear as you describe places, people and things.</p>';
  const recLine = recurring
    ? `<span class="star-mark">${icons.star}</span>${recurring} dream${recurring === 1 ? '' : 's'} marked recurring`
    : 'No dreams marked recurring yet';
  return `
    <section class="ins-card glass">
      <h2 class="ins-card-title">Recurring symbols</h2>
      <div class="ins-bars">${bars}</div>
      <p class="ins-foot muted">${recLine}</p>
    </section>`;
}

function moodsHTML(dreams) {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  const start = new Date(monday);
  start.setDate(monday.getDate() - 7 * (WEEKS - 1));

  const moodIds = Object.keys(TAGS).filter((id) => TAGS[id].kind === 'mood');
  const weeks = Array.from({ length: WEEKS }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i * 7);
    return { start: d, counts: new Map(), total: 0 };
  });
  const recent = new Map();
  const today = localDay();

  for (const d of dreams) {
    if (!d.date) continue;
    const when = dayDate(d.date);
    const moods = (d.tags || []).filter((t) => TAGS[t]?.kind === 'mood');
    if (!moods.length) continue;
    const idx = Math.floor(daysBetween(start, when) / 7);
    if (idx >= 0 && idx < WEEKS) {
      for (const t of moods) { weeks[idx].counts.set(t, (weeks[idx].counts.get(t) ?? 0) + 1); weeks[idx].total += 1; }
    }
    const ago = daysBetween(when, dayDate(today));
    if (ago >= 0 && ago < 14) for (const t of moods) recent.set(t, (recent.get(t) ?? 0) + 1);
  }

  const maxTotal = Math.max(1, ...weeks.map((w) => w.total));
  const used = moodIds.filter((id) => weeks.some((w) => w.counts.has(id)));

  const cols = weeks.map((w, i) => {
    const segs = moodIds.filter((id) => w.counts.has(id)).map((id) => {
      const n = w.counts.get(id);
      return `<span class="ins-seg" style="flex:${n};--hue:${TAGS[id].hue}" title="${esc(TAGS[id].label)}: ${n}"></span>`;
    }).join('');
    const label = i === WEEKS - 1 ? 'This wk' : w.start.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
    return `
      <div class="ins-col">
        <div class="ins-col-area">
          <div class="ins-stack${w.total ? '' : ' ins-stack-empty'}" style="height:${w.total ? Math.max(8, (w.total / maxTotal) * 100).toFixed(1) : 0}%">${segs}</div>
        </div>
        <span class="ins-col-label">${esc(label)}</span>
      </div>`;
  }).join('');

  const top = [...recent.entries()].sort((a, b) => b[1] - a[1]);
  let line;
  if (!top.length) line = 'No moods noted in the last two weeks.';
  else if (top[1] && top[1][1] === top[0][1]) line = `A mix of ${esc(TAGS[top[0][0]].label)} and ${esc(TAGS[top[1][0]].label)} lately.`;
  else line = `Mostly ${esc(TAGS[top[0][0]].label)} lately.`;

  return `
    <section class="ins-card glass">
      <h2 class="ins-card-title">Moods over time</h2>
      <p class="ins-lead">${line}</p>
      ${used.length
        ? `<div class="ins-chart" role="img" aria-label="Mood tags per week, last ${WEEKS} weeks">${cols}</div>
           <div class="ins-legend">${used.map(chip).join('')}</div>`
        : '<p class="muted ins-empty-line">No moods in the last eight weeks yet.</p>'}
    </section>`;
}

function wordsHTML(dreams) {
  const counts = new Map();
  for (const d of dreams) {
    const words = String(d.text || '').toLowerCase().replace(/[’']/g, '').match(/\p{L}+/gu) ?? [];
    for (const w of words) {
      if (w.length < 4 || STOPWORDS.has(w)) continue;
      counts.set(w, (counts.get(w) ?? 0) + 1);
    }
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 12);
  if (!top.length) return '';
  const max = top[0][1];
  const min = top[top.length - 1][1];
  // Biggest words in the middle, smaller ones drifting outwards.
  const arranged = [];
  top.forEach((entry, i) => (i % 2 ? arranged.push(entry) : arranged.unshift(entry)));
  const words = arranged.map(([w, n]) => {
    const t = max === min ? 0.5 : (n - min) / (max - min);
    const size = (14 + t * 16).toFixed(1);
    const hue = hueForWord(w);
    const style = hue == null
      ? `font-size:${size}px;opacity:${(0.6 + t * 0.4).toFixed(2)}`
      : `font-size:${size}px;opacity:${(0.6 + t * 0.4).toFixed(2)};--hue:${hue}`;
    return `<span class="ins-word${hue == null ? '' : ' ins-word-tinted'}" style="${style}" title="${n}×">${esc(w)}</span>`;
  }).join(' ');
  return `
    <section class="ins-card glass">
      <h2 class="ins-card-title">Dream words</h2>
      <div class="ins-cloud">${words}</div>
    </section>`;
}

// ---- Screen ----

export default {
  id: 'insights',
  label: 'Insights',
  icon: icons.insights,

  render(el) {
    const dreams = listDreams();

    if (dreams.length < 3) {
      const left = 3 - dreams.length;
      el.innerHTML = `
        <div class="ins">
          <h1 class="screen-title">Insights</h1>
          <div class="ins-card ins-intro glass">
            <div class="ins-intro-icon">${icons.insights}</div>
            <h2 class="ins-intro-title">Insights appear after a few dreams</h2>
            <p class="muted">Record ${left} more dream${left === 1 ? '' : 's'} and patterns will start to show here — recurring symbols, moods and the words you use most.</p>
            <a class="btn btn-ghost" href="#record">${icons.plus}<span>Record a dream</span></a>
          </div>
        </div>`;
      return;
    }

    el.innerHTML = `
      <div class="ins">
        <h1 class="screen-title">Insights</h1>
        ${tilesHTML(dreams)}
        ${symbolsHTML(dreams)}
        ${moodsHTML(dreams)}
        ${wordsHTML(dreams)}
      </div>`;
  },
};
