/**
 * Session helpers. The server is the source of truth for identity and permissions;
 * the cached profile below only avoids an extra round-trip when moving between pages.
 */
import { api, getToken, setToken, clearToken, clearApiCache } from './api.js';

const ME_KEY = 'oc.me';
const ME_TTL_MS = 5 * 60 * 1000;
const SAFE_NEXT = /^(index|dashboard|reports|employee|admin)\.html(#[A-Za-z0-9/_-]*)?$/;

export function hasToken() { return !!getToken(); }

export async function login(username, password) {
  const data = await api('login', { username, password }, { retries: 0 });
  setToken(data.token);
  forgetSession();
  return data;
}

export async function logout() {
  try { if (getToken()) await api('logout', {}, { retries: 0 }); } catch (e) { /* token may already be invalid */ }
  clearToken();
  forgetSession();
  location.href = 'login.html';
}

export function forgetSession() {
  try { sessionStorage.removeItem(ME_KEY); } catch (e) { /* ignore */ }
  clearApiCache();
}

/** Returns the `me` payload ({user, settings, today, departments, enums}) or null if signed out. */
export async function loadSession(force) {
  if (!getToken()) return null;
  if (!force) {
    try {
      const cached = JSON.parse(sessionStorage.getItem(ME_KEY) || 'null');
      if (cached && Date.now() - cached.at < ME_TTL_MS) return cached.data;
    } catch (e) { /* ignore */ }
  }
  const data = await api('me');
  try { sessionStorage.setItem(ME_KEY, JSON.stringify({ at: Date.now(), data })); } catch (e) { /* ignore */ }
  return data;
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
