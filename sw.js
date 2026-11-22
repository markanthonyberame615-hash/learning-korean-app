/* Service worker: downloads the whole app into Cache Storage once, then serves it with no internet.
   When you change index.html, bump VERSION so installed phones fetch the new copy.

   MANDATORY UPDATES: as soon as a newer version is detected (online, whether the app is open or not),
   the old version is locked, its downloaded files are deleted, and only an "Update" screen is shown
   (online or offline) until the phone has downloaded the newest version. */
const VERSION = 'v18';
const PREFIX = 'korean-grammar-offline-';
const CACHE = PREFIX + VERSION;
const META = 'korean-grammar-meta';          // tiny store that remembers "an update is required" (survives restarts)
const LOCK_KEY = './__update-required';
const REQUIRED = './index.html';            // the app itself: if this fails, the download fails
const OPTIONAL = ['./manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png',
  './icons/icon-maskable-512.png', './icons/apple-touch-icon.png'];   // nice to have: never block the download

async function broadcast(msg) {
  const cs = await self.clients.matchAll({ includeUncontrolled: true });
  cs.forEach(c => c.postMessage(msg));
}

/* ---------- update lock ---------- */
async function setLock(newVersion) {
  const m = await caches.open(META);
  await m.put(LOCK_KEY, new Response(String(newVersion)));
}
async function lockValue() {
  try { const r = await (await caches.open(META)).match(LOCK_KEY); return r ? await r.text() : null; } catch (e) { return null; }
}
/* locked = a newer version than this worker's own has been detected */
async function isLocked() {
  const v = await lockValue();
  return v !== null && v !== VERSION;
}
async function purgeOthers(keep) {
  for (const k of await caches.keys())
    if (k.startsWith(PREFIX) && k !== keep) { try { await caches.delete(k); } catch (e) {} }
}
/* Reads VERSION from the server's sw.js (always from the network, never from any cache). null = offline / unreadable. */
async function fetchRemoteVersion(ms) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), ms);
  try {
    const res = await fetch('./sw.js?chk=' + Date.now(), { cache: 'no-store', signal: ctl.signal });
    if (!res.ok) return null;
    const m = /const\s+VERSION\s*=\s*['"]([^'"]+)['"]/.exec(await res.text());
    return m ? m[1] : null;
  } catch (e) { return null; } finally { clearTimeout(t); }
}
/* A newer version exists: lock this one, delete its downloaded files, tell open pages, and start fetching the new copy. */
async function lockDown(newVersion) {
  await setLock(newVersion);
  await purgeOthers(PREFIX + newVersion);
  broadcast({ type: 'UPDATE_REQUIRED', version: newVersion });
  self.registration.update().catch(() => {});
}
/* Used by every trigger (page open, back online, background sync). Resolves true when the app is locked. */
async function checkAndEnforce() {
  if (await isLocked()) { broadcast({ type: 'UPDATE_REQUIRED', version: await lockValue() }); return true; }
  const v = await fetchRemoteVersion(8000);
  if (v && v !== VERSION) { await lockDown(v); return true; }
  if (v) self.registration.update().catch(() => {});
  return false;
}

