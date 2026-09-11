/** Employee dashboard (home), employee analytics and profile. */
import { api, ApiError } from './api.js';
import {
  html, setHTML, $, $$, on, icon, toast, errorMessage, renderError, skeleton, emptyState, renderTable, field, showFieldErrors,
  withBusy, fmtDate, fmtDateTime, fmtTime, fmtHm, fmtNum, fmtPct, fmtMinutes, fmtMonth, titleCase, reportPill, followUpPill, prio,
  taskPill, reviewPill, attr, RANGE_OPTIONS, rangePreset, hashQuery, setHashQuery, initials
} from './app.js';
import { columnChart, lineChart, legendHtml } from './charts.js';

export function scorePanel(score, opts) {
  if (!score) return '';
  return html`<div class="panel"><div class="panel-head"><h2>${opts && opts.title || 'Productivity score'}</h2><span class="muted">${opts && opts.period || ''}</span></div>
    <div class="panel-body"><div class="score">
      <div><div class="score-fig">${score.score === null ? '–' : fmtNum(score.score, 0)}<small>${score.score === null ? '' : ' / 100'}</small></div>
        <p class="small muted" style="margin-top:8px">${score.score === null ? 'Not enough data yet.' : 'Weighted average of the parts on the right.'}</p></div>
      <div>${score.components.map((c) => html`<div class="comp ${c.included ? '' : 'excluded'}">
          <span>${c.label}</span>
          <span class="bar" aria-hidden="true"><span style="width:${c.value === null ? 0 : Math.min(100, c.value)}%"></span></span>
          <strong class="num" style="text-align:right">${c.value === null ? '–' : fmtNum(c.value, 0)}</strong>
          <span class="why">${c.included ? fmtNum(c.effectiveWeight, 0) + '% of the score. ' : 'Not counted. '}${c.explanation}</span></div>`)}
        <p class="small muted" style="margin:10px 0 0">${score.explanation}</p></div>
    </div></div></div>`;
}

// ============================ Home ============================

/** A small hello, so the first thing on screen is not a deadline. */
function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

