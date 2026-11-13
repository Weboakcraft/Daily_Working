/**
 * API client for the Apps Script backend.
 * - One POST endpoint; body is JSON sent as text/plain so the browser skips a CORS preflight.
 * - Write calls carry a requestId; retries reuse it, so a flaky network can never create duplicates.
 * - The session token is kept in localStorage (it is a login token, not application data).
 */
import { CONFIG } from './config.js';

const TOKEN_KEY = 'oc.token';
const RETRYABLE = new Set(['NETWORK', 'TIMEOUT', 'BUSY', 'IN_PROGRESS', 'RATE_LIMITED']);

export class ApiError extends Error {
  constructor(code, message, extra) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.fieldErrors = (extra && extra.fieldErrors) || null;
    this.taskErrors = (extra && extra.taskErrors) || null;
    this.errorId = (extra && extra.errorId) || '';
    this.details = (extra && extra.details) || '';
  }
  get isNetwork() { return this.code === 'NETWORK' || this.code === 'TIMEOUT'; }
}

export function isConfigured() {
  const url = String(CONFIG.APPS_SCRIPT_URL || '');
  return /^https:\/\/script\.google(usercontent)?\.com\//.test(url) || url.startsWith('/') || /^https?:\/\/(localhost|127\.0\.0\.1)/.test(url);
}

export function getToken() { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; } }
export function setToken(t) { try { localStorage.setItem(TOKEN_KEY, t); } catch (e) { /* private mode */ } }
export function clearToken() { try { localStorage.removeItem(TOKEN_KEY); } catch (e) { /* ignore */ } }

export function newRequestId() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function once(action, payload, requestId) {
  if (navigator.onLine === false) throw new ApiError('NETWORK', 'You appear to be offline.');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), CONFIG.REQUEST_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(CONFIG.APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action, token: getToken() || undefined, payload: payload || {}, requestId,
        meta: { ua: navigator.userAgent.slice(0, 160), app: CONFIG.APP_VERSION }
      }),
      signal: ctrl.signal,
      redirect: 'follow',
      credentials: 'omit'
    });
  } catch (err) {
    if (err && err.name === 'AbortError') throw new ApiError('TIMEOUT', 'The server took too long to respond.');
    throw new ApiError('NETWORK', 'Could not reach the server. Check your internet connection.');
  } finally {
    clearTimeout(timer);
  }
  let body;
  try { body = await res.json(); } catch (e) {
    throw new ApiError('BAD_RESPONSE', 'The server sent an unexpected response. Check the Web App URL and that access is set to "Anyone".');
  }
  if (!body || body.ok !== true) {
    const e = (body && body.error) || {};
    throw new ApiError(e.code || 'SERVER_ERROR', e.message || 'Something went wrong.', e);
  }
  return body.data;
}

/**
 * Calls an API action.
 * @param {string} action
 * @param {object} payload
 * @param {{write?: boolean, requestId?: string, retries?: number}} opts
 */
export async function api(action, payload, opts) {
  opts = opts || {};
  const requestId = opts.write ? (opts.requestId || newRequestId()) : undefined;
  const retries = opts.retries !== undefined ? opts.retries : (opts.write ? 3 : 2);
  for (let attempt = 0; ; attempt++) {
    try {
      return await once(action, payload, requestId);
    } catch (e) {
      const retryable = e instanceof ApiError && RETRYABLE.has(e.code) && !(e.code === 'NETWORK' && navigator.onLine === false);
      if (!retryable || attempt >= retries) {
        if (e instanceof ApiError && (e.code === 'UNAUTHORIZED' || e.code === 'PASSWORD_CHANGE_REQUIRED')) {
          window.dispatchEvent(new CustomEvent('oc:auth', { detail: { code: e.code, message: e.message } }));
        }
        throw e;
      }
      await sleep(Math.min(8000, 700 * Math.pow(2, attempt)) + Math.random() * 300);
    }
  }
}

/**
 * Runs several read-only calls in ONE round-trip to Apps Script.
 *
 * Each call to the Web App is a separate script execution that pays the same start-up cost, and
 * the deployment allows only a limited number of executions at the same time for everyone put
 * together. A page that needs three answers therefore asks for all three in one request; the
 * server runs them in turn, sharing its per-execution caches, and returns one answer per call.
 * If the deployed backend is older and does not know the `batch` action, the calls are simply
 * made in parallel as before, so a frontend update never has to wait for a backend update.
 *
 * @param {Array<{action:string, payload?:object}>} calls
 * @returns {Promise<any[]>} one data value per call, in order (rejects with the first error)
 */
