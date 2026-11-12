// Record a dream in two steps: a quiet composer (type or speak), then an editor with
// Story · Details · Symbols · Lucidity tabs and Save. Also edits an existing dream.
// Routes: #record (type) · #record/voice (speak) · #record/edit/<id> (editor on a saved dream).
// Details → Picture: the free painted picture ("New picture") plus an AI image (js/images.js): "Visualise as image" on a
// saved dream, or "Create an AI image when I save" for a new one (requested right after createDream).
// Below it an AI video (js/videos.js, Dreaming Plus): "Visualise as video" on a saved dream only; a new one is saved first.
import { createDream, updateDream, getDream, withDefaults, collection, getSetting, setSetting, SYMBOL_CATEGORIES } from '../store.js';
import { TAGS, detectTags, suggestTitle } from '../analyze.js';
import { esc, icons } from '../ui.js';
import { dreamArtPreview } from '../dreamart.js';
import { getAccount, openPaywall } from '../account.js';
import {
  createImage, pollImage, hasImage, isImageFailed, isPainting, imagesAllowed, imagesBlocked, imageBadge,
  hasImageConsent, giveImageConsent,
} from '../images.js';
import {
  createVideo, pollVideo, hasVideo, isVideoPending, isVideoFailed, isFilming, videosBlocked, videoBadge, videoElapsed,
  videoWaitText, openVideoPlayer,
} from '../videos.js';
import { openVideoPicker } from '../videopicker.js';

// The body text stays a plain string under the old key; everything else sits next to it as JSON.
const DRAFT_KEY = 'dreaming.draft';
const DRAFT_META_KEY = 'dreaming.draft.meta';
const EDIT_DRAFT_KEY = 'dreaming.draft.edit';
const DICTATE_TIP = 'Tip: tap the 🎤 on your keyboard to dictate.';
const NO_VOICE = "Voice typing isn't available here, so let's type instead.";
const LUCID_HINT = /\blucid\b|knew (that )?i was dreaming|reali[sz]ed (that )?i was dreaming/i;

const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const newSeed = () => Math.floor(Math.random() * 2 ** 31);
const pad = (n) => String(n).padStart(2, '0');
const localDay = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** The night the dream belongs to: before noon it was last night, so yesterday's date. */
function defaultDate() {
  const d = new Date();
  if (d.getHours() < 12) d.setDate(d.getDate() - 1);
  return localDay(d);
}

// ---------- Local icons (same drawing style as ui.js) ----------

const svg = (body) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const ic = {
  text: svg('<path d="M4 6h16M4 11h16M4 16h10"/>'),
  arrow: svg('<path d="M5 12h14M13 6l6 6-6 6"/>'),
  sun: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2.5 12h2M19.5 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
  storm: svg('<path d="M7 15.5h10.5a3.5 3.5 0 0 0 .3-7A6 6 0 0 0 6.4 9.6 3 3 0 0 0 7 15.5z"/><path d="M9 18.5l-1 2.5M13 18.5l-1 2.5M17 18.5l-1 2.5"/>'),
  hourglass: svg('<path d="M6 3h12M6 21h12M7 3c0 5 5 6 5 9s-5 4-5 9M17 3c0 5-5 6-5 9s5 4 5 9"/>'),
  bed: svg('<path d="M3 18V6M3 14h18v4M21 14v-2a3 3 0 0 0-3-3h-7v5"/><circle cx="7" cy="11" r="1.6"/>'),
  clock: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  smile: svg('<circle cx="12" cy="12" r="9"/><path d="M8.5 14.5a4.5 4.5 0 0 0 7 0M9 9.5h.01M15 9.5h.01"/>'),
  heart: svg('<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>'),
  link: svg('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>'),
  eyeOff: svg('<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/><path d="M4 4l16 16"/>'),
  gamepad: svg('<rect x="2.5" y="7" width="19" height="10" rx="5"/><path d="M7.5 10.5v3M6 12h3M15.5 11h.01M17.5 13h.01"/>'),
  briefcase: svg('<rect x="3" y="7" width="18" height="13" rx="2.5"/><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M3 13h18"/>'),
  ghost: svg('<path d="M5 21V10a7 7 0 0 1 14 0v11l-2.4-1.8L14.3 21 12 19.2 9.7 21l-2.3-1.8z"/><path d="M9.5 10h.01M14.5 10h.01"/>'),
  pin: svg('<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.4"/>'),
  bulb: svg('<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.6 10.8c.7.6 1.1 1.3 1.1 2.2h5c0-.9.4-1.6 1.1-2.2A6 6 0 0 0 12 3z"/>'),
  steps: svg('<path d="M7.5 3C5.6 3 4.5 5 4.5 7.5c0 2 .8 3.5 1 5h4c.2-1.5 1-3 1-5C10.5 5 9.4 3 7.5 3zM5.5 15.5h4v1a2 2 0 0 1-4 0z"/><path d="M16.5 7c-1.9 0-3 2-3 4.5 0 2 .8 3.5 1 5h4c.2-1.5 1-3 1-5 0-2.5-1.1-4.5-3-4.5zM14.5 19.5h4v.5a2 2 0 0 1-4 0z"/>'),
};

// ---------- Copy ----------

const HELP = {
  voice: 'Speak and your words are added to the end of the text. Only the text is kept, never a recording.',
  rating: 'How did this dream feel overall? 1 is very unpleasant, 5 is wonderful.',
  picture: "The painted picture is made on your phone from your dream's themes; nothing is uploaded. Try a new one until you like it. An AI image is created on Dreaming's server from the dream's text and is shown instead of it. An AI video is a few seconds of your dream in motion, with sound, made there too.",
  length: 'How long the dream seemed, from a short flash to a whole story.',
  inDream: 'Were you yourself in the dream, or watching it like a film?',
  emotions: 'Pick the feelings you had in the dream, or add your own.',
  matchesMood: "Did the dream's mood match how you felt that day?",
  realLife: 'Is the dream connected to something happening in your waking life?',
  recurring: 'Have you had this dream, or one very like it, before?',
  sleep: 'How well you slept that night.',
  times: "Optional. Dreaming can't read sleep data from Apple Health, so add the times yourself if you like.",
  lucid: 'A lucid dream is one where you knew you were dreaming while it was happening.',
  control: 'Could you choose what happened next, even a little?',
  vividness: 'How clear and detailed the dream felt.',
};

const CATS = {
  people: { label: 'People', add: 'Add a person', icon: icons.profile, help: 'People you know from waking life: family, friends, colleagues.' },
  objects: { label: 'Objects', add: 'Add an object', icon: ic.briefcase, help: 'Things that stood out: a key, a car, a letter.' },
  characters: { label: 'Characters', add: 'Add a character', icon: ic.ghost, help: "Strangers, animals, creatures or figures you don't know in waking life." },
  places: { label: 'Places', add: 'Add a place', icon: ic.pin, help: 'Where the dream happened.' },
  themes: { label: 'Themes', add: 'Add a theme', icon: ic.bulb, help: 'The big ideas: being late, flying, searching, a transformation.' },
  actions: { label: 'Actions', add: 'Add an action', icon: ic.steps, help: 'What you or others did: running, hiding, swimming.' },
};

const EMOTIONS = ['happy', 'calm', 'excited', 'loved', 'curious', 'amazed', 'free', 'confused',
  'anxious', 'scared', 'sad', 'angry', 'lonely', 'ashamed', 'relieved', 'nostalgic'];

const TABS = [['story', 'Story'], ['details', 'Details'], ['symbols', 'Symbols'], ['lucidity', 'Lucidity']];

