// Passcode lock (#lock): a 4-dot PIN keypad shown when a passcode is set and this session isn't unlocked yet.
// Also exports the keypad (mountPinPad) and sha256hex, which the Settings tab reuses to set, change and remove the PIN.
// Touches document/window/storage only inside functions, never at import time.
import { getSetting, setSetting, clearAll } from '../store.js';
import { esc, icons } from '../ui.js';

const UNLOCKED_KEY = 'dreaming.unlocked';
const AFTER_KEY = 'dreaming.afterUnlock';
export const PIN_LENGTH = 4;
const MAX_TRIES = 5;      // wrong attempts in a row before a pause
const PAUSE_SECONDS = 30;

// ---- SHA-256 (hex) ----

const ror = (x, n) => (x >>> n) | (x << (32 - n));
let K = null;
let H0 = null;

/** Pure-JS SHA-256, used only where crypto.subtle is missing (e.g. a page served over plain http). */
function sha256Fallback(bytes) {
  if (!K) {
    // First 32 bits of the fractional parts of the square roots (H0) and cube roots (K) of the first primes.
    const primes = [];
    for (let n = 2; primes.length < 64; n += 1) if (primes.every((p) => n % p)) primes.push(n);
    const frac = (x) => ((x - Math.floor(x)) * 2 ** 32) >>> 0;
    K = Uint32Array.from(primes, (p) => frac(Math.cbrt(p)));
    H0 = Uint32Array.from(primes.slice(0, 8), (p) => frac(Math.sqrt(p)));
  }
  const len = bytes.length;
  const total = ((len + 9 + 63) >> 6) << 6;
  const buf = new Uint8Array(total);
  buf.set(bytes);
  buf[len] = 0x80;
  const dv = new DataView(buf.buffer);
  dv.setUint32(total - 8, Math.floor((len * 8) / 2 ** 32));
  dv.setUint32(total - 4, (len * 8) >>> 0);
  const H = Uint32Array.from(H0);
  const W = new Uint32Array(64);
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i += 1) W[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 64; i += 1) {
      const s0 = ror(W[i - 15], 7) ^ ror(W[i - 15], 18) ^ (W[i - 15] >>> 3);
      const s1 = ror(W[i - 2], 17) ^ ror(W[i - 2], 19) ^ (W[i - 2] >>> 10);
      W[i] = (W[i - 16] + s0 + W[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i += 1) {
      const t1 = (h + (ror(e, 6) ^ ror(e, 11) ^ ror(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + W[i]) >>> 0;
      const t2 = ((ror(a, 2) ^ ror(a, 13) ^ ror(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    H[0] += a; H[1] += b; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += h;
  }
  return [...H].map((x) => x.toString(16).padStart(8, '0')).join('');
}

/** SHA-256 of a string (UTF-8), as lowercase hex. */
export async function sha256hex(text) {
  const bytes = new TextEncoder().encode(String(text));
  const subtle = globalThis.crypto?.subtle;
  if (subtle) {
    try {
      const digest = await subtle.digest('SHA-256', bytes);
      return [...new Uint8Array(digest)].map((x) => x.toString(16).padStart(2, '0')).join('');
    } catch { /* fall through */ }
  }
  return sha256Fallback(bytes);
}

// ---- Keypad ----

const delIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 5h11a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H9l-6-7z"/><path d="m12.5 9.5 5 5M17.5 9.5l-5 5"/></svg>';

/**
 * Renders a 4-dot PIN keypad into `host`. When the 4th digit lands, onComplete(pin) is called and the pad stays
 * busy until the caller answers with pad.shake(hint, title?) (wrong / mismatch), pad.next(title, hint) (next step)
 * or leaves it busy (success, navigating away). Typing digits and Backspace on a keyboard also works.
 */
export function mountPinPad(host, { title = '', hint = '', onComplete }) {
  let pin = '';
  let busy = false;
  let disabled = false;
  const keys = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button class="lock-key" type="button" data-key="${n}">${n}</button>`).join('');
  host.innerHTML = `
    <div class="lock-pad">
      <h2 class="lock-title" data-title>${esc(title)}</h2>
      <p class="lock-hint" data-hint aria-live="polite">${esc(hint)}</p>
      <div class="lock-dots" data-dots role="img" aria-label="0 of ${PIN_LENGTH} digits entered">${'<i></i>'.repeat(PIN_LENGTH)}</div>
      <div class="lock-keys">
        ${keys}
        <span class="lock-key-gap" aria-hidden="true"></span>
        <button class="lock-key" type="button" data-key="0">0</button>
        <button class="lock-key lock-key-del" type="button" data-del aria-label="Delete last digit">${delIcon}</button>
      </div>
    </div>`;

  const dotsEl = host.querySelector('[data-dots]');
  const titleEl = host.querySelector('[data-title]');
  const hintEl = host.querySelector('[data-hint]');

  const paint = () => {
    dotsEl.querySelectorAll('i').forEach((dot, i) => dot.classList.toggle('is-on', i < pin.length));
    dotsEl.setAttribute('aria-label', `${pin.length} of ${PIN_LENGTH} digits entered`);
  };

  const press = (digit) => {
    if (busy || disabled || pin.length >= PIN_LENGTH) return;
    pin += digit;
    paint();
    if (pin.length === PIN_LENGTH) {
      busy = true;
      const entered = pin;
      // A short beat so the fourth dot is seen filling before the answer.
      setTimeout(() => { Promise.resolve(onComplete?.(entered, pad)).catch(() => pad.shake('Something went wrong. Try again.')); }, 140);
    }
  };

  const del = () => {
    if (busy || disabled || !pin) return;
    pin = pin.slice(0, -1);
    paint();
  };

  const onClick = (e) => {
    const key = e.target.closest('[data-key]');
    if (key) { press(key.dataset.key); return; }
    if (e.target.closest('[data-del]')) del();
  };
  host.addEventListener('click', onClick);

  const onKey = (e) => {
    if (!host.isConnected || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target instanceof HTMLElement && e.target.matches('input, textarea')) return;
    if (/^[0-9]$/.test(e.key)) { e.preventDefault(); press(e.key); }
    else if (e.key === 'Backspace') { e.preventDefault(); del(); }
  };
  document.addEventListener('keydown', onKey);

  const setText = (t, h) => {
    if (t != null) titleEl.textContent = t;
    if (h != null) hintEl.textContent = h;
  };

  const pad = {
    /** Wrong PIN: shake the dots, clear, show a hint (and optionally a new title). */
    shake(h, t) {
      dotsEl.classList.remove('lock-shake');
      void dotsEl.offsetWidth; // restart the animation
      dotsEl.classList.add('lock-shake');
      try { navigator.vibrate?.(120); } catch {}
      setTimeout(() => {
        dotsEl.classList.remove('lock-shake');
        pin = '';
        paint();
        setText(t, h ?? '');
        busy = false;
      }, 460);
    },
    /** Next step: clear and show new texts. */
    next(t, h) {
      pin = '';
      paint();
      setText(t, h ?? '');
      busy = false;
    },
    /** Correct PIN: light the dots up in moon-gold. */
    success() {
      dotsEl.classList.add('is-ok');
    },
    setText,
    setDisabled(on) {
      disabled = Boolean(on);
      host.querySelectorAll('.lock-key').forEach((b) => { b.disabled = disabled; });
    },
    destroy() {
      document.removeEventListener('keydown', onKey);
      host.removeEventListener('click', onClick);
    },
  };
  return pad;
}

// ---- The #lock screen ----

let pad = null;
let timer = null;
let tries = 0;

function target() {
  let t = '#home';
  try { t = sessionStorage.getItem(AFTER_KEY) || '#home'; } catch {}
  return t.startsWith('#lock') ? '#home' : t;
}

function unlock(to) {
  try {
    sessionStorage.setItem(UNLOCKED_KEY, '1');
    const t = to || target();
    sessionStorage.removeItem(AFTER_KEY);
    location.replace(t);
  } catch {
    location.replace('#home');
  }
}

function isUnlocked() {
  if (!getSetting('passcode', null)) return true;
  try { return sessionStorage.getItem(UNLOCKED_KEY) === '1'; } catch { return true; }
}

function cleanup() {
  pad?.destroy();
  pad = null;
  clearInterval(timer);
  timer = null;
}

function pause(p) {
  let left = PAUSE_SECONDS;
  p.setDisabled(true);
  p.setText(null, `Too many tries. Wait ${left} s.`);
  clearInterval(timer);
  timer = setInterval(() => {
    left -= 1;
    if (left > 0) { p.setText(null, `Too many tries. Wait ${left} s.`); return; }
    clearInterval(timer);
    timer = null;
    tries = 0;
    p.setDisabled(false);
    p.setText(null, '');
  }, 1000);
}

function showPad(el) {
  const host = el.querySelector('[data-pad-host]');
  el.querySelector('[data-reset]').hidden = true;
  el.querySelector('[data-forgot]').hidden = false;
  host.hidden = false;
  pad?.destroy();
  pad = mountPinPad(host, {
    title: 'Enter your passcode',
    hint: '',
    async onComplete(pin, p) {
      const saved = getSetting('passcode', null);
      if (!saved) { unlock(); return; }
      if ((await sha256hex(pin)) === saved) {
        tries = 0;
        p.success();
        setTimeout(unlock, 180);
        return;
      }
      tries += 1;
      p.shake(tries >= MAX_TRIES ? '' : 'Wrong passcode. Try again.');
      if (tries >= MAX_TRIES) setTimeout(() => pause(p), 470);
    },
  });
  if (timer) pad.setDisabled(true);
}

function showReset(el) {
  pad?.destroy();
  pad = null;
  el.querySelector('[data-pad-host]').hidden = true;
  el.querySelector('[data-forgot]').hidden = true;
  el.querySelector('[data-reset]').hidden = false;
}

export default {
  id: 'lock',
  hideTabbar: true,

  render(el) {
    cleanup();
    if (isUnlocked()) { el.innerHTML = ''; unlock(); return; }

    el.innerHTML = `
      <div class="lock-screen">
        <div class="lock-brand">
          <span class="lock-moon">${icons.moon}</span>
          <p class="lock-app">Dreaming</p>
        </div>
        <div class="lock-pad-host" data-pad-host></div>
        <button class="lock-forgot" type="button" data-forgot>Forgot passcode?</button>
        <section class="glass lock-reset" data-reset hidden>
          <span class="lock-reset-icon">${icons.lock}</span>
          <h2 class="lock-reset-title">Passcodes can't be recovered</h2>
          <p class="lock-reset-text">Dreaming has no account and no server that knows your passcode. To get back in, you can erase the journal on this iPhone and start fresh.</p>
          <p class="lock-reset-text lock-reset-warn">This deletes every dream and dream goal and removes the passcode. It can't be undone.</p>
          <div class="lock-reset-actions">
            <button class="btn btn-danger" type="button" data-erase>${icons.trash}<span>Erase journal and passcode</span></button>
            <button class="btn btn-ghost" type="button" data-cancel>Back to passcode</button>
          </div>
        </section>
      </div>`;

    showPad(el);
    el.querySelector('[data-forgot]').addEventListener('click', () => showReset(el));
    el.querySelector('[data-cancel]').addEventListener('click', () => showPad(el));
    el.querySelector('[data-erase]').addEventListener('click', () => {
      if (!confirm('Erase every dream and goal on this iPhone and remove the passcode? This can\'t be undone.')) return;
      clearAll();
      setSetting('dreamGoals', []);
      setSetting('passcode', null);
      tries = 0;
      unlock('#home');
    });
  },

  destroy() {
    cleanup();
  },
};
