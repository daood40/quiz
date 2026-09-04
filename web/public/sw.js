/* App-shell service worker: offline play for the static demo.
   - navigations: network first, fall back to cached shell
   - hashed assets: cache first (immutable by content hash)
   - never caches API calls */
const VERSION = 'quiz-shell-__BUILD__';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon.svg'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)));
});
// the page asks a waiting worker to take over after the user accepts the update prompt
self.addEventListener('message', (e) => { if (e.data === 'SKIP_WAITING') self.skipWaiting(); });
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.includes('/api/')) return;

  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          // only a healthy same-origin shell may replace the cached one (never a 5xx / captive portal page)
          if (res.ok && res.type === 'basic') caches.open(VERSION).then((c) => c.put('./index.html', res.clone()));
          return res;
        })
        .catch(async () => (await caches.match('./index.html')) ?? Response.error()),
    );
    return;
  }
  if (url.pathname.includes('/assets/')) {
    e.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => { if (res.ok) caches.open(VERSION).then((c) => c.put(req, res.clone())); return res; })),
    );
    return;
  }
  e.respondWith(caches.match(req).then((hit) => hit || fetch(req)));
});
