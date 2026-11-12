// New layout: the zodiac. Sun signs with their real date ranges ("seasons"), the twelve constellations as stick
// figures (from approximate real star positions, east to the left as on a sky map, normalised so the longer side is 1),
// the sign the Moon was in on a night (a low-precision lunar longitude, good to about half a degree: a night right at a
// sign change can be one sign off), and a layout that puts any number of dreams on a figure: on its stars first, then
// evenly along its lines. Used by the Journal's Zodiac look and the dream page. No DOM, no storage.

// U+FE0E asks for the text form of the symbol (iPhones otherwise draw these as coloured emoji tiles).
const T = '\uFE0E';

/** The twelve signs in order from Aries; start = [month, day] of the first day of its season. */
export const SIGNS = [
  { id: 'aries', name: 'Aries', glyph: `\u2648${T}`, start: [3, 21] },
  { id: 'taurus', name: 'Taurus', glyph: `\u2649${T}`, start: [4, 20] },
  { id: 'gemini', name: 'Gemini', glyph: `\u264A${T}`, start: [5, 21] },
  { id: 'cancer', name: 'Cancer', glyph: `\u264B${T}`, start: [6, 21] },
  { id: 'leo', name: 'Leo', glyph: `\u264C${T}`, start: [7, 23] },
  { id: 'virgo', name: 'Virgo', glyph: `\u264D${T}`, start: [8, 23] },
  { id: 'libra', name: 'Libra', glyph: `\u264E${T}`, start: [9, 23] },
  { id: 'scorpio', name: 'Scorpio', glyph: `\u264F${T}`, start: [10, 23] },
  { id: 'sagittarius', name: 'Sagittarius', glyph: `\u2650${T}`, start: [11, 22] },
  { id: 'capricorn', name: 'Capricorn', glyph: `\u2651${T}`, start: [12, 22] },
  { id: 'aquarius', name: 'Aquarius', glyph: `\u2652${T}`, start: [1, 20] },
  { id: 'pisces', name: 'Pisces', glyph: `\u2653${T}`, start: [2, 19] },
];
const BY_ID = new Map(SIGNS.map((s) => [s.id, s]));
export const signById = (id) => BY_ID.get(id) || null;

