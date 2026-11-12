// New layout: how the dream types (and the Journal's other filter tiles) look: a small sky glyph, a colour and words.
// Shared by the dream page's type square (screens/dream.js) and the Journal's filter square (screens/journal.js).
// Colours are RGB triplets for CSS custom properties, e.g. style="--tc: 255, 217, 138" → rgba(var(--tc), 0.4).

/** A small glyph in the app's icon style (24-unit box, 1.8 stroke, round ends — like icons in ui.js). */
export const glyph = (body) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;

/** Each type's name, short name, one line, the toast's words, glyph and colour. */
export const TYPE_LOOK = {
  // A crescent moon cradling a small star (lilac)
  general: {
    name: 'General dream', short: 'General', line: 'An everyday dream', as: 'a general dream', rgb: '201, 182, 255',
    glyph: glyph('<path d="M4 14.5A8 8 0 0 0 14.5 4a8 8 0 1 1-10.5 10.5z"/><path d="M8.5 6l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z"/>'),
  },
  // A four-point star and a twinkle (gold)
  lucid: {
    name: 'Lucid dream', short: 'Lucid', line: 'You knew you were dreaming', as: 'a lucid dream', rgb: '255, 217, 138',
    glyph: glyph('<path d="M10 2.5Q11.2 8.8 17.5 10 11.2 11.2 10 17.5 8.8 11.2 2.5 10 8.8 8.8 10 2.5z"/><path d="M18.5 15.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z"/>'),
  },
  // A storm cloud with lightning (coral)
  nightmare: {
    name: 'Nightmare', short: 'Nightmare', line: 'Frightening or upsetting', as: 'a nightmare', rgb: '255, 159, 143',
    glyph: glyph('<path d="M17.5 15.5a4 4 0 0 0-.6-8h-.9A6.5 6.5 0 1 0 5.5 14.6"/><path d="M12.5 11l-3 5h4l-3 5"/>'),
  },
  // A watching eye with three rays (pale blue)
  prophetic: {
    name: 'Prophetic dream', short: 'Prophetic', line: 'Felt like a sign, or came true', as: 'a prophetic dream', rgb: '185, 227, 255',
    glyph: glyph('<path d="M2.5 13.5c2.4-4 5.6-6 9.5-6s7.1 2 9.5 6c-2.4 4-5.6 6-9.5 6s-7.1-2-9.5-6z"/><circle cx="12" cy="13.5" r="2.6"/><path d="M12 2.8v2M6.4 4.6l1.1 1.5M17.6 4.6l-1.1 1.5"/>'),
  },
};

export const TYPE_IDS = Object.keys(TYPE_LOOK);

/** Recurring dreams: two arrows chasing each other round a small star (mint). */
export const RECURRING_LOOK = {
  name: 'Recurring', rgb: '143, 227, 207',
  glyph: glyph('<path d="M4.5 10a7.5 7.5 0 0 1 13-4.2L19.5 8"/><path d="M19.5 3.5V8h-4.5"/><path d="M19.5 14a7.5 7.5 0 0 1-13 4.2L4.5 16"/><path d="M4.5 20.5V16H9"/><path d="M12 9.6l.6 1.8 1.8.6-1.8.6-.6 1.8-.6-1.8-1.8-.6 1.8-.6z"/>'),
};

/** "More filters": a little constellation of three stars and a plus. */
export const MORE_GLYPH = glyph('<circle cx="6" cy="7" r="1.6"/><circle cx="15" cy="5" r="1.6"/><circle cx="8.5" cy="16" r="1.6"/><path d="M7.4 8.1l.6 6.3M7.6 6.6l5.8-1.3"/><path d="M17.5 13v7M14 16.5h7"/>');

/** Moods (analyze.js TAGS mood keys) and a glyph each; anything else gets a small heart. */
const MOOD_GLYPHS = {
  happy: glyph('<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4"/>'),
  calm: glyph('<path d="M3 9.5c2-1.6 4-1.6 6 0s4 1.6 6 0 4-1.6 6 0"/><path d="M3 14.5c2-1.6 4-1.6 6 0s4 1.6 6 0 4-1.6 6 0"/>'),
  anxious: glyph('<path d="M12 12.5a1.5 1.5 0 1 1 1.5-1.5 3.5 3.5 0 1 1-3.5-3.5 5.5 5.5 0 1 1-5.5 5.5"/>'),
  scared: glyph('<path d="M13 2.5 5 13.5h6l-1 8 8-11h-6z"/>'),
  sad: glyph('<path d="M12 3.5c3 4 5 6.8 5 9.5a5 5 0 0 1-10 0c0-2.7 2-5.5 5-9.5z"/>'),
  surreal: glyph('<path d="M12 12a1.6 1.6 0 1 1 1.6 1.6A3.6 3.6 0 1 1 17.2 10 5.6 5.6 0 1 1 6.4 13.6"/><path d="M19 4.5l.6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4-1.4-.6 1.4-.6z"/>'),
};
const HEART = glyph('<path d="M12 19.5s-7-4.3-7-9.3A4 4 0 0 1 12 8a4 4 0 0 1 7 2.2c0 5-7 9.3-7 9.3z"/>');

/** A glyph for an emotion word (its mood tag key when it has one). */
export const moodGlyph = (key) => MOOD_GLYPHS[key] || HEART;

/** HSL hue (0–360) → "r, g, b" for CSS, soft and light so it sits on the night sky. */
export function hueRGB(h) {
  const s = 0.75, l = 0.78;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))));
  return `${f(0)}, ${f(8)}, ${f(4)}`;
}
