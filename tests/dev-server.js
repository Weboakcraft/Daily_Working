/**
 * Local preview server (development only).
 * Serves the frontend and answers API calls with the REAL backend code running in the Apps Script simulator,
 * pre-loaded with setup + demo data. Data lives in memory and resets on restart.
 *
 *   node tests/dev-server.js [--port=8080] [--latency=400] [--no-demo]
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { loadBackend } = require('./gas-mock.js');

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v === undefined ? true : v]; }));
const PORT = Number(args.port || 8080);
const LATENCY = Number(args.latency || 0);
const ROOT = path.join(__dirname, '..');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.md': 'text/markdown; charset=utf-8', '.ico': 'image/x-icon' };

const backend = loadBackend();
const setupMsg = backend.run('setupOakcraftSystem');
const demoMsg = args['no-demo'] ? 'Demo data not loaded.' : backend.run('seedDemoData');

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 5e6) req.destroy(); });
    req.on('end', () => {
      setTimeout(() => {
        let out;
        try { out = backend.handleRaw(body); } catch (e) { out = JSON.stringify({ ok: false, error: { code: 'SERVER_ERROR', message: String(e) } }); }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(out);
      }, LATENCY);
    });
    return;
  }
  if (url.pathname === '/js/config.js') {
    const src = fs.readFileSync(path.join(ROOT, 'js', 'config.js'), 'utf8').replace(/APPS_SCRIPT_URL:\s*'[^']*'/, "APPS_SCRIPT_URL: '/api'");
    res.writeHead(200, { 'Content-Type': TYPES['.js'], 'Cache-Control': 'no-store' });
    res.end(src);
    return;
  }
  let file = path.normalize(path.join(ROOT, decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)));
  if (!file.startsWith(ROOT) || file.includes(`${path.sep}backend-apps-script${path.sep}`) || file.includes(`${path.sep}tests${path.sep}`)) { res.writeHead(403); res.end('Forbidden'); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log('Oakcraft tracker preview on http://localhost:' + PORT);
  console.log(setupMsg);
  console.log(demoMsg);
});