/** Stick figures: w × h box (longer side 1); stars [x, y, magnitude] (smaller magnitude = brighter); lines [i, j]. */
export const FIGURES = {
  aries: { w: 1, h: 0.614, stars: [[0,0,3.6],[0.758,0.292,2],[0.981,0.499,2.6],[1,0.614,3.9]], lines: [[0,1],[1,2],[2,3]] },
  taurus: { w: 1, h: 0.621, stars: [[0.085,0,1.7],[0,0.238,3],[0.465,0.383,0.9],[0.52,0.298,3.5],[0.519,0.402,3.4],[0.562,0.352,3.8],[0.586,0.412,3.6],[0.73,0.51,3.4],[1,0.621,3.6],[0.829,0.143,2.9]], lines: [[0,3],[3,5],[5,6],[6,4],[4,2],[2,1],[6,7],[7,8]] },
  gemini: { w: 1, h: 0.749, stars: [[0.118,0,1.6],[0,0.188,1.1],[0.378,0.082,4.4],[0.679,0.328,3],[0.912,0.454,2.9],[1,0.454,3.3],[0.01,0.362,3.6],[0.279,0.478,3.5],[0.456,0.546,3.8],[0.748,0.749,1.9],[0.301,0.744,3.6]], lines: [[0,1],[0,2],[2,3],[3,4],[4,5],[1,6],[6,7],[7,8],[8,9],[7,10],[2,7]] },
  cancer: { w: 0.51, h: 1, stars: [[0.143,0,4],[0.184,0.372,4.7],[0.167,0.541,3.9],[0,0.862,4.3],[0.51,1,3.5]], lines: [[0,1],[1,2],[2,3],[2,4]] },
  leo: { w: 1, h: 0.481, stars: [[1,0.076,3],[0.944,0,3.9],[0.75,0.089,3.4],[0.723,0.213,2],[0.826,0.316,3.5],[0.817,0.481,1.4],[0.284,0.189,2.6],[0.283,0.364,3.3],[0,0.392,2.1]], lines: [[0,1],[1,2],[2,3],[3,4],[4,5],[3,6],[6,8],[8,7],[7,5],[6,7]] },
  virgo: { w: 1, h: 0.515, stars: [[1,0.213,3.6],[0.831,0.272,3.9],[0.704,0.288,2.7],[0.624,0.176,3.4],[0.585,0,2.8],[0.452,0.515,1],[0.397,0.269,3.4],[0.157,0.394,4.1],[0,0.388,3.9]], lines: [[0,1],[1,2],[2,3],[3,4],[2,5],[3,6],[6,5],[6,7],[7,8]] },
  libra: { w: 0.548, h: 1, stars: [[0.249,0,2.6],[0.548,0.324,2.8],[0.037,0.265,3.9],[0.397,0.779,3.3],[0.02,0.917,3.6],[0,1,3.7]], lines: [[0,1],[0,2],[1,2],[1,3],[2,4],[4,5]] },
  scorpio: { w: 0.968, h: 1, stars: [[0.91,0,2.6],[0.955,0.12,2.3],[0.968,0.269,2.9],[0.769,0.248,2.9],[0.696,0.282,1],[0.638,0.359,2.8],[0.511,0.62,2.3],[0.496,0.778,3],[0.472,0.966,3.6],[0.315,1,3.3],[0.092,0.991,1.9],[0,0.868,3],[0.045,0.821,2.4],[0.125,0.739,1.6],[0.15,0.748,2.7]], lines: [[0,1],[1,2],[1,3],[3,4],[4,5],[5,6],[6,7],[7,8],[8,9],[9,10],[10,11],[11,12],[12,13],[13,14]] },
  sagittarius: { w: 1, h: 0.86, stars: [[0.637,0,2.8],[0.751,0.332,2.7],[1,0.377,3],[0.699,0.679,1.8],[0.347,0.121,3.2],[0.19,0.068,2],[0,0.173,3.3],[0.07,0.339,2.6],[0.807,0.86,3.1]], lines: [[2,1],[2,3],[1,3],[1,0],[0,4],[1,4],[4,5],[5,6],[6,7],[7,4],[7,3],[3,8]] },
  capricorn: { w: 1, h: 0.684, stars: [[1,0,3.6],[0.967,0.109,3.1],[0.685,0.608,4.1],[0.621,0.684,4.1],[0.228,0.47,3.7],[0,0.171,2.9],[0.078,0.2,3.7],[0.279,0.204,4.3],[0.462,0.223,4.1]], lines: [[0,1],[1,2],[2,3],[3,4],[4,5],[5,6],[6,7],[7,8],[8,1]] },
  aquarius: { w: 1, h: 0.544, stars: [[1,0.345,3.8],[0.654,0.221,2.9],[0.385,0.054,3],[0.26,0.089,3.8],[0.204,0.044,3.6],[0.152,0.047,4],[0.231,0,4.7],[0.298,0.291,4.2],[0.017,0.285,3.7],[0.04,0.475,4],[0,0.544,3.3]], lines: [[0,1],[1,2],[2,3],[3,4],[4,5],[4,6],[2,7],[7,8],[8,9],[9,10]] },
  pisces: { w: 1, h: 0.711, stars: [[1,0.661,3.7],[0.934,0.585,4.3],[0.862,0.605,4.1],[0.85,0.698,4.5],[0.941,0.711,4.9],[0.745,0.572,4],[0.445,0.555,4.4],[0.359,0.548,4.3],[0.125,0.607,4.4],[0,0.674,3.8],[0.101,0.516,4.3],[0.185,0.365,3.6],[0.293,0.136,4.7],[0.258,0.069,4.8],[0.305,0,4.5]], lines: [[0,1],[1,2],[2,3],[3,4],[4,0],[2,5],[5,6],[6,7],[7,8],[8,9],[9,10],[10,11],[11,12],[12,13],[13,14]] },
};

const pad = (n) => String(n).padStart(2, '0');
const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const parse = (day) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(day || ''));
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
};
const before = ([m1, d1], [m2, d2]) => m1 < m2 || (m1 === m2 && d1 < d2);

/** The sun sign of a day ('YYYY-MM-DD'), or null. */
export function sunSign(day) {
  const p = parse(day);
  if (!p) return null;
  const md = [p[1], p[2]];
  let hit = null;
  for (const s of SIGNS) if (!before(md, s.start) && (!hit || before(hit.start, s.start))) hit = s;
  return hit || BY_ID.get('capricorn'); // 1–19 January
}

/**
 * The sign season a day belongs to: { sign, key, from, to } with from / to as 'YYYY-MM-DD'.
 * Capricorn's season starts in December and runs into January: its key carries the December year.
 */
export function seasonOf(day) {
  const p = parse(day);
  const sign = sunSign(day);
  if (!p || !sign) return null;
  const year = sign.id === 'capricorn' && p[1] === 1 ? p[0] - 1 : p[0];
  const next = SIGNS[(SIGNS.indexOf(sign) + 1) % 12];
  const nextYear = sign.id === 'capricorn' ? year + 1 : year;
  const end = new Date(nextYear, next.start[0] - 1, next.start[1] - 1);
  return {
    sign,
    key: `${year}-${sign.id}`,
    from: iso(year, sign.start[0], sign.start[1]),
    to: iso(end.getFullYear(), end.getMonth() + 1, end.getDate()),
  };
}

const RAD = Math.PI / 180;
const norm360 = (a) => ((a % 360) + 360) % 360;

