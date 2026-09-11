/**
 * Daily report form (employee.html#today[/yyyy-MM-dd]).
 * Step-by-step, phone-first, auto-saves drafts, keeps an on-device backup when offline,
 * and submits with an idempotency key so retries never create duplicates.
 */
import { CONFIG } from './config.js';
import { api, ApiError, newRequestId } from './api.js';
import {
  html, setHTML, $, $$, on, icon, toast, errorMessage, confirmDialog, openModal, renderError, skeleton, emptyState,
  fmtDate, fmtTime, fmtHm, fmtMinutes, fmtDateTime, relTime, titleCase, reportPill, taskPill, prio, attr, addDays,
  setLeaveGuard, withBusy, TASK_STATUS_OPTIONS, PRIORITY_OPTIONS
} from './app.js';
import { renderQuestion, readValue, validateAnswer, isVisible, isEmpty, initialValue, SECTION_LABELS } from './question-controls.js';
import { renderTaskList, renderTaskCard, bindTaskEvents } from './report-form-tasks.js';
import { whatsAppButtonHtml, bindWhatsAppButton } from './whatsapp.js';

const STEP_DEFS = [
  { id: 'carry', title: 'Unfinished work', desc: 'These tasks are still open from earlier days. Continue them today, mark them done, or cancel them.' },
  { id: 'tasks', title: "Today's tasks", desc: 'Add each piece of work with its status. Open the details to add time, customer or order references.' },
  { id: 'summary', title: 'Work summary', sections: ['WORK_SUMMARY', 'COMPLETED', 'PENDING', 'CARRY_FORWARD'], desc: 'Describe the day in your own words.' },
  { id: 'kpi', title: 'Department numbers', sections: ['KPI'], desc: "Enter today's figures. Leave a number blank if it does not apply." },
  { id: 'issues', title: 'Issues and follow-ups', sections: ['BLOCKERS', 'FOLLOWUPS', 'MEETINGS'], desc: 'Tell your manager what is stuck and what you followed up on.' },
  { id: 'plan', title: 'Tomorrow and notes', sections: ['TOMORROW_PLAN', 'NOTES'], desc: 'Plan the next working day.' },
  { id: 'review', title: 'Review and submit', desc: 'Check the summary, then submit. You cannot edit a report after submitting it.' }
];
const KNOWN_SECTIONS = STEP_DEFS.flatMap((s) => s.sections || []);

let S = null;

const backupKey = () => 'oc.draft.' + S.ctx.user.id + '.' + S.date;
function writeBackup() {
  try { localStorage.setItem(backupKey(), JSON.stringify({ at: new Date().toISOString(), v: S.version, answers: S.answers, tasks: S.tasks.map(stripTask) })); } catch (e) { /* storage full or disabled */ }
}
function readBackup() { try { return JSON.parse(localStorage.getItem(backupKey()) || 'null'); } catch (e) { return null; } }
function clearBackup() { try { localStorage.removeItem(backupKey()); } catch (e) { /* ignore */ } }

function stripTask(t) {
  return {
    taskId: t.taskId || '', clientKey: t.clientKey, sourceTaskId: t.sourceTaskId || '', title: t.title || '', description: t.description || '',
    category: t.category || '', startTime: t.startTime || '', endTime: t.endTime || '', duration: t.duration === '' || t.duration === undefined ? '' : t.duration,
    priority: t.priority || 'MEDIUM', status: t.status || 'COMPLETED', relatedType: t.relatedType || '', relatedEntity: t.relatedEntity || '', remarks: t.remarks || ''
  };
}
const newKey = () => 'k' + Math.random().toString(36).slice(2, 10);

function payload() {
  return { date: S.date, responses: S.answers, tasks: S.tasks.map(stripTask) };
}

// ============================ Entry ============================

