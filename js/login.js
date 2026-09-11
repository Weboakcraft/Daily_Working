/** Sign-in and first-login password change. */
import { api, ApiError, isConfigured, getToken } from './api.js';
import { login, loadSession, safeNext, forgetSession, logout } from './auth.js';
import { html, setHTML, $, field, showFieldErrors, clearFieldErrors, withBusy, errorMessage, renderSetupRequired } from './app.js';

let card = null;
let params = new URLSearchParams(location.search);

function decorate() {
  // Decorative report-status grid (not data): mostly submitted, a few late/missing.
  const pattern = 'ssssslsssssmssssssssslsssssssssssmssssssslssssssssssssssssssllssssssss';
  $('#auth-grid').innerHTML = pattern.split('').map((c) => `<i class="${c === 's' ? 's' : c === 'l' ? 'l' : 'm'}"></i>`).join('');
}

function passwordField(name, label, autocomplete) {
  return html`<div class="field"><label for="${name}">${label}</label>
    <div class="pw-wrap"><input class="input" id="${name}" name="${name}" type="password" autocomplete="${autocomplete}" required>
    <button type="button" data-toggle="${name}" aria-label="Show password">Show</button></div>
    <span class="error" data-error-for="${name}"></span></div>`;
}

function bindToggles(root) {
  root.querySelectorAll('[data-toggle]').forEach((b) => {
    b.onclick = () => {
      const input = root.querySelector('#' + b.dataset.toggle);
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      b.textContent = show ? 'Hide' : 'Show';
      b.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    };
  });
}

function renderLogin() {
  document.title = 'Sign in | Oakcraft Daily Working Tracker';
  const reason = params.get('reason');
  setHTML(card, html`<h2>Sign in</h2>
    <p class="muted">Use the username and password from your admin.</p>
    ${reason === 'expired' ? html`<div class="banner info" role="status"><span class="banner-body">Your session ended. Sign in again to continue.</span></div>` : ''}
    <div class="banner bad hidden" role="alert" id="login-error"><span class="banner-body"></span></div>
    <form novalidate id="login-form">
      ${field({ name: 'username', label: 'Username', autocomplete: 'username', required: true, attrs: 'autocapitalize="none" spellcheck="false"' })}
      ${passwordField('password', 'Password', 'current-password')}
      <button class="btn primary" type="submit">Sign in</button>
      <p class="small muted" style="margin:0">Forgot your password? Ask the admin to reset it.</p>
    </form>`);
  bindToggles(card);
  const form = $('#login-form');
  form.onsubmit = async (e) => {
    e.preventDefault();
    clearFieldErrors(form);
    const errBox = $('#login-error');
    errBox.classList.add('hidden');
    const username = form.username.value.trim(), password = form.password.value;
    const errors = {};
    if (!username) errors.username = 'Enter your username.';
    if (!password) errors.password = 'Enter your password.';
    if (showFieldErrors(form, errors)) return;
    await withBusy(form.querySelector('button[type="submit"]'), async () => {
      try {
        const res = await login(username, password);
        if (res.user.mustChangePassword) { history.replaceState(null, '', 'login.html#change'); renderChange(res.user); return; }
        location.replace(safeNext(params.get('next'), res.user));
      } catch (err) {
        errBox.querySelector('.banner-body').textContent = errorMessage(err);
        errBox.classList.remove('hidden');
        form.password.value = '';
        form.password.focus();
      }
    });
  };
  form.username.focus();
}

function renderChange(user) {
  document.title = 'Choose a new password | Oakcraft Daily Working Tracker';
  setHTML(card, html`<h2>Choose a new password</h2>
    <p class="muted">${user ? 'Welcome, ' + user.name + '. ' : ''}Replace the temporary password before you continue. Use at least 8 characters with letters and numbers.</p>
    <form novalidate id="change-form">
      ${passwordField('currentPassword', 'Temporary or current password', 'current-password')}
      ${passwordField('newPassword', 'New password', 'new-password')}
      ${passwordField('confirmPassword', 'Repeat new password', 'new-password')}
      <button class="btn primary" type="submit">Save password and continue</button>
      <button class="link-btn" type="button" id="signout">Sign out</button>
    </form>`);
  bindToggles(card);
  $('#signout').onclick = () => logout();
  const form = $('#change-form');
  form.onsubmit = async (e) => {
    e.preventDefault();
    const v = { currentPassword: form.currentPassword.value, newPassword: form.newPassword.value, confirmPassword: form.confirmPassword.value };
    const errors = {};
    if (!v.currentPassword) errors.currentPassword = 'Enter your current password.';
    if (v.newPassword.length < 8 || !/[A-Za-z]/.test(v.newPassword) || !/\d/.test(v.newPassword)) errors.newPassword = 'Use at least 8 characters with letters and numbers.';
    if (v.newPassword !== v.confirmPassword) errors.confirmPassword = 'The passwords do not match.';
    if (showFieldErrors(form, errors)) return;
    await withBusy(form.querySelector('button[type="submit"]'), async () => {
      try {
        await api('changePassword', { currentPassword: v.currentPassword, newPassword: v.newPassword }, { write: true });
        forgetSession();
        const s = await loadSession(true);
        location.replace(safeNext(params.get('next'), s.user));
      } catch (err) {
        if (err instanceof ApiError && err.fieldErrors) showFieldErrors(form, err.fieldErrors);
        else showFieldErrors(form, { currentPassword: errorMessage(err) });
      }
    });
  };
  form.currentPassword.focus();
}

/** Starts the sign-in page. Called by login.html (and by the offline preview build). */
export async function initLogin() {
  card = $('#auth-card');
  params = new URLSearchParams(location.search);
  if (!isConfigured()) { renderSetupRequired(); return; }
  decorate();
  window.addEventListener('oc:auth', () => { forgetSession(); renderLogin(); });
  if (getToken()) {
    try {
      const s = await loadSession(true);
      if (s && s.user.mustChangePassword) { renderChange(s.user); return; }
      if (s && location.hash !== '#change') { location.replace(safeNext(params.get('next'), s.user)); return; }
      if (s) { renderChange(s.user); return; }
    } catch (e) { /* fall through to login */ }
  }
  renderLogin();
}
