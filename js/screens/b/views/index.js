// The extra Journal views of the new layout, in the order the view switcher shows them (after List, Calendar,
// Gallery). Each module: { id, label, icon, render(el, { dreams, all, filtering, navigate }), destroy?() }.
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