let batchSupported = true;
export async function apiBatch(calls) {
  if (!calls.length) return [];
  if (calls.length === 1) return [await api(calls[0].action, calls[0].payload)];
  if (batchSupported) {
    try {
      const results = await api('batch', { calls: calls.map((c) => ({ action: c.action, payload: c.payload || {} })) });
      if (Array.isArray(results) && results.length === calls.length) {
        return results.map((r) => {
          if (r && r.ok === true) return r.data;
          const e = (r && r.error) || {};
          throw new ApiError(e.code || 'SERVER_ERROR', e.message || 'Something went wrong.', e);
        });
      }
    } catch (e) {
      if (!(e instanceof ApiError && e.code === 'NOT_FOUND')) throw e;
      batchSupported = false; // older backend: fall through to parallel calls
    }
  }
  return Promise.all(calls.map((c) => api(c.action, c.payload)));
}

/**
 * Reference data (departments, the employee directory) changes rarely but was costing a full
 * round-trip on every page — and one round-trip to Apps Script is well over a second. So it is
 * cached twice: in memory for the current page view, and in localStorage across page views.
 * A stored copy is served straight away and refreshed in the background, so screens open at once
 * and still pick up yesterday's new joiner.
 */
const memo = new Map();
const STORE_PREFIX = 'oc.c.';
const STORE_TTL_MS = 6 * 60 * 60 * 1000;

function storeGet(key) {
  try {
    const raw = localStorage.getItem(STORE_PREFIX + key);
    if (!raw) return null;
    const o = JSON.parse(raw);
    return o && typeof o.at === 'number' ? o : null;
  } catch (e) { return null; }
}
/*
 * This origin's localStorage is shared with other internal apps, and an answer can be tens of
 * kilobytes, so the cache keeps itself small: expired entries go, and if the browser still refuses
 * the write, every cached answer is dropped and the write tried once more. Nothing here is the
 * only copy of anything — the server is.
 */
const STORE_MAX_ENTRY = 200000;
function storePrune(all) {
  try {
    const now = Date.now();
    Object.keys(localStorage).filter((k) => k.indexOf(STORE_PREFIX) === 0).forEach((k) => {
      if (all) { localStorage.removeItem(k); return; }
      const o = storeGet(k.slice(STORE_PREFIX.length));
      if (!o || now - o.at >= STORE_TTL_MS) localStorage.removeItem(k);
    });
  } catch (e) { /* ignore */ }
}
function storeSet(key, data) {
  let raw;
  try { raw = JSON.stringify({ at: Date.now(), data }); } catch (e) { return; }
  if (raw.length > STORE_MAX_ENTRY) return;
  try { localStorage.setItem(STORE_PREFIX + key, raw); } catch (e) {
    storePrune(true);
    try { localStorage.setItem(STORE_PREFIX + key, raw); } catch (e2) { /* private mode or no room at all */ }
  }
}
// Tidy expired answers once per page load, off the critical path.
setTimeout(() => storePrune(false), 4000);

/** Drops everything cached across page views. Called when the signed-in person changes. */
export function clearStoredCache() {
  try {
    Object.keys(localStorage).filter((k) => k.indexOf(STORE_PREFIX) === 0).forEach((k) => localStorage.removeItem(k));
  } catch (e) { /* ignore */ }
}

export async function cachedApi(action, payload, ttlMs) {
  const key = action + ':' + JSON.stringify(payload || {});
  const hit = memo.get(key);
  const stored = storeGet(key);
  if (hit && Date.now() - hit.at < (ttlMs || 60000)) {
    if (hit.done) return hit.data;
    // A background refresh is still travelling: the copy already on this device is good enough,
    // so do not make this screen wait a full round-trip for it.
    if (stored && Date.now() - stored.at < STORE_TTL_MS) return stored.data;
    return hit.promise;
  }

  const request = () => {
    const entry = { at: Date.now(), done: false, data: null, promise: null };
    entry.promise = api(action, payload)
      .then((data) => { storeSet(key, data); entry.done = true; entry.data = data; return data; })
      .catch((e) => { if (memo.get(key) === entry) memo.delete(key); throw e; });
    memo.set(key, entry);
    return entry.promise;
  };

  if (stored && Date.now() - stored.at < STORE_TTL_MS) {
    request().catch(() => { /* the stored copy is already on screen */ });
    return stored.data;
  }
  return request();
}
export function clearApiCache() { memo.clear(); }