export async function renderReportForm(ctx, args) {
  const date = args[0] && /^\d{4}-\d{2}-\d{2}$/.test(args[0]) ? args[0] : null;
  const c = ctx.content;
  setHTML(c, html`${ctx.head("Today's report")}${skeleton(8)}`);
  let data;
  try {
    data = await api('getTodayReport', date ? { date } : {});
  } catch (e) {
    if (!ctx.isCurrent()) return;
    setHTML(c, ctx.head("Today's report"));
    const box = document.createElement('div'); c.appendChild(box);
    renderError(box, e, () => renderReportForm(ctx, args));
    return;
  }
  if (!ctx.isCurrent()) return;
  S = {
    ctx, date: data.date, data, answers: {}, tasks: [], carry: data.carryForward.slice(), step: 0, steps: [],
    version: 0, savedVersion: 0, saving: false, savePromise: null, pendingSave: false, timer: null,
    saveState: data.report.lastSavedAt ? { kind: 'saved', at: data.report.lastSavedAt } : { kind: 'idle' },
    fieldErrors: {}, taskErrors: {}, submitRequestId: null, submitted: false, openTasks: {}
  };
  data.questions.forEach((q) => { S.answers[q.questionId] = initialValue(q, data.responses[q.questionId]); });
  S.tasks = data.tasks.map((t) => Object.assign({ clientKey: newKey() }, t));
  S.steps = STEP_DEFS.filter((st) => {
    if (st.id === 'carry') return data.canEdit && data.carryForward.length > 0;
    if (!st.sections) return true;
    return data.questions.some((q) => st.sections.indexOf(q.section) >= 0 || (st.id === 'plan' && KNOWN_SECTIONS.indexOf(q.section) < 0));
  });

  const isSubmitted = data.report.status === 'SUBMITTED' || data.report.status === 'LATE';
  if (isSubmitted) { renderAlreadySubmitted(); return; }
  if (!data.canEdit) { renderLocked(); return; }

  const backup = readBackup();
  const serverAt = data.report.lastSavedAt ? new Date(data.report.lastSavedAt).getTime() : 0;
  S.restoreOffer = backup && new Date(backup.at).getTime() > serverAt &&
    JSON.stringify({ a: backup.answers, t: backup.tasks.map((t) => Object.assign({}, t, { clientKey: '' })) }) !==
    JSON.stringify({ a: S.answers, t: S.tasks.map(stripTask).map((t) => Object.assign({}, t, { clientKey: '' })) }) ? backup : null;

  const guard = async () => {
    if (!isDirty()) return true;
    await flushSave();
    if (!isDirty()) return true;
    return confirmDialog({ title: 'Leave without saving?', message: 'Some changes have not reached the server yet. They are kept on this device and will be offered when you come back.', confirmText: 'Leave page' });
  };
  guard.dirty = isDirty;
  setLeaveGuard(guard);
  window.addEventListener('online', onOnline);
  renderShell();
}

function isDirty() { return !!S && !S.submitted && S.version !== S.savedVersion; }
function onOnline() { if (S && isDirty()) saveNow(); }

// ============================ Change tracking & saving ============================

export function markChanged(opts) {
  S.version++;
  writeBackup();
  if (!(opts && opts.silent)) setSaveState({ kind: 'pending' });
  clearTimeout(S.timer);
  S.timer = setTimeout(saveNow, CONFIG.AUTOSAVE_DELAY_MS);
}

async function flushSave() {
  clearTimeout(S.timer);
  if (S.saving && S.savePromise) await S.savePromise;
  if (isDirty()) await saveNow();
}

function applyIdMap(idMap) {
  S.tasks.forEach((t) => { if (!t.taskId && idMap && idMap[t.clientKey]) t.taskId = idMap[t.clientKey]; });
}

async function saveNow() {
  if (!S || S.submitted || !S.data.canEdit) return;
  if (S.saving) { S.pendingSave = true; return S.savePromise; }
  if (S.version === S.savedVersion) return;
  const v = S.version;
  S.saving = true;
  setSaveState({ kind: 'saving' });
  S.savePromise = (async () => {
    try {
      const res = await api('saveDraft', payload(), { write: true });
      applyIdMap(res.idMap);
      S.savedVersion = v;
      S.data.report = res.report;
      const pill = $('[data-status-pill]');
      if (pill) setHTML(pill, reportPill(res.report.status));
      if (S.version === v) clearBackup();
      S.fieldErrors = {}; S.taskErrors = {};
      setSaveState({ kind: 'saved', at: res.savedAt });
      refreshErrorMarks();
    } catch (e) {
      if (e instanceof ApiError && e.isNetwork) setSaveState({ kind: 'offline' });
      else if (e instanceof ApiError && e.code === 'VALIDATION') {
        S.fieldErrors = e.fieldErrors || {}; S.taskErrors = e.taskErrors || {};
        setSaveState({ kind: 'invalid', message: e.message });
        refreshErrorMarks();
      } else if (e instanceof ApiError && e.code === 'REPORT_LOCKED') {
        setSaveState({ kind: 'error', message: e.message });
        toast(e.message, 'bad');
      } else setSaveState({ kind: 'error', message: errorMessage(e) });
    } finally {
      S.saving = false;
      if (S.pendingSave) { S.pendingSave = false; setTimeout(saveNow, 50); }
    }
  })();
  return S.savePromise;
}

