/**
 * Offline preview entry. Runs the real frontend pages inside a single HTML file,
 * answering API calls with the real backend code running in the browser (browser-gas.js).
 * Built by tools/preview/build-preview.js.
 */
import { CONFIG } from '../../js/config.js';
import { boot } from '../../js/app.js';
import { initLogin } from '../../js/login.js';
import { loadSession, homeFor } from '../../js/auth.js';
import { renderReportForm } from '../../js/report-form.js';
import { renderMyDashboard, renderEmployeeAnalytics, renderProfile } from '../../js/analytics.js';
import { renderReportList, renderReportDetail, renderTasks, renderFollowUps } from '../../js/reports.js';
import { renderOverview, renderDailySummary, renderDepartmentAnalytics } from '../../js/dashboard.js';
import { renderEmployees, renderDepartments } from '../../js/employees.js';
import { renderQuestionBuilder } from '../../js/questions.js';
import { renderSettings, renderAuditLog } from '../../js/admin.js';
import { createEngine, clearPreviewStorage } from './browser-gas.js';

/* global __BACKEND_CODE__, __LOGIN_MARKUP__ */
const API_PATH = '/__oakcraft_preview_api__';
const DEMO_USERS = [
  ['demo.admin', 'Neha Kapoor', 'Admin, sees everything'],
  ['demo.anil', 'Anil Verma', 'Sales manager'],
  ['demo.priya', 'Priya Sharma', 'Sales executive'],
  ['demo.kavya', 'Kavya Nair', 'Marketing manager'],
  ['demo.sana', 'Sana Qureshi', 'Graphic designer'],
  ['demo.suresh', 'Suresh Pal', 'Store keeper']
];

const PAGES = {
  employee: { page: 'employee', defaultRoute: 'home', routes: {
    home: { render: renderMyDashboard }, today: { render: renderReportForm },
    history: { render: (ctx, args) => renderReportList(ctx, args, { mine: true }) },
    analytics: { render: renderEmployeeAnalytics }, profile: { render: renderProfile } } },
  reports: { page: 'reports', defaultRoute: 'list', routes: {
    list: { render: renderReportList, roles: ['ADMIN', 'MANAGER'] }, view: { render: renderReportDetail },
    tasks: { render: renderTasks }, followups: { render: renderFollowUps } } },
  dashboard: { page: 'dashboard', roles: ['ADMIN', 'MANAGER'], defaultRoute: 'overview', routes: {
    overview: { render: renderOverview }, summary: { render: renderDailySummary }, department: { render: renderDepartmentAnalytics } } },
  admin: { page: 'admin', roles: ['ADMIN', 'MANAGER'], defaultRoute: 'employees', routes: {
    employees: { render: renderEmployees }, departments: { render: renderDepartments, roles: ['ADMIN'] },
    questions: { render: renderQuestionBuilder, roles: ['ADMIN'] }, settings: { render: renderSettings, roles: ['ADMIN'] },
    audit: { render: renderAuditLog, roles: ['ADMIN'] } } }
};

function setStatus(text) {
  const el = document.getElementById('preview-status');
  if (el) el.textContent = text + '…';
}

function currentPage() {
  // Links like "?page=login" plus "?reason=expired" can arrive as "?page=login?reason=expired".
  const raw = location.search.replace(/^\?/, '').split('?');
  const params = new URLSearchParams(raw.join('&'));
  return { name: params.get('page') || 'index', params };
}

function resetData() {
  if (!confirm('Delete all preview data in this browser and create fresh demo data?')) return;
  clearPreviewStorage();
  location.href = '?page=login';
}

function previewNote(engine) {
  return '<p class="small" style="margin:0 0 6px"><strong>Offline preview.</strong> ' +
    (engine.persistOk ? 'Demo data stays in this browser only.' : 'This browser cannot save preview data, so changes reset when the page reloads.') + '</p>' +
    '<button type="button" class="link-btn small" data-preview-reset>Reset preview data</button>';
}

/** Adds the preview note to the sidebar footer (never floats over the app). */
function sidebarNote(engine) {
  const foot = document.querySelector('.sidebar-foot');
  if (!foot) return;
  const box = document.createElement('div');
  box.style.cssText = 'border-top:1px solid var(--rule);padding-top:10px;margin-top:10px;color:var(--ink-2)';
  box.innerHTML = previewNote(engine);
  box.querySelector('[data-preview-reset]').onclick = resetData;
  foot.appendChild(box);
}

function demoLoginHelp(engine) {
  const main = document.getElementById('main');
  if (!main || document.getElementById('preview-logins')) return;
  const box = document.createElement('div');
  box.id = 'preview-logins';
  box.className = 'panel';
  box.style.cssText = 'width:min(400px,100%);margin-top:18px';
  box.innerHTML = '<div class="panel-body"><h3 style="margin-bottom:4px">Preview sign-ins</h3>' +
    '<p class="small muted">Every demo account uses the password <strong>Demo@1234</strong>. Choose one to fill the form.</p>' +
    '<div style="display:flex;flex-direction:column;gap:6px">' +
    DEMO_USERS.map((u) => '<button type="button" class="btn sm" data-demo="' + u[0] + '" style="justify-content:space-between"><span>' + u[1] + '</span><span class="muted">' + u[2] + '</span></button>').join('') +
    '</div><div style="margin-top:12px">' + previewNote(engine) + '</div></div>';
  box.addEventListener('click', (e) => {
    if (e.target.closest('[data-preview-reset]')) { resetData(); return; }
    const b = e.target.closest('[data-demo]');
    if (!b) return;
    const u = document.querySelector('[name=username]'), p = document.querySelector('[name=password]');
    if (!u || !p) return;
    u.value = b.dataset.demo; p.value = 'Demo@1234';
    const submit = document.querySelector('#login-form button[type=submit]');
    if (submit) submit.focus();
  });
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;flex-direction:column;align-items:center;width:100%';
  const card = document.getElementById('auth-card');
  main.insertBefore(wrap, card);
  wrap.appendChild(card);
  wrap.appendChild(box);
}

(async function start() {
  try {
    const engine = await createEngine(__BACKEND_CODE__, setStatus);
    CONFIG.APPS_SCRIPT_URL = API_PATH;
    const realFetch = window.fetch.bind(window);
    window.fetch = async (url, opts) => {
      if (url !== API_PATH) return realFetch(url, opts);
      await new Promise((r) => setTimeout(r, 120));
      const text = await engine.handle(opts && opts.body);
      return new Response(text, { status: 200, headers: { 'Content-Type': 'application/json' } });
    };

    const { name } = currentPage();
    if (name === 'login') {
      document.title = 'Sign in | Oakcraft Daily Working Tracker (preview)';
      document.body.innerHTML = __LOGIN_MARKUP__;
      await initLogin();
      demoLoginHelp(engine);
      new MutationObserver(() => demoLoginHelp(engine)).observe(document.body, { childList: true, subtree: true });
      return;
    }
    if (!PAGES[name]) {
      const s = await loadSession(true).catch(() => null);
      location.replace(s ? homeFor(s.user) : '?page=login');
      return;
    }
    await boot(PAGES[name]);
    sidebarNote(engine);
  } catch (e) {
    console.error(e);
    document.body.innerHTML = '<div style="font-family:system-ui;padding:32px;max-width:640px"><h1>The preview could not start</h1><p>' +
      String(e && e.message || e).replace(/</g, '&lt;') + '</p><p>Use a current version of Chrome, Edge, Firefox or Safari. If the problem continues, clear this site\'s data and reload.</p></div>';
  }
})();
