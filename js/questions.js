/** Dynamic question builder (admin.html#questions[/DEPARTMENT_ID]). */
import {
  html, setHTML, $, $$, on, icon, toast, errorMessage, renderError, skeleton, emptyState, field, formValues, showFieldErrors,
  submitForm, withBusy, openModal, confirmDialog, attr, raw, titleCase
} from './app.js';
import { api, clearApiCache } from './api.js';
import { TYPE_LABELS, SECTION_LABELS, OPTION_TYPES, renderQuestion, readValue, isVisible, initialValue, parseShowIf, isMulti } from './question-controls.js';

const SECTIONS = Object.keys(SECTION_LABELS);
const TYPES = Object.keys(TYPE_LABELS);
const OPS = [{ value: '=', label: 'is' }, { value: '!=', label: 'is not' }, { value: '>', label: 'is more than' }, { value: '>=', label: 'is at least' }, { value: '<', label: 'is less than' }, { value: '<=', label: 'is at most' }];

export async function renderQuestionBuilder(ctx, args) {
  const c = ctx.content;
  const deptId = args[0] || 'ALL';
  setHTML(c, html`${ctx.head('Report questions', 'Common questions appear in every report. Department questions appear only for that department. Changes apply to new and draft reports immediately.')}${skeleton(8)}`);
  let depts, all, common;
  const showRetired = sessionStorage.getItem('oc.qb.retired') === '1';
  try {
    [depts, all] = await Promise.all([api('getDepartments', { includeInactive: true }), api('getQuestions', { includeInactive: true })]);
  } catch (e) { if (ctx.isCurrent()) renderError(c, e, () => renderQuestionBuilder(ctx, args)); return; }
  if (!ctx.isCurrent()) return;
  common = all.filter((q) => q.departmentId === 'ALL');
  const dept = deptId === 'ALL' ? null : depts.find((d) => d.departmentId === deptId);
  if (deptId !== 'ALL' && !dept) { location.hash = '#questions'; return; }
  const list = all.filter((q) => q.departmentId === deptId && (showRetired || q.status === 'Active'));
  const countFor = (id) => all.filter((q) => q.departmentId === id && q.status === 'Active').length;
  const title = dept ? titleCase(dept.name) : 'Common questions';

  setHTML(c, html`${ctx.head('Report questions', 'Common questions appear in every report. Department questions appear only for that department. Changes apply to new and draft reports straight away.')}
    <div class="qb">
      <nav class="qb-depts panel" aria-label="Question sets" style="padding:6px">
        <a href="#questions" aria-current="${deptId === 'ALL'}"><span>Common questions</span><span class="muted">${countFor('ALL')}</span></a>
        ${depts.map((d) => html`<a href="#questions/${d.departmentId}" aria-current="${d.departmentId === deptId}"><span>${titleCase(d.name)}${d.status === 'Active' ? '' : ' (inactive)'}</span><span class="muted">${countFor(d.departmentId)}</span></a>`)}
      </nav>
      <div>
        <div class="row between" style="margin-bottom:12px">
          <h2>${title}</h2>
          <div class="row">
            <label class="switch small"><input type="checkbox" data-retired ${attr(showRetired, 'checked')}><span>Show retired</span></label>
            ${dept ? html`<button class="btn" type="button" data-preview>${icon('eye')}Preview form</button>` : ''}
            <button class="btn primary" type="button" data-add>${icon('plus')}Add question</button>
          </div>
        </div>
        <div class="panel" data-list>${list.length ? listHtml(list, common) : emptyState('No questions yet', dept ? 'Add the numbers and questions this department should answer every day.' : 'Add questions every employee should answer.', html`<button class="btn primary" type="button" data-add>${icon('plus')}Add question</button>`)}</div>
        <p class="small muted" style="margin-top:10px">Drag questions by the handle, or use the arrow buttons, to change their order within a section. Retiring a question hides it from new reports but keeps past answers.</p>
      </div>
    </div>`);

  const reload = () => { clearApiCache(); renderQuestionBuilder(ctx, args); };
  $('[data-retired]', c).onchange = (e) => { sessionStorage.setItem('oc.qb.retired', e.target.checked ? '1' : '0'); reload(); };
  on(c, 'click', '[data-add]', () => openQuestionDialog(ctx, null, deptId, common, all, reload));
  on(c, 'click', '[data-edit]', (e, b) => openQuestionDialog(ctx, all.find((q) => q.questionId === b.dataset.edit), deptId, common, all, reload));
  on(c, 'click', '[data-toggle]', async (e, b) => {
    const q = all.find((x) => x.questionId === b.dataset.toggle);
    const retire = q.status === 'Active';
    if (retire && !(await confirmDialog({ title: 'Retire this question?', message: '“' + q.text + '” will no longer appear in reports. Answers already given stay in past reports.', confirmText: 'Retire question', danger: true }))) return;
    await withBusy(b, async () => {
      try { await api('updateQuestion', { question: { questionId: q.questionId, status: retire ? 'Inactive' : 'Active' } }, { write: true }); toast(retire ? 'Question retired.' : 'Question restored.'); reload(); }
      catch (err) { toast(errorMessage(err), 'bad'); }
    });
  });
  on(c, 'click', '[data-move]', async (e, b) => {
    const ids = currentOrder(c);
    const i = ids.indexOf(b.dataset.id);
    const q = all.find((x) => x.questionId === b.dataset.id);
    const j = b.dataset.move === 'up' ? i - 1 : i + 1;
    const other = all.find((x) => x.questionId === ids[j]);
    if (!other || other.section !== q.section) return;
    ids.splice(j, 0, ids.splice(i, 1)[0]);
    await saveOrder(ids, deptId, reload);
  });
  const prev = $('[data-preview]', c);
  if (prev) prev.onclick = () => openFormPreview(title, all.filter((q) => (q.departmentId === 'ALL' || q.departmentId === deptId) && q.status === 'Active'));
  bindDrag(c, all, deptId, reload);
}

