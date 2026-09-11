/**
 * Authentication & authorisation.
 *
 * - Passwords: salted + peppered, iterated SHA-256 (pepper in Script Properties).
 * - Sessions: random 64-hex token given to the browser; only its SHA-256 hash is stored.
 * - Every request re-checks that the employee is still Active.
 * - Login attempts are rate-limited per username.
 */

function getPepper() {
  const props = PropertiesService.getScriptProperties();
  let pepper = props.getProperty('PASSWORD_PEPPER');
  if (!pepper) {
    pepper = Utilities.getUuid() + Utilities.getUuid();
    props.setProperty('PASSWORD_PEPPER', pepper);
  }
  return pepper;
}

function hashPassword(password, salt) {
  const pepper = getPepper();
  let digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + '|' + password + '|' + pepper, Utilities.Charset.UTF_8);
  const saltBytes = Utilities.newBlob(salt).getBytes();
  for (let i = 0; i < LIMITS.HASH_ITERATIONS; i++) {
    digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, digest.concat(saltBytes));
  }
  return Utilities.base64Encode(digest);
}

function safeEquals(a, b) {
  a = String(a); b = String(b);
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

function validatePasswordPolicy(pw) {
  pw = String(pw || '');
  if (pw.length < 8) return 'Password must be at least 8 characters.';
  if (pw.length > 128) return 'Password is too long.';
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return 'Password must contain letters and numbers.';
  return '';
}

function makeCredential(employeeId, username, password, mustChange) {
  const salt = Utilities.getUuid().replace(/-/g, '');
  return {
    EmployeeID: employeeId, Username: username, PasswordHash: hashPassword(password, salt), Salt: salt,
    MustChange: !!mustChange, PasswordUpdatedAt: nowIso()
  };
}

function toSessionUser(emp, mustChange) {
  return {
    id: emp.EmployeeID, name: emp.EmployeeName, role: emp.Role, departmentId: emp.DepartmentID,
    managerId: emp.ManagerID, username: emp.Username, designation: emp.Designation, email: emp.Email,
    reportRequired: bool(emp.ReportRequired), mustChangePassword: !!mustChange, isDemo: bool(emp.IsDemo)
  };
}

// ---------------- API: login / logout / me ----------------

function apiLogin(p, _user, meta) {
  const username = cleanText(p.username, 60).toLowerCase();
  const password = String(p.password || '');
  assert(username && password, 'VALIDATION', 'Enter your username and password.');
  const s = getSettingsMap();
  const cache = CacheService.getScriptCache();
  const failKey = 'loginfail:' + username;
  const fails = parseInt(cache.get(failKey), 10) || 0;
  assert(fails < s.MAX_LOGIN_ATTEMPTS, 'LOCKED', 'Too many failed attempts. Try again in 15 minutes or ask the admin to reset your password.');

  const emp = Db.readAll('Employees').filter(function (e) { return String(e.Username).toLowerCase() === username; })[0];
  const cred = emp ? Db.findOne('Credentials', 'EmployeeID', emp.EmployeeID) : null;
  const ok = !!(emp && cred && safeEquals(hashPassword(password, cred.Salt), cred.PasswordHash));
  if (!ok) {
    cache.put(failKey, String(fails + 1), 900);
    if (emp) audit({ id: emp.EmployeeID }, 'LOGIN_FAILED', 'Employee', emp.EmployeeID, '', { attempts: fails + 1 });
    throw appError('INVALID_CREDENTIALS', 'Invalid username or password.');
  }
  assert(emp.Status === 'Active', 'ACCOUNT_INACTIVE', 'Your account is inactive. Contact the admin.');
  cache.remove(failKey);

  const token = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
  const now = new Date();
  const expires = new Date(now.getTime() + s.SESSION_HOURS * 3600000);
  const session = {
    SessionID: newId('SES'), TokenHash: sha256b64(token), EmployeeID: emp.EmployeeID, CreatedAt: now.toISOString(),
    ExpiresAt: expires.toISOString(), Revoked: false, UserAgent: cleanText(meta && meta.ua, 200)
  };
  Db.withLock(function () { Db.insert('Sessions', [session]); });
  cache.put('sess:' + session.TokenHash, JSON.stringify({ employeeId: emp.EmployeeID, expiresAt: session.ExpiresAt }), LIMITS.SESSION_CACHE_SEC);
  audit({ id: emp.EmployeeID }, 'LOGIN', 'Employee', emp.EmployeeID, '', { sessionId: session.SessionID });
  return { token: token, expiresAt: session.ExpiresAt, user: toSessionUser(emp, bool(cred.MustChange)) };
}

/** Resolves a token into the current user or throws UNAUTHORIZED. */
function authenticate(token) {
  assert(token && /^[a-f0-9]{64}$/.test(String(token)), 'UNAUTHORIZED', 'Please sign in to continue.');
  const hash = sha256b64(token);
  const cache = CacheService.getScriptCache();
  let sess = parseJson(cache.get('sess:' + hash), null);
  if (!sess) {
    const row = Db.findOne('Sessions', 'TokenHash', hash);
    assert(row && !bool(row.Revoked), 'UNAUTHORIZED', 'Your session has ended. Please sign in again.');
    sess = { employeeId: row.EmployeeID, expiresAt: row.ExpiresAt };
    cache.put('sess:' + hash, JSON.stringify(sess), LIMITS.SESSION_CACHE_SEC);
  }
  assert(sess.revoked !== true, 'UNAUTHORIZED', 'Your session has ended. Please sign in again.');
  assert(new Date(sess.expiresAt) > new Date(), 'UNAUTHORIZED', 'Your session has expired. Please sign in again.');
  const emp = Db.readAll('Employees').filter(function (e) { return e.EmployeeID === sess.employeeId; })[0];
  assert(emp && emp.Status === 'Active', 'UNAUTHORIZED', 'Your account is inactive. Contact the admin.');
  let mustChange = sess.mustChange;
  if (mustChange === undefined) {
    const cred = Db.findOne('Credentials', 'EmployeeID', emp.EmployeeID);
    mustChange = !!(cred && bool(cred.MustChange));
    sess.mustChange = mustChange;
    cache.put('sess:' + hash, JSON.stringify(sess), LIMITS.SESSION_CACHE_SEC);
  }
  const user = toSessionUser(emp, mustChange);
  user.tokenHash = hash;
  return user;
}

function enforceRateLimit(user) {
  const cache = CacheService.getScriptCache();
  const key = 'rate:' + user.id + ':' + Math.floor(Date.now() / 60000);
  const n = (parseInt(cache.get(key), 10) || 0) + 1;
  cache.put(key, String(n), 120);
  assert(n <= LIMITS.RATE_LIMIT_PER_MIN, 'RATE_LIMITED', 'Too many requests. Please wait a minute and try again.');
}

function apiLogout(p, user) {
  Db.withLock(function () {
    const row = Db.findOne('Sessions', 'TokenHash', user.tokenHash);
    if (row) { row.Revoked = true; Db.update('Sessions', [row]); }
  });
  CacheService.getScriptCache().remove('sess:' + user.tokenHash);
  audit(user, 'LOGOUT', 'Employee', user.id, '', '');
  return { loggedOut: true };
}

function apiMe(p, user) {
  const dept = Db.readAll('Departments').filter(function (d) { return d.DepartmentID === user.departmentId; })[0];
  const u = Object.assign({}, user);
  delete u.tokenHash;
  u.departmentName = dept ? dept.DepartmentName : '';
  return {
    user: u,
    settings: publicSettings(),
    today: todayStr(),
    serverTime: nowIso(),
    departments: Db.readAll('Departments').filter(function (d) { return d.Status === 'Active'; })
      .map(function (d) { return { id: d.DepartmentID, name: d.DepartmentName }; }),
    enums: {
      roles: ROLES, taskStatuses: TASK_STATUSES, openTaskStatuses: OPEN_TASK_STATUSES, priorities: PRIORITIES,
      reviewStatuses: REVIEW_STATUSES, followUpStatuses: FOLLOWUP_STATUSES, relatedTypes: RELATED_TYPES,
      questionTypes: QUESTION_TYPES, sections: QUESTION_SECTIONS, employmentStatuses: EMPLOYMENT_STATUS
    }
  };
}

function apiChangePassword(p, user) {
  const cred = Db.findOne('Credentials', 'EmployeeID', user.id);
  assert(cred, 'NOT_FOUND', 'Account credentials not found. Contact the admin.');
  assert(safeEquals(hashPassword(String(p.currentPassword || ''), cred.Salt), cred.PasswordHash), 'VALIDATION',
    'Current password is incorrect.', { fieldErrors: { currentPassword: 'Current password is incorrect.' } });
  const policy = validatePasswordPolicy(p.newPassword);
  assert(!policy, 'VALIDATION', policy, { fieldErrors: { newPassword: policy } });
  assert(String(p.newPassword) !== String(p.currentPassword), 'VALIDATION', 'Choose a password different from the current one.',
    { fieldErrors: { newPassword: 'Choose a different password.' } });
  Db.withLock(function () {
    const fresh = makeCredential(user.id, cred.Username, String(p.newPassword), false);
    fresh._row = cred._row;
    Db.update('Credentials', [fresh]);
    revokeSessions(user.id, user.tokenHash);
  });
  CacheService.getScriptCache().remove('sess:' + user.tokenHash);
  audit(user, 'PASSWORD_CHANGED', 'Employee', user.id, '', '');
  return { changed: true };
}

/** Revokes all sessions of an employee (optionally keeping one token). Caller holds lock. */
function revokeSessions(employeeId, keepHash) {
  const rows = Db.findBy('Sessions', 'EmployeeID', employeeId)
    .filter(function (r) { return !bool(r.Revoked) && r.TokenHash !== keepHash; });
  rows.forEach(function (r) { r.Revoked = true; });
  Db.update('Sessions', rows);
  const cache = CacheService.getScriptCache();
  rows.forEach(function (r) { cache.remove('sess:' + r.TokenHash); });
}

// ---------------- Permissions ----------------

/**
 * Scope of data a user may access.
 * ADMIN: everything. MANAGER: departments they manage + employees reporting to them (+ self).
 * EMPLOYEE: own records only.
 */
function getScope(user) {
  if (user.role === 'ADMIN') {
    return {
      all: true,
      canEmployee: function () { return true; },
      canDepartment: function () { return true; },
      canReport: function () { return true; }
    };
  }
  if (user.role === 'MANAGER') {
    const depts = {}, emps = {};
    emps[user.id] = true;
    Db.readAll('Departments').forEach(function (d) { if (d.ManagerID === user.id) depts[d.DepartmentID] = true; });
    Db.readAll('Employees').forEach(function (e) { if (e.ManagerID === user.id || depts[e.DepartmentID]) emps[e.EmployeeID] = true; });
    return {
      all: false, departments: depts, employees: emps,
      canEmployee: function (id) { return !!emps[id]; },
      canDepartment: function (id) { return !!depts[id]; },
      canReport: function (r) { return !!emps[r.EmployeeID] || !!depts[r.DepartmentID] || r.ManagerID === user.id; }
    };
  }
  return {
    all: false,
    canEmployee: function (id) { return id === user.id; },
    canDepartment: function () { return false; },
    canReport: function (r) { return r.EmployeeID === user.id; }
  };
}

function isManagerOrAdmin(user) { return user.role === 'ADMIN' || user.role === 'MANAGER'; }
