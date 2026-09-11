/** Task list editor used inside the daily report form. */
import { html, setHTML, $, on, icon, attr, titleCase, fmtMinutes, fmtDate, confirmDialog, toast, TASK_STATUS_OPTIONS } from './app.js';


function minutesOf(t) {
  if (t.startTime && t.endTime && t.endTime >= t.startTime) {
    const [a, b] = t.startTime.split(':').map(Number), [c, d] = t.endTime.split(':').map(Number);
    return (c * 60 + d) - (a * 60 + b);
  }
  return Number(t.duration) || 0;
}

function metaLine(t) {
  const bits = [];
  if (t.sourceTaskId) bits.push(html`<span class="carry-tag">Continued from ${t.fromDate ? fmtDate(t.fromDate, 'short') : 'an earlier day'}</span>`);
  if (t.priority && t.priority !== 'MEDIUM') bits.push(html`<span>${titleCase(t.priority)} priority</span>`);
  const m = minutesOf(t);
  if (m) bits.push(html`<span>${fmtMinutes(m)}</span>`);
  if (t.relatedEntity) bits.push(html`<span>${t.relatedType ? titleCase(t.relatedType) + ': ' : ''}${t.relatedEntity}</span>`);
  if (t.category) bits.push(html`<span>${t.category}</span>`);
  return html`${bits}`;
}

export function renderTaskCard(S, t, i) {
  const k = t.clientKey;
  const err = S.taskErrors[i] || '';
  return html`<div class="task ${err ? 'has-error' : ''}" data-task-card data-index="${i}" data-key="${k}">
    <div class="task-head">
      <label class="sr-only" for="tt-${k}">Task ${i + 1}</label>
      <input class="input" id="tt-${k}" data-tk="${k}" data-tf="title" value="${t.title || ''}" maxlength="200" placeholder="What did you work on?" autocomplete="off">
      <label class="sr-only" for="ts-${k}">Task ${i + 1} status</label>
      <select class="select" id="ts-${k}" data-tk="${k}" data-tf="status">${TASK_STATUS_OPTIONS.map((st) => html`<option value="${st}" ${attr(st === t.status, 'selected')}>${titleCase(st)}</option>`)}</select>
      <button class="btn ghost icon" type="button" data-tact="remove" data-tk="${k}" aria-label="Remove task ${i + 1}">${icon('x')}</button>
    </div>
    <div class="task-meta ${String(metaLine(t)).trim() ? '' : 'hidden'}" data-meta="${k}">${metaLine(t)}</div>
    <div class="task-error ${err ? '' : 'hidden'}" role="alert">${err}</div>
  </div>`;
}

export function renderTaskList(S) {
  const done = S.tasks.filter((t) => t.status === 'COMPLETED').length;
  return html`${S.tasks.length ? html`<p class="small muted" style="margin:-6px 0 12px">${S.tasks.length} ${S.tasks.length === 1 ? 'task' : 'tasks'}, ${done} completed</p>` : ''}
    <div class="task-list" data-task-list>${S.tasks.map((t, i) => renderTaskCard(S, t, i))}</div>
    ${!S.tasks.length ? html`<p class="muted" style="margin:0 0 12px">No tasks yet. Add the first thing you worked on today.</p>` : ''}
    <div class="add-task" style="margin-top:12px">
      <div class="field"><label for="new-task">Task details</label>
        <input class="input" id="new-task" data-new-task maxlength="200" placeholder="What did you work on?" autocomplete="off"></div>
      <div class="field"><label for="new-task-status">Task status</label>
        <select class="select" id="new-task-status" data-new-task-status>${TASK_STATUS_OPTIONS.map((st) => html`<option value="${st}" ${attr(st === (S.newTaskStatus || 'COMPLETED'), 'selected')}>${titleCase(st)}</option>`)}</select></div>
      <button class="btn primary" type="button" data-tact="add">${icon('plus')}Add task</button>
    </div>`;
}

export function bindTaskEvents(root, S, h) {
  const find = (k) => S.tasks.find((t) => t.clientKey === k);
  const rerender = (focusSel) => {
    h.renderStep();
    if (focusSel) setTimeout(() => { const el = $(focusSel); if (el) el.focus(); }, 20);
  };

  const onField = (e, el) => {
    const t = find(el.dataset.tk);
    if (!t) return;
    const f = el.dataset.tf;
    t[f] = el.value;
    const meta = $('[data-meta="' + t.clientKey + '"]');
    if (meta) setHTML(meta, metaLine(t));
    const idx = S.tasks.indexOf(t);
    if (S.taskErrors[idx] && (f === 'title' || f === 'startTime' || f === 'endTime')) {
      if (String(t.title).trim() && !(t.startTime && t.endTime && t.endTime < t.startTime)) { delete S.taskErrors[idx]; h.refreshErrorMarks(); }
    }
    h.markChanged();
  };
  on(root, 'input', '[data-tf]', onField);
  on(root, 'change', '[data-tf]', onField);

  const add = () => {
    const input = $('[data-new-task]');
    const statusEl = $('[data-new-task-status]');
    const title = input ? input.value.trim() : '';
    // Most people add a run of tasks with the same status, so the choice sticks for the next one.
    S.newTaskStatus = (statusEl && statusEl.value) || S.newTaskStatus || 'COMPLETED';
    const t = { clientKey: h.newKey(), taskId: '', sourceTaskId: '', title, description: '', category: '', priority: 'MEDIUM', status: S.newTaskStatus, relatedType: '', relatedEntity: '', remarks: '', startTime: '', endTime: '', duration: '' };
    S.tasks.push(t);
    h.markChanged();
    rerender(title ? '[data-new-task]' : '#tt-' + t.clientKey);
  };
  on(root, 'keydown', '[data-new-task]', (e) => { if (e.key === 'Enter') { e.preventDefault(); if (e.target.value.trim()) add(); } });

  on(root, 'click', '[data-tact]', async (e, b) => {
    const act = b.dataset.tact;
    if (act === 'add') { add(); return; }
    const t = find(b.dataset.tk);
    if (!t) return;
    const i = S.tasks.indexOf(t);
    if (act === 'remove') {
      if ((t.title || t.description) && !(await confirmDialog({ title: 'Remove this task?', message: '“' + (t.title || 'Untitled task') + '” will be removed from this report.' + (t.sourceTaskId ? ' It will go back to your unfinished work list.' : ''), confirmText: 'Remove task', danger: true }))) return;
      S.tasks.splice(i, 1);
      S.taskErrors = {};
      h.returnToCarry(t);
      h.markChanged();
      rerender('[data-new-task]');
      toast('Task removed.');
    }
  });
}
