/** Reports list, report detail (review, remarks, reopen), tasks and follow-ups. */
import { api, ApiError } from './api.js';
import {
  html, setHTML, $, $$, on, icon, toast, errorMessage, renderError, skeleton, emptyState, renderTable, pagerHtml, field,
  formValues, showFieldErrors, submitForm, withBusy, openModal, confirmDialog, promptDialog, attr, raw,
  fmtDate, fmtDateTime, fmtTime, fmtNum, fmtMinutes, titleCase, reportPill, reportLabel, taskPill, reviewPill, followUpPill, prio,
  RANGE_OPTIONS, rangePreset, hashQuery, setHashQuery, addDays, TASK_STATUS_OPTIONS, PRIORITY_OPTIONS, collapsibleFilters
} from './app.js';
import { SECTION_LABELS } from './question-controls.js';
import { openExportDialog } from './export.js';
import { canShareOnWhatsApp, whatsAppButtonHtml, bindWhatsAppButton } from './whatsapp.js';

const REPORT_STATUSES = ['SUBMITTED', 'LATE', 'DRAFT', 'REOPENED', 'NOT STARTED'];
const REVIEW_STATUSES = ['NOT REVIEWED', 'REVIEWED', 'FOLLOW-UP REQUIRED', 'RESOLVED'];

function rangeFromQuery(q, today, fallback) {
  const preset = q.get('range') || (q.get('from') ? 'custom' : fallback);
  const r = preset === 'custom' ? { from: q.get('from') || today, to: q.get('to') || today } : rangePreset(preset, today);
  return { preset, from: r.from, to: r.to };
}

function rangeFields(range, today) {
  return html`${field({ name: 'range', label: 'Period', type: 'select', value: range.preset, options: RANGE_OPTIONS })}
    <div class="field ${range.preset === 'custom' ? '' : 'hidden'}" data-custom><label for="flt-from">From</label><input class="input" type="date" id="flt-from" name="from" value="${range.from}" max="${today}"></div>
    <div class="field ${range.preset === 'custom' ? '' : 'hidden'}" data-custom><label for="flt-to">To</label><input class="input" type="date" id="flt-to" name="to" value="${range.to}" max="${today}"></div>`;
}

/** Wires a filter form to the URL: changing a filter updates the hash query and reloads data. */
function bindFilterForm(form, onApply) {
  let timer = null;
  const apply = (e) => {
    const v = formValues(form);
    $$('[data-custom]', form).forEach((el) => el.classList.toggle('hidden', v.range !== 'custom'));
    if (e && e.target && e.target.name === 'range' && v.range === 'custom') return;
    if (v.range !== 'custom') { delete v.from; delete v.to; }
    setHashQuery(v);
    onApply(v);
  };
  form.addEventListener('change', (e) => { if (e.target.type !== 'search') apply(e); });
  form.addEventListener('input', (e) => { if (e.target.type === 'search') { clearTimeout(timer); timer = setTimeout(() => apply(e), 400); } });
  form.addEventListener('submit', (e) => { e.preventDefault(); apply(e); });
}

async function peopleOptions(ctx) {
  if (ctx.user.role === 'EMPLOYEE') return { depts: [], people: [] };
  const [depts, dir] = await Promise.all([ctx.departments(), ctx.directory()]);
  return { depts: depts.map((d) => ({ value: d.departmentId, label: titleCase(d.name) })), people: dir.filter((p) => p.inScope).map((p) => ({ value: p.employeeId, label: p.name })) };
}

// ============================ Report list ============================

