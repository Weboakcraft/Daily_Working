/**
 * Builds a single-file offline preview: dist/oakcraft-tracker-preview.html
 * The file contains the real frontend, the real backend (run in the browser), styles, fonts and logo.
 *
 *   npm install -g esbuild      (once)
 *   NODE_PATH=$(npm root -g) node tools/preview/build-preview.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

const ROOT = path.join(__dirname, '..', '..');
const OUT_DIR = path.join(ROOT, 'dist');
const OUT = path.join(OUT_DIR, 'oakcraft-tracker-preview.html');
const LOAD_ORDER = ['Config', 'Utils', 'Db', 'Settings', 'Audit', 'Auth', 'Main', 'Employees', 'Questions',
  'Reports', 'Tasks', 'Analytics', 'SearchExport', 'Notifications', 'Setup'];
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const dataUri = (p, mime) => 'data:' + mime + ';base64,' + fs.readFileSync(path.join(ROOT, p)).toString('base64');

const backendCode = LOAD_ORDER.map((n) => read('backend-apps-script/' + n + '.gs')).join('\n;\n');
const loginHtml = read('login.html');
const loginMarkup = loginHtml.slice(loginHtml.indexOf('<div class="auth-page">'), loginHtml.indexOf('<script'));

const result = esbuild.buildSync({
  entryPoints: [path.join(__dirname, 'preview-entry.js')],
  bundle: true,
  format: 'iife',
  write: false,
  minify: true,
  target: ['chrome100', 'firefox100', 'safari15'],
  define: { __BACKEND_CODE__: JSON.stringify(backendCode), __LOGIN_MARKUP__: JSON.stringify(loginMarkup) },
  logLevel: 'warning'
});
const logo = dataUri('assets/logo-mark.svg', 'image/svg+xml');
let js = result.outputFiles[0].text
  // Page links such as "reports.html#view/ID" become "?page=reports#view/ID" inside the single file.
  .replace(/\b(index|login|employee|reports|dashboard|admin)\.html/g, '?page=$1')
  .replace(/assets\/logo-mark\.svg/g, logo)
  .replace(/<\/script/gi, '<\\/script');

const css = ['css/style.css', 'css/dashboard.css', 'css/responsive.css'].map(read).join('\n')
  .replace(/url\('\.\.\/assets\/fonts\/([^']+)'\)/g, (m, f) => "url('" + dataUri('assets/fonts/' + f, 'font/woff2') + "')");

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Oakcraft Daily Working Tracker (offline preview)</title>
<meta name="robots" content="noindex, nofollow">
<meta name="theme-color" content="#F3F5F9">
<link rel="icon" href="${logo}" type="image/svg+xml">
<!-- Offline preview of the Oakcraft Daily Working Tracker. Demo data only; nothing is sent to any server.
     IBM Plex fonts: SIL Open Font License 1.1. Built ${new Date().toISOString().slice(0, 10)}. -->
<style>
${css}
</style>
</head>
<body>
<main class="auth-main" style="min-height:100vh">
  <div style="text-align:center">
    <img src="${logo}" alt="" width="56" height="56">
    <h1 style="margin:14px 0 6px">Preparing the Oakcraft preview</h1>
    <p class="muted" role="status"><span id="preview-status">Starting</span></p>
    <p class="small muted" style="max-width:44ch;margin:10px auto 0">The first start creates demo data in this browser and takes a few seconds.</p>
  </div>
</main>
<script>
${js}
</script>
</body>
</html>
`;
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(OUT, html);
console.log('Wrote ' + path.relative(ROOT, OUT) + ' (' + Math.round(html.length / 1024) + ' KB)');
