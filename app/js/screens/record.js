// Record a dream: speak it (default) or type it, then review title, tags and picture, then save.
import { createDream, updateDream, getSetting } from '../store.js';
import { TAGS, detectTags, suggestTitle } from '../analyze.js';
import { esc, icons } from '../ui.js';
import { dreamArtPreview } from '../dreamart.js';

const DRAFT_KEY = 'dreaming.draft';
const DICTATE_TIP = 'Tip: tap the 🎤 on your keyboard to dictate.';
const LUCID_HINT = /\blucid\b|knew (that )?i was dreaming|reali[sz]ed (that )?i was dreaming/i;

const wordCount = (t) => (String(t || '').trim().match(/\S+/g) || []).length;
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const newSeed = () => Math.floor(Math.random() * 2 ** 31);

function loadDraft() {
  try { return sessionStorage.getItem(DRAFT_KEY) || ''; } catch { return ''; }
}
function saveDraft(text) {
  try {
    if (String(text).trim()) sessionStorage.setItem(DRAFT_KEY, text);
    else sessionStorage.removeItem(DRAFT_KEY);
  } catch {}
}
function clearDraft() {
  try { sessionStorage.removeItem(DRAFT_KEY); } catch {}
}

function artSrc(tags, seed) {
  try { return dreamArtPreview(tags, seed, 320) || ''; } catch { return ''; }
}

const tagChip = (id, pressed) => `<button type="button" class="chip" data-tag="${id}" aria-pressed="${pressed}" style="--hue:${TAGS[id].hue}">${esc(TAGS[id].label)}</button>`;

