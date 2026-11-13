// Travel MYO helper: keeps the app itself (and its little pictures) available with no internet.
// Saved playlists' sound files are stored by the app page itself, not here.
const VERSION = 'v1.3';
const SHELL = 'tm-shell-' + VERSION;   // the app page, icon (replaced on every new version)
const IMAGES = 'tm-images';            // covers and little track pictures seen while online (kept)
const FILES = ['./', './index.html', './icon.png', './manifest.json'];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    // Add each file separately so one missing file can't stop the others being saved.
    await Promise.allSettled(FILES.map((f) => cache.add(new Request(f, { cache: 'reload' }))));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name.startsWith('tm-shell-') && name !== SHELL) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});

// No-data mode: the app page leaves a small marker here; while it exists, this helper never uses the internet.
async function noData() {
  try { return !!(await (await caches.open('tm-flags')).match(self.location.origin + '/__tm__nodata')); } catch (e) { return false; }
}

const wait = (ms) => new Promise((_, reject) => setTimeout(() => reject(new Error('slow')), ms));

// The app page: use the internet copy if it answers quickly (so updates arrive), otherwise the saved copy.
async function pagePlease(req) {
  const cache = await caches.open(SHELL);
  if (await noData()) {
    const saved = (await cache.match(req, { ignoreSearch: true })) || (await cache.match('./index.html')) || (await cache.match('./'));
    if (saved) return saved;
  }
  try {
    const res = await Promise.race([fetch(req), wait(4000)]);
    if (res && res.ok) {
      cache.put('./', res.clone());
      cache.put('./index.html', res.clone());
      return res;
    }
  } catch (e) { /* offline or slow: fall through to the saved copy */ }
  return (await cache.match(req, { ignoreSearch: true }))
    || (await cache.match('./index.html'))
    || (await cache.match('./'))
    || fetch(req);
}

// Other files from this site (icon, manifest): saved copy first, quietly refreshed.
async function filePlease(req, event) {
  const cache = await caches.open(SHELL);
  const hit = await cache.match(req, { ignoreSearch: true });
  if (hit && (await noData())) return hit;
  const refresh = fetch(req).then((res) => { if (res && res.ok) cache.put(req, res.clone()); return res; }).catch(() => null);
  if (hit) { event.waitUntil(refresh); return hit; }
  return (await refresh) || Response.error();
}

// Pictures from Yoto's servers: saved copy first. Tries a normal (readable) request, then a plain one.
async function pictureFetch(url) {
  try { return await fetch(url, { mode: 'cors', credentials: 'omit' }); }
  catch (e) { return fetch(url, { mode: 'no-cors', credentials: 'omit' }); }
}
async function picturePlease(req) {
  const cache = await caches.open(IMAGES);
  const hit = await cache.match(req.url);
  if (hit) return hit;
  if (await noData()) return Response.error();
  try {
    const res = await pictureFetch(req.url);
    if (res && (res.ok || res.type === 'opaque')) cache.put(req.url, res.clone());
    return res;
  } catch (e) {
    return Response.error();
  }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    if (req.mode === 'navigate') event.respondWith(pagePlease(req));
    else event.respondWith(filePlease(req, event));
  } else if (req.destination === 'image') {
    event.respondWith(picturePlease(req));
  }
  // Everything else (Yoto sign-in, the Yoto library, sound files) goes straight to the internet.
});
