/** Weekly MIS: one summary per person per week (Monday to Sunday). */
import { paintStaleThenFresh } from './api.js';
import {
  html, setHTML, $, icon, toast, errorMessage, renderError, skeleton, emptyState, renderTable, field, withBusy,
  fmtDate, fmtNum, fmtPct, titleCase, reportPill, taskPill, followUpPill, prio, initials, hashQuery, setHashQuery,
  addDays, weekStart, downloadBlob, collapsibleFilters
} from './app.js';
import { columnChart, legendHtml } from './charts.js';
import { toCsv, downloadExcel, printTable } from './export.js';

const WEEKS_BACK = 12;

function weekLabel(from, today) {
  const to = addDays(from, 6);
  const tag = from === weekStart(today) ? ' (this week)' : (from === addDays(weekStart(today), -7) ? ' (last week)' : '');
  return fmtDate(from, 'tiny') + ' – ' + fmtDate(to, 'tiny') + tag;
}

function weekOptions(today) {
  const cur = weekStart(today);
  return Array.from({ length: WEEKS_BACK }, (_, i) => {
    const w = addDays(cur, -7 * i);
    return { value: w, label: weekLabel(w, today) };
  });
}

/** Week from the address bar, clamped to this week or earlier. */
function currentWeek(ctx) {
  const q = hashQuery().get('week');
  const cur = weekStart(ctx.today);
  if (!q || !/^\d{4}-\d{2}-\d{2}$/.test(q)) return cur;
  const w = weekStart(q);
  return w > cur ? cur : w;
}

function weekPicker(ctx, week) {
  const cur = weekStart(ctx.today);
  const opts = weekOptions(ctx.today);
  if (!opts.some((o) => o.value === week)) opts.push({ value: week, label: weekLabel(week, ctx.today) });
  return html`<div class="row week-row" style="gap:8px;align-items:flex-end;flex-wrap:nowrap">
    <button class="btn sm" type="button" data-week-step="-7" aria-label="Previous week">${icon('left')}</button>
    ${field({ name: 'week', label: 'Week', type: 'select', value: week, options: opts })}
    <button class="btn sm" type="button" data-week-step="7" aria-label="Next week" ${week >= cur ? 'disabled' : ''}>${icon('right')}</button>
  </div>`;
}

function bindWeekPicker(ctx, root, rerender) {
  const form = $('[data-filters]', root);
  form.onchange = () => { setHashQuery(Object.assign(Object.fromEntries(hashQuery()), Object.fromEntries(new FormData(form)))); rerender(); };
  form.querySelectorAll('[data-week-step]').forEach((b) => {
    b.onclick = () => {
      const w = addDays(currentWeek(ctx), Number(b.dataset.weekStep));
      if (w > weekStart(ctx.today)) return;
      setHashQuery(Object.assign(Object.fromEntries(hashQuery()), { week: w }));
      rerender();
    };
  });
}

function figTone(v, tone) { return v ? tone : ''; }

function ledger(t, opts) {
  return html`<div class="ledger">
    ${opts && opts.people ? html`<div><span class="fig">${t.people}</span><span class="lbl">People</span></div>` : ''}
    <div><span class="fig">${t.total}</span><span class="lbl">Total tasks</span></div>
    <div><span class="fig ok">${t.completed}</span><span class="lbl">Completed · ${fmtPct(t.completionPct)}</span></div>
    <div><span class="fig ${figTone(t.pending, 'warn')}">${t.pending}</span><span class="lbl">Pending</span></div>
    <div><span class="fig ${figTone(t.overdue, 'bad')}">${t.overdue}</span><span class="lbl">Overdue</span></div>
    <div><span class="fig">${t.upcoming}</span><span class="lbl">Upcoming</span></div>
    <div><span class="fig">${t.reportsSubmitted}<span class="muted" style="font-size:18px"> / ${t.reportsExpected}</span></span><span class="lbl">Reports submitted</span></div>
    <div><span class="fig">${fmtNum(t.workHours)}</span><span class="lbl">Work hours</span></div>
  </div>`;
}

function definitionsHtml(defs) {
  return html`<details class="panel no-print" style="margin-top:16px"><summary class="panel-head" style="cursor:pointer"><h2 style="font-size:15px">How these numbers are counted</h2></summary>
    <div class="panel-body small"><dl class="defs">
      <dt>Total</dt><dd>${defs.total}</dd><dt>Completed</dt><dd>${defs.completed}</dd><dt>Pending</dt><dd>${defs.pending}</dd>
      <dt>Overdue</dt><dd>${defs.overdue}</dd><dt>Upcoming</dt><dd>${defs.upcoming}</dd>
    </dl></div></details>`;
}

