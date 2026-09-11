/**
 * Analytics: admin/manager dashboard, daily management summary, smart insights,
 * department analytics, employee analytics, employee dashboard and productivity score.
 *
 * Every KPI is derived from stored rows only — no estimates. Definitions are
 * returned alongside the numbers so the UI can explain them.
 */

const KPI_DEFINITIONS = {
  expected: 'Active employees who must report × working days in the period (excludes weekly offs, holidays, and days before joining).',
  submitted: 'Expected reports with status SUBMITTED or LATE.',
  pending: 'Expected reports not yet submitted (NOT STARTED, DRAFT or REOPENED).',
  late: 'Reports first submitted after the deadline plus grace period.',
  completionPct: 'Submitted ÷ Expected × 100.',
  totalTasks: 'Tasks in submitted and draft reports, excluding cancelled tasks.',
  completedTasks: 'Tasks with status COMPLETED.',
  pendingTasks: 'Tasks with status PENDING or IN PROGRESS.',
  blockedTasks: 'Tasks with status BLOCKED.',
  taskCompletionPct: 'Completed tasks ÷ total tasks × 100.'
};

function analyticsRange(p, defaultDays) {
  const to = validDateOr(p.to, todayStr());
  const from = validDateOr(p.from, addDays(to, -(defaultDays || 0)));
  assert(from <= to, 'VALIDATION', 'Start date must be on or before the end date.');
  assert(daysBetween(from, to) <= LIMITS.RANGE_MAX_DAYS, 'VALIDATION', 'Choose a date range of up to ' + LIMITS.RANGE_MAX_DAYS + ' days.');
  return { from: from, to: to };
}

function reportKey(empId, date) { return empId + '|' + date; }

function rollup(pairs, rmap) {
  const o = { expected: pairs.length, submitted: 0, late: 0, draft: 0, notStarted: 0 };
  pairs.forEach(function (pr) {
    const r = rmap[reportKey(pr.emp.EmployeeID, pr.date)];
    const st = r ? r.Status : REPORT_STATUS.NOT_STARTED;
    if (isSubmittedStatus(st)) o.submitted++;
    if (st === REPORT_STATUS.LATE) o.late++;
    if (st === REPORT_STATUS.DRAFT || st === REPORT_STATUS.REOPENED) o.draft++;
    if (!r) o.notStarted++;
  });
  o.pending = o.expected - o.submitted;
  o.completionPct = pct(o.submitted, o.expected);
  return o;
}

function taskRollup(reports) {
  const t = { total: 0, completed: 0, pending: 0, blocked: 0, carried: 0, minutes: 0 };
  reports.forEach(function (r) {
    t.total += num(r.TaskTotal); t.completed += num(r.TaskCompleted); t.pending += num(r.TaskPending);
    t.blocked += num(r.TaskBlocked); t.carried += num(r.TaskCarried); t.minutes += num(r.WorkMinutes);
  });
  t.completionPct = pct(t.completed, t.total);
  return t;
}

function monthList(from, to) {
  const out = [];
  let m = monthStart(from);
  while (m <= to && out.length < 24) { out.push(m.slice(0, 7)); m = monthsBack(m, -1); }
  return out;
}

function minDate() { return Array.prototype.slice.call(arguments).filter(Boolean).sort()[0]; }

// ============================ ADMIN / MANAGER DASHBOARD ============================