function sortForList(list) {
  return list.slice().sort((a, b) => (SECTIONS.indexOf(a.section) - SECTIONS.indexOf(b.section)) || (a.order - b.order));
}

function conditionText(q, all) {
  const cnd = parseShowIf(q.showIf);
  if (!cnd) return '';
  const ref = all.find((x) => x.questionId === cnd.questionId);
  const op = (OPS.find((o) => o.value === cnd.op) || {}).label || cnd.op;
  return 'Shown when “' + (ref ? ref.text : cnd.questionId) + '” ' + op + ' ' + cnd.value;
}

function listHtml(list, common) {
  const sorted = sortForList(list);
  const all = common.concat(list);
  let last = '';
  return html`${sorted.map((q, i) => {
    const head = q.section !== last ? html`<div class="qb-section">${SECTION_LABELS[q.section] || titleCase(q.section)}</div>` : '';
    last = q.section;
    const prevSame = sorted[i - 1] && sorted[i - 1].section === q.section;
    const nextSame = sorted[i + 1] && sorted[i + 1].section === q.section;
    return html`${head}<div class="qb-item ${q.status === 'Active' ? '' : 'inactive'}" draggable="true" data-qid="${q.questionId}" data-section="${q.section}">
      <span class="qb-handle" aria-hidden="true" title="Drag to reorder">${icon('drag')}</span>
      <div><div class="qb-text">${q.text}${q.required ? html`<span class="req" aria-label="required"> *</span>` : ''}</div>
        <div class="qb-meta"><span>${TYPE_LABELS[q.type] || q.type}</span>${q.options && q.options.length ? html`<span>${q.options.length} options</span>` : ''}${q.validation && q.validation.target ? html`<span>Target ${q.validation.target}</span>` : ''}${q.showIf ? html`<span>${conditionText(q, all)}</span>` : ''}${q.key ? html`<span>Key ${q.key}</span>` : ''}${q.status === 'Active' ? '' : html`<span class="pill off plain">Retired</span>`}</div></div>
      <div class="qb-actions">
        <button class="btn sm ghost icon" type="button" data-move="up" data-id="${q.questionId}" ${attr(!prevSame, 'disabled')} aria-label="Move up">${icon('up')}</button>
        <button class="btn sm ghost icon" type="button" data-move="down" data-id="${q.questionId}" ${attr(!nextSame, 'disabled')} aria-label="Move down">${icon('down')}</button>
        <button class="btn sm" type="button" data-edit="${q.questionId}">Edit</button>
        <button class="btn sm ghost" type="button" data-toggle="${q.questionId}">${q.status === 'Active' ? 'Retire' : 'Restore'}</button>
      </div></div>`;
  })}`;
}

