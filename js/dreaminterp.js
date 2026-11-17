// "Analyze" from the library (owner, 2026-11-16: "why by hand, why not from the database?"): builds the full
// interpretation card for one dream on the phone, from Dreaming's dream library, in the same shape the old by-hand
// interpretations had ({ essence, symbols, themes, feeling, reflect, care, basedOn, disclaimer }), so the dream page
// shows it with the same card. Instant, free, and the dream text never leaves the phone (reader.js downloads only
// the library's word list and the meanings it needs). No predictions, no diagnosis: the library's answers already
// follow those rules; the care lines below are added for sensitive images.
import { readDream, sentences } from './reader.js';
import { coreOf, feelingsOf, moodOf } from './periodreader.js';
import { dreamType } from './symbols.js';

const MAX_SYMBOLS = 5;
const MAX_THEMES = 2;
const DISCLAIMER = "Built on this iPhone from Dreaming's dream library. For reflection, not prediction.";

// Care lines for sensitive images (the entries' own care notes are written for the writers, not for the dreamer).
const CRISIS = new Set(['theme.suicide']);
const TRAUMA = new Set(['theme.abused', 'theme.attacked', 'theme.torture', 'theme.kidnapped', 'event.war',
  'event.accident', 'theme.drowning', 'action.killing', 'person.killer']);
const GRIEF = new Set(['emotion.grief', 'event.funeral', 'person.deceased', 'place.cemetery', 'place.grave',
  'object.coffin', 'theme.death-of-loved-one', 'theme.dying', 'theme.miscarriage', 'theme.near-death']);
const CRISIS_WORDS = /\b(kill myself|killing myself|suicid\w*|end my life|self[- ]?harm|hurt myself|want to die|don'?t want to live)\b/i;

const lower = (s) => (/^[A-Z][a-z]/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s);
const upper = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const listOf = (items) => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`);

function careFor(dream, ids) {
  const text = `${dream.title || ''} ${dream.text || ''}`;
  if (CRISIS_WORDS.test(text) || ids.some((id) => CRISIS.has(id))) {
    return 'If you have thoughts of ending your life or do not feel safe, please contact a crisis line or emergency services now, or someone you trust. You deserve support right now.';
  }
  if (ids.some((id) => TRAUMA.has(id))) {
    return 'If this dream echoes something that really happened to you, talking to someone you trust or a professional who works with trauma can help, especially if such dreams keep coming back.';
  }
  if (dream.recurring && dreamType(dream) === 'nightmare') {
    return 'Nightmares that keep coming back are common and can be helped: a doctor or therapist can support you.';
  }
  if (ids.some((id) => GRIEF.has(id))) {
    return 'If you are grieving, be gentle with yourself: dreams like this are a common part of missing someone, and sharing them with someone close can help.';
  }
  return '';
}

function feelingFor(dream) {
  const felt = [...feelingsOf(dream)];
  const arc = felt.length ? felt.slice(0, 3).join(' · ') : 'not described';
  const text = {
    uneasy: 'It carried fear or unease. How a dream feels is often the clearest clue: the images show what is on your mind, and the unease shows how heavy it feels right now.',
    light: 'It felt good. When images that could be unsettling feel safe or pleasant in a dream, it often points to ease and confidence with what they stand for.',
    mixed: 'It held both good and uneasy moments. Notice where the mood turned: that turn often marks the part of the dream that matters most.',
    '': 'You did not note how it felt. Ask yourself how you felt in the dream and on waking: the feeling is often the best key to what it means.',
  }[moodOf(dream)];
  return { arc, text };
}

/** One image's meaning for this dream: the library's first sentences (two for the main image), then the matching situation. */
function tailored(im, n = 1) {
  const base = sentences(im.meaning, n);
  const s = im.situations?.[0];
  if (!s?.when || !s?.meaning) return base;
  return `${base} In your dream, ${lower(String(s.when).replace(/[.\s]+$/, ''))}: ${lower(String(s.meaning))}`;
}

/**
 * The interpretation of one dream, built from the library. Resolves to the result object; throws an Error with a
 * friendly message when the dream is too short or the library cannot be reached the first time.
 */
export async function interpretFromLibrary(dream) {
  const text = String(dream?.text ?? '').trim();
  if (text.length < 3) throw new Error('Write a little more about this dream first.');
  const r = await readDream(dream);
  if (r.status === 'offline') throw new Error('The first interpretation needs an internet connection. Please try again when you are online.');
  const feeling = feelingFor(dream);

  if (r.status === 'empty' || !r.images?.length) {
    return {
      essence: 'We did not find images from our dream library in this dream yet. Add a little more detail (the people, places, animals and what happened) and analyze it again.',
      symbols: [],
      themes: [],
      feeling,
      reflect: ['What do you remember most clearly: a person, a place, an object or a feeling?', 'How did you feel when you woke up?'],
      ...(careFor(dream, []) ? { care: careFor(dream, []) } : {}),
      basedOn: [],
      disclaimer: DISCLAIMER,
    };
  }

  const images = r.images;
  const themes = images.filter((im) => im.kind === 't').slice(0, MAX_THEMES);
  // Feelings have their own card (feeling), so feeling entries are not listed as symbols.
  const symbols = images.filter((im) => im.kind !== 't' && im.category !== 'emotion').slice(0, MAX_SYMBOLS);
  const main = images[0];
  const core = coreOf(main.meaning);
  const others = images.slice(1, 4).map((im) => lower(im.name));
  let essence = core
    ? `${upper(lower(main.name))} is at the heart of this dream: it most often points to ${core}.`
    : sentences(main.meaning, 1);
  if (others.length) essence += ` ${upper(listOf(others))} ${others.length === 1 ? 'adds' : 'add'} to the picture.`;
  if (essence.length > 300) essence = sentences(essence, 1);

  const ids = images.map((im) => im.id).filter(Boolean);
  const care = careFor(dream, ids);
  const usedEditorial = [...themes, ...symbols].some((im) => im.situations?.[0]?.editorial);
  return {
    essence,
    symbols: symbols.map((im) => ({ name: im.name, meaning: tailored(im, im === main ? 2 : 1), entry: im.id })),
    themes: themes.map((im) => ({ name: im.name, meaning: tailored(im, im === main ? 2 : 1), entry: im.id })),
    feeling,
    reflect: (r.questions || []).slice(0, 3),
    ...(care ? { care } : {}),
    basedOn: [...new Set(ids)],
    disclaimer: usedEditorial ? `${DISCLAIMER} Some lines about your dream's situation are Dreaming editorial, written by our team.` : DISCLAIMER,
  };
}
