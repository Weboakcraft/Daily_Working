/**
 * Shared helpers. Dates are handled as 'yyyy-MM-dd' strings (company timezone)
 * and timestamps as ISO-8601 UTC strings, so sheet values stay unambiguous.
 */

function nowIso() { return new Date().toISOString(); }

function getTz() {
  try { return getSettingsMap().TIMEZONE || 'Asia/Kolkata'; } catch (e) { return 'Asia/Kolkata'; }
}

function todayStr() { return Utilities.formatDate(new Date(), getTz(), 'yyyy-MM-dd'); }

function isValidDateStr(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s))) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function validDateOr(s, fallback) { return isValidDateStr(s) ? String(s) : fallback; }

function addDays(s, n) {
  const d = new Date(s + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function daysBetween(a, b) {
  return Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 86400000);
}

/** 'yyyy-MM-dd' -> '11 Sep 2026' for human-readable titles and messages. */
function humanDate(s) {
  if (!isValidDateStr(s)) return String(s || '');
  const m = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return Number(s.slice(8, 10)) + ' ' + m[Number(s.slice(5, 7)) - 1] + ' ' + s.slice(0, 4);
}

function dayCode(s) { return ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'][new Date(s + 'T00:00:00Z').getUTCDay()]; }

function dateRange(from, to) {
  const out = [];
  let d = from;
  while (d <= to && out.length <= LIMITS.RANGE_MAX_DAYS) { out.push(d); d = addDays(d, 1); }
  return out;
}

function weekStart(d) { return addDays(d, -((new Date(d + 'T00:00:00Z').getUTCDay() + 6) % 7)); }

function monthStart(d) { return d.slice(0, 8) + '01'; }

function monthsBack(d, n) {
  const dt = new Date(d.slice(0, 8) + '01T00:00:00Z');
  dt.setUTCMonth(dt.getUTCMonth() - n);
  return dt.toISOString().slice(0, 10);
}

function isValidTime(s) { return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(s)); }

function timeToMin(s) { const p = String(s).split(':'); return Number(p[0]) * 60 + Number(p[1]); }

function newId(prefix) {
  const stamp = Utilities.formatDate(new Date(), 'UTC', 'yyMMdd');
  return prefix + '-' + stamp + '-' + Utilities.getUuid().replace(/-/g, '').slice(0, 8).toUpperCase();
}

function bool(v) { return v === true || String(v).toUpperCase() === 'TRUE'; }

function num(v, def) {
  if (v === '' || v === null || v === undefined) return def === undefined ? 0 : def;
  const n = Number(v);
  return isNaN(n) ? (def === undefined ? 0 : def) : n;
}

function round(n, d) { const p = Math.pow(10, d || 0); return Math.round(n * p) / p; }

function pct(a, b) { return b > 0 ? round((a * 100) / b, 1) : 0; }

function parseJson(s, def) {
  if (s === '' || s === null || s === undefined) return def;
  if (typeof s === 'object') return s;
  try { return JSON.parse(s); } catch (e) { return def; }
}

/** Strips control characters, trims, and enforces a maximum length. */
function cleanText(v, max) {
  if (v === null || v === undefined) return '';
  let s = String(v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
  const limit = max || LIMITS.TEXT;
  return s.length > limit ? s.slice(0, limit) : s;
}

function isEmail(s) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(s)); }

function indexBy(list, key) {
  const m = {};
  (list || []).forEach(function (x) { m[x[key]] = x; });
  return m;
}

function groupBy(list, fn) {
  const m = {};
  (list || []).forEach(function (x) { const k = fn(x); (m[k] = m[k] || []).push(x); });
  return m;
}

function sum(list, fn) { return (list || []).reduce(function (a, x) { return a + num(fn(x)); }, 0); }

function uniq(list) { return Object.keys((list || []).reduce(function (m, x) { m[x] = 1; return m; }, {})); }

/** Application error carrying a stable code the frontend can act on. */
function appError(code, message, details) {
  const e = new Error(message);
  e.appCode = code;
  e.details = details;
  return e;
}

function assert(cond, code, message, details) { if (!cond) throw appError(code, message, details); }

function paginate(items, page, pageSize) {
  const size = Math.min(Math.max(parseInt(pageSize, 10) || 25, 1), LIMITS.PAGE_SIZE_MAX);
  const total = items.length;
  const pages = Math.max(1, Math.ceil(total / size));
  const p = Math.min(Math.max(parseInt(page, 10) || 1, 1), pages);
  return { items: items.slice((p - 1) * size, p * size), total: total, page: p, pageSize: size, pages: pages };
}

function sha256b64(s) {
  return Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(s), Utilities.Charset.UTF_8));
}

function isSubmittedStatus(s) { return s === REPORT_STATUS.SUBMITTED || s === REPORT_STATUS.LATE; }

function textMatch(haystacks, q) {
  if (!q) return true;
  const needle = String(q).toLowerCase();
  return haystacks.some(function (h) { return String(h || '').toLowerCase().indexOf(needle) >= 0; });
}

function truncateJson(v, max) {
  if (v === undefined || v === null || v === '') return '';
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s.length > (max || 5000) ? s.slice(0, max || 5000) + '…' : s;
}
