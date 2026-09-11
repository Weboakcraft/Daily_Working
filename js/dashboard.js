/** Management views: overview dashboard, daily management summary and department analytics. */
import { api, staleThenFresh } from './api.js';
import {
  html, raw, esc, setHTML, $, $$, on, icon, toast, errorMessage, renderError, skeleton, emptyState, renderTable, field, formValues,
  fmtDate, fmtDateTime, fmtNum, fmtPct, fmtMonth, titleCase, reportLabel, followUpPill, prio, attr,
  RANGE_OPTIONS, rangePreset, hashQuery, setHashQuery, addDays, isoToDateStr, collapsibleFilters
} from './app.js';
import { columnChart, lineChart, hbars, segmented, legendHtml, sparkline, enableTips } from './charts.js';
import { openExportDialog } from './export.js';

/**
 * Starts a request before the screen is ready for it and hands the answer over when it is asked for.
 * `take` returns the in-flight promise only when the filters still match what was requested, so a
 * person who changes a dropdown while the page is loading gets fresh figures, not the primed ones.
 */
function primeRequest(action, payload) {
  const key = JSON.stringify(payload);
  let pending = api(action, payload);
  pending.catch(() => { /* re-thrown to whoever takes it */ });
  return {
    take(current) {
      if (!pending || JSON.stringify(current) !== key) return null;
      const p = pending;
      pending = null;
      return p;
    }
  };
}

async function filterOptions(ctx) {
  const [depts, dir] = await Promise.all([ctx.departments(), ctx.directory()]);
  return {
    depts: depts.map((d) => ({ value: d.departmentId, label: titleCase(d.name) })),
    people: dir.filter((p) => p.inScope).map((p) => ({ value: p.employeeId, label: p.name })),
    managers: dir.filter((p) => p.role !== 'EMPLOYEE').map((p) => ({ value: p.employeeId, label: p.name }))
  };
}

function readRange(q, today, fallback) {
  const preset = q.get('range') || (q.get('from') ? 'custom' : fallback);
  const r = preset === 'custom' ? { from: q.get('from') || today, to: q.get('to') || today } : rangePreset(preset, today);
  return { preset, from: r.from, to: r.to };
}

function bindFilters(form, onApply) {
  let timer = null;
  form.addEventListener('change', (e) => {
    const v = formValues(form);
    $$('[data-custom]', form).forEach((el) => el.classList.toggle('hidden', v.range !== 'custom'));
    if (e.target.name === 'range' && v.range === 'custom') return;
    if (v.range !== 'custom') { delete v.from; delete v.to; }
    clearTimeout(timer);
    timer = setTimeout(() => { setHashQuery(v); onApply(v); }, 50);
  });
  form.addEventListener('submit', (e) => e.preventDefault());
}

function customRangeFields(range, today) {
  return html`<div class="field ${range.preset === 'custom' ? '' : 'hidden'}" data-custom><label for="d-from">From</label><input class="input" type="date" id="d-from" name="from" value="${range.from}" max="${today}"></div>
    <div class="field ${range.preset === 'custom' ? '' : 'hidden'}" data-custom><label for="d-to">To</label><input class="input" type="date" id="d-to" name="to" value="${range.to}" max="${today}"></div>`;
}

const def = (d, key) => d.definitions && d.definitions[key] ? d.definitions[key] : '';

// ============================ Overview ============================