// Kept across visits until the dream is saved, so the preview picture stays the same.
let draftSeed = null;
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
  if (draftSeed == null) draftSeed = newSeed();

  const st = {
    step: 'edit',
    mode: param === 'type' || !Recognition || getSetting('inputMode', 'voice') === 'type' ? 'type' : 'voice',
    notice: '',
    text: loadDraft(),
    // review
    reviewedText: null,
    title: '',
    titleTouched: false,
    detected: [],
    tags: [],
    lucid: false,
    recurring: false,
    moreOpen: false,
  };

  // Speech recognition state
  let rec = null;
  let listening = false;
  let baseText = '';

  const root = document.createElement('div');
  root.className = 'rec';
  el.innerHTML = '';
  el.append(root);

  const goBack = () => (ctx.back ? ctx.back() : history.back());

  // ---------- Edit step (voice or typing) ----------

  let textarea, micBtn, statusEl, hintEl, continueBtn, modeBtn, voiceEl;

  function renderEdit() {
    st.step = 'edit';
    root.innerHTML = `
      <header class="screen-header">
        <button type="button" class="icon-btn" data-act="close" aria-label="Close">${icons.close}</button>
        <h1 class="screen-title">Last night's dream</h1>
      </header>
      <div class="rec-voice">
        <button type="button" class="rec-mic" data-act="mic" aria-pressed="false" aria-label="Start speaking">${icons.mic}</button>
        <p class="rec-status muted" aria-live="polite"></p>
      </div>
      <textarea class="field rec-text" rows="8" aria-label="Your dream"
        placeholder="Describe what you remember… people, places, feelings"></textarea>
      <p class="rec-hint faint" hidden></p>
      <div class="rec-actions">
        <button type="button" class="btn" data-act="continue" hidden>Continue</button>
        <button type="button" class="rec-link" data-act="mode"></button>
      </div>
    `;
    textarea = root.querySelector('.rec-text');
    micBtn = root.querySelector('.rec-mic');
    statusEl = root.querySelector('.rec-status');
    hintEl = root.querySelector('.rec-hint');
    continueBtn = root.querySelector('[data-act="continue"]');
    modeBtn = root.querySelector('[data-act="mode"]');
    voiceEl = root.querySelector('.rec-voice');

    textarea.value = st.text;
    textarea.addEventListener('input', () => {
      // The person is typing: stop listening so speech doesn't overwrite their edit.
      if (listening) stopListening(true);
      onTextChanged();
    });
    applyMode();
    updateMic();
    updateContinue();
  }

  function applyMode() {
    if (st.step !== 'edit') return;
    const voice = st.mode === 'voice';
    voiceEl.hidden = !voice;
    textarea.classList.toggle('rec-soft', voice);
    textarea.rows = voice ? 6 : 8;
    textarea.placeholder = voice
      ? 'Your words will appear here as you speak…'
      : 'Describe what you remember… people, places, feelings';

    modeBtn.hidden = !voice && !Recognition;
    modeBtn.innerHTML = voice
      ? `${icons.keyboard}<span>Type instead</span>`
      : `${icons.mic}<span>Speak instead</span>`;

    if (voice) {
      hintEl.hidden = true;
    } else {
      hintEl.hidden = false;
      hintEl.innerHTML = (st.notice ? `<span class="rec-notice">${esc(st.notice)}</span>` : '') + `<span>${esc(DICTATE_TIP)}</span>`;
    }
  }

  function setMode(mode, focus) {
    if (listening) stopListening(true);
    st.mode = mode;
    if (mode === 'voice') st.notice = '';
    applyMode();
    updateMic();
    if (focus && mode === 'type') focusText();
  }

  function focusText() {
    try {
      textarea.focus();
      const end = textarea.value.length;
      textarea.setSelectionRange(end, end);
    } catch {}
  }

  function onTextChanged() {
    st.text = textarea.value;
    saveDraft(st.text);
    updateContinue();
  }

  function updateContinue() {
    if (continueBtn) continueBtn.hidden = wordCount(st.text) < 3;
  }

  function updateMic(message) {
    if (st.step !== 'edit' || !micBtn) return;
    micBtn.setAttribute('aria-pressed', String(listening));
    micBtn.setAttribute('aria-label', listening ? 'Stop listening' : 'Start speaking');
    micBtn.innerHTML = listening ? icons.stop : icons.mic;
    statusEl.textContent = message
      || (listening ? 'Listening… tap to stop'
        : st.text.trim() ? 'Tap to keep going' : 'Tap and tell me what you remember');
  }

  // ---------- Speech recognition ----------

  function startListening() {
    if (!Recognition) { fallback(); return; }
    try {
      rec = new Recognition();
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = navigator.language || 'en-US';
    } catch {
      rec = null;
      fallback();
      return;
    }
    baseText = textarea.value.replace(/\s+$/, '');

    rec.onresult = (e) => {
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
      textarea.value = baseText ? `${baseText} ${startSentence ? cap(spoken) : spoken}` : cap(spoken);
      textarea.scrollTop = textarea.scrollHeight;
      onTextChanged();
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
      fallback("Voice isn't available here, so let's type instead.");
    };

    rec.onend = () => endListening();

    try {
      rec.start();
      listening = true;
      updateMic();
    } catch {
      detach();
      fallback("Voice isn't available here, so let's type instead.");
    }
  }

  function detach() {
    if (!rec) return;
    rec.onresult = null;
    rec.onerror = null;
    rec.onend = null;
    rec = null;
  }

  // Called when recognition ends by itself or after stop().
  function endListening(message) {
    const r = rec;
    detach();
    if (message && r) { try { r.abort(); } catch {} }
    listening = false;
    if (textarea) st.text = textarea.value;
    saveDraft(st.text);
    updateMic(message);
  }

  // hard = drop any late results (used when typing, switching modes or leaving).
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
    st.notice = message || '';
    st.mode = 'type';
    if (st.step === 'edit') {
      applyMode();
      updateMic();
      focusText();
    }
  }

  // ---------- Review step ----------

  function renderReview() {
    if (listening) stopListening(true);
    const text = st.text.trim();
    if (st.reviewedText !== text) {
      if (st.reviewedText === null && LUCID_HINT.test(text)) st.lucid = true;
      st.reviewedText = text;
      if (!st.titleTouched) st.title = suggestTitle(text);
      st.detected = detectTags(text);
      st.tags = [...st.detected];
    }
    st.step = 'review';
    textarea = micBtn = statusEl = hintEl = continueBtn = modeBtn = voiceEl = null;

    const others = Object.keys(TAGS).filter((id) => !st.detected.includes(id));
    const src = artSrc(st.tags, draftSeed);

    root.innerHTML = `
      <header class="screen-header">
        <button type="button" class="icon-btn" data-act="close" aria-label="Close">${icons.close}</button>
        <h1 class="screen-title">Last night's dream</h1>
      </header>
      <figure class="rec-art">${src ? `<img src="${src}" alt="A picture made from this dream" width="320" height="320">` : ''}</figure>
      <div class="glass rec-card">
        <label class="rec-label" for="rec-title">Title</label>
        <input id="rec-title" class="field rec-title" type="text" autocomplete="off" enterkeyhint="done" value="${esc(st.title)}">

        <p class="rec-label">Tags</p>
        <div class="rec-chips" data-group="detected">
          ${st.detected.map((id) => tagChip(id, st.tags.includes(id))).join('')
            || '<span class="faint rec-none">No tags found yet. Add some below.</span>'}
        </div>
        <button type="button" class="rec-link rec-more-btn" data-act="more" aria-expanded="${st.moreOpen}">
          ${icons.plus}<span>More tags</span>
        </button>
        <div class="rec-chips" data-group="more" ${st.moreOpen ? '' : 'hidden'}>
          ${others.map((id) => tagChip(id, st.tags.includes(id))).join('')}
        </div>

        <div class="rec-toggles">
          <button type="button" class="rec-toggle" data-act="lucid" aria-pressed="${st.lucid}"></button>
          <button type="button" class="rec-toggle" data-act="recurring" aria-pressed="${st.recurring}"></button>
        </div>
      </div>
      <div class="rec-actions">
        <button type="button" class="btn" data-act="save">${icons.check}<span>Save dream</span></button>
        <button type="button" class="rec-link" data-act="edit-text">${icons.back}<span>Back</span></button>
      </div>
    `;
    renderToggles();

    const titleInput = root.querySelector('#rec-title');
    titleInput.addEventListener('input', () => {
      st.title = titleInput.value;
      st.titleTouched = true;
    });
    titleInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); titleInput.blur(); }
    });
    window.scrollTo(0, 0);
  }

  function renderToggles() {
    const lucid = root.querySelector('[data-act="lucid"]');
    const recurring = root.querySelector('[data-act="recurring"]');
    if (lucid) {
      lucid.setAttribute('aria-pressed', String(st.lucid));
      lucid.innerHTML = `${st.lucid ? icons.star : icons.starOutline}<span>Lucid</span>`;
    }
    if (recurring) {
      recurring.setAttribute('aria-pressed', String(st.recurring));
      recurring.innerHTML = `${icons.repeat}<span>Recurring</span>`;
    }
  }

  function refreshArt() {
    const fig = root.querySelector('.rec-art');
    if (!fig) return;
    const src = artSrc(st.tags, draftSeed);
    let img = fig.querySelector('img');
    if (!src) { img?.remove(); return; }
    if (!img) {
      img = document.createElement('img');
      img.alt = 'A picture made from this dream';
      img.width = 320;
      img.height = 320;
      fig.append(img);
    }
    img.src = src;
  }

  function toggleTag(btn) {
    const id = btn.dataset.tag;
    if (!TAGS[id]) return;
    const on = btn.getAttribute('aria-pressed') !== 'true';
    btn.setAttribute('aria-pressed', String(on));
    st.tags = on ? [...st.tags.filter((t) => t !== id), id] : st.tags.filter((t) => t !== id);
    refreshArt();
  }

  function save() {
    const text = st.text.trim();
    if (wordCount(text) < 1) { renderEdit(); return; }
    const title = st.titleTouched && st.title.trim() && st.title.trim() !== suggestTitle(text)
      ? st.title.trim()
      : undefined;
    const d = createDream({ text, title, tags: [...st.tags], lucid: st.lucid, recurring: st.recurring });
    // Same seed as the preview, so the saved picture matches what was shown.
    updateDream(d.id, { seed: draftSeed });
    clearDraft();
    draftSeed = null;
    st.text = '';
    // Replace the recorder in history so Back from the dream doesn't return here.
    location.replace(`#dream/${d.id}`);
  }

  // ---------- Events ----------

  root.addEventListener('click', (e) => {
    const chip = e.target.closest('button.chip[data-tag]');
    if (chip) { toggleTag(chip); return; }
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    switch (btn.dataset.act) {
      case 'close':
        if (listening) stopListening(true);
        goBack();
        break;
      case 'mic':
        if (listening) stopListening(false);
        else startListening();
        break;
      case 'mode':
        setMode(st.mode === 'voice' ? 'type' : 'voice', true);
        break;
      case 'continue':
        if (wordCount(st.text) >= 3) renderReview();
        break;
      case 'more': {
        st.moreOpen = !st.moreOpen;
        btn.setAttribute('aria-expanded', String(st.moreOpen));
        const more = root.querySelector('[data-group="more"]');
        if (more) more.hidden = !st.moreOpen;
        break;
      }
      case 'lucid':
        st.lucid = !st.lucid;
        renderToggles();
        break;
      case 'recurring':
        st.recurring = !st.recurring;
        renderToggles();
        break;
      case 'edit-text':
        renderEdit();
        window.scrollTo(0, 0);
        break;
      case 'save':
        save();
        break;
      default:
    }
  });

  renderEdit();
  if (st.mode === 'type') focusText();

  return () => {
    if (rec) {
      const r = rec;
      detach();
      try { r.abort(); } catch {}
    }
    listening = false;
    if (st.step === 'edit' && textarea) saveDraft(textarea.value);
  };
}
