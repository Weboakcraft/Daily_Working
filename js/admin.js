/** System settings and audit / error logs. */
import { api, ApiError } from './api.js';
import {
  html, setHTML, $, $$, on, icon, toast, errorMessage, renderError, skeleton, emptyState, renderTable, pagerHtml, field, formValues,
  showFieldErrors, clearFieldErrors, withBusy, openModal, attr, fmtDate, fmtDateTime, titleCase, addDays, hashQuery, setHashQuery, collapsibleFilters
} from './app.js';
import { forgetSession } from './auth.js';

const DAYS = [['MON', 'Mon'], ['TUE', 'Tue'], ['WED', 'Wed'], ['THU', 'Thu'], ['FRI', 'Fri'], ['SAT', 'Sat'], ['SUN', 'Sun']];
const WEIGHTS = [['CONSISTENCY', 'Report consistency'], ['TASK_COMPLETION', 'Task completion'], ['KPI', 'Department KPI'], ['TIMELINESS', 'Timeliness'], ['PLANNING', 'Work planning'], ['BLOCKER_RESOLUTION', 'Blocker resolution']];
const EVENTS = [['REPORT_REMINDER', 'Reminder before the deadline to people who have not submitted'], ['MISSING_REPORT', 'Summary of missing reports to each manager after the grace period'], ['LATE_REPORT', 'Late report submitted (to the manager)'], ['FOLLOWUP_ASSIGNED', 'Follow-up assigned (to the owner)'], ['HIGH_PRIORITY_BLOCKER', 'Blocker or urgent blocked task reported (to the manager)']];
const CHANNELS = [['EMAIL', 'Email to each person (Gmail)'], ['GOOGLE_CHAT', 'Google Chat space (webhook)'], ['WEBHOOK', 'Custom webhook (a messaging service your company already uses)']];
const TIMEZONES = ['Asia/Kolkata', 'Asia/Dubai', 'Asia/Singapore', 'Europe/London', 'America/New_York', 'UTC'];

function section(id, title, desc, body) {
  return html`<section class="panel" id="set-${id}" data-section="${id}" style="scroll-margin-top:80px">
    <div class="panel-head"><h2>${title}</h2></div>
    <div class="panel-body"><p class="muted" style="margin-top:-4px">${desc}</p><form class="form-grid" novalidate>${body}</form>
      <div class="row" style="margin-top:16px"><button class="btn primary" type="button" data-save="${id}">Save ${title.toLowerCase()}</button></div></div></section>`;
}

