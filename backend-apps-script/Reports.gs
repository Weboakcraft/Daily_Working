/**
 * Daily Report lifecycle.
 * One report per employee per date (UniqueKey = EmployeeID|ReportDate).
 * Status flow: NOT STARTED → DRAFT → SUBMITTED | LATE → (admin) REOPENED → SUBMITTED | LATE
 */

function publicReport(r) {
  if (!r) return null;
  return {
    reportId: r.ReportID, employeeId: r.EmployeeID, departmentId: r.DepartmentID, date: r.ReportDate, status: r.Status,
    startedAt: r.StartedAt, lastSavedAt: r.LastSavedAt, submittedAt: r.SubmittedAt, firstSubmittedAt: r.FirstSubmittedAt,
    late: bool(r.LateFlag), managerId: r.ManagerID, reviewStatus: r.ReviewStatus || 'NOT REVIEWED', managerRemarks: r.ManagerRemarks,
    reopenedAt: r.ReopenedAt, reopenedBy: r.ReopenedBy, reopenReason: r.ReopenReason,
    taskTotal: num(r.TaskTotal), taskCompleted: num(r.TaskCompleted), taskPending: num(r.TaskPending),
    taskBlocked: num(r.TaskBlocked), taskCarried: num(r.TaskCarried), workMinutes: num(r.WorkMinutes),
    hasBlocker: bool(r.HasBlocker), isDemo: bool(r.IsDemo), createdAt: r.CreatedAt, updatedAt: r.UpdatedAt
  };
}

function publicTask(t) {
  return {
    taskId: t.TaskID, reportId: t.ReportID, employeeId: t.EmployeeID, departmentId: t.DepartmentID, reportDate: t.ReportDate,
    title: t.TaskTitle, description: t.Description, category: t.Category, startTime: t.StartTime, endTime: t.EndTime,
    duration: num(t.Duration), priority: t.Priority, status: t.Status, relatedType: t.RelatedType, relatedEntity: t.RelatedEntity,
    remarks: t.Remarks, sourceTaskId: t.SourceTaskID, carriedToTaskId: t.CarriedToTaskID, carryCount: num(t.CarryCount),
    order: num(t.DisplayOrder), updatedAt: t.UpdatedAt
  };
}

function findReport(employeeId, date) { return Db.findOne('Reports', 'UniqueKey', employeeId + '|' + date); }

function getReportOrThrow(id) {
  assert(/^[A-Za-z0-9-]{4,40}$/.test(String(id || '')), 'NOT_FOUND', 'Report not found.');
  const r = Db.findOne('Reports', 'ReportID', id);
  assert(r, 'NOT_FOUND', 'Report not found.');
  return r;
}

function validateReportDate(date, s) {
  assert(isValidDateStr(date), 'VALIDATION', 'Report date is not valid.');
  const today = todayStr();
  assert(date <= today, 'VALIDATION', 'You cannot report for a future date.');
  assert(daysBetween(date, today) <= s.BACKDATE_DAYS_ALLOWED, 'VALIDATION',
    s.BACKDATE_DAYS_ALLOWED ? 'You can only report for the last ' + s.BACKDATE_DAYS_ALLOWED + ' day(s).' : 'You can only report for today.');
}

/**
 * @param {Date} [at] the moment to judge the deadline by. A save is judged by when the request
 *   arrived, not by when the shared write lock finally came free, so a queue at 21:14 can never
 *   turn an on-time report into a rejected one.
 */
function editability(report, date, s, dept, at) {
  if (dept && dept.Status !== 'Active') return { canEdit: false, reason: 'Your department is inactive. Contact the admin.' };
  if (report && isSubmittedStatus(report.Status)) return { canEdit: false, reason: 'This report has already been submitted.' };
  if (s.LOCK_AFTER_DEADLINE && (!report || report.Status !== REPORT_STATUS.REOPENED) && (at || new Date()) > new Date(reportDeadline(date, s).graceEnd)) {
    const closed = 'Reporting for ' + humanDate(date) + ' closed at ' + s.REPORT_DEADLINE +
      (num(s.GRACE_PERIOD_MINUTES) ? ' plus ' + s.GRACE_PERIOD_MINUTES + ' minutes' : '') + '. Ask the admin to reopen it.';
    return { canEdit: false, reason: closed };
  }
  return { canEdit: true, reason: '' };
}

function aggregateTasks(tasks) {
  const a = { total: 0, completed: 0, pending: 0, blocked: 0, carried: 0, minutes: 0 };
  tasks.forEach(function (t) {
    if (bool(t.Deleted) || t.Status === 'CANCELLED') return;
    a.total++;
    if (t.Status === 'COMPLETED') a.completed++;
    else if (t.Status === 'PENDING' || t.Status === 'IN PROGRESS') a.pending++;
    else if (t.Status === 'BLOCKED') a.blocked++;
    else if (t.Status === 'CARRIED FORWARD') a.carried++;
    a.minutes += num(t.Duration);
  });
  return a;
}

