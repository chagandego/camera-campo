// Service worker: deixa o app abrir mesmo sem internet.
// Estratégia: responde com o que está em cache e atualiza o cache em segundo plano.
// Ao publicar uma versão nova, troque o número em VERSION.

const VERSION = 'v2';
const CACHE = `app-campo-${VERSION}`;
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/app.js',
  './js/camera.js',
  './js/config.js',
  './js/db.js',
  './js/exif.js',
  './js/gallery.js',
  './js/install.js',
  './js/geo.js',
  './js/geocode.js',
  './js/location.js',
  './js/nav.js',
  './js/photos.js',
  './js/stamp.js',
  './js/util.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return; // APIs de endereço: sempre pela rede

  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(req, { ignoreSearch: true });
    const network = fetch(req)
      .then((res) => {
        if (res.ok) cache.put(req, res.clone());
        return res;
      })
      .catch(() => cached || (req.mode === 'navigate' ? cache.match('./index.html') : Response.error()));
    if (cached) {
      e.waitUntil(network.catch(() => {}));
      return cached;
    }
    return network;
  })());
});