export async function renderMyDashboard(ctx) {
  const c = ctx.content;
  setHTML(c, html`${ctx.head('Home')}${skeleton(6)}`);
  let d;
  try { d = await api('getMyDashboard'); } catch (e) { if (ctx.isCurrent()) { setHTML(c, ctx.head('Home')); const b = document.createElement('div'); c.appendChild(b); renderError(b, e, () => renderMyDashboard(ctx)); } return; }
  if (!ctx.isCurrent()) return;
  const t = d.today, st = t.status;
  const due = fmtHm(t.deadline.time);
  const pastDue = Date.now() > new Date(t.deadline.graceEnd).getTime();
  let line, cta;
  if (!t.workingDay.working) { line = html`Today is ${t.workingDay.reason.toLowerCase()}. No report is expected.`; cta = html`<a class="btn" href="employee.html#today">Submit a report anyway</a>`; }
  else if (st === 'SUBMITTED' || st === 'LATE') { line = html`Today's report is in${st === 'LATE' ? ', marked late' : ''}.`; cta = html`<a class="btn" href="reports.html#view/${t.report.reportId}">View today's report</a>`; }
  else if (st === 'DRAFT' || st === 'REOPENED') { line = pastDue ? html`Your draft is saved, and the deadline has passed. Submit it now.` : html`Your draft is saved. Submit it by ${due}.`; cta = html`<a class="btn primary" href="employee.html#today">${icon('pen')}Continue today's report</a>`; }
  else { line = pastDue ? html`Today's report is not started, and the ${due} deadline has passed.` : html`Today's report is not started. It is due by ${due}.`; cta = html`<a class="btn primary" href="employee.html#today">${icon('pen')}Start today's report</a>`; }
  const m = d.month;
  const firstName = ctx.user.name.split(' ')[0];

  setHTML(c, html`
    <div class="hero"><p class="muted" style="margin:0 0 4px">${greeting()}, ${firstName} \u00B7 ${fmtDate(t.date)}</p>
      <div class="hero-line">${line}</div>
      ${t.tasks.total ? html`<p class="hero-sub">${t.tasks.total} ${t.tasks.total === 1 ? 'task' : 'tasks'} recorded today, ${t.tasks.completed} completed${t.tasks.blocked ? ', ' + t.tasks.blocked + ' blocked' : ''}.</p>` : ''}
      <div class="row" style="margin-top:14px">${cta}</div></div>
    <h2 style="margin:8px 0 10px">This month</h2>
    <div class="ledger">
      <div><span class="fig">${m.submitted}<span class="muted" style="font-size:18px"> / ${m.expected}</span></span><span class="lbl">Reports submitted</span></div>
      <div><span class="fig ${m.late ? 'warn' : ''}">${m.late}</span><span class="lbl">Submitted late</span></div>
      <div><span class="fig">${m.completedTasks}<span class="muted" style="font-size:18px"> / ${m.totalTasks}</span></span><span class="lbl">Tasks completed</span></div>
      <div><span class="fig">${fmtPct(m.taskCompletionPct)}</span><span class="lbl">Task completion</span></div>
      <div><span class="fig">${fmtNum(m.avgHoursPerDay)}</span><span class="lbl">Hours recorded per report</span></div>
    </div>
    <div class="grid-2">
      <div class="panel"><div class="panel-head"><h2>Unfinished work</h2><span class="muted">${d.carryForwardCount} open from earlier days</span></div>
        <div class="panel-body">${d.carryForward.length ? html`<ul class="att-list">${d.carryForward.map((x) => html`<li><span>${x.title}<span class="sub"> from ${fmtDate(x.reportDate, 'short')}</span></span>${taskPill(x.status)}</li>`)}</ul>
          <p style="margin:10px 0 0"><a href="employee.html#today">Handle these in today's report</a></p>` : emptyState('Nothing carried over', 'Open tasks from earlier days show up here.')}</div></div>
      <div class="panel"><div class="panel-head"><h2>Follow-ups for you</h2><a class="small" href="reports.html#followups">All follow-ups</a></div>
        <div class="panel-body">${d.followUps.length ? html`<ul class="att-list">${d.followUps.map((f) => html`<li><span><a href="reports.html#followups?focus=${f.followUpId}">${f.title}</a><span class="sub"> ${f.dueDate ? 'due ' + fmtDate(f.dueDate, 'short') : 'no due date'}</span></span>${followUpPill(f.status, f.overdue)}</li>`)}</ul>` : emptyState('No open follow-ups', 'When your manager asks you to follow up on something, it appears here.')}</div></div>
      <div class="panel ${d.score ? '' : 'span-2'}"><div class="panel-head"><h2>Last 8 weeks</h2><span class="muted">Weekly percentages</span></div>
        <div class="panel-body"><div class="chart" data-trend></div>${legendHtml([{ name: 'Reports submitted', tone: 'brand' }, { name: 'Tasks completed', tone: 'info' }])}</div></div>
      ${d.score ? html`<div>${scorePanel(d.score, { period: 'Last 30 days' })}</div>` : ''}
    </div>
    <div class="panel" style="margin-top:16px"><div class="panel-head"><h2>Recent reports</h2><a class="small" href="employee.html#history">All my reports</a></div><div class="panel-body flush" data-recent></div></div>`);

  lineChart($('[data-trend]', c), {
    title: 'Weekly report submission and task completion',
    labels: d.trend.map((w) => fmtDate(w.week, 'tiny')),
    series: [{ name: 'Reports submitted', tone: 'brand', values: d.trend.map((w) => w.expected ? w.submissionPct : null) }, { name: 'Tasks completed', tone: 'info', values: d.trend.map((w) => w.tasks ? w.taskCompletionPct : null) }],
    max: 100, format: (v) => fmtNum(v, 0) + '%', height: 200
  });
  renderTable($('[data-recent]', c), {
    caption: 'Recent reports',
    rows: d.recentReports,
    rowHref: (r) => 'reports.html#view/' + r.reportId,
    empty: emptyState('No reports yet', 'Your submitted reports will be listed here.', html`<a class="btn primary" href="employee.html#today">Start today's report</a>`),
    columns: [
      { key: 'date', label: 'Date', primary: true, render: (r) => html`<a href="reports.html#view/${r.reportId}">${fmtDate(r.date, 'short')}</a>` },
      { key: 'status', label: 'Status', render: (r) => reportPill(r.status) },
      { key: 'taskTotal', label: 'Tasks', align: 'right', render: (r) => html`${r.taskCompleted} of ${r.taskTotal} done` },
      { key: 'reviewStatus', label: 'Review', render: (r) => reviewPill(r.reviewStatus) },
      { key: 'submittedAt', label: 'Submitted', render: (r) => r.submittedAt ? fmtTime(r.submittedAt) : '' }
    ]
  });
}