export async function renderReportList(ctx, args, opts) {
  opts = opts || {};
  const mine = !!opts.mine;
  const c = ctx.content;
  const q = hashQuery();
  const range = rangeFromQuery(q, ctx.today, mine ? 'last30' : 'last7');
  const mgmt = ctx.user.role !== 'EMPLOYEE' && !mine;
  const title = mine ? 'My reports' : 'Reports';
  setHTML(c, html`${ctx.head(title, mine ? 'Every report you have saved or submitted.' : 'Filter, review and export daily reports.', mgmt ? html`<button class="btn" type="button" data-export>${icon('download')}<span class="btn-text">Export</span></button>` : '')}
    <form class="filters" data-filters role="search">${raw('<div class="field"><span class="skeleton sk-line" style="width:140px"></span></div>')}</form>
    <div data-summary></div><div class="panel" data-results>${skeleton(8)}</div>`);
  const { depts, people } = mgmt ? await peopleOptions(ctx).catch(() => ({ depts: [], people: [] })) : { depts: [], people: [] };
  if (!ctx.isCurrent()) return;
  const form = $('[data-filters]', c);
  setHTML(form, html`${rangeFields(range, ctx.today)}
    ${mgmt ? field({ name: 'departmentId', label: 'Department', type: 'select', value: q.get('departmentId') || '', placeholder: 'All departments', options: depts }) : ''}
    ${mgmt ? field({ name: 'employeeId', label: 'Employee', type: 'select', value: q.get('employeeId') || '', placeholder: 'Everyone', options: people }) : ''}
    ${field({ name: 'status', label: 'Status', type: 'select', value: q.get('status') || '', placeholder: 'Any status', options: REPORT_STATUSES.map((s) => ({ value: s, label: reportLabel(s) })) })}
    ${mgmt ? field({ name: 'reviewStatus', label: 'Review', type: 'select', value: q.get('reviewStatus') || '', placeholder: 'Any', options: REVIEW_STATUSES }) : ''}
    ${mgmt ? field({ name: 'taskStatus', label: 'Has task status', type: 'select', value: q.get('taskStatus') || '', placeholder: 'Any', options: TASK_STATUS_OPTIONS }) : ''}
    ${mgmt ? field({ name: 'priority', label: 'Has priority', type: 'select', value: q.get('priority') || '', placeholder: 'Any', options: PRIORITY_OPTIONS }) : ''}
    ${mgmt ? html`<div class="field search-field"><label for="flt-search">Search</label><input class="input" type="search" id="flt-search" name="search" value="${q.get('search') || ''}" placeholder="Name, employee ID or report ID"></div>` : ''}
    <div class="row" style="gap:14px;padding-bottom:8px">
      ${mgmt ? html`<label class="check"><input type="checkbox" name="late" ${attr(q.get('late') === 'true', 'checked')}>Late only</label>
      <label class="check"><input type="checkbox" name="hasBlocker" ${attr(q.get('hasBlocker') === 'true', 'checked')}>With blockers</label>` : ''}
      <label class="check"><input type="checkbox" name="includeNotStarted" ${attr(q.get('includeNotStarted') === 'true', 'checked')}>Show missing reports</label>
    </div>`);

  collapsibleFilters(form);
  let page = Number(q.get('page')) || 1;
  const load = async (v) => {
    const results = $('[data-results]', c), summary = $('[data-summary]', c);
    const r = v.range === 'custom' ? { from: v.from, to: v.to } : rangePreset(v.range, ctx.today);
    const filters = Object.assign({}, v, r);
    delete filters.range; delete filters.page;
    Object.keys(filters).forEach((k) => { if (filters[k] === '' || filters[k] === false) delete filters[k]; });
    if (mine) filters.employeeId = ctx.user.id;
    ctx.lastFilters = filters;
    results.setAttribute('aria-busy', 'true');
    try {
      const pg = await api('getReports', { filters, page, pageSize: 50 });
      if (!ctx.isCurrent()) return;
      results.removeAttribute('aria-busy');
      const s = pg.summary;
      setHTML(summary, html`<p class="muted small" style="margin:0 0 10px">${fmtDate(pg.from)} to ${fmtDate(pg.to)}: <strong>${s.total}</strong> rows, ${s.submitted} submitted (${s.late} late), ${s.draft} in draft${filters.includeNotStarted ? ', ' + s.notStarted + ' missing' : ''}.</p>`);
      setHTML(results, html`<div data-table></div>${pagerHtml(pg)}`);
      renderTable($('[data-table]', results), {
        caption: title, rows: pg.items, rowHref: (x) => x.reportId ? 'reports.html#view/' + x.reportId : '',
        empty: emptyState('No reports match these filters', mine ? 'Reports you save or submit will appear here.' : 'Try a wider date range or clear some filters.', mine ? html`<a class="btn primary" href="employee.html#today">Start today's report</a>` : ''),
        columns: [
          { key: 'date', label: 'Date', sortable: true, primary: !mgmt, render: (x) => x.reportId ? html`<a href="reports.html#view/${x.reportId}">${fmtDate(x.date, 'short')}</a>` : fmtDate(x.date, 'short') },
          ...(mine ? [] : [{ key: 'employeeName', label: 'Employee', sortable: true, primary: true, render: (x) => html`${x.employeeName}<span class="sub">${titleCase(x.departmentName)}</span>` }]),
          { key: 'status', label: 'Status', sortable: true, render: (x) => html`${reportPill(x.status)}${x.hasBlocker ? html` <span class="pill bad plain" title="Blocker reported">Blocker</span>` : ''}` },
          { key: 'tasks', label: 'Tasks', align: 'right', sortable: true, render: (x) => x.reportId ? html`${x.completed}/${x.tasks}${x.blocked ? html`<span class="sub">${x.blocked} blocked</span>` : ''}` : '' },
          { key: 'workMinutes', label: 'Time', align: 'right', sortable: true, render: (x) => x.workMinutes ? fmtMinutes(x.workMinutes) : '' },
          { key: 'reviewStatus', label: 'Review', sortable: true, render: (x) => x.reportId && x.reviewStatus ? reviewPill(x.reviewStatus) : '' },
          { key: 'submittedAt', label: 'Submitted', sortable: true, render: (x) => x.submittedAt ? fmtDateTime(x.submittedAt) : '' }
        ]
      });
    } catch (e) {
      if (ctx.isCurrent()) renderError(results, e, () => load(v));
    }
  };
  on(c, 'click', '[data-page]', (e, b) => { page = Number(b.dataset.page); const v = formValues(form); setHashQuery(Object.assign(v, { page })); load(v); window.scrollTo({ top: 0 }); });
  bindFilterForm(form, (v) => { page = 1; load(v); });
  const exp = $('[data-export]', c);
  if (exp) exp.onclick = () => openExportDialog(ctx, { dataset: 'REPORTS', filters: ctx.lastFilters });
  load(formValues(form));
}