// ============================ One person ============================

const DAY_STATUS = { OFF: html`<span class="pill off">Off</span>`, UPCOMING: html`<span class="muted small">Upcoming</span>` };

function itemTable(container, items, kind, ctx) {
  const today = ctx.today;
  renderTable(container, {
    caption: kind, rows: items,
    empty: emptyState({ overdue: 'Nothing overdue', pending: 'Nothing pending', upcoming: 'Nothing due in the next 7 days', completed: 'No completed tasks this week' }[kind], ''),
    rowHref: (x) => x.reportId ? 'reports.html#view/' + x.reportId : '',
    columns: [
      { key: 'title', label: kind === 'upcoming' ? 'Follow-up' : 'Task', primary: true, render: (x) => html`${x.title || '(untitled)'}${x.kind === 'followup' && kind !== 'upcoming' ? html` <span class="muted small">· follow-up</span>` : ''}` },
      { key: 'date', label: kind === 'overdue' ? 'Since / due' : (kind === 'upcoming' ? 'Due' : 'Day'), render: (x) => dateCell(x, kind, today) },
      { key: 'priority', label: 'Priority', render: (x) => prio(x.priority) },
      { key: 'status', label: 'Status', render: (x) => x.kind === 'followup' ? followUpPill(x.status, kind === 'overdue') : taskPill(x.status) }
    ]
  });
}
function dateCell(x, kind, today) {
  if (x.kind === 'followup') return html`Due ${fmtDate(x.date, 'short')}`;
  if (kind === 'overdue') {
    const since = x.since || x.date;
    return html`Open since ${fmtDate(since, 'short')}${x.carryCount ? html` <span class="muted small">· carried ${x.carryCount}×</span>` : ''}`;
  }
  return fmtDate(x.date, 'short');
}

function drawPerson(ctx, c, body, d, opts) {
  const r = d.rows[0];
  if (!r) { setHTML(body, emptyState('No data for this week', 'Nothing was recorded for this person in the selected week.')); return; }
  const e = r.employee || {};
  const items = r.items || { overdue: [], pending: [], upcoming: [], completed: [] };
  setHTML(body, html`
    ${opts.self ? '' : html`<div class="row" style="margin-bottom:16px;gap:14px"><span class="avatar" style="width:44px;height:44px;font-size:16px">${initials(r.name)}</span>
      <div><strong>${r.name}</strong> <span class="muted">${r.employeeId}</span><div class="muted small">${r.designation || titleCase(r.role)}, ${titleCase(r.department)}${e.managerName ? ', reports to ' + e.managerName : ''}</div></div></div>`}
    <p class="muted small" style="margin:-6px 0 12px">${fmtDate(d.week.from)} to ${fmtDate(d.week.to)}${d.week.current ? ' · this week so far' : ''}</p>
    ${ledger(r)}
    <div class="grid-2">
      <div class="panel span-2"><div class="panel-head"><h2>Overdue</h2><span class="pill ${r.overdue ? 'bad' : 'off'}">${r.overdue}</span></div><div class="panel-body flush" data-overdue></div></div>
      <div class="panel"><div class="panel-head"><h2>Pending</h2><span class="pill ${r.pending ? 'warn' : 'off'}">${r.pending}</span></div><div class="panel-body flush" data-pending></div></div>
      <div class="panel"><div class="panel-head"><h2>Upcoming</h2><span class="muted">Follow-ups due in the next 7 days</span></div><div class="panel-body flush" data-upcoming></div></div>
      <div class="panel"><div class="panel-head"><h2>Day by day</h2></div><div class="panel-body"><div class="chart" data-chart></div>${legendHtml([{ name: 'Completed', tone: 'ok' }, { name: 'Other tasks', tone: 'off' }])}</div></div>
      <div class="panel"><div class="panel-head"><h2>Reports this week</h2></div><div class="panel-body flush" data-days></div></div>
      <div class="panel span-2"><div class="panel-head"><h2>Completed</h2><span class="pill ${r.completed ? 'ok' : 'off'}">${r.completed}</span></div><div class="panel-body flush" data-completed></div></div>
    </div>
    ${definitionsHtml(d.definitions)}`);
  itemTable($('[data-overdue]', body), items.overdue, 'overdue', ctx);
  itemTable($('[data-pending]', body), items.pending, 'pending', ctx);
  itemTable($('[data-upcoming]', body), items.upcoming, 'upcoming', ctx);
  itemTable($('[data-completed]', body), items.completed, 'completed', ctx);
  columnChart($('[data-chart]', body), {
    title: 'Tasks per day', stacked: true, height: 180,
    labels: r.days.map((x) => x.date), labelFormat: (l) => fmtDate(l, 'tiny'),
    series: [{ name: 'Completed', tone: 'ok', values: r.days.map((x) => x.completed) }, { name: 'Other tasks', tone: 'off', values: r.days.map((x) => x.tasks - x.completed) }],
    format: (v) => fmtNum(v, 0)
  });
  renderTable($('[data-days]', body), {
    caption: 'Reports this week', rows: r.days, stack: false,
    rowHref: (x) => x.reportId ? 'reports.html#view/' + x.reportId : '',
    columns: [
      { key: 'date', label: 'Day', primary: true, render: (x) => fmtDate(x.date, 'short') },
      { key: 'status', label: 'Report', render: (x) => DAY_STATUS[x.status] || reportPill(x.status) },
      { key: 'tasks', label: 'Tasks', align: 'right', render: (x) => x.tasks ? html`${x.completed}/${x.tasks}` : '' }
    ]
  });
}