export async function renderOverview(ctx) {
  const c = ctx.content;
  const q = hashQuery();
  const range = readRange(q, ctx.today, 'today');
  setHTML(c, html`${ctx.head('Overview', '', html`<button class="btn" type="button" data-export>${icon('download')}<span class="btn-text">Export</span></button>`)}
    <form class="filters" data-filters></form><div data-body>${skeleton(10)}</div>`);
  // The figures do not depend on the filter dropdowns, so ask for both at once. Each round-trip to
  // Apps Script costs well over a second; running them one after the other doubled the wait for nothing.
  const firstFilters = {
    from: range.from, to: range.to,
    departmentId: q.get('departmentId') || undefined,
    employeeId: q.get('employeeId') || undefined,
    managerId: q.get('managerId') || undefined
  };
  const primed = primeRequest('getDashboardData', firstFilters);

  const opts = await filterOptions(ctx).catch(() => ({ depts: [], people: [], managers: [] }));
  if (!ctx.isCurrent()) return;
  const form = $('[data-filters]', c);
  setHTML(form, html`${field({ name: 'range', label: 'Period', type: 'select', value: range.preset, options: RANGE_OPTIONS })}
    ${customRangeFields(range, ctx.today)}
    ${field({ name: 'departmentId', label: 'Department', type: 'select', value: q.get('departmentId') || '', placeholder: 'All departments', options: opts.depts })}
    ${field({ name: 'employeeId', label: 'Employee', type: 'select', value: q.get('employeeId') || '', placeholder: 'Everyone', options: opts.people })}
    ${ctx.user.role === 'ADMIN' ? field({ name: 'managerId', label: 'Manager', type: 'select', value: q.get('managerId') || '', placeholder: 'Any manager', options: opts.managers }) : ''}`);
  collapsibleFilters(form);
  let lastFilters = {};
  const load = async (v) => {
    const body = $('[data-body]', c);
    const r = v.range === 'custom' ? { from: v.from, to: v.to } : rangePreset(v.range, ctx.today);
    const p = { from: r.from, to: r.to, departmentId: v.departmentId || undefined, employeeId: v.employeeId || undefined, managerId: v.managerId || undefined };
    lastFilters = p;
    body.setAttribute('aria-busy', 'true');
    try {
      const res = await staleThenFresh('getDashboardData', p, (fresh) => {
        if (ctx.isCurrent()) { body.removeAttribute('aria-busy'); drawOverview(ctx, body, fresh); }
      }, primed.take(p) || undefined);
      if (!ctx.isCurrent()) return;
      if (!res.stale) body.removeAttribute('aria-busy');
      drawOverview(ctx, body, res.data);
    } catch (e) { if (ctx.isCurrent()) renderError(body, e, () => load(v)); }
  };
  bindFilters(form, load);
  $('[data-export]', c).onclick = () => openExportDialog(ctx, { dataset: 'REPORTS', filters: lastFilters });
  load(formValues(form));
}

function heroSentence(d, today) {
  const k = d.kpis, single = d.range.from === d.range.to;
  const when = single ? (d.range.from === today ? 'for today' : 'for ' + fmtDate(d.range.from)) : 'between ' + fmtDate(d.range.from, 'tiny') + ' and ' + fmtDate(d.range.to, 'tiny');
  if (!k.reportsExpected) return { line: 'No reports were expected ' + when + '.', sub: 'Weekly offs, holidays and future dates are not counted.' };
  return {
    line: k.reportsSubmitted + ' of ' + k.reportsExpected + ' ' + (single ? 'reports are in ' : 'expected reports came in ') + when + '.',
    sub: [k.lateReports ? k.lateReports + ' submitted late' : 'None late', k.draftReports ? k.draftReports + ' still in draft' : '', (k.reportsPending - k.draftReports) > 0 ? (k.reportsPending - k.draftReports) + ' not started' : ''].filter(Boolean).join(', ') + '.'
  };
}

function heatmapHtml(hm) {
  if (!hm.rows.length) return emptyState('No employees need to report', 'Add employees or change the filters.');
  let lastDept = '';
  const cols = hm.dates.length;
  const rows = [];
  hm.rows.forEach((r) => {
    if (r.department !== lastDept) { rows.push(html`<div class="h-dept">${titleCase(r.department)}</div>`); lastDept = r.department; }
    rows.push(html`<a class="h-name" href="employee.html#analytics/${r.employeeId}" title="${r.name}">${r.name}</a>`);
    r.cells.forEach((st, i) => {
      const dt = hm.dates[i];
      const cls = st.replace(' ', '-');
      const label = r.name + ', ' + fmtDate(dt.date, 'short') + ': ' + (st === 'OFF' ? (dt.note || 'Off') : st === 'NA' ? 'Not applicable' : reportLabel(st));
      rows.push(r.reportIds[i]
        ? html`<a class="sw ${cls}" href="reports.html#view/${r.reportIds[i]}" data-tip="${label}" aria-label="${label}"></a>`
        : html`<span class="sw ${cls}" data-tip="${label}" role="img" aria-label="${label}"></span>`);
    });
  });
  return html`<div class="heat-wrap"><div class="heat" style="grid-template-columns: minmax(110px, 190px) repeat(${cols}, 20px)">
    <span></span>${hm.dates.map((dt) => html`<span class="h-date ${dt.working ? '' : 'off'}">${Number(dt.date.slice(8))}<br>${['S', 'M', 'T', 'W', 'T', 'F', 'S'][new Date(dt.date + 'T00:00:00Z').getUTCDay()]}</span>`)}
    ${rows}</div></div>
    <div class="legend" style="margin-top:12px">
      <span><i class="sw SUBMITTED" style="display:inline-block;width:12px;height:12px"></i>Submitted</span>
      <span><i class="sw LATE" style="display:inline-block;width:12px;height:12px"></i>Late</span>
      <span><i class="sw DRAFT" style="display:inline-block;width:12px;height:12px"></i>Draft or reopened</span>
      <span><i class="sw NOT-STARTED" style="display:inline-block;width:12px;height:12px"></i>Not started</span>
      <span><i class="sw OFF" style="display:inline-block;width:12px;height:12px"></i>Weekly off or holiday</span>
    </div>${hm.truncated ? html`<p class="small muted">Showing the first 80 employees. Filter by department to see everyone.</p>` : ''}`;
}