function applyAggregates(report, tasks) {
  const a = aggregateTasks(tasks);
  report.TaskTotal = a.total; report.TaskCompleted = a.completed; report.TaskPending = a.pending;
  report.TaskBlocked = a.blocked; report.TaskCarried = a.carried; report.WorkMinutes = a.minutes;
  return a;
}

/** Open tasks from earlier days that have not been carried into a later report. */
function carryForwardTasks(employeeId, date, currentTasks) {
  const linked = {};
  (currentTasks || []).forEach(function (t) { if (t.sourceTaskId) linked[t.sourceTaskId] = true; });
  return Db.rangeBy('Tasks', 'ReportDate', addDays(date, -LIMITS.CARRY_LOOKBACK_DAYS), addDays(date, -1))
    .filter(function (t) {
      return t.EmployeeID === employeeId && !bool(t.Deleted) && OPEN_TASK_STATUSES.indexOf(t.Status) >= 0 && !t.CarriedToTaskID && !linked[t.TaskID];
    })
    .sort(function (a, b) { return a.ReportDate < b.ReportDate ? 1 : (a.ReportDate > b.ReportDate ? -1 : 0); })
    .map(publicTask);
}

// ---------------- Today's report ----------------

function apiGetTodayReport(p, user) {
  const s = getSettingsMap();
  const date = p.date ? String(p.date) : todayStr();
  validateReportDate(date, s);
  const emp = getEmployeeOrThrow(user.id);
  const report = findReport(emp.EmployeeID, date);
  const deptId = report ? report.DepartmentID : emp.DepartmentID;
  const dept = getDepartment(deptId);
  const questions = questionsForDepartment(deptId, false);
  const qMap = indexBy(questions, 'QuestionID');
  const responses = {};
  let tasks = [];
  if (report) {
    Db.findBy('Responses', 'ReportID', report.ReportID).forEach(function (r) { responses[r.QuestionID] = decodeAnswer(qMap[r.QuestionID], r.Answer); });
    tasks = Db.findBy('Tasks', 'ReportID', report.ReportID).filter(function (t) { return !bool(t.Deleted); })
      .sort(function (a, b) { return num(a.DisplayOrder) - num(b.DisplayOrder); }).map(publicTask);
  }
  const ed = editability(report, date, s, dept);
  return {
    date: date,
    today: todayStr(),
    serverTime: nowIso(),
    employee: { employeeId: emp.EmployeeID, name: emp.EmployeeName, designation: emp.Designation },
    department: dept ? { departmentId: dept.DepartmentID, name: dept.DepartmentName } : null,
    report: report ? publicReport(report) : { status: REPORT_STATUS.NOT_STARTED, date: date },
    questions: questions.map(publicQuestion),
    responses: responses,
    tasks: tasks,
    carryForward: s.CARRY_FORWARD_ENABLED ? carryForwardTasks(emp.EmployeeID, date, tasks) : [],
    deadline: reportDeadline(date, s),
    workingDay: workingDayInfo(date, s),
    canEdit: ed.canEdit,
    lockedReason: ed.reason,
    reportRequired: bool(emp.ReportRequired),
    backdateDaysAllowed: s.BACKDATE_DAYS_ALLOWED,
    taskCategories: s.TASK_CATEGORIES
  };
}

function apiSaveDraft(p, user) { return saveReportInternal(user, p, false); }

function apiSubmitReport(p, user) { return saveReportInternal(user, p, true); }

function normalizeAnswers(raw, qMap) {
  const out = {}, errors = {};
  Object.keys(raw || {}).forEach(function (qid) {
    const q = qMap[qid];
    if (!q) return;
    const res = validateAnswerValue(q, raw[qid]);
    if (res.error) errors[qid] = res.error; else out[qid] = res;
  });
  if (Object.keys(errors).length) throw appError('VALIDATION', 'Some answers need attention.', { fieldErrors: errors });
  return out;
}

function validateRequiredAnswers(questions, answers) {
  const errors = {};
  questions.forEach(function (q) {
    if (!bool(q.Required) || !isQuestionVisible(q, answers)) return;
    const a = answers[q.QuestionID];
    if (!a || a.empty) errors[q.QuestionID] = 'This question is required.';
  });
  if (Object.keys(errors).length) throw appError('VALIDATION', 'Please answer all required questions.', { fieldErrors: errors });
}

