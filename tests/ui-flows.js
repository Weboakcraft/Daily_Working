/**
 * End-to-end browser flows against the local preview server (node tests/dev-server.js).
 *   node tests/ui-flows.js [baseUrl]
 * Restart the preview server before running so demo data is fresh.
 */
'use strict';
const path = require('path');
const { chromium } = require('playwright');
const BASE = process.argv[2] || 'http://localhost:8080';
const OUT = path.join(__dirname, 'screenshots');

let failures = 0;
async function step(name, fn) {
  try { await fn(); console.log('ok   ' + name); }
  catch (e) { failures++; console.log('FAIL ' + name + '\n     ' + String(e && e.message || e).split('\n')[0]); }
}
function watch(page, errors) {
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
}
async function login(page, user, pass) {
  // Sign out any previous user in this browser context first.
  // A static file on the same origin: no app script runs, so nothing can redirect mid-navigation.
  await page.goto(BASE + '/assets/favicon.svg');
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.goto(BASE + '/login.html');
  await page.waitForSelector('[name=username]', { timeout: 15000 });
  await page.fill('[name=username]', user);
  await page.fill('[name=password]', pass || 'Demo@1234');
  await page.click('button[type=submit]');
  await page.waitForURL(/(dashboard|employee)\.html/, { timeout: 15000 });
}

/** Fills every visible, empty question on the current step with a valid answer. */
async function fillStep(page) {
  await page.evaluate(() => {
    const fire = (el) => { el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };
    document.querySelectorAll('[data-step-panel] [data-qwrap]').forEach((wrap) => {
      if (wrap.closest('.hidden')) return;
      const inputs = Array.from(wrap.querySelectorAll('[data-q]'));
      if (!inputs.length) return;
      const first = inputs[0];
      if (first.type === 'radio') { if (!inputs.some((i) => i.checked)) { const no = inputs.find((i) => i.value === 'No') || inputs[0]; no.checked = true; fire(no); } }
      else if (first.type === 'checkbox') { if (first.dataset.multi !== undefined && !inputs.some((i) => i.checked)) { first.checked = true; fire(first); } }
      else if (first.tagName === 'SELECT') { if (!first.value && first.options.length > 1) { first.selectedIndex = 1; fire(first); } }
      else if (!first.value) {
        first.value = first.getAttribute('inputmode') === 'numeric' || first.getAttribute('inputmode') === 'decimal' ? '4' : first.type === 'date' ? new Date().toISOString().slice(0, 10) : first.type === 'time' ? '10:30' : 'Visited two dealers in Okhla and shared revised quotations.';
        fire(first);
      }
    });
  });
}