function apiGetDashboardData(p, user) { return ocCached_('dash', p, user, apiGetDashboardData_); }
function apiGetDashboardData_(p, user) {
  const s = getSettingsMap();
  const range = analyticsRange(p, 0);
  const from = range.from, to = range.to;
  const today = todayStr();
  const scope = getScope(user);
  const depts = indexBy(Db.readAll('Departments'), 'DepartmentID');
  const allEmps = Db.readAll('Employees');
  const empMap = indexBy(allEmps, 'EmployeeID');
  const name = function (id) { return empMap[id] ? empMap[id].EmployeeName : id; };
  const deptName = function (id) { return depts[id] ? depts[id].DepartmentName : id; };

  let emps = allEmps.filter(function (e) { return scope.canEmployee(e.EmployeeID); });
  if (p.departmentId) emps = emps.filter(function (e) { return e.DepartmentID === p.departmentId; });
  if (p.employeeId) emps = emps.filter(function (e) { return e.EmployeeID === p.employeeId; });
  if (p.managerId) emps = emps.filter(function (e) { return e.ManagerID === p.managerId || (depts[e.DepartmentID] && depts[e.DepartmentID].ManagerID === p.managerId); });
  const empIds = indexBy(emps, 'EmployeeID');

  const monthlyFrom = monthsBack(to, 5);
  const allReports = Db.rangeBy('Reports', 'ReportDate', minDate(from, monthlyFrom), to).filter(function (r) {
    return scope.canReport(r) && (!p.departmentId || r.DepartmentID === p.departmentId) &&
      (!p.employeeId || r.EmployeeID === p.employeeId) && (!p.managerId || empIds[r.EmployeeID] || r.ManagerID === p.managerId);
  });
  const reports = allReports.filter(function (r) { return r.ReportDate >= from; });
  const rmap = {};
  allReports.forEach(function (r) { rmap[reportKey(r.EmployeeID, r.ReportDate)] = r; });

  const pairs = expectedPairs(from, to, emps, s);
  const roll = rollup(pairs, rmap);
  const tasks = taskRollup(reports);

  // 1. Department-wise submission %
  const pairsByDept = groupBy(pairs, function (pr) { return pr.emp.DepartmentID; });
  const deptSubmission = Object.keys(pairsByDept).map(function (id) {
    const r = rollup(pairsByDept[id], rmap);
    return { departmentId: id, name: deptName(id), expected: r.expected, submitted: r.submitted, late: r.late, pending: r.pending, pct: r.completionPct };
  }).sort(function (a, b) { return b.pct - a.pct || a.name.localeCompare(b.name); });

  // 2. Employee-wise submission status (heatmap, last 31 days of range)
  const hmDates = dateRange(from, to).slice(-31);
  const hmEmps = emps.filter(function (e) { return e.Status === 'Active' && bool(e.ReportRequired); })
    .sort(function (a, b) { return deptName(a.DepartmentID).localeCompare(deptName(b.DepartmentID)) || a.EmployeeName.localeCompare(b.EmployeeName); });
  const heatmap = {
    dates: hmDates.map(function (d) { const w = workingDayInfo(d, s); return { date: d, working: w.working, note: w.reason }; }),
    rows: hmEmps.slice(0, 80).map(function (e) {
      return {
        employeeId: e.EmployeeID, name: e.EmployeeName, department: deptName(e.DepartmentID),
        cells: hmDates.map(function (d) {
          if (!workingDayInfo(d, s).working) return 'OFF';
          if ((e.JoiningDate && e.JoiningDate > d) || d > today) return 'NA';
          const r = rmap[reportKey(e.EmployeeID, d)];
          return r ? r.Status : REPORT_STATUS.NOT_STARTED;
        }),
        reportIds: hmDates.map(function (d) { const r = rmap[reportKey(e.EmployeeID, d)]; return r ? r.ReportID : ''; })
      };
    }),
    truncated: hmEmps.length > 80
  };

  // 3 & 7. Daily submission and late trend
  const pairsByDate = groupBy(pairs, function (pr) { return pr.date; });
  const daily = dateRange(from, to).map(function (d) {
    const w = workingDayInfo(d, s);
    const r = rollup(pairsByDate[d] || [], rmap);
    return { date: d, working: w.working, note: w.reason, expected: r.expected, submitted: r.submitted, late: r.late, pct: r.completionPct };
  });

  // 5. Department productivity
  const repByDept = groupBy(reports, function (r) { return r.DepartmentID; });
  const deptProductivity = Object.keys(repByDept).map(function (id) {
    const t = taskRollup(repByDept[id]);
    return {
      departmentId: id, name: deptName(id), total: t.total, completed: t.completed, pending: t.pending, blocked: t.blocked,
      carried: t.carried, completionPct: t.completionPct, avgTasksPerReport: round(t.total / repByDept[id].length, 1), hours: round(t.minutes / 60, 1)
    };
  }).sort(function (a, b) { return b.total - a.total; });

  // 6. Monthly report completion (last 6 months ending at "to")
  const monthlyPairs = groupBy(expectedPairs(monthlyFrom, to, emps, s), function (pr) { return pr.date.slice(0, 7); });
  const monthly = monthList(monthlyFrom, to).map(function (m) {
    const r = rollup(monthlyPairs[m] || [], rmap);
    return { month: m, expected: r.expected, submitted: r.submitted, late: r.late, pct: r.completionPct };
  });

  // 8. Workload distribution
  const repByEmp = groupBy(reports, function (r) { return r.EmployeeID; });
  const workload = Object.keys(repByEmp).map(function (id) {
    const t = taskRollup(repByEmp[id]);
    return {
      employeeId: id, name: name(id), department: deptName(empMap[id] ? empMap[id].DepartmentID : ''), reports: repByEmp[id].length,
      tasks: t.total, completed: t.completed, open: t.pending + t.blocked + t.carried, hours: round(t.minutes / 60, 1)
    };
  }).sort(function (a, b) { return b.tasks - a.tasks; }).slice(0, 15);

  const withTasks = daysBetween(from, to) <= 92;
  const rangeTasks = withTasks ? Db.rangeBy('Tasks', 'ReportDate', from, to).filter(function (t) { return !bool(t.Deleted) && scope.canReport(t) && (!p.departmentId || t.DepartmentID === p.departmentId) && (!p.employeeId || t.EmployeeID === p.employeeId) && (!p.managerId || empIds[t.EmployeeID]); }) : null;
  const rangeResponses = daysBetween(from, to) <= 62 ? Db.rangeBy('Responses', 'ReportDate', from, to) : null;

  const insights = buildInsights({
    s: s, from: from, to: to, pairs: pairs, rmap: rmap, reports: reports, deptSubmission: deptSubmission,
    name: name, deptName: deptName, tasks: rangeTasks, responses: rangeResponses
  });

  const summaryDate = to > today ? today : to;
  const dailySummary = buildDailySummary(summaryDate, {
    s: s, emps: emps, rmap: rmap, reports: allReports.filter(function (r) { return r.ReportDate === summaryDate; }), name: name,
    deptName: deptName, scope: scope, filters: p, empIds: empIds, today: today, allReports: reports
  });

  return {
    range: { from: from, to: to },
    kpis: {
      totalEmployees: emps.filter(function (e) { return e.Status === 'Active'; }).length,
      reportsExpected: roll.expected, reportsSubmitted: roll.submitted, reportsPending: roll.pending, lateReports: roll.late,
      draftReports: roll.draft, completionPct: roll.completionPct, totalTasks: tasks.total, completedTasks: tasks.completed,
      pendingTasks: tasks.pending, blockedTasks: tasks.blocked, carriedTasks: tasks.carried, taskCompletionPct: tasks.completionPct,
      reportedHours: round(tasks.minutes / 60, 1)
    },
    charts: {
      deptSubmission: deptSubmission, heatmap: heatmap, daily: daily,
      taskStatus: { completed: tasks.completed, pending: tasks.pending, blocked: tasks.blocked, carried: tasks.carried },
      deptProductivity: deptProductivity, monthly: monthly, workload: workload
    },
    insights: insights,
    dailySummary: dailySummary,
    definitions: KPI_DEFINITIONS
  };
}

