/**
 * Audit & error logging. Audit entries are buffered during a request and
 * written in one batch after the action succeeds (see Main.gs).
 */

let AUDIT_BUFFER = [];
let REQUEST_META = {};

function audit(user, action, entity, entityId, oldValue, newValue) {
  AUDIT_BUFFER.push({
    LogID: newId('LOG'),
    UserID: user ? (user.id || user.EmployeeID || 'SYSTEM') : 'SYSTEM',
    Action: action,
    Entity: entity,
    EntityID: entityId || '',
    OldValue: truncateJson(stripSecrets(oldValue), 5000),
    NewValue: truncateJson(stripSecrets(newValue), 5000),
    Timestamp: nowIso(),
    Metadata: truncateJson(REQUEST_META, 500)
  });
}

function flushAudit() {
  if (!AUDIT_BUFFER.length) return;
  const rows = AUDIT_BUFFER;
  AUDIT_BUFFER = [];
  try { Db.withLock(function () { Db.insert('AuditLog', rows); }); } catch (e) { console.error('Audit flush failed', e); }
}

function stripSecrets(v) {
  if (!v || typeof v !== 'object') return v;
  const clone = JSON.parse(JSON.stringify(v));
  (function walk(o) {
    Object.keys(o).forEach(function (k) {
      if (/password|token|salt|hash|webhook/i.test(k)) o[k] = '[redacted]';
      else if (o[k] && typeof o[k] === 'object') walk(o[k]);
    });
  })(clone);
  return clone;
}

function logError(err, action, user, payload) {
  const row = {
    ErrorID: newId('ERR'),
    Timestamp: nowIso(),
    UserID: user ? user.id : '',
    Action: action || '',
    Message: String(err && err.message || err).slice(0, 1000),
    Stack: String(err && err.stack || '').slice(0, 3000),
    Payload: truncateJson(stripSecrets(payload), 2000)
  };
  try { Db.withLock(function () { Db.insert('ErrorLog', [row]); }); } catch (e) { console.error('Error log failed', e, err); }
  return row.ErrorID;
}

function apiGetAuditLogs(p) {
  const f = p.filters || {};
  const to = validDateOr(f.to, todayStr());
  const from = validDateOr(f.from, addDays(to, -30));
  const emps = indexBy(Db.readAll('Employees'), 'EmployeeID');
  let rows = Db.rangeBy('AuditLog', 'Timestamp', from, to);
  if (f.userId) rows = rows.filter(function (r) { return r.UserID === f.userId; });
  if (f.action) rows = rows.filter(function (r) { return r.Action === f.action; });
  if (f.entity) rows = rows.filter(function (r) { return r.Entity === f.entity; });
  if (f.search) rows = rows.filter(function (r) { return textMatch([r.EntityID, r.Action, r.NewValue, r.OldValue, r.UserID], f.search); });
  rows.sort(function (a, b) { return a.Timestamp < b.Timestamp ? 1 : -1; });
  const actions = uniq(rows.map(function (r) { return r.Action; })).sort();
  const pg = paginate(rows, p.page, p.pageSize);
  pg.items = pg.items.map(function (r) {
    return {
      logId: r.LogID, userId: r.UserID, userName: emps[r.UserID] ? emps[r.UserID].EmployeeName : r.UserID,
      action: r.Action, entity: r.Entity, entityId: r.EntityID, oldValue: r.OldValue, newValue: r.NewValue,
      timestamp: r.Timestamp, metadata: r.Metadata
    };
  });
  pg.actions = actions;
  return pg;
}

function apiGetErrorLogs(p) {
  const f = p.filters || {};
  const to = validDateOr(f.to, todayStr());
  const from = validDateOr(f.from, addDays(to, -30));
  let rows = Db.rangeBy('ErrorLog', 'Timestamp', from, to);
  if (f.search) rows = rows.filter(function (r) { return textMatch([r.Message, r.Action, r.UserID], f.search); });
  rows.sort(function (a, b) { return a.Timestamp < b.Timestamp ? 1 : -1; });
  const pg = paginate(rows, p.page, p.pageSize);
  pg.items = pg.items.map(function (r) {
    return { errorId: r.ErrorID, timestamp: r.Timestamp, userId: r.UserID, action: r.Action, message: r.Message, stack: r.Stack, payload: r.Payload };
  });
  return pg;
}
