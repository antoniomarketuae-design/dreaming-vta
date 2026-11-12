// The new layout's extra Journal views, after List, in the view switcher: Stories and Milky Way (the team's choice,
// 2026-11-12: "List, Stories and Milky Way are the three we need").
// (Sky moved to Insights, js/screens/b/sky.js; the Moons view became the moon card on Home and Insights,
// js/screens/b/moon.js; Gallery, Spiral and Year were dropped. Older versions are in git history.)
// Each module: { id, label, icon, render(el, { dreams, all, filtering, navigate }), destroy?() }.
//   dreams    the Journal's current dreams (search and filters applied), newest first
//   all       every dream, newest first
//   filtering true while a search or filter narrows the list
//   navigate  ctx.navigate(hash), e.g. navigate('#dream/<id>')
import stories from './stories.js';
import milkyway from './milkyway.js';

export const EXTRA_VIEWS = [stories, milkyway];