// ============================ SMART INSIGHTS ============================

function buildInsights(ctx) {
  const out = [];
  const add = function (type, severity, title, detail) { out.push({ type: type, severity: severity, title: title, detail: detail }); };

  const ds = ctx.deptSubmission.filter(function (d) { return d.expected >= 3; });
  if (ds.length) {
    const best = ds[0];
    add('DEPT_BEST', 'positive', best.name + ' has the highest report completion',
      best.submitted + ' of ' + best.expected + ' expected reports submitted (' + best.pct + '%).');
    const worst = ds[ds.length - 1];
    if (ds.length > 1 && worst.pct < best.pct) {
      add('DEPT_LOWEST', worst.pct < 70 ? 'warning' : 'info', worst.name + ' has the lowest report completion',
        worst.submitted + ' of ' + worst.expected + ' expected reports submitted (' + worst.pct + '%); ' + worst.pending + ' still pending.');
    }
  }

  const submitted = ctx.reports.filter(function (r) { return isSubmittedStatus(r.Status); });
  const subByEmp = groupBy(submitted, function (r) { return r.EmployeeID; });

  const repeated = Object.keys(subByEmp).map(function (id) {
    const list = subByEmp[id];
    return { id: id, n: list.filter(function (r) { return num(r.TaskPending) + num(r.TaskBlocked) + num(r.TaskCarried) > 0; }).length, total: list.length };
  }).filter(function (x) { return x.n >= 3 && x.n / x.total >= 0.5; }).sort(function (a, b) { return b.n - a.n; }).slice(0, 5);
  if (repeated.length) {
    add('REPEATED_PENDING', 'warning', repeated.length + ' employee(s) repeatedly report unfinished work',
      repeated.map(function (x) { return ctx.name(x.id) + ' — ' + x.n + ' of ' + x.total + ' reports had open tasks'; }).join('; ') + '.');
  }

  const blockerReports = ctx.reports.filter(function (r) { return bool(r.HasBlocker); });
  if (blockerReports.length) {
    const byDept = groupBy(blockerReports, function (r) { return r.DepartmentID; });
    const topDept = Object.keys(byDept).sort(function (a, b) { return byDept[b].length - byDept[a].length; })[0];
    const byEmp = groupBy(blockerReports, function (r) { return r.EmployeeID; });
    const frequent = Object.keys(byEmp).filter(function (id) { return byEmp[id].length >= 2; })
      .sort(function (a, b) { return byEmp[b].length - byEmp[a].length; }).slice(0, 4);
    add('BLOCKERS', blockerReports.length >= 5 ? 'warning' : 'info', blockerReports.length + ' report(s) mentioned a blocker',
      'Most came from ' + ctx.deptName(topDept) + ' (' + byDept[topDept].length + ').' +
      (frequent.length ? ' Reported more than once by ' + frequent.map(function (id) { return ctx.name(id) + ' (' + byEmp[id].length + ')'; }).join(', ') + '.' : ''));
  }

  const days = daysBetween(ctx.from, ctx.to);
  if (days >= 5) {
    const mid = addDays(ctx.from, Math.floor(days / 2));
    const byDept = groupBy(submitted, function (r) { return r.DepartmentID; });
    Object.keys(byDept).forEach(function (id) {
      const first = byDept[id].filter(function (r) { return r.ReportDate <= mid; });
      const second = byDept[id].filter(function (r) { return r.ReportDate > mid; });
      if (first.length < 3 || second.length < 3) return;
      const a = taskRollup(first).total / first.length, b = taskRollup(second).total / second.length;
      if (a > 0 && b / a >= 1.25 && taskRollup(second).total >= 10) {
        add('WORKLOAD_UP', 'info', 'Workload is increasing in ' + ctx.deptName(id),
          'Average tasks per report rose from ' + round(a, 1) + ' to ' + round(b, 1) + ' between the first and second half of the period.');
      }
    });
  }

  const lateList = Object.keys(subByEmp).map(function (id) {
    const late = subByEmp[id].filter(function (r) { return r.Status === REPORT_STATUS.LATE; }).length;
    return { id: id, late: late, total: subByEmp[id].length };
  }).filter(function (x) { return x.late >= 3 || (x.late >= 2 && x.late / x.total >= 0.3); })
    .sort(function (a, b) { return b.late - a.late; }).slice(0, 5);
  if (lateList.length) {
    add('LATE_FREQUENT', 'warning', lateList.length + ' employee(s) often submit late',
      lateList.map(function (x) { return ctx.name(x.id) + ' — ' + x.late + ' of ' + x.total + ' late'; }).join('; ') + '.');
  }

  if (ctx.tasks) {
    const chains = ctx.tasks.filter(function (t) { return num(t.CarryCount) >= 2 && !t.CarriedToTaskID && t.Status !== 'COMPLETED' && t.Status !== 'CANCELLED'; })
      .sort(function (a, b) { return num(b.CarryCount) - num(a.CarryCount); }).slice(0, 5);
    if (chains.length) {
      add('CARRIED_REPEATEDLY', 'warning', chains.length + ' task(s) have been carried forward repeatedly',
        chains.map(function (t) { return '"' + t.TaskTitle + '" (' + ctx.name(t.EmployeeID) + ', carried ' + num(t.CarryCount) + ' times, now ' + t.Status + ')'; }).join('; ') + '.');
    }
  }

  if (ctx.responses && days >= 5) {
    const numericKpi = indexBy(Db.readAll('Questions').filter(function (q) {
      return q.Section === 'KPI' && (q.QuestionType === 'NUMBER' || q.QuestionType === 'DECIMAL');
    }), 'QuestionID');
    const reportIds = indexBy(submitted, 'ReportID');
    const mid = addDays(ctx.from, Math.floor(days / 2));
    const stats = {};
    ctx.responses.forEach(function (x) {
      if (!numericKpi[x.QuestionID] || !reportIds[x.ReportID] || x.Answer === '') return;
      const st = stats[x.QuestionID] = stats[x.QuestionID] || { a: 0, b: 0, na: 0, nb: 0 };
      if (x.ReportDate <= mid) { st.a += num(x.Answer); st.na++; } else { st.b += num(x.Answer); st.nb++; }
    });
    const trends = Object.keys(stats).map(function (qid) {
      const st = stats[qid];
      if (st.na < 3 || st.nb < 3) return null;
      const avgA = st.a / st.na, avgB = st.b / st.nb;
      if (avgA === 0) return null;
      return { q: numericKpi[qid], change: (avgB - avgA) / avgA, avgA: avgA, avgB: avgB };
    }).filter(function (t) { return t && Math.abs(t.change) >= 0.2; })
      .sort(function (a, b) { return Math.abs(b.change) - Math.abs(a.change); }).slice(0, 3);
    trends.forEach(function (t) {
      add('KPI_TREND', t.change > 0 ? 'positive' : 'info',
        ctx.deptName(t.q.DepartmentID) + ': "' + t.q.QuestionText + '" ' + (t.change > 0 ? 'increased' : 'decreased') + ' ' + Math.abs(Math.round(t.change * 100)) + '%',
        'Average per report went from ' + round(t.avgA, 1) + ' to ' + round(t.avgB, 1) + ' between the first and second half of the period.');
    });
  }

  if (!out.length) add('NONE', 'info', 'No notable patterns in this period', 'Insights appear once enough reports are submitted to compare.');
  return out;
}