// ---------- Symbol suggestions from the dream's own words ----------

// "word" or "word=label" (label used for plurals etc.).
const WORDS = {
  people: 'mom mum mother dad father parents sister brother family grandma grandmother grandpa grandfather son daughter wife husband friend friends teacher boss baby child children kid kids partner boyfriend girlfriend neighbour neighbor cousin aunt uncle colleague classmate doctor nurse',
  characters: 'monster monsters=monster ghost ghosts=ghost stranger strangers=stranger witch angel demon alien aliens=alien dragon zombie zombies=zombie vampire fairy robot creature king queen soldier soldiers=soldier police thief clown dog cat bird birds=bird horse snake wolf fish lion tiger spider bear shark owl',
  places: 'house home room school building kitchen hallway hallways=hallway bedroom bathroom classroom office hospital church street park forest field mountain mountains=mountain garden beach ocean sea river lake city town village road airport station castle island desert cave space shop store restaurant hotel bridge tower basement attic library playground stadium',
  objects: 'car train plane bus boat ship bike ticket phone key keys=key door book mirror money bag clock knife gun ring letter bread cake computer window bed camera box gift flower flowers=flower tree trees=tree teeth moon star stars=star sun glass candle sword map',
};
const PHRASES = {
  actions: [['flying', 'fly flying flew'], ['floating', 'float floating floated hover hovering'], ['running', 'run running ran'],
    ['swimming', 'swim swimming swam'], ['falling', 'fall falling fell'], ['hiding', 'hide hiding hid'], ['being chased', 'chased'],
    ['chasing', 'chasing'], ['escaping', 'escape escaping escaped'], ['fighting', 'fight fighting fought'], ['dancing', 'dance dancing danced'],
    ['driving', 'drive driving drove'], ['searching', 'search searching searched looking'], ['talking', 'talk talking talked'],
    ['kissing', 'kiss kissing kissed'], ['crying', 'cry crying cried'], ['laughing', 'laugh laughing laughed'], ['eating', 'eat eating ate'],
    ['climbing', 'climb climbing climbed'], ['walking', 'walk walking walked'], ['baking', 'bake baking baked'], ['cooking', 'cook cooking cooked'],
    ['singing', 'sing singing sang'], ['screaming', 'scream screaming screamed'], ['travelling', 'travelling traveling travelled traveled'],
    ['waiting', 'wait waiting waited'], ['playing', 'play playing played'], ['shopping', 'shopping'], ['hugging', 'hug hugging hugged']],
  themes: [['being late', 'late'], ['exams', 'exam exams test'], ['being lost', 'lost'], ['transformation', 'transformed transforming became'],
    ['death', 'death died dead dying'], ['wedding', 'wedding married'], ['teeth falling out', 'teeth'], ['being naked', 'naked'],
    ['pregnancy', 'pregnant pregnancy'], ['being trapped', 'trapped stuck'], ['childhood', 'childhood']],
};
const NOT_NAMES = new Set(['i', "i'm", "i'd", "i've", "i'll", 'god', 'ok', 'okay', 'tv', 'then', 'and', 'but', 'so',
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday', 'january', 'february', 'march', 'april',
  'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december', 'christmas', 'english']);

let lexicon = null;
function getLexicon() {
  if (lexicon) return lexicon;
  lexicon = new Map();
  const add = (word, cat, label) => {
    if (!lexicon.has(word)) lexicon.set(word, []);
    lexicon.get(word).push([cat, label]);
  };
  for (const [cat, list] of Object.entries(WORDS)) {
    for (const item of list.split(' ')) {
      const [word, label] = item.split('=');
      add(word, cat, label || word);
    }
  }
  for (const [cat, rows] of Object.entries(PHRASES)) for (const [label, list] of rows) for (const w of list.split(' ')) add(w, cat, label);
  return lexicon;
}

