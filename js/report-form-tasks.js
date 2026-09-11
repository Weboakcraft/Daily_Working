/** Task list editor used inside the daily report form. */
import { html, setHTML, $, $$, on, icon, attr, titleCase, fmtMinutes, fmtDate, confirmDialog, toast, TASK_STATUS_OPTIONS, PRIORITY_OPTIONS } from './app.js';

const RELATED = ['CUSTOMER', 'ORDER', 'PROJECT', 'TENDER', 'VENDOR', 'PRODUCT', 'OTHER'];

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
  const open = !!S.openTasks[k];
  const err = S.taskErrors[i] || '';
  const cats = S.data.taskCategories || [];
  const timed = !!(t.startTime && t.endTime);
  return html`<div class="task ${err ? 'has-error' : ''}" data-task-card data-index="${i}" data-key="${k}">
    <div class="task-head">
      <label class="sr-only" for="tt-${k}">Task ${i + 1} title</label>
      <input class="input" id="tt-${k}" data-tk="${k}" data-tf="title" value="${t.title || ''}" maxlength="200" placeholder="What did you work on?" autocomplete="off">
      <label class="sr-only" for="ts-${k}">Task ${i + 1} status</label>
      <select class="select" id="ts-${k}" data-tk="${k}" data-tf="status">${TASK_STATUS_OPTIONS.map((s) => html`<option value="${s}" ${attr(s === t.status, 'selected')}>${titleCase(s)}</option>`)}</select>
      <button class="btn ghost icon" type="button" data-tact="toggle" data-tk="${k}" aria-expanded="${open}" aria-controls="tb-${k}" aria-label="${open ? 'Hide' : 'Show'} details for task ${i + 1}">${icon(open ? 'up' : 'down')}</button>
    </div>
    <div class="task-meta" data-meta="${k}">${metaLine(t)}</div>
    <div class="task-error ${err ? '' : 'hidden'}" role="alert">${err}</div>
    <div class="task-body ${open ? '' : 'hidden'}" id="tb-${k}">
      <div class="form-grid">
        <div class="field"><label for="tp-${k}">Priority</label><select class="select" id="tp-${k}" data-tk="${k}" data-tf="priority">${PRIORITY_OPTIONS.map((p) => html`<option value="${p}" ${attr(p === (t.priority || 'MEDIUM'), 'selected')}>${titleCase(p)}</option>`)}</select></div>
        <div class="field"><label for="tc-${k}">Category</label><select class="select" id="tc-${k}" data-tk="${k}" data-tf="category"><option value="">None</option>${cats.map((c) => html`<option ${attr(c === t.category, 'selected')}>${c}</option>`)}${t.category && cats.indexOf(t.category) < 0 ? html`<option selected>${t.category}</option>` : ''}</select></div>
        <div class="field"><label for="trt-${k}">Related to</label><select class="select" id="trt-${k}" data-tk="${k}" data-tf="relatedType"><option value="">Nothing specific</option>${RELATED.map((r) => html`<option value="${r}" ${attr(r === t.relatedType, 'selected')}>${titleCase(r)}</option>`)}</select></div>
        <div class="field"><label for="tst-${k}">Start time</label><input class="input" type="time" id="tst-${k}" data-tk="${k}" data-tf="startTime" value="${t.startTime || ''}"></div>
        <div class="field"><label for="tet-${k}">End time</label><input class="input" type="time" id="tet-${k}" data-tk="${k}" data-tf="endTime" value="${t.endTime || ''}"></div>
        <div class="field"><label for="td-${k}">Time spent (minutes)</label><input class="input" type="number" min="0" max="1440" inputmode="numeric" id="td-${k}" data-tk="${k}" data-tf="duration" value="${timed ? minutesOf(t) : (t.duration || '')}" ${attr(timed, 'readonly')}>
          <span class="hint">${timed ? 'Calculated from start and end time.' : 'Or enter start and end times.'}</span></div>
        <div class="field full"><label for="tre-${k}">Customer, order, tender or reference</label><input class="input" id="tre-${k}" data-tk="${k}" data-tf="relatedEntity" value="${t.relatedEntity || ''}" maxlength="150" placeholder="e.g. Sharma Interiors, order 4512, GEM/2026/B/1234"></div>
        <div class="field full"><label for="tdesc-${k}">Details</label><textarea class="textarea" rows="2" id="tdesc-${k}" data-tk="${k}" data-tf="description" maxlength="3000">${t.description || ''}</textarea></div>
        <div class="field full"><label for="trem-${k}" data-rem-label="${k}">${t.status === 'BLOCKED' ? 'What is blocking it, and who can help?' : 'Remarks'}</label><textarea class="textarea" rows="2" id="trem-${k}" data-tk="${k}" data-tf="remarks" maxlength="1000">${t.remarks || ''}</textarea></div>
      </div>
      <div class="row" style="margin-top:12px">
        <button class="btn sm" type="button" data-tact="up" data-tk="${k}" ${attr(i === 0, 'disabled')} aria-label="Move task up">${icon('up')}Move up</button>
        <button class="btn sm" type="button" data-tact="down" data-tk="${k}" ${attr(i === S.tasks.length - 1, 'disabled')} aria-label="Move task down">${icon('down')}Move down</button>
        <button class="btn sm danger" type="button" data-tact="remove" data-tk="${k}" style="margin-left:auto">Remove task</button>
      </div>
    </div>
  </div>`;
}