/**
 * In-memory only (never localStorage): for answers that must be current, such as the state of
 * today's report form, but that can be fetched a moment early. The home screen warms this up in
 * the background, so opening the form a few seconds later shows it at once instead of after a
 * round-trip. Anything older than `ttlMs` is fetched again.
 */
export function memoApi(action, payload, ttlMs) {
  const key = action + ':' + JSON.stringify(payload || {});
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < (ttlMs || 60000)) return hit.promise;
  const promise = api(action, payload).catch((e) => { memo.delete(key); throw e; });
  memo.set(key, { at: Date.now(), promise });
  return promise;
}
export function forgetMemo(action, payload) { memo.delete(action + ':' + JSON.stringify(payload || {})); }

/**
 * Shows what was on screen last time, immediately, then replaces it when the server answers.
 *
 * The heavy dashboard queries take several seconds against Sheets, and staring at a skeleton for
 * that long on every visit is the main reason the app felt slow. The figures from the last visit
 * are almost always still right, so they go up at once and `onFresh` quietly corrects them.
 *
 * @param {string} action
 * @param {object} payload
 * @param {(data:any)=>void} onFresh called only when stored data was shown first
 * @param {Promise<any>} [inFlight] a request already started elsewhere, to avoid asking twice
 * @returns {Promise<{data:any, stale:boolean}>}
 */
export async function staleThenFresh(action, payload, onFresh, inFlight, onError) {
  const key = action + ':' + JSON.stringify(payload || {});
  const pending = (inFlight || api(action, payload)).then((data) => { storeSet(key, data); return data; });
  const stored = storeGet(key);
  if (stored && Date.now() - stored.at < STORE_TTL_MS) {
    pending.then((fresh) => { try { onFresh(fresh); } catch (e) { /* view moved on */ } })
      .catch((e) => { if (onError) { try { onError(e); } catch (x) { /* ignore */ } } /* the stored copy stays on screen */ });
    return { data: stored.data, stale: true };
  }
  return { data: await pending, stale: false };
}

/**
 * The usual shape of a list or analytics screen: paint what was on screen last time at once,
 * mark the container as refreshing, and repaint when the server answers.
 *
 * `draw(data)` must itself check that the view is still current. The container shows a thin
 * progress line while it carries last time's figures (see [aria-busy] in style.css).
 *
 * @param {string} action
 * @param {object} payload
 * @param {Element} container element that gets aria-busy while a stored copy is showing
 * @param {(data:any)=>void} draw
 * @param {Promise<any>} [inFlight] a request already started elsewhere
 */
export async function paintStaleThenFresh(action, payload, container, draw, inFlight, opts) {
  if (container) container.setAttribute('aria-busy', 'true');
  const clear = () => { if (container && container.isConnected) container.removeAttribute('aria-busy'); };
  if (opts && opts.fresh) {
    // Right after a change was saved, last time's copy would show the old state for a moment.
    const key = action + ':' + JSON.stringify(payload || {});
    const data = await (inFlight || api(action, payload));
    storeSet(key, data);
    clear();
    draw(data);
    return { data, stale: false };
  }
  const res = await staleThenFresh(action, payload, (fresh) => { clear(); draw(fresh); }, inFlight, () => { clear(); });
  if (!res.stale) clear();
  draw(res.data);
  return res;
}

/**
 * Starts a request before the screen is ready for it and hands the answer over when it is asked
 * for. `take` returns the in-flight promise only when the filters still match what was requested,
 * so a person who changes a dropdown while the page is loading gets fresh figures, not the primed
 * ones. Used so the data request and the filter-option requests travel at the same time.
 */
export function primeRequest(action, payload) {
  const key = JSON.stringify(payload || {});
  let pending = api(action, payload);
  pending.catch(() => { /* re-thrown to whoever takes it */ });
  return {
    take(current) {
      if (!pending || JSON.stringify(current || {}) !== key) return null;
      const p = pending;
      pending = null;
      return p;
    }
  };
}
