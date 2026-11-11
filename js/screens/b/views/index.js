// The six Journal views on test in the new layout (while the owner decides which to keep). They are not in the
// List · Calendar · Gallery switcher: the Journal shows "Test 6 new journal views", which opens a sheet with these,
// in this order, with VIEW_NOTES as their one-line descriptions. Each module: { id, label, icon, render(el, { dreams, all, filtering, navigate }), destroy?() }.
//   dreams    the Journal's current dreams (search and filters applied), newest first
//   all       every dream, newest first
//   filtering true while a search or filter narrows the list
//   navigate  ctx.navigate(hash), e.g. navigate('#dream/<id>')
import sky from './sky.js';
import spiral from './spiral.js';
import year from './year.js';
import moons from './moons.js';
import stories from './stories.js';
import river from './river.js';

export const EXTRA_VIEWS = [sky, spiral, year, moons, stories, river];

export const VIEW_NOTES = {
  sky: 'Dreams as stars; shared symbols form constellations.',
  spiral: 'Today in the centre, older dreams spiralling out.',
  year: '12 months like a zodiac, then each month as a wheel.',
  moons: 'Each night with its real moon phase.',
  stories: 'Swipe through big dream pictures.',
  river: 'A ribbon coloured by how each dream felt.',
};
