/**
 * Offline preview engine: a browser version of the Google Apps Script services used by the backend,
 * so the REAL backend-apps-script code can run inside the page. Sheet data is saved (gzip) in localStorage.
 * Preview tooling only; the live system uses Google Apps Script and Google Sheets.
 */

// ---------------- SHA-256 (synchronous; Apps Script's computeDigest is synchronous) ----------------
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
]);
function sha256(bytes) {
  const len = bytes.length, bitLen = len * 8;
  const padded = new Uint8Array(((len + 9 + 63) >> 6) << 6);
  padded.set(bytes); padded[len] = 0x80;
  const dv = new DataView(padded.buffer);
  dv.setUint32(padded.length - 4, bitLen >>> 0); dv.setUint32(padded.length - 8, Math.floor(bitLen / 4294967296));
  const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const W = new Uint32Array(64);
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) W[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const a = W[i - 15], b = W[i - 2];
      W[i] = (((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10)) + W[i - 7] + (((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3)) + W[i - 16];
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const t1 = (h + (((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7))) + ((e & f) ^ (~e & g)) + K[i] + W[i]) >>> 0;
      const t2 = ((((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10))) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    H[0] += a; H[1] += b; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += h;
  }
  const out = new Uint8Array(32);
  const odv = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) odv.setUint32(i * 4, H[i]);
  return out;
}

const enc = new TextEncoder();
const toBytes = (v) => (typeof v === 'string' ? enc.encode(v) : Uint8Array.from(v, (b) => b & 255));
const toSigned = (u8) => Array.from(u8, (b) => (b > 127 ? b - 256 : b));

// ---------------- Spreadsheet ----------------
class Range {
  constructor(sheet, row, col, nr, nc) { Object.assign(this, { sheet, row, col, nr, nc }); }
  getValues() {
    const out = [];
    for (let r = 0; r < this.nr; r++) {
      const src = this.sheet.data[this.row - 1 + r] || [];
      const line = [];
      for (let c = 0; c < this.nc; c++) { const v = src[this.col - 1 + c]; line.push(v === undefined || v === null ? '' : v); }
      out.push(line);
    }
    return out;
  }
  setValues(values) {
    if (this.row - 1 + this.nr > this.sheet.maxRows) throw new Error('Range exceeds sheet rows');
    values.forEach((line, r) => {
      const idx = this.row - 1 + r;
      while (this.sheet.data.length <= idx) this.sheet.data.push([]);
      line.forEach((v, c) => {
        let s = v === null || v === undefined ? '' : String(v);
        if (s.charAt(0) === "'") s = s.slice(1);
        this.sheet.data[idx][this.col - 1 + c] = s;
      });
    });
    this.sheet.maxCols = Math.max(this.sheet.maxCols, this.col - 1 + this.nc);
    this.sheet.touch();
    return this;
  }
  setNumberFormat() { return this; }
  setFontWeight() { return this; }
  setBackground() { return this; }
  setFontColor() { return this; }
  createTextFinder(text) {
    const range = this;
    let entire = false, cs = false;
    const f = {
      matchEntireCell(v) { entire = v; return f; },
      matchCase(v) { cs = v; return f; },
      findAll() {
        const hits = [], needle = cs ? text : text.toLowerCase();
        range.getValues().forEach((line, r) => line.forEach((v, c) => {
          const hay = cs ? String(v) : String(v).toLowerCase();
          if (entire ? hay === needle : hay.indexOf(needle) >= 0) hits.push({ getRow: () => range.row + r, getColumn: () => range.col + c });
        }));
        return hits;
      }
    };
    return f;
  }
}

class Sheet {
  constructor(book, name, saved) {
    this.book = book; this.name = name;
    this.data = saved ? saved.data : [];
    this.maxRows = saved ? saved.maxRows : 1000;
    this.maxCols = saved ? saved.maxCols : 26;
    this.frozen = saved ? saved.frozen : 0;
  }
  touch() { this.book.dirty.add(this.name); }
  getName() { return this.name; }
  getLastRow() { for (let i = this.data.length - 1; i >= 0; i--) if ((this.data[i] || []).some((v) => v !== '' && v !== undefined && v !== null)) return i + 1; return 0; }
  getLastColumn() {
    let max = 0;
    this.data.forEach((l) => { for (let i = l.length - 1; i >= 0; i--) if (l[i] !== '' && l[i] !== undefined && l[i] !== null) { max = Math.max(max, i + 1); break; } });
    return max;
  }
  getMaxRows() { return this.maxRows; }
  getMaxColumns() { return this.maxCols; }
  getRange(row, col, nr, nc) { return new Range(this, row, col, nr || 1, nc || 1); }
  insertRowsAfter(after, n) { this.maxRows += n; this.touch(); }
  deleteRows(start, n) { this.data.splice(start - 1, n); this.maxRows -= n; this.touch(); }
  deleteColumns(start, n) { this.data.forEach((l) => l.splice(start - 1, n)); this.maxCols -= n; this.touch(); }
  setFrozenRows(n) { this.frozen = n; this.touch(); }
  toJSON() { return { data: this.data, maxRows: this.maxRows, maxCols: this.maxCols, frozen: this.frozen }; }
}

class Book {
  constructor() { this.id = 'PREVIEW-SHEET'; this.sheets = []; this.dirty = new Set(); }
  getId() { return this.id; }
  getSheetByName(n) { return this.sheets.find((s) => s.name === n) || null; }
  insertSheet(n) { const s = new Sheet(this, n); this.sheets.push(s); this.dirty.add(n); this.dirty.add('__order'); return s; }
  getSheets() { return this.sheets.slice(); }
  deleteSheet(s) { this.sheets = this.sheets.filter((x) => x !== s); this.dirty.add('__order'); }
}

// ---------------- Storage (gzip + base64 in localStorage) ----------------
const PREFIX = 'oc.preview.v1.';
async function gzip(str) {
  if (!window.CompressionStream) return 'raw:' + str;
  const stream = new Blob([str]).stream().pipeThrough(new CompressionStream('gzip'));
  const buf = new Uint8Array(await new Response(stream).arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
  return 'gz:' + btoa(bin);
}
async function gunzip(stored) {
  if (stored.startsWith('raw:')) return stored.slice(4);
  const bin = atob(stored.slice(3));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}
export function clearPreviewStorage() {
  Object.keys(localStorage).filter((k) => k.startsWith(PREFIX) || k.startsWith('oc.')).forEach((k) => localStorage.removeItem(k));
  try { sessionStorage.clear(); } catch (e) { /* ignore */ }
}

// ---------------- Engine ----------------
export async function createEngine(backendCode, onProgress) {
  const book = new Book();
  const props = {};
  const cache = new Map();
  const outbox = [];
  let persistOk = true;

  const meta = JSON.parse(localStorage.getItem(PREFIX + 'meta') || 'null');
  let fresh = true;
  if (meta && meta.sheets) {
    try {
      onProgress && onProgress('Loading saved preview data');
      for (const name of meta.sheets) {
        const stored = localStorage.getItem(PREFIX + 'sheet.' + name);
        book.sheets.push(new Sheet(book, name, stored ? JSON.parse(await gunzip(stored)) : null));
      }
      Object.assign(props, meta.props || {});
      fresh = false;
    } catch (e) {
      console.warn('Saved preview data could not be read; starting fresh.', e);
      book.sheets = [];
    }
  }
  if (fresh) book.sheets.push(new Sheet(book, 'Sheet1'));

  function tzParts(date, tz) {
    const f = new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
    const p = {};
    f.formatToParts(date).forEach((x) => { p[x.type] = x.value; });
    return p;
  }
  const uuid = () => {
    if (crypto.randomUUID) return crypto.randomUUID();
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
    const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
  };
  const cacheApi = {
    get(k) { const e = cache.get(k); if (!e) return null; if (e.exp < Date.now()) { cache.delete(k); return null; } return e.v; },
    put(k, v, ttl) { cache.set(k, { v: String(v), exp: Date.now() + (ttl || 600) * 1000 }); },
    remove(k) { cache.delete(k); },
    getAll(keys) { const o = {}; keys.forEach((k) => { const v = cacheApi.get(k); if (v !== null) o[k] = v; }); return o; },
    putAll(map, ttl) { Object.keys(map).forEach((k) => cacheApi.put(k, map[k], ttl)); }
  };
  let propsDirty = fresh;
  const services = {
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' },
      Charset: { UTF_8: 'utf8' },
      formatDate(date, tz, fmt) {
        const p = tzParts(date, tz);
        return fmt.replace(/yyyy|yy|MM|dd|HH|mm|ss/g, (t) => ({ yyyy: p.year, yy: p.year.slice(2), MM: p.month, dd: p.day, HH: p.hour, mm: p.minute, ss: p.second })[t]);
      },
      parseDate(str, tz) {
        const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(str);
        if (!m) throw new Error('Invalid date: ' + str);
        const asUtc = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
        let guess = asUtc;
        for (let i = 0; i < 2; i++) {
          const p = tzParts(new Date(guess), tz);
          guess += asUtc - Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
        }
        return new Date(guess);
      },
      getUuid: uuid,
      computeDigest(alg, value) { return toSigned(sha256(toBytes(value))); },
      base64Encode(v) { const b = toBytes(v); let s = ''; b.forEach((x) => { s += String.fromCharCode(x); }); return btoa(s); },
      newBlob(s) { return { getBytes: () => toSigned(enc.encode(String(s))) }; },
      sleep() {}
    },
    SpreadsheetApp: {
      getActiveSpreadsheet: () => book,
      openById: () => book,
      create: () => book,
      getUi: () => { throw new Error('No spreadsheet UI in preview'); }
    },
    CacheService: { getScriptCache: () => cacheApi },
    LockService: { getScriptLock: () => ({ waitLock() {}, tryLock() { return true; }, releaseLock() {} }) },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (k in props ? props[k] : null),
        setProperty: (k, v) => { props[k] = String(v); propsDirty = true; },
        deleteProperty: (k) => { delete props[k]; propsDirty = true; }
      })
    },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: (s) => ({ content: s, setMimeType() { return this; }, getContent() { return this.content; } })
    },
    MailApp: { sendEmail: (m) => { outbox.push({ type: 'email', to: m.to, subject: m.subject }); } },
    UrlFetchApp: { fetch: (url) => { outbox.push({ type: 'webhook', url: String(url).slice(0, 40) }); return { getResponseCode: () => 200 }; } },
    ScriptApp: {
      getProjectTriggers: () => (props.__triggers ? [{ getHandlerFunction: () => 'runScheduledJobs' }] : []),
      deleteTrigger: () => { delete props.__triggers; propsDirty = true; },
      newTrigger: () => { const b = { timeBased: () => b, everyMinutes: () => b, create: () => { props.__triggers = '1'; propsDirty = true; return {}; } }; return b; }
    },
    Logger: { log: () => {} },
    console
  };

  // The real backend files, evaluated in their own scope (like one Apps Script project).
  // eslint-disable-next-line no-new-func
  const factory = new Function(...Object.keys(services), backendCode +
    '\n;return { doPost: doPost, setupOakcraftSystem: setupOakcraftSystem, seedDemoData: seedDemoData, resetMemo: function () { Db.resetMemo(); SETTINGS_MEMO = null; } };');
  const backend = factory(...Object.values(services));

  async function persist() {
    if (!persistOk) return;
    const names = Array.from(book.dirty).filter((n) => n !== '__order');
    const orderChanged = book.dirty.has('__order');
    book.dirty.clear();
    if (!names.length && !orderChanged && !propsDirty) return;
    try {
      for (const name of names) {
        const sh = book.getSheetByName(name);
        if (sh) localStorage.setItem(PREFIX + 'sheet.' + name, await gzip(JSON.stringify(sh.toJSON())));
      }
      localStorage.setItem(PREFIX + 'meta', JSON.stringify({ sheets: book.sheets.map((s) => s.name), props, savedAt: new Date().toISOString() }));
      propsDirty = false;
    } catch (e) {
      persistOk = false;
      console.warn('Preview data could not be saved in this browser', e);
    }
  }

  let setupMessage = '';
  if (fresh) {
    onProgress && onProgress('Creating the database (setupOakcraftSystem)');
    await new Promise((r) => setTimeout(r, 30));
    setupMessage = backend.setupOakcraftSystem();
    onProgress && onProgress('Loading 45 days of demo reports (seedDemoData)');
    await new Promise((r) => setTimeout(r, 30));
    backend.resetMemo();
    backend.seedDemoData();
    onProgress && onProgress('Saving preview data in this browser');
    book.sheets.forEach((s) => book.dirty.add(s.name));
    await persist();
  }

  let queue = Promise.resolve();
  function handle(body) {
    // Requests run one at a time, like executions holding the script lock.
    const run = queue.then(async () => {
      backend.resetMemo();
      const out = backend.doPost({ postData: { contents: body } }).getContent();
      await persist();
      return out;
    });
    queue = run.catch(() => {});
    return run;
  }

  return {
    handle, fresh, setupMessage, outbox,
    get persistOk() { return persistOk; }
  };
}
