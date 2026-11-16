// Service worker: deixa o app abrir mesmo sem internet e cuida das atualizações.
// O app roda sempre a partir do cache da versão atual (tudo da mesma versão, nunca misturado).
// Ao publicar uma versão nova, troque o número em VERSION: o celular baixa a versão nova inteira
// em segundo plano e o app mostra o aviso "Nova atualização" (js/update.js).
// Sem trocar VERSION, os celulares continuam na versão antiga.

const VERSION = 'v6';
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
  './js/ficha.js',
  './js/gallery.js',
  './js/install.js',
  './js/layout.js',
  './js/geo.js',
  './js/geocode.js',
  './js/location.js',
  './js/nav.js',
  './js/photos.js',
  './js/stamp.js',
  './js/update.js',
  './js/util.js',
  './js/zoom.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
];

// Baixa a versão nova inteira direto do servidor (sem pegar arquivo velho do cache do navegador).
// Ela fica esperando até a pessoa tocar em "Atualizar" (ou até o app ser aberto do zero).
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' })))));
});

self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
  if (e.data && e.data.type === 'GET_VERSION' && e.ports[0]) e.ports[0].postMessage(VERSION);
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
    if (cached) return cached;
    try {
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone());
      return res;
    } catch {
      if (req.mode === 'navigate') {
        const page = await cache.match('./index.html');
        if (page) return page;
      }
      return Response.error();
    }
  })());
});
