/**
 * Session helpers. The server is the source of truth for identity and permissions;
 * the cached profile below only avoids an extra round-trip when moving between pages.
 */
import { api, getToken, setToken, clearToken, clearApiCache, clearStoredCache } from './api.js';

const ME_KEY = 'oc.me';
/* Served straight from cache for this long, then refreshed quietly in the background. */
const ME_TTL_MS = 20 * 60 * 1000;
const ME_MAX_AGE_MS = 8 * 60 * 60 * 1000;
const SAFE_NEXT = /^(index|dashboard|reports|employee|admin)\.html(#[A-Za-z0-9/_-]*)?$/;

export function hasToken() { return !!getToken(); }

export async function login(username, password) {
  const data = await api('login', { username, password }, { retries: 0 });
  setToken(data.token);
  clearStoredCache();
  forgetSession();
  return data;
}

export async function logout() {
  try { if (getToken()) await api('logout', {}, { retries: 0 }); } catch (e) { /* token may already be invalid */ }
  clearToken();
  clearStoredCache();
  forgetSession();
  location.href = 'login.html';
}

export function forgetSession() {
  try { sessionStorage.removeItem(ME_KEY); } catch (e) { /* ignore */ }
  clearApiCache();
}

/** Reads the answer prefetch.js started before the app finished loading, if there is one. */
function takePrefetchedMe() {
  const pending = window.__ocMePrefetch;
  if (!pending) return null;
  window.__ocMePrefetch = null;
  return pending.then((body) => (body && body.ok === true ? body.data : null)).catch(() => null);
}

function readCachedMe() {
  try {
    const cached = JSON.parse(sessionStorage.getItem(ME_KEY) || 'null');
    return cached && typeof cached.at === 'number' ? cached : null;
  } catch (e) { return null; }
}
function writeCachedMe(data) {
  try { sessionStorage.setItem(ME_KEY, JSON.stringify({ at: Date.now(), data })); } catch (e) { /* ignore */ }
}

async function fetchMe() {
  const prefetched = takePrefetchedMe();
  const data = (prefetched && await prefetched) || await api('me');
  writeCachedMe(data);
  return data;
}

/** Returns the `me` payload ({user, settings, today, departments, enums}) or null if signed out. */
export async function loadSession(force) {
  if (!getToken()) return null;
  if (!force) {
    const cached = readCachedMe();
    if (cached) {
      const age = Date.now() - cached.at;
      if (age < ME_TTL_MS) return cached.data;
      if (age < ME_MAX_AGE_MS) {
        // Show the page now; bring it up to date behind the scenes.
        fetchMe().catch(() => { /* the next navigation will retry */ });
        return cached.data;
      }
    }
  }
  return fetchMe();
}

export function homeFor(user) {
  return user && user.role !== 'EMPLOYEE' ? 'dashboard.html#overview' : 'employee.html#home';
}

export function goLogin(reason) {
  const page = location.pathname.split('/').pop() || 'index.html';
  const next = page + location.hash;
  const q = new URLSearchParams();
  if (SAFE_NEXT.test(next) && page !== 'index.html') q.set('next', next);
  if (reason) q.set('reason', reason);
  location.href = 'login.html' + (q.toString() ? '?' + q.toString() : '');
}

export function safeNext(value, user) {
  return value && SAFE_NEXT.test(value) ? value : homeFor(user);
}
