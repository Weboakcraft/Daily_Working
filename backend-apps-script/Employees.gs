/**
 * Employee Master & Department Master.
 * Employees are never deleted — they are set Inactive so history stays intact.
 */

function publicEmployee(e, deptMap, empMap) {
  if (!e) return null;
  const d = deptMap ? deptMap[e.DepartmentID] : null;
  const m = empMap && e.ManagerID ? empMap[e.ManagerID] : null;
  return {
    employeeId: e.EmployeeID, name: e.EmployeeName, departmentId: e.DepartmentID,
    departmentName: d ? d.DepartmentName : e.DepartmentID, designation: e.Designation, role: e.Role,
    managerId: e.ManagerID, managerName: m ? m.EmployeeName : '', email: e.Email, mobile: e.Mobile,
    joiningDate: e.JoiningDate, employmentStatus: e.EmploymentStatus, username: e.Username, status: e.Status,
    reportRequired: bool(e.ReportRequired), isDemo: bool(e.IsDemo), createdAt: e.CreatedAt, updatedAt: e.UpdatedAt
  };
}

function getEmployeeOrThrow(id) {
  const e = Db.readAll('Employees').filter(function (x) { return x.EmployeeID === id; })[0];
  assert(e, 'NOT_FOUND', 'Employee not found.');
  return e;
}

function getDepartment(id) {
  return Db.readAll('Departments').filter(function (d) { return d.DepartmentID === id; })[0] || null;
}

// ---------------- Employees API ----------------

function apiGetEmployees(p, user) {
  const scope = getScope(user);
  const f = p.filters || {};
  const deptMap = indexBy(Db.readAll('Departments'), 'DepartmentID');
  const all = Db.readAll('Employees');
  const empMap = indexBy(all, 'EmployeeID');
  let rows = all.filter(function (e) { return scope.canEmployee(e.EmployeeID); });
  if (f.departmentId) rows = rows.filter(function (e) { return e.DepartmentID === f.departmentId; });
  if (f.status) rows = rows.filter(function (e) { return e.Status === f.status; });
  if (f.role) rows = rows.filter(function (e) { return e.Role === f.role; });
  if (f.search) rows = rows.filter(function (e) { return textMatch([e.EmployeeName, e.EmployeeID, e.Username, e.Email, e.Designation, e.Mobile], f.search); });
  const sortKey = { name: 'EmployeeName', id: 'EmployeeID', department: 'DepartmentID', joiningDate: 'JoiningDate', status: 'Status', role: 'Role' }[p.sort] || 'EmployeeName';
  const dir = p.dir === 'desc' ? -1 : 1;
  rows.sort(function (a, b) { return String(a[sortKey]).localeCompare(String(b[sortKey])) * dir; });
  const pg = paginate(rows, p.page, p.pageSize);
  pg.items = pg.items.map(function (e) { return publicEmployee(e, deptMap, empMap); });
  pg.counts = {
    active: rows.filter(function (e) { return e.Status === 'Active'; }).length,
    inactive: rows.filter(function (e) { return e.Status !== 'Active'; }).length
  };
  return pg;
}

/** Lightweight list of active employees (for owner / manager pickers). */
function apiGetEmployeeDirectory(p, user) {
  const deptMap = indexBy(Db.readAll('Departments'), 'DepartmentID');
  const scope = getScope(user);
  return Db.readAll('Employees')
    .filter(function (e) { return e.Status === 'Active' || p.includeInactive; })
    .map(function (e) {
      return {
        employeeId: e.EmployeeID, name: e.EmployeeName, role: e.Role, departmentId: e.DepartmentID,
        departmentName: deptMap[e.DepartmentID] ? deptMap[e.DepartmentID].DepartmentName : '',
        inScope: scope.canEmployee(e.EmployeeID), status: e.Status
      };
    })
    .sort(function (a, b) { return a.name.localeCompare(b.name); });
}

function apiGetEmployee(p, user) {
  const id = cleanText(p.employeeId, 40) || user.id;
  assert(getScope(user).canEmployee(id), 'FORBIDDEN', 'You do not have access to this employee.');
  const e = getEmployeeOrThrow(id);
  const all = Db.readAll('Employees');
  return publicEmployee(e, indexBy(Db.readAll('Departments'), 'DepartmentID'), indexBy(all, 'EmployeeID'));
}

