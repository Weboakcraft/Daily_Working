/**
 * Minimal, faithful simulator of the Google Apps Script services used by the backend.
 * Lets the real .gs files run in Node for automated tests and for the local preview server.
 * Development tooling only — never deployed.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const BACKEND_DIR = path.join(__dirname, '..', 'backend-apps-script');
const LOAD_ORDER = ['Config', 'Utils', 'Db', 'Settings', 'Audit', 'Auth', 'Main', 'Employees', 'Questions',
  'Reports', 'Tasks', 'Analytics', 'SearchExport', 'Notifications', 'Setup'];

// ---------------- Spreadsheet ----------------
class MockRange {
  constructor(sheet, row, col, nr, nc) { Object.assign(this, { sheet, row, col, nr, nc }); }
  getValues() {
    const out = [];
    for (let r = 0; r < this.nr; r++) {
      const src = this.sheet.data[this.row - 1 + r] || [];
      const line = [];
      for (let c = 0; c < this.nc; c++) { const v = src[this.col - 1 + c]; line.push(v === undefined ? '' : v); }
      out.push(line);
    }
    return out;
  }
  setValues(values) {
    if (values.length !== this.nr || values.some((l) => l.length !== this.nc)) throw new Error('Range size mismatch');
    if (this.row - 1 + this.nr > this.sheet.maxRows) throw new Error('Range exceeds sheet rows: ' + (this.row - 1 + this.nr) + ' > ' + this.sheet.maxRows);
    values.forEach((line, r) => {
      const idx = this.row - 1 + r;
      while (this.sheet.data.length <= idx) this.sheet.data.push([]);
      line.forEach((v, c) => {
        let s = v === null || v === undefined ? '' : String(v);
        if (s.startsWith("'")) s = s.slice(1); // Sheets treats a leading apostrophe as "force text"
        this.sheet.data[idx][this.col - 1 + c] = s;
      });
    });
    this.sheet.maxCols = Math.max(this.sheet.maxCols, this.col - 1 + this.nc);
    return this;
  }
  setNumberFormat() { return this; }
  setFontWeight() { return this; }
  setBackground() { return this; }
  setFontColor() { return this; }
  createTextFinder(text) {
    const range = this;
    let entire = false, caseSensitive = false;
    const finder = {
      matchEntireCell(v) { entire = v; return finder; },
      matchCase(v) { caseSensitive = v; return finder; },
      findAll() {
        const hits = [];
        const needle = caseSensitive ? text : text.toLowerCase();
        range.getValues().forEach((line, r) => line.forEach((v, c) => {
          const hay = caseSensitive ? String(v) : String(v).toLowerCase();
          if (entire ? hay === needle : hay.includes(needle)) hits.push({ getRow: () => range.row + r, getColumn: () => range.col + c });
        }));
        return hits;
      }
    };
    return finder;
  }
}

class MockSheet {
  constructor(name) { this.name = name; this.data = []; this.maxRows = 1000; this.maxCols = 26; this.frozen = 0; }
  getName() { return this.name; }
  getLastRow() {
    for (let i = this.data.length - 1; i >= 0; i--) if ((this.data[i] || []).some((v) => v !== '' && v !== undefined)) return i + 1;
    return 0;
  }
  getLastColumn() {
    let max = 0;
    this.data.forEach((l) => { for (let i = l.length - 1; i >= 0; i--) if (l[i] !== '' && l[i] !== undefined) { max = Math.max(max, i + 1); break; } });
    return max;
  }
  getMaxRows() { return this.maxRows; }
  getMaxColumns() { return this.maxCols; }
  getRange(row, col, nr, nc) {
    if (row < 1 || col < 1) throw new Error('Invalid range start');
    return new MockRange(this, row, col, nr || 1, nc || 1);
  }
  insertRowsAfter(after, n) { this.maxRows += n; }
  deleteRows(start, n) { this.data.splice(start - 1, n); this.maxRows -= n; }
  deleteColumns(start, n) { this.data.forEach((l) => l.splice(start - 1, n)); this.maxCols -= n; }
  setFrozenRows(n) { this.frozen = n; }
}

class MockSpreadsheet {
  constructor(name) { this.id = 'SS-' + crypto.randomBytes(6).toString('hex'); this.name = name; this.sheets = [new MockSheet('Sheet1')]; }
  getId() { return this.id; }
  getSheetByName(n) { return this.sheets.find((s) => s.name === n) || null; }
  insertSheet(n) { const s = new MockSheet(n); this.sheets.push(s); return s; }
  getSheets() { return this.sheets.slice(); }
  deleteSheet(s) { this.sheets = this.sheets.filter((x) => x !== s); }
}

// ---------------- Services ----------------
function createServices(opts) {
  const state = { spreadsheet: new MockSpreadsheet('Test DB'), props: {}, cache: new Map(), mails: [], fetches: [], triggers: [], logs: [] };
  const toSigned = (buf) => Array.from(buf).map((b) => (b > 127 ? b - 256 : b));
  const toBuf = (v) => (typeof v === 'string' ? Buffer.from(v, 'utf8') : Buffer.from(v.map((b) => b & 255)));

  function tzParts(date, tz) {
    const f = new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
    const p = {};
    f.formatToParts(date).forEach((x) => { p[x.type] = x.value; });
    return p;
  }

  const Utilities = {
    DigestAlgorithm: { SHA_256: 'sha256' },
    Charset: { UTF_8: 'utf8' },
    formatDate(date, tz, fmt) {
      const p = tzParts(date, tz === 'UTC' ? 'UTC' : tz);
      return fmt.replace(/yyyy|yy|MM|dd|HH|mm|ss/g, (t) => ({ yyyy: p.year, yy: p.year.slice(2), MM: p.month, dd: p.day, HH: p.hour, mm: p.minute, ss: p.second })[t]);
    },
    parseDate(str, tz, fmt) {
      if (fmt !== 'yyyy-MM-dd HH:mm') throw new Error('Unsupported parseDate format in mock: ' + fmt);
      const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(str);
      if (!m) throw new Error('Invalid date: ' + str);
      const asUtc = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
      let guess = asUtc;
      for (let i = 0; i < 2; i++) {
        const p = tzParts(new Date(guess), tz);
        const shown = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
        guess += asUtc - shown;
      }
      return new Date(guess);
    },
    getUuid: () => crypto.randomUUID(),
    computeDigest(alg, value) { return toSigned(crypto.createHash('sha256').update(toBuf(value)).digest()); },
    base64Encode(v) { return toBuf(v).toString('base64'); },
    newBlob(s) { return { getBytes: () => toSigned(Buffer.from(String(s), 'utf8')) }; },
    sleep() {}
  };

  const cacheObj = {
    get(k) { const e = state.cache.get(k); if (!e) return null; if (e.exp < Date.now()) { state.cache.delete(k); return null; } return e.v; },
    put(k, v, ttl) { if (String(v).length > 100000) throw new Error('Cache value too large'); state.cache.set(k, { v: String(v), exp: Date.now() + (ttl || 600) * 1000 }); },
    remove(k) { state.cache.delete(k); },
    getAll(keys) { const o = {}; keys.forEach((k) => { const v = cacheObj.get(k); if (v !== null) o[k] = v; }); return o; },
    putAll(map, ttl) { Object.keys(map).forEach((k) => cacheObj.put(k, map[k], ttl)); }
  };

  const services = {
    Utilities,
    SpreadsheetApp: {
      getActiveSpreadsheet: () => (opts && opts.standalone ? null : state.spreadsheet),
      openById: (id) => { if (id !== state.spreadsheet.id) throw new Error('Spreadsheet not found'); return state.spreadsheet; },
      create: (name) => { state.spreadsheet = new MockSpreadsheet(name); return state.spreadsheet; },
      getUi: () => { throw new Error('Cannot call SpreadsheetApp.getUi() from this context.'); }
    },
    CacheService: { getScriptCache: () => cacheObj },
    LockService: { getScriptLock: () => ({ waitLock() {}, tryLock() { return true; }, releaseLock() {} }) },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (k in state.props ? state.props[k] : null),
        setProperty: (k, v) => { state.props[k] = String(v); },
        deleteProperty: (k) => { delete state.props[k]; }
      })
    },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: (s) => ({ content: s, setMimeType() { return this; }, getContent() { return this.content; } })
    },
    MailApp: { sendEmail: (m) => { state.mails.push(m); } },
    UrlFetchApp: { fetch: (url, o) => { state.fetches.push({ url, o }); return { getResponseCode: () => 200 }; } },
    ScriptApp: {
      getProjectTriggers: () => state.triggers.slice(),
      deleteTrigger: (t) => { state.triggers = state.triggers.filter((x) => x !== t); },
      newTrigger: (fn) => {
        const b = { timeBased: () => b, everyMinutes: () => b, create: () => { const t = { getHandlerFunction: () => fn }; state.triggers.push(t); return t; } };
        return b;
      }
    },
    Logger: { log: (m) => { state.logs.push(String(m)); } },
    console: { log() {}, error: (...a) => { state.logs.push('ERROR ' + a.map(String).join(' ')); }, warn() {} }
  };
  return { services, state };
}

/** Loads the backend into an isolated context. Returns { ctx, state, call(action, payload, token) }. */
function loadBackend(opts) {
  const { services, state } = createServices(opts);
  const sandbox = Object.assign({}, services);
  vm.createContext(sandbox);
  const code = LOAD_ORDER.map((n) => fs.readFileSync(path.join(BACKEND_DIR, n + '.gs'), 'utf8')).join('\n;\n') +
    '\n;globalThis.__x = { Db: Db, getSettingsMap: getSettingsMap, resetSettingsMemo: function(){ SETTINGS_MEMO = null; }, Notify: Notify };';
  vm.runInContext(code, sandbox, { filename: 'backend.gs' });

  function call(action, payload, token, requestId) {
    // Each request is a fresh execution: clear per-execution memo like Apps Script does.
    sandbox.__x.Db.resetMemo();
    sandbox.__x.resetSettingsMemo();
    const body = JSON.stringify({ action, token, payload: payload || {}, requestId, meta: { ua: 'test', app: '1.0.0' } });
    const out = sandbox.doPost({ postData: { contents: body } });
    return JSON.parse(out.getContent());
  }
  function run(fnName) {
    sandbox.__x.Db.resetMemo();
    sandbox.__x.resetSettingsMemo();
    return sandbox[fnName]();
  }
  function handleRaw(body) {
    sandbox.__x.Db.resetMemo();
    sandbox.__x.resetSettingsMemo();
    return sandbox.doPost({ postData: { contents: body } }).getContent();
  }
  return { ctx: sandbox, state, call, run, handleRaw };
}

module.exports = { loadBackend };