// ============================ Report detail ============================

function answerHtml(r) {
  const a = r.answer;
  if (a === '' || a === null || a === undefined || (Array.isArray(a) && !a.length)) return html`<div class="a empty-answer">No answer</div>`;
  if (Array.isArray(a)) return html`<div class="a">${a.join(', ')}</div>`;
  if ((r.type === 'NUMBER' || r.type === 'DECIMAL') && /₹/.test(r.text)) return html`<div class="a num">₹${fmtNum(a, 2)}</div>`;
  if (r.type === 'DATE') return html`<div class="a">${fmtDate(a)}</div>`;
  return html`<div class="a">${a}</div>`;
}

export async function renderReportDetail(ctx, args) {
  const c = ctx.content;
  const id = args[0];
  setHTML(c, html`${ctx.head('Report')}${skeleton(10)}`);
  let d;
  try { d = await api('getReport', { reportId: id }); } catch (e) {
    if (!ctx.isCurrent()) return;
    setHTML(c, ctx.head('Report'));
    const b = document.createElement('div'); c.appendChild(b);
    renderError(b, e, (e && e.code === 'NOT_FOUND') ? null : () => renderReportDetail(ctx, args));
    return;
  }
  if (!ctx.isCurrent()) return;
  const r = d.report, p = d.permissions;
  const bySection = [];
  d.responses.forEach((x) => {
    const last = bySection[bySection.length - 1];
    if (!last || last.section !== x.section) bySection.push({ section: x.section, items: [x] }); else last.items.push(x);
  });
  const mgmt = ctx.user.role !== 'EMPLOYEE';
  document.title = d.employee.name + ', ' + fmtDate(r.date, 'short') + ' | ' + ctx.settings.COMPANY_NAME;
  setHTML(c, html`
    <div class="page-head"><div>
      <p class="muted small" style="margin:0 0 4px"><a href="${mgmt && d.employee.employeeId !== ctx.user.id ? 'reports.html#list' : 'employee.html#history'}">${icon('left')}${mgmt && d.employee.employeeId !== ctx.user.id ? 'Reports' : 'My reports'}</a></p>
      <h1>${d.employee.name}, ${fmtDate(r.date)}</h1>
      <div class="row small" style="margin-top:8px;gap:8px">${reportPill(r.status)}${reviewPill(r.reviewStatus)}${r.hasBlocker ? html`<span class="pill bad plain">Blocker reported</span>` : ''}<span class="muted">${r.reportId}</span></div>
    </div>
    <div class="page-actions">
      ${p.canEdit ? html`<a class="btn primary" href="employee.html#today${r.date !== ctx.today ? '/' + r.date : ''}">${icon('pen')}Edit report</a>` : ''}
      ${p.canReview ? html`<button class="btn primary" type="button" data-remark>${icon('edit')}Add review</button>` : ''}
      ${p.canReopen ? html`<button class="btn" type="button" data-reopen>Reopen</button>` : ''}
      ${canShareOnWhatsApp(r, ctx.user) ? whatsAppButtonHtml() : ''}
      <button class="btn" type="button" data-print>${icon('print')}<span class="btn-text">Print or PDF</span></button>
    </div></div>
    ${r.status === 'REOPENED' ? html`<div class="banner warn">${icon('alert')}<span class="banner-body">Reopened by ${d.reopenedByName} on ${fmtDateTime(r.reopenedAt)}: “${r.reopenReason}”. Waiting for the employee to submit again.</span></div>` : ''}
    <div class="grid-3" style="align-items:start">
      <div class="span-2 stack">
        <div class="panel"><div class="panel-head"><h2>Tasks</h2><span class="muted">${r.taskCompleted} of ${r.taskTotal} completed${r.workMinutes ? ', ' + fmtMinutes(r.workMinutes) + ' recorded' : ''}</span></div><div class="panel-body flush" data-tasks></div></div>
        <div class="panel"><div class="panel-head"><h2>Answers</h2></div><div class="panel-body">
          ${bySection.length ? bySection.map((s) => html`<h3 class="section-title">${s.section === 'KPI' ? titleCase(d.department.name) + ' numbers' : SECTION_LABELS[s.section] || titleCase(s.section)}</h3>
            ${s.items.map((x) => html`<div class="qa"><div class="q">${x.text}${x.questionActive ? '' : html` <span class="pill off plain">Question retired</span>`}</div>${answerHtml(x)}</div>`)}`) : emptyState('No answers saved', '')}
        </div></div>
      </div>
      <div class="stack">
        <div class="panel"><div class="panel-head"><h2>Details</h2></div><div class="panel-body"><dl class="kv">
          <dt>Department</dt><dd>${titleCase(d.department.name)}</dd>
          <dt>Designation</dt><dd>${d.employee.designation || '–'}</dd>
          <dt>Manager</dt><dd>${d.employee.managerName || '–'}</dd>
          <dt>Started</dt><dd>${r.startedAt ? fmtDateTime(r.startedAt) : '–'}</dd>
          <dt>First submitted</dt><dd>${r.firstSubmittedAt ? fmtDateTime(r.firstSubmittedAt) : '–'}</dd>
          ${r.submittedAt && r.submittedAt !== r.firstSubmittedAt ? html`<dt>Last submitted</dt><dd>${fmtDateTime(r.submittedAt)}</dd>` : ''}
          <dt>Deadline</dt><dd>${fmtTime(d.deadline.deadline)}${d.deadline.graceMinutes ? ' (+' + d.deadline.graceMinutes + ' min grace)' : ''}</dd>
          <dt>Late</dt><dd>${r.late ? 'Yes' : 'No'}</dd>
        </dl>${mgmt && d.employee.employeeId !== ctx.user.id ? html`<p style="margin:12px 0 0"><a href="employee.html#analytics/${r.employeeId}">Employee analytics</a></p>` : ''}</div></div>
        <div class="panel"><div class="panel-head"><h2>Manager review</h2></div><div class="panel-body">
          ${d.remarks.length ? html`<ul class="timeline">${d.remarks.map((m) => html`<li><div class="row small" style="gap:6px"><strong>${m.authorName}</strong><span class="muted">${fmtDateTime(m.createdAt)}</span></div>
            <div style="margin:4px 0">${m.comment}</div>${reviewPill(m.reviewStatus)}</li>`)}</ul>` : html`<p class="muted" style="margin:0">No review yet.</p>`}
        </div></div>
        <div class="panel"><div class="panel-head"><h2>Follow-ups</h2></div><div class="panel-body">
          ${d.followUps.length ? html`<ul class="att-list">${d.followUps.map((f) => html`<li><span><a href="reports.html#followups?focus=${f.followUpId}">${f.title}</a><span class="sub"> ${f.ownerName ? 'Owner: ' + f.ownerName : 'No owner'}${f.dueDate ? ', due ' + fmtDate(f.dueDate, 'short') : ''}</span></span>${followUpPill(f.status, f.overdue)}</li>`)}</ul>` : html`<p class="muted" style="margin:0">None.</p>`}
        </div></div>
        ${d.history.length ? html`<div class="panel no-print"><div class="panel-head"><h2>History</h2></div><div class="panel-body"><ul class="timeline">${d.history.map((h) => html`<li><div class="small"><strong>${titleCase(h.action.replace(/_/g, ' '))}</strong></div><div class="small muted">${h.userName}, ${fmtDateTime(h.timestamp)}</div></li>`)}</ul></div></div>` : ''}
      </div>
    </div>`);
  renderTable($('[data-tasks]', c), {
    caption: 'Tasks', rows: d.tasks,
    empty: emptyState('No tasks recorded', ''),
    columns: [
      { key: 'title', label: 'Task', primary: true, render: (t) => html`${t.title}${t.carryCount ? html` <span class="carry-tag small">carried ${t.carryCount}×</span>` : ''}${t.description ? html`<span class="sub">${t.description}</span>` : ''}${t.remarks ? html`<span class="sub">Remarks: ${t.remarks}</span>` : ''}` },
      { key: 'status', label: 'Status', render: (t) => taskPill(t.status) },
      { key: 'priority', label: 'Priority', render: (t) => prio(t.priority) },
      { key: 'relatedEntity', label: 'Related to', render: (t) => t.relatedEntity ? html`${t.relatedEntity}<span class="sub">${titleCase(t.relatedType)}</span>` : '' },
      { key: 'duration', label: 'Time', align: 'right', render: (t) => html`<span class="nowrap">${t.duration ? fmtMinutes(t.duration) : ''}</span>${t.startTime ? html`<span class="sub nowrap">${t.startTime}–${t.endTime}</span>` : ''}` }
    ]
  });
  $('[data-print]', c).onclick = () => window.print();
  if (canShareOnWhatsApp(r, ctx.user)) bindWhatsAppButton($('[data-whatsapp]', c), () => d, ctx.settings.COMPANY_NAME);
  const reopen = $('[data-reopen]', c);
  if (reopen) reopen.onclick = async () => {
    const reason = await promptDialog({ title: 'Reopen this report?', message: 'The employee will be able to edit and submit it again. The first submission time and late flag are kept.', label: 'Reason (shown to the employee)', confirmText: 'Reopen report', requiredText: 'Enter a reason for reopening.' });
    if (!reason) return;
    try { await api('reopenReport', { reportId: r.reportId, reason }, { write: true }); toast('Report reopened.'); renderReportDetail(ctx, args); }
    catch (e) { toast(errorMessage(e), 'bad'); }
  };
  const remark = $('[data-remark]', c);
  if (remark) remark.onclick = () => openRemarkDialog(ctx, d, () => renderReportDetail(ctx, args));
}

