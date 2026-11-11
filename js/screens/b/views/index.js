// The new layout's extra Journal views, chosen by the owner's team (2026-11-11) from the six that were on test.
// They sit in the Journal's view switcher after List · Calendar · Gallery, in this order.
// (Sky moved to the Insights tab: js/screens/b/sky.js. Spiral and Year were dropped; they are in git history.)
// Each module: { id, label, icon, render(el, { dreams, all, filtering, navigate }), destroy?() }.
//   dreams    the Journal's current dreams (search and filters applied), newest first
//   all       every dream, newest first
//   filtering true while a search or filter narrows the list
//   navigate  ctx.navigate(hash), e.g. navigate('#dream/<id>')
import moons from './moons.js';
import stories from './stories.js';
import milkyway from './milkyway.js';

export const EXTRA_VIEWS = [moons, stories, milkyway];