/** Validates and normalises employee input. Returns a partial Employees row. */
function validateEmployeeInput(input, existing) {
  const errors = {};
  const all = Db.readAll('Employees');
  const out = {
    EmployeeName: cleanText(input.name, 100),
    DepartmentID: cleanText(input.departmentId, 40),
    Designation: cleanText(input.designation, 80),
    Role: cleanText(input.role, 20).toUpperCase() || 'EMPLOYEE',
    ManagerID: cleanText(input.managerId, 40),
    Email: cleanText(input.email, 120).toLowerCase(),
    Mobile: cleanText(input.mobile, 20).replace(/[\s-]/g, ''),
    JoiningDate: cleanText(input.joiningDate, 10),
    EmploymentStatus: cleanText(input.employmentStatus, 30) || 'Full-time',
    Username: cleanText(input.username, 40).toLowerCase(),
    ReportRequired: input.reportRequired === undefined ? true : bool(input.reportRequired)
  };
  if (!out.EmployeeName) errors.name = 'Employee name is required.';
  const dept = getDepartment(out.DepartmentID);
  if (!dept) errors.departmentId = 'Choose a department.';
  else if (dept.Status !== 'Active' && (!existing || existing.DepartmentID !== out.DepartmentID)) errors.departmentId = 'This department is inactive.';
  if (ROLES.indexOf(out.Role) < 0) errors.role = 'Choose a valid role.';
  if (out.ManagerID) {
    const mgr = all.filter(function (e) { return e.EmployeeID === out.ManagerID; })[0];
    if (!mgr) errors.managerId = 'Reporting manager not found.';
    else if (existing && mgr.EmployeeID === existing.EmployeeID) errors.managerId = 'An employee cannot report to themselves.';
  }
  if (out.Email && !isEmail(out.Email)) errors.email = 'Enter a valid email address.';
  if (out.Mobile && !/^\+?\d{10,15}$/.test(out.Mobile)) errors.mobile = 'Enter a valid mobile number (10–15 digits).';
  if (out.JoiningDate && !isValidDateStr(out.JoiningDate)) errors.joiningDate = 'Enter a valid date.';
  if (EMPLOYMENT_STATUS.indexOf(out.EmploymentStatus) < 0) errors.employmentStatus = 'Choose a valid employment status.';
  if (!/^[a-z0-9._-]{3,40}$/.test(out.Username)) errors.username = 'Username must be 3–40 characters: letters, numbers, dot, dash or underscore.';
  else if (all.some(function (e) { return e.Username.toLowerCase() === out.Username && (!existing || e.EmployeeID !== existing.EmployeeID); })) errors.username = 'This username is already taken.';
  if (out.Email && all.some(function (e) { return e.Email && e.Email.toLowerCase() === out.Email && (!existing || e.EmployeeID !== existing.EmployeeID); })) errors.email = 'Another employee already uses this email.';
  if (Object.keys(errors).length) throw appError('VALIDATION', 'Please correct the highlighted fields.', { fieldErrors: errors });
  return out;
}

function nextEmployeeId(all) {
  let max = 0;
  all.forEach(function (e) { const m = /^EMP-?(\d+)$/.exec(e.EmployeeID); if (m) max = Math.max(max, parseInt(m[1], 10)); });
  return 'EMP-' + ('0000' + (max + 1)).slice(-4);
}

function apiSaveEmployee(p, user) {
  const input = p.employee || {};
  if (input.employeeId) return apiUpdateEmployee(p, user);
  const pw = String(p.password || '');
  const policy = validatePasswordPolicy(pw);
  const data = validateEmployeeInput(input, null);
  assert(!policy, 'VALIDATION', policy, { fieldErrors: { password: policy } });
  const created = Db.withLock(function () {
    const all = Db.readAll('Employees');
    const now = nowIso();
    const row = Object.assign({ EmployeeID: nextEmployeeId(all), Status: 'Active', IsDemo: false, CreatedAt: now, UpdatedAt: now }, data);
    Db.insert('Employees', [row]);
    Db.insert('Credentials', [makeCredential(row.EmployeeID, row.Username, pw, true)]);
    return row;
  });
  audit(user, 'EMPLOYEE_CREATED', 'Employee', created.EmployeeID, '', publicEmployee(created));
  return publicEmployee(created, indexBy(Db.readAll('Departments'), 'DepartmentID'), indexBy(Db.readAll('Employees'), 'EmployeeID'));
}