function normalizeTasks(list, submit) {
  assert(Array.isArray(list), 'VALIDATION', 'Tasks must be a list.');
  assert(list.length <= LIMITS.TASKS_PER_REPORT, 'VALIDATION', 'A report can have at most ' + LIMITS.TASKS_PER_REPORT + ' tasks.');
  const errors = {};
  const out = list.map(function (t, i) {
    t = t || {};
    const row = {
      taskId: cleanText(t.taskId, 40), clientKey: cleanText(t.clientKey, 40), sourceTaskId: cleanText(t.sourceTaskId, 40),
      title: cleanText(t.title, 200), description: cleanText(t.description, 3000), category: cleanText(t.category, 60),
      startTime: cleanText(t.startTime, 5), endTime: cleanText(t.endTime, 5),
      priority: PRIORITIES.indexOf(t.priority) >= 0 ? t.priority : 'MEDIUM',
      status: TASK_STATUSES.indexOf(t.status) >= 0 && t.status !== 'CANCELLED' ? t.status : 'PENDING',
      relatedType: RELATED_TYPES.indexOf(t.relatedType) >= 0 ? t.relatedType : '',
      relatedEntity: cleanText(t.relatedEntity, 150), remarks: cleanText(t.remarks, 1000), duration: 0
    };
    const e = [];
    if (submit && !row.title) e.push('Task title is required.');
    const hasStart = !!row.startTime, hasEnd = !!row.endTime;
    if (hasStart && !isValidTime(row.startTime)) e.push('Start time is not valid.');
    if (hasEnd && !isValidTime(row.endTime)) e.push('End time is not valid.');
    if (hasStart && hasEnd && isValidTime(row.startTime) && isValidTime(row.endTime)) {
      if (timeToMin(row.endTime) < timeToMin(row.startTime)) e.push('End time cannot be before start time.');
      else row.duration = timeToMin(row.endTime) - timeToMin(row.startTime);
    } else if (t.duration !== undefined && t.duration !== '' && t.duration !== null) {
      const d = Number(t.duration);
      if (!(d >= 0 && d <= 1440)) e.push('Duration must be between 0 and 1440 minutes.'); else row.duration = Math.round(d);
    }
    if (e.length) errors[i] = e.join(' ');
    return row;
  });
  if (Object.keys(errors).length) throw appError('VALIDATION', 'Some tasks need attention.', { taskErrors: errors });
  return out;
}

function applyTaskFields(row, t, index, now) {
  const next = {
    TaskTitle: t.title, Description: t.description, Category: t.category, StartTime: t.startTime, EndTime: t.endTime,
    Duration: t.duration, Priority: t.priority, Status: t.status, RelatedType: t.relatedType, RelatedEntity: t.relatedEntity,
    Remarks: t.remarks, DisplayOrder: index + 1
  };
  let changed = false;
  Object.keys(next).forEach(function (k) { if (String(row[k]) !== String(next[k])) { row[k] = next[k]; changed = true; } });
  if (changed) row.UpdatedAt = now;
  return changed;
}

