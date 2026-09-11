/**
 * Starts the "who am I" request the moment the page begins loading.
 *
 * Every call to the Apps Script backend costs roughly a second and a half before any work happens,
 * so waiting for the whole app bundle to parse before asking was throwing that time away. This module
 * has one tiny dependency, so the browser runs it first and the request travels while the rest of the
 * app is still downloading. auth.js picks the answer up; if anything here fails it simply asks again.
 */
import { CONFIG } from './config.js';

const TOKEN_KEY = 'oc.token';

try {
  let token = '';
  try { token = localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { /* private mode */ }
  const url = String(CONFIG.APPS_SCRIPT_URL || '');
  if (token && /^https:\/\/script\.google(usercontent)?\.com\//.test(url)) {
    window.__ocMePrefetch = fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'me', token: token, payload: {},
        meta: { ua: navigator.userAgent.slice(0, 160), app: CONFIG.APP_VERSION }
      }),
      redirect: 'follow',
      credentials: 'omit'
    }).then((r) => r.json()).catch(() => null);
  }
} catch (e) { /* the app will fetch normally */ }