function apiUpdateEmployee(p, user) {
  const input = p.employee || {};
  const existing = getEmployeeOrThrow(cleanText(input.employeeId, 40));
  const data = validateEmployeeInput(input, existing);
  if (existing.EmployeeID === user.id) {
    assert(data.Role === 'ADMIN', 'VALIDATION', 'You cannot remove your own admin role.', { fieldErrors: { role: 'You cannot remove your own admin role.' } });
  }
  const before = publicEmployee(existing);
  const oldDeptId = existing.DepartmentID;
  const oldUsername = existing.Username;
  const updated = Db.withLock(function () {
    const row = getEmployeeOrThrow(existing.EmployeeID);
    Object.assign(row, data, { UpdatedAt: nowIso() });
    Db.update('Employees', [row]);
    if (oldUsername !== data.Username) {
      const cred = Db.findOne('Credentials', 'EmployeeID', row.EmployeeID);
      if (cred) { cred.Username = data.Username; Db.update('Credentials', [cred]); }
    }
    return row;
  });
  audit(user, 'EMPLOYEE_UPDATED', 'Employee', updated.EmployeeID, before, publicEmployee(updated));
  if (oldDeptId !== data.DepartmentID) {
    audit(user, 'EMPLOYEE_DEPARTMENT_CHANGED', 'Employee', updated.EmployeeID, { departmentId: oldDeptId }, { departmentId: data.DepartmentID });
  }
  return publicEmployee(updated, indexBy(Db.readAll('Departments'), 'DepartmentID'), indexBy(Db.readAll('Employees'), 'EmployeeID'));
}

function apiSetEmployeeStatus(p, user) {
  const status = p.status === 'Active' ? 'Active' : (p.status === 'Inactive' ? 'Inactive' : '');
  assert(status, 'VALIDATION', 'Status must be Active or Inactive.');
  const id = cleanText(p.employeeId, 40);
  assert(id !== user.id || status === 'Active', 'VALIDATION', 'You cannot deactivate your own account.');
  const row = Db.withLock(function () {
    const e = getEmployeeOrThrow(id);
    if (status === 'Active') {
      const dept = getDepartment(e.DepartmentID);
      assert(dept && dept.Status === 'Active', 'VALIDATION', 'Move this employee to an active department before reactivating.');
    }
    const old = e.Status;
    e.Status = status;
    e.UpdatedAt = nowIso();
    Db.update('Employees', [e]);
    if (status === 'Inactive') revokeSessions(e.EmployeeID);
    e._old = old;
    return e;
  });
  audit(user, status === 'Active' ? 'EMPLOYEE_REACTIVATED' : 'EMPLOYEE_DISABLED', 'Employee', id, { status: row._old }, { status: status });
  return { employeeId: id, status: status };
}

function apiResetPassword(p, user) {
  const id = cleanText(p.employeeId, 40);
  const policy = validatePasswordPolicy(p.newPassword);
  assert(!policy, 'VALIDATION', policy, { fieldErrors: { newPassword: policy } });
  Db.withLock(function () {
    const e = getEmployeeOrThrow(id);
    const cred = Db.findOne('Credentials', 'EmployeeID', id);
    const fresh = makeCredential(id, e.Username, String(p.newPassword), true);
    if (cred) { fresh._row = cred._row; Db.update('Credentials', [fresh]); } else Db.insert('Credentials', [fresh]);
    revokeSessions(id);
  });
  audit(user, 'PASSWORD_RESET', 'Employee', id, '', { mustChange: true });
  return { reset: true };
}

/** Bulk import. rows: [{name, department (name or ID), designation, role, managerUsername, email, mobile, joiningDate, username, password}] */
function apiImportEmployees(p, user) {
  const input = Array.isArray(p.rows) ? p.rows.slice(0, 500) : [];
  assert(input.length, 'VALIDATION', 'The import file has no rows.');
  const depts = Db.readAll('Departments');
  const results = [];
  Db.withLock(function () {
    input.forEach(function (r, i) {
      try {
        const deptKey = cleanText(r.department || r.departmentId, 60).toUpperCase();
        const dept = depts.filter(function (d) { return d.DepartmentID.toUpperCase() === deptKey || d.DepartmentName.toUpperCase() === deptKey; })[0];
        const all = Db.readAll('Employees');
        const mgrKey = cleanText(r.managerUsername || r.managerId, 60).toLowerCase();
        const mgr = mgrKey ? all.filter(function (e) { return e.Username.toLowerCase() === mgrKey || e.EmployeeID.toLowerCase() === mgrKey; })[0] : null;
        const data = validateEmployeeInput({
          name: r.name, departmentId: dept ? dept.DepartmentID : '', designation: r.designation, role: r.role || 'EMPLOYEE',
          managerId: mgr ? mgr.EmployeeID : '', email: r.email, mobile: r.mobile, joiningDate: r.joiningDate,
          employmentStatus: r.employmentStatus, username: r.username, reportRequired: r.reportRequired === undefined || r.reportRequired === '' ? true : r.reportRequired
        }, null);
        if (mgrKey && !mgr) throw appError('VALIDATION', 'Manager "' + mgrKey + '" not found.');
        let pw = String(r.password || '');
        let generated = false;
        if (!pw) { pw = 'Oak' + Utilities.getUuid().replace(/-/g, '').slice(0, 7) + '9'; generated = true; }
        const policy = validatePasswordPolicy(pw);
        if (policy) throw appError('VALIDATION', policy);
        const now = nowIso();
        const row = Object.assign({ EmployeeID: nextEmployeeId(all), Status: 'Active', IsDemo: false, CreatedAt: now, UpdatedAt: now }, data);
        Db.insert('Employees', [row]);
        Db.insert('Credentials', [makeCredential(row.EmployeeID, row.Username, pw, true)]);
        audit(user, 'EMPLOYEE_CREATED', 'Employee', row.EmployeeID, '', { import: true, name: row.EmployeeName });
        results.push({ row: i + 1, ok: true, employeeId: row.EmployeeID, username: row.Username, temporaryPassword: generated ? pw : '' });
      } catch (err) {
        const fe = err.details && err.details.fieldErrors;
        results.push({ row: i + 1, ok: false, error: fe ? Object.keys(fe).map(function (k) { return fe[k]; }).join(' ') : err.message });
      }
    });
  });
  return { results: results, imported: results.filter(function (r) { return r.ok; }).length, failed: results.filter(function (r) { return !r.ok; }).length };
}

