/**
 * Offline cache for the tracker's own files.
 *
 * Nothing here touches the Apps Script backend — those requests always go to the network, so the
 * data you see is never stale. This only stops the browser re-downloading the app itself.
 *
 * Two strategies, on purpose:
 *  - Code (pages, scripts, styles): network first, with a short timeout, falling back to the cache.
 *    A cached copy would otherwise keep serving yesterday's app for a load or two after an update.
 *  - Assets that never change in place (fonts, images): straight from the cache, refreshed quietly.
 */
const CACHE = 'oakcraft-tracker-v2';
const NETWORK_TIMEOUT_MS = 2500;
const CODE = /\.(?:html|js|css)$|\/$/i;

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function save(cache, req, res) {
  if (res && res.status === 200 && res.type === 'basic') cache.put(req, res.clone());
  return res;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (url.origin !== self.location.origin) return; // the backend is never cached

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(req);
    const fromNetwork = fetch(req).then((res) => save(cache, req, res)).catch(() => null);

    if (CODE.test(url.pathname)) {
      // Give the network a moment; if it is slow or offline, show the cached copy.
      const timed = new Promise((resolve) => setTimeout(() => resolve(null), NETWORK_TIMEOUT_MS));
      const fresh = await Promise.race([fromNetwork, timed]);
      if (fresh) return fresh;
      if (cached) { event.waitUntil(fromNetwork); return cached; }
      const late = await fromNetwork;
      return late || new Response('You appear to be offline.', { status: 503, headers: { 'Content-Type': 'text/plain' } });
    }

    if (cached) { event.waitUntil(fromNetwork); return cached; }
    const fresh = await fromNetwork;
    return fresh || new Response('You appear to be offline.', { status: 503, headers: { 'Content-Type': 'text/plain' } });
  })());
});