function drawOverview(ctx, body, d) {
  const k = d.kpis, ch = d.charts, s = d.dailySummary;
  const hero = heroSentence(d, ctx.today);
  const multi = d.range.from !== d.range.to;
  const onTime = k.reportsSubmitted - k.lateReports;
  const notStarted = Math.max(0, k.reportsPending - k.draftReports);
  const att = s.attention;
  setHTML(body, html`
    <section class="hero" aria-label="Report submission">
      <div class="hero-line">${hero.line}</div>
      <p class="hero-sub">${hero.sub}</p>
      ${k.reportsExpected ? segmented([{ label: 'On time', value: onTime, tone: 'ok' }, { label: 'Late', value: k.lateReports, tone: 'warn' }, { label: 'Draft', value: k.draftReports, tone: 'info' }, { label: 'Not started', value: notStarted, tone: 'off' }], k.reportsExpected) : ''}
    </section>
    <div class="ledger">
      <div><span class="fig">${k.totalEmployees}</span><span class="lbl">Active employees</span></div>
      <div><span class="fig">${fmtPct(k.completionPct)}</span><span class="lbl"><abbr title="${def(d, 'completionPct')}">Report completion</abbr></span></div>
      <div><span class="fig ${k.reportsPending ? 'bad' : ''}">${k.reportsPending}</span><span class="lbl"><abbr title="${def(d, 'pending')}">Reports pending</abbr></span></div>
      <div><span class="fig ${k.lateReports ? 'warn' : ''}">${k.lateReports}</span><span class="lbl"><abbr title="${def(d, 'late')}">Late reports</abbr></span></div>
      <div><span class="fig">${fmtNum(k.totalTasks, 0)}</span><span class="lbl"><abbr title="${def(d, 'totalTasks')}">Tasks</abbr></span></div>
      <div><span class="fig ok">${fmtNum(k.completedTasks, 0)}</span><span class="lbl">Completed</span></div>
      <div><span class="fig">${fmtNum(k.pendingTasks, 0)}</span><span class="lbl"><abbr title="${def(d, 'pendingTasks')}">Pending tasks</abbr></span></div>
      <div><span class="fig ${k.blockedTasks ? 'bad' : ''}">${fmtNum(k.blockedTasks, 0)}</span><span class="lbl">Blocked</span></div>
    </div>
    <div class="grid-3" style="align-items:start">
      <div class="panel span-2"><div class="panel-head"><h2>Day ledger</h2><span class="muted">Each square is one person's report for one day</span></div><div class="panel-body" data-heat>${heatmapHtml(ch.heatmap)}</div></div>
      <div class="stack">
        <div class="panel"><div class="panel-head"><h2>Needs attention</h2><a class="small" href="dashboard.html#summary?date=${s.date}">Daily summary</a></div><div class="panel-body">
          <ul class="att-list">
            <li><span>Not submitted, ${fmtDate(s.date, 'short')}</span><strong class="num">${att.notSubmitted.length}</strong></li>
            <li><span>Blockers not yet reviewed</span><strong class="num">${att.unreviewedBlockers.length}</strong></li>
            <li><span>Overdue follow-ups</span><strong class="num">${att.overdueFollowUps.length}</strong></li>
            <li><span>High-priority blocked tasks</span><strong class="num">${s.issues.blockedTasks.filter((t) => t.priority === 'HIGH' || t.priority === 'URGENT').length}</strong></li>
          </ul>
          ${att.unreviewedBlockers.length ? html`<p class="small" style="margin:10px 0 0">Review first: ${att.unreviewedBlockers.slice(0, 3).map((r, i) => html`${i ? ', ' : ''}<a href="reports.html#view/${r.reportId}">${r.employeeName}</a>`)}</p>` : ''}
        </div></div>
        <div class="panel"><div class="panel-head"><h2>Insights</h2></div><div class="panel-body"><ul class="insights">${d.insights.map((i) => html`<li class="${i.severity}"><div><strong>${i.title}</strong><p>${i.detail}</p></div></li>`)}</ul></div></div>
      </div>
    </div>
    <div class="grid-2" style="margin-top:16px">
      <div class="panel"><div class="panel-head"><h2>Submission by department</h2><span class="muted">Submitted of expected</span></div><div class="panel-body">${ch.deptSubmission.length ? hbars(ch.deptSubmission.map((x) => ({ label: titleCase(x.name), value: x.pct, note: x.submitted + '/' + x.expected, href: 'dashboard.html#department/' + x.departmentId, tone: x.pct >= 90 ? 'ok' : x.pct >= 70 ? 'brand' : 'bad' })), { max: 100, format: (v) => fmtNum(v, 0) + '%' }) : emptyState('No reports expected', '')}</div></div>
      <div class="panel"><div class="panel-head"><h2>Tasks by status</h2><span class="muted">${fmtNum(k.totalTasks, 0)} tasks</span></div><div class="panel-body">
        ${k.totalTasks ? segmented([{ label: 'Completed', value: ch.taskStatus.completed, tone: 'ok' }, { label: 'Pending or in progress', value: ch.taskStatus.pending, tone: 'warn' }, { label: 'Blocked', value: ch.taskStatus.blocked, tone: 'bad' }, { label: 'Carried forward', value: ch.taskStatus.carried, tone: 'accent' }]) : emptyState('No tasks recorded', '')}
        <h3 class="section-title" style="margin-top:22px">Department output</h3><div class="chart" data-dept-prod></div>
        ${legendHtml([{ name: 'Completed', tone: 'ok' }, { name: 'Pending', tone: 'warn' }, { name: 'Blocked', tone: 'bad' }, { name: 'Carried forward', tone: 'accent' }])}
      </div></div>
      ${multi ? html`<div class="panel span-2"><div class="panel-head"><h2>Daily submissions</h2><span class="muted">On time, late and missing reports per working day</span></div><div class="panel-body"><div class="chart" data-daily></div>
        ${legendHtml([{ name: 'On time', tone: 'ok' }, { name: 'Late', tone: 'warn' }, { name: 'Not submitted', tone: 'off' }])}</div></div>` : ''}
      <div class="panel"><div class="panel-head"><h2>Monthly report completion</h2><span class="muted">Last 6 months</span></div><div class="panel-body"><div class="chart" data-monthly></div></div></div>
      <div class="panel"><div class="panel-head"><h2>Workload</h2><span class="muted">Most tasks in the period</span></div><div class="panel-body">${ch.workload.length ? hbars(ch.workload.map((w) => ({ label: w.name, value: w.tasks, note: w.hours ? fmtNum(w.hours) + ' h' : '', href: 'employee.html#analytics/' + w.employeeId })), { format: (v) => fmtNum(v, 0) }) : emptyState('No tasks recorded', '')}</div></div>
      ${multi ? html`<div class="panel span-2"><div class="panel-head"><h2>Late submissions</h2><span class="muted">Reports submitted after the deadline and grace period</span></div><div class="panel-body"><div class="chart" data-late></div></div></div>` : ''}
    </div>`);
  enableTips($('[data-heat]', body));
  enableTips(body);
  const prod = ch.deptProductivity;
  if (prod.length) columnChart($('[data-dept-prod]', body), {
    title: 'Tasks by department', stacked: true, height: 220, labels: prod.map((x) => titleCase(x.name)),
    series: [{ name: 'Completed', tone: 'ok', values: prod.map((x) => x.completed) }, { name: 'Pending', tone: 'warn', values: prod.map((x) => x.pending) }, { name: 'Blocked', tone: 'bad', values: prod.map((x) => x.blocked) }, { name: 'Carried forward', tone: 'accent', values: prod.map((x) => x.carried) }],
    format: (v) => fmtNum(v, 0)
  });
  else setHTML($('[data-dept-prod]', body), emptyState('No tasks yet', ''));
  const working = ch.daily.filter((x) => x.working);
  if (multi) columnChart($('[data-daily]', body), {
    title: 'Daily submissions', stacked: true, height: 220, labels: working.map((x) => x.date), labelFormat: (l) => fmtDate(l, 'tiny'),
    series: [{ name: 'On time', tone: 'ok', values: working.map((x) => x.submitted - x.late) }, { name: 'Late', tone: 'warn', values: working.map((x) => x.late) }, { name: 'Not submitted', tone: 'off', values: working.map((x) => x.expected - x.submitted) }],
    format: (v) => fmtNum(v, 0)
  });
  columnChart($('[data-monthly]', body), {
    title: 'Monthly report completion', height: 200, max: 100, labels: ch.monthly.map((x) => fmtMonth(x.month)),
    series: [{ name: 'Completion', tone: 'brand', values: ch.monthly.map((x) => x.pct) }], format: (v) => fmtNum(v, 0) + '%'
  });
  if (multi) lineChart($('[data-late]', body), {
    title: 'Late submissions per day', height: 180, labels: working.map((x) => x.date), labelFormat: (l) => fmtDate(l, 'tiny'),
    series: [{ name: 'Late reports', tone: 'warn', values: working.map((x) => x.late) }], format: (v) => fmtNum(v, 0)
  });
}

