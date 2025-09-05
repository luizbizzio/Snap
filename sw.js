/* Pre-cache total via files.json, tolerante a erros + alias "/" -> index.html */
const CACHE = 'mochicard-all-v2'; // mude quando fizer deploy grande

// util: limita concorrência para não estourar conexões/quotas
async function addAllSafe(cache, urls, batchSize = 25) {
  for (let i = 0; i < urls.length; i += batchSize) {
    const slice = urls.slice(i, i + batchSize);
    await Promise.allSettled(slice.map(async (u) => {
      try {
        const res = await fetch(u, { cache: 'no-cache' });
        if (res.ok) await cache.put(u, res.clone());
      } catch (_) { /* ignora falha individual */ }
    }));
  }
}

self.addEventListener('install', (evt) => {
  self.skipWaiting();
  evt.waitUntil((async () => {
    try {
      const cache = await caches.open(CACHE);
      const res = await fetch('./files.json', { cache: 'no-cache' });
      const files = await res.json();                 // ["index.html","src/..."]
      const urls  = files.map(f => `./${f}`);

      // pré-cache em lotes (tolerante a erro)
      await addAllSafe(cache, urls);

      // garante alias para navegação: "/" e "./" → index.html
      const index = await cache.match('./index.html', { ignoreSearch: true });
      if (index) {
        await cache.put(new Request('./'), index.clone());           // "./"
        await cache.put(new Request(self.registration.scope), index.clone()); // "/"
      }
    } catch (e) {
      // se der ruim, ainda assim ativa; o fetch handler cobre offline de navegação
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
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;

  const isHTML = req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html');

  // PÁGINAS: offline-first (evita "página não encontrada" sem rede)
  if (isHTML) {
    evt.respondWith((async () => {
      const cache = await caches.open(CACHE);

      // tenta a URL exata ("/", "/index.html", etc.)
      const hit = await cache.match(req, { ignoreSearch: true });
      if (hit) return hit;

      // cai para index.html
      const index = await cache.match('./index.html', { ignoreSearch: true });
      if (index) return index;

      // último recurso: rede
      try { return await fetch(req); } catch { return Response.error(); }
    })());
    return;
  }

  // ASSETS: network-first com atualização de cache; fallback ao cache
  evt.respondWith((async () => {
    try {
      const net = await fetch(req);
      caches.open(CACHE).then(c => c.put(req, net.clone()));
      return net;
    } catch {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(req, { ignoreSearch: true });
      if (cached) return cached;
      return Response.error();
    }
  })());
});