// ============================ Employee analytics ============================

export async function renderEmployeeAnalytics(ctx, args) {
  const c = ctx.content;
  const employeeId = args[0] || ctx.user.id;
  const q = hashQuery();
  const preset = q.get('range') || (q.get('from') ? 'custom' : 'last30');
  const r = preset === 'custom' ? { from: q.get('from') || ctx.today, to: q.get('to') || ctx.today } : rangePreset(preset, ctx.today);
  const self = employeeId === ctx.user.id;
  setHTML(c, html`${ctx.head(self ? 'My analytics' : 'Employee analytics')}
    <form class="filters" data-filters>
      ${field({ name: 'range', label: 'Period', type: 'select', value: preset, options: RANGE_OPTIONS.filter((o) => o.value !== 'today' && o.value !== 'yesterday') })}
      <div class="field ${preset === 'custom' ? '' : 'hidden'}" data-custom><label for="ea-from">From</label><input class="input" type="date" id="ea-from" name="from" value="${r.from}" max="${ctx.today}"></div>
      <div class="field ${preset === 'custom' ? '' : 'hidden'}" data-custom><label for="ea-to">To</label><input class="input" type="date" id="ea-to" name="to" value="${r.to}" max="${ctx.today}"></div>
    </form><div data-body>${skeleton(8)}</div>`);
  const form = $('[data-filters]', c);
  form.onchange = (e) => {
    const v = { range: form.range.value };
    $$('[data-custom]', form).forEach((el) => el.classList.toggle('hidden', v.range !== 'custom'));
    if (v.range === 'custom') { if (e.target.name === 'range') return; v.from = form.from.value; v.to = form.to.value; }
    setHashQuery(v);
    renderEmployeeAnalytics(ctx, args);
  };
  const body = $('[data-body]', c);
  let d;
  try { d = await api('getEmployeeAnalytics', { employeeId, from: r.from, to: r.to }); } catch (e) { if (ctx.isCurrent()) renderError(body, e, () => renderEmployeeAnalytics(ctx, args)); return; }
  if (!ctx.isCurrent()) return;
  const e = d.employee, m = d.metrics;
  document.title = (self ? 'My analytics' : e.name) + ' | ' + ctx.settings.COMPANY_NAME;
  const heading = $('.page-head h1', c);
  if (!self) heading.textContent = e.name;
  setHTML(body, html`
    <div class="row" style="margin-bottom:16px;gap:14px"><span class="avatar" style="width:44px;height:44px;font-size:16px">${initials(e.name)}</span>
      <div><strong>${e.name}</strong> <span class="muted">${e.employeeId}</span><div class="muted small">${e.designation || titleCase(e.role)}, ${titleCase(e.departmentName)}${e.managerName ? ', reports to ' + e.managerName : ''}${e.status !== 'Active' ? ', inactive' : ''}</div></div>
      ${ctx.user.role !== 'EMPLOYEE' ? html`<a class="btn sm" style="margin-left:auto" href="reports.html#list?employeeId=${e.employeeId}&from=${d.range.from}&to=${d.range.to}">${icon('doc')}View reports</a>` : ''}
    </div>
    <p class="muted small" style="margin:-6px 0 12px">${fmtDate(d.range.from)} to ${fmtDate(d.range.to)}</p>
    <div class="ledger">
      <div><span class="fig">${m.submitted}<span class="muted" style="font-size:18px"> / ${m.expected}</span></span><span class="lbl">Reports submitted</span></div>
      <div><span class="fig">${fmtPct(m.submissionPct)}</span><span class="lbl">Submission rate</span></div>
      <div><span class="fig ${m.late ? 'warn' : ''}">${m.late}</span><span class="lbl">Late</span></div>
      <div><span class="fig">${m.completedTasks}<span class="muted" style="font-size:18px"> / ${m.totalTasks}</span></span><span class="lbl">Tasks completed</span></div>
      <div><span class="fig ${m.blockedTasks ? 'bad' : ''}">${m.blockedTasks}</span><span class="lbl">Blocked tasks</span></div>
      <div><span class="fig">${fmtNum(m.avgTasksPerDay)}</span><span class="lbl">Tasks per report</span></div>
      <div><span class="fig">${fmtNum(m.avgHoursPerDay)}</span><span class="lbl">Hours per report</span></div>
    </div>
    ${scorePanel(d.score, { period: fmtDate(d.range.from, 'tiny') + ' to ' + fmtDate(d.range.to, 'tiny') })}
    <div class="grid-2" style="margin-top:16px">
      <div class="panel span-2"><div class="panel-head"><h2>Day by day</h2><span class="muted">Tasks recorded in each report</span></div>
        <div class="panel-body"><div class="chart" data-daily></div>${legendHtml([{ name: 'Completed', tone: 'ok' }, { name: 'Other tasks', tone: 'off' }])}</div></div>
      <div class="panel"><div class="panel-head"><h2>Monthly trend</h2><span class="muted">Last 6 months</span></div>
        <div class="panel-body"><div class="chart" data-monthly></div>${legendHtml([{ name: 'Reports submitted', tone: 'brand' }, { name: 'Tasks completed', tone: 'info' }])}</div></div>
      <div class="panel"><div class="panel-head"><h2>Work by category</h2></div><div class="panel-body flush" data-cats></div></div>
      <div class="panel"><div class="panel-head"><h2>Department numbers</h2><span class="muted">Totals from submitted reports</span></div><div class="panel-body flush" data-kpis></div></div>
      <div class="panel"><div class="panel-head"><h2>Reports in this period</h2></div><div class="panel-body flush" data-recent></div></div>
    </div>`);

  columnChart($('[data-daily]', body), {
    title: 'Tasks per day', stacked: true, height: 200,
    labels: d.daily.map((x) => x.date), labelFormat: (l) => fmtDate(l, 'tiny'),
    series: [{ name: 'Completed', tone: 'ok', values: d.daily.map((x) => x.completed) }, { name: 'Other tasks', tone: 'off', values: d.daily.map((x) => x.tasks - x.completed) }],
    format: (v) => fmtNum(v, 0)
  });
  lineChart($('[data-monthly]', body), {
    title: 'Monthly submission and task completion', height: 200, max: 100, format: (v) => fmtNum(v, 0) + '%',
    labels: d.monthly.map((x) => fmtMonth(x.month)),
    series: [{ name: 'Reports submitted', tone: 'brand', values: d.monthly.map((x) => x.expected ? x.submissionPct : null) }, { name: 'Tasks completed', tone: 'info', values: d.monthly.map((x) => x.tasks ? x.taskCompletionPct : null) }]
  });
  renderTable($('[data-cats]', body), {
    caption: 'Work by category', rows: d.categories, sortKey: 'tasks', sortDir: 'desc',
    empty: emptyState('No tasks in this period', ''),
    columns: [
      { key: 'category', label: 'Category', primary: true, sortable: true },
      { key: 'tasks', label: 'Tasks', align: 'right', sortable: true },
      { key: 'completed', label: 'Completed', align: 'right', sortable: true },
      { key: 'hours', label: 'Hours', align: 'right', sortable: true, render: (x) => fmtNum(x.hours) }
    ]
  });
  renderTable($('[data-kpis]', body), {
    caption: 'Department numbers', rows: d.kpis,
    empty: emptyState('No department numbers', 'Numbers appear once reports with department questions are submitted.'),
    columns: [
      { key: 'text', label: 'Measure', primary: true },
      { key: 'total', label: 'Total', align: 'right', render: (x) => /₹/.test(x.text) ? '₹' + fmtNum(x.total, 0) : fmtNum(x.total) },
      { key: 'avgPerReport', label: 'Per report', align: 'right', render: (x) => fmtNum(x.avgPerReport) },
      { key: 'target', label: 'Daily target', align: 'right', render: (x) => x.target ? fmtNum(x.target) : '' }
    ]
  });
  renderTable($('[data-recent]', body), {
    caption: 'Reports in this period', rows: d.recentReports, rowHref: (x) => 'reports.html#view/' + x.reportId,
    empty: emptyState('No reports in this period', ''),
    columns: [
      { key: 'date', label: 'Date', primary: true, render: (x) => html`<a href="reports.html#view/${x.reportId}">${fmtDate(x.date, 'short')}</a>` },
      { key: 'status', label: 'Status', render: (x) => reportPill(x.status) },
      { key: 'taskTotal', label: 'Tasks', align: 'right', render: (x) => html`${x.taskCompleted}/${x.taskTotal}` }
    ]
  });
}

