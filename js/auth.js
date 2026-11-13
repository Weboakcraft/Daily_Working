/**
 * Session helpers. The server is the source of truth for identity and permissions;
 * the cached profile below only avoids an extra round-trip when moving between pages.
 */
import { api, ApiError, getToken, setToken, clearToken, clearApiCache, clearStoredCache } from './api.js';

const ME_KEY = 'oc.me';
/* Remembered landing page, so index.html can redirect without first asking the server who you are. */
const HOME_KEY = 'oc.home';
/* Served straight from cache for this long, then refreshed quietly in the background. */
const ME_TTL_MS = 20 * 60 * 1000;
const ME_MAX_AGE_MS = 8 * 60 * 60 * 1000;
const SAFE_NEXT = /^(index|dashboard|reports|employee|admin)\.html(#[A-Za-z0-9/_-]*)?$/;

export function hasToken() { return !!getToken(); }

/** The page this person landed on last time, if it is still a page we would send them to. */
export function homeHint() {
  try {
    const v = localStorage.getItem(HOME_KEY) || '';
    return v === 'login.html#change' || SAFE_NEXT.test(v) ? v : '';
  } catch (e) { return ''; }
}
function setHomeHint(user) {
  try { localStorage.setItem(HOME_KEY, user && user.mustChangePassword ? 'login.html#change' : homeFor(user)); } catch (e) { /* private mode */ }
}
function clearHomeHint() { try { localStorage.removeItem(HOME_KEY); } catch (e) { /* ignore */ } }

export async function login(username, password) {
  const data = await api('login', { username, password }, { retries: 0 });
  setToken(data.token);
  clearStoredCache();
  forgetSession();
  setHomeHint(data.user);
  // A current backend answers sign-in with the whole session (settings, departments, enums), so
  // the page we land on does not have to make a second round-trip to ask who you are.
  if (data.session && data.session.user) writeCachedMe(data.session);
  return data;
}

export async function logout() {
  try { if (getToken()) await api('logout', {}, { retries: 0 }); } catch (e) { /* token may already be invalid */ }
  clearToken();
  clearStoredCache();
  clearHomeHint();
  forgetSession();
  location.href = 'login.html';
}

export function forgetSession() {
  try { sessionStorage.removeItem(ME_KEY); } catch (e) { /* ignore */ }
  clearApiCache();
}

/**
 * Reads the answer prefetch.js started before the app finished loading, if there is one.
 * Resolves to the session data, or throws the server's error (so an expired session is known at
 * once instead of being asked about a second time), or resolves to null if the prefetch failed.
 */
function takePrefetchedMe() {
  const pending = window.__ocMePrefetch;
  if (!pending) return null;
  window.__ocMePrefetch = null;
  return pending.then((body) => {
    if (body && body.ok === true) return body.data;
    if (body && body.ok === false && body.error && body.error.code) {
      throw new ApiError(body.error.code, body.error.message || 'Something went wrong.', body.error);
    }
    return null;
  }).catch((e) => { if (e instanceof ApiError) throw e; return null; });
}

function readCachedMe() {
  try {
    const cached = JSON.parse(sessionStorage.getItem(ME_KEY) || 'null');
    return cached && typeof cached.at === 'number' ? cached : null;
  } catch (e) { return null; }
}
function writeCachedMe(data) {
  try { sessionStorage.setItem(ME_KEY, JSON.stringify({ at: Date.now(), data })); } catch (e) { /* ignore */ }
  if (data && data.user) setHomeHint(data.user);
}

async function fetchMe() {
  const prefetched = takePrefetchedMe();
  let data = null;
  try {
    data = prefetched ? await prefetched : null;
  } catch (e) {
    if (e instanceof ApiError && (e.code === 'UNAUTHORIZED' || e.code === 'PASSWORD_CHANGE_REQUIRED')) { sessionEnded(e); throw e; }
  }
  try {
    if (!data) data = await api('me');
  } catch (e) {
    if (e instanceof ApiError && e.code === 'UNAUTHORIZED') sessionEnded(e);
    throw e;
  }
  writeCachedMe(data);
  return data;
}

/**
 * The server has said this token is dead. Forget it right away, so the sign-in page (and the
 * prefetch on every page after it) does not spend another round-trip asking about it.
 */
export function sessionEnded(e) {
  if (e && e.code === 'PASSWORD_CHANGE_REQUIRED') return;
  clearToken();
  clearStoredCache();
  clearHomeHint();
  forgetSession();
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
