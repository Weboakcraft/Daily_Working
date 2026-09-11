/**
 * Task queries & carry-forward actions, plus Follow-up tracking.
 */

function apiGetTasks(p, user) {
  const f = p.filters || {};
  const to = validDateOr(f.to, todayStr());
  const from = validDateOr(f.from, addDays(to, -30));
  assert(from <= to, 'VALIDATION', 'Start date must be on or before the end date.');
  assert(daysBetween(from, to) <= LIMITS.RANGE_MAX_DAYS, 'VALIDATION', 'Choose a date range of up to ' + LIMITS.RANGE_MAX_DAYS + ' days.');
  const scope = getScope(user);
  const emps = indexBy(Db.readAll('Employees'), 'EmployeeID');
  const depts = indexBy(Db.readAll('Departments'), 'DepartmentID');
  let rows = Db.rangeBy('Tasks', 'ReportDate', from, to).filter(function (t) {
    return !bool(t.Deleted) && scope.canReport({ EmployeeID: t.EmployeeID, DepartmentID: t.DepartmentID });
  });
  if (user.role === 'EMPLOYEE' || f.mine === true) rows = rows.filter(function (t) { return t.EmployeeID === user.id; });
  if (f.employeeId) rows = rows.filter(function (t) { return t.EmployeeID === f.employeeId; });
  if (f.departmentId) rows = rows.filter(function (t) { return t.DepartmentID === f.departmentId; });
  if (f.status) rows = rows.filter(function (t) { return t.Status === f.status; });
  if (f.priority) rows = rows.filter(function (t) { return t.Priority === f.priority; });
  if (f.category) rows = rows.filter(function (t) { return t.Category === f.category; });
  if (f.openOnly === true || f.openOnly === 'true') rows = rows.filter(function (t) { return OPEN_TASK_STATUSES.indexOf(t.Status) >= 0 && !t.CarriedToTaskID; });
  if (f.search) rows = rows.filter(function (t) { return textMatch([t.TaskTitle, t.Description, t.RelatedEntity, t.TaskID, t.Remarks, emps[t.EmployeeID] && emps[t.EmployeeID].EmployeeName], f.search); });
  rows.sort(function (a, b) { return (a.ReportDate < b.ReportDate ? 1 : (a.ReportDate > b.ReportDate ? -1 : 0)) || (num(a.DisplayOrder) - num(b.DisplayOrder)); });
  const counts = {};
  TASK_STATUSES.forEach(function (st) { counts[st] = 0; });
  rows.forEach(function (t) { counts[t.Status] = (counts[t.Status] || 0) + 1; });
  const pg = paginate(rows, p.page, p.pageSize);
  pg.items = pg.items.map(function (t) {
    const o = publicTask(t);
    o.employeeName = emps[t.EmployeeID] ? emps[t.EmployeeID].EmployeeName : t.EmployeeID;
    o.departmentName = depts[t.DepartmentID] ? depts[t.DepartmentID].DepartmentName : t.DepartmentID;
    return o;
  });
  pg.counts = counts;
  return pg;
}

/** Adds or edits one task in the caller's own editable report (creates a draft if needed). */
function apiSaveTask(p, user) {
  const state = apiGetTodayReport({ date: p.date }, user);
  assert(state.canEdit, 'REPORT_LOCKED', state.lockedReason || 'This report cannot be edited.');
  const tasks = state.tasks.map(function (t) {
    return {
      taskId: t.taskId, sourceTaskId: t.sourceTaskId, title: t.title, description: t.description, category: t.category,
      startTime: t.startTime, endTime: t.endTime, duration: t.duration, priority: t.priority, status: t.status,
      relatedType: t.relatedType, relatedEntity: t.relatedEntity, remarks: t.remarks
    };
  });
  const input = p.task || {};
  if (input.taskId) {
    const idx = tasks.map(function (t) { return t.taskId; }).indexOf(input.taskId);
    assert(idx >= 0, 'NOT_FOUND', 'Task not found in this report.');
    tasks[idx] = Object.assign(tasks[idx], input);
  } else {
    tasks.push(input);
  }
  const res = saveReportInternal(user, { date: state.date, responses: state.responses, tasks: tasks }, false);
  audit(user, input.taskId ? 'TASK_UPDATED' : 'TASK_ADDED', 'Task', input.taskId || '', '', { title: cleanText(input.title, 200), date: state.date });
  return res;
}