// ============================ DAILY MANAGEMENT SUMMARY ============================

function buildDailySummary(date, ctx) {
  const s = ctx.s;
  const pairs = expectedPairs(date, date, ctx.emps, s);
  const overview = rollup(pairs, ctx.rmap);
  const byDept = groupBy(pairs, function (pr) { return pr.emp.DepartmentID; });
  const departments = Object.keys(byDept).map(function (id) {
    const r = rollup(byDept[id], ctx.rmap);
    return { departmentId: id, name: ctx.deptName(id), employees: r.expected, submitted: r.submitted, pending: r.pending, late: r.late, pct: r.completionPct };
  }).sort(function (a, b) { return a.name.localeCompare(b.name); });
  const work = taskRollup(ctx.reports);
  const reportIds = indexBy(ctx.reports, 'ReportID');

  const blockedTasks = Db.rangeBy('Tasks', 'ReportDate', date, date).filter(function (t) {
    return reportIds[t.ReportID] && !bool(t.Deleted) && t.Status === 'BLOCKED';
  }).sort(function (a, b) { return PRIORITIES.indexOf(b.Priority) - PRIORITIES.indexOf(a.Priority); }).slice(0, 20).map(function (t) {
    return { taskId: t.TaskID, reportId: t.ReportID, title: t.TaskTitle, employeeName: ctx.name(t.EmployeeID), priority: t.Priority, remarks: t.Remarks || t.Description };
  });

  const detailQ = indexBy(Db.readAll('Questions').filter(function (q) { return q.QuestionKey === 'COMMON_BLOCKER_DETAIL'; }), 'QuestionID');
  const blockerNotes = Db.rangeBy('Responses', 'ReportDate', date, date).filter(function (x) {
    return detailQ[x.QuestionID] && reportIds[x.ReportID] && x.Answer;
  }).slice(0, 20).map(function (x) { return { reportId: x.ReportID, employeeName: ctx.name(x.EmployeeID), text: x.Answer }; });

  const f = ctx.filters || {};
  const activeFollowUps = Db.readAll('FollowUps').filter(function (x) {
    return (x.Status === 'OPEN' || x.Status === 'IN PROGRESS') && ctx.scope.canReport(x) &&
      (!f.departmentId || x.DepartmentID === f.departmentId) && (!f.employeeId || x.EmployeeID === f.employeeId) &&
      (!f.managerId || ctx.empIds[x.EmployeeID] || x.OwnerID === f.managerId);
  });
  const emps = indexBy(Db.readAll('Employees'), 'EmployeeID');
  const urgentFollowUps = activeFollowUps.filter(function (x) { return x.Priority === 'HIGH' || x.Priority === 'URGENT'; })
    .slice(0, 20).map(function (x) { return publicFollowUp(x, emps); });

  const notSubmitted = pairs.filter(function (pr) { const r = ctx.rmap[reportKey(pr.emp.EmployeeID, date)]; return !r || !isSubmittedStatus(r.Status); })
    .map(function (pr) {
      const r = ctx.rmap[reportKey(pr.emp.EmployeeID, date)];
      return { employeeId: pr.emp.EmployeeID, name: pr.emp.EmployeeName, department: ctx.deptName(pr.emp.DepartmentID), status: r ? r.Status : REPORT_STATUS.NOT_STARTED, mobile: pr.emp.Mobile };
    });
  const overdueFollowUps = activeFollowUps.filter(function (x) { return x.DueDate && x.DueDate < ctx.today; })
    .slice(0, 20).map(function (x) { return publicFollowUp(x, emps); });
  const followUpRequired = ctx.allReports.filter(function (r) { return r.ReviewStatus === 'FOLLOW-UP REQUIRED'; }).slice(0, 20)
    .map(function (r) { return { reportId: r.ReportID, employeeName: ctx.name(r.EmployeeID), date: r.ReportDate, remarks: r.ManagerRemarks }; });
  const unreviewedBlockers = ctx.reports.filter(function (r) { return bool(r.HasBlocker) && (r.ReviewStatus || 'NOT REVIEWED') === 'NOT REVIEWED' && isSubmittedStatus(r.Status); })
    .map(function (r) { return { reportId: r.ReportID, employeeName: ctx.name(r.EmployeeID), date: r.ReportDate }; });

  return {
    date: date,
    workingDay: workingDayInfo(date, s),
    deadline: reportDeadline(date, s),
    overview: { expected: overview.expected, submitted: overview.submitted, pending: overview.pending, late: overview.late, draft: overview.draft, completionPct: overview.completionPct },
    departments: departments,
    work: { completed: work.completed, pending: work.pending, blocked: work.blocked, carried: work.carried, total: work.total },
    issues: { blockedTasks: blockedTasks, blockerNotes: blockerNotes, urgentFollowUps: urgentFollowUps },
    attention: { notSubmitted: notSubmitted, overdueFollowUps: overdueFollowUps, followUpRequired: followUpRequired, unreviewedBlockers: unreviewedBlockers }
  };
}

