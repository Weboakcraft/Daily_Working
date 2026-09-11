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
function storeSet(key, data) {
  try { localStorage.setItem(STORE_PREFIX + key, JSON.stringify({ at: Date.now(), data })); } catch (e) { /* quota or private mode */ }
}

/** Drops everything cached across page views. Called when the signed-in person changes. */
export function clearStoredCache() {
  try {
    Object.keys(localStorage).filter((k) => k.indexOf(STORE_PREFIX) === 0).forEach((k) => localStorage.removeItem(k));
  } catch (e) { /* ignore */ }
}

export async function cachedApi(action, payload, ttlMs) {
  const key = action + ':' + JSON.stringify(payload || {});
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < (ttlMs || 60000)) return hit.promise;

  const request = () => {
    const promise = api(action, payload)
      .then((data) => { storeSet(key, data); return data; })
      .catch((e) => { memo.delete(key); throw e; });
    memo.set(key, { at: Date.now(), promise });
    return promise;
  };

  const stored = storeGet(key);
  if (stored && Date.now() - stored.at < STORE_TTL_MS) {
    request().catch(() => { /* the stored copy is already on screen */ });
    return stored.data;
  }
  return request();
}
export function clearApiCache() { memo.clear(); }