function blockedPage(newVersion) {
  const v = String(newVersion || '').replace(/[^\w.\-]/g, '');
  const html = '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1"><title>Update required</title><style>' +
    'html,body{margin:0;height:100%}body{display:flex;align-items:center;justify-content:center;padding:20px;box-sizing:border-box;background:#ffd600;color:#0b3d91;font-family:system-ui,Roboto,sans-serif;text-align:center}' +
    '.c{max-width:420px}.ko{font-size:34px;font-weight:800;margin-bottom:6px}h1{font-size:22px;line-height:1.3;margin:10px 0}' +
    'p{font-size:15px;line-height:1.45;color:#222;margin:8px 0}button{margin-top:14px;border:0;border-radius:14px;padding:14px 28px;background:#0b3d91;color:#fff;font:700 17px system-ui,sans-serif}' +
    'button:disabled{opacity:.6}#m{min-height:2.6em;font-weight:600;color:#0b3d91}</style></head><body><div class="c">' +
    '<div class="ko">\uD55C\uAD6D\uC5B4 \uBC30\uC6B0\uAE30</div>' +
    '<h1>This Version was Outdated, Please Update to the Latest Version to Continue Using the Web-App! Thank You</h1>' +
    (v ? '<p>Newest version: ' + v + '</p>' : '') +
    '<p>The old version is no longer available. Connect to the internet, then tap the button below.</p>' +
    '<button id="b" type="button">Update Now</button><p style="font-size:13px;font-style:italic;color:#0b3d91">&mdash; Mark Anthony B. Berame</p><p id="m" aria-live="polite"></p></div><script>' +
    'var b=document.getElementById("b"),m=document.getElementById("m");' +
    'navigator.serviceWorker.addEventListener("controllerchange",function(){location.reload()});' +
    'function waitW(r){return new Promise(function(ok,no){if(r.waiting)return ok(r.waiting);var w=r.installing;' +
    'if(!w)return no(new Error("Could not find the newest version. Please try again."));' +
    'w.addEventListener("statechange",function(){if(w.state==="installed")ok(r.waiting||w);else if(w.state==="redundant")no(new Error("Download failed. Check your connection and try again."))})})}' +
    'b.onclick=async function(){b.disabled=true;try{if(!navigator.onLine)throw new Error("You are offline. Connect to the internet, then tap Update Now.");' +
    'm.textContent="Downloading the newest version... please keep this screen open.";' +
    'var r=await navigator.serviceWorker.getRegistration();if(!r)throw new Error("Please reopen the app and try again.");' +
    'if(!r.waiting)await r.update();var w=await waitW(r);w.postMessage("SKIP_WAITING");m.textContent="Installing...";' +
    'setTimeout(function(){location.reload()},8000)}catch(e){m.textContent=e.message||"Update failed. Try again.";b.disabled=false}};' +
    'window.addEventListener("online",function(){m.textContent="You are back online. Tap Update Now."});' +
    '</script></body></html>';
  return new Response(html, { status: 200, headers: { 'content-type': 'text/html;charset=utf-8', 'cache-control': 'no-store' } });
}

/* ---------- download ---------- */
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
  e.waitUntil((async () => {
    try {
      await precache();
      /* The newest copy is fully downloaded: lock the older version and delete its files right now,
         so the older version can no longer be used (online or offline) while it waits to be replaced. */
      await setLock(VERSION);
      await purgeOthers(CACHE);
    } catch (err) {
      broadcast({ type: 'DL_FAILED', reason: String(err && err.message || err) });
      /* First install: carry on anyway (pages are cached as they are opened, and the page can ask for a retry).
         Update: fail, so the update is retried and the app stays locked (or, if never locked, the older copy stays usable). */
      const hadOld = (await caches.keys()).some(k => k.startsWith(PREFIX) && k !== CACHE);
      const wasLocked = (await lockValue()) !== null;
      if (hadOld || wasLocked) throw err;
    }
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    await purgeOthers(CACHE);
    await setLock(VERSION);          // this worker IS the newest version: unlock
    await self.clients.claim();
  })());
});

self.addEventListener('message', e => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
  if (e.data === 'CHECK_UPDATE') e.waitUntil(checkAndEnforce());
  if (e.data === 'DOWNLOAD') e.waitUntil((async () => {
    if (await isLocked()) return broadcast({ type: 'UPDATE_REQUIRED', version: await lockValue() });
    try { await precache(); } catch (err) { broadcast({ type: 'DL_FAILED', reason: String(err && err.message || err) }); }
  })());
  if (e.data === 'CHECK_CACHE') e.waitUntil((async () => {
    if (await isLocked()) return broadcast({ type: 'UPDATE_REQUIRED', version: await lockValue() });
    const r = await (await caches.open(CACHE)).match('./index.html');
    broadcast(r ? { type: 'DL_DONE', version: VERSION, quiet: true } : { type: 'DL_MISSING' });
  })());
});

/* Background checks while the app is closed (browser permitting): when the phone regains internet, and about twice a day. */
self.addEventListener('sync', e => { if (e.tag === 'kg-check-update') e.waitUntil(checkAndEnforce()); });
self.addEventListener('periodicsync', e => { if (e.tag === 'kg-check-update') e.waitUntil(checkAndEnforce()); });

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith((async () => {
    let locked = await isLocked();
    /* Every time the app is opened with internet: look for a newer version BEFORE showing the old one. */
    if (!locked && req.mode === 'navigate') {
      const v = await fetchRemoteVersion(3000);
      if (v && v !== VERSION) { await lockDown(v); locked = true; }
    }
    if (locked) {
      if (req.mode === 'navigate') return blockedPage(await lockValue());
      return new Response('Update required', { status: 503, statusText: 'Update required' });
    }
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    if (req.mode === 'navigate') {
      const shell = await cache.match('./index.html');
      if (shell) return shell;
    }
    try {
      const res = await fetch(req);
      if (res.ok && !(await isLocked())) cache.put(req, res.clone());
      return res;
    } catch (err) {
      return new Response('Offline', { status: 503, statusText: 'Offline' });
    }
  })());
});
