// Reads a dream's text and suggests a title and tags. Runs entirely on the phone.

// kind: 'mood' (how it felt) or 'symbol' (what was in it). hue (0-360) colours the tag everywhere.
export const TAGS = {
  anxious:  { label: 'anxious',  kind: 'mood',   hue: 340, words: ['anxious', 'nervous', 'worried', 'late', 'lost', 'exam', 'test', 'panic', 'stress', 'stressed', 'trapped', 'stuck'] },
  scared:   { label: 'scared',   kind: 'mood',   hue: 0,   words: ['scared', 'afraid', 'fear', 'terrified', 'monster', 'scream', 'screamed', 'nightmare', 'horror', 'ghost'] },
  happy:    { label: 'happy',    kind: 'mood',   hue: 45,  words: ['happy', 'joy', 'laugh', 'laughing', 'smile', 'smiling', 'fun', 'excited', 'love', 'celebrate', 'dancing', 'dance'] },
  calm:     { label: 'calm',     kind: 'mood',   hue: 170, words: ['calm', 'peaceful', 'peace', 'quiet', 'gentle', 'softly', 'safe', 'warm', 'relaxed', 'still'] },
  sad:      { label: 'sad',      kind: 'mood',   hue: 220, words: ['sad', 'cry', 'cried', 'crying', 'tears', 'alone', 'lonely', 'miss', 'missed', 'goodbye', 'grief'] },
  surreal:  { label: 'surreal',  kind: 'mood',   hue: 285, words: ['strange', 'weird', 'surreal', 'glowing', 'impossible', 'transformed', 'melting', 'glass', 'floating', 'turned'] },
  flying:   { label: 'flying',   kind: 'symbol', hue: 205, words: ['fly', 'flying', 'flew', 'float', 'soar', 'soaring', 'wings', 'hover', 'hovering', 'sky'] },
  water:    { label: 'water',    kind: 'symbol', hue: 195, words: ['water', 'ocean', 'sea', 'swim', 'swimming', 'swam', 'river', 'lake', 'rain', 'wave', 'waves', 'flood', 'flooded', 'drown', 'beach'] },
  falling:  { label: 'falling',  kind: 'symbol', hue: 260, words: ['fall', 'falling', 'fell', 'drop', 'dropping', 'cliff', 'edge'] },
  chased:   { label: 'chased',   kind: 'symbol', hue: 10,  words: ['chase', 'chased', 'chasing', 'running', 'ran', 'escape', 'escaping', 'hide', 'hid', 'hiding', 'followed'] },
  family:   { label: 'family',   kind: 'symbol', hue: 30,  words: ['mom', 'mum', 'mother', 'dad', 'father', 'sister', 'brother', 'family', 'grandma', 'grandmother', 'grandpa', 'grandfather', 'son', 'daughter', 'wife', 'husband'] },
  home:     { label: 'home',     kind: 'symbol', hue: 25,  words: ['house', 'home', 'room', 'door', 'school', 'building', 'kitchen', 'hallway', 'hallways', 'bedroom'] },
  animals:  { label: 'animals',  kind: 'symbol', hue: 95,  words: ['dog', 'cat', 'bird', 'birds', 'horse', 'snake', 'wolf', 'animal', 'animals', 'fish', 'lion', 'tiger', 'spider'] },
  night:    { label: 'night',    kind: 'symbol', hue: 240, words: ['dark', 'night', 'moon', 'stars', 'star', 'shadow', 'shadows'] },
  fire:     { label: 'fire',     kind: 'symbol', hue: 18,  words: ['fire', 'burn', 'burning', 'flame', 'flames', 'sun', 'hot', 'lava'] },
  travel:   { label: 'travel',   kind: 'symbol', hue: 150, words: ['car', 'train', 'plane', 'road', 'journey', 'travel', 'travelling', 'traveling', 'bus', 'airport', 'city', 'ticket'] },
  nature:   { label: 'nature',   kind: 'symbol', hue: 120, words: ['forest', 'tree', 'trees', 'flowers', 'flower', 'field', 'mountain', 'garden', 'grass'] },
};

const WORD_TO_TAG = new Map();
for (const [id, tag] of Object.entries(TAGS)) for (const w of tag.words) if (!WORD_TO_TAG.has(w)) WORD_TO_TAG.set(w, id);

/** Tag ids found in the text, most-mentioned first. */
export function detectTags(text, max = 3) {
  const counts = new Map();
  for (const word of String(text || '').toLowerCase().match(/[a-z']+/g) ?? []) {
    const id = WORD_TO_TAG.get(word);
    if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, max).map(([id]) => id);
}

const LEAD_IN = /^(last night,?\s*|this morning,?\s*)?(i\s+(had\s+a\s+dream|dreamt|dreamed|dream)\s*(that|about|of)?\s*)?((i|we)\s+(was|were|am|are)\s+|there\s+(was|were)\s+)?/i;
const TRAILING = new Set(['the', 'a', 'an', 'of', 'and', 'but', 'with', 'to', 'in', 'on', 'at', 'through', 'into', 'from', 'my', 'that', 'was', 'were', 'for', 'by',
  'under', 'over', 'above', 'below', 'near', 'behind', 'beside', 'around', 'about', 'like', 'as', 'while', 'who', 'which', 'where', 'huge', 'big', 'very']);

/** A short title from the first sentence, e.g. "Flying over a city made of glass". */
export function suggestTitle(text) {
  const first = String(text || '').trim().replace(/\s+/g, ' ').split(/[.!?\n]/)[0] ?? '';
  let words = first.replace(LEAD_IN, '').split(/,|;|\s(?:and|but|when|then|until|because)\s/i)[0].trim().split(' ').filter(Boolean);
  if (words.length < 3) words = first.split(' ').filter(Boolean);
  words = words.slice(0, 7);
  while (words.length > 2 && TRAILING.has(words[words.length - 1].toLowerCase())) words.pop();
  const title = words.join(' ').replace(/[^\p{L}\p{N}'\s-]/gu, '').trim();
  return title ? title[0].toUpperCase() + title.slice(1) : 'Untitled dream';
}
