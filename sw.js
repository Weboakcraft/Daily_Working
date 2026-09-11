/**
 * Offline-first cache for the tracker's own files (pages, styles, scripts, fonts, logo).
 *
 * Nothing here touches the Apps Script backend — those requests go straight to the network as
 * always, so the data you see is never stale. This only stops the browser re-downloading the app
 * itself on every navigation, which was costing about a second each time on a phone connection.
 *
 * Strategy: answer from the cache at once, fetch a fresh copy in the background, use it next time.
 */
const CACHE = 'oakcraft-tracker-v1';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (url.origin !== self.location.origin) return; // the backend is never cached

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(req);
    const network = fetch(req)
      .then((res) => {
        if (res && res.status === 200 && res.type === 'basic') cache.put(req, res.clone());
        return res;
      })
      .catch(() => null);

    if (cached) {
      event.waitUntil(network);
      return cached;
    }
    const fresh = await network;
    return fresh || new Response('You appear to be offline.', { status: 503, headers: { 'Content-Type': 'text/plain' } });
  })());
});
