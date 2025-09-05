/* Pre-cache total usando files.json gerado no deploy */
const CACHE = 'mochicard-all-v1';

self.addEventListener('install', (evt) => {
  self.skipWaiting();
  evt.waitUntil((async () => {
    try {
      const cache = await caches.open(CACHE);
      const res = await fetch('./files.json', { cache: 'no-cache' });
      const files = await res.json();               // ["index.html","src/blocks.js",...]
      const urls  = files.map(f => `./${f}`);       // garante caminho relativo à pasta
      await cache.addAll(urls);
    } catch (e) {
      // Evita falha total de instalação se algum arquivo falhar
      console.error('SW install error:', e);
    }
  })());
});

self.addEventListener('activate', (evt) => {
  evt.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(k => (k === CACHE ? null : caches.delete(k))));
    self.clients.claim();
  })());
});

self.addEventListener('fetch', (evt) => {
  const req = evt.request;
  const url = new URL(req.url);

  // Só GET do mesmo domínio
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;

  evt.respondWith((async () => {
    try {
      const net = await fetch(req);
      // opcional: atualiza cache em background
      caches.open(CACHE).then(c => c.put(req, net.clone()));
      return net;
    } catch {
      const cache = await caches.open(CACHE);
      const hit = await cache.match(req, { ignoreSearch: true });
      if (hit) return hit;

      // Fallback pra SPA
      const wantsHTML = req.mode === 'navigate' || (req.headers.get('accept')||'').includes('text/html');
      if (wantsHTML) {
        const index = await cache.match('./index.html', { ignoreSearch: true });
        if (index) return index;
      }
      return Response.error();
    }
  })());
});