function currentOrder(c) { return $$('.qb-item', c).map((el) => el.dataset.qid); }

async function saveOrder(ids, deptId, reload) {
  try { await api('reorderQuestions', { departmentId: deptId, orderedIds: ids }, { write: true }); toast('Order saved.'); reload(); }
  catch (e) { toast(errorMessage(e), 'bad'); }
}

function bindDrag(c, all, deptId, reload) {
  let dragId = null;
  on(c, 'dragstart', '.qb-item', (e, el) => { dragId = el.dataset.qid; el.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', dragId); });
  on(c, 'dragend', '.qb-item', (e, el) => { el.classList.remove('dragging'); $$('.drop-before', c).forEach((x) => x.classList.remove('drop-before')); });
  on(c, 'dragover', '.qb-item', (e, el) => {
    const src = all.find((q) => q.questionId === dragId);
    if (!src || el.dataset.section !== src.section) return;
    e.preventDefault();
    $$('.drop-before', c).forEach((x) => x.classList.remove('drop-before'));
    el.classList.add('drop-before');
  });
  on(c, 'drop', '.qb-item', (e, el) => {
    e.preventDefault();
    const src = all.find((q) => q.questionId === dragId);
    if (!src || el.dataset.section !== src.section || el.dataset.qid === dragId) return;
    const ids = currentOrder(c).filter((id) => id !== dragId);
    ids.splice(ids.indexOf(el.dataset.qid), 0, dragId);
    saveOrder(ids, deptId, reload);
  });
}

function validationFields(type, v) {
  v = v || {};
  if (type === 'NUMBER' || type === 'DECIMAL') return html`
    ${field({ name: 'v_min', label: 'Minimum', type: 'number', value: v.min })}
    ${field({ name: 'v_max', label: 'Maximum', type: 'number', value: v.max })}
    ${field({ name: 'v_target', label: 'Daily target', type: 'number', value: v.target, hint: 'Optional. Used in KPI progress and the productivity score.' })}`;
  if (type === 'SHORT_TEXT' || type === 'LONG_TEXT') return html`
    ${field({ name: 'v_minLength', label: 'Minimum characters', type: 'number', value: v.minLength, min: 0 })}
    ${field({ name: 'v_maxLength', label: 'Maximum characters', type: 'number', value: v.maxLength, min: 1 })}
    ${field({ name: 'v_pattern', label: 'Format rule (regular expression)', value: v.pattern, hint: 'Optional, for example ^[A-Z]{3}-\\d+$ for codes.' })}
    ${field({ name: 'v_patternMessage', label: 'Message when the format is wrong', value: v.patternMessage })}`;
  if (type === 'RATING') return field({ name: 'v_max', label: 'Highest rating', type: 'number', value: v.max || 5, min: 2, max: 10 });
  return html`<p class="small muted full" style="margin:0">No extra rules for this type.</p>`;
}

function openQuestionDialog(ctx, q, deptId, common, all, done) {
  const isNew = !q;
  const qq = q || { departmentId: deptId, type: 'NUMBER', section: deptId === 'ALL' ? 'NOTES' : 'KPI', required: false, options: [], validation: {}, status: 'Active' };
  const refs = all.filter((x) => (x.departmentId === 'ALL' || x.departmentId === qq.departmentId) && x.status === 'Active' && (!q || x.questionId !== q.questionId));
  const cnd = parseShowIf(qq.showIf) || { questionId: '', op: '=', value: '' };
  const m = openModal({
    title: isNew ? 'Add question' : 'Edit question', drawer: true,
    body: html`<form class="form-grid" novalidate data-qform>
      ${field({ name: 'text', label: 'Question', required: true, full: true, value: qq.text, maxlength: 300, placeholder: 'e.g. Quotations sent today' })}
      ${field({ name: 'type', label: 'Answer type', type: 'select', value: qq.type, options: TYPES.map((t) => ({ value: t, label: TYPE_LABELS[t] })) })}
      ${field({ name: 'section', label: 'Report section', type: 'select', value: qq.section, options: SECTIONS.map((s) => ({ value: s, label: SECTION_LABELS[s] })) })}
      ${field({ name: 'required', label: 'Answer required before submitting', type: 'switch', value: qq.required, full: true })}
      ${field({ name: 'helpText', label: 'Help text', full: true, value: qq.helpText, maxlength: 300 })}
      <div class="field full ${OPTION_TYPES.indexOf(qq.type) >= 0 || qq.type === 'CHECKBOX' ? '' : 'hidden'}" data-options-wrap>
        <label for="q-options">Options, one per line${qq.type === 'CHECKBOX' ? '' : raw('<span class="req">*</span>')}</label>
        <textarea class="textarea" id="q-options" name="options" rows="4">${(qq.options || []).join('\n')}</textarea>
        <span class="hint" data-options-hint>${qq.type === 'CHECKBOX' ? 'Leave empty for a single tick box.' : 'At least two options.'}</span><span class="error" data-error-for="options"></span></div>
      <h3 class="full section-title">Rules</h3>
      <div class="form-grid full" data-validation style="margin:0">${validationFields(qq.type, qq.validation)}</div>
      ${field({ name: 'defaultValue', label: 'Default answer', full: true, value: qq.defaultValue, maxlength: 300, hint: 'Optional. Pre-filled in new reports.' })}
      <h3 class="full section-title">Show only when</h3>
      <div class="form-grid full" style="margin:0;grid-template-columns: 1.4fr 0.8fr 1fr">
        ${field({ name: 'c_q', label: 'Question', type: 'select', value: cnd.questionId, placeholder: 'Always show', options: refs.map((r) => ({ value: r.questionId, label: (r.departmentId === 'ALL' ? 'Common: ' : '') + r.text })) })}
        ${field({ name: 'c_op', label: 'Condition', type: 'select', value: cnd.op, options: OPS })}
        <div class="field" data-cval></div>
      </div>
      <span class="error full" data-error-for="showIf"></span>
      ${isNew ? field({ name: 'key', label: 'Internal key (optional)', value: '', maxlength: 60, hint: 'A stable name for exports and integrations, e.g. SALES_WALKINS.', attrs: 'autocapitalize="characters"' }) : ''}
      <h3 class="full section-title">Preview</h3>
      <div class="full preview-box" data-live></div>
    </form>`,
    footer: html`<button class="btn" type="button" data-close>Cancel</button><button class="btn primary" type="button" data-save>${isNew ? 'Add question' : 'Save question'}</button>`
  });
  const form = m.el.querySelector('[data-qform]');
  const condValue = () => {
    const ref = refs.find((r) => r.questionId === form.c_q.value);
    const wrap = form.querySelector('[data-cval]');
    const cur = wrap.querySelector('[name="c_val"]') ? wrap.querySelector('[name="c_val"]').value : cnd.value;
    if (!ref) { setHTML(wrap, html`<label class="muted">Value</label><input class="input" name="c_val" disabled value="">`); return; }
    const opts = ref.type === 'YES_NO' ? ['Yes', 'No'] : (ref.options && ref.options.length ? ref.options : null);
    setHTML(wrap, html`<label for="c-val">Value</label>${opts
      ? html`<select class="select" id="c-val" name="c_val">${opts.map((o) => html`<option ${attr(o === cur, 'selected')}>${o}</option>`)}</select>`
      : html`<input class="input" id="c-val" name="c_val" value="${cur}" ${attr(ref.type === 'NUMBER' || ref.type === 'DECIMAL', 'inputmode', 'decimal')}>`}`);
  };
  const collect = () => {
    const v = formValues(form);
    const validation = {};
    Object.keys(v).filter((k) => k.indexOf('v_') === 0).forEach((k) => { if (v[k] !== '') validation[k.slice(2)] = /pattern/i.test(k) ? v[k] : Number(v[k]); });
    return {
      text: v.text, type: v.type, section: v.section, required: v.required, helpText: v.helpText,
      options: OPTION_TYPES.indexOf(v.type) >= 0 || v.type === 'CHECKBOX' ? String(v.options || '').split('\n').map((s) => s.trim()).filter(Boolean) : [],
      validation, defaultValue: v.defaultValue, showIf: v.c_q ? v.c_q + v.c_op + (v.c_val || '') : '', key: v.key
    };
  };
  const live = () => {
    const d = collect();
    const pq = Object.assign({ questionId: 'preview' }, d, { text: d.text || 'Your question' });
    setHTML(form.querySelector('[data-live]'), renderQuestion(pq, initialValue(pq, undefined), '', { idPrefix: 'pv-' }));
  };
  form.type.onchange = () => {
    const t = form.type.value;
    form.querySelector('[data-options-wrap]').classList.toggle('hidden', !(OPTION_TYPES.indexOf(t) >= 0 || t === 'CHECKBOX'));
    form.querySelector('[data-options-hint]').textContent = t === 'CHECKBOX' ? 'Leave empty for a single tick box.' : 'At least two options.';
    setHTML(form.querySelector('[data-validation]'), validationFields(t, {}));
    live();
  };
  form.c_q.onchange = () => { condValue(); };
  form.addEventListener('input', (e) => { if (!e.target.closest('[data-live]')) live(); });
  condValue(); live();
  const btn = m.el.querySelector('[data-save]');
  btn.onclick = async () => {
    const d = collect();
    const errors = {};
    if (!d.text) errors.text = 'Enter the question.';
    if (OPTION_TYPES.indexOf(d.type) >= 0 && d.options.length < 2) errors.options = 'Add at least two options.';
    if (d.showIf && !parseShowIf(d.showIf).value) errors.showIf = 'Enter the value for the condition.';
    if (showFieldErrors(form, errors)) return;
    const payload = Object.assign(d, { departmentId: qq.departmentId, status: qq.status });
    if (!isNew) { payload.questionId = q.questionId; delete payload.key; }
    try {
      const mapped = await submitForm(form, btn, () => api(isNew ? 'saveQuestion' : 'updateQuestion', { question: payload }, { write: true }), isNew ? 'Question added.' : 'Question saved.');
      m.close(); done(mapped);
    } catch (e) {
      if (e && e.fieldErrors) {
        const fe = {};
        Object.keys(e.fieldErrors).forEach((k) => { fe[k.indexOf('validation.') === 0 ? 'v_' + k.slice(11) : k] = e.fieldErrors[k]; });
        showFieldErrors(form, fe);
      }
    }
  };
}

function openFormPreview(title, questions) {
  const sorted = questions.slice().sort((a, b) => (SECTIONS.indexOf(a.section) - SECTIONS.indexOf(b.section)) || ((a.departmentId === 'ALL' ? 0 : 1) - (b.departmentId === 'ALL' ? 0 : 1)) || (a.order - b.order));
  const answers = {};
  sorted.forEach((q) => { answers[q.questionId] = initialValue(q, undefined); });
  let last = '';
  const m = openModal({
    title: 'Preview: ' + title + ' report', wide: true,
    body: html`<p class="muted">This is how the questions look to employees. Answers here are not saved.</p>
      <div class="q-list" data-pf>${sorted.map((q) => {
        const head = q.section !== last ? html`<h3 class="section-title">${SECTION_LABELS[q.section] || titleCase(q.section)}</h3>` : '';
        last = q.section;
        return html`${head}<div class="${isVisible(q, answers) ? '' : 'hidden'}" data-vis="${q.questionId}">${renderQuestion(q, answers[q.questionId], '', { idPrefix: 'pf-' })}</div>`;
      })}</div>`,
    footer: html`<button class="btn primary" type="button" data-close>Close preview</button>`
  });
  const root = m.el.querySelector('[data-pf]');
  const update = (e) => {
    const el = e.target.closest('[data-q]');
    if (!el) return;
    const q = sorted.find((x) => x.questionId === el.dataset.q);
    answers[q.questionId] = readValue(root, q);
    sorted.forEach((x) => { const box = root.querySelector('[data-vis="' + x.questionId + '"]'); if (box) box.classList.toggle('hidden', !isVisible(x, answers)); });
  };
  root.addEventListener('input', update);
  root.addEventListener('change', update);
  on(root, 'click', '[data-step]', (e, b) => {
    const input = root.querySelector('[data-q="' + b.dataset.for + '"]');
    if (!input) return;
    input.value = String(Math.max(0, (Number(input.value) || 0) + Number(b.dataset.step)));
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
