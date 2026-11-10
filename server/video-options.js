// Video lengths, qualities, credit costs and time estimates, all read from plans.json "videos".
// The app gets the same numbers from GET /plans (publicVideoOptions) and mirrors these few rules in js/videos.js.
// A "dream film" (plans.json videos.films) is a longer video made of 2–3 clips, one per scene of the dream, made
// at the same time and joined into one mp4: Seedance makes at most 15 seconds per clip.

/** Words in a dream's text. */
export const wordCount = (text) => (String(text || '').trim().match(/\S+/g) || []).length;

/** Longest video (seconds) a dream of `words` words may have: longer dreams unlock longer videos and films. */
export function maxSeconds(cfg, words) {
  let max = cfg.durations?.[0] || 5;
  for (const step of cfg.lengthByWords || []) if (words >= step.words) max = step.max;
  return max;
}

/** The film of that length ({ seconds, clips: [10, 10] }), or null for a single-clip video. */
export const filmFor = (cfg, seconds) => (cfg.films || []).find((f) => f.seconds === seconds) || null;

/** May a video be this long? (one of the single lengths or one of the films) */
export const isLength = (cfg, seconds) => (cfg.durations || [5]).includes(seconds) || Boolean(filmFor(cfg, seconds));

/** The clip lengths a video of `seconds` is made of: [seconds] for a single video, one per scene for a film. */
export const clipsFor = (cfg, seconds) => filmFor(cfg, seconds)?.clips || [seconds];

/** Video credits a video takes (0 = unknown quality). 1 credit = 1 second at the cheapest quality.
 *  A film costs what its clips cost together. */
export function videoCost(cfg, seconds, quality) {
  const q = (cfg.qualities || []).find((x) => x.id === quality);
  return q ? clipsFor(cfg, seconds).reduce((sum, s) => sum + Math.ceil(s * q.perSecond), 0) : 0;
}

/** Usual time to make a video, in minutes (measured on poyo Seedance 2.0). A film's clips are made at the same
 *  time, so it takes as long as its slowest clip (only the first one starts from the photo) plus the joining. */
export function estimateMinutes(cfg, seconds, quality, fromImage) {
  const perSecond = cfg.minutesPerSecond?.[quality] ?? 1;
  const clips = clipsFor(cfg, seconds);
  const slowest = Math.max(...clips.map((s, i) => s * perSecond * (fromImage && i === 0 ? cfg.photoFactor ?? 2.5 : 1)));
  return slowest + (clips.length > 1 ? cfg.filmJoinMinutes ?? 1 : 0);
}

/** What the app needs to show the length / quality picker (no provider details). */
export function publicVideoOptions(cfg = {}) {
  return {
    durations: cfg.durations || [5],
    lengthByWords: cfg.lengthByWords || [],
    films: (cfg.films || []).map(({ seconds, clips }) => ({ seconds, clips })),
    qualities: (cfg.qualities || []).map(({ id, label, note, perSecond }) => ({ id, label, note, perSecond })),
    defaultQuality: cfg.defaultQuality || '720p',
    minutesPerSecond: cfg.minutesPerSecond || {},
    photoFactor: cfg.photoFactor ?? 2.5,
    filmJoinMinutes: cfg.filmJoinMinutes ?? 1,
  };
}