async function openRemarkDialog(ctx, d, done) {
  const dir = await ctx.directory().catch(() => []);
  const people = dir.filter((p) => p.status === 'Active').map((p) => ({ value: p.employeeId, label: p.name + ' (' + titleCase(p.departmentName) + ')' }));
  const m = openModal({
    title: 'Review report',
    body: html`<form class="stack" novalidate>
      ${field({ name: 'comment', label: 'Comment for the employee', type: 'textarea', required: true, maxlength: 2000, rows: 4 })}
      ${field({ name: 'reviewStatus', label: 'Review status', type: 'select', value: 'REVIEWED', options: ['REVIEWED', 'RESOLVED'] })}
      ${field({ name: 'followUpRequired', label: 'Create a follow-up for this', type: 'switch' })}
      <div class="form-grid hidden" data-fu>
        ${field({ name: 'followUpTitle', label: 'Follow-up title', full: true, maxlength: 200, placeholder: 'Follow-up on report of ' + fmtDate(d.report.date, 'tiny') + ' ' + d.report.date.slice(0, 4) })}
        ${field({ name: 'ownerId', label: 'Owner', type: 'select', value: d.report.employeeId, placeholder: 'Choose…', options: people, required: true })}
        ${field({ name: 'dueDate', label: 'Due date', type: 'date', value: addDays(ctx.today, 1), required: true, min: ctx.today })}
        ${field({ name: 'priority', label: 'Priority', type: 'select', value: 'MEDIUM', options: PRIORITY_OPTIONS })}
      </div></form>`,
    footer: html`<button class="btn" type="button" data-close>Cancel</button><button class="btn primary" type="button" data-save>Save review</button>`
  });
  const form = m.el.querySelector('form');
  form.followUpRequired.onchange = () => {
    m.el.querySelector('[data-fu]').classList.toggle('hidden', !form.followUpRequired.checked);
    form.reviewStatus.closest('.field').classList.toggle('hidden', form.followUpRequired.checked);
  };
  const btn = m.el.querySelector('[data-save]');
  btn.onclick = async () => {
    const v = formValues(form);
    if (!v.comment) { showFieldErrors(form, { comment: 'Enter a comment.' }); return; }
    try {
      await submitForm(form, btn, () => api('saveManagerRemark', Object.assign({ reportId: d.report.reportId }, v), { write: true }), 'Review saved.');
      m.close(); done();
    } catch (e) { /* shown in form */ }
  };
}