/** Capitalised words that don't start a sentence, e.g. "Anna" in "I saw Anna at the station". */
function properNouns(text) {
  const out = [];
  for (const sentence of String(text).split(/[.!?\n…]+/)) {
    for (const raw of sentence.trim().split(/\s+/).slice(1)) {
      const w = raw.replace(/^[^\p{L}]+|[^\p{L}']+$/gu, '').replace(/'s$/, '');
      if (/^\p{Lu}\p{Ll}+$/u.test(w) && !NOT_NAMES.has(w.toLowerCase()) && !getLexicon().has(w.toLowerCase())) out.push(w);
    }
  }
  return out;
}

/** Per category: words found in the text first, then symbols used in earlier dreams. */
function buildSuggestions(text) {
  const out = Object.fromEntries(SYMBOL_CATEGORIES.map((c) => [c, []]));
  const push = (cat, label) => {
    if (out[cat] && label && !out[cat].some((x) => x.toLowerCase() === label.toLowerCase())) out[cat].push(label);
  };
  const lex = getLexicon();
  for (const w of String(text).toLowerCase().match(/[a-z']+/g) || []) for (const [cat, label] of lex.get(w) || []) push(cat, label);
  for (const id of detectTags(text, 5)) push('themes', TAGS[id]?.label);
  for (const name of properNouns(text)) push('people', name);
  try {
    for (const [cat, ...rest] of collection().symbolList) push(cat, rest.join(':'));
  } catch {}
  return out;
}

// ---------- Draft shape ----------

const emptySymbols = () => Object.fromEntries(SYMBOL_CATEGORIES.map((c) => [c, []]));

function blank() {
  return {
    title: '',
    text: '',
    date: defaultDate(),
    kind: 'dream',
    ratings: { rating: null, length: null, sleep: null },
    emotions: [],
    questions: { inDream: null, matchesMood: null, realLife: null },
    recurring: null,
    notes: '',
    symbols: emptySymbols(),
    lucid: false,
    lucidity: { control: null, vividness: null },
    sleep: { bedtime: null, wake: null },
    seed: newSeed(),
  };
}

function normalize(d) {
  const b = blank();
  if (!d || typeof d !== 'object') return b;
  const out = {
    ...b,
    ...d,
    ratings: { ...b.ratings, ...(d.ratings || {}) },
    questions: { ...b.questions, ...(d.questions || {}) },
    lucidity: { ...b.lucidity, ...(d.lucidity || {}) },
    sleep: { bedtime: d.sleep?.bedtime || null, wake: d.sleep?.wake || null },
    symbols: emptySymbols(),
  };
  for (const c of SYMBOL_CATEGORIES) out.symbols[c] = Array.isArray(d.symbols?.[c]) ? d.symbols[c].map(String) : [];
  out.emotions = Array.isArray(d.emotions) ? d.emotions.map(String) : [];
  out.title = String(out.title || '');
  out.text = String(out.text || '');
  out.notes = String(out.notes || '');
  out.kind = out.kind === 'nightmare' ? 'nightmare' : 'dream';
  out.lucid = Boolean(out.lucid);
  if (!Number.isFinite(out.seed)) out.seed = newSeed();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(out.date))) out.date = defaultDate();
  return out;
}

function fromDream(o) {
  return normalize({
    title: o.title || '',
    text: o.text || '',
    date: o.date,
    kind: o.kind,
    // The dream page's Sleep tab edits sleep.quality (mirrored into ratings.sleep), so it wins.
    ratings: { ...o.ratings, sleep: o.sleep.quality ?? o.ratings.sleep ?? null },
    emotions: o.emotions,
    questions: o.questions,
    recurring: o.recurring ? true : null,
    notes: o.notes,
    symbols: o.symbols,
    lucid: o.lucid,
    lucidity: o.lucidity,
    sleep: o.sleep,
    seed: o.seed,
  });
}

function loadDraft() {
  let text = '';
  let meta = null;
  try {
    text = sessionStorage.getItem(DRAFT_KEY) || '';
    meta = JSON.parse(sessionStorage.getItem(DRAFT_META_KEY) || 'null');
  } catch {}
  const d = normalize({ ...(meta?.d || {}), text });
  const flags = {
    lucidTouched: Boolean(meta?.lucidTouched),
    dateTouched: Boolean(meta?.dateTouched),
    aiOnSave: typeof meta?.aiOnSave === 'boolean' ? meta.aiOnSave : null, // null: follows whether images are allowed
  };
  if (!flags.dateTouched) d.date = defaultDate();
  return { d, flags };
}

function clearDraft() {
  try {
    sessionStorage.removeItem(DRAFT_KEY);
    sessionStorage.removeItem(DRAFT_META_KEY);
  } catch {}
}

function loadEditDraft(id) {
  try {
    const saved = JSON.parse(sessionStorage.getItem(EDIT_DRAFT_KEY) || 'null');
    return saved?.id === id ? normalize(saved.d) : null;
  } catch { return null; }
}

function clearEditDraft() {
  try { sessionStorage.removeItem(EDIT_DRAFT_KEY); } catch {}
}

function parseVal(s) {
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (/^\d+$/.test(s)) return Number(s);
  return s;
}

function autosize(el) {
  if (!el) return;
  const y = window.scrollY;
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight + 2}px`;
  if (window.scrollY !== y) window.scrollTo(0, y);
}

// ---------- Screen ----------

let cleanup = null;

export default {
  id: 'record',
  hideTabbar: true,

  render(el, ctx, param) {
    cleanup?.();
    cleanup = mount(el, ctx, param);
  },

  destroy() {
    cleanup?.();
    cleanup = null;
  },
};

function mount(el, ctx, param) {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition || null;
  const root = document.createElement('div');
  root.className = 'rec';
  el.innerHTML = '';
  el.append(root);
  const goBack = () => (ctx.back ? ctx.back() : history.back());

  const match = /^edit\/(.+)$/.exec(param || '');
  const editId = match ? match[1] : null;
  const raw = editId ? getDream(editId) : null;

  if (editId && !raw) {
    root.innerHTML = `
      <header class="screen-header">
        <button type="button" class="icon-btn" data-act="back" aria-label="Back">${icons.back}</button>
        <h1 class="screen-title">Dream not found</h1>
      </header>
      <p class="muted">This dream may have been deleted.</p>`;
    root.querySelector('[data-act="back"]').addEventListener('click', goBack);
    return () => {};
  }

  const original = raw ? withDefaults(raw) : null;
  const draft = editId ? null : loadDraft();
  const st = {
    step: editId ? 'edit' : 'compose',
    mode: param === 'voice' ? 'voice' : 'text',
    tab: 'story',
    notice: '',
    voiceOff: false,
    big: getSetting('recordTextSize', 'normal') === 'large',
    d: editId ? (loadEditDraft(editId) || fromDream(original)) : draft.d,
    meta: editId ? { lucidTouched: true, dateTouched: true } : draft.flags,
    sugg: null,
  };
  if (st.mode === 'voice' && !Recognition) {
    st.mode = 'text';
    st.notice = NO_VOICE;
  }

  const origSig = original ? JSON.stringify([String(original.text || '').trim(), original.emotions, original.symbols]) : '';
  let finished = false; // saved or discarded: don't write the draft back on the way out

  const hasText = () => Boolean(st.d.text.trim() || st.d.title.trim());

  function persist() {
    if (finished) return;
    try {
      if (editId) {
        sessionStorage.setItem(EDIT_DRAFT_KEY, JSON.stringify({ id: editId, d: st.d }));
        return;
      }
      if (st.d.text.trim()) sessionStorage.setItem(DRAFT_KEY, st.d.text);
      else sessionStorage.removeItem(DRAFT_KEY);
      if (hasText()) sessionStorage.setItem(DRAFT_META_KEY, JSON.stringify({ d: { ...st.d, text: undefined }, ...st.meta }));
      else sessionStorage.removeItem(DRAFT_META_KEY);
    } catch {}
  }

  /** Tag ids for the picture and the journal: from the text plus the chosen emotions and symbols. */
  function tagsForSave() {
    if (editId && JSON.stringify([st.d.text.trim(), st.d.emotions, st.d.symbols]) === origSig) {
      return Array.isArray(original.tags) ? [...original.tags] : [];
    }
    const words = [st.d.text, st.d.emotions.join(' '), ...SYMBOL_CATEGORIES.flatMap((c) => st.d.symbols[c])].join(' ');
    return detectTags(words, 3);
  }

  const getPath = (p) => p.split('.').reduce((o, k) => (o == null ? undefined : o[k]), st.d);
  function setPath(p, v) {
    const keys = p.split('.');
    const last = keys.pop();
    keys.reduce((o, k) => o[k], st.d)[last] = v;
  }

  // ---------- Speech recognition (Web Speech API, falls back to typing) ----------

  let rec = null;
  let listening = false;
  let baseText = '';
  let target = null;

  function onText(value, field) {
    st.d.text = value;
    autosize(field);
    persist();
    updateComposeState();
  }

  function updateMic(message) {
    const mic = root.querySelector('.rec-mic');
    const status = root.querySelector('.rec-status');
    if (mic) {
      mic.setAttribute('aria-pressed', String(listening));
      mic.setAttribute('aria-label', listening ? 'Stop listening' : 'Start speaking');
      mic.innerHTML = listening ? icons.stop : icons.mic;
    }
    if (status) {
      status.textContent = message || (listening ? 'Listening… tap to stop'
        : st.step === 'compose'
          ? (st.d.text.trim() ? 'Tap to keep going' : 'Tap and tell me what you remember')
          : 'Tap to add more');
    }
  }

  function startListening() {
    const field = root.querySelector('[data-field="text"]');
    if (!Recognition || !field) { fallback(NO_VOICE); return; }
    try {
      rec = new Recognition();
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = navigator.language || 'en-US';
    } catch {
      rec = null;
      fallback(NO_VOICE);
      return;
    }
    target = field;
    baseText = field.value.replace(/\s+$/, '');

    rec.onresult = (e) => {
      if (!target?.isConnected) { stopListening(true); return; }
      let finalText = '';
      let interim = '';
      for (let i = 0; i < e.results.length; i += 1) {
        const r = e.results[i];
        if (r.isFinal) finalText += `${r[0].transcript} `;
        else interim += `${r[0].transcript} `;
      }
      const spoken = (finalText + interim).replace(/\s+/g, ' ').trim();
      if (!spoken) return;
      const startSentence = !baseText || /[.!?]$/.test(baseText);
      target.value = baseText ? `${baseText} ${startSentence ? cap(spoken) : spoken}` : cap(spoken);
      onText(target.value, target);
    };

    rec.onerror = (e) => {
      const err = e?.error;
      if (err === 'aborted') return;
      if (err === 'no-speech') {
        endListening("I didn't catch anything. Tap the mic and try again.");
        return;
      }
      if (err === 'not-allowed') {
        fallback("Dreaming isn't allowed to use the microphone right now, so let's type instead. You can turn it on later in Settings.");
        return;
      }
      // 'service-not-allowed' (common in Home Screen apps), 'network', 'audio-capture', ...
      fallback(NO_VOICE);
    };

    rec.onend = () => endListening();

    try {
      rec.start();
      listening = true;
      updateMic();
    } catch {
      detach();
      fallback(NO_VOICE);
    }
  }

  function detach() {
    if (!rec) return;
    rec.onresult = null;
    rec.onerror = null;
    rec.onend = null;
    rec = null;
  }

  // Recognition ended by itself or after stop().
  function endListening(message) {
    const r = rec;
    detach();
    if (message && r) { try { r.abort(); } catch {} }
    listening = false;
    if (target?.isConnected) st.d.text = target.value;
    persist();
    updateMic(message);
    updateComposeState();
  }

  // hard = drop any late results (typing, switching mode or tab, leaving).
  function stopListening(hard) {
    if (!rec) { listening = false; return; }
    if (hard) {
      const r = rec;
      detach();
      try { r.abort(); } catch {}
      listening = false;
      updateMic();
    } else {
      try { rec.stop(); } catch { endListening(); }
    }
  }

  function fallback(message) {
    if (rec) {
      const r = rec;
      detach();
      try { r.abort(); } catch {}
    }
    listening = false;
    st.notice = message || NO_VOICE;
    if (st.step === 'compose') {
      st.mode = 'text';
      applyCompose();
      updateMic();
      focusBody();
    } else {
      st.voiceOff = true;
      const v = root.querySelector('.rec-vbody');
      if (v) v.innerHTML = voiceBody();
    }
  }

  function focusBody() {
    const field = root.querySelector('[data-field="text"]');
    if (!field) return;
    try {
      field.focus();
      const end = field.value.length;
      field.setSelectionRange(end, end);
    } catch {}
  }

  // ---------- Step 1: composer ----------

  function renderCompose() {
    st.step = 'compose';
    root.className = `rec rec-compose${st.big ? ' rec-big' : ''}`;
    root.innerHTML = `
      <div class="rec-top">
        <button type="button" class="icon-btn" data-act="close" aria-label="Close">${icons.close}</button>
        <div class="rec-seg" role="group" aria-label="How to record">
          <button type="button" data-act="mode" data-mode="text" aria-label="Type">${ic.text}</button>
          <button type="button" data-act="mode" data-mode="voice" aria-label="Speak">${icons.mic}</button>
        </div>
        <button type="button" class="rec-next" data-act="next" aria-label="Next" disabled>${ic.arrow}</button>
      </div>
      <input class="rec-ctitle" data-field="title" type="text" placeholder="Title (optional)" autocomplete="off"
        autocapitalize="sentences" enterkeyhint="next" aria-label="Title" value="${esc(st.d.title)}">
      <div class="rec-voice" hidden>
        <button type="button" class="rec-mic" data-act="mic" aria-pressed="false" aria-label="Start speaking">${icons.mic}</button>
        <p class="rec-status muted" aria-live="polite"></p>
      </div>
      <textarea class="rec-cbody" data-field="text" rows="6" autocapitalize="sentences" aria-label="Your dream"></textarea>
      <p class="rec-notice" hidden></p>
      <div class="glass rec-tips">
        <h2>Writing tips</h2>
        <ul>
          <li>Note everything you remember, even small fragments.</li>
          <li>Write it as if it's happening now: "I'm walking down a street…"</li>
          <li>Short on time? Jot a few keywords first and fill in the rest later.</li>
          <li>Rather talk? Switch to the mic above, or use the 🎤 on your keyboard.</li>
        </ul>
      </div>
      <div class="rec-kbar">
        <button type="button" class="rec-aa" data-act="size" aria-pressed="${st.big}" aria-label="Larger text">Aa</button>
        <button type="button" class="rec-done" data-act="done" aria-label="Done" hidden>${icons.check}</button>
      </div>`;
    const body = root.querySelector('.rec-cbody');
    body.value = st.d.text;
    applyCompose();
    autosize(body);
    updateMic();
    onViewport();
  }

  function applyCompose() {
    if (st.step !== 'compose') return;
    const voice = st.mode === 'voice';
    for (const b of root.querySelectorAll('[data-act="mode"]')) b.setAttribute('aria-pressed', String(b.dataset.mode === st.mode));
    root.querySelector('.rec-voice').hidden = !voice;
    root.querySelector('.rec-cbody').placeholder = voice ? 'Your words will appear here as you speak…' : 'Write your dream here…';
    const notice = root.querySelector('.rec-notice');
    notice.hidden = !st.notice;
    notice.textContent = st.notice ? `${st.notice} ${DICTATE_TIP}` : '';
    updateComposeState();
  }

  function updateComposeState() {
    if (st.step !== 'compose') return;
    const next = root.querySelector('.rec-next');
    if (next) next.disabled = !hasText();
    const tips = root.querySelector('.rec-tips');
    if (tips) tips.hidden = hasText() || st.mode === 'voice';
  }

  function setMode(mode) {
    if (mode === st.mode) return;
    if (listening) stopListening(true);
    if (mode === 'voice' && !Recognition) { fallback(NO_VOICE); return; }
    st.mode = mode;
    if (mode === 'voice') st.notice = '';
    applyCompose();
    updateMic();
    if (mode === 'text') focusBody();
  }

  // Keeps the Aa / ✓ bar just above the iPhone keyboard.
  const vv = window.visualViewport || null;
  function onViewport() {
    const kb = vv ? Math.max(0, window.innerHeight - vv.height - vv.offsetTop) : 0;
    root.style.setProperty('--rec-kb', `${Math.round(kb)}px`);
    root.classList.toggle('rec-kb-open', kb > 60);
  }
  vv?.addEventListener('resize', onViewport);
  vv?.addEventListener('scroll', onViewport);

  // ---------- Step 2: editor ----------

  function goEditor() {
    if (listening) stopListening(true);
    if (!editId && !st.meta.lucidTouched) st.d.lucid = LUCID_HINT.test(st.d.text);
    renderEditor();
    window.scrollTo(0, 0);
    persist();
  }

  function renderEditor() {
    st.step = 'edit';
    root.className = `rec rec-editor${st.big ? ' rec-big' : ''}`;
    root.style.removeProperty('--rec-kb');
    root.innerHTML = `
      <div class="rec-ehead">
        <div class="rec-erow">
          <button type="button" class="icon-btn" data-act="back" aria-label="Back">${icons.back}</button>
          <span class="rec-ename">${editId ? 'Edit dream' : 'New dream'}</span>
          <button type="button" class="rec-save" data-act="save">${icons.check}<span>Save</span></button>
        </div>
        <div class="rec-tabs" role="tablist">
          ${TABS.map(([id, label]) => `<button type="button" class="rec-tab" role="tab" data-act="tab" data-tab="${id}" aria-selected="${st.tab === id}">${label}</button>`).join('')}
        </div>
      </div>
      <div class="rec-panel" role="tabpanel"></div>`;
    renderPanel();
  }

  function switchTab(tab) {
    if (listening) stopListening(true);
    st.tab = tab;
    for (const t of root.querySelectorAll('.rec-tab')) t.setAttribute('aria-selected', String(t.dataset.tab === tab));
    renderPanel();
    window.scrollTo(0, 0);
  }

  function renderPanel() {
    const panel = root.querySelector('.rec-panel');
    if (!panel) return;
    const build = { story: storyPanel, details: detailsPanel, symbols: symbolsPanel, lucidity: lucidityPanel }[st.tab] || storyPanel;
    panel.innerHTML = build();
    for (const t of panel.querySelectorAll('textarea')) autosize(t);
    updateMic();
    startVideoClock();
    if (st.tab === 'details') getAccount().catch(() => {}); // fresh plan + counts for the AI image and video rows
  }

  // Card: icon tile, title, optional "?" that opens a short explanation.
  function card(icon, label, body, help = '', headExtra = '') {
    return `
      <section class="glass rec-card">
        <div class="rec-chead">
          <span class="rec-ico">${icon}</span>
          <h3>${esc(label)}</h3>
          ${headExtra}
          ${help ? `<button type="button" class="rec-help" data-act="help" aria-expanded="false" aria-label="About ${esc(label)}"><span>?</span></button>` : ''}
        </div>
        ${help ? `<p class="rec-help-text" hidden>${esc(help)}</p>` : ''}
        ${body}
      </section>`;
  }

  function scale(path, lo, hi) {
    const v = getPath(path);
    return `
      <div class="rec-scale" data-group="${path}">
        ${[1, 2, 3, 4, 5].map((n) => `<button type="button" class="rec-opt" data-act="set" data-path="${path}" data-val="${n}" data-nullable="1" aria-pressed="${v === n}">${n}</button>`).join('')}
      </div>
      <div class="rec-ends"><span>${lo}</span><span>${hi}</span></div>`;
  }

  function yesNo(path) {
    const v = getPath(path);
    return `
      <div class="rec-yn" data-group="${path}">
        ${[[false, 'No'], [true, 'Yes']].map(([val, label]) => `<button type="button" class="rec-opt" data-act="set" data-path="${path}" data-val="${val}" data-nullable="1" aria-pressed="${v === val}">${label}</button>`).join('')}
      </div>`;
  }

  function tiles(path, options) {
    const v = getPath(path);
    return `
      <div class="rec-tiles" data-group="${path}">
        ${options.map(([val, label, icon]) => `<button type="button" class="rec-tile" data-act="set" data-path="${path}" data-val="${val}" aria-pressed="${v === val}">${icon}<span>${label}</span></button>`).join('')}
      </div>`;
  }

  // --- Story ---

  function voiceBody() {
    const showMic = Recognition && !st.voiceOff;
    return `
      ${showMic ? `<div class="rec-vrow">
        <button type="button" class="rec-mic rec-mic-sm" data-act="mic" aria-pressed="false" aria-label="Start speaking">${icons.mic}</button>
        <p class="rec-status muted" aria-live="polite"></p>
      </div>` : ''}
      <p class="rec-vnote faint">${st.notice ? `${esc(st.notice)} ` : ''}${esc(showMic ? 'Your words are added to the end of the text.' : DICTATE_TIP)}</p>`;
  }

  function storyPanel() {
    const auto = st.d.text.trim() ? suggestTitle(st.d.text) : '';
    return `
      <label class="rec-flabel" for="rec-stitle">Title</label>
      <input id="rec-stitle" class="field rec-stitle" data-field="title" type="text" autocomplete="off" enterkeyhint="done"
        autocapitalize="sentences" value="${esc(st.d.title)}" placeholder="${esc(auto || 'Title (optional)')}">
      <label class="rec-flabel" for="rec-sbody">Your dream</label>
      <textarea id="rec-sbody" class="field rec-sbody" data-field="text" rows="8" autocapitalize="sentences"
        placeholder="Write your dream here…">${esc(st.d.text)}</textarea>
      ${card(icons.mic, 'Add by voice', `<div class="rec-vbody">${voiceBody()}</div>`, HELP.voice)}`;
  }

  // --- Details ---

  function artSrc() {
    try { return dreamArtPreview(tagsForSave(), st.d.seed, 120, Boolean(st.d.lucid)) || ''; } catch { return ''; }
  }

  function artBody() {
    const src = artSrc();
    const ai = editId && hasImage(getDream(editId));
    return `
      <div class="rec-art">
        <div class="rec-art-img">${src ? `<img src="${src}" alt="Picture painted from this dream" width="120" height="120">` : ''}</div>
        <div class="rec-art-side">
          <p>${ai ? "Painted on your phone. Used when there's no AI image." : "Painted on your phone from your dream's themes."}</p>
          <button type="button" class="rec-reroll" data-act="reroll">${icons.shuffle}<span>New picture</span></button>
        </div>
      </div>
      <div class="rec-ai">${aiBody()}</div>
      <div class="rec-ai rec-vid">${videoBody()}</div>
      <p class="rec-ai-note faint">AI images and videos: this dream's text is sent to Dreaming's server to create them. The rest of your journal stays on this iPhone.</p>`;
  }

  /** Small label next to "Visualise as image" / "Visualise as video": 'PLUS', '4 left', … ('' when unknown). */
  const pill = (b) => (b ? `<span class="rec-ai-badge${b === 'PLUS' ? ' rec-ai-badge-plus' : ''}">${esc(b)}</span>` : '');

  // --- AI image (same rules and limits as the dream page) ---

  /** New dream: is "Create an AI image when I save" on? Untouched, it follows whether images are allowed. */
  const aiOnSave = () => !imagesBlocked() && (st.meta.aiOnSave ?? imagesAllowed());
  // The dream text is only sent on save if the user saw this switch (and its note) or agreed to AI images before.
  let aiShown = false;

  function aiBadge() {
    return pill(imagesBlocked() ? 'PLUS' : imageBadge());
  }

  function aiBody() {
    if (!editId) {
      if (imagesBlocked()) {
        return `
          <div class="rec-ai-row">
            <span class="rec-ai-thumb rec-ai-thumb-empty" aria-hidden="true">${icons.sparkle}</span>
            <p class="rec-ai-text">Turn this dream into a lifelike AI image.</p>
            <button type="button" class="rec-ai-btn" data-act="ai-plus">${icons.sparkle}<span>Visualise as image</span>${aiBadge()}</button>
          </div>`;
      }
      const on = aiOnSave();
      aiShown = true;
      return `
        <button type="button" class="rec-ai-row rec-ai-switchrow" data-act="ai-toggle" role="switch" aria-checked="${on}">
          <span class="rec-ai-thumb rec-ai-thumb-empty" aria-hidden="true">${icons.sparkle}</span>
          <span class="rec-ai-text">Create an AI image when I save ${aiBadge()}</span>
          <span class="rec-switch" aria-hidden="true"><i></i></span>
        </button>`;
    }
    const dream = getDream(editId);
    if (!dream) return '';
    if (isPainting(dream)) {
      const under = hasImage(dream) ? dream.image.url : artSrc();
      return `
        <div class="rec-ai-row" role="status">
          <span class="rec-ai-thumb rec-ai-thumb-wait">${under ? `<img src="${esc(under)}" alt="">` : ''}<i aria-hidden="true"></i></span>
          <p class="rec-ai-text">Creating your dream image…<span class="rec-ai-sub faint">Up to a minute. You can keep editing or leave.</span></p>
        </div>`;
    }
    const has = hasImage(dream);
    const failed = isImageFailed(dream);
    const thumb = has
      ? `<span class="rec-ai-thumb"><img src="${esc(dream.image.url)}" alt="AI image of this dream"></span>`
      : `<span class="rec-ai-thumb rec-ai-thumb-empty" aria-hidden="true">${icons.sparkle}</span>`;
    const text = failed ? esc(dream.imageJob.error || "The image didn't work this time.")
      : has ? 'Your AI image is shown for this dream across the app.'
        : 'Turn this dream into a lifelike AI image.';
    const label = failed ? 'Try again' : has ? 'New image' : 'Visualise as image';
    const act = imagesBlocked() ? 'ai-plus' : 'ai-create';
    return `
      <div class="rec-ai-row">
        ${thumb}
        <p class="rec-ai-text">${text}</p>
        <button type="button" class="rec-ai-btn" data-act="${act}">${icons.sparkle}<span>${label}</span>${aiBadge()}</button>
      </div>`;
  }

  function refreshAi() {
    const box = root.querySelector('.rec-ai');
    if (box) box.innerHTML = aiBody();
  }

  /** Saved dream: paint it now, from the text as it is in the editor. */
  function createAiNow() {
    const saved = getDream(editId);
    if (!saved || isPainting(saved)) return;
    if (imagesBlocked()) { openPaywall({ feature: 'images' }); return; }
    giveImageConsent(); // the note under the button says what is sent
    createImage({
      ...saved,
      text: st.d.text.trim() || saved.text,
      title: st.d.title.trim() || saved.title,
      tags: tagsForSave(),
      kind: st.d.kind === 'nightmare' ? 'nightmare' : 'dream',
    }, { toast: ctx.toast }); // repaints through the 'dreaming:image' event
  }

  // --- AI video (Dreaming Plus: a few seconds with sound, made on the server in 5–15 minutes) ---

  // The "1:23" beside a video in progress ticks once a second while it is on screen.
  let vidClock = null;

  function startVideoClock() {
    clearInterval(vidClock);
    vidClock = null;
    if (!root.querySelector('[data-vid-time]')) return;
    vidClock = setInterval(() => {
      const time = root.querySelector('[data-vid-time]');
      const dream = editId ? getDream(editId) : null;
      if (!time || !isVideoPending(dream)) { clearInterval(vidClock); vidClock = null; return; }
      time.textContent = videoElapsed(dream);
    }, 1000);
  }

  /** The picture shown for a video: the dream's AI image (the video starts from it) or else the painting. */
  const videoPicture = (dream) => (hasImage(dream) ? dream.image.url : artSrc());

  function videoBody() {
    // A video is made from the saved dream, so a new one is saved first.
    if (!editId) {
      if (videosBlocked()) {
        return `
          <div class="rec-ai-row">
            <span class="rec-ai-thumb rec-ai-thumb-empty" aria-hidden="true">${icons.film}</span>
            <p class="rec-ai-text">Turn this dream into a short AI video.</p>
            <button type="button" class="rec-ai-btn" data-act="vid-plus">${icons.film}<span>AI video</span>${pill(videoBadge())}</button>
          </div>`;
      }
      return `
        <div class="rec-ai-row">
          <span class="rec-ai-thumb rec-ai-thumb-empty" aria-hidden="true">${icons.film}</span>
          <p class="rec-ai-text">Turn this dream into a short AI video. ${pill(videoBadge())}<span class="rec-ai-sub faint">Save the dream first to make a video.</span></p>
        </div>`;
    }
    const dream = getDream(editId);
    if (!dream) return '';
    if (isFilming(dream)) {
      const under = videoPicture(dream);
      const time = videoElapsed(dream);
      return `
        <div class="rec-ai-row" role="status">
          <span class="rec-ai-thumb rec-ai-thumb-wait">${under ? `<img src="${esc(under)}" alt="">` : ''}<i aria-hidden="true"></i></span>
          <p class="rec-ai-text">Creating your dream video…<span class="rec-ai-sub faint">${esc(videoWaitText(dream))}</span></p>
          ${time ? `<span class="rec-ai-time" data-vid-time aria-hidden="true">${esc(time)}</span>` : ''}
        </div>`;
    }
    const has = hasVideo(dream);
    const failed = isVideoFailed(dream);
    const under = has ? videoPicture(dream) : '';
    const thumb = has
      ? `<button type="button" class="rec-ai-thumb rec-vid-thumb" data-act="vid-play" aria-label="Watch the video of this dream">${under ? `<img src="${esc(under)}" alt="">` : ''}<span class="video-mark" aria-hidden="true">${icons.play}</span></button>`
      : `<span class="rec-ai-thumb rec-ai-thumb-empty" aria-hidden="true">${icons.film}</span>`;
    const text = failed ? esc(dream.videoJob.error || "The video didn't work this time.")
      : has ? 'Your dream video is ready. Tap the picture to watch it.'
        : 'Turn this dream into a short AI video.';
    const label = failed ? 'Try again' : has ? 'New video' : 'Visualise as video';
    return `
      <div class="rec-ai-row">
        ${thumb}
        <p class="rec-ai-text">${text}</p>
        <button type="button" class="rec-ai-btn" data-act="vid-create">${icons.film}<span>${label}</span>${pill(videoBadge())}</button>
      </div>`;
  }

  function refreshVideo() {
    const box = root.querySelector('.rec-vid');
    if (box) box.innerHTML = videoBody();
    startVideoClock();
  }

  /** Saved dream: make its video now, from the text as it is in the editor. Without Plus this opens the paywall. */
  function createVideoNow() {
    const saved = getDream(editId);
    if (!saved || isFilming(saved)) return;
    const current = {
      ...saved,
      text: st.d.text.trim() || saved.text,
      title: st.d.title.trim() || saved.title,
      tags: tagsForSave(),
      kind: st.d.kind === 'nightmare' ? 'nightmare' : 'dream',
    };
    // Without Plus (or credits) this opens the paywall; otherwise the picker (length, quality, photo; it also says
    // what is sent and that a new video replaces the current one). Repaints through the 'dreaming:video' event.
    if (videosBlocked()) createVideo(current, { toast: ctx.toast });
    else openVideoPicker(current, { toast: ctx.toast });
  }

  function refreshArt() {
    const box = root.querySelector('.rec-art-img');
    if (!box) return;
    const src = artSrc();
    box.innerHTML = src ? `<img src="${src}" alt="Picture painted from this dream" width="120" height="120">` : '';
  }

  function hasItem(list, value) {
    const v = String(value).toLowerCase();
    return list.some((x) => String(x).toLowerCase() === v);
  }

  function emotionsBody() {
    const chosen = st.d.emotions;
    const suggested = detectTags(st.d.text, 6)
      .filter((id) => TAGS[id]?.kind === 'mood')
      .map((id) => TAGS[id].label)
      .filter((label) => EMOTIONS.includes(label));
    const presets = [...suggested, ...EMOTIONS.filter((e) => !suggested.includes(e))];
    const customs = chosen.filter((e) => !EMOTIONS.includes(String(e).toLowerCase()));
    const chip = (e, sug) => {
      const on = hasItem(chosen, e);
      return `<button type="button" class="chip rec-emo${sug && !on ? ' rec-sugg' : ''}" data-act="emo" data-val="${esc(e)}" aria-pressed="${on}">${esc(cap(e))}</button>`;
    };
    return `
      <div class="rec-tags">${customs.map((e) => chip(e, false)).join('')}${presets.map((e) => chip(e, suggested.includes(e))).join('')}</div>
      <div class="rec-add">
        <input class="field" data-add="emotion" type="text" placeholder="Add your own" autocomplete="off" enterkeyhint="done" aria-label="Add your own emotion">
        <button type="button" class="rec-add-btn" data-act="add" data-add-for="emotion" aria-label="Add emotion">${icons.plus}</button>
      </div>`;
  }

  function times() {
    return `
      <div class="rec-times">
        <label class="rec-time"><span>Went to bed</span><input class="field" data-field="bedtime" type="time" value="${esc(st.d.sleep.bedtime || '')}"></label>
        <label class="rec-time"><span>Woke up</span><input class="field" data-field="wake" type="time" value="${esc(st.d.sleep.wake || '')}"></label>
      </div>`;
  }

  function detailsPanel() {
    const dateInput = `<input class="field rec-date" data-field="date" type="date" value="${esc(st.d.date)}" max="${localDay()}" aria-label="Date of the dream">`;
    return `
      <h2 class="section-title">General</h2>
      ${card(icons.calendar, 'Date', '', '', dateInput)}
      ${card(icons.moon, 'Type', tiles('kind', [['dream', 'Dream', ic.sun], ['nightmare', 'Nightmare', ic.storm]]))}
      ${card(icons.starOutline, 'Rating', scale('ratings.rating', 'Very bad', 'Very good'), HELP.rating)}
      ${card(icons.image, 'Picture', artBody(), HELP.picture)}
      ${card(ic.hourglass, 'Dream length', scale('ratings.length', 'Very short', 'Very long'), HELP.length)}
      ${card(icons.profile, 'Were you in the dream?', yesNo('questions.inDream'), HELP.inDream)}

      <h2 class="section-title">Emotions</h2>
      ${card(ic.smile, 'Emotions', `<div class="rec-emobody">${emotionsBody()}</div>`, HELP.emotions)}
      ${card(ic.heart, 'Matches your mood?', yesNo('questions.matchesMood'), HELP.matchesMood)}

      <h2 class="section-title">Context</h2>
      ${card(ic.link, 'Linked to real life?', yesNo('questions.realLife'), HELP.realLife)}
      ${card(icons.repeat, 'Recurring dream?', yesNo('recurring'), HELP.recurring)}

      <h2 class="section-title">Sleep</h2>
      ${card(ic.bed, 'Sleep quality', scale('ratings.sleep', 'Very bad', 'Very good'), HELP.sleep)}
      ${card(ic.clock, 'Sleep times', times(), HELP.times)}

      <h2 class="section-title">Notes</h2>
      <textarea class="field rec-notes" data-field="notes" rows="4" autocapitalize="sentences" aria-label="Notes"
        placeholder="Anything else about this dream…">${esc(st.d.notes)}</textarea>`;
  }

  // --- Symbols ---

  function symbolBody(cat) {
    const items = st.d.symbols[cat] || [];
    const sugg = (st.sugg?.[cat] || []).filter((s) => !hasItem(items, s)).slice(0, 10);
    const meta = CATS[cat];
    return `
      <div class="rec-tags">${items.map((s, i) => `<button type="button" class="chip rec-tag" data-act="sym-del" data-cat="${cat}" data-i="${i}" aria-label="Remove ${esc(s)}"><span>${esc(s)}</span>${icons.close}</button>`).join('')}</div>
      <div class="rec-add">
        <input class="field" data-add="${cat}" type="text" placeholder="${meta.add}" autocomplete="off" enterkeyhint="done" aria-label="${meta.add}">
        <button type="button" class="rec-add-btn" data-act="add" data-add-for="${cat}" aria-label="${meta.add}">${icons.plus}</button>
      </div>
      ${sugg.length ? `<p class="rec-sugg-label faint">Suggestions</p>
      <div class="rec-tags">${sugg.map((s) => `<button type="button" class="chip rec-sugg" data-act="sym-sugg" data-cat="${cat}" data-val="${esc(s)}">${icons.plus}<span>${esc(s)}</span></button>`).join('')}</div>` : ''}`;
  }

  function symbolsPanel() {
    st.sugg = buildSuggestions(st.d.text);
    return `
      <p class="rec-intro muted">Tag who and what was in your dream. Over time they build your symbol collection.</p>
      ${SYMBOL_CATEGORIES.map((c) => card(CATS[c].icon, CATS[c].label, `<div class="rec-symbody" data-cat="${c}">${symbolBody(c)}</div>`, CATS[c].help)).join('')}`;
  }

  function refreshSymbols(cat, refocus) {
    const box = root.querySelector(`.rec-symbody[data-cat="${cat}"]`);
    if (box) box.innerHTML = symbolBody(cat);
    if (refocus) root.querySelector(`[data-add="${cat}"]`)?.focus();
  }

  function refreshEmotions(refocus) {
    const box = root.querySelector('.rec-emobody');
    if (box) box.innerHTML = emotionsBody();
    if (refocus) root.querySelector('[data-add="emotion"]')?.focus();
  }

  const cleanItem = (s) => String(s).replace(/\s+/g, ' ').trim().slice(0, 40);

  function addItems(list, rawValue) {
    let added = false;
    for (const part of String(rawValue).split(',')) {
      const v = cleanItem(part);
      if (v && !hasItem(list, v)) { list.push(v); added = true; }
    }
    return added;
  }

  function addFromInput(input) {
    if (!input) return;
    const key = input.dataset.add;
    if (!input.value.trim()) { input.focus(); return; }
    if (key === 'emotion') {
      addItems(st.d.emotions, input.value);
      refreshEmotions(true);
    } else if (st.d.symbols[key]) {
      addItems(st.d.symbols[key], input.value);
      refreshSymbols(key, true);
    }
    persist();
  }

  // --- Lucidity ---

  function lucidityPanel() {
    const auto = !editId && !st.meta.lucidTouched && st.d.lucid;
    const note = auto ? '<p class="rec-lnote faint">Picked because your text mentions knowing you were dreaming.</p>' : '';
    return `
      ${card(icons.lucidity, 'Lucid dream', tiles('lucid', [[false, 'Not lucid', ic.eyeOff], [true, 'Lucid', icons.lucidity]]) + note, HELP.lucid)}
      ${card(ic.gamepad, 'Could you control it?', yesNo('lucidity.control'), HELP.control)}
      ${card(icons.sparkle, 'Vividness', scale('lucidity.vividness', 'Very vague', 'Very vivid'), HELP.vividness)}`;
  }

  // ---------- Save ----------

  function save() {
    if (listening) stopListening(true);
    const text = st.d.text.trim();
    const title = st.d.title.trim();
    if (!text && !title) {
      ctx.toast?.('Write your dream first');
      if (st.tab !== 'story') switchTab('story');
      return;
    }
    const ratings = { ...st.d.ratings };
    const fields = {
      date: st.d.date || defaultDate(),
      kind: st.d.kind === 'nightmare' ? 'nightmare' : 'dream',
      ratings,
      emotions: [...st.d.emotions],
      questions: { ...st.d.questions },
      recurring: st.d.recurring === true,
      notes: st.d.notes.trim(),
      symbols: Object.fromEntries(SYMBOL_CATEGORIES.map((c) => [c, [...(st.d.symbols[c] || [])]])),
      lucid: Boolean(st.d.lucid),
      lucidity: { ...st.d.lucidity },
      tags: tagsForSave(),
    };
    const sleepTimes = { bedtime: st.d.sleep.bedtime || null, wake: st.d.sleep.wake || null, quality: ratings.sleep };

    if (editId) {
      const patch = { ...fields, text, seed: st.d.seed, sleep: { ...original.sleep, ...sleepTimes } };
      if (title !== String(original.title || '').trim()) {
        if (title) patch.title = title;
        else if (original.titleEdited) patch.title = suggestTitle(text);
        // else: no title in the patch, so the store re-suggests one from the new text
      }
      updateDream(editId, patch);
      finished = true;
      clearEditDraft();
      location.replace(`#dream/${editId}`);
      return;
    }

    const wantAi = aiOnSave() && (aiShown || hasImageConsent());
    const d = createDream({ ...fields, text, title: title || undefined, sleep: sleepTimes });
    // createDream picks its own seed; keep the one from the preview so the saved picture matches.
    const saved = updateDream(d.id, { seed: st.d.seed });
    finished = true;
    clearDraft();
    // "Create an AI image when I save": start it now; it keeps going (and is saved) after we leave this screen.
    if (wantAi && saved) {
      giveImageConsent();
      createImage(saved, { toast: ctx.toast, auto: true });
    }
    location.replace(`#celebrate/${d.id}`);
  }

  // ---------- Events ----------

  function onField(e) {
    const t = e.target;
    const f = t.dataset?.field;
    if (!f) return;
    if (f === 'text') {
      if (e.type !== 'input') return;
      if (listening) stopListening(true);
      onText(t.value, t);
      return;
    }
    if (f === 'title') st.d.title = t.value;
    else if (f === 'notes') { st.d.notes = t.value; autosize(t); }
    else if (f === 'date') {
      if (t.value) { st.d.date = t.value; st.meta.dateTouched = true; } else t.value = st.d.date;
    } else if (f === 'bedtime' || f === 'wake') st.d.sleep[f] = t.value || null;
    persist();
    updateComposeState();
  }
  root.addEventListener('input', onField);
  root.addEventListener('change', onField);

  root.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.isComposing) return;
    const t = e.target;
    if (t.dataset?.add) { e.preventDefault(); addFromInput(t); return; }
    if (t.dataset?.field === 'title') {
      e.preventDefault();
      if (st.step === 'compose') focusBody();
      else t.blur();
    }
  });

  // ✓ shows while typing in the composer; hidden a moment after focus leaves so its own tap still lands.
  let blurTimer = null;
  root.addEventListener('focusin', (e) => {
    if (st.step !== 'compose' || !e.target.dataset?.field) return;
    clearTimeout(blurTimer);
    const done = root.querySelector('.rec-done');
    if (done) done.hidden = false;
  });
  root.addEventListener('focusout', () => {
    if (st.step !== 'compose') return;
    clearTimeout(blurTimer);
    blurTimer = setTimeout(() => {
      const done = root.querySelector('.rec-done');
      const a = document.activeElement;
      if (done && !(a && root.contains(a) && a.dataset?.field)) done.hidden = true;
    }, 220);
  });
  // Desktop: keep the caret in the text while tapping Aa / ✓.
  root.addEventListener('mousedown', (e) => {
    if (e.target.closest('.rec-kbar')) e.preventDefault();
  });

  root.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn || !root.contains(btn)) return;
    switch (btn.dataset.act) {
      case 'close':
        if (listening) stopListening(true);
        persist();
        if (hasText()) ctx.toast?.('Draft kept until you save it');
        goBack();
        break;
      case 'mode':
        setMode(btn.dataset.mode);
        break;
      case 'mic':
        if (listening) stopListening(false);
        else startListening();
        break;
      case 'next':
        if (hasText()) goEditor();
        break;
      case 'size':
        st.big = !st.big;
        root.classList.toggle('rec-big', st.big);
        btn.setAttribute('aria-pressed', String(st.big));
        setSetting('recordTextSize', st.big ? 'large' : 'normal');
        autosize(root.querySelector('.rec-cbody'));
        break;
      case 'done':
        document.activeElement?.blur?.();
        btn.hidden = true;
        break;
      case 'back':
        if (listening) stopListening(true);
        if (editId) {
          finished = true;
          clearEditDraft();
          goBack();
        } else {
          renderCompose();
          window.scrollTo(0, 0);
        }
        break;
      case 'tab':
        switchTab(btn.dataset.tab);
        break;
      case 'save':
        save();
        break;
      case 'help': {
        const text = btn.closest('.rec-card')?.querySelector('.rec-help-text');
        if (!text) break;
        text.hidden = !text.hidden;
        btn.setAttribute('aria-expanded', String(!text.hidden));
        break;
      }
      case 'set': {
        const path = btn.dataset.path;
        let val = parseVal(btn.dataset.val);
        if (btn.dataset.nullable && getPath(path) === val) val = null;
        setPath(path, val);
        const group = btn.closest('[data-group]');
        for (const b of group?.querySelectorAll('[data-act="set"]') || []) b.setAttribute('aria-pressed', String(parseVal(b.dataset.val) === val));
        if (path === 'lucid') {
          st.meta.lucidTouched = true;
          root.querySelector('.rec-lnote')?.remove();
        }
        persist();
        break;
      }
      case 'reroll':
        st.d.seed = newSeed();
        refreshArt();
        persist();
        break;
      case 'ai-toggle':
        st.meta.aiOnSave = !aiOnSave();
        refreshAi();
        persist();
        break;
      case 'ai-plus':
        openPaywall({ feature: 'images' });
        break;
      case 'ai-create':
        createAiNow();
        break;
      case 'vid-plus':
        openPaywall({ feature: 'videos' });
        break;
      case 'vid-create':
        createVideoNow();
        break;
      case 'vid-play': {
        // Straight from the tap, so the player may start with sound.
        const dream = editId ? getDream(editId) : null;
        if (hasVideo(dream)) openVideoPlayer(dream, { poster: hasImage(dream) ? dream.image.url : '' });
        break;
      }
      case 'emo': {
        const v = btn.dataset.val;
        st.d.emotions = hasItem(st.d.emotions, v)
          ? st.d.emotions.filter((x) => String(x).toLowerCase() !== v.toLowerCase())
          : [...st.d.emotions, v];
        refreshEmotions(false);
        persist();
        break;
      }
      case 'add':
        addFromInput(root.querySelector(`[data-add="${btn.dataset.addFor}"]`));
        break;
      case 'sym-sugg': {
        const cat = btn.dataset.cat;
        if (st.d.symbols[cat]) addItems(st.d.symbols[cat], btn.dataset.val);
        refreshSymbols(cat, false);
        persist();
        break;
      }
      case 'sym-del': {
        const cat = btn.dataset.cat;
        const i = Number(btn.dataset.i);
        if (st.d.symbols[cat]) st.d.symbols[cat].splice(i, 1);
        refreshSymbols(cat, false);
        persist();
        break;
      }
      default:
    }
  });

  // AI image and video updates (finished / failed) and plan changes refresh the Picture card.
  // A new AI image also changes the picture shown with the video, so it repaints both rows.
  const onImageEvent = (e) => { if (editId && e?.detail?.dreamId === editId) { refreshAi(); refreshVideo(); } };
  const onVideoEvent = (e) => { if (editId && e?.detail?.dreamId === editId) refreshVideo(); };
  const onAccountEvent = () => { refreshAi(); refreshVideo(); };
  window.addEventListener('dreaming:image', onImageEvent);
  window.addEventListener('dreaming:video', onVideoEvent);
  window.addEventListener('dreaming:account', onAccountEvent);
  if (editId) {
    pollImage(editId); // resume a picture still being painted
    pollVideo(editId); // ...and a video still being made
  }

  // An AI image that can't load (offline): show the painted picture instead.
  root.addEventListener('error', (e) => {
    const img = e.target;
    if (img?.tagName !== 'IMG' || img.dataset.fallback || !String(img.getAttribute('src') || '').startsWith('https://')) return;
    img.dataset.fallback = '1';
    const alt = artSrc();
    if (alt) img.src = alt;
  }, true);

  if (st.step === 'compose') renderCompose();
  else renderEditor();

  return () => {
    window.removeEventListener('dreaming:image', onImageEvent);
    window.removeEventListener('dreaming:video', onVideoEvent);
    window.removeEventListener('dreaming:account', onAccountEvent);
    clearInterval(vidClock);
    vidClock = null;
    if (rec) {
      const r = rec;
      detach();
      try { r.abort(); } catch {}
    }
    listening = false;
    clearTimeout(blurTimer);
    vv?.removeEventListener('resize', onViewport);
    vv?.removeEventListener('scroll', onViewport);
    persist();
  };
}