// ============================ Profile ============================

export async function renderProfile(ctx) {
  const c = ctx.content;
  setHTML(c, html`${ctx.head('Profile and password')}${skeleton(5)}`);
  let e;
  try { e = await api('getEmployee'); } catch (err) { if (ctx.isCurrent()) renderError(c, err, () => renderProfile(ctx)); return; }
  if (!ctx.isCurrent()) return;
  setHTML(c, html`${ctx.head('Profile and password', 'Contact the admin to change your details.')}
    <div class="grid-2">
      <div class="panel"><div class="panel-head"><h2>Your details</h2></div><div class="panel-body">
        <dl class="kv">
          <dt>Name</dt><dd>${e.name}</dd><dt>Employee ID</dt><dd>${e.employeeId}</dd><dt>Username</dt><dd>${e.username}</dd>
          <dt>Department</dt><dd>${titleCase(e.departmentName)}</dd><dt>Designation</dt><dd>${e.designation || '–'}</dd>
          <dt>Role</dt><dd>${titleCase(e.role)}</dd><dt>Reports to</dt><dd>${e.managerName || '–'}</dd>
          <dt>Email</dt><dd>${e.email || '–'}</dd><dt>Mobile</dt><dd>${e.mobile || '–'}</dd>
          <dt>Joined</dt><dd>${e.joiningDate ? fmtDate(e.joiningDate) : '–'}</dd><dt>Daily report</dt><dd>${e.reportRequired ? 'Required' : 'Optional'}</dd>
        </dl></div></div>
      <div class="panel"><div class="panel-head"><h2>Change password</h2></div><div class="panel-body">
        <form class="stack" data-pw novalidate>
          ${field({ name: 'currentPassword', label: 'Current password', type: 'password', required: true, autocomplete: 'current-password' })}
          ${field({ name: 'newPassword', label: 'New password', type: 'password', required: true, autocomplete: 'new-password', hint: 'At least 8 characters with letters and numbers.' })}
          ${field({ name: 'confirmPassword', label: 'Repeat new password', type: 'password', required: true, autocomplete: 'new-password' })}
          <button class="btn primary" type="submit">Change password</button>
          <p class="small muted" style="margin:0">Other devices signed in to your account will be signed out.</p>
        </form></div></div>
    </div>`);
  const form = $('[data-pw]', c);
  form.onsubmit = async (ev) => {
    ev.preventDefault();
    const v = { currentPassword: form.currentPassword.value, newPassword: form.newPassword.value, confirmPassword: form.confirmPassword.value };
    const errors = {};
    if (!v.currentPassword) errors.currentPassword = 'Enter your current password.';
    if (v.newPassword.length < 8 || !/[A-Za-z]/.test(v.newPassword) || !/\d/.test(v.newPassword)) errors.newPassword = 'Use at least 8 characters with letters and numbers.';
    if (v.newPassword !== v.confirmPassword) errors.confirmPassword = 'The passwords do not match.';
    if (showFieldErrors(form, errors)) return;
    await withBusy(form.querySelector('[type="submit"]'), async () => {
      try {
        await api('changePassword', { currentPassword: v.currentPassword, newPassword: v.newPassword }, { write: true });
        form.reset();
        toast('Password changed.');
      } catch (err) {
        if (err instanceof ApiError && err.fieldErrors) showFieldErrors(form, err.fieldErrors); else toast(errorMessage(err), 'bad');
      }
    });
  };
}