function setSaveState(st) {
  S.saveState = st;
  const el = $('[data-save-state]');
  if (!el) return;
  el.className = 'save-state';
  let text = '';
  switch (st.kind) {
    case 'saved': text = 'Draft saved ' + fmtTime(st.at); break;
    case 'saving': text = 'Saving…'; break;
    case 'pending': text = 'Unsaved changes'; break;
    case 'offline': text = 'Offline. Changes are kept on this device and will save when you reconnect.'; el.classList.add('warn'); break;
    case 'invalid': text = 'Not saved: ' + st.message + ' Check the highlighted answers.'; el.classList.add('bad'); break;
    case 'error': text = 'Not saved: ' + st.message; el.classList.add('bad'); break;
    default: text = 'Your answers save automatically.';
  }
  setHTML(el, html`${st.kind === 'offline' ? icon('cloudOff') : ''}<span>${text}</span>${st.kind === 'error' || st.kind === 'offline' ? html` <button class="link-btn" type="button" data-act="retry-save">Retry</button>` : ''}`);
  $$('svg', el).forEach((s) => { s.style.width = '16px'; s.style.height = '16px'; });
}

// ============================ Validation ============================

function clientErrors(forSubmit) {
  const fieldErrors = {}, taskErrors = {};
  S.data.questions.forEach((q) => {
    if (!isVisible(q, S.answers)) return;
    const v = S.answers[q.questionId];
    const err = validateAnswer(q, v);
    if (err) fieldErrors[q.questionId] = err;
    else if (forSubmit && q.required && isEmpty(v)) fieldErrors[q.questionId] = 'This question is required.';
  });
  S.tasks.forEach((t, i) => {
    const e = [];
    if (forSubmit && !String(t.title || '').trim()) e.push('Add a task title.');
    if (t.startTime && t.endTime && t.endTime < t.startTime) e.push('End time cannot be before start time.');
    if (e.length) taskErrors[i] = e.join(' ');
  });
  return { fieldErrors, taskErrors };
}

function stepHasError(step) {
  if (step.id === 'tasks') return Object.keys(S.taskErrors).length > 0;
  if (!step.sections) return false;
  return S.data.questions.some((q) => S.fieldErrors[q.questionId] && questionInStep(q, step));
}
function questionInStep(q, step) {
  return (step.sections || []).indexOf(q.section) >= 0 || (step.id === 'plan' && KNOWN_SECTIONS.indexOf(q.section) < 0);
}

function refreshErrorMarks() {
  const rail = $('[data-steps]');
  if (rail) setHTML(rail, stepRail());
  const mob = $('[data-step-mobile]');
  if (mob) setHTML(mob, stepMobile());
  S.data.questions.forEach((q) => {
    const wrap = $('[data-qwrap="' + q.questionId + '"]');
    if (!wrap) return;
    const err = S.fieldErrors[q.questionId] || '';
    wrap.classList.toggle('has-error', !!err);
    const slot = wrap.querySelector('.error');
    if (slot) slot.textContent = err;
  });
  $$('[data-task-card]').forEach((card) => {
    const i = Number(card.dataset.index);
    const err = S.taskErrors[i] || '';
    card.classList.toggle('has-error', !!err);
    const slot = card.querySelector('.task-error');
    if (slot) { slot.textContent = err; slot.classList.toggle('hidden', !err); }
  });
}

// ============================ Submission ============================

async function submit(btn) {
  const errs = clientErrors(true);
  S.fieldErrors = errs.fieldErrors; S.taskErrors = errs.taskErrors;
  if (Object.keys(errs.fieldErrors).length || Object.keys(errs.taskErrors).length) {
    goToFirstError();
    toast('Some answers need attention before you can submit.', 'bad');
    return;
  }
  const late = Date.now() > new Date(S.data.deadline.graceEnd).getTime();
  const ok = await confirmDialog({
    title: 'Submit this report?',
    message: (late ? 'The deadline has passed, so this report will be marked as late. ' : '') + 'After submitting you cannot change it unless the admin reopens it.',
    confirmText: 'Submit report'
  });
  if (!ok) return;
  await withBusy(btn, async () => {
    clearTimeout(S.timer);
    if (S.saving && S.savePromise) await S.savePromise;
    S.submitRequestId = S.submitRequestId || newRequestId();
    try {
      const res = await api('submitReport', payload(), { write: true, requestId: S.submitRequestId });
      S.submitted = true;
      clearBackup();
      setLeaveGuard(null);
      window.removeEventListener('online', onOnline);
      renderReceipt(res.receipt, res.alreadySubmitted);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'VALIDATION') {
        S.submitRequestId = null;
        S.fieldErrors = e.fieldErrors || {}; S.taskErrors = e.taskErrors || {};
        goToFirstError();
        toast(e.message, 'bad');
      } else if (e instanceof ApiError && e.isNetwork) {
        writeBackup();
        toast('Not submitted yet: the connection failed. Your answers are kept on this device. Press Submit again when you are back online.', 'bad');
      } else {
        S.submitRequestId = null;
        toast(errorMessage(e), 'bad');
      }
    }
  });
}

