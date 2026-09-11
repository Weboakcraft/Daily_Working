/**
 * App core shared by every page: safe templating, UI components, formatting, shell and router.
 */
import { CONFIG } from './config.js';
import { api, ApiError, isConfigured, cachedApi } from './api.js';
import { loadSession, logout, goLogin, homeFor, forgetSession } from './auth.js';

// ============================ Safe HTML ============================

class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
export const raw = (s) => new Raw(String(s));
export const esc = (s) => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
function flat(v) {
  if (v === null || v === undefined || v === false) return '';
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(flat).join('');
  return esc(v);
}
/** Tagged template: interpolated values are escaped unless wrapped with raw() or produced by html``. */
export function html(strings, ...vals) {
  let out = '';
  strings.forEach((s, i) => { out += s; if (i < vals.length) out += flat(vals[i]); });
  return new Raw(out);
}
export function setHTML(el, tpl) { el.innerHTML = tpl instanceof Raw ? tpl.s : esc(tpl); return el; }
export const $ = (sel, root) => (root || document).querySelector(sel);
export const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
export function on(root, type, selector, handler) {
  root.addEventListener(type, (e) => {
    const t = e.target.closest(selector);
    if (t && root.contains(t)) handler(e, t);
  });
}
export const attr = (cond, name, value) => (cond ? raw(' ' + name + (value === undefined ? '' : '="' + esc(value) + '"')) : '');

// ============================ Icons ============================