/** The Moon's ecliptic longitude in degrees at a moment (main periodic terms; about 0.5° accurate). */
export function moonLongitude(date) {
  const d = (date.getTime() - 946728000000) / 86400000; // days since 2000-01-01 12:00 UTC
  const L = 218.316 + 13.176396 * d;
  const M = (134.963 + 13.064993 * d) * RAD;
  const Ms = (357.529 + 0.98560028 * d) * RAD;
  const D = (297.850 + 12.190749 * d) * RAD;
  const F = (93.272 + 13.229350 * d) * RAD;
  return norm360(L + 6.289 * Math.sin(M) - 1.274 * Math.sin(M - 2 * D) + 0.658 * Math.sin(2 * D)
    - 0.214 * Math.sin(2 * M) - 0.186 * Math.sin(Ms) - 0.114 * Math.sin(2 * F));
}

/** The sign the Moon was in during the night before a dream's morning ('YYYY-MM-DD', 3 a.m. local time). */
export function moonSign(day) {
  const p = parse(day);
  if (!p) return null;
  return SIGNS[Math.floor(moonLongitude(new Date(p[0], p[1] - 1, p[2], 3)) / 30) % 12];
}

/**
 * Where n dreams go on a figure, as [x, y] in its own box, in path order (first = start of the figure's path).
 * Spread evenly by length along the lines (walked depth-first from star 0), each snapping to a real star when one is
 * near, then nudged apart until no two are closer than `minGap` (figure units) and kept inside the box plus `room`.
 * One dream sits on the brightest star.
 */
export function placeOnFigure(fig, n, { minGap = 0, room = 0.1 } = {}) {
  if (!fig || n < 1) return [];
  const S = fig.stars.length;
  const at = (i) => [fig.stars[i][0], fig.stars[i][1]];
  if (n === 1) {
    let best = 0;
    for (let i = 1; i < S; i += 1) if (fig.stars[i][2] < fig.stars[best][2]) best = i;
    return [at(best)];
  }
  // The walk: tree edges in depth-first order, then any edges closing a loop.
  const adj = Array.from({ length: S }, () => []);
  fig.lines.forEach(([u, v], e) => { adj[u].push([v, e]); adj[v].push([u, e]); });
  const seen = new Set([0]);
  const used = new Set();
  const walk = [];
  const visit = (i) => {
    for (const [j, e] of adj[i]) {
      if (seen.has(j)) continue;
      seen.add(j); used.add(e); walk.push([i, j]); visit(j);
    }
  };
  visit(0);
  fig.lines.forEach(([u, v], e) => { if (!used.has(e)) walk.push([u, v]); });
  const lens = walk.map(([u, v]) => Math.hypot(fig.stars[u][0] - fig.stars[v][0], fig.stars[u][1] - fig.stars[v][1]));
  const total = lens.reduce((t, l) => t + l, 0) || 1;
  const pointAt = (dist) => {
    let d = dist;
    for (let e = 0; e < walk.length; e += 1) {
      if (d <= lens[e] || e === walk.length - 1) {
        const f = lens[e] ? Math.min(1, d / lens[e]) : 0;
        const [u, v] = walk[e];
        return [fig.stars[u][0] + (fig.stars[v][0] - fig.stars[u][0]) * f, fig.stars[u][1] + (fig.stars[v][1] - fig.stars[u][1]) * f];
      }
      d -= lens[e];
    }
    return at(0);
  };
  const step = total / n;
  const taken = new Set();
  const pts = Array.from({ length: n }, (_, k) => {
    const p = pointAt(step * (k + 0.5));
    let best = -1;
    let bestD = step * 0.45;
    for (let i = 0; i < S; i += 1) {
      if (taken.has(i)) continue;
      const d = Math.hypot(fig.stars[i][0] - p[0], fig.stars[i][1] - p[1]);
      if (d < bestD) { bestD = d; best = i; }
    }
    if (best >= 0) { taken.add(best); return at(best); }
    return p;
  });
  if (minGap > 0) {
    const lo = [-room, -room];
    const hi = [fig.w + room, fig.h + room];
    for (let it = 0; it < 80; it += 1) {
      let moved = false;
      for (let i = 0; i < n; i += 1) {
        for (let j = i + 1; j < n; j += 1) {
          let dx = pts[j][0] - pts[i][0];
          let dy = pts[j][1] - pts[i][1];
          let d = Math.hypot(dx, dy);
          if (d >= minGap) continue;
          if (d < 1e-6) { const ang = (i * 2.4 + j) % (Math.PI * 2); dx = Math.cos(ang); dy = Math.sin(ang); d = 1; }
          const push = (minGap - Math.hypot(pts[j][0] - pts[i][0], pts[j][1] - pts[i][1])) / 2 + 1e-4;
          pts[i][0] -= (dx / d) * push; pts[i][1] -= (dy / d) * push;
          pts[j][0] += (dx / d) * push; pts[j][1] += (dy / d) * push;
          moved = true;
        }
      }
      for (const p of pts) { p[0] = Math.min(hi[0], Math.max(lo[0], p[0])); p[1] = Math.min(hi[1], Math.max(lo[1], p[1])); }
      if (!moved) break;
    }
  }
  return pts;
}
