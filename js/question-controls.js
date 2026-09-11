/**
 * Question controls shared by the daily report form and the question builder preview.
 * Client-side rules mirror the backend (Questions.gs) so people get instant feedback;
 * the server still validates everything.
 */
import { html, attr, raw } from './app.js';

export const TYPE_LABELS = {
  SHORT_TEXT: 'Short text', LONG_TEXT: 'Long text', NUMBER: 'Whole number', DECIMAL: 'Decimal number', DROPDOWN: 'Dropdown',
  MULTI_SELECT: 'Multi-select', CHECKBOX: 'Checkbox', RADIO: 'Radio buttons', DATE: 'Date', TIME: 'Time', RATING: 'Rating', YES_NO: 'Yes / No'
};
export const SECTION_LABELS = {
  WORK_SUMMARY: 'Work summary', COMPLETED: 'Completed work', PENDING: 'Pending work', CARRY_FORWARD: 'Carry forward',
  KPI: 'Department numbers', BLOCKERS: 'Blockers and issues', FOLLOWUPS: 'Follow-ups', MEETINGS: 'Meetings and calls',
  TOMORROW_PLAN: "Tomorrow's plan", NOTES: 'Notes'
};
export const OPTION_TYPES = ['DROPDOWN', 'MULTI_SELECT', 'RADIO'];

export function isMulti(q) { return q.type === 'MULTI_SELECT' || (q.type === 'CHECKBOX' && (q.options || []).length > 0); }
export function isEmpty(v) { return v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0); }

export function parseShowIf(str) {
  const m = /^([A-Za-z0-9_-]+)\s*(>=|<=|!=|=|>|<)\s*(.*)$/.exec(String(str || '').trim());
  return m ? { questionId: m[1], op: m[2], value: m[3].trim() } : null;
}

export function isVisible(q, answers) {
  if (!q.showIf) return true;
  const c = parseShowIf(q.showIf);
  if (!c) return true;
  const v = answers[c.questionId] === undefined ? '' : answers[c.questionId];
  if (Array.isArray(v)) { const has = v.indexOf(c.value) >= 0; return c.op === '!=' ? !has : c.op === '=' ? has : false; }
  const numeric = v !== '' && !isNaN(Number(v)) && c.value !== '' && !isNaN(Number(c.value));
  const l = numeric ? Number(v) : String(v), r = numeric ? Number(c.value) : c.value;
  switch (c.op) {
    case '=': return l === r;
    case '!=': return l !== r;
    case '>': return numeric && l > r;
    case '<': return numeric && l < r;
    case '>=': return numeric && l >= r;
    case '<=': return numeric && l <= r;
  }
  return true;
}

/** Returns an error message or '' for a single answer (emptiness is checked separately). */
export function validateAnswer(q, v) {
  if (isEmpty(v)) return '';
  const r = q.validation || {};
  const s = String(v).trim();
  switch (q.type) {
    case 'SHORT_TEXT': case 'LONG_TEXT':
      if (r.minLength !== undefined && s.length < r.minLength) return 'Enter at least ' + r.minLength + ' characters.';
      if (r.maxLength !== undefined && s.length > r.maxLength) return 'Use at most ' + r.maxLength + ' characters.';
      if (r.pattern) { try { if (!new RegExp(r.pattern).test(s)) return r.patternMessage || 'Format is not valid.'; } catch (e) { /* ignore */ } }
      return '';
    case 'NUMBER': case 'DECIMAL': {
      if (q.type === 'NUMBER' && !/^-?\d+$/.test(s)) return 'Enter a whole number.';
      if (q.type === 'DECIMAL' && !/^-?\d+(\.\d+)?$/.test(s)) return 'Enter a valid number.';
      const n = Number(s);
      if (r.min !== undefined && n < r.min) return 'Must be at least ' + r.min + '.';
      if (r.max !== undefined && n > r.max) return 'Must be at most ' + r.max + '.';
      return '';
    }
    case 'TIME': return /^([01]\d|2[0-3]):[0-5]\d$/.test(s) ? '' : 'Enter a valid time.';
    case 'DATE': return /^\d{4}-\d{2}-\d{2}$/.test(s) ? '' : 'Enter a valid date.';
    default: return '';
  }
}

/** Initial value for a question: saved answer, else default value. */
export function initialValue(q, saved) {
  if (saved !== undefined && saved !== null) {
    if (isMulti(q)) return Array.isArray(saved) ? saved : (saved ? [saved] : []);
    return String(saved);
  }
  if (q.defaultValue) {
    if (isMulti(q)) { try { const p = JSON.parse(q.defaultValue); return Array.isArray(p) ? p : [q.defaultValue]; } catch (e) { return [q.defaultValue]; } }
    return String(q.defaultValue);
  }
  return isMulti(q) ? [] : '';
}

/**
 * Renders one question as a form field.
 * The input elements carry data-q="<questionId>" so the form can read values by delegation.
 */