// ============================ EMPLOYEE METRICS & SCORE ============================

/**
 * Metrics for one employee over a period. opts.reports may pass pre-loaded reports.
 * opts.light skips responses/follow-ups (no KPI/planning/blocker components).
 */
function employeeMetrics(emp, from, to, s, opts) {
  opts = opts || {};
  const reports = opts.reports || Db.rangeBy('Reports', 'ReportDate', from, to).filter(function (r) { return r.EmployeeID === emp.EmployeeID; });
  const rmap = {};
  reports.forEach(function (r) { rmap[reportKey(r.EmployeeID, r.ReportDate)] = r; });
  const roll = rollup(expectedPairs(from, to, [emp], s), rmap);
  const submitted = reports.filter(function (r) { return isSubmittedStatus(r.Status); });
  const t = taskRollup(reports);
  const reportCount = reports.length;

  const metrics = {
    expected: roll.expected, submitted: roll.submitted, submittedTotal: submitted.length, pending: roll.pending,
    late: submitted.filter(function (r) { return r.Status === REPORT_STATUS.LATE; }).length, submissionPct: roll.completionPct,
    totalTasks: t.total, completedTasks: t.completed, pendingTasks: t.pending, blockedTasks: t.blocked, carriedTasks: t.carried,
    taskCompletionPct: t.completionPct, avgTasksPerDay: reportCount ? round(t.total / reportCount, 1) : 0,
    avgHoursPerDay: reportCount ? round(t.minutes / 60 / reportCount, 1) : 0, reportedHours: round(t.minutes / 60, 1),
    blockerReports: reports.filter(function (r) { return bool(r.HasBlocker); }).length
  };

  let kpis = [], kpiScore = null, planningScore = null, blockerScore = null, planned = 0, fuTotal = 0, fuResolved = 0;
  if (!opts.light) {
    const allQ = Db.readAll('Questions');
    const planQ = allQ.filter(function (q) { return q.QuestionKey === 'COMMON_TOMORROW_PLAN'; })[0];
    const responses = submitted.length ? Db.rangeBy('Responses', 'ReportDate', from, to).filter(function (x) { return x.EmployeeID === emp.EmployeeID; }) : [];
    const byReport = groupBy(responses, function (x) { return x.ReportID; });
    const kpiQsByDept = {};
    const getKpiQs = function (deptId) {
      if (!kpiQsByDept[deptId]) kpiQsByDept[deptId] = allQ.filter(function (q) { return q.DepartmentID === deptId && q.Section === 'KPI' && q.Status === 'Active'; });
      return kpiQsByDept[deptId];
    };
    const kpiTotals = {};
    let kpiSum = 0, kpiReports = 0;
    submitted.forEach(function (r) {
      const answers = indexBy(byReport[r.ReportID] || [], 'QuestionID');
      if (planQ && answers[planQ.QuestionID] && String(answers[planQ.QuestionID].Answer).trim()) planned++;
      const qs = getKpiQs(r.DepartmentID);
      if (!qs.length) return;
      let reportScore = 0;
      qs.forEach(function (q) {
        const a = answers[q.QuestionID];
        const rules = parseJson(q.Validation, {});
        const numeric = q.QuestionType === 'NUMBER' || q.QuestionType === 'DECIMAL';
        if (numeric && a && a.Answer !== '') {
          const k = kpiTotals[q.QuestionID] = kpiTotals[q.QuestionID] || { questionId: q.QuestionID, text: q.QuestionText, total: 0, reports: 0, target: rules.target || null };
          k.total += num(a.Answer); k.reports++;
        }
        if (numeric && rules.target > 0) reportScore += a && a.Answer !== '' ? Math.min(1, num(a.Answer) / rules.target) : 0;
        else reportScore += a && a.Answer !== '' ? 1 : 0;
      });
      kpiSum += reportScore / qs.length;
      kpiReports++;
    });
    kpis = Object.keys(kpiTotals).map(function (k) {
      const x = kpiTotals[k];
      x.total = round(x.total, 2); x.avgPerReport = round(x.total / x.reports, 1);
      return x;
    });
    kpiScore = kpiReports ? round(kpiSum / kpiReports * 100, 1) : null;
    planningScore = submitted.length && planQ ? pct(planned, submitted.length) : null;
    const fus = Db.readAll('FollowUps').filter(function (f) { const d = String(f.CreatedAt).slice(0, 10); return f.EmployeeID === emp.EmployeeID && d >= from && d <= to; });
    fuTotal = fus.length;
    fuResolved = fus.filter(function (f) { return f.Status === 'RESOLVED' || f.Status === 'CLOSED'; }).length;
    blockerScore = fuTotal ? pct(fuResolved, fuTotal) : null;
  }

  const components = [
    { key: 'CONSISTENCY', label: 'Report consistency', value: roll.expected ? roll.completionPct : null,
      explanation: roll.expected ? roll.submitted + ' of ' + roll.expected + ' expected reports submitted.' : 'No reports were expected in this period.' },
    { key: 'TASK_COMPLETION', label: 'Task completion', value: t.total ? t.completionPct : null,
      explanation: t.total ? t.completed + ' of ' + t.total + ' tasks completed.' : 'No tasks recorded.' },
    { key: 'KPI', label: 'Department KPI', value: kpiScore,
      explanation: kpiScore === null ? (opts.light ? 'Not calculated in this view.' : 'No department KPIs configured or no submitted reports.') : 'Average KPI completion per submitted report: KPIs with a target count progress toward the target (capped at 100%); others count as answered or not.' },
    { key: 'TIMELINESS', label: 'Timeliness', value: submitted.length ? pct(submitted.length - metrics.late, submitted.length) : null,
      explanation: submitted.length ? (submitted.length - metrics.late) + ' of ' + submitted.length + ' submitted reports were on time.' : 'No submitted reports.' },
    { key: 'PLANNING', label: 'Work planning', value: planningScore,
      explanation: planningScore === null ? 'Not enough data.' : planned + ' of ' + submitted.length + ' submitted reports included tomorrow\'s plan.' },
    { key: 'BLOCKER_RESOLUTION', label: 'Blocker resolution', value: blockerScore,
      explanation: blockerScore === null ? 'No follow-ups were raised from this employee\'s reports.' : fuResolved + ' of ' + fuTotal + ' follow-ups from their reports are resolved or closed.' }
  ];
  return { metrics: metrics, kpis: kpis, score: s.PRODUCTIVITY_SCORE_ENABLED ? computeScore(components, s.PRODUCTIVITY_WEIGHTS) : null };
}