// ============================ Tasks ============================

export async function renderTasks(ctx) {
  const c = ctx.content;
  const q = hashQuery();
  const range = rangeFromQuery(q, ctx.today, 'last7');
  const mgmt = ctx.user.role !== 'EMPLOYEE';
  setHTML(c, html`${ctx.head(mgmt ? 'Tasks' : 'My tasks', mgmt ? 'Every task recorded in daily reports.' : 'Tasks from your reports. Close unfinished ones here or continue them in today\'s report.', mgmt ? html`<button class="btn" type="button" data-export>${icon('download')}<span class="btn-text">Export</span></button>` : '')}
    <form class="filters" data-filters role="search"></form><div data-counts></div><div class="panel" data-results>${skeleton(8)}</div>`);
  const { depts, people } = await peopleOptions(ctx).catch(() => ({ depts: [], people: [] }));
  if (!ctx.isCurrent()) return;
  const form = $('[data-filters]', c);
  setHTML(form, html`${rangeFields(range, ctx.today)}
    ${field({ name: 'status', label: 'Status', type: 'select', value: q.get('status') || '', placeholder: 'Any status', options: TASK_STATUS_OPTIONS.concat(['CANCELLED']) })}
    ${field({ name: 'priority', label: 'Priority', type: 'select', value: q.get('priority') || '', placeholder: 'Any', options: PRIORITY_OPTIONS })}
    ${field({ name: 'category', label: 'Category', type: 'select', value: q.get('category') || '', placeholder: 'Any', options: (ctx.settings.TASK_CATEGORIES || []).map((x) => ({ value: x, label: x })) })}
    ${mgmt ? field({ name: 'departmentId', label: 'Department', type: 'select', value: q.get('departmentId') || '', placeholder: 'All departments', options: depts }) : ''}
    ${mgmt ? field({ name: 'employeeId', label: 'Employee', type: 'select', value: q.get('employeeId') || '', placeholder: 'Everyone', options: people }) : ''}
    <div class="field search-field"><label for="flt-search">Search</label><input class="input" type="search" id="flt-search" name="search" value="${q.get('search') || ''}" placeholder="Task, customer, order or tender"></div>
    <label class="check" style="padding-bottom:8px"><input type="checkbox" name="openOnly" ${attr(q.get('openOnly') === 'true', 'checked')}>Unfinished only</label>`);
  collapsibleFilters(form);
  let page = Number(q.get('page')) || 1;
  const load = async (v) => {
    const results = $('[data-results]', c);
    const r = v.range === 'custom' ? { from: v.from, to: v.to } : rangePreset(v.range, ctx.today);
    const filters = Object.assign({}, v, r); delete filters.range; delete filters.page;
    Object.keys(filters).forEach((k) => { if (filters[k] === '' || filters[k] === false) delete filters[k]; });
    ctx.lastFilters = filters;
    try {
      const pg = await api('getTasks', { filters, page, pageSize: 50 });
      if (!ctx.isCurrent()) return;
      setHTML($('[data-counts]', c), html`<div class="chips" style="margin-bottom:12px">${Object.keys(pg.counts).filter((k) => pg.counts[k]).map((k) => html`<span class="pill ${{ COMPLETED: 'ok', 'IN PROGRESS': 'info', PENDING: 'warn', BLOCKED: 'bad', 'CARRIED FORWARD': 'accent', CANCELLED: 'off' }[k]}">${titleCase(k)} <strong class="num">${pg.counts[k]}</strong></span>`)}</div>`);
      setHTML(results, html`<div data-table></div>${pagerHtml(pg)}`);
      renderTable($('[data-table]', results), {
        caption: 'Tasks', rows: pg.items,
        empty: emptyState('No tasks match these filters', 'Try a wider date range.'),
        columns: [
          { key: 'title', label: 'Task', primary: true, sortable: true, render: (t) => html`<a href="reports.html#view/${t.reportId}">${t.title || 'Untitled task'}</a>${t.relatedEntity ? html`<span class="sub">${titleCase(t.relatedType)}: ${t.relatedEntity}</span>` : ''}${t.carriedToTaskId ? html`<span class="sub">Continued in a later report</span>` : ''}` },
          { key: 'reportDate', label: 'Date', sortable: true, render: (t) => fmtDate(t.reportDate, 'short') },
          ...(mgmt ? [{ key: 'employeeName', label: 'Employee', sortable: true, render: (t) => html`${t.employeeName}<span class="sub">${titleCase(t.departmentName)}</span>` }] : []),
          { key: 'status', label: 'Status', sortable: true, render: (t) => taskPill(t.status) },
          { key: 'priority', label: 'Priority', sortable: true, value: (t) => PRIORITY_OPTIONS.indexOf(t.priority), render: (t) => prio(t.priority) },
          { key: 'duration', label: 'Time', align: 'right', sortable: true, render: (t) => t.duration ? fmtMinutes(t.duration) : '' },
          { key: 'actions', label: 'Action', render: (t) => t.employeeId === ctx.user.id && !t.carriedToTaskId && ['IN PROGRESS', 'PENDING', 'BLOCKED', 'CARRIED FORWARD'].indexOf(t.status) >= 0 && t.reportDate < ctx.today
            ? html`<button class="btn sm" type="button" data-update="${t.taskId}">Update status</button>` : '' }
        ]
      });
      results._items = pg.items;
    } catch (e) { if (ctx.isCurrent()) renderError(results, e, () => load(v)); }
  };
  on(c, 'click', '[data-page]', (e, b) => { page = Number(b.dataset.page); const v = formValues(form); setHashQuery(Object.assign(v, { page })); load(v); });
  on(c, 'click', '[data-update]', (e, b) => {
    const t = ($('[data-results]', c)._items || []).find((x) => x.taskId === b.dataset.update);
    if (!t) return;
    const m = openModal({
      title: 'Update task',
      body: html`<form class="stack" novalidate><p><strong>${t.title}</strong><br><span class="muted small">From ${fmtDate(t.reportDate)}</span></p>
        ${field({ name: 'status', label: 'New status', type: 'select', value: 'COMPLETED', options: ['COMPLETED', 'IN PROGRESS', 'PENDING', 'BLOCKED', 'CANCELLED'] })}
        ${field({ name: 'remarks', label: 'Remarks', type: 'textarea', value: t.remarks, maxlength: 1000 })}</form>`,
      footer: html`<button class="btn" type="button" data-close>Cancel</button><button class="btn primary" type="button" data-save>Save</button>`
    });
    const btn = m.el.querySelector('[data-save]');
    btn.onclick = async () => {
      const v = formValues(m.el);
      try { await submitForm(m.el, btn, () => api('updateTask', { taskId: t.taskId, status: v.status, remarks: v.remarks }, { write: true }), 'Task updated.'); m.close(); load(formValues(form)); } catch (err) { /* toast shown */ }
    };
  });
  bindFilterForm(form, (v) => { page = 1; load(v); });
  const exp = $('[data-export]', c);
  if (exp) exp.onclick = () => openExportDialog(ctx, { dataset: 'TASKS', filters: ctx.lastFilters, datasets: ['TASKS', 'REPORTS', 'KPI'] });
  load(formValues(form));
}