export async function renderSettings(ctx) {
  const c = ctx.content;
  setHTML(c, html`${ctx.head('Settings')}${skeleton(10)}`);
  let d;
  try { d = await api('getSettings'); } catch (e) { if (ctx.isCurrent()) renderError(c, e, () => renderSettings(ctx)); return; }
  if (!ctx.isCurrent()) return;
  const s = d.settings;
  const holidays = (s.HOLIDAYS || []).slice();
  const nav = [['company', 'Company and branding'], ['window', 'Reporting window'], ['calendar', 'Working days and holidays'], ['tasks', 'Tasks and follow-ups'], ['score', 'Productivity score'], ['access', 'Sign-in and privacy'], ['notify', 'Notifications']];
  setHTML(c, html`${ctx.head('Settings', 'Changes apply immediately for everyone. Every change is recorded in the audit log.')}
    <div class="settings-grid">
      <nav class="settings-nav" aria-label="Settings sections">${nav.map((n) => html`<a href="#settings" data-jump="set-${n[0]}">${n[1]}</a>`)}</nav>
      <div class="stack">
        ${section('company', 'Company and branding', 'Shown in the sidebar, page titles and notifications.', html`
          ${field({ name: 'COMPANY_NAME', label: 'Company name', required: true, value: s.COMPANY_NAME, maxlength: 120 })}
          ${field({ name: 'APP_SUBTITLE', label: 'App subtitle', required: true, value: s.APP_SUBTITLE, maxlength: 120 })}
          ${field({ name: 'BRAND_PRIMARY', label: 'Primary colour', type: 'color', value: s.BRAND_PRIMARY, hint: 'Buttons and highlights. Keep it dark enough for white text.' })}
          ${field({ name: 'BRAND_ACCENT', label: 'Accent colour', type: 'color', value: s.BRAND_ACCENT, hint: 'Focus rings and carried-forward marks.' })}`)}
        ${section('window', 'Reporting window', 'When reports are due and how late submissions are handled.', html`
          ${field({ name: 'TIMEZONE', label: 'Timezone', type: 'select', value: s.TIMEZONE, options: (TIMEZONES.indexOf(s.TIMEZONE) < 0 ? [s.TIMEZONE] : []).concat(TIMEZONES).map((t) => ({ value: t, label: t })) })}
          ${field({ name: 'REPORT_DEADLINE', label: 'Daily report deadline', type: 'time', required: true, value: s.REPORT_DEADLINE })}
          ${field({ name: 'GRACE_PERIOD_MINUTES', label: 'Grace period (minutes)', type: 'number', min: 0, max: 600, value: s.GRACE_PERIOD_MINUTES, hint: 'Reports submitted after deadline plus grace are marked late.' })}
          ${field({ name: 'BACKDATE_DAYS_ALLOWED', label: 'Days back an employee can still report', type: 'number', min: 0, max: 7, value: s.BACKDATE_DAYS_ALLOWED, hint: '0 means today only.' })}
          ${field({ name: 'OFFICE_START_TIME', label: 'Office starts', type: 'time', value: s.OFFICE_START_TIME })}
          ${field({ name: 'OFFICE_END_TIME', label: 'Office ends', type: 'time', value: s.OFFICE_END_TIME })}
          ${field({ name: 'LOCK_AFTER_DEADLINE', label: 'Block reports after the deadline and grace period', type: 'switch', full: true, value: s.LOCK_AFTER_DEADLINE, hint: 'When on, only an admin can reopen a report for that day.' })}`)}
        ${section('calendar', 'Working days and holidays', 'Reports are expected only on working days that are not holidays.', html`
          <div class="field full"><span class="label">Working days</span><div class="chips">${DAYS.map((dd) => html`<label class="chip-toggle"><input type="checkbox" name="WORKING_DAYS" value="${dd[0]}" data-multi ${attr((s.WORKING_DAYS || []).indexOf(dd[0]) >= 0, 'checked')}><span>${dd[1]}</span></label>`)}</div><span class="error" data-error-for="WORKING_DAYS"></span></div>
          <div class="field full"><span class="label">Holidays</span><div data-holidays></div>
            <div class="row" style="margin-top:8px"><input class="input" type="date" data-hol-date style="max-width:180px" aria-label="Holiday date"><input class="input" data-hol-name placeholder="Name, e.g. Diwali" maxlength="80" style="max-width:260px" aria-label="Holiday name"><button class="btn" type="button" data-hol-add>${icon('plus')}Add holiday</button></div>
            <span class="error" data-error-for="HOLIDAYS"></span></div>`)}
        ${section('tasks', 'Tasks and follow-ups', 'Options offered in the report form.', html`
          ${field({ name: 'TASK_CATEGORIES', label: 'Task categories, one per line', type: 'textarea', full: true, rows: 5, value: (s.TASK_CATEGORIES || []).join('\n') })}
          ${field({ name: 'CARRY_FORWARD_ENABLED', label: 'Offer unfinished tasks from earlier days', type: 'switch', full: true, value: s.CARRY_FORWARD_ENABLED })}
          ${field({ name: 'AUTO_FOLLOWUP_FOR_BLOCKERS', label: 'Create follow-ups automatically for blockers and high-priority blocked tasks', type: 'switch', full: true, value: s.AUTO_FOLLOWUP_FOR_BLOCKERS })}`)}
        ${section('score', 'Productivity score', 'A transparent score shown with its full breakdown. Weights must add up to 100. When a part has no data, its weight is shared among the others.', html`
          ${field({ name: 'PRODUCTIVITY_SCORE_ENABLED', label: 'Show productivity score', type: 'switch', full: true, value: s.PRODUCTIVITY_SCORE_ENABLED })}
          <div class="full weights">${WEIGHTS.map((w) => html`<label for="w-${w[0]}">${w[1]}</label><input class="input" type="number" min="0" max="100" id="w-${w[0]}" name="w_${w[0]}" value="${s.PRODUCTIVITY_WEIGHTS[w[0]]}">`)}
            <strong>Total</strong><strong data-wtotal class="num" style="padding-left:12px"></strong></div>
          <span class="error full" data-error-for="PRODUCTIVITY_WEIGHTS"></span>`)}
        ${section('access', 'Sign-in and privacy', 'Session length, lockout and what employees can see.', html`
          ${field({ name: 'SESSION_HOURS', label: 'Stay signed in for (hours)', type: 'number', min: 1, max: 168, value: s.SESSION_HOURS })}
          ${field({ name: 'MAX_LOGIN_ATTEMPTS', label: 'Failed sign-ins before a 15-minute lock', type: 'number', min: 3, max: 20, value: s.MAX_LOGIN_ATTEMPTS })}
          ${field({ name: 'SHOW_REMARKS_TO_EMPLOYEE', label: 'Employees can read manager reviews of their reports', type: 'switch', full: true, value: s.SHOW_REMARKS_TO_EMPLOYEE })}`)}
        ${section('notify', 'Notifications', 'Uses free Google services by default. Nothing is sent until notifications are switched on.', html`
          ${field({ name: 'NOTIFICATIONS_ENABLED', label: 'Send notifications', type: 'switch', full: true, value: s.NOTIFICATIONS_ENABLED })}
          <div class="field full"><span class="label">Channels</span>${CHANNELS.map((ch) => html`<label class="check"><input type="checkbox" name="NOTIFY_CHANNELS" value="${ch[0]}" data-multi ${attr((s.NOTIFY_CHANNELS || []).indexOf(ch[0]) >= 0, 'checked')}>${ch[1]}</label>`)}</div>
          <div class="field full"><span class="label">Events</span>${EVENTS.map((ev) => html`<label class="check"><input type="checkbox" name="ev_${ev[0]}" ${attr(s.NOTIFY_EVENTS && s.NOTIFY_EVENTS[ev[0]], 'checked')}>${ev[1]}</label>`)}</div>
          ${field({ name: 'REMINDER_MINUTES_BEFORE', label: 'Send the reminder this many minutes before the deadline', type: 'number', min: 5, max: 240, value: s.REMINDER_MINUTES_BEFORE })}
          <div class="field full"><label for="s-chat">Google Chat webhook URL</label><input class="input" id="s-chat" name="chatWebhook" type="url" autocomplete="off" placeholder="${d.secrets.chatWebhook ? 'Saved (' + d.secrets.chatWebhook + '). Paste a new URL to replace it.' : 'https://chat.googleapis.com/v1/spaces/…'}"><span class="error" data-error-for="chatWebhook"></span>
            ${d.secrets.chatWebhook ? html`<label class="check small"><input type="checkbox" name="clearChat">Remove the saved Google Chat webhook</label>` : ''}</div>
          <div class="field full"><label for="s-hook">Custom webhook URL</label><input class="input" id="s-hook" name="genericWebhook" type="url" autocomplete="off" placeholder="${d.secrets.genericWebhook ? 'Saved (' + d.secrets.genericWebhook + '). Paste a new URL to replace it.' : 'https://…'}"><span class="hint">Receives JSON: event, subject, text and recipient. Stored securely in the Apps Script project, never shown in full.</span><span class="error" data-error-for="genericWebhook"></span>
            ${d.secrets.genericWebhook ? html`<label class="check small"><input type="checkbox" name="clearHook">Remove the saved custom webhook</label>` : ''}</div>
          <div class="full banner ${d.triggersInstalled ? 'ok' : 'warn'}">${icon(d.triggersInstalled ? 'check' : 'clock')}<span class="banner-body">${d.triggersInstalled ? 'Scheduled reminders are installed and run every 15 minutes.' : 'Scheduled reminders are not installed. Reminders and missing-report summaries need them.'}
            <span class="row" style="margin-top:8px"><button class="btn sm" type="button" data-triggers>${d.triggersInstalled ? 'Reinstall scheduled reminders' : 'Install scheduled reminders'}</button><button class="btn sm" type="button" data-test>Send a test to me</button></span></span></div>`)}
      </div></div>`);

  const holBox = $('[data-holidays]', c);
  const drawHolidays = () => setHTML(holBox, holidays.length ? html`<ul class="att-list">${holidays.map((h, i) => html`<li><span>${fmtDate(h.date)}<span class="sub"> ${h.name}</span></span><button class="btn sm ghost" type="button" data-hol-del="${i}" aria-label="Remove ${h.name}">Remove</button></li>`)}</ul>` : html`<p class="muted" style="margin:0">No holidays added.</p>`);
  drawHolidays();
  on(c, 'click', '[data-hol-add]', () => {
    const date = $('[data-hol-date]', c).value, name = $('[data-hol-name]', c).value.trim();
    if (!date) { toast('Choose a date for the holiday.', 'bad'); return; }
    if (holidays.some((h) => h.date === date)) { toast('That date is already a holiday.', 'bad'); return; }
    holidays.push({ date, name: name || 'Holiday' });
    holidays.sort((a, b) => (a.date < b.date ? -1 : 1));
    $('[data-hol-date]', c).value = ''; $('[data-hol-name]', c).value = '';
    drawHolidays();
  });
  on(c, 'click', '[data-hol-del]', (e, b) => { holidays.splice(Number(b.dataset.holDel), 1); drawHolidays(); });
  on(c, 'click', '[data-jump]', (e, a) => { e.preventDefault(); const t = document.getElementById(a.dataset.jump); t.scrollIntoView({ behavior: 'smooth' }); t.querySelector('h2').setAttribute('tabindex', '-1'); t.querySelector('h2').focus({ preventScroll: true }); });

  const wTotal = () => {
    const f = $('[data-section="score"] form', c);
    const total = WEIGHTS.reduce((a, w) => a + (Number(f['w_' + w[0]].value) || 0), 0);
    const el = $('[data-wtotal]', c);
    el.textContent = total;
    el.style.color = Math.abs(total - 100) < 0.01 ? 'var(--ok)' : 'var(--bad)';
  };
  $('[data-section="score"] form', c).addEventListener('input', wTotal);
  wTotal();

  on(c, 'click', '[data-save]', async (e, b) => {
    const id = b.dataset.save;
    const form = $('[data-section="' + id + '"] form', c);
    const v = formValues(form);
    const settings = {}, secrets = {};
    if (id === 'company') Object.assign(settings, { COMPANY_NAME: v.COMPANY_NAME, APP_SUBTITLE: v.APP_SUBTITLE, BRAND_PRIMARY: v.BRAND_PRIMARY.toUpperCase(), BRAND_ACCENT: v.BRAND_ACCENT.toUpperCase() });
    if (id === 'window') Object.assign(settings, { TIMEZONE: v.TIMEZONE, REPORT_DEADLINE: v.REPORT_DEADLINE, GRACE_PERIOD_MINUTES: Number(v.GRACE_PERIOD_MINUTES), BACKDATE_DAYS_ALLOWED: Number(v.BACKDATE_DAYS_ALLOWED), OFFICE_START_TIME: v.OFFICE_START_TIME, OFFICE_END_TIME: v.OFFICE_END_TIME, LOCK_AFTER_DEADLINE: v.LOCK_AFTER_DEADLINE });
    if (id === 'calendar') Object.assign(settings, { WORKING_DAYS: v.WORKING_DAYS || [], HOLIDAYS: holidays });
    if (id === 'tasks') Object.assign(settings, { TASK_CATEGORIES: v.TASK_CATEGORIES.split('\n').map((x) => x.trim()).filter(Boolean), CARRY_FORWARD_ENABLED: v.CARRY_FORWARD_ENABLED, AUTO_FOLLOWUP_FOR_BLOCKERS: v.AUTO_FOLLOWUP_FOR_BLOCKERS });
    if (id === 'score') { settings.PRODUCTIVITY_SCORE_ENABLED = v.PRODUCTIVITY_SCORE_ENABLED; settings.PRODUCTIVITY_WEIGHTS = {}; WEIGHTS.forEach((w) => { settings.PRODUCTIVITY_WEIGHTS[w[0]] = Number(v['w_' + w[0]]); }); }
    if (id === 'access') Object.assign(settings, { SESSION_HOURS: Number(v.SESSION_HOURS), MAX_LOGIN_ATTEMPTS: Number(v.MAX_LOGIN_ATTEMPTS), SHOW_REMARKS_TO_EMPLOYEE: v.SHOW_REMARKS_TO_EMPLOYEE });
    if (id === 'notify') {
      Object.assign(settings, { NOTIFICATIONS_ENABLED: v.NOTIFICATIONS_ENABLED, NOTIFY_CHANNELS: v.NOTIFY_CHANNELS || [], REMINDER_MINUTES_BEFORE: Number(v.REMINDER_MINUTES_BEFORE), NOTIFY_EVENTS: {} });
      EVENTS.forEach((ev) => { settings.NOTIFY_EVENTS[ev[0]] = !!v['ev_' + ev[0]]; });
      secrets.chatWebhook = v.clearChat ? '__CLEAR__' : v.chatWebhook;
      secrets.genericWebhook = v.clearHook ? '__CLEAR__' : v.genericWebhook;
    }
    clearFieldErrors(form);
    await withBusy(b, async () => {
      try {
        const res = await api('saveSettings', { settings, secrets }, { write: true });
        forgetSession();
        toast(res.saved ? 'Settings saved.' : 'No changes to save.');
        if (id === 'notify' || id === 'company') renderSettings(ctx);
      } catch (err) {
        if (err instanceof ApiError && err.fieldErrors) {
          const fe = Object.assign({}, err.fieldErrors);
          showFieldErrors(form, fe);
          toast(err.message, 'bad');
        } else toast(errorMessage(err), 'bad');
      }
    });
  });
  on(c, 'click', '[data-triggers]', (e, b) => withBusy(b, async () => {
    try { await api('installTriggers', {}, { write: true }); toast('Scheduled reminders installed.'); renderSettings(ctx); } catch (err) { toast(errorMessage(err), 'bad'); }
  }));
  on(c, 'click', '[data-test]', (e, b) => withBusy(b, async () => {
    try {
      const r = await api('sendTestNotification', {}, { write: true });
      if (!r.results.length) { toast('Choose at least one channel and save first.', 'bad'); return; }
      toast(r.results.map((x) => titleCase(x.channel.replace('_', ' ')) + ': ' + x.message).join(' '), r.results.every((x) => x.ok) ? 'ok' : 'bad');
    } catch (err) { toast(errorMessage(err), 'bad'); }
  }));
}