/** Weighted average of available components; weights of missing components are redistributed. */
function computeScore(components, weights) {
  let wSum = 0, total = 0;
  components.forEach(function (c) {
    c.weight = num(weights[c.key]);
    c.included = c.value !== null && c.value !== undefined && c.weight > 0;
    if (c.included) { wSum += c.weight; total += c.value * c.weight; }
  });
  components.forEach(function (c) { c.effectiveWeight = c.included && wSum ? round(c.weight * 100 / wSum, 1) : 0; });
  const excluded = components.filter(function (c) { return !c.included; }).map(function (c) { return c.label; });
  return {
    score: wSum ? round(total / wSum, 1) : null,
    components: components,
    explanation: 'Score = weighted average of the components below (0–100). ' +
      (excluded.length ? 'Not enough data for: ' + excluded.join(', ') + ' — their weight is shared among the others. ' : '') +
      'Use it as a conversation aid alongside the actual reports, not as a sole basis for decisions.'
  };
}

// ============================ EMPLOYEE DASHBOARD ============================

function apiGetMyDashboard(p, user) { return ocCached_('mine', p, user, apiGetMyDashboard_); }
function apiGetMyDashboard_(p, user) {
  const s = getSettingsMap();
  const today = todayStr();
  const emp = getEmployeeOrThrow(user.id);
  const trendFrom = addDays(weekStart(today), -49);
  const mFrom = monthStart(today);
  const scoreFrom = addDays(today, -29);
  const reports = Db.rangeBy('Reports', 'ReportDate', minDate(trendFrom, mFrom, scoreFrom, addDays(today, -60)), today)
    .filter(function (r) { return r.EmployeeID === emp.EmployeeID; });
  const todayReport = reports.filter(function (r) { return r.ReportDate === today; })[0];
  const todayTasks = todayReport ? Db.findBy('Tasks', 'ReportID', todayReport.ReportID).filter(function (t) { return !bool(t.Deleted); }).map(publicTask) : [];
  const carry = s.CARRY_FORWARD_ENABLED ? carryForwardTasks(emp.EmployeeID, today, todayTasks) : [];
  const month = employeeMetrics(emp, mFrom, today, s, { light: true, reports: reports.filter(function (r) { return r.ReportDate >= mFrom; }) });
  const scored = s.PRODUCTIVITY_SCORE_ENABLED ? employeeMetrics(emp, scoreFrom, today, s, { reports: reports.filter(function (r) { return r.ReportDate >= scoreFrom; }) }) : null;

  const trend = [];
  for (let i = 0; i < 8; i++) {
    const ws = addDays(trendFrom, i * 7);
    const we = addDays(ws, 6) > today ? today : addDays(ws, 6);
    const wr = reports.filter(function (r) { return r.ReportDate >= ws && r.ReportDate <= we; });
    const rmap = {};
    wr.forEach(function (r) { rmap[reportKey(r.EmployeeID, r.ReportDate)] = r; });
    const roll = rollup(expectedPairs(ws, we, [emp], s), rmap);
    const t = taskRollup(wr);
    trend.push({ week: ws, expected: roll.expected, submitted: roll.submitted, submissionPct: roll.completionPct, tasks: t.total, completed: t.completed, taskCompletionPct: t.completionPct });
  }
  const emps = indexBy(Db.readAll('Employees'), 'EmployeeID');
  const followUps = Db.readAll('FollowUps').filter(function (f) {
    return (f.OwnerID === user.id || f.EmployeeID === user.id) && (f.Status === 'OPEN' || f.Status === 'IN PROGRESS');
  }).slice(0, 10).map(function (f) { return publicFollowUp(f, emps); });
  const agg = aggregateTasks(todayTasks.map(function (t) { return { Status: t.status, Duration: t.duration }; }));

  return {
    today: {
      date: today, workingDay: workingDayInfo(today, s), deadline: reportDeadline(today, s),
      status: todayReport ? todayReport.Status : REPORT_STATUS.NOT_STARTED, report: publicReport(todayReport),
      tasks: { total: agg.total, completed: agg.completed, pending: agg.pending, blocked: agg.blocked, carried: agg.carried }
    },
    reportRequired: bool(emp.ReportRequired),
    carryForwardCount: carry.length,
    carryForward: carry.slice(0, 5),
    month: month.metrics,
    trend: trend,
    score: scored ? scored.score : null,
    recentReports: reports.slice().sort(function (a, b) { return a.ReportDate < b.ReportDate ? 1 : -1; }).slice(0, 10).map(publicReport),
    followUps: followUps,
    serverTime: nowIso()
  };
}