function goToFirstError() {
  const idx = S.steps.findIndex((st) => stepHasError(st));
  S.step = idx >= 0 ? idx : S.step;
  renderStep();
  setTimeout(() => {
    const first = $('.has-error input, .has-error textarea, .has-error select, .task.has-error input');
    if (first) first.focus();
  }, 30);
}

// ============================ Views ============================

function deadlineText() {
  const d = S.data.deadline, now = Date.now();
  const dl = new Date(d.deadline).getTime(), ge = new Date(d.graceEnd).getTime();
  const isToday = S.date === S.data.today;
  if (!isToday) return { cls: 'past', text: 'Report for ' + fmtDate(S.date) + '. The deadline for that day has passed, so it will be marked late.' };
  if (now > ge) return { cls: 'past', text: 'The deadline (' + fmtHm(d.time) + ') has passed. Your report will be marked late.' };
  if (now > dl) return { cls: 'past', text: 'Deadline passed at ' + fmtHm(d.time) + '. Submit before ' + fmtTime(d.graceEnd) + ' to avoid a late mark.' };
  const mins = Math.round((dl - now) / 60000);
  if (mins <= 60) return { cls: 'soon', text: 'Due by ' + fmtHm(d.time) + ', in ' + mins + ' min' };
  return { cls: '', text: 'Due by ' + fmtHm(d.time) };
}

function stepRail() {
  return html`${S.steps.map((st, i) => html`<li class="${i < S.step ? 'done' : ''} ${i === S.step ? 'current' : ''} ${stepHasError(st) ? 'has-error' : ''}">
    <button type="button" data-act="go" data-step="${i}" ${attr(i === S.step, 'aria-current', 'step')}><span class="label"><span class="n">${i + 1}</span>${st.id === 'kpi' && S.data.department ? titleCase(S.data.department.name) + ' numbers' : st.title}</span></button></li>`)}`;
}
function stepMobile() {
  const st = S.steps[S.step];
  return html`<div class="row between small"><strong>Step ${S.step + 1} of ${S.steps.length}: ${st.id === 'kpi' && S.data.department ? titleCase(S.data.department.name) + ' numbers' : st.title}</strong></div>
    <div class="segbar" aria-hidden="true">${S.steps.map((s, i) => html`<span class="${stepHasError(s) ? 'err' : i < S.step ? 'done' : i === S.step ? 'current' : ''}"></span>`)}</div>`;
}