/** Shared by saveDraft, submitReport and saveTask. */
function saveReportInternal(user, p, submit) {
  const s = getSettingsMap();
  const date = p.date ? String(p.date) : todayStr();
  validateReportDate(date, s);
  const emp = getEmployeeOrThrow(user.id);
  assert(emp.Status === 'Active', 'FORBIDDEN', 'Inactive employees cannot submit reports.');

  /*
   * Everything below up to `Db.withLock` only reads and decides. The lock is the one the whole
   * script shares — every save by every person queues on it — so it used to be held while the
   * questions, the existing answers and the existing tasks were all fetched and validated, one to
   * three seconds at a time. With a hundred people writing their reports in the same hour the
   * queue never emptied and saves came back as "the system is busy". Now the work is done first
   * and the lock covers only the writes, which is a few hundred milliseconds.
   */
  const arrivedAt = new Date();
  const now = arrivedAt.toISOString();

  let report = findReport(emp.EmployeeID, date);
  const created = !report;
  const deptId = report ? report.DepartmentID : emp.DepartmentID;
  const dept = getDepartment(deptId);
  assert(dept, 'VALIDATION', 'Your department is not configured. Contact the admin.');

  if (report && isSubmittedStatus(report.Status)) {
    if (!submit) throw appError('REPORT_LOCKED', 'This report has already been submitted.');
    return { alreadySubmitted: true, report: publicReport(report), receipt: buildReceipt(report, emp, dept) };
  }
  const ed = editability(report, date, s, dept, arrivedAt);
  assert(ed.canEdit, 'REPORT_LOCKED', ed.reason);

  const questions = questionsForDepartment(deptId, false);
  const qMap = indexBy(questions, 'QuestionID');
  const answers = normalizeAnswers(p.responses || {}, qMap);
  const taskInputs = normalizeTasks(p.tasks || [], submit);
  if (submit) validateRequiredAnswers(questions, answers);

  if (!report) {
    report = {
      ReportID: newId('RPT'), UniqueKey: emp.EmployeeID + '|' + date, EmployeeID: emp.EmployeeID, DepartmentID: deptId,
      ReportDate: date, Status: REPORT_STATUS.DRAFT, StartedAt: now, ManagerID: emp.ManagerID || dept.ManagerID || '',
      ReviewStatus: 'NOT REVIEWED', LateFlag: false, HasBlocker: false, IsDemo: false, CreatedAt: now, UpdatedAt: now
    };
  }

  // --- Responses (upsert) ---
  const existingResp = created ? [] : Db.findBy('Responses', 'ReportID', report.ReportID);
  const respByQ = indexBy(existingResp, 'QuestionID');
  const rIns = [], rUpd = [];
  Object.keys(answers).forEach(function (qid) {
    const a = answers[qid], ex = respByQ[qid];
    if (ex) {
      if (ex.Answer !== a.stored) { ex.Answer = a.stored; ex.QuestionText = qMap[qid].QuestionText; ex.UpdatedAt = now; rUpd.push(ex); }
    } else if (a.stored !== '') {
      rIns.push({
        ResponseID: newId('RSP'), ReportID: report.ReportID, QuestionID: qid, EmployeeID: emp.EmployeeID, DepartmentID: deptId,
        ReportDate: date, QuestionText: qMap[qid].QuestionText, Answer: a.stored, IsDemo: false, CreatedAt: now, UpdatedAt: now
      });
    }
  });

  // --- Tasks (upsert + soft delete) ---
  const existingTasks = created ? [] : Db.findBy('Tasks', 'ReportID', report.ReportID);
  const exById = indexBy(existingTasks, 'TaskID');
  const keep = {}, idMap = {}, tIns = [], tUpd = [], srcUpd = {};
  const active = [];
  taskInputs.forEach(function (t, i) {
    let row = t.taskId ? exById[t.taskId] : null;
    if (row && !bool(row.Deleted) && !keep[row.TaskID]) {
      if (applyTaskFields(row, t, i, now)) tUpd.push(row);
    } else {
      row = {
        TaskID: newId('TSK'), ReportID: report.ReportID, EmployeeID: emp.EmployeeID, DepartmentID: deptId, ReportDate: date,
        SourceTaskID: '', CarriedToTaskID: '', CarryCount: 0, Deleted: false, IsDemo: false, CreatedAt: now, UpdatedAt: now
      };
      applyTaskFields(row, t, i, now);
      if (t.sourceTaskId) {
        const src = Db.findOne('Tasks', 'TaskID', t.sourceTaskId);
        if (src && src.EmployeeID === emp.EmployeeID && src.ReportDate < date && !src.CarriedToTaskID &&
            !bool(src.Deleted) && OPEN_TASK_STATUSES.indexOf(src.Status) >= 0) {
          row.SourceTaskID = src.TaskID;
          row.CarryCount = num(src.CarryCount) + 1;
          src.CarriedToTaskID = row.TaskID;
          src.UpdatedAt = now;
          srcUpd[src.TaskID] = src;
        }
      }
      tIns.push(row);
    }
    keep[row.TaskID] = true;
    active.push(row);
    if (t.clientKey) idMap[t.clientKey] = row.TaskID;
  });
  existingTasks.forEach(function (row) {
    if (keep[row.TaskID] || bool(row.Deleted)) return;
    row.Deleted = true; row.UpdatedAt = now; tUpd.push(row);
    if (row.SourceTaskID) {
      const src = srcUpd[row.SourceTaskID] || Db.findOne('Tasks', 'TaskID', row.SourceTaskID);
      if (src && src.CarriedToTaskID === row.TaskID) { src.CarriedToTaskID = ''; src.UpdatedAt = now; srcUpd[src.TaskID] = src; }
    }
  });

  // --- Report aggregates & status ---
  const agg = applyAggregates(report, active);
  const flagQ = questions.filter(function (q) { return q.QuestionKey === 'COMMON_BLOCKER_FLAG'; })[0];
  report.HasBlocker = !!(flagQ && answers[flagQ.QuestionID] && answers[flagQ.QuestionID].stored === 'Yes') || agg.blocked > 0;
  report.LastSavedAt = now;
  report.UpdatedAt = now;
  let followUps = [];
  if (submit) {
    const late = arrivedAt > new Date(reportDeadline(date, s).graceEnd);
    if (!report.FirstSubmittedAt) { report.FirstSubmittedAt = now; report.LateFlag = late; }
    report.Status = bool(report.LateFlag) ? REPORT_STATUS.LATE : REPORT_STATUS.SUBMITTED;
    report.SubmittedAt = now;
    if (s.AUTO_FOLLOWUP_FOR_BLOCKERS) followUps = buildAutoFollowUps(report, emp, questions, answers, active, s, now, created ? [] : null);
  }

  // --- The only part that needs the shared lock: the writes. ---
  Db.withLock(function () {
    if (created) {
      // A second tab could have created today's report while this one was deciding what to write.
      const race = findReport(emp.EmployeeID, date);
      assert(!race, 'IN_PROGRESS', 'This report was being saved from somewhere else. Please try again.');
      Db.insert('Reports', [report]);
    }
    Db.update('Reports', [report]);
    Db.update('Responses', rUpd);
    Db.insert('Responses', rIns);
    Db.update('Tasks', tUpd.concat(Object.keys(srcUpd).map(function (k) { return srcUpd[k]; })));
    Db.insert('Tasks', tIns);
    Db.insert('FollowUps', followUps);
  });

  if (created) audit(user, 'REPORT_DRAFTED', 'Report', report.ReportID, '', { date: date });
  const out = {
    report: publicReport(report),
    tasks: active.map(publicTask),
    idMap: idMap,
    savedAt: report.LastSavedAt
  };
  if (submit) {
    audit(user, 'REPORT_SUBMITTED', 'Report', report.ReportID, '', { date: date, status: report.Status, tasks: num(report.TaskTotal), reopened: !!report.ReopenedAt });
    out.receipt = buildReceipt(report, emp, dept);
    safeNotify(function () {
      if (report.Status === REPORT_STATUS.LATE) Notify.dispatch('LATE_REPORT', { report: report, employee: emp });
      followUps.forEach(function (f) {
        Notify.dispatch(f.Source === 'BLOCKER' || f.Priority === 'URGENT' ? 'HIGH_PRIORITY_BLOCKER' : 'FOLLOWUP_ASSIGNED', { followUp: f, employee: emp, report: report });
      });
    });
  }
  return out;
}