export function renderQuestion(q, value, error, opts) {
  opts = opts || {};
  const id = (opts.idPrefix || 'q-') + q.questionId;
  const req = q.required ? raw('<span class="req" aria-hidden="true">*</span>') : '';
  const help = q.helpText ? html`<span class="hint" id="${id}-hint">${q.helpText}</span>` : '';
  const describedBy = [q.helpText ? id + '-hint' : '', id + '-err'].filter(Boolean).join(' ');
  const dis = opts.disabled;
  const common = html`data-q="${q.questionId}" ${attr(dis, 'disabled')} aria-describedby="${describedBy}" ${attr(!!error, 'aria-invalid', 'true')}`;
  const r = q.validation || {};
  const unit = /₹/.test(q.text) ? '₹' : '';
  let control, group = false;

  switch (q.type) {
    case 'LONG_TEXT':
      control = html`<textarea class="textarea" id="${id}" rows="3" maxlength="${r.maxLength || 5000}" ${common} ${attr(q.required, 'aria-required', 'true')}>${value}</textarea>`;
      break;
    case 'NUMBER': case 'DECIMAL':
      control = html`<div class="stepper">
        <button type="button" data-step="-1" data-for="${q.questionId}" aria-label="Decrease ${q.text}" ${attr(dis, 'disabled')}>−</button>
        <input class="input" id="${id}" type="text" inputmode="${q.type === 'NUMBER' ? 'numeric' : 'decimal'}" value="${value}" ${common} ${attr(q.required, 'aria-required', 'true')} ${attr(unit, 'placeholder', unit)}>
        <button type="button" data-step="1" data-for="${q.questionId}" aria-label="Increase ${q.text}" ${attr(dis, 'disabled')}>+</button></div>
        ${r.target ? html`<span class="hint">Daily target: ${r.target}</span>` : ''}`;
      break;
    case 'DROPDOWN':
      control = html`<select class="select" id="${id}" ${common} ${attr(q.required, 'aria-required', 'true')}><option value="">Choose…</option>
        ${(q.options || []).map((o) => html`<option ${attr(o === value, 'selected')}>${o}</option>`)}</select>`;
      break;
    case 'RADIO':
      group = true;
      control = html`<div class="chips" role="radiogroup" aria-labelledby="${id}-l">${(q.options || []).map((o, i) => html`<label class="chip-toggle"><input type="radio" name="${id}" value="${o}" ${attr(o === value, 'checked')} ${common}><span>${o}</span></label>`)}</div>`;
      break;
    case 'MULTI_SELECT': case 'CHECKBOX':
      if (isMulti(q)) {
        group = true;
        const vals = Array.isArray(value) ? value : [];
        control = html`<div class="chips" role="group" aria-labelledby="${id}-l">${(q.options || []).map((o) => html`<label class="chip-toggle"><input type="checkbox" value="${o}" data-multi ${attr(vals.indexOf(o) >= 0, 'checked')} ${common}><span>${o}</span></label>`)}</div>`;
      } else {
        return html`<div class="field ${error ? 'has-error' : ''}" data-qwrap="${q.questionId}">
          <label class="check"><input type="checkbox" id="${id}" value="Yes" ${attr(value === 'Yes', 'checked')} ${common}><span>${q.text}${req}</span></label>
          ${help}<span class="error" id="${id}-err">${error || ''}</span></div>`;
      }
      break;
    case 'YES_NO':
      group = true;
      control = html`<div class="segmented" role="radiogroup" aria-labelledby="${id}-l">
        ${['Yes', 'No'].map((o) => html`<label><input type="radio" name="${id}" value="${o}" ${attr(o === value, 'checked')} ${common}><span>${o}</span></label>`)}</div>`;
      break;
    case 'RATING': {
      group = true;
      const max = r.max || 5;
      control = html`<div class="rating" role="radiogroup" aria-labelledby="${id}-l">${Array.from({ length: max }, (_, i) => String(i + 1)).map((o) => html`<label><input type="radio" name="${id}" value="${o}" ${attr(o === String(value), 'checked')} ${common} aria-label="${o} of ${max}"><span>${o}</span></label>`)}</div>`;
      break;
    }
    case 'DATE':
      control = html`<input class="input" id="${id}" type="date" value="${value}" ${common} style="max-width:220px">`;
      break;
    case 'TIME':
      control = html`<input class="input" id="${id}" type="time" value="${value}" ${common} style="max-width:160px">`;
      break;
    default:
      control = html`<input class="input" id="${id}" type="text" value="${value}" maxlength="${r.maxLength || 500}" ${common} ${attr(q.required, 'aria-required', 'true')}>`;
  }
  const label = group
    ? html`<span class="label" id="${id}-l">${q.text}${req}</span>`
    : html`<label for="${id}" id="${id}-l">${q.text}${req}</label>`;
  return html`<div class="field ${error ? 'has-error' : ''}" data-qwrap="${q.questionId}">${label}${help}${control}<span class="error" id="${id}-err" role="${error ? 'alert' : ''}">${error || ''}</span></div>`;
}

/** Reads the current value of a question from the DOM inside root. */
export function readValue(root, q) {
  const els = Array.from(root.querySelectorAll('[data-q="' + q.questionId + '"]'));
  if (!els.length) return undefined;
  if (isMulti(q)) return els.filter((e) => e.checked).map((e) => e.value);
  if (q.type === 'CHECKBOX') return els[0].checked ? 'Yes' : '';
  if (['RADIO', 'YES_NO', 'RATING'].indexOf(q.type) >= 0) { const c = els.find((e) => e.checked); return c ? c.value : ''; }
  return els[0].value;
}