function renderShell() {
  const c = S.ctx.content, d = S.data;
  const dl = deadlineText();
  const allowYesterday = d.backdateDaysAllowed > 0;
  setHTML(c, html`<div class="form-shell">
    <div class="form-top">
      <div>
        <h1>${S.date === d.today ? "Today's report" : 'Report for ' + fmtDate(S.date, 'short')}</h1>
        <div class="row small" style="margin-top:6px;gap:8px"><span data-status-pill>${reportPill(d.report.status)}</span><span>${fmtDate(S.date)}</span>${d.department ? html`<span class="muted">${titleCase(d.department.name)}</span>` : ''}</div>
        <p class="deadline ${dl.cls}" data-deadline style="margin:6px 0 0">${icon('clock')} ${dl.text}</p>
      </div>
      ${allowYesterday ? html`<div class="field" style="min-width:190px"><label for="report-date" class="small">Report for</label>
        <select class="select" id="report-date" data-act-change="date">
          ${Array.from({ length: d.backdateDaysAllowed + 1 }, (_, i) => addDays(d.today, -i)).map((x, i) => html`<option value="${x}" ${attr(x === S.date, 'selected')}>${i === 0 ? 'Today' : i === 1 ? 'Yesterday' : fmtDate(x, 'short')}, ${fmtDate(x, 'tiny')}</option>`)}
        </select></div>` : ''}
    </div>
    ${!d.workingDay.working ? html`<div class="banner info">${icon('info')}<span class="banner-body">${fmtDate(S.date)} is marked as “${d.workingDay.reason}”. A report is not expected, but you can still submit one if you worked.</span></div>` : ''}
    ${!d.reportRequired ? html`<div class="banner info">${icon('info')}<span class="banner-body">Daily reports are optional for your account.</span></div>` : ''}
    ${d.report.status === 'REOPENED' ? html`<div class="banner warn">${icon('alert')}<span class="banner-body">The admin reopened this report${d.report.reopenReason ? ': “' + d.report.reopenReason + '”' : ''}. Make the changes and submit again.</span></div>` : ''}
    ${S.restoreOffer ? html`<div class="banner warn" data-restore>${icon('cloudOff')}<span class="banner-body">This device has changes from ${relTime(S.restoreOffer.at)} that were not saved to the server.
      <span class="row" style="margin-top:8px"><button class="btn sm primary" type="button" data-act="restore">Restore my changes</button><button class="btn sm" type="button" data-act="discard-restore">Discard them</button></span></span></div>` : ''}
    <ol class="steps" data-steps aria-label="Report steps">${stepRail()}</ol>
    <div class="step-mobile" data-step-mobile>${stepMobile()}</div>
    <section class="step-panel" data-step-panel aria-live="polite"></section>
    <div class="sticky-bar">
      <span class="save-state" data-save-state></span>
      <button class="btn" type="button" data-act="back">${icon('left')}Back</button>
      <button class="btn primary" type="button" data-act="next">Next${icon('right')}</button>
    </div>
  </div>`);
  $$('[data-deadline] svg', c).forEach((s) => { s.style.width = '15px'; s.style.height = '15px'; s.style.verticalAlign = '-2px'; });
  setSaveState(S.saveState);
  bindEvents(c);
  renderStep();
  clearInterval(S.deadlineTimer);
  S.deadlineTimer = setInterval(() => {
    const el = $('[data-deadline]');
    if (!el || !S || S.submitted) { clearInterval(S && S.deadlineTimer); return; }
    const t = deadlineText();
    el.className = 'deadline ' + t.cls;
    el.lastChild.textContent = ' ' + t.text;
  }, 30000);
}

function renderStep() {
  const panel = $('[data-step-panel]');
  if (!panel) return;
  const st = S.steps[S.step];
  const title = st.id === 'kpi' && S.data.department ? titleCase(S.data.department.name) + ' numbers' : st.title;
  let body;
  if (st.id === 'carry') body = renderCarry();
  else if (st.id === 'tasks') body = renderTaskList(S);
  else if (st.id === 'review') body = renderReview();
  else {
    const qs = S.data.questions.filter((q) => questionInStep(q, st));
    let lastSection = '';
    body = html`<div class="q-list">${qs.map((q) => {
      const head = st.sections.length > 1 && q.section !== lastSection && qs.filter((x) => x.section === q.section).length > 0 && st.id !== 'summary' ? html`<h3 class="section-title">${SECTION_LABELS[q.section] || titleCase(q.section)}</h3>` : '';
      lastSection = q.section;
      const visible = isVisible(q, S.answers);
      return html`${head}<div class="${visible ? '' : 'hidden'}" data-vis="${q.questionId}">${renderQuestion(q, S.answers[q.questionId], S.fieldErrors[q.questionId], { disabled: S.submitted })}</div>`;
    })}</div>`;
  }
  setHTML(panel, html`<h2 tabindex="-1" data-step-title>${title}</h2><p class="muted">${st.desc}</p>${body}`);
  setHTML($('[data-steps]'), stepRail());
  setHTML($('[data-step-mobile]'), stepMobile());
  const back = $('[data-act="back"]'), next = $('[data-act="next"]');
  back.classList.toggle('hidden', S.step === 0);
  if (st.id === 'review') { next.dataset.act = 'submit'; setHTML(next, html`${icon('check')}Submit report`); }
  else { next.dataset.act = 'next'; setHTML(next, html`Next${icon('right')}`); }
}

function focusStepTitle() {
  const t = $('[data-step-title]');
  if (t) { t.focus({ preventScroll: true }); window.scrollTo({ top: 0, behavior: 'smooth' }); }
}