/** @param {Array} [existingFollowUps] already-read rows, so a brand-new report skips the lookup. */
function buildAutoFollowUps(report, emp, questions, answers, tasks, s, now, existingFollowUps) {
  const existing = existingFollowUps || Db.findBy('FollowUps', 'ReportID', report.ReportID);
  const has = function (source, taskId) { return existing.some(function (f) { return f.Source === source && String(f.TaskID) === String(taskId || ''); }); };
  const out = [];
  const base = {
    ReportID: report.ReportID, EmployeeID: emp.EmployeeID, DepartmentID: report.DepartmentID, OwnerID: report.ManagerID || '',
    DueDate: nextWorkingDay(report.ReportDate, s), Status: 'OPEN', Resolution: '', CreatedBy: emp.EmployeeID, IsDemo: false,
    CreatedAt: now, UpdatedAt: now, ResolvedAt: ''
  };
  const flagQ = questions.filter(function (q) { return q.QuestionKey === 'COMMON_BLOCKER_FLAG'; })[0];
  const detailQ = questions.filter(function (q) { return q.QuestionKey === 'COMMON_BLOCKER_DETAIL'; })[0];
  if (flagQ && answers[flagQ.QuestionID] && answers[flagQ.QuestionID].stored === 'Yes' && !has('BLOCKER', '')) {
    out.push(Object.assign({}, base, {
      FollowUpID: newId('FUP'), TaskID: '', Source: 'BLOCKER', Priority: 'HIGH',
      Title: 'Blocker reported by ' + emp.EmployeeName,
      Description: detailQ && answers[detailQ.QuestionID] ? String(answers[detailQ.QuestionID].stored) : ''
    }));
  }
  tasks.forEach(function (t) {
    if (t.Status === 'BLOCKED' && (t.Priority === 'HIGH' || t.Priority === 'URGENT') && !has('TASK', t.TaskID)) {
      out.push(Object.assign({}, base, {
        FollowUpID: newId('FUP'), TaskID: t.TaskID, Source: 'TASK', Priority: t.Priority,
        Title: 'Blocked task: ' + t.TaskTitle, Description: t.Remarks || t.Description || ''
      }));
    }
  });
  return out;
}

function buildReceipt(report, emp, dept) {
  return {
    reportId: report.ReportID, employeeName: emp.EmployeeName, department: dept ? dept.DepartmentName : report.DepartmentID,
    date: report.ReportDate, submittedAt: report.SubmittedAt, status: report.Status, late: bool(report.LateFlag)
  };
}

function safeNotify(fn) { try { fn(); } catch (e) { console.error('Notification failed', e); } }

// ---------------- Reopen ----------------

function apiReopenReport(p, user) {
  const reason = cleanText(p.reason, 500);
  assert(reason, 'VALIDATION', 'Enter a reason for reopening.', { fieldErrors: { reason: 'Enter a reason for reopening.' } });
  const out = Db.withLock(function () {
    const r = getReportOrThrow(p.reportId);
    assert(isSubmittedStatus(r.Status), 'VALIDATION', 'Only submitted reports can be reopened.');
    const before = r.Status;
    Object.assign(r, { Status: REPORT_STATUS.REOPENED, ReopenedAt: nowIso(), ReopenedBy: user.id, ReopenReason: reason, UpdatedAt: nowIso() });
    Db.update('Reports', [r]);
    return { r: r, before: before };
  });
  audit(user, 'REPORT_REOPENED', 'Report', out.r.ReportID, { status: out.before }, { status: out.r.Status, reason: reason });
  return publicReport(out.r);
}