// ============================ Follow-ups ============================

export async function renderFollowUps(ctx) {
  const c = ctx.content;
  const q = hashQuery();
  const mgmt = ctx.user.role !== 'EMPLOYEE';
  const tab = q.get('tab') || (mgmt ? 'active' : 'mine');
  const focus = q.get('focus') || '';
  const tabs = [{ id: 'active', label: 'Open' }, { id: 'mine', label: 'Assigned to me' }, { id: 'overdue', label: 'Overdue' }, { id: 'done', label: 'Resolved and closed' }];
  setHTML(c, html`${ctx.head('Follow-ups', 'Blockers and requests that need someone to act, with an owner and a due date.', html`
      ${mgmt ? html`<button class="btn" type="button" data-export>${icon('download')}<span class="btn-text">Export</span></button><button class="btn primary" type="button" data-new>${icon('plus')}New follow-up</button>` : ''}`)}
    <div class="tabs" role="tablist">${tabs.map((t) => html`<button type="button" role="tab" data-tab="${t.id}" aria-selected="${t.id === tab}">${t.label}<span class="count" data-count="${t.id}"></span></button>`)}</div>
    <form class="filters" data-filters role="search">
      ${field({ name: 'priority', label: 'Priority', type: 'select', value: q.get('priority') || '', placeholder: 'Any', options: PRIORITY_OPTIONS })}
      <div class="field search-field"><label for="fu-search">Search</label><input class="input" type="search" id="fu-search" name="search" value="${q.get('search') || ''}" placeholder="Title, person or report ID"></div>
    </form>
    <div class="panel" data-results>${skeleton(6)}</div>`);
  const form = $('[data-filters]', c);
  let page = 1, currentTab = tab, items = [];
  const load = async () => {
    const results = $('[data-results]', c);
    const v = formValues(form);
    const filters = { priority: v.priority || undefined, search: v.search || undefined };
    if (currentTab === 'active') filters.status = 'ACTIVE';
    if (currentTab === 'mine') { filters.mine = true; filters.status = 'ACTIVE'; }
    if (currentTab === 'overdue') filters.overdue = true;
    if (currentTab === 'done') filters.status = 'DONE';
    try {
      const pg = await api('getFollowUps', { filters, page, pageSize: 50 });
      if (!ctx.isCurrent()) return;
      const rows = pg.items;
      items = rows;
      const counts = pg.counts;
      $('[data-count="active"]', c).textContent = currentTab === 'active' ? counts.OPEN + counts['IN PROGRESS'] : '';
      $('[data-count="overdue"]', c).textContent = counts.overdue || '';
      setHTML(results, html`<div data-table></div>${pagerHtml(pg)}`);
      renderTable($('[data-table]', results), {
        caption: 'Follow-ups', rows,
        empty: emptyState(currentTab === 'overdue' ? 'Nothing overdue' : 'No follow-ups here', currentTab === 'mine' ? 'Follow-ups assigned to you appear here.' : ''),
        columns: [
          { key: 'title', label: 'Follow-up', primary: true, render: (f) => html`<strong ${attr(f.followUpId === focus, 'data-focus')}>${f.title}</strong>${f.description ? html`<span class="sub">${f.description.length > 160 ? f.description.slice(0, 160) + '…' : f.description}</span>` : ''}${f.resolution ? html`<span class="sub">Resolution: ${f.resolution}</span>` : ''}` },
          { key: 'status', label: 'Status', render: (f) => followUpPill(f.status, f.overdue) },
          { key: 'priority', label: 'Priority', value: (f) => PRIORITY_OPTIONS.indexOf(f.priority), sortable: true, render: (f) => prio(f.priority) },
          { key: 'dueDate', label: 'Due', sortable: true, render: (f) => f.dueDate ? fmtDate(f.dueDate, 'short') : '–' },
          { key: 'ownerName', label: 'Owner', sortable: true, render: (f) => f.ownerName || '–' },
          { key: 'employeeName', label: 'About', render: (f) => html`${f.employeeName || '–'}${f.reportId ? html`<span class="sub"><a href="reports.html#view/${f.reportId}">View report</a></span>` : ''}` },
          { key: 'actions', label: 'Action', render: (f) => (mgmt || f.ownerId === ctx.user.id) ? html`<button class="btn sm" type="button" data-edit="${f.followUpId}">${mgmt && f.ownerId !== ctx.user.id ? 'Edit' : 'Update'}</button>` : '' }
        ]
      });
      if (focus) {
        const el = $('[data-focus]', results);
        if (el) { el.closest('tr').style.background = 'var(--accent-tint)'; el.scrollIntoView({ block: 'center' }); }
      }
    } catch (e) { if (ctx.isCurrent()) renderError(results, e, load); }
  };
  on(c, 'click', '[data-tab]', (e, b) => {
    currentTab = b.dataset.tab; page = 1;
    $$('[data-tab]', c).forEach((x) => x.setAttribute('aria-selected', String(x === b)));
    setHashQuery(Object.assign(formValues(form), { tab: currentTab }), true);
    setHTML($('[data-results]', c), skeleton(6));
    load();
  });
  on(c, 'click', '[data-page]', (e, b) => { page = Number(b.dataset.page); load(); });
  on(c, 'click', '[data-edit]', (e, b) => { const f = items.find((x) => x.followUpId === b.dataset.edit); if (f) openFollowUpDialog(ctx, f, load); });
  const nb = $('[data-new]', c);
  if (nb) nb.onclick = () => openFollowUpDialog(ctx, null, load);
  const exp = $('[data-export]', c);
  if (exp) exp.onclick = () => openExportDialog(ctx, { dataset: 'FOLLOWUPS', filters: { from: addDays(ctx.today, -90), to: ctx.today }, datasets: ['FOLLOWUPS'] });
  bindFilterForm(form, () => { page = 1; load(); });
  await load();
  if (focus && !$('[data-focus]', c) && currentTab !== 'done') { currentTab = 'done'; await load(); }
}

