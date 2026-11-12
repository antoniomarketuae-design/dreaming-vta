// Zodiac sign silhouettes for the Journal's Zodiac map (zodiacmap.js): { [signId]: { vb: [w, h], body, lines, text } }.
//   body  the creature's silhouette as one closed SVG path (filled and outlined by the app; Libra and Sagittarius
//         carry small holes as extra sub-paths drawn the other way round)
//   lines optional inner detail strokes
//   text  [x, y, w, h] the safe box inside the body for the day, weekday · month and title
// Original drawings in two sets: signshapes-a.js (ram, bull, twins, crab, lion, maiden) and signshapes-b.js (scales,
// scorpion, bow, sea-goat, water urn, two fish). A sign without a shape gets a rounded badge (zodiacmap.js).
import { SHAPES_A } from './signshapes-a.js';
import { SHAPES_B } from './signshapes-b.js';

export const SHAPES = { ...SHAPES_A, ...SHAPES_B };