export function renderTaskList(S) {
  const done = S.tasks.filter((t) => t.status === 'COMPLETED').length;
  return html`${S.tasks.length ? html`<p class="small muted" style="margin:-6px 0 12px">${S.tasks.length} ${S.tasks.length === 1 ? 'task' : 'tasks'}, ${done} completed</p>` : ''}
    <div class="task-list" data-task-list>${S.tasks.map((t, i) => renderTaskCard(S, t, i))}</div>
    ${!S.tasks.length ? html`<p class="muted" style="margin:0 0 12px">No tasks yet. Add the first thing you worked on today.</p>` : ''}
    <div class="add-task" style="margin-top:12px">
      <label class="sr-only" for="new-task">New task title</label>
      <input class="input" id="new-task" data-new-task maxlength="200" placeholder="Add a task, then press Enter" autocomplete="off">
      <button class="btn" type="button" data-tact="add">${icon('plus')}Add task</button>
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
    if (f === 'startTime' || f === 'endTime') {
      const d = $('#td-' + t.clientKey);
      const timed = !!(t.startTime && t.endTime);
      if (d) { d.readOnly = timed; if (timed) { d.value = t.endTime >= t.startTime ? String(minutesOf(t)) : ''; t.duration = d.value; } d.nextElementSibling.textContent = timed ? 'Calculated from start and end time.' : 'Or enter start and end times.'; }
    }
    if (f === 'status') {
      const lbl = $('[data-rem-label="' + t.clientKey + '"]');
      if (lbl) lbl.textContent = t.status === 'BLOCKED' ? 'What is blocking it, and who can help?' : 'Remarks';
      if (t.status === 'BLOCKED' && !S.openTasks[t.clientKey]) { S.openTasks[t.clientKey] = true; rerender('#trem-' + t.clientKey); h.markChanged(); return; }
    }
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
    const title = input ? input.value.trim() : '';
    const t = { clientKey: h.newKey(), taskId: '', sourceTaskId: '', title, description: '', category: '', priority: 'MEDIUM', status: 'COMPLETED', relatedType: '', relatedEntity: '', remarks: '', startTime: '', endTime: '', duration: '' };
    S.tasks.push(t);
    if (!title) S.openTasks[t.clientKey] = true;
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
    if (act === 'toggle') { S.openTasks[t.clientKey] = !S.openTasks[t.clientKey]; rerender('[data-tact="toggle"][data-tk="' + t.clientKey + '"]'); }
    else if (act === 'up' || act === 'down') {
      const j = act === 'up' ? i - 1 : i + 1;
      if (j < 0 || j >= S.tasks.length) return;
      S.tasks.splice(j, 0, S.tasks.splice(i, 1)[0]);
      S.taskErrors = {};
      h.markChanged();
      rerender('[data-tact="' + act + '"][data-tk="' + t.clientKey + '"]');
    } else if (act === 'remove') {
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