async function renderPerson(ctx, args, opts) {
  const c = ctx.content;
  const week = currentWeek(ctx);
  const back = opts.self ? '' : html`<a class="btn" href="dashboard.html#mis?week=${week}">${icon('left')}All people</a>`;
  const rerender = () => renderPerson(ctx, args, opts);
  setHTML(c, html`${ctx.head(opts.self ? 'My weekly MIS' : 'Weekly MIS', '', html`${back}<button class="btn" type="button" data-print>${icon('print')}Print / PDF</button>`)}
    <form class="filters" data-filters>${weekPicker(ctx, week)}</form><div data-body>${skeleton(10)}</div>`);
  bindWeekPicker(ctx, c, rerender);
  $('[data-print]', c).onclick = () => window.print();
  const body = $('[data-body]', c);
  const payload = { week, employeeId: opts.employeeId || ctx.user.id };
  try {
    await paintStaleThenFresh('getWeeklyMis', payload, body, (d) => {
      if (!ctx.isCurrent()) return;
      if (!opts.self && d.rows[0]) $('.page-head h1', c).textContent = 'Weekly MIS · ' + d.rows[0].name;
      drawPerson(ctx, c, body, d, opts);
    });
  } catch (e) { if (ctx.isCurrent()) renderError(body, e, rerender); }
}

/** employee.html#mis — every role sees their own week here. */
export function renderMyMis(ctx, args) {
  return renderPerson(ctx, args, { self: true });
}

// ============================ Everyone (admin) / team (manager) ============================

const LIST_COLUMNS = [
  { key: 'name', label: 'Employee' }, { key: 'department', label: 'Department' },
  { key: 'reports', label: 'Reports submitted' }, { key: 'total', label: 'Total tasks' }, { key: 'completed', label: 'Completed' },
  { key: 'pending', label: 'Pending' }, { key: 'overdue', label: 'Overdue' }, { key: 'upcoming', label: 'Upcoming' },
  { key: 'completionPct', label: 'Completion %' }, { key: 'workHours', label: 'Work hours' }
];

function exportData(d) {
  const rows = d.rows.map((r) => Object.assign({}, r, { department: titleCase(r.department), reports: r.reportsSubmitted + ' / ' + r.reportsExpected }));
  const t = d.totals;
  rows.push({ name: 'TOTAL (' + t.people + ' people)', department: '', reports: t.reportsSubmitted + ' / ' + t.reportsExpected, total: t.total, completed: t.completed, pending: t.pending, overdue: t.overdue, upcoming: t.upcoming, completionPct: t.completionPct, workHours: t.workHours });
  return { title: 'Weekly MIS ' + d.week.from + ' to ' + d.week.to, columns: LIST_COLUMNS, rows };
}