function renderCarry() {
  if (!S.carry.length) return emptyState('Nothing left over', 'All unfinished work has been handled. Continue to today\'s tasks.');
  return html`${S.carry.length > 1 ? html`<div class="row" style="margin-bottom:10px"><button class="btn sm" type="button" data-act="cf-continue-all">${icon('plus')}Continue all ${S.carry.length} today</button></div>` : ''}
  <div class="panel">${S.carry.map((t) => html`<div class="cf-item" data-cf="${t.taskId}">
    <div><div class="t">${t.title}</div>
      <div class="row small muted" style="gap:10px;margin-top:4px">${taskPill(t.status)}${prio(t.priority)}<span>From ${fmtDate(t.reportDate, 'short')}</span>${t.carryCount ? html`<span class="carry-tag">Carried ${t.carryCount} ${t.carryCount === 1 ? 'time' : 'times'}</span>` : ''}${t.relatedEntity ? html`<span>${t.relatedEntity}</span>` : ''}</div>
      ${t.remarks ? html`<div class="small" style="margin-top:4px">${t.remarks}</div>` : ''}</div>
    <div class="cf-actions">
      <button class="btn sm" type="button" data-act="cf-continue" data-id="${t.taskId}">${icon('plus')}Continue today</button>
      <button class="btn sm" type="button" data-act="cf-complete" data-id="${t.taskId}">${icon('check')}Mark done</button>
      <button class="btn sm ghost" type="button" data-act="cf-cancel" data-id="${t.taskId}">Cancel task</button>
    </div></div>`)}</div>`;
}

function renderReview() {
  const errs = clientErrors(true);
  const missing = S.data.questions.filter((q) => errs.fieldErrors[q.questionId]);
  const counts = { total: S.tasks.length, done: S.tasks.filter((t) => t.status === 'COMPLETED').length, open: S.tasks.filter((t) => ['PENDING', 'IN PROGRESS'].indexOf(t.status) >= 0).length, blocked: S.tasks.filter((t) => t.status === 'BLOCKED').length };
  const minutes = S.tasks.reduce((a, t) => a + taskMinutes(t), 0);
  const answered = S.data.questions.filter((q) => isVisible(q, S.answers) && !isEmpty(S.answers[q.questionId])).length;
  const visibleCount = S.data.questions.filter((q) => isVisible(q, S.answers)).length;
  return html`${missing.length || Object.keys(errs.taskErrors).length ? html`<div class="banner bad" role="alert">${icon('alert')}<div class="banner-body"><strong>Fix these before submitting</strong>
      <ul style="margin:6px 0 0;padding-left:18px">${missing.map((q) => html`<li><button class="link-btn" type="button" data-act="jump-q" data-q-id="${q.questionId}">${q.text}</button>: ${errs.fieldErrors[q.questionId]}</li>`)}
      ${Object.keys(errs.taskErrors).map((i) => html`<li><button class="link-btn" type="button" data-act="jump-tasks">Task ${Number(i) + 1}</button>: ${errs.taskErrors[i]}</li>`)}</ul></div></div>`
    : html`<div class="banner ok">${icon('check')}<span class="banner-body">Everything required is filled in.</span></div>`}
    <div class="panel"><div class="panel-body"><ul class="review-list">
      <li><span>Tasks</span><strong class="num">${counts.total}</strong></li>
      <li><span>Completed</span><strong class="num">${counts.done}</strong></li>
      <li><span>Pending or in progress</span><strong class="num">${counts.open}</strong></li>
      <li><span>Blocked</span><strong class="num">${counts.blocked}</strong></li>
      <li><span>Time recorded</span><strong class="num">${minutes ? fmtMinutes(minutes) : 'None'}</strong></li>
      <li><span>Questions answered</span><strong class="num">${answered} of ${visibleCount}</strong></li>
      ${S.carry.length ? html`<li><span>Unfinished tasks not handled</span><strong class="num">${S.carry.length}</strong></li>` : ''}
    </ul></div></div>
    ${S.carry.length ? html`<p class="small muted" style="margin-top:10px">Unhandled tasks from earlier days will be offered again tomorrow.</p>` : ''}`;
}

export function taskMinutes(t) {
  if (t.startTime && t.endTime && t.endTime >= t.startTime) {
    const [a, b] = t.startTime.split(':').map(Number), [c, d] = t.endTime.split(':').map(Number);
    return (c * 60 + d) - (a * 60 + b);
  }
  return Number(t.duration) || 0;
}

function renderReceipt(r, already) {
  const c = S.ctx.content;
  const late = r.status === 'LATE';
  setHTML(c, html`<div class="receipt panel"><div class="panel-body">
    <div class="check-mark">${icon('check')}</div>
    <h1>${already ? 'This report was already submitted' : late ? 'Report submitted after the deadline' : 'Report submitted'}</h1>
    <p class="muted">${late ? 'It is saved and marked as late.' : 'Your manager can now see it.'} Keep the report ID for reference.</p>
    <dl class="kv" style="margin:18px 0">
      <dt>Report ID</dt><dd class="rid">${r.reportId}</dd>
      <dt>Submitted</dt><dd>${fmtDateTime(r.submittedAt)}</dd>
      <dt>Report date</dt><dd>${fmtDate(r.date)}</dd>
      <dt>Employee</dt><dd>${r.employeeName}</dd>
      <dt>Department</dt><dd>${titleCase(r.department)}</dd>
      <dt>Status</dt><dd>${reportPill(r.status)}</dd>
    </dl>
    <p style="margin:0 0 10px">Share it with your manager or team on WhatsApp. You choose the contact and press Send yourself.</p>
    <div class="row">${whatsAppButtonHtml()}<a class="btn" href="reports.html#view/${r.reportId}">View report</a><a class="btn ghost" href="employee.html#home">Go to home</a></div>
  </div></div>`);
  document.title = 'Report submitted | ' + S.ctx.settings.COMPANY_NAME;
  bindWhatsAppButton(c.querySelector('[data-whatsapp]'), () => api('getReport', { reportId: r.reportId }), S.ctx.settings.COMPANY_NAME);
  c.focus();
}

