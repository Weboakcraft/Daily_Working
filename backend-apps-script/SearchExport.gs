/**
 * Global search and data exports. Both reuse the same permission scope as the rest of the API.
 */

function apiSearch(p, user) {
  const q = cleanText(p.q, 80);
  if (q.length < 2) return { employees: [], reports: [], tasks: [], followUps: [] };
  const scope = getScope(user);
  const emps = Db.readAll('Employees');
  const empMap = indexBy(emps, 'EmployeeID');
  const depts = indexBy(Db.readAll('Departments'), 'DepartmentID');
  const deptName = function (id) { return depts[id] ? depts[id].DepartmentName : id; };
  const name = function (id) { return empMap[id] ? empMap[id].EmployeeName : id; };

  const employees = user.role === 'EMPLOYEE' ? [] : emps.filter(function (e) {
    return scope.canEmployee(e.EmployeeID) && textMatch([e.EmployeeName, e.EmployeeID, e.Username, deptName(e.DepartmentID), e.Designation], q);
  }).slice(0, 6).map(function (e) { return { employeeId: e.EmployeeID, name: e.EmployeeName, department: deptName(e.DepartmentID), status: e.Status }; });

  const to = todayStr(), from = addDays(to, -120);
  let reports = [];
  if (/^RPT-/i.test(q)) {
    const r = Db.findOne('Reports', 'ReportID', q.toUpperCase());
    if (r && scope.canReport(r)) reports = [r];
  } else {
    const matchedEmp = {};
    emps.forEach(function (e) { if (textMatch([e.EmployeeName, e.EmployeeID], q)) matchedEmp[e.EmployeeID] = true; });
    const matchedDept = {};
    Object.keys(depts).forEach(function (id) { if (textMatch([depts[id].DepartmentName], q)) matchedDept[id] = true; });
    reports = Db.rangeBy('Reports', 'ReportDate', from, to).filter(function (r) {
      return scope.canReport(r) && (matchedEmp[r.EmployeeID] || matchedDept[r.DepartmentID]);
    }).sort(function (a, b) { return a.ReportDate < b.ReportDate ? 1 : -1; });
  }
  reports = reports.slice(0, 6).map(function (r) { return { reportId: r.ReportID, employeeName: name(r.EmployeeID), department: deptName(r.DepartmentID), date: r.ReportDate, status: r.Status }; });

  const tasks = Db.rangeBy('Tasks', 'ReportDate', from, to).filter(function (t) {
    return !bool(t.Deleted) && scope.canReport(t) && textMatch([t.TaskTitle, t.RelatedEntity, t.TaskID, t.Description], q);
  }).sort(function (a, b) { return a.ReportDate < b.ReportDate ? 1 : -1; }).slice(0, 8).map(function (t) {
    return { taskId: t.TaskID, reportId: t.ReportID, title: t.TaskTitle, relatedType: t.RelatedType, relatedEntity: t.RelatedEntity, employeeName: name(t.EmployeeID), date: t.ReportDate, status: t.Status };
  });

  const followUps = Db.readAll('FollowUps').filter(function (f) {
    return canSeeFollowUp(user, scope, f) && textMatch([f.Title, f.Description, f.FollowUpID], q);
  }).slice(0, 5).map(function (f) { return { followUpId: f.FollowUpID, title: f.Title, status: f.Status, priority: f.Priority, reportId: f.ReportID }; });

  return { employees: employees, reports: reports, tasks: tasks, followUps: followUps };
}

/**
 * Export datasets: REPORTS (summary + key answers), TASKS, KPI (one column per KPI question), FOLLOWUPS.
 * Returns { title, columns: [{key,label}], rows: [...] } — the browser builds CSV / Excel / PDF.
 */
