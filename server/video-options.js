// Video lengths, qualities, credit costs and time estimates, all read from plans.json "videos".
// The app gets the same numbers from GET /plans (publicVideoOptions) and mirrors these few rules in js/videos.js.

/** Words in a dream's text. */
export const wordCount = (text) => (String(text || '').trim().match(/\S+/g) || []).length;

/** Longest video (seconds) a dream of `words` words may have: longer dreams unlock longer videos. */
export function maxSeconds(cfg, words) {
  let max = cfg.durations?.[0] || 5;
  for (const step of cfg.lengthByWords || []) if (words >= step.words) max = step.max;
  return max;
}

/** Video credits a video takes (0 = unknown quality). 1 credit = 1 second at the cheapest quality. */
export function videoCost(cfg, seconds, quality) {
  const q = (cfg.qualities || []).find((x) => x.id === quality);
  return q ? Math.ceil(seconds * q.perSecond) : 0;
}

/** Usual time to make a video, in minutes (measured on poyo Seedance 2.0). */
export function estimateMinutes(cfg, seconds, quality, fromImage) {
  const perSecond = cfg.minutesPerSecond?.[quality] ?? 1;
  return seconds * perSecond * (fromImage ? cfg.photoFactor ?? 2.5 : 1);
}

/** What the app needs to show the length / quality picker (no provider details). */
export function publicVideoOptions(cfg = {}) {
  return {
    durations: cfg.durations || [5],
    lengthByWords: cfg.lengthByWords || [],
    qualities: (cfg.qualities || []).map(({ id, label, note, perSecond }) => ({ id, label, note, perSecond })),
    defaultQuality: cfg.defaultQuality || '720p',
    minutesPerSecond: cfg.minutesPerSecond || {},
    photoFactor: cfg.photoFactor ?? 2.5,
  };
}
