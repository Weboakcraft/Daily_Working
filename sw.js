/**
 * Offline cache for the tracker's own files.
 *
 * Nothing here touches the Apps Script backend — those requests always go to the network, so the
 * data you see is never stale. This only stops the browser re-downloading the app itself.
 *
 * Why a precache rather than a per-request race: the old version gave each file 2.5 seconds to
 * arrive and fell back to the cache when it did not. On a phone on mobile data that timeout is hit
 * by some files and not others, so a page could end up running yesterday's report-form.js against
 * today's app.js — which is how one person gets a blank screen while the person beside them is fine.
 * Now the whole app is written into one versioned cache in a single step and served from it, so a
 * page always runs one consistent set of files.
 *
 * Updates: the version below comes from js/config.js (APP_VERSION). After each start the worker
 * re-reads that file from the network; if the version moved, it downloads the new app in the
 * background and swaps the whole set at once. Nobody has to remember to edit this file.
 */
const PREFIX = 'oakcraft-app-';
const MARKER = '__version__';

/* The app shell: everything needed to open any page without the network. */
const SHELL = [
  './',
  'index.html', 'login.html', 'employee.html', 'reports.html', 'dashboard.html', 'admin.html',
  'css/style.css', 'css/dashboard.css', 'css/responsive.css',
  'js/config.js', 'js/prefetch.js', 'js/api.js', 'js/auth.js', 'js/app.js', 'js/charts.js',
  'js/login.js', 'js/report-form.js', 'js/report-form-tasks.js', 'js/question-controls.js',
  'js/analytics.js', 'js/dashboard.js', 'js/reports.js', 'js/employees.js', 'js/questions.js',
  'js/admin.js', 'js/export.js', 'js/whatsapp.js',
  'assets/favicon.png', 'assets/oakcraft-logo.png', 'assets/oakcraft-logo-light.png',
  'assets/fonts/IBMPlexSans-Regular-Latin1.woff2',
  'assets/fonts/IBMPlexSans-Medium-Latin1.woff2',
  'assets/fonts/IBMPlexSans-SemiBold-Latin1.woff2'
];

const cacheName = (v) => PREFIX + v;

/** Reads APP_VERSION straight from js/config.js, bypassing the HTTP cache. */
async function liveVersion() {
  const res = await fetch(new Request('js/config.js', { cache: 'reload' }));
  if (!res || !res.ok) throw new Error('config unavailable');
  const m = /APP_VERSION\s*:\s*['"]([^'"]+)['"]/.exec(await res.text());
  if (!m) throw new Error('no APP_VERSION');
  return m[1];
}

/** Downloads the whole shell into a fresh cache. One file failing does not sink the rest. */
async function precache(version) {
  const cache = await caches.open(cacheName(version));
  await Promise.all(SHELL.map(async (path) => {
    try {
      const res = await fetch(new Request(path, { cache: 'reload' }));
      if (res && res.ok) await cache.put(path, res);
    } catch (e) { /* offline or missing: the network path still works */ }
  }));
  await cache.put(MARKER, new Response(version));
  return cache;
}

async function dropOtherCaches(keep) {
  const keys = await caches.keys();
  await Promise.all(keys.filter((k) => k.indexOf(PREFIX) === 0 && k !== keep).map((k) => caches.delete(k)));
  // The pre-1.1 cache used a different name.
  await Promise.all(keys.filter((k) => k.indexOf('oakcraft-tracker-') === 0).map((k) => caches.delete(k)));
}

/** Current cache, if one is complete. */
async function activeCache() {
  const keys = (await caches.keys()).filter((k) => k.indexOf(PREFIX) === 0);
  for (const k of keys) {
    const cache = await caches.open(k);
    if (await cache.match(MARKER)) return { key: k, cache: cache, version: k.slice(PREFIX.length) };
  }
  return null;
}

/** Once per worker start: if the deployed version moved, fetch the new app and swap it in whole. */
let checking = null;
function checkForUpdate() {
  if (checking) return checking;
  checking = (async () => {
    try {
      const version = await liveVersion();
      const current = await activeCache();
      if (current && current.version === version) return;
      await precache(version);
      await dropOtherCaches(cacheName(version));
    } catch (e) { /* offline: keep serving what we have */ }
  })().finally(() => { checking = null; });
  return checking;
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    try { await precache(await liveVersion()); } catch (e) { /* offline install: fetch handler falls back to network */ }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const current = await activeCache();
    if (current) await dropOtherCaches(current.key);
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'check-for-update') event.waitUntil(checkForUpdate());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (url.origin !== self.location.origin) return; // the backend is never cached

  event.respondWith((async () => {
    const current = await activeCache();
    if (current) {
      const hit = await current.cache.match(req, { ignoreSearch: true });
      if (hit) {
        // Serve instantly, then see once whether a new version has been deployed.
        event.waitUntil(checkForUpdate());
        return hit;
      }
    }
    try {
      const res = await fetch(req);
      if (res && res.ok && res.type === 'basic' && current) {
        current.cache.put(req, res.clone()).catch(() => { /* best effort */ });
      }
      return res;
    } catch (e) {
      const fallback = current && await current.cache.match('index.html');
      if (req.mode === 'navigate' && fallback) return fallback;
      return new Response('You appear to be offline.', { status: 503, headers: { 'Content-Type': 'text/plain' } });
    }
  })());
});