// ---------------- Report detail ----------------

function assertCanViewReport(user, r) {
  assert(getScope(user).canReport(r), 'FORBIDDEN', 'You do not have access to this report.');
}

function apiGetReport(p, user) {
  const r = getReportOrThrow(cleanText(p.reportId, 40));
  assertCanViewReport(user, r);
  const s = getSettingsMap();
  const emps = indexBy(Db.readAll('Employees'), 'EmployeeID');
  const dept = getDepartment(r.DepartmentID);
  const allQ = indexBy(Db.readAll('Questions'), 'QuestionID');
  const responses = Db.findBy('Responses', 'ReportID', r.ReportID).map(function (x) {
    const q = allQ[x.QuestionID];
    return {
      questionId: x.QuestionID, text: x.QuestionText || (q ? q.QuestionText : x.QuestionID), section: q ? q.Section : 'NOTES',
      type: q ? q.QuestionType : 'LONG_TEXT', key: q ? q.QuestionKey : '', order: q ? num(q.DisplayOrder) : 999,
      common: q ? q.DepartmentID === COMMON_DEPARTMENT_ID : false, questionActive: q ? q.Status === 'Active' : false,
      answer: decodeAnswer(q, x.Answer), updatedAt: x.UpdatedAt
    };
  }).sort(function (a, b) { return (sectionRank(a.section) - sectionRank(b.section)) || ((a.common ? 0 : 1) - (b.common ? 0 : 1)) || (a.order - b.order); });
  const tasks = Db.findBy('Tasks', 'ReportID', r.ReportID).filter(function (t) { return !bool(t.Deleted); })
    .sort(function (a, b) { return num(a.DisplayOrder) - num(b.DisplayOrder); }).map(publicTask);
  const mgmt = isManagerOrAdmin(user) && r.EmployeeID !== user.id || user.role === 'ADMIN';
  const showRemarks = mgmt || s.SHOW_REMARKS_TO_EMPLOYEE;
  const name = function (id) { return emps[id] ? emps[id].EmployeeName : (id || ''); };
  const remarks = showRemarks ? Db.findBy('Remarks', 'ReportID', r.ReportID).map(function (m) {
    return { remarkId: m.RemarkID, authorId: m.AuthorID, authorName: name(m.AuthorID), comment: m.Comment, followUpRequired: bool(m.FollowUpRequired), priority: m.Priority, reviewStatus: m.ReviewStatus, createdAt: m.CreatedAt };
  }).sort(function (a, b) { return a.createdAt < b.createdAt ? 1 : -1; }) : [];
  const followUps = Db.findBy('FollowUps', 'ReportID', r.ReportID).map(function (f) { return publicFollowUp(f, emps); });
  const history = mgmt ? Db.findBy('AuditLog', 'EntityID', r.ReportID).map(function (a) {
    return { action: a.Action, userName: name(a.UserID), timestamp: a.Timestamp, newValue: a.NewValue };
  }).sort(function (a, b) { return a.timestamp < b.timestamp ? 1 : -1; }) : [];
  const e = emps[r.EmployeeID];
  const pr = publicReport(r);
  if (!showRemarks) pr.managerRemarks = '';
  return {
    report: pr,
    employee: { employeeId: r.EmployeeID, name: name(r.EmployeeID), designation: e ? e.Designation : '', managerName: name(r.ManagerID) },
    department: { departmentId: r.DepartmentID, name: dept ? dept.DepartmentName : r.DepartmentID },
    reopenedByName: name(r.ReopenedBy),
    responses: responses, tasks: tasks, remarks: remarks, followUps: followUps, history: history,
    deadline: reportDeadline(r.ReportDate, s),
    permissions: {
      canReview: isManagerOrAdmin(user) && r.EmployeeID !== user.id,
      canReopen: user.role === 'ADMIN' && isSubmittedStatus(r.Status),
      canEdit: r.EmployeeID === user.id && !isSubmittedStatus(r.Status)
    }
  };
}

// ---------------- Report list / search ----------------

/** Expected (employee, date) pairs for a range. Employees must be Active + ReportRequired. */
function expectedPairs(from, to, employees, s) {
  const out = [];
  const today = todayStr();
  const eligible = employees.filter(function (e) { return e.Status === 'Active' && bool(e.ReportRequired); });
  dateRange(from, to < today ? to : today).forEach(function (d) {
    if (!workingDayInfo(d, s).working) return;
    eligible.forEach(function (e) { if (!e.JoiningDate || e.JoiningDate <= d) out.push({ date: d, emp: e }); });
  });
  return out;
}