function renderAlreadySubmitted() {
  const { ctx, data } = S;
  setLeaveGuard(null);
  setHTML(ctx.content, html`${ctx.head(S.date === data.today ? "Today's report" : 'Report for ' + fmtDate(S.date, 'short'))}
    <div class="panel"><div class="panel-body stack">
      <div class="row">${reportPill(data.report.status)}<span>Submitted ${fmtDateTime(data.report.submittedAt)}</span></div>
      <p>This report is submitted and can no longer be edited. If something needs correcting, ask the admin to reopen it.</p>
      <div class="row">${whatsAppButtonHtml()}<a class="btn" href="reports.html#view/${data.report.reportId}">View report</a><a class="btn ghost" href="employee.html#home">Go to home</a>
      ${data.backdateDaysAllowed > 0 && S.date === data.today ? html`<a class="btn ghost" href="#today/${addDays(data.today, -1)}">Report for yesterday</a>` : ''}</div>
    </div></div>`);
  bindWhatsAppButton(ctx.content.querySelector('[data-whatsapp]'), () => api('getReport', { reportId: data.report.reportId }), ctx.settings.COMPANY_NAME);
}

function renderLocked() {
  const { ctx, data } = S;
  setLeaveGuard(null);
  setHTML(ctx.content, html`${ctx.head("Today's report")}<div class="banner warn">${icon('alert')}<span class="banner-body">${data.lockedReason}</span></div>
    ${data.report.reportId ? html`<a class="btn" href="reports.html#view/${data.report.reportId}">View saved draft</a>` : ''}`);
}

// ============================ Events ============================