// ---------------- Departments API ----------------

function apiGetDepartments(p, user) {
  const emps = Db.readAll('Employees');
  const empMap = indexBy(emps, 'EmployeeID');
  const includeInactive = p.includeInactive && user.role === 'ADMIN';
  return Db.readAll('Departments')
    .filter(function (d) { return includeInactive || d.Status === 'Active'; })
    .map(function (d) {
      const members = emps.filter(function (e) { return e.DepartmentID === d.DepartmentID && e.Status === 'Active'; });
      return {
        departmentId: d.DepartmentID, name: d.DepartmentName, managerId: d.ManagerID,
        managerName: empMap[d.ManagerID] ? empMap[d.ManagerID].EmployeeName : '', status: d.Status,
        description: d.Description, employeeCount: members.length, createdAt: d.CreatedAt, updatedAt: d.UpdatedAt
      };
    })
    .sort(function (a, b) { return a.name.localeCompare(b.name); });
}

function apiSaveDepartment(p, user) {
  const input = p.department || {};
  const name = cleanText(input.name, 60).toUpperCase();
  const managerId = cleanText(input.managerId, 40);
  const status = input.status === 'Inactive' ? 'Inactive' : 'Active';
  const errors = {};
  if (!name) errors.name = 'Department name is required.';
  if (managerId) {
    const m = Db.readAll('Employees').filter(function (e) { return e.EmployeeID === managerId; })[0];
    if (!m) errors.managerId = 'Manager not found.';
    else if (m.Role === 'EMPLOYEE') errors.managerId = 'Give this person the MANAGER or ADMIN role first.';
  }
  const all = Db.readAll('Departments');
  const existing = input.departmentId ? all.filter(function (d) { return d.DepartmentID === input.departmentId; })[0] : null;
  if (input.departmentId && !existing) throw appError('NOT_FOUND', 'Department not found.');
  if (all.some(function (d) { return d.DepartmentName.toUpperCase() === name && (!existing || d.DepartmentID !== existing.DepartmentID); })) errors.name = 'A department with this name already exists.';
  if (existing && status === 'Inactive' && existing.Status === 'Active') {
    const active = Db.readAll('Employees').filter(function (e) { return e.DepartmentID === existing.DepartmentID && e.Status === 'Active'; }).length;
    if (active) errors.status = 'Move or deactivate its ' + active + ' active employee(s) first.';
  }
  if (Object.keys(errors).length) throw appError('VALIDATION', 'Please correct the highlighted fields.', { fieldErrors: errors });

  const result = Db.withLock(function () {
    const now = nowIso();
    if (existing) {
      const before = Object.assign({}, existing);
      Object.assign(existing, { DepartmentName: name, ManagerID: managerId, Status: status, Description: cleanText(input.description, 300), UpdatedAt: now });
      Db.update('Departments', [existing]);
      return { row: existing, before: before, created: false };
    }
    let id = 'DEPT-' + name.replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 20);
    if (all.some(function (d) { return d.DepartmentID === id; })) id += '-' + Utilities.getUuid().slice(0, 4).toUpperCase();
    const row = { DepartmentID: id, DepartmentName: name, ManagerID: managerId, Status: status, Description: cleanText(input.description, 300), CreatedAt: now, UpdatedAt: now };
    Db.insert('Departments', [row]);
    return { row: row, before: '', created: true };
  });
  audit(user, result.created ? 'DEPARTMENT_CREATED' : 'DEPARTMENT_UPDATED', 'Department', result.row.DepartmentID, result.before, result.row);
  return { departmentId: result.row.DepartmentID, name: result.row.DepartmentName, status: result.row.Status };
}