// ============================ Daily management summary ============================

export async function renderDailySummary(ctx) {
  const c = ctx.content;
  const q = hashQuery();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(q.get('date') || '') ? q.get('date') : ctx.today;
  setHTML(c, html`${ctx.head('Daily summary', 'What happened, what is stuck and who needs a nudge.', html`
      <button class="btn" type="button" data-copy>${icon('copy')}<span class="btn-text">Copy as text</span></button>
      <button class="btn" type="button" data-print>${icon('print')}<span class="btn-text">Print or PDF</span></button>`)}
    <form class="filters" data-filters>
      <div class="field"><label for="sum-date">Date</label><input class="input" type="date" id="sum-date" name="date" value="${date}" max="${ctx.today}"></div>
    </form><div data-body>${skeleton(10)}</div>`);
  const opts = await filterOptions(ctx).catch(() => ({ depts: [] }));
  if (!ctx.isCurrent()) return;
  const form = $('[data-filters]', c);
  form.insertAdjacentHTML('beforeend', field({ name: 'departmentId', label: 'Department', type: 'select', value: q.get('departmentId') || '', placeholder: 'All departments', options: opts.depts }).s);
  let summary = null;
  const load = async () => {
    const v = formValues(form);
    const body = $('[data-body]', c);
    try {
      const d = await api('getDashboardData', { from: v.date, to: v.date, departmentId: v.departmentId || undefined });
      if (!ctx.isCurrent()) return;
      summary = d.dailySummary;
      drawSummary(body, summary, d);
    } catch (e) { if (ctx.isCurrent()) renderError(body, e, load); }
  };
  form.addEventListener('change', () => { setHashQuery(formValues(form), true); load(); });
  $('[data-print]', c).onclick = () => window.print();
  $('[data-copy]', c).onclick = async () => {
    if (!summary) return;
    const text = summaryText(ctx, summary);
    try { await navigator.clipboard.writeText(text); toast('Summary copied. Paste it into WhatsApp or email.'); }
    catch (e) { toast('Copy is blocked in this browser. Use Print instead.', 'bad'); }
  };
  load();
}

