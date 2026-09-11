/**
 * Short-lived cache for the expensive read-only queries.
 *
 * The dashboard and analytics screens scan several months of rows in Sheets and take a few seconds
 * each time. The answer is the same for everyone looking at the same filters, so it is kept in
 * CacheService for a couple of minutes. Any write bumps a version stamp that is part of every key,
 * so a report submitted right now is visible on the very next load — nothing waits for a timeout.
 */
var OC_CACHE_SECONDS = 150;
var OC_CACHE_VERSION_SECONDS = 21600;

function ocCacheVersion_() {
  var cache = CacheService.getScriptCache();
  var v = null;
  try { v = cache.get('q:ver'); } catch (e) { v = null; }
  if (!v) {
    v = String(Date.now());
    try { cache.put('q:ver', v, OC_CACHE_VERSION_SECONDS); } catch (e) { /* ignore */ }
  }
  return v;
}

/** Called after every write so that cached answers built before it are never served again. */
function ocBumpCache_() {
  try { CacheService.getScriptCache().put('q:ver', String(Date.now()), OC_CACHE_VERSION_SECONDS); } catch (e) { /* ignore */ }
}

/**
 * @param {string} name   short label for the query
 * @param {object} p      the request payload (part of the key)
 * @param {object} user   the signed-in user (part of the key: people see different scopes)
 * @param {Function} fn   the original handler
 */
/** Small deterministic hash, so a long filter payload still fits a cache key. */
function ocHash_(str) {
  var h1 = 0x811c9dc5, h2 = 0x01000193;
  for (var i = 0; i < str.length; i++) {
    var c = str.charCodeAt(i);
    h1 = (h1 ^ c) * 16777619 >>> 0;
    h2 = (h2 + c * (i + 7)) >>> 0;
  }
  return h1.toString(36) + h2.toString(36);
}

function ocCached_(name, p, user, fn) {
  var cache, key;
  try {
    cache = CacheService.getScriptCache();
    var raw = name + '|' + ocCacheVersion_() + '|' + user.id + '|' + user.role + '|' + JSON.stringify(p || {});
    key = 'q:' + name + ':' + ocHash_(raw);
  } catch (e) {
    return fn(p, user);
  }
  var hit = null;
  try { hit = cache.get(key); } catch (e) { hit = null; }
  if (hit) {
    try { return JSON.parse(hit); } catch (e) { /* corrupt entry, fall through */ }
  }
  var data = fn(p, user);
  try {
    var body = JSON.stringify(data);
    if (body.length < 95000) cache.put(key, body, OC_CACHE_SECONDS);
  } catch (e) { /* too large, or cache unavailable */ }
  return data;
}
