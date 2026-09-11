/**
 * Data access layer over Google Sheets.
 *
 * - Every sheet is read by header name, so extra columns added manually are preserved.
 * - Reads are batched (one getValues per block) and memoised per execution.
 * - Master tables are cached in CacheService (chunked to respect the 100 KB limit).
 * - Lookups by ID use TextFinder so large tables are not scanned in full.
 * - Date-range reads load only the date column, then the matching row block.
 * - All values are stored as plain text to avoid Sheets auto-converting dates/numbers.
 */
const Db = (function () {
  let spreadsheet = null;
  const memo = {};
  const headerMemo = {};
  const CACHE_TTL = 1800;
  const CHUNK = 30000;

  function ss() {
    if (spreadsheet) return spreadsheet;
    const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
    spreadsheet = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
    if (!spreadsheet) throw appError('SETUP_REQUIRED', 'Database is not configured. Run setupOakcraftSystem() first.');
    return spreadsheet;
  }

  function sheet(name) {
    const sh = ss().getSheetByName(name);
    if (!sh) throw appError('SETUP_REQUIRED', 'Sheet "' + name + '" is missing. Run setupOakcraftSystem().');
    return sh;
  }

  function headers(name) {
    if (headerMemo[name]) return headerMemo[name];
    const sh = sheet(name);
    const lastCol = sh.getLastColumn();
    const list = lastCol ? sh.getRange(1, 1, 1, lastCol).getValues()[0].map(String) : [];
    const map = {};
    list.forEach(function (h, i) { if (h && !(h in map)) map[h] = i; });
    const missing = SHEETS[name].filter(function (h) { return !(h in map); });
    if (missing.length) throw appError('SETUP_REQUIRED', 'Sheet "' + name + '" is missing columns: ' + missing.join(', ') + '. Run setupOakcraftSystem().');
    headerMemo[name] = { list: list, map: map };
    return headerMemo[name];
  }

  function normalize(key, v) {
    if (v instanceof Date) {
      return /Date$/.test(key) ? Utilities.formatDate(v, getTz(), 'yyyy-MM-dd') : v.toISOString();
    }
    if (v === null || v === undefined) return '';
    let s = typeof v === 'string' ? v : String(v);
    if (/^'[=+\-@]/.test(s)) s = s.slice(1);
    return s;
  }

  function toObj(name, h, row, rowNum) {
    const o = { _row: rowNum };
    SHEETS[name].forEach(function (k) { o[k] = normalize(k, row[h.map[k]]); });
    return o;
  }

  /** Converts a JS value into a safe text cell (formula-injection safe). */
  function cell(v) {
    if (v === null || v === undefined) return '';
    if (v === true) return 'TRUE';
    if (v === false) return 'FALSE';
    if (typeof v === 'number') return isFinite(v) ? String(v) : '';
    if (typeof v === 'object') v = JSON.stringify(v);
    let s = String(v);
    if (s.length > 49000) s = s.slice(0, 49000);
    return /^[=+\-@]/.test(s) ? "'" + s : s;
  }

  // ---------- CacheService helpers (chunked) ----------
  function cache() { return CacheService.getScriptCache(); }

  function cacheGetLarge(key) {
    try {
      const c = cache();
      const n = parseInt(c.get(key + ':n'), 10);
      if (!n) return null;
      const keys = [];
      for (let i = 0; i < n; i++) keys.push(key + ':' + i);
      const parts = c.getAll(keys);
      let str = '';
      for (let i = 0; i < n; i++) {
        if (parts[keys[i]] === undefined || parts[keys[i]] === null) return null;
        str += parts[keys[i]];
      }
      return JSON.parse(str);
    } catch (e) { return null; }
  }

  function cachePutLarge(key, obj) {
    try {
      const str = JSON.stringify(obj);
      if (str.length > CHUNK * 60) return;
      const c = cache();
      const map = {};
      let n = 0;
      for (let i = 0; i < str.length; i += CHUNK) { map[key + ':' + n] = str.slice(i, i + CHUNK); n++; }
      c.putAll(map, CACHE_TTL);
      c.put(key + ':n', String(n), CACHE_TTL);
    } catch (e) { /* cache is best-effort */ }
  }

  function invalidate(name) {
    delete memo[name];
    if (CACHED_TABLES[name]) { try { cache().remove('tbl:' + name + ':n'); } catch (e) { /* ignore */ } }
  }

  // ---------- Reads ----------
  function readAll(name) {
    if (memo[name]) return memo[name];
    if (CACHED_TABLES[name]) {
      const cached = cacheGetLarge('tbl:' + name);
      if (cached) { memo[name] = cached; return cached; }
    }
    const sh = sheet(name);
    const h = headers(name);
    const lr = sh.getLastRow();
    let rows = [];
    if (lr > 1) {
      const pk = SHEETS[name][0];
      rows = sh.getRange(2, 1, lr - 1, h.list.length).getValues()
        .map(function (r, i) { return toObj(name, h, r, i + 2); })
        .filter(function (o) { return o[pk] !== ''; });
    }
    memo[name] = rows;
    if (CACHED_TABLES[name]) cachePutLarge('tbl:' + name, rows);
    return rows;
  }

  /** Rows whose column exactly equals value (TextFinder based). */
  function findBy(name, col, value) {
    if (value === '' || value === null || value === undefined) return [];
    const target = String(value);
    if (memo[name] || CACHED_TABLES[name]) {
      return readAll(name).filter(function (r) { return String(r[col]) === target; });
    }
    const sh = sheet(name);
    const h = headers(name);
    const lr = sh.getLastRow();
    if (lr < 2) return [];
    const cells = sh.getRange(2, h.map[col] + 1, lr - 1, 1)
      .createTextFinder(target).matchEntireCell(true).matchCase(true).findAll();
    if (!cells.length) return [];
    if (cells.length > 40) return readAll(name).filter(function (r) { return String(r[col]) === target; });
    const width = h.list.length;
    return cells.map(function (c) {
      const r = c.getRow();
      return toObj(name, h, sh.getRange(r, 1, 1, width).getValues()[0], r);
    }).filter(function (o) { return String(o[col]) === target; });
  }

  function findOne(name, col, value) { return findBy(name, col, value)[0] || null; }

  /** Rows whose column value (first 10 chars, i.e. yyyy-MM-dd) is within [from, to]. */
  function rangeBy(name, col, from, to) {
    const inRange = function (v) { const d = String(v).slice(0, 10); return d >= from && d <= to; };
    if (memo[name]) return memo[name].filter(function (r) { return inRange(r[col]); });
    const sh = sheet(name);
    const h = headers(name);
    const lr = sh.getLastRow();
    if (lr < 2) return [];
    const colVals = sh.getRange(2, h.map[col] + 1, lr - 1, 1).getValues();
    let min = -1, max = -1;
    for (let i = 0; i < colVals.length; i++) {
      if (inRange(normalize(col, colVals[i][0]))) { if (min < 0) min = i; max = i; }
    }
    if (min < 0) return [];
    const pk = SHEETS[name][0];
    return sh.getRange(min + 2, 1, max - min + 1, h.list.length).getValues()
      .map(function (r, i) { return toObj(name, h, r, min + 2 + i); })
      .filter(function (o) { return o[pk] !== '' && inRange(o[col]); });
  }

  // ---------- Writes (caller should hold the script lock) ----------
  function ensureRows(sh, lastNeeded) {
    const max = sh.getMaxRows();
    if (max < lastNeeded) sh.insertRowsAfter(max, lastNeeded - max + 200);
  }

  function insert(name, objs) {
    if (!objs || !objs.length) return;
    const sh = sheet(name);
    const h = headers(name);
    const known = {};
    SHEETS[name].forEach(function (k) { known[k] = true; });
    const values = objs.map(function (o) {
      return h.list.map(function (hdr) { return known[hdr] ? cell(o[hdr]) : ''; });
    });
    const start = sh.getLastRow() + 1;
    ensureRows(sh, start + values.length - 1);
    sh.getRange(start, 1, values.length, h.list.length).setNumberFormat('@').setValues(values);
    objs.forEach(function (o, i) { o._row = start + i; });
    invalidate(name);
  }

  /** Updates full rows (objects must carry _row). Unknown columns keep their value. */
  function update(name, objs) {
    const list = (objs || []).filter(function (o) { return o && o._row > 1; });
    if (!list.length) return;
    const sh = sheet(name);
    const h = headers(name);
    const byRow = {};
    list.forEach(function (o) { byRow[o._row] = o; });
    const rows = Object.keys(byRow).map(Number).sort(function (a, b) { return a - b; });
    let i = 0;
    while (i < rows.length) {
      let j = i;
      while (j + 1 < rows.length && rows[j + 1] === rows[j] + 1) j++;
      const start = rows[i], count = j - i + 1;
      const range = sh.getRange(start, 1, count, h.list.length);
      const current = range.getValues();
      for (let k = 0; k < count; k++) {
        const o = byRow[start + k];
        SHEETS[name].forEach(function (key) { current[k][h.map[key]] = cell(o[key]); });
      }
      range.setNumberFormat('@').setValues(current);
      i = j + 1;
    }
    invalidate(name);
  }

  /** Physically removes rows (only used for demo-data cleanup and expired sessions). */
  function removeRows(name, objs) {
    const rows = (objs || []).map(function (o) { return o._row; }).filter(function (r) { return r > 1; })
      .sort(function (a, b) { return b - a; });
    if (!rows.length) return;
    const sh = sheet(name);
    let i = 0;
    while (i < rows.length) {
      let j = i;
      while (j + 1 < rows.length && rows[j + 1] === rows[j] - 1) j++;
      sh.deleteRows(rows[j], j - i + 1);
      i = j + 1;
    }
    invalidate(name);
  }

  function withLock(fn) {
    const lock = LockService.getScriptLock();
    try { lock.waitLock(LIMITS.LOCK_WAIT_MS); } catch (e) {
      throw appError('BUSY', 'The system is busy. Please try again in a moment.');
    }
    try { return fn(); } finally { lock.releaseLock(); }
  }

  function resetMemo() {
    Object.keys(memo).forEach(function (k) { delete memo[k]; });
    Object.keys(headerMemo).forEach(function (k) { delete headerMemo[k]; });
  }

  return {
    ss: ss, sheet: sheet, headers: headers, readAll: readAll, findBy: findBy, findOne: findOne, rangeBy: rangeBy,
    insert: insert, update: update, removeRows: removeRows, withLock: withLock, invalidate: invalidate,
    resetMemo: resetMemo, cell: cell
  };
})();