/** Shared by getReports and exportReport. Returns enriched rows (not paginated). */
function queryReports(user, f) {
  f = f || {};
  const s = getSettingsMap();
  const to = validDateOr(f.to, todayStr());
  const from = validDateOr(f.from, addDays(to, -30));
  assert(from <= to, 'VALIDATION', 'Start date must be on or before the end date.');
  assert(daysBetween(from, to) <= LIMITS.RANGE_MAX_DAYS, 'VALIDATION', 'Choose a date range of up to ' + LIMITS.RANGE_MAX_DAYS + ' days.');
  const scope = getScope(user);
  const empList = Db.readAll('Employees');
  const emps = indexBy(empList, 'EmployeeID');
  const depts = indexBy(Db.readAll('Departments'), 'DepartmentID');

  let reports = Db.rangeBy('Reports', 'ReportDate', from, to).filter(function (r) { return scope.canReport(r); });
  if (f.departmentId) reports = reports.filter(function (r) { return r.DepartmentID === f.departmentId; });
  if (f.employeeId) reports = reports.filter(function (r) { return r.EmployeeID === f.employeeId; });
  if (f.managerId) reports = reports.filter(function (r) { return r.ManagerID === f.managerId || (emps[r.EmployeeID] && emps[r.EmployeeID].ManagerID === f.managerId); });
  if (f.reviewStatus) reports = reports.filter(function (r) { return (r.ReviewStatus || 'NOT REVIEWED') === f.reviewStatus; });
  if (f.late === true || f.late === 'true') reports = reports.filter(function (r) { return bool(r.LateFlag); });
  if (f.hasBlocker === true || f.hasBlocker === 'true') reports = reports.filter(function (r) { return bool(r.HasBlocker); });

  if (f.taskStatus || f.priority) {
    const ids = {};
    Db.rangeBy('Tasks', 'ReportDate', from, to).forEach(function (t) {
      if (bool(t.Deleted)) return;
      if (f.taskStatus && t.Status !== f.taskStatus) return;
      if (f.priority && t.Priority !== f.priority) return;
      ids[t.ReportID] = true;
    });
    reports = reports.filter(function (r) { return ids[r.ReportID]; });
  }

  let rows = reports.map(function (r) {
    const e = emps[r.EmployeeID];
    return {
      reportId: r.ReportID, employeeId: r.EmployeeID, employeeName: e ? e.EmployeeName : r.EmployeeID,
      departmentId: r.DepartmentID, departmentName: depts[r.DepartmentID] ? depts[r.DepartmentID].DepartmentName : r.DepartmentID,
      date: r.ReportDate, status: r.Status, tasks: num(r.TaskTotal), completed: num(r.TaskCompleted), pending: num(r.TaskPending),
      blocked: num(r.TaskBlocked), carried: num(r.TaskCarried), workMinutes: num(r.WorkMinutes), submittedAt: r.SubmittedAt,
      late: bool(r.LateFlag), reviewStatus: r.ReviewStatus || 'NOT REVIEWED', hasBlocker: bool(r.HasBlocker), isDemo: bool(r.IsDemo)
    };
  });

  const wantsMissing = (f.includeNotStarted === true || f.includeNotStarted === 'true' || f.status === REPORT_STATUS.NOT_STARTED) &&
    !f.taskStatus && !f.priority && !f.reviewStatus && !(f.late === true || f.late === 'true') && !(f.hasBlocker === true || f.hasBlocker === 'true');
  if (wantsMissing && daysBetween(from, to) <= LIMITS.NOT_STARTED_MAX_DAYS) {
    const have = {};
    reports.forEach(function (r) { have[r.EmployeeID + '|' + r.ReportDate] = true; });
    let pool = empList.filter(function (e) { return scope.canEmployee(e.EmployeeID); });
    if (f.departmentId) pool = pool.filter(function (e) { return e.DepartmentID === f.departmentId; });
    if (f.employeeId) pool = pool.filter(function (e) { return e.EmployeeID === f.employeeId; });
    if (f.managerId) pool = pool.filter(function (e) { return e.ManagerID === f.managerId; });
    expectedPairs(from, to, pool, s).forEach(function (pr) {
      if (have[pr.emp.EmployeeID + '|' + pr.date]) return;
      rows.push({
        reportId: '', employeeId: pr.emp.EmployeeID, employeeName: pr.emp.EmployeeName, departmentId: pr.emp.DepartmentID,
        departmentName: depts[pr.emp.DepartmentID] ? depts[pr.emp.DepartmentID].DepartmentName : '', date: pr.date,
        status: REPORT_STATUS.NOT_STARTED, tasks: 0, completed: 0, pending: 0, blocked: 0, carried: 0, workMinutes: 0,
        submittedAt: '', late: false, reviewStatus: '', hasBlocker: false, isDemo: bool(pr.emp.IsDemo)
      });
    });
  }
  if (f.status) rows = rows.filter(function (r) { return r.status === f.status; });
  if (f.search) rows = rows.filter(function (r) { return textMatch([r.employeeName, r.employeeId, r.reportId, r.departmentName], f.search); });
  rows.sort(function (a, b) {
    return (a.date < b.date ? 1 : (a.date > b.date ? -1 : 0)) || a.employeeName.localeCompare(b.employeeName);
  });
  return { rows: rows, from: from, to: to };
}