/**
 * Updates the status of an earlier, still-open task (carry-forward "Complete", "Cancel", "Update status").
 * Tasks inside an editable report must be changed through the report form instead.
 */
function apiUpdateTask(p, user) {
  const status = String(p.status || '');
  assert(TASK_STATUSES.indexOf(status) >= 0, 'VALIDATION', 'Choose a valid task status.');
  const remarks = cleanText(p.remarks, 1000);
  const out = Db.withLock(function () {
    const t = Db.findOne('Tasks', 'TaskID', cleanText(p.taskId, 40));
    assert(t && !bool(t.Deleted), 'NOT_FOUND', 'Task not found.');
    assert(t.EmployeeID === user.id || user.role === 'ADMIN', 'FORBIDDEN', 'You can only update your own tasks.');
    const report = Db.findOne('Reports', 'ReportID', t.ReportID);
    if (report && !isSubmittedStatus(report.Status) && report.ReportDate === todayStr()) {
      throw appError('VALIDATION', 'Update this task in today\'s report form.');
    }
    assert(!t.CarriedToTaskID, 'VALIDATION', 'This task was already carried into a later report.');
    const before = { status: t.Status, remarks: t.Remarks };
    t.Status = status;
    if (remarks) t.Remarks = remarks;
    t.UpdatedAt = nowIso();
    Db.update('Tasks', [t]);
    if (report) {
      const siblings = Db.findBy('Tasks', 'ReportID', report.ReportID);
      applyAggregates(report, siblings);
      report.UpdatedAt = nowIso();
      Db.update('Reports', [report]);
    }
    return { task: t, before: before };
  });
  audit(user, 'TASK_STATUS_CHANGED', 'Task', out.task.TaskID, out.before, { status: status, remarks: remarks });
  return publicTask(out.task);
}

// ---------------- Follow-ups ----------------

function publicFollowUp(f, emps) {
  const name = function (id) { return emps && emps[id] ? emps[id].EmployeeName : (id || ''); };
  const today = todayStr();
  return {
    followUpId: f.FollowUpID, reportId: f.ReportID, taskId: f.TaskID, employeeId: f.EmployeeID, employeeName: name(f.EmployeeID),
    departmentId: f.DepartmentID, ownerId: f.OwnerID, ownerName: name(f.OwnerID), title: f.Title, description: f.Description,
    priority: f.Priority, dueDate: f.DueDate, status: f.Status, source: f.Source, resolution: f.Resolution,
    createdBy: f.CreatedBy, createdByName: name(f.CreatedBy), createdAt: f.CreatedAt, updatedAt: f.UpdatedAt, resolvedAt: f.ResolvedAt,
    overdue: (f.Status === 'OPEN' || f.Status === 'IN PROGRESS') && !!f.DueDate && f.DueDate < today
  };
}

function canSeeFollowUp(user, scope, f) {
  return scope.all || f.OwnerID === user.id || f.EmployeeID === user.id || (user.role === 'MANAGER' && f.CreatedBy === user.id) ||
    (user.role === 'MANAGER' && scope.canReport({ EmployeeID: f.EmployeeID, DepartmentID: f.DepartmentID }));
}

