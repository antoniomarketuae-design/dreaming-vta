// Service worker: network-first, so a new version shows up as soon as the phone is online,
// with the last good copy of every file kept so the app still opens offline.
const CACHE = 'dreaming-vta';
const SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'version.json',
  'css/app.css',
  'js/app.js',
  'js/ui.js',
  'js/screens/home.js',
  'js/screens/about.js',
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