function apiGetReports(p, user) {
  const q = queryReports(user, p.filters || {});
  const pg = paginate(q.rows, p.page, p.pageSize);
  pg.from = q.from;
  pg.to = q.to;
  pg.summary = {
    total: q.rows.length,
    submitted: q.rows.filter(function (r) { return isSubmittedStatus(r.status); }).length,
    late: q.rows.filter(function (r) { return r.status === REPORT_STATUS.LATE; }).length,
    draft: q.rows.filter(function (r) { return r.status === REPORT_STATUS.DRAFT || r.status === REPORT_STATUS.REOPENED; }).length,
    notStarted: q.rows.filter(function (r) { return r.status === REPORT_STATUS.NOT_STARTED; }).length
  };
  return pg;
}

// ---------------- Manager remarks ----------------

function apiSaveManagerRemark(p, user) {
  const comment = cleanText(p.comment, 2000);
  const reviewStatus = REVIEW_STATUSES.indexOf(p.reviewStatus) >= 0 ? p.reviewStatus : 'REVIEWED';
  const priority = PRIORITIES.indexOf(p.priority) >= 0 ? p.priority : 'MEDIUM';
  const followUpRequired = bool(p.followUpRequired);
  const errors = {};
  if (!comment) errors.comment = 'Enter a comment.';
  let owner = null;
  if (followUpRequired) {
    owner = Db.readAll('Employees').filter(function (e) { return e.EmployeeID === p.ownerId && e.Status === 'Active'; })[0];
    if (!owner) errors.ownerId = 'Choose who will own the follow-up.';
    if (!isValidDateStr(p.dueDate)) errors.dueDate = 'Choose a due date.';
  }
  if (Object.keys(errors).length) throw appError('VALIDATION', 'Please correct the highlighted fields.', { fieldErrors: errors });

  const result = Db.withLock(function () {
    const r = getReportOrThrow(cleanText(p.reportId, 40));
    assertCanViewReport(user, r);
    assert(r.EmployeeID !== user.id, 'FORBIDDEN', 'You cannot review your own report.');
    const now = nowIso();
    const remark = { RemarkID: newId('RMK'), ReportID: r.ReportID, AuthorID: user.id, Comment: comment, FollowUpRequired: followUpRequired, Priority: priority, ReviewStatus: followUpRequired ? 'FOLLOW-UP REQUIRED' : reviewStatus, IsDemo: false, CreatedAt: now };
    Db.insert('Remarks', [remark]);
    const before = { reviewStatus: r.ReviewStatus, managerRemarks: r.ManagerRemarks };
    r.ReviewStatus = remark.ReviewStatus;
    r.ManagerRemarks = comment;
    r.UpdatedAt = now;
    Db.update('Reports', [r]);
    let fu = null;
    if (followUpRequired) {
      fu = {
        FollowUpID: newId('FUP'), ReportID: r.ReportID, TaskID: cleanText(p.taskId, 40), EmployeeID: r.EmployeeID, DepartmentID: r.DepartmentID,
        OwnerID: owner.EmployeeID, Title: cleanText(p.followUpTitle, 200) || 'Follow-up on report of ' + humanDate(r.ReportDate), Description: comment,
        Priority: priority, DueDate: p.dueDate, Status: 'OPEN', Source: 'REMARK', Resolution: '', CreatedBy: user.id, IsDemo: false,
        CreatedAt: now, UpdatedAt: now, ResolvedAt: ''
      };
      Db.insert('FollowUps', [fu]);
    }
    return { report: r, remark: remark, followUp: fu, before: before };
  });
  audit(user, 'MANAGER_REMARK_ADDED', 'Report', result.report.ReportID, result.before, { reviewStatus: result.remark.ReviewStatus, comment: comment });
  if (result.followUp) {
    audit(user, 'FOLLOWUP_CREATED', 'FollowUp', result.followUp.FollowUpID, '', { reportId: result.report.ReportID, ownerId: result.followUp.OwnerID });
    safeNotify(function () { Notify.dispatch('FOLLOWUP_ASSIGNED', { followUp: result.followUp }); });
  }
  return { report: publicReport(result.report), remarkId: result.remark.RemarkID, followUpId: result.followUp ? result.followUp.FollowUpID : '' };
}
