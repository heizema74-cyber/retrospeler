// Travelly service worker: de app werkt ook zonder internet (met wat al eerder geladen is).
const VERSION = 'travelly-v6';
const SHELL = [
  './', 'index.html', 'css/app.css', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png',
  'vendor/leaflet.js', 'vendor/leaflet.css',
  'js/app.js', 'js/api.js', 'js/store.js', 'js/guide.js', 'js/planner.js', 'js/map.js', 'js/icons.js',
  'js/data/leiden.js', 'js/data/leiden-photos.js',
];
const RUNTIME = 'travelly-runtime';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== RUNTIME).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

// Foto's, kaarttegels en lettertypes: eerst uit de cache, anders ophalen en bewaren.
const CACHE_FIRST = /(thumb\.wikimedia\.org|upload\.wikimedia\.org|tile\.openstreetmap\.org|fonts\.(googleapis|gstatic)\.com)/;

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    // eigen bestanden: netwerk eerst (altijd de nieuwste versie), anders cache
    e.respondWith(fetch(req).then((res) => {
      const copy = res.clone();
      caches.open(VERSION).then((c) => c.put(req, copy));
      return res;
    }).catch(() => caches.match(req).then((r) => r || caches.match('index.html'))));
    return;
  }
  if (CACHE_FIRST.test(url.host)) {
    e.respondWith(caches.open(RUNTIME).then(async (c) => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok || res.type === 'opaque') c.put(req, res.clone());
      return res;
    }));
  }
});
