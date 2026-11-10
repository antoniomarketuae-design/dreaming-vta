// Which app layout is shown. 'classic' is the current one (Home · Journal · Lucidity · Progress · Settings);
// 'new' follows the user's own structure (Home · Journal · Insights · Profile · Calendar, plus a day journal).
// Both use the same dreams, account and server, so the user can switch in Settings → App layout and compare.
// No storage access at import time.
import { getSetting, setSetting } from './store.js';

export const LAYOUTS = [
  { id: 'classic', label: 'Current layout', tabs: 'Home · Journal · Lucidity · Progress · Settings' },
  { id: 'new', label: 'New layout', tabs: 'Home · Journal · Insights · Profile · Calendar' },
];

export const getLayout = () => (getSetting('layout', 'classic') === 'new' ? 'new' : 'classic');
export const isNewLayout = () => getLayout() === 'new';

/** Switches layout; app.js listens for 'dreaming:layout' and redraws from Home. */
export function setLayout(id) {
  setSetting('layout', id === 'new' ? 'new' : 'classic');
  try { window.dispatchEvent(new CustomEvent('dreaming:layout')); } catch {}
}