function list(items, render, emptyText) {
  return items.length ? html`<ul class="att-list">${items.map(render)}</ul>` : html`<p class="muted" style="margin:0">${emptyText}</p>`;
}

function drawSummary(body, s, d) {
  const o = s.overview;
  setHTML(body, html`
    <section class="hero"><div class="hero-line">${fmtDate(s.date)}: ${o.submitted} of ${o.expected} reports submitted.</div>
      <p class="hero-sub">${s.workingDay.working ? (o.late + ' late, ' + o.pending + ' pending. Deadline ' + fmtDateTime(s.deadline.deadline).split(', ').pop() + '.') : 'Marked as ' + s.workingDay.reason + '; reports were not expected.'}</p></section>
    <div class="ledger">
      <div><span class="fig">${o.expected}</span><span class="lbl">Expected</span></div>
      <div><span class="fig ok">${o.submitted}</span><span class="lbl">Submitted</span></div>
      <div><span class="fig ${o.pending ? 'bad' : ''}">${o.pending}</span><span class="lbl">Pending</span></div>
      <div><span class="fig ${o.late ? 'warn' : ''}">${o.late}</span><span class="lbl">Late</span></div>
      <div><span class="fig">${fmtPct(o.completionPct)}</span><span class="lbl">Completion</span></div>
      <div><span class="fig ok">${s.work.completed}</span><span class="lbl">Tasks completed</span></div>
      <div><span class="fig">${s.work.pending}</span><span class="lbl">Tasks pending</span></div>
      <div><span class="fig ${s.work.blocked ? 'bad' : ''}">${s.work.blocked}</span><span class="lbl">Tasks blocked</span></div>
    </div>
    <div class="grid-2">
      <div class="panel span-2"><div class="panel-head"><h2>Departments</h2></div><div class="panel-body flush" data-depts></div></div>
      <div class="panel"><div class="panel-head"><h2>Not submitted</h2><span class="muted">${s.attention.notSubmitted.length} people</span></div><div class="panel-body">
        ${list(s.attention.notSubmitted, (p) => html`<li><span>${p.name}<span class="sub"> ${titleCase(p.department)}, ${reportLabel(p.status).toLowerCase()}</span></span>${p.mobile ? html`<a class="btn sm ghost no-print" href="tel:${p.mobile}" aria-label="Call ${p.name}">${icon('phone')}Call</a>` : ''}</li>`, 'Everyone has submitted.')}</div></div>
      <div class="panel"><div class="panel-head"><h2>Blocked tasks</h2></div><div class="panel-body">
        ${list(s.issues.blockedTasks, (t) => html`<li><span><a href="reports.html#view/${t.reportId}">${t.title}</a><span class="sub"> ${t.employeeName}${t.remarks ? ': ' + t.remarks : ''}</span></span>${prio(t.priority)}</li>`, 'No blocked tasks.')}</div></div>
      <div class="panel"><div class="panel-head"><h2>Blockers reported</h2></div><div class="panel-body">
        ${list(s.issues.blockerNotes, (b) => html`<li><span><a href="reports.html#view/${b.reportId}">${b.employeeName}</a><span class="sub"> ${b.text}</span></span></li>`, 'No blockers reported.')}
        ${s.attention.unreviewedBlockers.length ? html`<p class="small" style="margin:10px 0 0"><strong>${s.attention.unreviewedBlockers.length}</strong> of these reports are not reviewed yet.</p>` : ''}</div></div>
      <div class="panel"><div class="panel-head"><h2>Urgent and high-priority follow-ups</h2></div><div class="panel-body">
        ${list(s.issues.urgentFollowUps, (f) => html`<li><span><a href="reports.html#followups?focus=${f.followUpId}">${f.title}</a><span class="sub"> ${f.ownerName ? 'Owner ' + f.ownerName : 'No owner'}${f.dueDate ? ', due ' + fmtDate(f.dueDate, 'short') : ''}</span></span>${followUpPill(f.status, f.overdue)}</li>`, 'None open.')}</div></div>
      <div class="panel"><div class="panel-head"><h2>Overdue follow-ups</h2></div><div class="panel-body">
        ${list(s.attention.overdueFollowUps, (f) => html`<li><span><a href="reports.html#followups?focus=${f.followUpId}">${f.title}</a><span class="sub"> ${f.ownerName || 'No owner'}, due ${fmtDate(f.dueDate, 'short')}</span></span>${prio(f.priority)}</li>`, 'Nothing overdue.')}</div></div>
      <div class="panel"><div class="panel-head"><h2>Reports needing follow-up</h2><span class="muted">Marked by a manager in this period</span></div><div class="panel-body">
        ${list(s.attention.followUpRequired, (r) => html`<li><span><a href="reports.html#view/${r.reportId}">${r.employeeName}, ${fmtDate(r.date, 'short')}</a><span class="sub"> ${r.remarks}</span></span></li>`, 'None.')}</div></div>
    </div>`);
  renderTable($('[data-depts]', body), {
    caption: 'Department summary', rows: s.departments, sortKey: 'pct', sortDir: 'asc',
    empty: emptyState('No departments with expected reports', ''),
    columns: [
      { key: 'name', label: 'Department', primary: true, sortable: true, render: (x) => html`<a href="dashboard.html#department/${x.departmentId}">${titleCase(x.name)}</a>` },
      { key: 'employees', label: 'Expected', align: 'right', sortable: true },
      { key: 'submitted', label: 'Submitted', align: 'right', sortable: true },
      { key: 'pending', label: 'Pending', align: 'right', sortable: true },
      { key: 'late', label: 'Late', align: 'right', sortable: true },
      { key: 'pct', label: 'Completion', align: 'right', sortable: true, render: (x) => fmtPct(x.pct) }
    ]
  });
}