(async () => {
  const browser = await chromium.launch();

  // ---------------- Employee on a phone ----------------
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const p = await phone.newPage();
  const perr = []; watch(p, perr);
  let reportId = '';
  let employeeUser = '';
  const MANAGER_OF = { 'demo.rohit': 'demo.anil', 'demo.kavya': 'demo.admin', 'demo.arjun': 'demo.kavya', 'demo.sana': 'demo.kavya', 'demo.vikas': 'demo.admin', 'demo.pooja': 'demo.vikas', 'demo.imran': 'demo.vikas', 'demo.deepak': 'demo.sunita', 'demo.meera': 'demo.sunita', 'demo.nikita': 'demo.rajesh', 'demo.harsh': 'demo.rajesh', 'demo.ritu': 'demo.alok' };
  await step('employee signs in on a phone and opens today\'s report', async () => {
    // Demo data submits some of today's reports already; use the first employee whose report is still open.
    for (const user of ['demo.rohit', 'demo.kavya', 'demo.arjun', 'demo.sana', 'demo.vikas', 'demo.pooja', 'demo.imran', 'demo.deepak', 'demo.meera', 'demo.nikita', 'demo.harsh', 'demo.ritu']) {
      await login(p, user);
      await p.goto(BASE + '/employee.html#today');
      await p.waitForSelector('[data-step-panel] h2, .page-head h1 >> text=report', { timeout: 15000 });
      await p.waitForTimeout(300);
      if (await p.$('[data-step-panel] h2')) { console.log('     using ' + user); employeeUser = user; return; }
    }
    throw new Error('no demo employee with an open report today');
  });
  await step('employee continues unfinished work, adds a task with details', async () => {
    const title = await p.textContent('[data-step-panel] h2');
    if (/Unfinished/.test(title)) {
      const all = await p.$('[data-act="cf-continue-all"]');
      if (all) await all.click(); else { const one = await p.$('[data-act="cf-continue"]'); if (one) await one.click(); }
      await p.click('[data-act="next"]');
    }
    await p.waitForSelector('[data-new-task]');
    await p.fill('[data-new-task]', 'Site visit at Sharma Interiors, Noida');
    await p.press('[data-new-task]', 'Enter');
    const cards = await p.$$('[data-task-card]');
    const last = cards[cards.length - 1];
    await (await last.$('[data-tact="toggle"]')).click();
    const key = await last.getAttribute('data-key');
    await p.fill('#tst-' + key, '11:00');
    await p.fill('#tet-' + key, '12:30');
    await p.fill('#tre-' + key, 'Sharma Interiors, order 4512');
    const minutes = await p.inputValue('#td-' + key);
    if (minutes !== '90') throw new Error('duration not calculated: ' + minutes);
  });
  await step('draft auto-saves', async () => {
    await p.waitForFunction(() => { const el = document.querySelector('[data-save-state]'); return !!el && /Draft saved/.test(el.textContent); }, null, { timeout: 15000 });
  });
  await step('employee completes every step and sees validation before submit', async () => {
    for (let i = 0; i < 8; i++) {
      const act = await p.getAttribute('.sticky-bar .btn.primary', 'data-act');
      if (act === 'submit') break;
      await fillStep(p);
      await p.click('[data-act="next"]');
      await p.waitForTimeout(150);
    }
    await p.screenshot({ path: path.join(OUT, 'flow-phone-review.png') });
    const blocked = await p.$('.banner.bad');
    if (blocked) throw new Error('review shows missing answers: ' + (await blocked.innerText()).slice(0, 200));
  });
  await step('employee submits once and gets a receipt with a report ID', async () => {
    await p.click('[data-act="submit"]');
    await p.click('.modal [data-ok]');
    await p.waitForSelector('.receipt .rid', { timeout: 15000 });
    reportId = (await p.textContent('.receipt .rid')).trim();
    if (!/^RPT-/.test(reportId)) throw new Error('bad report id ' + reportId);
    await p.screenshot({ path: path.join(OUT, 'flow-phone-receipt.png') });
  });
  await step('"Send on WhatsApp" appears after submission and opens WhatsApp with the full report pre-filled', async () => {
    const btn = p.locator('.receipt [data-whatsapp]');
    await btn.waitFor({ timeout: 15000 });
    await p.waitForFunction(() => { const b = document.querySelector('.receipt [data-whatsapp]'); return b && !b.disabled && /Send on WhatsApp/.test(b.textContent); }, null, { timeout: 15000 });
    await p.evaluate(() => { window.__waUrls = []; window.open = (u) => { window.__waUrls.push(u); return {}; }; });
    let apiCalls = 0;
    const count = (req) => { if (req.method() === 'POST' && /\/api$/.test(req.url())) apiCalls++; };
    p.on('request', count);
    await btn.click();
    await p.waitForSelector('.modal >> text=Nothing is sent until you press Send', { timeout: 10000 });
    p.off('request', count);
    const urls = await p.evaluate(() => window.__waUrls);
    if (urls.length !== 1 || !urls[0].startsWith('https://wa.me/?text=')) throw new Error('WhatsApp not opened correctly: ' + JSON.stringify(urls));
    if (apiCalls) throw new Error('sharing made ' + apiCalls + ' server call(s); it must not send anything');
    const text = decodeURIComponent(urls[0].slice('https://wa.me/?text='.length));
    const must = [reportId, 'daily work report', 'Submitted:', '*Tasks:', 'Site visit at Sharma Interiors, Noida', 'Sharma Interiors, order 4512', 'Visited two dealers in Okhla', "*Tomorrow's plan*", 'Sent from the'];
    const missing = must.filter((x) => text.indexOf(x) < 0);
    if (missing.length) throw new Error('message is missing: ' + missing.join(', ') + '\n' + text.slice(0, 400));
    if (/undefined|null|\[object/.test(text)) throw new Error('message contains placeholder values');
    const href = await p.getAttribute('.modal [data-open]', 'href');
    if (href !== urls[0]) throw new Error('fallback link differs from the opened URL');
    await p.screenshot({ path: path.join(OUT, 'flow-phone-whatsapp.png') });
    require('fs').writeFileSync(path.join(OUT, 'whatsapp-message-sample.txt'), text);
    await p.click('.modal .modal-foot [data-close]');
  });
  await step('reopening today\'s form shows it as submitted and read-only', async () => {
    await p.goto(BASE + '/employee.html#home');
    await p.waitForSelector('.hero-line');
    await p.goto(BASE + '/employee.html#today');
    await p.waitForSelector('text=can no longer be edited', { timeout: 15000 });
    await p.waitForSelector('[data-whatsapp]', { timeout: 15000 });
  });
  await step('phone flow has no console errors', async () => { if (perr.length) throw new Error(perr.join(' | ')); });
  await phone.close();

  // ---------------- Manager reviews ----------------
  const desk = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  const m = await desk.newPage();
  const merr = []; watch(m, merr);
  await step('manager opens the report and adds a review with a follow-up', async () => {
    await login(m, MANAGER_OF[employeeUser] || 'demo.admin');
    await m.goto(BASE + '/reports.html#view/' + reportId);
    await m.waitForSelector('[data-remark]', { timeout: 15000 });
    if (await m.$('[data-whatsapp]')) throw new Error('managers must not see Send on WhatsApp on someone else\'s report');
    await m.click('[data-remark]');
    await m.fill('.modal [name=comment]', 'Good visit. Confirm the delivery date with Sharma Interiors tomorrow.');
    await m.check('.modal [name=followUpRequired]');
    await m.click('.modal [data-save]');
    await m.waitForSelector('.timeline li', { timeout: 15000 });
    await m.screenshot({ path: path.join(OUT, 'flow-desktop-report-detail.png'), fullPage: true });
  });
  await step('manager sees the follow-up in the follow-ups list', async () => {
    await m.goto(BASE + '/reports.html#followups');
    await m.waitForSelector('text=Follow-up on report of', { timeout: 15000 });
  });
  await step('manager flow has no console errors', async () => { if (merr.length) throw new Error(merr.join(' | ')); });

  // ---------------- Admin ----------------
  const a = await desk.newPage();
  const aerr = []; watch(a, aerr);
  await step('admin reopens the report with a reason', async () => {
    await m.goto(BASE + '/login.html');
    await login(a, 'demo.admin');
    await a.goto(BASE + '/reports.html#view/' + reportId);
    await a.waitForSelector('[data-reopen]', { timeout: 15000 });
    await a.click('[data-reopen]');
    await a.fill('.modal textarea', 'Add the order value for the Noida visit.');
    await a.click('.modal [data-ok]');
    await a.waitForSelector('text=Waiting for the employee to submit again', { timeout: 15000 });
    if (await a.$('[data-whatsapp]')) throw new Error('reopened reports must not show Send on WhatsApp');
  });
  let tempPw = '';
  await step('admin adds an employee and gets shareable sign-in details', async () => {
    await a.goto(BASE + '/admin.html#employees');
    await a.waitForSelector('[data-add]');
    await a.click('.page-actions [data-add]');
    await a.fill('.modal [name=name]', 'Kiran Joshi');
    await a.fill('.modal [name=username]', 'kiran.joshi');
    await a.selectOption('.modal [name=departmentId]', { label: 'Store' });
    await a.fill('.modal [name=designation]', 'Store Assistant');
    tempPw = await a.inputValue('.modal [name=password]');
    await a.click('.modal [data-save]');
    await a.waitForSelector('.modal >> text=Temporary password', { timeout: 15000 });
    await a.click('.modal .modal-foot [data-close]');
  });
  await step('new employee must change password at first sign-in', async () => {
    const ctx2 = await browser.newContext({ viewport: { width: 1200, height: 800 } });
    const n = await ctx2.newPage();
    await n.goto(BASE + '/login.html');
    await n.fill('[name=username]', 'kiran.joshi');
    await n.fill('[name=password]', tempPw);
    await n.click('button[type=submit]');
    await n.waitForSelector('#change-form', { timeout: 15000 });
    await n.fill('[name=currentPassword]', tempPw);
    await n.fill('[name=newPassword]', 'Storeroom2026');
    await n.fill('[name=confirmPassword]', 'Storeroom2026');
    await n.click('#change-form button[type=submit]');
    await n.waitForURL(/employee\.html/, { timeout: 15000 });
    await ctx2.close();
  });
  await step('admin adds a conditional department question with live preview', async () => {
    await a.goto(BASE + '/admin.html#questions/DEPT-STORE');
    await a.waitForSelector('.page-head');
    await a.click('button[data-add]');
    await a.fill('.modal [name=text]', 'Damaged items found');
    await a.selectOption('.modal [name=type]', 'NUMBER');
    await a.fill('.modal [name=v_min]', '0');
    await a.waitForSelector('.modal [data-live] .stepper');
    await a.click('.modal [data-save]');
    await a.waitForSelector('.modal-backdrop', { state: 'detached', timeout: 15000 });
    await a.waitForSelector('.qb-text >> text=Damaged items found', { timeout: 15000 });
  });
  await step('admin saves settings and gets validation for bad weights', async () => {
    await a.goto(BASE + '/admin.html#settings');
    await a.waitForSelector('[data-section="score"]');
    await a.fill('[name=w_KPI]', '90');
    await a.click('[data-save="score"]');
    await a.waitForSelector('[data-section="score"] .has-error, .toast.bad', { timeout: 15000 });
    await a.fill('[name=w_KPI]', '25');
    await a.click('[data-save="window"]');
    await a.waitForSelector('.toast >> text=/Settings saved|No changes/', { timeout: 15000 });
  });
  await step('admin exports reports as CSV', async () => {
    await a.goto(BASE + '/reports.html#list');
    await a.waitForSelector('[data-export]');
    await a.click('[data-export]');
    await a.selectOption('.modal [name=format]', 'csv');
    const [dl] = await Promise.all([a.waitForEvent('download', { timeout: 20000 }), a.click('.modal [data-go]')]);
    if (!/\.csv$/.test(dl.suggestedFilename())) throw new Error('unexpected file ' + dl.suggestedFilename());
  });
  await step('global search finds the report', async () => {
    await a.fill('#global-search', reportId);
    await a.waitForSelector('.search-item', { timeout: 15000 });
  });
  await step('admin flow has no console errors', async () => { if (aerr.length) throw new Error(aerr.join(' | ')); });

  await browser.close();
  console.log(failures ? failures + ' failing step(s)' : 'All flows passed.');
  process.exit(failures ? 1 : 0);
})();