async function openFollowUpDialog(ctx, f, done) {
  const mgmt = ctx.user.role !== 'EMPLOYEE';
  const ownerOnly = f && !mgmt;
  const dir = mgmt ? await ctx.directory().catch(() => []) : [];
  const people = dir.filter((p) => p.status === 'Active').map((p) => ({ value: p.employeeId, label: p.name }));
  const team = dir.filter((p) => p.inScope && p.status === 'Active').map((p) => ({ value: p.employeeId, label: p.name }));
  const statuses = ['OPEN', 'IN PROGRESS', 'RESOLVED', 'CLOSED'];
  const m = openModal({
    title: f ? (ownerOnly ? 'Update follow-up' : 'Edit follow-up') : 'New follow-up',
    body: html`<form class="form-grid" novalidate>
      ${ownerOnly ? html`<div class="full"><strong>${f.title}</strong>${f.description ? html`<p class="muted" style="margin:4px 0 0">${f.description}</p>` : ''}<p class="small muted" style="margin:6px 0 0">${f.dueDate ? 'Due ' + fmtDate(f.dueDate) + '. ' : ''}${titleCase(f.priority)} priority.</p></div>` : html`
        ${field({ name: 'title', label: 'Title', required: true, full: true, value: f ? f.title : '', maxlength: 200 })}
        ${field({ name: 'description', label: 'Description', type: 'textarea', full: true, value: f ? f.description : '', maxlength: 2000 })}
        ${!f ? field({ name: 'employeeId', label: 'About employee', type: 'select', placeholder: 'Not about a specific person', options: team }) : ''}
        ${field({ name: 'ownerId', label: 'Owner', type: 'select', value: f ? f.ownerId : '', placeholder: 'No owner yet', options: people })}
        ${field({ name: 'priority', label: 'Priority', type: 'select', value: f ? f.priority : 'MEDIUM', options: PRIORITY_OPTIONS })}
        ${field({ name: 'dueDate', label: 'Due date', type: 'date', value: f ? f.dueDate : addDays(ctx.today, 1) })}`}
      ${field({ name: 'status', label: 'Status', type: 'select', value: f ? f.status : 'OPEN', options: statuses })}
      ${field({ name: 'resolution', label: 'Resolution', type: 'textarea', full: true, value: f ? f.resolution : '', maxlength: 2000, hint: 'Required when marking resolved or closed.' })}
    </form>`,
    footer: html`<button class="btn" type="button" data-close>Cancel</button><button class="btn primary" type="button" data-save>${f ? 'Save changes' : 'Create follow-up'}</button>`
  });
  const btn = m.el.querySelector('[data-save]');
  const formEl = m.el.querySelector('form');
  btn.onclick = async () => {
    const v = formValues(formEl);
    const errors = {};
    if (!ownerOnly && !v.title) errors.title = 'Enter a title.';
    if ((v.status === 'RESOLVED' || v.status === 'CLOSED') && !v.resolution) errors.resolution = 'Describe how this was resolved.';
    if (showFieldErrors(formEl, errors)) return;
    const payload = Object.assign({}, v, f ? { followUpId: f.followUpId } : {});
    try {
      await submitForm(formEl, btn, () => api('saveFollowUp', { followUp: payload }, { write: true }), f ? 'Follow-up saved.' : 'Follow-up created.');
      m.close(); done();
    } catch (e) { /* shown */ }
  };
}
