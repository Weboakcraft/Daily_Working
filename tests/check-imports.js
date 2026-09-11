/** Verifies every named ES-module import in js/ and the HTML pages exists in the target module. */
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const exportsOf = (file) => {
  const src = fs.readFileSync(file, 'utf8');
  const names = new Set();
  for (const m of src.matchAll(/export\s+(?:async\s+)?(?:function|const|let|class)\s+([A-Za-z0-9_$]+)/g)) names.add(m[1]);
  for (const m of src.matchAll(/export\s*\{([^}]+)\}/g)) m[1].split(',').forEach((n) => names.add(n.trim().split(/\s+as\s+/).pop()));
  return names;
};
let problems = 0;
const check = (fromFile, src) => {
  for (const m of src.matchAll(/import\s*\{([^}]+)\}\s*from\s*'([^']+)'/g)) {
    const target = path.normalize(path.join(path.dirname(fromFile), m[2]));
    if (!fs.existsSync(target)) { console.log('MISSING FILE', fromFile, '->', m[2]); problems++; continue; }
    const ex = exportsOf(target);
    m[1].split(',').map((n) => n.trim().split(/\s+as\s+/)[0]).filter(Boolean).forEach((n) => {
      if (!ex.has(n)) { console.log('MISSING EXPORT', path.relative(root, fromFile), 'imports', n, 'from', m[2]); problems++; }
    });
  }
};
fs.readdirSync(path.join(root, 'js')).filter((f) => f.endsWith('.js')).forEach((f) => { const p = path.join(root, 'js', f); check(p, fs.readFileSync(p, 'utf8')); });
fs.readdirSync(root).filter((f) => f.endsWith('.html')).forEach((f) => { const p = path.join(root, f); check(p, fs.readFileSync(p, 'utf8')); });

// Every API action used by the frontend must be registered in the backend router.
const main = fs.readFileSync(path.join(root, 'backend-apps-script', 'Main.gs'), 'utf8');
const routes = new Set([...main.matchAll(/^\s{4}([a-zA-Z]+):\s*\{\s*fn:/gm)].map((m) => m[1]));
const used = new Set();
fs.readdirSync(path.join(root, 'js')).forEach((f) => {
  const src = fs.readFileSync(path.join(root, 'js', f), 'utf8');
  for (const m of src.matchAll(/(?:api|cachedApi)\('([a-zA-Z]+)'/g)) used.add(m[1]);
  for (const m of src.matchAll(/api\(\s*[^,()]*\?\s*'([a-zA-Z]+)'\s*:\s*'([a-zA-Z]+)'/g)) { used.add(m[1]); used.add(m[2]); }
  for (const m of src.matchAll(/api\(\s*current === 'audit' \? '([a-zA-Z]+)' : '([a-zA-Z]+)'/g)) { used.add(m[1]); used.add(m[2]); }
});
used.forEach((a) => { if (!routes.has(a)) { console.log('UNKNOWN API ACTION used by frontend:', a); problems++; } });
routes.forEach((a) => { if (!used.has(a)) console.log('note: backend action not called by the frontend:', a); });
console.log(problems ? problems + ' problem(s)' : 'All imports and API actions resolve (' + used.size + ' actions used).');
process.exit(problems ? 1 : 0);