const ICONS = {
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  down: '<path d="M6 9l6 6 6-6"/>',
  up: '<path d="M6 15l6-6 6 6"/>',
  left: '<path d="M15 6l-6 6 6 6"/>',
  right: '<path d="M9 6l6 6-6 6"/>',
  grid: '<rect x="4" y="4" width="7" height="7" rx="1"/><rect x="13" y="4" width="7" height="7" rx="1"/><rect x="4" y="13" width="7" height="7" rx="1"/><rect x="13" y="13" width="7" height="7" rx="1"/>',
  doc: '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5M10 13h6M10 17h6"/>',
  tasks: '<path d="M10 6h10M10 12h10M10 18h10"/><path d="M4 6l1.2 1.2L7.5 5M4 12l1.2 1.2 2.3-2.2M4 18l1.2 1.2 2.3-2.2"/>',
  flag: '<path d="M5 21V4M5 4h12l-2.5 4L17 12H5"/>',
  pen: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13 7l4 4"/>',
  home: '<path d="M4 11l8-7 8 7v9H4z"/><path d="M10 20v-6h4v6"/>',
  chart: '<path d="M4 20V4M4 20h16"/><path d="M8 16v-5M12 16V8M16 16v-8"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><path d="M16 4.5a3.5 3.5 0 010 7M18 14c2 .8 3 2.9 3 6"/>',
  building: '<path d="M4 20V6l8-3v17M12 9h8v11M3 20h18"/><path d="M7 9h2M7 13h2M15 13h2M15 16h2"/>',
  form: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>',
  cog: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>',
  shield: '<path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M5 19l1.5-1.5M17.5 6.5L19 5"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"/>',
  logout: '<path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  upload: '<path d="M12 16V5M7 9l5-5 5 5M5 20h14"/>',
  print: '<path d="M7 9V3h10v6"/><rect x="4" y="9" width="16" height="8" rx="1"/><path d="M7 14h10v7H7z"/>',
  alert: '<path d="M12 3.5l9.5 17h-19z"/><path d="M12 10v5M12 17.8v.4"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.6v.4"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  drag: '<circle cx="9" cy="6" r="1.2"/><circle cx="15" cy="6" r="1.2"/><circle cx="9" cy="12" r="1.2"/><circle cx="15" cy="12" r="1.2"/><circle cx="9" cy="18" r="1.2"/><circle cx="15" cy="18" r="1.2"/>',
  refresh: '<path d="M20 11a8 8 0 10-2.3 5.7M20 4v7h-7"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V4H4v12h4"/>',
  phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2z"/>',
  cloudOff: '<path d="M3 3l18 18"/><path d="M8 8a5 5 0 00-1 9.8h10M16.5 12.5A4 4 0 0019 9a5 5 0 00-8.5-2.8"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M16 7l3 3"/>',
  calendar: '<rect x="4" y="5" width="16" height="16" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'
};
export function icon(name, cls) {
  return raw('<svg class="' + (cls || '') + '" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + (ICONS[name] || '') + '</svg>');
}

// ============================ Formatting ============================

let TZ = 'Asia/Kolkata';
export function setTimezone(tz) { if (tz) TZ = tz; }
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function parseDateStr(s) { const [y, m, d] = String(s).split('-').map(Number); return { y, m, d, dow: new Date(Date.UTC(y, m - 1, d)).getUTCDay() }; }
export function fmtDate(s, opts) {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return '';
  const p = parseDateStr(s);
  if (opts === 'short') return DAYS[p.dow] + ' ' + p.d + ' ' + MONTHS[p.m - 1];
  if (opts === 'tiny') return p.d + ' ' + MONTHS[p.m - 1];
  if (opts === 'month') return MONTHS[p.m - 1] + ' ' + p.y;
  return DAYS[p.dow] + ', ' + p.d + ' ' + MONTHS[p.m - 1] + ' ' + p.y;
}
export function fmtMonth(ym) { const [y, m] = String(ym).split('-').map(Number); return MONTHS[m - 1] + ' ' + String(y).slice(2); }
function tzParts(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return null;
  const f = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const p = {};
  f.formatToParts(d).forEach((x) => { p[x.type] = x.value; });
  return p;
}
export function fmtTime(iso) {
  const p = tzParts(iso); if (!p) return '';
  return fmtHm(p.hour + ':' + p.minute);
}
export function fmtDateTime(iso) {
  const p = tzParts(iso); if (!p) return '';
  return Number(p.day) + ' ' + MONTHS[Number(p.month) - 1] + ' ' + p.year + ', ' + fmtHm(p.hour + ':' + p.minute);
}
export function isoToDateStr(iso) { const p = tzParts(iso); return p ? p.year + '-' + p.month + '-' + p.day : ''; }
export function fmtHm(hm) {
  if (!/^\d{1,2}:\d{2}$/.test(hm || '')) return '';
  let [h, m] = hm.split(':').map(Number);
  const ap = h >= 12 ? 'pm' : 'am';
  h = h % 12 || 12;
  return h + ':' + String(m).padStart(2, '0') + ' ' + ap;
}
export function fmtMinutes(min) {
  min = Math.round(Number(min) || 0);
  if (min < 60) return min + ' min';
  const h = Math.floor(min / 60), m = min % 60;
  return h + ' h' + (m ? ' ' + m + ' min' : '');
}
export function fmtNum(n, digits) {
  const v = Number(n);
  if (!isFinite(v)) return '0';
  return v.toLocaleString('en-IN', { maximumFractionDigits: digits === undefined ? 1 : digits });
}
export function fmtMoney(n) { return '₹' + fmtNum(n, 0); }
export function fmtPct(n) { return fmtNum(n, 1) + '%'; }
export function relTime(iso) {
  const t = new Date(iso).getTime();
  if (!t) return '';
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 45) return 'just now';
  if (s < 3600) return Math.round(s / 60) + ' min ago';
  if (s < 86400) return Math.round(s / 3600) + ' h ago';
  return fmtDateTime(iso);
}
export function addDays(s, n) { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
export function weekStart(s) { return addDays(s, -((parseDateStr(s).dow + 6) % 7)); }
export function monthStart(s) { return s.slice(0, 8) + '01'; }
export function initials(name) { return String(name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase(); }
export function titleCase(s) { return String(s || '').toLowerCase().replace(/(^|[\s-])\S/g, (c) => c.toUpperCase()); }

// ============================ Status vocabulary ============================

const REPORT_TONE = { SUBMITTED: 'ok', LATE: 'warn', DRAFT: 'info', REOPENED: 'accent', 'NOT STARTED': 'outline' };
const REPORT_LABEL = { SUBMITTED: 'Submitted', LATE: 'Submitted late', DRAFT: 'Draft', REOPENED: 'Reopened', 'NOT STARTED': 'Not started' };
const TASK_TONE = { COMPLETED: 'ok', 'IN PROGRESS': 'info', PENDING: 'warn', BLOCKED: 'bad', 'CARRIED FORWARD': 'accent', CANCELLED: 'off' };
const REVIEW_TONE = { 'NOT REVIEWED': 'outline', REVIEWED: 'ok', 'FOLLOW-UP REQUIRED': 'warn', RESOLVED: 'info' };
const FU_TONE = { OPEN: 'warn', 'IN PROGRESS': 'info', RESOLVED: 'ok', CLOSED: 'off' };
export const reportLabel = (s) => REPORT_LABEL[s] || titleCase(s);
export const reportPill = (s) => html`<span class="pill ${REPORT_TONE[s] || 'off'}">${reportLabel(s)}</span>`;
export const taskPill = (s) => html`<span class="pill ${TASK_TONE[s] || 'off'}">${titleCase(s)}</span>`;
export const reviewPill = (s) => html`<span class="pill ${REVIEW_TONE[s || 'NOT REVIEWED'] || 'off'}">${titleCase(s || 'NOT REVIEWED')}</span>`;
export const followUpPill = (s, overdue) => html`<span class="pill ${overdue ? 'bad' : (FU_TONE[s] || 'off')}">${overdue ? 'Overdue' : titleCase(s)}</span>`;
export const prio = (p) => html`<span class="prio ${p}"><i><b></b><b></b><b></b></i>${titleCase(p)}</span>`;
export const TASK_STATUS_OPTIONS = ['COMPLETED', 'IN PROGRESS', 'PENDING', 'BLOCKED', 'CARRIED FORWARD'];
export const PRIORITY_OPTIONS = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];

// ============================ Feedback: toasts, states ============================

export function toast(message, type) {
  let host = $('.toasts');
  if (!host) { host = document.createElement('div'); host.className = 'toasts'; host.setAttribute('role', 'status'); host.setAttribute('aria-live', 'polite'); document.body.appendChild(host); }
  const el = document.createElement('div');
  el.className = 'toast ' + (type || 'ok');
  setHTML(el, html`${icon(type === 'bad' ? 'alert' : type === 'info' ? 'info' : 'check')}<span>${message}</span><button type="button" aria-label="Dismiss">×</button>`);
  host.appendChild(el);
  const kill = () => el.remove();
  el.querySelector('button').onclick = kill;
  setTimeout(kill, type === 'bad' ? 8000 : 4500);
}

export function errorMessage(e) {
  if (e instanceof ApiError) {
    if (e.code === 'SERVER_ERROR' && e.errorId) return e.message + ' Reference: ' + e.errorId;
    return e.message;
  }
  return (e && e.message) || 'Something went wrong.';
}

export const skeleton = (lines) => html`<div class="panel"><div class="panel-body" aria-busy="true" aria-label="Loading">${Array.from({ length: lines || 5 }, (_, i) => html`<div class="skeleton sk-line" style="width:${[92, 76, 84, 60, 88, 70][i % 6]}%"></div>`)}</div></div>`;

export function emptyState(title, text, action) {
  return html`<div class="empty"><h3>${title}</h3>${text ? html`<p>${text}</p>` : ''}${action || ''}</div>`;
}

export function renderError(container, err, retry) {
  setHTML(container, html`<div class="panel"><div class="error-state" role="alert">
    <h3>${err && err.isNetwork ? 'Could not reach the server' : 'This could not be loaded'}</h3>
    <p>${errorMessage(err)}</p>
    ${err && err.details ? html`<p><code>${err.details}</code></p>` : ''}
    ${retry ? html`<button class="btn" type="button" data-retry>${icon('refresh')}Try again</button>` : ''}
  </div></div>`);
  if (retry) container.querySelector('[data-retry]').onclick = retry;
}

export async function withBusy(btn, fn) {
  if (!btn) return fn();
  if (btn.getAttribute('aria-busy') === 'true') return undefined;
  btn.setAttribute('aria-busy', 'true');
  btn.disabled = true;
  try { return await fn(); } finally { btn.removeAttribute('aria-busy'); btn.disabled = false; }
}

// ============================ Modals ============================

let modalDepth = 0;
/**
 * Opens an accessible dialog. Returns { el, body, close }.
 * opts: { title, body (html), footer (html), wide, drawer, onClose, initialFocus }
 */
export function openModal(opts) {
  const opener = document.activeElement;
  const id = 'dlg-' + Math.random().toString(36).slice(2, 8);
  const back = document.createElement('div');
  back.className = 'modal-backdrop' + (opts.drawer ? ' drawer-backdrop' : '');
  setHTML(back, html`<div class="modal ${opts.wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="${id}">
    <div class="modal-head"><h2 id="${id}">${opts.title}</h2><button class="btn ghost icon" type="button" data-close aria-label="Close">${icon('x')}</button></div>
    <div class="modal-body">${opts.body || ''}</div>
    ${opts.footer ? html`<div class="modal-foot">${opts.footer}</div>` : ''}
  </div>`);
  document.body.appendChild(back);
  modalDepth++;
  document.body.style.overflow = 'hidden';
  const dialog = back.querySelector('.modal');
  let closed = false;
  const close = (result) => {
    if (closed) return;
    closed = true;
    back.remove();
    modalDepth--;
    if (!modalDepth) document.body.style.overflow = '';
    document.removeEventListener('keydown', onKey, true);
    if (opener && opener.focus) opener.focus();
    if (opts.onClose) opts.onClose(result);
  };
  const onKey = (e) => {
    if (back !== $$('.modal-backdrop').pop()) return;
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    if (e.key === 'Tab') {
      const f = $$('a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])', dialog).filter((x) => x.offsetParent !== null);
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    }
  };
  document.addEventListener('keydown', onKey, true);
  back.addEventListener('mousedown', (e) => { if (e.target === back && !opts.persistent) close(); });
  on(back, 'click', '[data-close]', () => close());
  setTimeout(() => {
    const target = (opts.initialFocus && dialog.querySelector(opts.initialFocus)) || dialog.querySelector('input:not([type="hidden"]), select, textarea') || dialog.querySelector('[data-close]');
    if (target) target.focus();
  }, 20);
  return { el: dialog, body: dialog.querySelector('.modal-body'), close };
}

export function confirmDialog(o) {
  return new Promise((resolve) => {
    let result = false;
    const m = openModal({
      title: o.title,
      body: html`<p>${o.message}</p>`,
      footer: html`<button class="btn" type="button" data-close>${o.cancelText || 'Cancel'}</button><button class="btn ${o.danger ? 'danger' : 'primary'}" type="button" data-ok>${o.confirmText || 'Confirm'}</button>`,
      onClose: () => resolve(result),
      initialFocus: '[data-ok]'
    });
    m.el.querySelector('[data-ok]').onclick = () => { result = true; m.close(); };
  });
}

/** Asks for a required text value (e.g. a reason). Resolves to the text or null. */
export function promptDialog(o) {
  return new Promise((resolve) => {
    let result = null;
    const m = openModal({
      title: o.title,
      body: html`<form class="stack" novalidate>${o.message ? html`<p>${o.message}</p>` : ''}
        <div class="field"><label for="prompt-v">${o.label}<span class="req">*</span></label>
        <textarea class="textarea" id="prompt-v" name="v" maxlength="500" required></textarea><span class="error" data-error-for="v"></span></div></form>`,
      footer: html`<button class="btn" type="button" data-close>Cancel</button><button class="btn ${o.danger ? 'danger' : 'primary'}" type="button" data-ok>${o.confirmText}</button>`,
      onClose: () => resolve(result)
    });
    m.el.querySelector('[data-ok]').onclick = () => {
      const v = m.el.querySelector('#prompt-v').value.trim();
      if (!v) { showFieldErrors(m.el, { v: o.requiredText || 'This is required.' }); return; }
      result = v; m.close();
    };
  });
}

// ============================ Forms ============================

export function field(o) {
  const id = o.id || 'f-' + o.name + '-' + Math.random().toString(36).slice(2, 6);
  const value = o.value === undefined || o.value === null ? '' : o.value;
  const req = o.required ? raw('<span class="req" aria-hidden="true">*</span>') : '';
  let control;
  const common = html`id="${id}" name="${o.name}" ${attr(o.required, 'required')} ${attr(o.disabled, 'disabled')} ${attr(o.readonly, 'readonly')} ${attr(o.hint, 'aria-describedby', id + '-hint')} ${o.attrs ? raw(o.attrs) : ''}`;
  if (o.type === 'select') {
    control = html`<select class="select" ${common}>${o.placeholder !== undefined ? html`<option value="">${o.placeholder}</option>` : ''}${(o.options || []).map((op) => {
      const v = typeof op === 'object' ? op.value : op, l = typeof op === 'object' ? op.label : titleCase(op);
      return html`<option value="${v}" ${attr(String(v) === String(value), 'selected')}>${l}</option>`;
    })}</select>`;
  } else if (o.type === 'textarea') {
    control = html`<textarea class="textarea" ${common} ${attr(o.maxlength, 'maxlength', o.maxlength)} rows="${o.rows || 3}">${value}</textarea>`;
  } else if (o.type === 'switch') {
    return html`<div class="field ${o.full ? 'full' : ''}"><label class="switch"><input type="checkbox" ${common} ${attr(!!value, 'checked')}><span>${o.label}</span></label>${o.hint ? html`<span class="hint" id="${id}-hint">${o.hint}</span>` : ''}<span class="error" data-error-for="${o.name}"></span></div>`;
  } else {
    control = html`<input class="input" type="${o.type || 'text'}" value="${value}" ${common} ${attr(o.placeholder, 'placeholder', o.placeholder)} ${attr(o.maxlength, 'maxlength', o.maxlength)} ${attr(o.min !== undefined, 'min', o.min)} ${attr(o.max !== undefined, 'max', o.max)} ${attr(o.autocomplete, 'autocomplete', o.autocomplete)} ${attr(o.inputmode, 'inputmode', o.inputmode)}>`;
  }
  return html`<div class="field ${o.full ? 'full' : ''}"><label for="${id}">${o.label}${req}</label>${control}${o.hint ? html`<span class="hint" id="${id}-hint">${o.hint}</span>` : ''}<span class="error" data-error-for="${o.name}"></span></div>`;
}

export function formValues(root) {
  const out = {};
  $$('input[name], select[name], textarea[name]', root).forEach((el) => {
    if (el.type === 'checkbox') {
      if (el.dataset.multi !== undefined) { (out[el.name] = out[el.name] || []); if (el.checked) out[el.name].push(el.value); }
      else out[el.name] = el.checked;
    } else if (el.type === 'radio') {
      if (el.checked) out[el.name] = el.value; else if (!(el.name in out)) out[el.name] = '';
    } else out[el.name] = el.value.trim();
  });
  return out;
}

export function clearFieldErrors(root) {
  $$('.has-error', root).forEach((el) => el.classList.remove('has-error'));
  $$('[data-error-for]', root).forEach((el) => { el.textContent = ''; });
  $$('[aria-invalid]', root).forEach((el) => el.removeAttribute('aria-invalid'));
}

/** Displays server/client field errors next to fields; returns true if any were shown. */
export function showFieldErrors(root, errors) {
  clearFieldErrors(root);
  let first = null;
  Object.keys(errors || {}).forEach((name) => {
    const slot = root.querySelector('[data-error-for="' + CSS.escape(name) + '"]');
    if (!slot) return;
    slot.textContent = errors[name];
    const f = slot.closest('.field');
    if (f) f.classList.add('has-error');
    const input = root.querySelector('[name="' + CSS.escape(name) + '"]');
    if (input) { input.setAttribute('aria-invalid', 'true'); if (!first) first = input; }
  });
  if (first) first.focus();
  return !!Object.keys(errors || {}).length;
}

/** Runs a save action from a form: busy state, field errors, toast on success. */
export async function submitForm(root, btn, fn, successMsg) {
  clearFieldErrors(root);
  try {
    const res = await withBusy(btn, fn);
    if (successMsg) toast(successMsg);
    return res;
  } catch (e) {
    if (e instanceof ApiError && e.fieldErrors && showFieldErrors(root, e.fieldErrors)) toast(e.message, 'bad');
    else toast(errorMessage(e), 'bad');
    throw e;
  }
}

// ============================ Tables ============================

/**
 * Renders a data table into container with client-side sorting of the given rows.
 * columns: [{ key, label, align, sortable, render(row), primary, value(row) }]
 */
export function renderTable(container, cfg) {
  const state = { key: cfg.sortKey || null, dir: cfg.sortDir || 'asc' };
  function draw() {
    let rows = (cfg.rows || []).slice();
    if (state.key) {
      const col = cfg.columns.find((c) => c.key === state.key);
      const val = col && col.value ? col.value : (r) => r[state.key];
      rows.sort((a, b) => {
        const x = val(a), y = val(b);
        const cmp = typeof x === 'number' && typeof y === 'number' ? x - y : String(x === undefined ? '' : x).localeCompare(String(y === undefined ? '' : y), 'en', { numeric: true });
        return state.dir === 'asc' ? cmp : -cmp;
      });
    }
    if (!rows.length) { setHTML(container, cfg.empty || emptyState('Nothing to show', 'Try changing the filters.')); return; }
    setHTML(container, html`<div class="table-wrap"><table class="data ${cfg.stack === false ? '' : 'stack-sm'}">
      ${cfg.caption ? html`<caption class="sr-only">${cfg.caption}</caption>` : ''}
      <thead><tr>${cfg.columns.map((c) => html`<th scope="col" class="${c.align === 'right' ? 'r' : ''}" ${attr(state.key === c.key, 'aria-sort', state.dir === 'asc' ? 'ascending' : 'descending')}>${c.sortable
        ? html`<button type="button" data-sort="${c.key}">${c.label}${state.key === c.key ? icon(state.dir === 'asc' ? 'up' : 'down') : ''}</button>` : c.label}</th>`)}</tr></thead>
      <tbody>${rows.map((r, i) => html`<tr class="${cfg.rowHref ? 'clickable' : ''}" ${attr(cfg.rowHref && cfg.rowHref(r), 'data-href', cfg.rowHref && cfg.rowHref(r))} data-i="${i}">
        ${cfg.columns.map((c) => html`<td class="${c.align === 'right' ? 'r' : ''} ${c.primary ? 'primary-cell' : ''}" data-label="${c.label}">${c.render ? c.render(r) : r[c.key]}</td>`)}</tr>`)}</tbody>
    </table></div>`);
    container._rows = rows;
    $$('svg', container).forEach((s) => { s.style.width = '14px'; s.style.height = '14px'; });
  }
  if (!container._tableBound) {
    container._tableBound = true;
    on(container, 'click', '[data-sort]', (e, t) => {
      const k = t.dataset.sort;
      state.dir = state.key === k && state.dir === 'asc' ? 'desc' : 'asc';
      state.key = k;
      draw();
    });
    on(container, 'click', 'tr[data-href]', (e, tr) => {
      if (e.target.closest('a, button, input, select, label')) return;
      location.href = tr.dataset.href;
    });
  }
  draw();
  return { redraw: draw, state };
}

export function pagerHtml(pg) {
  if (!pg || pg.total <= pg.pageSize) return pg && pg.total ? html`<div class="pager"><span class="muted">${fmtNum(pg.total, 0)} ${pg.total === 1 ? 'row' : 'rows'}</span></div>` : '';
  const from = (pg.page - 1) * pg.pageSize + 1, to = Math.min(pg.total, pg.page * pg.pageSize);
  return html`<div class="pager"><span class="muted">${fmtNum(from, 0)}–${fmtNum(to, 0)} of ${fmtNum(pg.total, 0)}</span>
    <span class="row"><button class="btn sm" type="button" data-page="${pg.page - 1}" ${attr(pg.page <= 1, 'disabled')}>${icon('left')}Previous</button>
    <span class="small">Page ${pg.page} of ${pg.pages}</span>
    <button class="btn sm" type="button" data-page="${pg.page + 1}" ${attr(pg.page >= pg.pages, 'disabled')}>Next${icon('right')}</button></span></div>`;
}

// ============================ Filters helpers ============================

export function rangePreset(preset, today) {
  switch (preset) {
    case 'today': return { from: today, to: today };
    case 'yesterday': return { from: addDays(today, -1), to: addDays(today, -1) };
    case 'week': return { from: weekStart(today), to: today };
    case 'last7': return { from: addDays(today, -6), to: today };
    case 'month': return { from: monthStart(today), to: today };
    case 'last30': return { from: addDays(today, -29), to: today };
    default: return null;
  }
}
export const RANGE_OPTIONS = [
  { value: 'today', label: 'Today' }, { value: 'yesterday', label: 'Yesterday' }, { value: 'week', label: 'This week' },
  { value: 'last7', label: 'Last 7 days' }, { value: 'month', label: 'This month' }, { value: 'last30', label: 'Last 30 days' },
  { value: 'custom', label: 'Custom dates' }
];

/** Reads/writes filter state in the URL hash query (e.g. #list?from=...&to=...). */
export function hashQuery() {
  const h = location.hash.slice(1);
  const i = h.indexOf('?');
  return new URLSearchParams(i >= 0 ? h.slice(i + 1) : '');
}
export function setHashQuery(obj, replace) {
  const h = location.hash.slice(1);
  const base = h.split('?')[0];
  const q = new URLSearchParams();
  Object.keys(obj).forEach((k) => { if (obj[k] !== '' && obj[k] !== undefined && obj[k] !== null && obj[k] !== false) q.set(k, obj[k]); });
  const next = '#' + base + (q.toString() ? '?' + q.toString() : '');
  if (replace) history.replaceState(null, '', next); else history.pushState(null, '', next);
}

/** On phones, folds a filter form behind a "Filters" button (search stays visible). Desktop is unchanged. */
export function collapsibleFilters(form) {
  if (!form || form.previousElementSibling && form.previousElementSibling.classList.contains('filters-toggle')) return;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn sm filters-toggle';
  btn.setAttribute('aria-expanded', 'false');
  const count = () => $$('select, input[type="date"], input[type="checkbox"]', form).filter((el) => (el.type === 'checkbox' ? el.checked : el.value && el.name !== 'range' && !el.closest('.hidden'))).length;
  const label = () => { const n = count(); setHTML(btn, html`${icon('search')}${form.classList.contains('open') ? 'Hide filters' : 'Filters'}${n ? ' (' + n + ')' : ''}`); };
  btn.onclick = () => { form.classList.toggle('open'); btn.setAttribute('aria-expanded', String(form.classList.contains('open'))); label(); };
  form.addEventListener('change', label);
  form.parentNode.insertBefore(btn, form);
  label();
}

export function downloadBlob(filename, blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

// ============================ Shell & router ============================

function navFor(user) {
  const mgmt = user.role !== 'EMPLOYEE';
  const admin = user.role === 'ADMIN';
  const groups = [];
  if (mgmt) {
    groups.push({ title: 'Team', items: [
      { href: 'dashboard.html#overview', label: 'Overview', icon: 'grid', key: 'dashboard:overview' },
      { href: 'dashboard.html#summary', label: 'Daily summary', icon: 'sun', key: 'dashboard:summary' },
      { href: 'dashboard.html#department', label: 'Department analytics', icon: 'chart', key: 'dashboard:department' },
      { href: 'reports.html#list', label: 'Reports', icon: 'doc', key: 'reports:list,reports:view' },
      { href: 'reports.html#tasks', label: 'Tasks', icon: 'tasks', key: 'reports:tasks' },
      { href: 'reports.html#followups', label: 'Follow-ups', icon: 'flag', key: 'reports:followups' },
      { href: 'admin.html#employees', label: admin ? 'Employees' : 'My team', icon: 'users', key: 'admin:employees' }
    ] });
  }
  groups.push({ title: mgmt ? 'My work' : '', items: [
    { href: 'employee.html#home', label: mgmt ? 'My dashboard' : 'Home', icon: 'home', key: 'employee:home' },
    { href: 'employee.html#today', label: "Today's report", icon: 'pen', key: 'employee:today' },
    { href: 'employee.html#history', label: 'My reports', icon: 'doc', key: 'employee:history' + (mgmt ? '' : ',reports:view') },
    ...(mgmt ? [] : [
      { href: 'reports.html#tasks', label: 'My tasks', icon: 'tasks', key: 'reports:tasks' },
      { href: 'reports.html#followups', label: 'Follow-ups', icon: 'flag', key: 'reports:followups' }
    ]),
    { href: 'employee.html#analytics', label: 'My analytics', icon: 'chart', key: 'employee:analytics' }
  ] });
  if (admin) {
    groups.push({ title: 'Administration', items: [
      { href: 'admin.html#departments', label: 'Departments', icon: 'building', key: 'admin:departments' },
      { href: 'admin.html#questions', label: 'Report questions', icon: 'form', key: 'admin:questions' },
      { href: 'admin.html#settings', label: 'Settings', icon: 'cog', key: 'admin:settings' },
      { href: 'admin.html#audit', label: 'Audit log', icon: 'shield', key: 'admin:audit' }
    ] });
  }
  return groups;
}

function applyBranding(settings) {
  const root = document.documentElement.style;
  if (/^#[0-9A-Fa-f]{6}$/.test(settings.BRAND_PRIMARY || '')) {
    root.setProperty('--brand', settings.BRAND_PRIMARY);
    root.setProperty('--brand-dark', 'color-mix(in srgb, ' + settings.BRAND_PRIMARY + ' 78%, black)');
    root.setProperty('--brand-tint', 'color-mix(in srgb, ' + settings.BRAND_PRIMARY + ' 9%, white)');
  }
  if (/^#[0-9A-Fa-f]{6}$/.test(settings.BRAND_ACCENT || '')) {
    root.setProperty('--accent', settings.BRAND_ACCENT);
    root.setProperty('--accent-tint', 'color-mix(in srgb, ' + settings.BRAND_ACCENT + ' 14%, white)');
  }
}

export function renderSetupRequired() {
  document.body.innerHTML = '';
  const div = document.createElement('div');
  div.className = 'auth-main';
  div.style.minHeight = '100vh';
  setHTML(div, html`<div class="panel" style="max-width:620px"><div class="panel-body stack">
    <h1>Connect the tracker to its backend</h1>
    <p>This site is not connected to the Google Apps Script backend yet.</p>
    <ol><li>Deploy the Apps Script project as a Web App (Execute as: Me, Who has access: Anyone).</li>
    <li>Copy the Web App URL ending in <strong>/exec</strong>.</li>
    <li>Open <strong>js/config.js</strong> in this repository and paste the URL as <strong>APPS_SCRIPT_URL</strong>.</li>
    <li>Commit the change. GitHub Pages updates within a minute or two.</li></ol>
    <p class="muted">Full steps are in docs/DEPLOYMENT.md.</p></div></div>`);
  document.body.appendChild(div);
}

let leaveGuard = null;
export function setLeaveGuard(fn) { leaveGuard = fn; }

/**
 * Boots a page: verifies the session, draws the shell and runs the hash router.
 * routes: { name: { title, roles?, render(ctx, args) } }
 */
export async function boot(opts) {
  if (!isConfigured()) { renderSetupRequired(); return; }
  document.body.classList.add('booting');
  let session;
  try {
    session = await loadSession();
  } catch (e) {
    if (e instanceof ApiError && (e.code === 'UNAUTHORIZED' || e.code === 'PASSWORD_CHANGE_REQUIRED')) return;
    document.body.innerHTML = '<div class="content"></div>';
    renderError(document.querySelector('.content'), e, () => location.reload());
    return;
  }
  if (!session) { goLogin(); return; }
  if (session.user.mustChangePassword) { location.href = 'login.html#change'; return; }
  if (opts.roles && opts.roles.indexOf(session.user.role) < 0) { location.replace(homeFor(session.user)); return; }
  setTimezone(session.settings.TIMEZONE);
  applyBranding(session.settings);
  window.addEventListener('oc:auth', (e) => {
    if (e.detail.code === 'PASSWORD_CHANGE_REQUIRED') { location.href = 'login.html#change'; return; }
    forgetSession();
    goLogin('expired');
  });

  const user = session.user;
  const page = opts.page;
  document.body.classList.remove('booting');
  document.body.innerHTML = '';
  const app = document.createElement('div');
  app.className = 'app';
  const groups = navFor(user);
  setHTML(app, html`<a class="skip-link" href="#main">Skip to content</a>
    <aside class="sidebar" aria-label="Main navigation">
      <a class="brand" href="${homeFor(user)}"><img src="assets/logo-mark.svg" alt=""><span><span class="brand-name">${session.settings.COMPANY_NAME}</span><span class="brand-sub">${session.settings.APP_SUBTITLE}</span></span></a>
      ${groups.map((g) => html`<nav class="nav-group" aria-label="${g.title || 'My work'}">${g.title ? html`<div class="nav-group-title">${g.title}</div>` : ''}
        ${g.items.map((it) => html`<a class="nav-link" href="${it.href}" data-key="${it.key}">${icon(it.icon)}<span>${it.label}</span></a>`)}</nav>`)}
      <div class="sidebar-foot">${user.isDemo ? html`<p><span class="pill warn plain">Demo account</span></p>` : ''}Version ${CONFIG.APP_VERSION}</div>
    </aside>
    <div class="main">
      <div class="offline-bar hidden" role="status">You're offline. Changes to your report are kept on this device and saved when you reconnect.</div>
      <header class="topbar">
        <button class="btn ghost icon menu-btn" type="button" aria-label="Open menu" aria-expanded="false" data-menu>${icon('menu')}</button>
        <div class="search" role="search">${icon('search')}
          <label class="sr-only" for="global-search">Search</label>
          <input id="global-search" type="search" autocomplete="off" placeholder="${user.role === 'EMPLOYEE' ? 'Search your reports and tasks' : 'Search people, reports, tasks, customers, orders'}" aria-controls="search-results" aria-expanded="false">
          <div class="search-results hidden" id="search-results" role="listbox"></div>
        </div>
        <div class="topbar-right">
          <span class="clock" data-clock></span>
          <div style="position:relative">
            <button class="user-btn" type="button" aria-haspopup="true" aria-expanded="false" data-user-menu><span class="avatar">${initials(user.name)}</span><span class="sr-only">Account menu for ${user.name}</span></button>
            <div class="menu hidden" data-user-panel>
              <div style="padding:8px 10px"><strong>${user.name}</strong><div class="muted small">${titleCase(user.role)}${user.departmentName ? ', ' + titleCase(user.departmentName) : ''}</div></div>
              <hr><a href="employee.html#profile">Profile and password</a><button type="button" data-logout>Sign out</button>
            </div>
          </div>
        </div>
      </header>
      <main class="content" id="main" tabindex="-1"></main>
    </div>`);
  document.body.appendChild(app);

  let content = $('#main');
  bindShell(app, session);

  let token = 0;
  let lastHash = location.hash;
  const ctx = {
    session, user, settings: session.settings, enums: session.enums, today: session.today, page,
    content,
    head(title, sub, actions) {
      document.title = title + ' | ' + session.settings.COMPANY_NAME;
      return html`<div class="page-head"><div><h1>${title}</h1>${sub ? html`<p>${sub}</p>` : ''}</div>${actions ? html`<div class="page-actions">${actions}</div>` : ''}</div>`;
    },
    departments: () => cachedApi('getDepartments', {}, 120000),
    directory: () => cachedApi('getEmployeeDirectory', {}, 120000),
    navigate(hash) { location.hash = hash; }
  };

  async function route() {
    if (leaveGuard && location.hash.split('?')[0] !== lastHash.split('?')[0]) {
      const okToLeave = await leaveGuard();
      if (!okToLeave) { history.replaceState(null, '', lastHash || location.pathname); return; }
      leaveGuard = null;
    }
    lastHash = location.hash;
    const h = decodeURIComponent(location.hash.slice(1)).split('?')[0];
    const parts = h.split('/').filter(Boolean);
    let name = parts[0] || opts.defaultRoute;
    if (!opts.routes[name]) name = opts.defaultRoute;
    const r = opts.routes[name];
    const my = ++token;
    ctx.isCurrent = () => my === token;
    ctx.route = name;
    $$('.nav-link', app).forEach((a) => {
      const keys = a.dataset.key.split(',');
      if (keys.indexOf(page + ':' + name) >= 0) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    app.classList.remove('nav-open');
    const scrim = $('.nav-scrim'); if (scrim) scrim.remove();
    // Fresh container per route so delegated listeners from the previous view are discarded.
    const fresh = content.cloneNode(false);
    content.replaceWith(fresh);
    content = fresh;
    ctx.content = fresh;
    if (r.roles && r.roles.indexOf(user.role) < 0) {
      setHTML(content, html`${ctx.head('Not available')}${emptyState('You do not have access to this page', 'Ask the admin if you need access.', html`<a class="btn" href="${homeFor(user)}">Go to home</a>`)}`);
      return;
    }
    window.scrollTo(0, 0);
    try {
      await r.render(ctx, parts.slice(1));
    } catch (e) {
      if (!ctx.isCurrent()) return;
      console.error(e);
      renderError(content, e, () => route());
    }
  }
  window.addEventListener('hashchange', route);
  window.addEventListener('beforeunload', (e) => { if (leaveGuard && leaveGuard.dirty && leaveGuard.dirty()) { e.preventDefault(); e.returnValue = ''; } });
  await route();
}

function bindShell(app, session) {
  const menuBtn = $('[data-menu]', app);
  menuBtn.onclick = () => {
    app.classList.add('nav-open');
    menuBtn.setAttribute('aria-expanded', 'true');
    const scrim = document.createElement('div');
    scrim.className = 'nav-scrim';
    scrim.onclick = () => { app.classList.remove('nav-open'); scrim.remove(); menuBtn.setAttribute('aria-expanded', 'false'); };
    document.body.appendChild(scrim);
    const first = $('.nav-link', app); if (first) first.focus();
  };
  const userBtn = $('[data-user-menu]', app), panel = $('[data-user-panel]', app);
  userBtn.onclick = (e) => { e.stopPropagation(); const open = panel.classList.toggle('hidden') === false; userBtn.setAttribute('aria-expanded', String(open)); };
  document.addEventListener('click', (e) => { if (!panel.contains(e.target)) { panel.classList.add('hidden'); userBtn.setAttribute('aria-expanded', 'false'); } });
  $('[data-logout]', app).onclick = () => logout();

  const clock = $('[data-clock]', app);
  const tick = () => {
    const now = new Date().toISOString();
    clock.textContent = fmtDate(isoToDateStr(now), 'short') + ', ' + fmtTime(now);
  };
  tick(); setInterval(tick, 30000);

  const bar = $('.offline-bar', app);
  const net = () => bar.classList.toggle('hidden', navigator.onLine !== false);
  window.addEventListener('online', net); window.addEventListener('offline', net); net();

  bindSearch(app, session);
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && !e.target.closest('input, textarea, select, [contenteditable]') && !$('.modal-backdrop')) { e.preventDefault(); $('#global-search').focus(); }
  });
}

function bindSearch(app, session) {
  const input = $('#global-search', app), box = $('#search-results', app);
  const mgmt = session.user.role !== 'EMPLOYEE';
  let timer = null, seq = 0, active = -1;
  const close = () => { box.classList.add('hidden'); input.setAttribute('aria-expanded', 'false'); active = -1; };
  const items = () => $$('.search-item', box);
  const highlight = () => items().forEach((el, i) => el.setAttribute('aria-selected', String(i === active)));
  input.addEventListener('input', () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < 2) { close(); return; }
    timer = setTimeout(async () => {
      const my = ++seq;
      setHTML(box, html`<div class="search-group">Searching…</div>`);
      box.classList.remove('hidden'); input.setAttribute('aria-expanded', 'true');
      try {
        const r = await api('search', { q });
        if (my !== seq) return;
        const groups = [];
        if (r.employees.length) groups.push(html`<div class="search-group">People</div>${r.employees.map((e) => html`<a class="search-item" role="option" href="employee.html#analytics/${e.employeeId}">${e.name}<div class="muted">${e.employeeId}, ${titleCase(e.department)}${e.status !== 'Active' ? ', inactive' : ''}</div></a>`)}`);
        if (r.reports.length) groups.push(html`<div class="search-group">Reports</div>${r.reports.map((x) => html`<a class="search-item" role="option" href="reports.html#view/${x.reportId}">${x.employeeName}, ${fmtDate(x.date, 'short')}<div class="muted">${x.reportId}, ${reportLabel(x.status)}</div></a>`)}`);
        if (r.tasks.length) groups.push(html`<div class="search-group">Tasks</div>${r.tasks.map((t) => html`<a class="search-item" role="option" href="reports.html#view/${t.reportId}">${t.title}<div class="muted">${[t.relatedEntity, t.employeeName, fmtDate(t.date, 'short'), titleCase(t.status)].filter(Boolean).join(', ')}</div></a>`)}`);
        if (r.followUps.length) groups.push(html`<div class="search-group">Follow-ups</div>${r.followUps.map((f) => html`<a class="search-item" role="option" href="reports.html#followups?focus=${f.followUpId}">${f.title}<div class="muted">${titleCase(f.status)}, ${titleCase(f.priority)} priority</div></a>`)}`);
        setHTML(box, groups.length ? html`${groups}` : html`<div class="search-group">No matches for “${q}”${mgmt ? '' : ' in your records'}.</div>`);
        active = -1;
      } catch (e) {
        if (my === seq) setHTML(box, html`<div class="search-group">${errorMessage(e)}</div>`);
      }
    }, 320);
  });
  input.addEventListener('keydown', (e) => {
    const list = items();
    if (e.key === 'ArrowDown' && list.length) { e.preventDefault(); active = Math.min(list.length - 1, active + 1); highlight(); list[active].scrollIntoView({ block: 'nearest' }); }
    else if (e.key === 'ArrowUp' && list.length) { e.preventDefault(); active = Math.max(0, active - 1); highlight(); }
    else if (e.key === 'Enter' && active >= 0 && list[active]) { e.preventDefault(); location.href = list[active].getAttribute('href'); close(); input.value = ''; }
    else if (e.key === 'Escape') { close(); input.blur(); }
  });
  on(box, 'click', '.search-item', () => { close(); input.value = ''; });
  document.addEventListener('click', (e) => { if (!e.target.closest('.search')) close(); });
}