// ============================ EMPLOYEE ANALYTICS ============================

function apiGetEmployeeAnalytics(p, user) {
  const s = getSettingsMap();
  const id = cleanText(p.employeeId, 40) || user.id;
  assert(getScope(user).canEmployee(id), 'FORBIDDEN', 'You do not have access to this employee.');
  const range = analyticsRange(p, 29);
  const emp = getEmployeeOrThrow(id);
  const depts = indexBy(Db.readAll('Departments'), 'DepartmentID');
  const empMap = indexBy(Db.readAll('Employees'), 'EmployeeID');
  const monthlyFrom = monthsBack(range.to, 5);
  const all = Db.rangeBy('Reports', 'ReportDate', minDate(range.from, monthlyFrom), range.to).filter(function (r) { return r.EmployeeID === id; });
  const inRange = all.filter(function (r) { return r.ReportDate >= range.from; });
  const m = employeeMetrics(emp, range.from, range.to, s, { reports: inRange });

  const monthly = monthList(monthlyFrom, range.to).map(function (mo) {
    const mf = mo + '-01', mt = monthsBack(mf, -1) > range.to ? range.to : addDays(monthsBack(mf, -1), -1);
    const mr = all.filter(function (r) { return r.ReportDate >= mf && r.ReportDate <= mt; });
    const rmap = {};
    mr.forEach(function (r) { rmap[reportKey(r.EmployeeID, r.ReportDate)] = r; });
    const roll = rollup(expectedPairs(mf, mt, [emp], s), rmap);
    const t = taskRollup(mr);
    return { month: mo, expected: roll.expected, submitted: roll.submitted, late: roll.late, submissionPct: roll.completionPct, tasks: t.total, completed: t.completed, taskCompletionPct: t.completionPct };
  });

  const tasks = Db.rangeBy('Tasks', 'ReportDate', range.from, range.to).filter(function (t) { return t.EmployeeID === id && !bool(t.Deleted) && t.Status !== 'CANCELLED'; });
  const byCat = groupBy(tasks, function (t) { return t.Category || 'Uncategorised'; });
  const categories = Object.keys(byCat).map(function (c) {
    return { category: c, tasks: byCat[c].length, completed: byCat[c].filter(function (t) { return t.Status === 'COMPLETED'; }).length, hours: round(sum(byCat[c], function (t) { return t.Duration; }) / 60, 1) };
  }).sort(function (a, b) { return b.tasks - a.tasks; });

  const daily = dateRange(range.from, range.to).map(function (d) {
    const r = inRange.filter(function (x) { return x.ReportDate === d; })[0];
    return { date: d, status: r ? r.Status : (workingDayInfo(d, s).working ? REPORT_STATUS.NOT_STARTED : 'OFF'), tasks: r ? num(r.TaskTotal) : 0, completed: r ? num(r.TaskCompleted) : 0, hours: r ? round(num(r.WorkMinutes) / 60, 1) : 0 };
  });

  return {
    employee: publicEmployee(emp, depts, empMap),
    range: range,
    metrics: m.metrics,
    score: m.score,
    kpis: m.kpis,
    monthly: monthly,
    daily: daily,
    categories: categories,
    recentReports: inRange.slice().sort(function (a, b) { return a.ReportDate < b.ReportDate ? 1 : -1; }).slice(0, 15).map(publicReport),
    definitions: KPI_DEFINITIONS
  };
}

// ============================ DEPARTMENT ANALYTICS ============================

