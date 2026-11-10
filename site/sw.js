/* BankScope AI service worker: lets the installed app open and work offline.
   BUILD_ID is replaced with the commit SHA by the Publish workflow, so each deploy gets a
   fresh cache and old ones are deleted.

   Strategy
   - Page and data (index.html, data/*.json): network first, saved copy when offline, so the
     app always shows the newest build when it can reach GitHub Pages.
   - Code, styles, icons and fonts: cached copy first, refreshed in the background.
   - On install, the page, the manifest and every bank file are saved, so all banks can be
     opened offline after the first visit. */
'use strict';
const BUILD_ID = '__BUILD_ID__';
const CACHE = `bankscope-${BUILD_ID}`;
const SHELL = ['./', './manifest.webmanifest', './favicon.svg', './icon-192.png', './data/manifest.json'];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(SHELL);
    try {
      const res = await cache.match('./data/manifest.json');
      const manifest = await res.json();
      const files = (manifest.banks || []).map((b) => `./data/bank_${Number(b.cert)}.json`);
      // Individual failures (for example a missing file) must not block installation.
      await Promise.allSettled(files.map((f) => cache.add(f)));
    } catch { /* offline data is a convenience; the app still works online */ }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('bankscope-') && k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const fresh = await fetch(request);
    if (fresh.ok) cache.put(request, fresh.clone());
    return fresh;
  } catch {
    const saved = await cache.match(request, { ignoreSearch: request.mode === 'navigate' });
    if (saved) return saved;
    if (request.mode === 'navigate') {
      const shell = await cache.match('./');
      if (shell) return shell;
    }
    return new Response(JSON.stringify({ error: 'offline' }), { status: 503, headers: { 'Content-Type': 'application/json' } });
  }
}

async function staleWhileRevalidate(event) {
  const cache = await caches.open(CACHE);
  const saved = await cache.match(event.request);
  const refresh = fetch(event.request).then((res) => {
    if (res.ok || res.type === 'opaque') cache.put(event.request, res.clone());
    return res;
  }).catch(() => saved);
  if (saved) { event.waitUntil(refresh); return saved; }
  return refresh;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  const sameOrigin = url.origin === self.location.origin;
  const isFont = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  if (!sameOrigin && !isFont) return; // e.g. FDIC links: let the browser handle them
  if (request.mode === 'navigate' || (sameOrigin && url.pathname.includes('/data/'))) {
    event.respondWith(networkFirst(request));
  } else {
    event.respondWith(staleWhileRevalidate(event));
  }
});