function apiExportReport(p, user) {
  const dataset = String(p.dataset || 'REPORTS').toUpperCase();
  const f = Object.assign({}, p.filters || {});
  const scope = getScope(user);
  const emps = indexBy(Db.readAll('Employees'), 'EmployeeID');
  const depts = indexBy(Db.readAll('Departments'), 'DepartmentID');
  const name = function (id) { return emps[id] ? emps[id].EmployeeName : id; };
  const deptName = function (id) { return depts[id] ? depts[id].DepartmentName : id; };
  let out;

  if (dataset === 'REPORTS' || dataset === 'KPI') {
    const q = queryReports(user, f);
    const rows = q.rows.slice(0, LIMITS.EXPORT_MAX_ROWS);
    const ids = indexBy(rows.filter(function (r) { return r.reportId; }), 'reportId');
    const questions = indexBy(Db.readAll('Questions'), 'QuestionID');
    const responses = Db.rangeBy('Responses', 'ReportDate', q.from, q.to).filter(function (x) { return ids[x.ReportID]; });
    const byReport = groupBy(responses, function (x) { return x.ReportID; });
    const base = [
      { key: 'date', label: 'Date' }, { key: 'reportId', label: 'Report ID' }, { key: 'employeeId', label: 'Employee ID' },
      { key: 'employeeName', label: 'Employee' }, { key: 'departmentName', label: 'Department' }, { key: 'status', label: 'Status' },
      { key: 'submittedAt', label: 'Submitted At (UTC)' }, { key: 'late', label: 'Late' }, { key: 'tasks', label: 'Tasks' },
      { key: 'completed', label: 'Completed' }, { key: 'pending', label: 'Pending' }, { key: 'blocked', label: 'Blocked' },
      { key: 'carried', label: 'Carried Forward' }, { key: 'hours', label: 'Reported Hours' }, { key: 'reviewStatus', label: 'Review Status' }
    ];
    if (dataset === 'REPORTS') {
      const keys = [['COMMON_TODAY_WORK', 'Work Summary'], ['COMMON_COMPLETED', 'Completed'], ['COMMON_PENDING', 'Pending Work'],
        ['COMMON_CARRY_FORWARD', 'Carry Forward'], ['COMMON_BLOCKER_DETAIL', 'Blockers'], ['COMMON_FOLLOWUPS', 'Follow-ups'],
        ['COMMON_MEETINGS', 'Meetings / Calls'], ['COMMON_TOMORROW_PLAN', "Tomorrow's Plan"], ['COMMON_NOTES', 'Notes']];
      const cols = base.concat(keys.map(function (k) { return { key: k[0], label: k[1] }; }));
      out = {
        title: 'Daily reports ' + q.from + ' to ' + q.to, columns: cols,
        rows: rows.map(function (r) {
          const o = Object.assign({}, r, { late: r.late ? 'Yes' : 'No', hours: round(r.workMinutes / 60, 2) });
          (byReport[r.reportId] || []).forEach(function (x) { const qq = questions[x.QuestionID]; if (qq && qq.QuestionKey) o[qq.QuestionKey] = x.Answer; });
          return o;
        })
      };
    } else {
      const kpiIds = uniq(responses.filter(function (x) { const qq = questions[x.QuestionID]; return qq && qq.Section === 'KPI'; }).map(function (x) { return x.QuestionID; }));
      kpiIds.sort(function (a, b) { return (questions[a].DepartmentID + num(questions[a].DisplayOrder)).localeCompare(questions[b].DepartmentID + num(questions[b].DisplayOrder)); });
      const cols = base.slice(0, 6).concat(kpiIds.map(function (id) { return { key: 'q_' + id, label: deptName(questions[id].DepartmentID) + ': ' + questions[id].QuestionText }; }));
      out = {
        title: 'Department KPI values ' + q.from + ' to ' + q.to, columns: cols,
        rows: rows.filter(function (r) { return r.reportId; }).map(function (r) {
          const o = Object.assign({}, r);
          (byReport[r.reportId] || []).forEach(function (x) {
            if (kpiIds.indexOf(x.QuestionID) >= 0) o['q_' + x.QuestionID] = decodeAnswer(questions[x.QuestionID], x.Answer);
            if (Array.isArray(o['q_' + x.QuestionID])) o['q_' + x.QuestionID] = o['q_' + x.QuestionID].join(', ');
          });
          return o;
        })
      };
    }
  } else if (dataset === 'TASKS') {
    const res = apiGetTasks({ filters: f, page: 1, pageSize: LIMITS.PAGE_SIZE_MAX }, user);
    const all = [];
    for (let page = 1; page <= res.pages && all.length < LIMITS.EXPORT_MAX_ROWS; page++) {
      const pg = page === 1 ? res : apiGetTasks({ filters: f, page: page, pageSize: LIMITS.PAGE_SIZE_MAX }, user);
      Array.prototype.push.apply(all, pg.items);
    }
    out = {
      title: 'Tasks ' + (f.from || '') + ' to ' + (f.to || ''),
      columns: [{ key: 'reportDate', label: 'Date' }, { key: 'taskId', label: 'Task ID' }, { key: 'reportId', label: 'Report ID' },
        { key: 'employeeName', label: 'Employee' }, { key: 'departmentName', label: 'Department' }, { key: 'title', label: 'Title' },
        { key: 'description', label: 'Description' }, { key: 'category', label: 'Category' }, { key: 'status', label: 'Status' },
        { key: 'priority', label: 'Priority' }, { key: 'startTime', label: 'Start' }, { key: 'endTime', label: 'End' },
        { key: 'duration', label: 'Minutes' }, { key: 'relatedType', label: 'Related Type' }, { key: 'relatedEntity', label: 'Related To' },
        { key: 'carryCount', label: 'Times Carried' }, { key: 'remarks', label: 'Remarks' }],
      rows: all
    };
  } else if (dataset === 'FOLLOWUPS') {
    const rows = Db.readAll('FollowUps').filter(function (x) {
      const d = String(x.CreatedAt).slice(0, 10);
      return canSeeFollowUp(user, scope, x) && (!f.from || d >= f.from) && (!f.to || d <= f.to) &&
        (!f.departmentId || x.DepartmentID === f.departmentId) && (!f.employeeId || x.EmployeeID === f.employeeId);
    }).slice(0, LIMITS.EXPORT_MAX_ROWS).map(function (x) { const o = publicFollowUp(x, emps); o.departmentName = deptName(x.DepartmentID); return o; });
    out = {
      title: 'Follow-ups ' + (f.from || '') + ' to ' + (f.to || ''),
      columns: [{ key: 'followUpId', label: 'Follow-up ID' }, { key: 'createdAt', label: 'Created (UTC)' }, { key: 'title', label: 'Title' },
        { key: 'description', label: 'Description' }, { key: 'employeeName', label: 'Employee' }, { key: 'departmentName', label: 'Department' },
        { key: 'ownerName', label: 'Owner' }, { key: 'priority', label: 'Priority' }, { key: 'dueDate', label: 'Due' }, { key: 'status', label: 'Status' },
        { key: 'source', label: 'Source' }, { key: 'resolution', label: 'Resolution' }, { key: 'reportId', label: 'Report ID' }],
      rows: rows
    };
  } else {
    throw appError('VALIDATION', 'Unknown export dataset.');
  }
  audit(user, 'DATA_EXPORTED', 'Export', dataset, '', { filters: f, rows: out.rows.length });
  out.generatedAt = nowIso();
  out.generatedBy = name(user.id);
  return out;
}