function summaryText(ctx, s) {
  const o = s.overview;
  const lines = [
    ctx.settings.COMPANY_NAME + ': daily summary for ' + fmtDate(s.date),
    'Reports: ' + o.submitted + '/' + o.expected + ' submitted (' + fmtPct(o.completionPct) + '), ' + o.late + ' late, ' + o.pending + ' pending',
    'Tasks: ' + s.work.completed + ' completed, ' + s.work.pending + ' pending, ' + s.work.blocked + ' blocked, ' + s.work.carried + ' carried forward',
    '',
    'By department:'
  ].concat(s.departments.map((dp) => '- ' + titleCase(dp.name) + ': ' + dp.submitted + '/' + dp.employees + (dp.late ? ', ' + dp.late + ' late' : '')));
  if (s.attention.notSubmitted.length) lines.push('', 'Not submitted: ' + s.attention.notSubmitted.map((p) => p.name).join(', '));
  if (s.issues.blockedTasks.length) lines.push('', 'Blocked tasks:', ...s.issues.blockedTasks.slice(0, 10).map((t) => '- ' + t.title + ' (' + t.employeeName + ', ' + titleCase(t.priority) + ')'));
  if (s.issues.blockerNotes.length) lines.push('', 'Blockers reported:', ...s.issues.blockerNotes.slice(0, 10).map((b) => '- ' + b.employeeName + ': ' + b.text));
  if (s.attention.overdueFollowUps.length) lines.push('', 'Overdue follow-ups:', ...s.attention.overdueFollowUps.slice(0, 10).map((f) => '- ' + f.title + ' (' + (f.ownerName || 'no owner') + ')'));
  return lines.join('\n');
}

// ============================ Department analytics ============================