function apiGetFollowUps(p, user) {
  const f = p.filters || {};
  const scope = getScope(user);
  const emps = indexBy(Db.readAll('Employees'), 'EmployeeID');
  const depts = indexBy(Db.readAll('Departments'), 'DepartmentID');
  let rows = Db.readAll('FollowUps').filter(function (x) { return canSeeFollowUp(user, scope, x); });
  if (f.mine === true || f.mine === 'true') rows = rows.filter(function (x) { return x.OwnerID === user.id; });
  if (f.status === 'ACTIVE') rows = rows.filter(function (x) { return x.Status === 'OPEN' || x.Status === 'IN PROGRESS'; });
  else if (f.status === 'DONE') rows = rows.filter(function (x) { return x.Status === 'RESOLVED' || x.Status === 'CLOSED'; });
  else if (f.status) rows = rows.filter(function (x) { return x.Status === f.status; });
  if (f.priority) rows = rows.filter(function (x) { return x.Priority === f.priority; });
  if (f.ownerId) rows = rows.filter(function (x) { return x.OwnerID === f.ownerId; });
  if (f.departmentId) rows = rows.filter(function (x) { return x.DepartmentID === f.departmentId; });
  if (f.employeeId) rows = rows.filter(function (x) { return x.EmployeeID === f.employeeId; });
  if (f.reportId) rows = rows.filter(function (x) { return x.ReportID === f.reportId; });
  let items = rows.map(function (x) { const o = publicFollowUp(x, emps); o.departmentName = depts[x.DepartmentID] ? depts[x.DepartmentID].DepartmentName : ''; return o; });
  if (f.overdue === true || f.overdue === 'true') items = items.filter(function (x) { return x.overdue; });
  if (f.search) items = items.filter(function (x) { return textMatch([x.title, x.description, x.employeeName, x.ownerName, x.followUpId, x.reportId], f.search); });
  const pr = { URGENT: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
  const st = { OPEN: 0, 'IN PROGRESS': 1, RESOLVED: 2, CLOSED: 3 };
  items.sort(function (a, b) {
    return (st[a.status] - st[b.status]) || (pr[a.priority] - pr[b.priority]) || String(a.dueDate || '9999').localeCompare(String(b.dueDate || '9999'));
  });
  const counts = { OPEN: 0, 'IN PROGRESS': 0, RESOLVED: 0, CLOSED: 0, overdue: 0 };
  items.forEach(function (x) { counts[x.status]++; if (x.overdue) counts.overdue++; });
  const pg = paginate(items, p.page, p.pageSize);
  pg.counts = counts;
  return pg;
}

function apiSaveFollowUp(p, user) {
  const input = p.followUp || {};
  const scope = getScope(user);
  const errors = {};
  const emps = Db.readAll('Employees');
  const empMap = indexBy(emps, 'EmployeeID');
  const existing = input.followUpId ? Db.readAll('FollowUps').filter(function (x) { return x.FollowUpID === input.followUpId; })[0] : null;
  if (input.followUpId) assert(existing, 'NOT_FOUND', 'Follow-up not found.');
  // Managers/admins with scope may edit everything; the owner may only change status and resolution.
  const mgmt = user.role === 'ADMIN' || (user.role === 'MANAGER' && (!existing ||
    existing.CreatedBy === user.id || scope.canReport({ EmployeeID: existing.EmployeeID, DepartmentID: existing.DepartmentID })));
  if (existing) {
    assert(mgmt || existing.OwnerID === user.id, 'FORBIDDEN', 'Only the owner or a manager can update this follow-up.');
  } else {
    assert(mgmt, 'FORBIDDEN', 'Only managers and admins can create follow-ups.');
  }

  const status = FOLLOWUP_STATUSES.indexOf(input.status) >= 0 ? input.status : (existing ? existing.Status : 'OPEN');
  const next = {
    Title: cleanText(input.title !== undefined ? input.title : existing && existing.Title, 200),
    Description: cleanText(input.description !== undefined ? input.description : existing && existing.Description, 2000),
    Priority: PRIORITIES.indexOf(input.priority) >= 0 ? input.priority : (existing ? existing.Priority : 'MEDIUM'),
    DueDate: input.dueDate !== undefined ? cleanText(input.dueDate, 10) : (existing ? existing.DueDate : ''),
    OwnerID: input.ownerId !== undefined ? cleanText(input.ownerId, 40) : (existing ? existing.OwnerID : ''),
    Status: status,
    Resolution: cleanText(input.resolution !== undefined ? input.resolution : existing && existing.Resolution, 2000)
  };
  if (!next.Title) errors.title = 'Enter a title.';
  if (next.DueDate && !isValidDateStr(next.DueDate)) errors.dueDate = 'Enter a valid date.';
  if (next.OwnerID && !(empMap[next.OwnerID] && empMap[next.OwnerID].Status === 'Active')) errors.ownerId = 'Choose an active employee.';
  if ((status === 'RESOLVED' || status === 'CLOSED') && !next.Resolution) errors.resolution = 'Describe how this was resolved.';

  let report = null;
  const reportId = cleanText(input.reportId, 40);
  if (!existing && reportId) {
    report = Db.findOne('Reports', 'ReportID', reportId);
    if (!report) errors.reportId = 'Report not found.';
    else if (!scope.canReport(report)) errors.reportId = 'You do not have access to this report.';
  }
  const employeeId = cleanText(input.employeeId, 40);
  if (!existing && !report && employeeId && !(empMap[employeeId] && scope.canEmployee(employeeId))) errors.employeeId = 'Choose an employee in your team.';
  const departmentId = cleanText(input.departmentId, 40);
  if (!existing && !report && !employeeId && departmentId && !(getDepartment(departmentId) && (scope.all || scope.canDepartment(departmentId)))) errors.departmentId = 'Choose a department you manage.';
  if (Object.keys(errors).length) throw appError('VALIDATION', 'Please correct the highlighted fields.', { fieldErrors: errors });

  const now = nowIso();
  const result = Db.withLock(function () {
    if (existing) {
      const row = Db.readAll('FollowUps').filter(function (x) { return x.FollowUpID === existing.FollowUpID; })[0];
      const before = publicFollowUp(row);
      const ownerOnly = !mgmt;
      if (ownerOnly) { row.Status = next.Status; row.Resolution = next.Resolution; }
      else Object.assign(row, next);
      if ((row.Status === 'RESOLVED' || row.Status === 'CLOSED') && !row.ResolvedAt) row.ResolvedAt = now;
      if (row.Status === 'OPEN' || row.Status === 'IN PROGRESS') row.ResolvedAt = '';
      row.UpdatedAt = now;
      Db.update('FollowUps', [row]);
      return { row: row, before: before, created: false, ownerChanged: before.ownerId !== row.OwnerID };
    }
    const emp = report ? empMap[report.EmployeeID] : empMap[employeeId];
    const row = Object.assign({
      FollowUpID: newId('FUP'), ReportID: report ? report.ReportID : '', TaskID: cleanText(input.taskId, 40),
      EmployeeID: emp ? emp.EmployeeID : '', DepartmentID: report ? report.DepartmentID : (emp ? emp.DepartmentID : departmentId),
      Source: 'MANUAL', CreatedBy: user.id, IsDemo: false, CreatedAt: now, UpdatedAt: now, ResolvedAt: ''
    }, next);
    if (row.Status === 'RESOLVED' || row.Status === 'CLOSED') row.ResolvedAt = now;
    Db.insert('FollowUps', [row]);
    return { row: row, before: '', created: true, ownerChanged: !!row.OwnerID };
  });
  audit(user, result.created ? 'FOLLOWUP_CREATED' : 'FOLLOWUP_UPDATED', 'FollowUp', result.row.FollowUpID, result.before, publicFollowUp(result.row));
  if (result.ownerChanged && result.row.OwnerID && result.row.OwnerID !== user.id) {
    safeNotify(function () { Notify.dispatch('FOLLOWUP_ASSIGNED', { followUp: result.row }); });
  }
  return publicFollowUp(result.row, empMap);
}
