import { icons } from '../ui.js';

export default {
  id: 'home',
  label: 'Home',
  icon: icons.home,

  // Empty on purpose: a clean canvas over the background picture, ready for the first feature.
  render(el) {
    el.innerHTML = '';
  },
};