export async function renderDepartmentAnalytics(ctx, args) {
  const c = ctx.content;
  const q = hashQuery();
  const range = readRange(q, ctx.today, 'last30');
  setHTML(c, html`${ctx.head('Department analytics', '', html`<button class="btn" type="button" data-export>${icon('download')}<span class="btn-text">Export numbers</span></button>`)}<form class="filters" data-filters></form><div data-body>${skeleton(10)}</div>`);
  let depts;
  try { depts = await ctx.departments(); } catch (e) { if (ctx.isCurrent()) renderError($('[data-body]', c), e, () => renderDepartmentAnalytics(ctx, args)); return; }
  if (!ctx.isCurrent()) return;
  let deptId = args[0] || '';
  if (!deptId || !depts.some((d) => d.departmentId === deptId)) {
    const mine = depts.find((d) => d.managerId === ctx.user.id) || depts.find((d) => d.departmentId === ctx.user.departmentId) || depts[0];
    deptId = mine ? mine.departmentId : '';
  }
  if (!deptId) { setHTML($('[data-body]', c), emptyState('No departments yet', 'Create departments in Administration first.')); return; }
  const form = $('[data-filters]', c);
  setHTML(form, html`${field({ name: 'dept', label: 'Department', type: 'select', value: deptId, options: depts.map((d) => ({ value: d.departmentId, label: titleCase(d.name) })) })}
    ${field({ name: 'range', label: 'Period', type: 'select', value: range.preset, options: RANGE_OPTIONS.filter((o) => o.value !== 'today' && o.value !== 'yesterday') })}
    ${customRangeFields(range, ctx.today)}`);
  let lastFilters = {};
  const load = async (v) => {
    const body = $('[data-body]', c);
    const r = v.range === 'custom' ? { from: v.from, to: v.to } : rangePreset(v.range, ctx.today);
    lastFilters = { from: r.from, to: r.to, departmentId: v.dept };
    try {
      const d = await api('getDepartmentAnalytics', { departmentId: v.dept, from: r.from, to: r.to });
      if (!ctx.isCurrent()) return;
      drawDepartment(ctx, body, d);
    } catch (e) { if (ctx.isCurrent()) renderError(body, e, () => load(v)); }
  };
  form.addEventListener('change', (e) => {
    const v = formValues(form);
    $$('[data-custom]', form).forEach((el) => el.classList.toggle('hidden', v.range !== 'custom'));
    if (e.target.name === 'range' && v.range === 'custom') return;
    const query = { range: v.range }; if (v.range === 'custom') { query.from = v.from; query.to = v.to; }
    history.replaceState(null, '', '#department/' + v.dept + (new URLSearchParams(query).toString() ? '?' + new URLSearchParams(query).toString() : ''));
    load(v);
  });
  $('[data-export]', c).onclick = () => openExportDialog(ctx, { dataset: 'KPI', filters: lastFilters, datasets: ['KPI', 'REPORTS', 'TASKS'] });
  load(formValues(form));
}

