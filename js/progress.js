// Progress engine: everything in Dreaming that unlocks as dreams are logged, plus levels.
// Screens read from here so thresholds live in one place. No DOM or storage access at import time.
import { listDreams, collection } from './store.js';

/** Lucid-dreaming techniques, unlocked by total dreams logged. Content lives in js/content/techniques.js. */
export const TECHNIQUES = [
  { id: 'reality-checks', name: 'Reality checks', section: 'techniques', unlockAt: 0 },
  { id: 'wild', name: 'Wake-induced (WILD)', section: 'falling-asleep', unlockAt: 1 },
  { id: 'audio-cues', name: 'Audio cues', section: 'techniques', unlockAt: 2 },
  { id: 'mild', name: 'Mnemonic induction (MILD)', section: 'falling-asleep', unlockAt: 3 },
  { id: 'wbtb', name: 'Wake back to bed', section: 'techniques', unlockAt: 5 },
  { id: 'ssild', name: 'Senses-initiated (SSILD)', section: 'falling-asleep', unlockAt: 7 },
  { id: 'finger', name: 'Finger-induced (FILD)', section: 'falling-asleep', unlockAt: 10 },
  { id: 'anchor', name: 'Anchor technique', section: 'techniques', unlockAt: 13 },
  { id: 'counting', name: 'Counting technique', section: 'techniques', unlockAt: 16 },
  { id: 'conditioning', name: 'Sound conditioning', section: 'night-training', unlockAt: 20 },
];

/** Analysis modules on the Progress tab. */
export const MODULES = [
  { id: 'statistics', name: 'Statistics', unlockAt: 5 },
  { id: 'trends', name: 'Trends', unlockAt: 10 },
  { id: 'nightmares', name: 'Nightmares', unlockAt: 15 },
  { id: 'correlations', name: 'Correlations', unlockAt: 20 },
  { id: 'symbols-map', name: 'Symbols map', unlockAt: 25 },
];

/** Home "Explore" cards: a past dream unlocks by dreams logged, a symbol card by distinct symbols collected. */
export const EXPLORE = {
  dream: { unlockAt: 5, by: 'dreams' },
  symbol: { unlockAt: 10, by: 'symbols' },
};

/** Levels by total dreams logged (our own names). */
export const LEVELS = [
  { level: 1, name: 'Novice', min: 0 },
  { level: 2, name: 'Dreamer', min: 3 },
  { level: 3, name: 'Explorer', min: 7 },
  { level: 4, name: 'Navigator', min: 15 },
  { level: 5, name: 'Voyager', min: 30 },
  { level: 6, name: 'Oneironaut', min: 50 },
  { level: 7, name: 'Dream sage', min: 100 },
];

export const dreamCount = () => listDreams().length;

/** { level, name, min, nextMin|null, nextName|null, progress 0–1 toward the next level } */
export function levelFor(count = dreamCount()) {
  let i = 0;
  while (i + 1 < LEVELS.length && count >= LEVELS[i + 1].min) i += 1;
  const cur = LEVELS[i];
  const next = LEVELS[i + 1] || null;
  return {
    ...cur,
    nextMin: next?.min ?? null,
    nextName: next?.name ?? null,
    progress: next ? (count - cur.min) / (next.min - cur.min) : 1,
  };
}

/**
 * Unlock state for a list (TECHNIQUES or MODULES):
 * each item gets unlocked (bool), toGo (dreams still needed), isNext (only the first locked item: show "N to go" + bar),
 * progress 0–1 for the next item (measured from the previous threshold).
 */
export function unlockState(list, count = dreamCount()) {
  const sorted = [...list].sort((a, b) => a.unlockAt - b.unlockAt);
  const nextItem = sorted.find((x) => count < x.unlockAt) || null;
  const prevAt = nextItem ? Math.max(0, ...sorted.filter((x) => x.unlockAt <= count).map((x) => x.unlockAt)) : 0;
  return list.map((x) => {
    const unlocked = count >= x.unlockAt;
    const isNext = nextItem?.id === x.id;
    return {
      ...x,
      unlocked,
      toGo: Math.max(0, x.unlockAt - count),
      isNext,
      progress: unlocked ? 1 : isNext ? (count - prevAt) / Math.max(1, x.unlockAt - prevAt) : 0,
    };
  });
}

export function nextTechnique(count = dreamCount()) {
  return unlockState(TECHNIQUES, count).find((t) => t.isNext) || null;
}

export function exploreState(count = dreamCount(), symbols = collection().symbols) {
  return {
    dream: { ...EXPLORE.dream, unlocked: count >= EXPLORE.dream.unlockAt, toGo: Math.max(0, EXPLORE.dream.unlockAt - count) },
    symbol: { ...EXPLORE.symbol, unlocked: symbols >= EXPLORE.symbol.unlockAt, toGo: Math.max(0, EXPLORE.symbol.unlockAt - symbols) },
  };
}

/** What a save just unlocked: compares the state before (count-1) and after (count). Used by the celebration. */
export function unlockedBy(count = dreamCount()) {
  const before = count - 1;
  const crossed = (x) => before < x.unlockAt && count >= x.unlockAt;
  const lvBefore = levelFor(Math.max(0, before));
  const lvAfter = levelFor(count);
  return {
    techniques: TECHNIQUES.filter(crossed),
    modules: MODULES.filter(crossed),
    levelUp: lvAfter.level > lvBefore.level ? lvAfter : null,
    milestone: count === 1 ? 'first' : [5, 10, 25, 50, 100].includes(count) ? count : null,
  };
}
