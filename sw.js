/* Service worker: downloads the whole app into Cache Storage once, then serves it with no internet.
   When you change index.html, bump VERSION so installed phones fetch the new copy. */
const VERSION = 'v7';
const CACHE = 'korean-grammar-offline-' + VERSION;
const REQUIRED = './index.html';            // the app itself: if this fails, the download fails
const OPTIONAL = ['./manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png',
  './icons/icon-maskable-512.png', './icons/apple-touch-icon.png'];   // nice to have: never block the download

async function broadcast(msg) {
  const cs = await self.clients.matchAll({ includeUncontrolled: true });
  cs.forEach(c => c.postMessage(msg));
}

async function fetchWithProgress(url, onBytes) {
  const res = await fetch(url, { cache: 'reload' });
  if (!res.ok) throw new Error(url + ' returned ' + res.status);
  const type = res.headers.get('content-type') || '';
  const len = +res.headers.get('content-length') || 0;
  if (!res.body) { const blob = await res.blob(); onBytes(blob.size, len); return { blob, type }; }
  const reader = res.body.getReader(), chunks = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value); onBytes(value.length, len);
  }
  return { blob: new Blob(chunks), type };
}

async function precache() {
  const cache = await caches.open(CACHE);
  let got = 0, total = 0, last = 0;
  const onBytes = (n, len) => {
    got += n;
    const pct = Math.min(99, Math.round(got / (total || got * 1.2 + 1) * 100));
    if (pct !== last) { last = pct; broadcast({ type: 'DL_PROGRESS', pct }); }
  };
  // Required file, with up to 3 tries (flaky mobile data is common)
  let lastErr, main;
  for (let i = 0; i < 3 && !main; i++) {
    try {
      try { const h = await fetch(REQUIRED, { method: 'HEAD', cache: 'no-store' }); total = +h.headers.get('content-length') || 0; } catch (e) {}
      got = 0;
      main = await fetchWithProgress(REQUIRED, onBytes);
    } catch (e) { lastErr = e; await new Promise(r => setTimeout(r, 1500)); }
  }
  if (!main) throw lastErr || new Error('download failed');
  const mk = o => new Response(o.blob, { status: 200, headers: { 'content-type': o.type } });
  await cache.put('./index.html', mk(main));
  await cache.put('./', mk(main));
  for (const u of OPTIONAL) {
    try { const o = await fetchWithProgress(u, () => {}); await cache.put(u, mk(o)); } catch (e) {}
  }
  broadcast({ type: 'DL_DONE', version: VERSION, bytes: main.blob.size });
}

self.addEventListener('install', e => {
  e.waitUntil(precache().catch(err => { broadcast({ type: 'DL_FAILED', reason: String(err && err.message || err) }); throw err; }));
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys())
      if (k.startsWith('korean-grammar-offline-') && k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('message', e => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
  if (e.data === 'CHECK_CACHE') {
    caches.open(CACHE).then(c => c.match('./index.html')).then(r => broadcast(r ? { type: 'DL_DONE', version: VERSION, quiet: true } : { type: 'DL_MISSING' }));
  }
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    if (req.mode === 'navigate') {
      const shell = await cache.match('./index.html');
      if (shell) return shell;
    }
    try {
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone());
      return res;
    } catch (err) {
      return new Response('Offline', { status: 503, statusText: 'Offline' });
    }
  })());
});
