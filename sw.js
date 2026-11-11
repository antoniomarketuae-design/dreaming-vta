// Service worker: network-first, so a new version shows up as soon as the phone is online,
// with the last good copy of every file kept so the app still opens offline.
const CACHE = 'dreaming-vta';
const SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'version.json',
  'css/app.css',
  'css/home.css',
  'css/record.css',
  'css/dream.css',
  'css/journal.css',
  'css/insights.css',
  'css/profile.css',
  'css/lucidity.css',
  'css/onboarding.css',
  'css/celebrate.css',
  'css/technique.css',
  'css/article.css',
  'css/goals.css',
  'css/module.css',
  'css/plus.css',
  'css/lock.css',
  'js/progress.js',
  'js/account.js',
  'js/paywall.js',
  'js/images.js',
  'js/videos.js',
  'js/videopicker.js',
  'js/layout.js',
  'js/symbols.js',
  'js/screens/b/home.js',
  'js/screens/b/insights.js',
  'js/screens/b/me.js',
  'js/screens/b/calendar.js',
  'js/screens/b/wheel.js',
  'js/screens/b/views/index.js',
  'css/bv-sky.css',
  'js/screens/b/sky.js',
  'css/bv-moons.css',
  'js/screens/b/views/moons.js',
  'css/bv-stories.css',
  'js/screens/b/views/stories.js',
  'css/bv-milkyway.css',
  'js/screens/b/views/milkyway.js',
  'css/b-home.css',
  'css/b-insights.css',
  'css/b-me.css',
  'css/b-calendar.css',
  'css/video.css',
  'css/paywall.css',
  'js/audio.js',
  'js/content/techniques.js',
  'js/content/articles.js',
  'js/screens/lucidity.js',
  'js/screens/onboarding.js',
  'js/screens/celebrate.js',
  'js/screens/technique.js',
  'js/screens/article.js',
  'js/screens/goals.js',
  'js/screens/module.js',
  'js/screens/plus.js',
  'js/screens/lock.js',
  'js/app.js',
  'js/ui.js',
  'js/store.js',
  'js/analyze.js',
  'js/dreamart.js',
  'js/interpret.js',
  'js/screens/home.js',
  'js/screens/journal.js',
  'js/screens/insights.js',
  'js/screens/profile.js',
  'js/screens/record.js',
  'js/screens/dream.js',
  'icons/icon-180.png',
  'icons/icon-192.png',
  'images/home-bg.webp',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => Promise.allSettled(SHELL.map((url) => cache.add(url))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

  // no-cache: always ask the server whether the file changed (hosts like GitHub Pages cache for 10 minutes).
  event.respondWith(
    fetch(req, { cache: 'no-cache' })
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true })
        .then((hit) => hit || (req.mode === 'navigate' ? caches.match('index.html') : Response.error())))
  );
});