// ============================ Audit log ============================

export async function renderAuditLog(ctx) {
  const c = ctx.content;
  const q = hashQuery();
  const tab = q.get('tab') === 'errors' ? 'errors' : 'audit';
  setHTML(c, html`${ctx.head('Audit log', 'Who changed what, and when. Entries cannot be edited from the app.')}
    <div class="tabs" role="tablist"><button type="button" role="tab" data-tab="audit" aria-selected="${tab === 'audit'}">Activity</button><button type="button" role="tab" data-tab="errors" aria-selected="${tab === 'errors'}">System errors</button></div>
    <form class="filters" data-filters role="search">
      <div class="field"><label for="al-from">From</label><input class="input" type="date" id="al-from" name="from" value="${q.get('from') || addDays(ctx.today, -6)}" max="${ctx.today}"></div>
      <div class="field"><label for="al-to">To</label><input class="input" type="date" id="al-to" name="to" value="${q.get('to') || ctx.today}" max="${ctx.today}"></div>
      <span data-extra></span>
      <div class="field search-field"><label for="al-search">Search</label><input class="input" type="search" id="al-search" name="search" value="${q.get('search') || ''}" placeholder="ID, action or value"></div>
    </form><div class="panel" data-results>${skeleton(8)}</div>`);
  const dir = await ctx.directory().catch(() => []);
  if (!ctx.isCurrent()) return;
  const form = $('[data-filters]', c);
  let current = tab, page = 1, items = [], actions = [];
  const drawExtra = () => {
    setHTML($('[data-extra]', form), current === 'audit' ? html`
      ${field({ name: 'userId', label: 'Person', type: 'select', value: q.get('userId') || '', placeholder: 'Anyone', options: dir.map((p) => ({ value: p.employeeId, label: p.name })) })}
      ${field({ name: 'action', label: 'Action', type: 'select', value: q.get('action') || '', placeholder: 'Any action', options: actions.map((a) => ({ value: a, label: titleCase(a.replace(/_/g, ' ')) })) })}
      ${field({ name: 'entity', label: 'Record type', type: 'select', value: q.get('entity') || '', placeholder: 'Any', options: ['Employee', 'Department', 'Question', 'Report', 'Task', 'FollowUp', 'Settings', 'Export'].map((x) => ({ value: x, label: x === 'FollowUp' ? 'Follow-up' : x })) })}` : '');
    $('[data-extra]', form).style.display = 'contents';
  };
  drawExtra();
  collapsibleFilters(form);
  const load = async () => {
    const results = $('[data-results]', c);
    const v = formValues(form);
    try {
      const pg = await api(current === 'audit' ? 'getAuditLogs' : 'getErrorLogs', { filters: v, page, pageSize: 50 });
      if (!ctx.isCurrent()) return;
      items = pg.items;
      if (current === 'audit' && pg.actions && pg.actions.join() !== actions.join()) {
        const keep = formValues(form); actions = pg.actions; drawExtra();
        ['userId', 'action', 'entity'].forEach((k) => { if (form[k]) form[k].value = keep[k] || ''; });
      }
      setHTML(results, html`<div data-table></div>${pagerHtml(pg)}`);
      renderTable($('[data-table]', results), current === 'audit' ? {
        caption: 'Audit log', rows: items,
        empty: emptyState('No activity matches', 'Try a wider date range.'),
        columns: [
          { key: 'timestamp', label: 'When', primary: true, render: (x) => fmtDateTime(x.timestamp) },
          { key: 'userName', label: 'Person', render: (x) => x.userName },
          { key: 'action', label: 'Action', render: (x) => titleCase(x.action.replace(/_/g, ' ')) },
          { key: 'entityId', label: 'Record', render: (x) => x.entity === 'Report' && x.entityId ? html`<a href="reports.html#view/${x.entityId}">${x.entityId}</a>` : html`${x.entity}<span class="sub">${x.entityId}</span>` },
          { key: 'details', label: 'Details', render: (x) => (x.oldValue || x.newValue) ? html`<button class="btn sm" type="button" data-detail="${x.logId}">View</button>` : '' }
        ]
      } : {
        caption: 'System errors', rows: items,
        empty: emptyState('No errors recorded', 'Unexpected server errors appear here with the reference shown to users.'),
        columns: [
          { key: 'timestamp', label: 'When', primary: true, render: (x) => html`${fmtDateTime(x.timestamp)}<span class="sub">${x.errorId}</span>` },
          { key: 'action', label: 'Action', render: (x) => x.action },
          { key: 'message', label: 'Message', render: (x) => x.message },
          { key: 'details', label: 'Details', render: (x) => html`<button class="btn sm" type="button" data-detail="${x.errorId}">View</button>` }
        ]
      });
    } catch (e) { if (ctx.isCurrent()) renderError(results, e, load); }
  };
  const pretty = (s) => { if (!s) return ''; try { return JSON.stringify(JSON.parse(s), null, 2); } catch (e) { return s; } };
  on(c, 'click', '[data-detail]', (e, b) => {
    const x = items.find((i) => (i.logId || i.errorId) === b.dataset.detail);
    if (!x) return;
    openModal({
      title: current === 'audit' ? titleCase(x.action.replace(/_/g, ' ')) : 'Error ' + x.errorId, wide: true,
      body: current === 'audit' ? html`<dl class="kv" style="margin-bottom:14px"><dt>When</dt><dd>${fmtDateTime(x.timestamp)}</dd><dt>Person</dt><dd>${x.userName} (${x.userId})</dd><dt>Record</dt><dd>${x.entity} ${x.entityId}</dd></dl>
          <div class="grid-2"><div><h3 class="section-title">Before</h3><pre class="json-cell">${pretty(x.oldValue) || 'Nothing'}</pre></div><div><h3 class="section-title">After</h3><pre class="json-cell">${pretty(x.newValue) || 'Nothing'}</pre></div></div>
          <h3 class="section-title">Request</h3><pre class="json-cell">${pretty(x.metadata)}</pre>`
        : html`<dl class="kv" style="margin-bottom:14px"><dt>When</dt><dd>${fmtDateTime(x.timestamp)}</dd><dt>User</dt><dd>${x.userId || '–'}</dd><dt>Action</dt><dd>${x.action}</dd></dl>
          <p><strong>${x.message}</strong></p><pre class="json-cell">${x.stack}</pre><h3 class="section-title">Request data (secrets removed)</h3><pre class="json-cell">${pretty(x.payload)}</pre>`,
      footer: html`<button class="btn primary" type="button" data-close>Close</button>`
    });
  });
  on(c, 'click', '[data-tab]', (e, b) => {
    current = b.dataset.tab; page = 1;
    $$('[data-tab]', c).forEach((x) => x.setAttribute('aria-selected', String(x === b)));
    drawExtra();
    setHashQuery(Object.assign(formValues(form), { tab: current }), true);
    load();
  });
  on(c, 'click', '[data-page]', (e, b) => { page = Number(b.dataset.page); load(); });
  let timer = null;
  form.addEventListener('change', () => { page = 1; setHashQuery(Object.assign(formValues(form), { tab: current }), true); load(); });
  form.addEventListener('input', (e) => { if (e.target.type === 'search') { clearTimeout(timer); timer = setTimeout(() => { page = 1; load(); }, 350); } });
  form.addEventListener('submit', (e) => e.preventDefault());
  load();
}