function drawList(ctx, c, body, d) {
  c._mis = d;
  setHTML(body, html`
    <p class="muted small" style="margin:-6px 0 12px">${fmtDate(d.week.from)} to ${fmtDate(d.week.to)}${d.week.current ? ' · this week so far' : ''} · ${d.scope === 'all' ? 'everyone' : 'your team'}</p>
    ${ledger(d.totals, { people: true })}
    <div class="panel"><div class="panel-head"><h2>Per person</h2><span class="muted">Select a row to see the full MIS</span></div><div class="panel-body flush" data-table></div></div>
    ${definitionsHtml(d.definitions)}`);
  renderTable($('[data-table]', body), {
    caption: 'Weekly MIS per person', rows: d.rows, sortKey: 'overdue', sortDir: 'desc',
    rowHref: (x) => 'dashboard.html#mis/' + x.employeeId + '?week=' + d.week.from,
    empty: emptyState('Nobody to show', 'No one in this view had tasks or reports this week.'),
    columns: [
      { key: 'name', label: 'Employee', primary: true, sortable: true, render: (x) => html`<a href="dashboard.html#mis/${x.employeeId}?week=${d.week.from}">${x.name}</a>${x.status !== 'Active' ? html` <span class="muted small">(inactive)</span>` : ''}<div class="muted small">${titleCase(x.department)}</div>` },
      { key: 'reportsSubmitted', label: 'Reports', align: 'right', sortable: true, render: (x) => html`${x.reportsSubmitted}/${x.reportsExpected}` },
      { key: 'total', label: 'Total', align: 'right', sortable: true },
      { key: 'completed', label: 'Completed', align: 'right', sortable: true },
      { key: 'pending', label: 'Pending', align: 'right', sortable: true, render: (x) => x.pending ? html`<span class="pill warn">${x.pending}</span>` : '0' },
      { key: 'overdue', label: 'Overdue', align: 'right', sortable: true, render: (x) => x.overdue ? html`<span class="pill bad">${x.overdue}</span>` : '0' },
      { key: 'upcoming', label: 'Upcoming', align: 'right', sortable: true },
      { key: 'completionPct', label: 'Done %', align: 'right', sortable: true, render: (x) => x.total ? fmtPct(x.completionPct) : '–' },
      { key: 'workHours', label: 'Hours', align: 'right', sortable: true, render: (x) => fmtNum(x.workHours) }
    ]
  });
}

async function renderList(ctx, args) {
  const c = ctx.content;
  const week = currentWeek(ctx);
  const q = hashQuery();
  const dept = q.get('departmentId') || '';
  c._mis = null;
  setHTML(c, html`${ctx.head('Weekly MIS', 'Tasks completed, pending, overdue and upcoming for each person, Monday to Sunday.',
    html`<button class="btn" type="button" data-dl="xlsx">${icon('download')}Excel</button><button class="btn" type="button" data-dl="csv">${icon('download')}CSV</button><button class="btn" type="button" data-dl="print">${icon('print')}Print / PDF</button>`)}
    <form class="filters" data-filters>${weekPicker(ctx, week)}<div data-dept></div></form><div data-body>${skeleton(10)}</div>`);
  bindWeekPicker(ctx, c, () => renderList(ctx, args));
  collapsibleFilters($('[data-filters]', c));
  c.querySelectorAll('[data-dl]').forEach((b) => { b.onclick = () => download(b); });
  const download = async (b) => {
    const d = c._mis;
    if (!d) { toast('The MIS is still loading.', 'warn'); return; }
    const data = exportData(d);
    try {
      if (b.dataset.dl === 'csv') downloadBlob('oakcraft-weekly-mis-' + d.week.from + '.csv', new Blob([toCsv(data)], { type: 'text/csv;charset=utf-8' }));
      else if (b.dataset.dl === 'print') { const w = window.open('', '_blank'); if (!w) { toast('Allow pop-ups to print.', 'warn'); return; } printTable(w, data, fmtDate(d.week.from) + ' to ' + fmtDate(d.week.to)); }
      else await withBusy(b, async () => { try { await downloadExcel(data); } catch (err) { downloadBlob('oakcraft-weekly-mis-' + d.week.from + '.csv', new Blob([toCsv(data)], { type: 'text/csv;charset=utf-8' })); toast('Excel could not load, so a CSV was downloaded instead.', 'warn'); } });
    } catch (err) { toast(errorMessage(err), 'bad'); }
  };
  ctx.departments().then((depts) => {
    if (!ctx.isCurrent()) return;
    const holder = $('[data-dept]', c);
    if (holder) setHTML(holder, field({ name: 'departmentId', label: 'Department', type: 'select', value: dept, placeholder: 'All departments', options: (depts || []).filter((x) => x.status !== 'Inactive').map((x) => ({ value: x.departmentId, label: titleCase(x.name) })) }));
  }).catch(() => { /* the filter is optional */ });
  const body = $('[data-body]', c);
  const payload = { week };
  if (dept) payload.departmentId = dept;
  try {
    await paintStaleThenFresh('getWeeklyMis', payload, body, (d) => { if (ctx.isCurrent()) drawList(ctx, c, body, d); });
  } catch (e) { if (ctx.isCurrent()) renderError(body, e, () => renderList(ctx, args)); }
}

/** dashboard.html#mis (list) and dashboard.html#mis/<employeeId> (one person). */
export function renderTeamMis(ctx, args) {
  if (args[0]) return renderPerson(ctx, args, { self: false, employeeId: args[0] });
  return renderList(ctx, args);
}