function drawDepartment(ctx, body, d) {
  const k = d.kpis;
  document.title = titleCase(d.department.name) + ' analytics | ' + ctx.settings.COMPANY_NAME;
  setHTML(body, html`
    <section class="hero"><div class="hero-line">${titleCase(d.department.name)}: ${fmtPct(k.completionPct)} of expected reports submitted, ${fmtPct(k.taskCompletionPct)} of tasks completed.</div>
      <p class="hero-sub">${fmtDate(d.range.from)} to ${fmtDate(d.range.to)}${d.department.managerName ? '. Managed by ' + d.department.managerName : ''}.</p></section>
    <div class="ledger">
      <div><span class="fig">${k.employees}</span><span class="lbl">Active employees</span></div>
      <div><span class="fig">${k.submitted}<span class="muted" style="font-size:18px"> / ${k.expected}</span></span><span class="lbl">Reports submitted</span></div>
      <div><span class="fig ${k.late ? 'warn' : ''}">${k.late}</span><span class="lbl">Late</span></div>
      <div><span class="fig">${fmtNum(k.totalTasks, 0)}</span><span class="lbl">Tasks</span></div>
      <div><span class="fig ok">${fmtNum(k.completedTasks, 0)}</span><span class="lbl">Completed</span></div>
      <div><span class="fig ${k.blockedTasks ? 'bad' : ''}">${k.blockedTasks}</span><span class="lbl">Blocked</span></div>
      <div><span class="fig">${fmtNum(k.hours)}</span><span class="lbl">Hours recorded</span></div>
    </div>
    <div class="grid-2">
      <div class="panel span-2"><div class="panel-head"><h2>Department numbers</h2><span class="muted">From submitted reports</span></div><div class="panel-body flush" data-kpis></div></div>
      <div class="panel span-2"><div class="panel-head"><h2>Trend</h2>
        <div class="tabs" role="tablist" style="margin:0;border:0">${['daily', 'weekly', 'monthly'].map((t, i) => html`<button type="button" role="tab" data-trend-tab="${t}" aria-selected="${i === 0}">${titleCase(t)}</button>`)}</div></div>
        <div class="panel-body"><div class="chart" data-trend></div>${legendHtml([{ name: 'Tasks completed', tone: 'ok' }, { name: 'Other tasks', tone: 'off' }])}
          <h3 class="section-title" style="margin-top:18px">Report submission</h3><div class="chart" data-trend-pct></div></div></div>
      <div class="panel span-2"><div class="panel-head"><h2>Employee comparison</h2><span class="muted">Select a column to sort</span></div><div class="panel-body flush" data-emps></div></div>
    </div>`);
  renderTable($('[data-kpis]', body), {
    caption: 'Department numbers', rows: d.departmentKpis,
    empty: emptyState('No numeric questions for this department', 'Add number questions in Report questions to track them here.'),
    columns: [
      { key: 'text', label: 'Measure', primary: true, sortable: true, render: (x) => html`${x.text}${x.active ? '' : html` <span class="pill off plain">Retired</span>`}` },
      { key: 'total', label: 'Total', align: 'right', sortable: true, render: (x) => /₹/.test(x.text) ? '₹' + fmtNum(x.total, 0) : fmtNum(x.total) },
      { key: 'avgPerReport', label: 'Per report', align: 'right', sortable: true, render: (x) => fmtNum(x.avgPerReport) },
      { key: 'target', label: 'Target per report', align: 'right', render: (x) => x.target ? html`${fmtNum(x.target)}<span class="sub">${fmtPct(x.avgPerReport * 100 / x.target)} achieved</span>` : '' },
      { key: 'series', label: 'Daily', render: (x) => raw(sparkline(x.series, 'brand')) }
    ]
  });
  const drawTrend = (mode) => {
    const src = mode === 'daily' ? d.daily.filter((x) => x.working || x.tasks) : mode === 'weekly' ? d.weekly : d.monthly;
    const labels = src.map((x) => mode === 'daily' ? x.date : mode === 'weekly' ? x.week : x.month);
    const lf = (l) => mode === 'monthly' ? fmtMonth(l) : fmtDate(l, 'tiny');
    columnChart($('[data-trend]', body), {
      title: 'Tasks per ' + mode.replace('ly', '').replace('dai', 'day'), stacked: true, height: 220, labels, labelFormat: lf,
      series: [{ name: 'Tasks completed', tone: 'ok', values: src.map((x) => mode === 'monthly' ? Math.round(x.tasks * x.taskCompletionPct / 100) : x.completed) },
        { name: 'Other tasks', tone: 'off', values: src.map((x) => mode === 'monthly' ? x.tasks - Math.round(x.tasks * x.taskCompletionPct / 100) : x.tasks - x.completed) }],
      format: (v) => fmtNum(v, 0)
    });
    lineChart($('[data-trend-pct]', body), {
      title: 'Report submission rate', height: 170, max: 100, labels, labelFormat: lf,
      series: [{ name: 'Submitted', tone: 'brand', values: src.map((x) => x.expected ? x.pct : null) }], format: (v) => fmtNum(v, 0) + '%'
    });
  };
  drawTrend('daily');
  on(body, 'click', '[data-trend-tab]', (e, b) => { $$('[data-trend-tab]', body).forEach((x) => x.setAttribute('aria-selected', String(x === b))); drawTrend(b.dataset.trendTab); });
  renderTable($('[data-emps]', body), {
    caption: 'Employee comparison', rows: d.employees, sortKey: 'name',
    empty: emptyState('No employees in this department', ''),
    columns: [
      { key: 'name', label: 'Employee', primary: true, sortable: true, render: (x) => html`<a href="employee.html#analytics/${x.employeeId}?from=${d.range.from}&to=${d.range.to}&range=custom">${x.name}</a><span class="sub">${x.designation}</span>` },
      { key: 'submissionPct', label: 'Reports', align: 'right', sortable: true, render: (x) => html`${x.submitted}/${x.expected}<span class="sub">${fmtPct(x.submissionPct)}</span>` },
      { key: 'late', label: 'Late', align: 'right', sortable: true },
      { key: 'tasks', label: 'Tasks', align: 'right', sortable: true },
      { key: 'taskCompletionPct', label: 'Completed', align: 'right', sortable: true, render: (x) => html`${x.completed}<span class="sub">${fmtPct(x.taskCompletionPct)}</span>` },
      { key: 'blocked', label: 'Blocked', align: 'right', sortable: true },
      { key: 'hours', label: 'Hours', align: 'right', sortable: true, render: (x) => fmtNum(x.hours) },
      ...d.kpiColumns.map((label, i) => ({ key: 'kpi' + i, label, align: 'right', sortable: true, value: (x) => x.kpis[i], render: (x) => /₹/.test(label) ? '₹' + fmtNum(x.kpis[i], 0) : fmtNum(x.kpis[i]) }))
    ]
  });
}
