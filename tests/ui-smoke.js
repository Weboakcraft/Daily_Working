/**
 * Browser smoke test against the local preview server (node tests/dev-server.js).
 * Visits every route as admin, manager and employee on desktop and phone sizes,
 * fails on console errors, error states or horizontal overflow on phones,
 * and saves screenshots to tests/screenshots/.
 *   node tests/ui-smoke.js [baseUrl]
 */
'use strict';
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const BASE = process.argv[2] || 'http://localhost:8080';
const OUT = path.join(__dirname, 'screenshots');
fs.mkdirSync(OUT, { recursive: true });

const ROUTES = {
  admin: ['dashboard.html#overview', 'dashboard.html#overview?range=last30', 'dashboard.html#summary', 'dashboard.html#department', 'reports.html#list', 'reports.html#tasks', 'reports.html#followups',
    'admin.html#employees', 'admin.html#departments', 'admin.html#questions', 'admin.html#questions/DEPT-SALES', 'admin.html#settings', 'admin.html#audit', 'employee.html#home', 'employee.html#profile'],
  manager: ['dashboard.html#overview', 'dashboard.html#department', 'reports.html#list', 'reports.html#followups', 'admin.html#employees', 'employee.html#today'],
  employee: ['employee.html#home', 'employee.html#today', 'employee.html#history', 'employee.html#analytics', 'reports.html#tasks', 'reports.html#followups', 'employee.html#profile', 'admin.html#employees']
};
const USERS = { admin: 'demo.admin', manager: 'demo.anil', employee: 'demo.priya' };
const only = process.env.ROLE;

(async () => {
  const browser = await chromium.launch();
  let failures = 0;
  for (const [role, routes] of Object.entries(ROUTES)) {
    if (only && only !== role) continue;
    for (const vp of [{ name: 'desktop', width: 1360, height: 900 }, { name: 'phone', width: 390, height: 844, isMobile: true }]) {
      const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: !!vp.isMobile, hasTouch: !!vp.isMobile });
      const page = await context.newPage();
      const errors = [];
      page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
      page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
      await page.goto(BASE + '/login.html');
      await page.fill('[name=username]', USERS[role]);
      await page.fill('[name=password]', 'Demo@1234');
      await page.click('button[type=submit]');
      await page.waitForURL(/(dashboard|employee)\.html/, { timeout: 15000 });
      for (const r of routes) {
        errors.length = 0;
        await page.goto(BASE + '/' + r);
        await page.waitForTimeout(1500);
        const bad = await page.evaluate(() => { const a = document.querySelector('.error-state'); return a ? a.innerText.slice(0, 200) : ''; });
        const name = (role + '-' + vp.name + '-' + r.replace(/[^a-z0-9]+/gi, '_')).slice(0, 90);
        await page.screenshot({ path: path.join(OUT, name + '.png'), fullPage: vp.name === 'desktop' });
        const overflow = vp.name === 'phone' ? await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2) : false;
        if (errors.length || bad || overflow) {
          failures++;
          console.log('FAIL', role, vp.name, r, errors.join(' | '), bad, overflow ? 'horizontal overflow' : '');
        } else console.log('ok  ', role, vp.name, r);
      }
      await context.close();
    }
  }
  await browser.close();
  console.log(failures ? failures + ' failing page(s)' : 'All pages rendered without errors.');
  process.exit(failures ? 1 : 0);
})();