function apiGetDepartmentAnalytics(p, user) { return ocCached_('dept', p, user, apiGetDepartmentAnalytics_); }
function apiGetDepartmentAnalytics_(p, user) {
  const s = getSettingsMap();
  const range = analyticsRange(p, 29);
  const from = range.from, to = range.to;
  const deptId = cleanText(p.departmentId, 40);
  const dept = getDepartment(deptId);
  assert(dept, 'NOT_FOUND', 'Department not found.');
  const scope = getScope(user);
  const allEmps = Db.readAll('Employees');
  const empMap = indexBy(allEmps, 'EmployeeID');
  const emps = allEmps.filter(function (e) { return e.DepartmentID === deptId && scope.canEmployee(e.EmployeeID); });
  assert(scope.all || scope.canDepartment(deptId) || emps.length, 'FORBIDDEN', 'You do not have access to this department.');

  const monthlyFrom = monthsBack(to, 5);
  const allReports = Db.rangeBy('Reports', 'ReportDate', minDate(from, monthlyFrom), to).filter(function (r) {
    return r.DepartmentID === deptId && (scope.all || scope.canDepartment(deptId) || scope.canEmployee(r.EmployeeID));
  });
  const reports = allReports.filter(function (r) { return r.ReportDate >= from; });
  const rmap = {};
  allReports.forEach(function (r) { rmap[reportKey(r.EmployeeID, r.ReportDate)] = r; });
  const pairs = expectedPairs(from, to, emps, s);
  const roll = rollup(pairs, rmap);
  const t = taskRollup(reports);

  const pairsByDate = groupBy(pairs, function (pr) { return pr.date; });
  const repByDate = groupBy(reports, function (r) { return r.ReportDate; });
  const daily = dateRange(from, to).map(function (d) {
    const r = rollup(pairsByDate[d] || [], rmap);
    const tr = taskRollup(repByDate[d] || []);
    return { date: d, working: workingDayInfo(d, s).working, expected: r.expected, submitted: r.submitted, pct: r.completionPct, tasks: tr.total, completed: tr.completed, blocked: tr.blocked };
  });
  const weeks = groupBy(daily, function (d) { return weekStart(d.date); });
  const weekly = Object.keys(weeks).sort().map(function (w) {
    const list = weeks[w];
    const exp = sum(list, function (d) { return d.expected; }), sub = sum(list, function (d) { return d.submitted; });
    const tasks = sum(list, function (d) { return d.tasks; }), comp = sum(list, function (d) { return d.completed; });
    return { week: w, expected: exp, submitted: sub, pct: pct(sub, exp), tasks: tasks, completed: comp, taskCompletionPct: pct(comp, tasks) };
  });
  const monthlyPairs = groupBy(expectedPairs(monthlyFrom, to, emps, s), function (pr) { return pr.date.slice(0, 7); });
  const monthly = monthList(monthlyFrom, to).map(function (m) {
    const r = rollup(monthlyPairs[m] || [], rmap);
    const tr = taskRollup(allReports.filter(function (x) { return x.ReportDate.slice(0, 7) === m; }));
    return { month: m, expected: r.expected, submitted: r.submitted, pct: r.completionPct, tasks: tr.total, taskCompletionPct: tr.completionPct };
  });

  // Department KPIs (numeric questions), totals and daily series
  const kpiQs = Db.readAll('Questions').filter(function (q) { return q.DepartmentID === deptId && q.Section === 'KPI'; });
  const numericQs = kpiQs.filter(function (q) { return q.QuestionType === 'NUMBER' || q.QuestionType === 'DECIMAL'; });
  const numericMap = indexBy(numericQs, 'QuestionID');
  const submittedIds = indexBy(reports.filter(function (r) { return isSubmittedStatus(r.Status); }), 'ReportID');
  const responses = Db.rangeBy('Responses', 'ReportDate', from, to).filter(function (x) { return numericMap[x.QuestionID] && submittedIds[x.ReportID] && x.Answer !== ''; });
  const kpis = numericQs.map(function (q) {
    const list = responses.filter(function (x) { return x.QuestionID === q.QuestionID; });
    const total = sum(list, function (x) { return x.Answer; });
    const byDay = groupBy(list, function (x) { return x.ReportDate; });
    const rules = parseJson(q.Validation, {});
    return {
      questionId: q.QuestionID, text: q.QuestionText, active: q.Status === 'Active', total: round(total, 2), reports: list.length,
      avgPerReport: list.length ? round(total / list.length, 1) : 0, target: rules.target || null,
      series: daily.map(function (d) { return round(sum(byDay[d.date] || [], function (x) { return x.Answer; }), 2); })
    };
  }).filter(function (k) { return k.active || k.reports; });

  const respByEmp = groupBy(responses, function (x) { return x.EmployeeID; });
  const pairsByEmp = groupBy(pairs, function (pr) { return pr.emp.EmployeeID; });
  const repByEmp = groupBy(reports, function (r) { return r.EmployeeID; });
  const topKpis = kpis.slice(0, 3);
  const employeeIds = uniq(Object.keys(pairsByEmp).concat(Object.keys(repByEmp)));
  const employees = employeeIds.map(function (id) {
    const r = rollup(pairsByEmp[id] || [], rmap);
    const er = repByEmp[id] || [];
    const tr = taskRollup(er);
    const mine = respByEmp[id] || [];
    return {
      employeeId: id, name: empMap[id] ? empMap[id].EmployeeName : id, designation: empMap[id] ? empMap[id].Designation : '',
      expected: r.expected, submitted: r.submitted, submissionPct: r.completionPct,
      late: er.filter(function (x) { return x.Status === REPORT_STATUS.LATE; }).length,
      tasks: tr.total, completed: tr.completed, pending: tr.pending, blocked: tr.blocked, taskCompletionPct: tr.completionPct,
      hours: round(tr.minutes / 60, 1),
      kpis: topKpis.map(function (k) { return round(sum(mine.filter(function (x) { return x.QuestionID === k.questionId; }), function (x) { return x.Answer; }), 2); })
    };
  }).sort(function (a, b) { return a.name.localeCompare(b.name); });

  return {
    department: { departmentId: dept.DepartmentID, name: dept.DepartmentName, managerName: empMap[dept.ManagerID] ? empMap[dept.ManagerID].EmployeeName : '', status: dept.Status },
    range: range,
    kpis: {
      employees: emps.filter(function (e) { return e.Status === 'Active'; }).length, expected: roll.expected, submitted: roll.submitted,
      pending: roll.pending, late: roll.late, completionPct: roll.completionPct, totalTasks: t.total, completedTasks: t.completed,
      pendingTasks: t.pending, blockedTasks: t.blocked, carriedTasks: t.carried, taskCompletionPct: t.completionPct, hours: round(t.minutes / 60, 1)
    },
    departmentKpis: kpis,
    kpiColumns: topKpis.map(function (k) { return k.text; }),
    employees: employees,
    daily: daily, weekly: weekly, monthly: monthly,
    definitions: KPI_DEFINITIONS
  };
}