function bindEvents(root) {
  const onAnswer = (e, el) => {
    const q = S.data.questions.find((x) => x.questionId === el.dataset.q);
    if (!q) return;
    const panel = $('[data-step-panel]');
    S.answers[q.questionId] = readValue(panel, q);
    if (S.fieldErrors[q.questionId]) {
      const err = validateAnswer(q, S.answers[q.questionId]);
      if (!err && !(q.required && isEmpty(S.answers[q.questionId]))) { delete S.fieldErrors[q.questionId]; refreshErrorMarks(); }
    }
    S.data.questions.forEach((x) => {
      if (!x.showIf) return;
      const box = panel.querySelector('[data-vis="' + x.questionId + '"]');
      if (box) box.classList.toggle('hidden', !isVisible(x, S.answers));
    });
    markChanged();
  };
  on(root, 'input', '[data-q]', onAnswer);
  on(root, 'change', '[data-q]', onAnswer);
  root.addEventListener('focusout', (e) => {
    const el = e.target.closest && e.target.closest('[data-q]');
    if (!el || !S) return;
    const q = S.data.questions.find((x) => x.questionId === el.dataset.q);
    const err = q && validateAnswer(q, S.answers[q.questionId]);
    if (err) { S.fieldErrors[q.questionId] = err; refreshErrorMarks(); }
  });

  on(root, 'click', '[data-step]', (e, b) => {
    if (b.dataset.act === 'go') return;
    const input = $('[data-q="' + b.dataset.for + '"]');
    if (!input || input.disabled) return;
    const q = S.data.questions.find((x) => x.questionId === b.dataset.for);
    const cur = Number(input.value) || 0;
    const r = q.validation || {};
    let next = cur + Number(b.dataset.step);
    if (r.min !== undefined) next = Math.max(r.min, next);
    if (r.max !== undefined) next = Math.min(r.max, next);
    input.value = String(q.type === 'DECIMAL' ? Math.round(next * 100) / 100 : Math.round(next));
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });

  on(root, 'change', '[data-act-change="date"]', (e, sel) => { location.hash = sel.value === S.data.today ? '#today' : '#today/' + sel.value; });

  on(root, 'click', '[data-act]', async (e, b) => {
    const act = b.dataset.act;
    if (act === 'go') { S.step = Number(b.dataset.step); renderStep(); focusStepTitle(); saveNow(); }
    else if (act === 'next') {
      const st = S.steps[S.step];
      const errs = clientErrors(false);
      const stepErr = st.sections ? S.data.questions.filter((q) => questionInStep(q, st) && errs.fieldErrors[q.questionId]) : [];
      if (stepErr.length) { stepErr.forEach((q) => { S.fieldErrors[q.questionId] = errs.fieldErrors[q.questionId]; }); refreshErrorMarks(); toast('Fix the highlighted answers to continue.', 'bad'); return; }
      S.step = Math.min(S.steps.length - 1, S.step + 1); renderStep(); focusStepTitle(); saveNow();
    }
    else if (act === 'back') { S.step = Math.max(0, S.step - 1); renderStep(); focusStepTitle(); }
    else if (act === 'submit') submit(b);
    else if (act === 'retry-save') saveNow();
    else if (act === 'restore') {
      const bk = S.restoreOffer;
      S.answers = Object.assign({}, S.answers, bk.answers);
      S.tasks = bk.tasks.map((t) => Object.assign({}, t, { clientKey: t.clientKey || newKey() }));
      const continued = {}; S.tasks.forEach((t) => { if (t.sourceTaskId) continued[t.sourceTaskId] = true; });
      S.carry = S.data.carryForward.filter((t) => !continued[t.taskId]);
      S.restoreOffer = null; $('[data-restore]').remove();
      markChanged(); renderStep(); toast('Changes restored. Saving now.');
      saveNow();
    }
    else if (act === 'discard-restore') { clearBackup(); S.restoreOffer = null; $('[data-restore]').remove(); }
    else if (act === 'jump-q') {
      const q = S.data.questions.find((x) => x.questionId === b.dataset.qId);
      const idx = S.steps.findIndex((st) => st.sections && questionInStep(q, st));
      S.fieldErrors = clientErrors(true).fieldErrors;
      S.step = idx; renderStep();
      setTimeout(() => { const el = $('[data-q="' + q.questionId + '"]'); if (el) el.focus(); }, 30);
    }
    else if (act === 'jump-tasks') { S.taskErrors = clientErrors(true).taskErrors; S.step = S.steps.findIndex((st) => st.id === 'tasks'); renderStep(); }
    else if (act === 'cf-continue-all') {
      S.carry.forEach((t) => S.tasks.push(continuedTask(t)));
      const n = S.carry.length;
      S.carry = [];
      markChanged(); renderStep(); toast(n + ' tasks added to today\'s tasks.');
    }
    else if (act === 'cf-continue') {
      const t = S.carry.find((x) => x.taskId === b.dataset.id);
      if (!t) return;
      S.carry = S.carry.filter((x) => x !== t);
      S.tasks.push(continuedTask(t));
      markChanged(); renderStep(); toast('Added to today\'s tasks.');
    }
    else if (act === 'cf-complete' || act === 'cf-cancel') {
      const t = S.carry.find((x) => x.taskId === b.dataset.id);
      if (!t) return;
      if (act === 'cf-cancel' && !(await confirmDialog({ title: 'Cancel this task?', message: '“' + t.title + '” will be marked cancelled and will not be carried forward again.', confirmText: 'Cancel task', cancelText: 'Keep task', danger: true }))) return;
      await withBusy(b, async () => {
        try {
          await api('updateTask', { taskId: t.taskId, status: act === 'cf-complete' ? 'COMPLETED' : 'CANCELLED' }, { write: true });
          S.carry = S.carry.filter((x) => x !== t);
          toast(act === 'cf-complete' ? 'Marked as done.' : 'Task cancelled.');
          renderStep();
        } catch (err) { toast(errorMessage(err), 'bad'); }
      });
    }
  });

  bindTaskEvents(root, S, { markChanged, renderStep, refreshErrorMarks, newKey, returnToCarry });
}

function continuedTask(t) {
  return { clientKey: newKey(), taskId: '', sourceTaskId: t.taskId, title: t.title, description: t.description, category: t.category, priority: t.priority, status: 'IN PROGRESS', relatedType: t.relatedType, relatedEntity: t.relatedEntity, remarks: '', startTime: '', endTime: '', duration: '', carryCount: t.carryCount + 1, fromDate: t.reportDate };
}

function returnToCarry(task) {
  if (!task.sourceTaskId) return;
  const original = S.data.carryForward.find((x) => x.taskId === task.sourceTaskId);
  if (original && !S.carry.some((x) => x.taskId === original.taskId)) S.carry.push(original);
}
