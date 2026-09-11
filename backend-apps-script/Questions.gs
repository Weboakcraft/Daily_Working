/**
 * Dynamic Question Builder. Questions are data (Questions sheet), never code.
 * DepartmentID 'ALL' = common question shown to every department.
 * ShowIf format: "<QuestionID><op><value>" where op is one of = != > < >= <=
 */

function publicQuestion(q) {
  return {
    questionId: q.QuestionID, departmentId: q.DepartmentID, key: q.QuestionKey, section: q.Section, text: q.QuestionText,
    type: q.QuestionType, required: bool(q.Required), options: parseJson(q.Options, []), order: num(q.DisplayOrder),
    validation: parseJson(q.Validation, {}), helpText: q.HelpText, defaultValue: q.DefaultValue, showIf: q.ShowIf,
    status: q.Status, createdAt: q.CreatedAt, updatedAt: q.UpdatedAt
  };
}

function sectionRank(s) { const i = QUESTION_SECTIONS.indexOf(s); return i < 0 ? 99 : i; }

function sortQuestions(list) {
  return list.slice().sort(function (a, b) {
    return (sectionRank(a.Section) - sectionRank(b.Section)) ||
      ((a.DepartmentID === COMMON_DEPARTMENT_ID ? 0 : 1) - (b.DepartmentID === COMMON_DEPARTMENT_ID ? 0 : 1)) ||
      (num(a.DisplayOrder) - num(b.DisplayOrder));
  });
}

/** Active common + department questions, in form order. */
function questionsForDepartment(deptId, includeInactive) {
  return sortQuestions(Db.readAll('Questions').filter(function (q) {
    return (q.DepartmentID === COMMON_DEPARTMENT_ID || q.DepartmentID === deptId) && (includeInactive || q.Status === 'Active');
  }));
}

function apiGetQuestions(p, user) {
  const deptId = cleanText(p.departmentId, 40);
  if (user.role !== 'ADMIN') {
    return questionsForDepartment(user.departmentId, false).map(publicQuestion);
  }
  let rows = Db.readAll('Questions');
  if (deptId) rows = rows.filter(function (q) { return q.DepartmentID === deptId; });
  if (!p.includeInactive) rows = rows.filter(function (q) { return q.Status === 'Active'; });
  return sortQuestions(rows).map(publicQuestion);
}

function parseShowIf(str) {
  const m = /^([A-Za-z0-9_-]+)\s*(>=|<=|!=|=|>|<)\s*(.*)$/.exec(String(str || '').trim());
  return m ? { questionId: m[1], op: m[2], value: m[3].trim() } : null;
}

function validateQuestionInput(input, existing) {
  const errors = {};
  const out = {
    DepartmentID: cleanText(input.departmentId, 40) || COMMON_DEPARTMENT_ID,
    Section: cleanText(input.section, 30).toUpperCase() || 'KPI',
    QuestionText: cleanText(input.text, 300),
    QuestionType: cleanText(input.type, 20).toUpperCase(),
    Required: bool(input.required),
    HelpText: cleanText(input.helpText, 300),
    DefaultValue: cleanText(input.defaultValue, 300),
    ShowIf: cleanText(input.showIf, 200),
    Status: input.status === 'Inactive' ? 'Inactive' : 'Active'
  };
  if (!out.QuestionText) errors.text = 'Question text is required.';
  if (QUESTION_TYPES.indexOf(out.QuestionType) < 0) errors.type = 'Choose a question type.';
  if (QUESTION_SECTIONS.indexOf(out.Section) < 0) errors.section = 'Choose a report section.';
  if (out.DepartmentID !== COMMON_DEPARTMENT_ID && !getDepartment(out.DepartmentID)) errors.departmentId = 'Department not found.';

  let options = Array.isArray(input.options) ? input.options : String(input.options || '').split(/\r?\n/);
  options = uniq(options.map(function (o) { return cleanText(o, 100); }).filter(Boolean)).slice(0, 50);
  if (OPTION_TYPES.indexOf(out.QuestionType) >= 0 && options.length < 2) errors.options = 'Add at least two options.';
  out.Options = JSON.stringify(options);

  const v = input.validation || {};
  const rules = {};
  ['min', 'max', 'minLength', 'maxLength', 'target'].forEach(function (k) {
    if (v[k] !== undefined && v[k] !== null && v[k] !== '') {
      if (isNaN(Number(v[k]))) errors['validation.' + k] = 'Must be a number.'; else rules[k] = Number(v[k]);
    }
  });
  if (rules.min !== undefined && rules.max !== undefined && rules.min > rules.max) errors['validation.max'] = 'Maximum must be at least the minimum.';
  if (v.pattern) {
    try { new RegExp(v.pattern); rules.pattern = cleanText(v.pattern, 200); } catch (e) { errors['validation.pattern'] = 'Pattern is not a valid regular expression.'; }
  }
  if (v.patternMessage) rules.patternMessage = cleanText(v.patternMessage, 150);
  out.Validation = JSON.stringify(rules);

  if (out.ShowIf) {
    const cond = parseShowIf(out.ShowIf);
    const ref = cond ? Db.readAll('Questions').filter(function (q) { return q.QuestionID === cond.questionId; })[0] : null;
    if (!cond || !ref) errors.showIf = 'Condition must reference an existing question, e.g. QST-123=Yes.';
    else if (existing && ref.QuestionID === existing.QuestionID) errors.showIf = 'A question cannot depend on itself.';
    else if (ref.DepartmentID !== COMMON_DEPARTMENT_ID && ref.DepartmentID !== out.DepartmentID) errors.showIf = 'Condition must reference a common question or one from the same department.';
  }
  if (out.DefaultValue && !errors.type && !errors.options) {
    const probe = validateAnswerValue(publicQuestionLike(out, options, rules), out.DefaultValue);
    if (probe.error) errors.defaultValue = 'Default value is not valid: ' + probe.error;
  }
  if (Object.keys(errors).length) throw appError('VALIDATION', 'Please correct the highlighted fields.', { fieldErrors: errors });
  return out;
}

function publicQuestionLike(row, options, rules) {
  return { QuestionType: row.QuestionType, Options: JSON.stringify(options), Validation: JSON.stringify(rules), Required: row.Required };
}

function apiSaveQuestion(p, user) {
  const input = p.question || {};
  if (input.questionId) return apiUpdateQuestion(p, user);
  const data = validateQuestionInput(input, null);
  const key = cleanText(input.key, 60).toUpperCase().replace(/[^A-Z0-9_]/g, '_');
  if (key && Db.readAll('Questions').some(function (q) { return q.QuestionKey === key; })) {
    throw appError('VALIDATION', 'Please correct the highlighted fields.', { fieldErrors: { key: 'Another question already uses this key.' } });
  }
  const row = Db.withLock(function () {
    const siblings = Db.readAll('Questions').filter(function (q) { return q.DepartmentID === data.DepartmentID; });
    const maxOrder = siblings.reduce(function (m, q) { return Math.max(m, num(q.DisplayOrder)); }, 0);
    const now = nowIso();
    const r = Object.assign({ QuestionID: newId('QST'), QuestionKey: key, DisplayOrder: maxOrder + 10, CreatedAt: now, UpdatedAt: now }, data);
    Db.insert('Questions', [r]);
    return r;
  });
  audit(user, 'QUESTION_CREATED', 'Question', row.QuestionID, '', publicQuestion(row));
  return publicQuestion(row);
}

function apiUpdateQuestion(p, user) {
  const input = p.question || {};
  const existing = Db.readAll('Questions').filter(function (q) { return q.QuestionID === input.questionId; })[0];
  assert(existing, 'NOT_FOUND', 'Question not found.');
  const before = publicQuestion(existing);
  // Keep status if only a partial status update was sent
  const data = validateQuestionInput(Object.assign({}, before, input, { options: input.options !== undefined ? input.options : before.options, validation: input.validation !== undefined ? input.validation : before.validation }), existing);
  const row = Db.withLock(function () {
    const r = Db.readAll('Questions').filter(function (q) { return q.QuestionID === existing.QuestionID; })[0];
    Object.assign(r, data, { UpdatedAt: nowIso() });
    Db.update('Questions', [r]);
    return r;
  });
  const action = before.status !== row.Status ? (row.Status === 'Inactive' ? 'QUESTION_DEACTIVATED' : 'QUESTION_ACTIVATED') : 'QUESTION_UPDATED';
  audit(user, action, 'Question', row.QuestionID, before, publicQuestion(row));
  return publicQuestion(row);
}

function apiReorderQuestions(p, user) {
  const ids = Array.isArray(p.orderedIds) ? p.orderedIds.map(String) : [];
  assert(ids.length, 'VALIDATION', 'Nothing to reorder.');
  Db.withLock(function () {
    const map = indexBy(Db.readAll('Questions'), 'QuestionID');
    const now = nowIso();
    const rows = [];
    ids.forEach(function (id, i) {
      const q = map[id];
      assert(q, 'NOT_FOUND', 'Question ' + id + ' not found.');
      if (num(q.DisplayOrder) !== (i + 1) * 10) { q.DisplayOrder = (i + 1) * 10; q.UpdatedAt = now; rows.push(q); }
    });
    Db.update('Questions', rows);
  });
  audit(user, 'QUESTIONS_REORDERED', 'Question', cleanText(p.departmentId, 40), '', { order: ids });
  return { reordered: ids.length };
}

// ---------------- Answer validation (shared by draft & submit) ----------------

function answerIsEmpty(v) {
  return v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
}

/**
 * Validates a single answer against its question definition.
 * Returns { value, stored, empty } or { error }.
 */
function validateAnswerValue(q, raw) {
  const type = q.QuestionType;
  const options = parseJson(q.Options, []);
  const rules = parseJson(q.Validation, {});
  const ok = function (value, stored) { return { value: value, stored: stored, empty: answerIsEmpty(value) }; };

  if (MULTI_VALUE_TYPES.indexOf(type) >= 0 && (type === 'MULTI_SELECT' || options.length)) {
    let arr = raw;
    if (typeof arr === 'string') arr = arr ? parseJson(arr, [arr]) : [];
    if (!Array.isArray(arr)) return { error: 'Choose from the list.' };
    arr = uniq(arr.map(function (x) { return cleanText(x, 100); }).filter(Boolean));
    if (arr.some(function (x) { return options.indexOf(x) < 0; })) return { error: 'Choose only listed options.' };
    return ok(arr, arr.length ? JSON.stringify(arr) : '');
  }
  if (type === 'CHECKBOX') {
    const checked = raw === true || raw === 'Yes' || raw === 'TRUE' || raw === 'true';
    return ok(checked ? 'Yes' : '', checked ? 'Yes' : '');
  }
  if (answerIsEmpty(raw)) return ok('', '');
  const s = cleanText(raw, type === 'LONG_TEXT' ? LIMITS.TEXT : 500);
  if (s === '') return ok('', '');

  switch (type) {
    case 'SHORT_TEXT':
    case 'LONG_TEXT':
      if (rules.minLength !== undefined && s.length < rules.minLength) return { error: 'Enter at least ' + rules.minLength + ' characters.' };
      if (rules.maxLength !== undefined && s.length > rules.maxLength) return { error: 'Use at most ' + rules.maxLength + ' characters.' };
      if (rules.pattern) {
        try { if (!new RegExp(rules.pattern).test(s)) return { error: rules.patternMessage || 'Format is not valid.' }; } catch (e) { /* ignore bad pattern */ }
      }
      return ok(s, s);
    case 'NUMBER':
    case 'DECIMAL': {
      if (type === 'NUMBER' && !/^-?\d+$/.test(s)) return { error: 'Enter a whole number.' };
      if (type === 'DECIMAL' && !/^-?\d+(\.\d+)?$/.test(s)) return { error: 'Enter a valid number.' };
      const n = Number(s);
      if (rules.min !== undefined && n < rules.min) return { error: 'Must be at least ' + rules.min + '.' };
      if (rules.max !== undefined && n > rules.max) return { error: 'Must be at most ' + rules.max + '.' };
      return ok(n, String(n));
    }
    case 'DROPDOWN':
    case 'RADIO':
      if (options.indexOf(s) < 0) return { error: 'Choose from the list.' };
      return ok(s, s);
    case 'DATE':
      if (!isValidDateStr(s)) return { error: 'Enter a valid date.' };
      return ok(s, s);
    case 'TIME':
      if (!isValidTime(s)) return { error: 'Enter a valid time (HH:mm).' };
      return ok(s, s);
    case 'RATING': {
      const max = rules.max || 5;
      if (!/^\d+$/.test(s) || Number(s) < 1 || Number(s) > max) return { error: 'Choose a rating from 1 to ' + max + '.' };
      return ok(Number(s), s);
    }
    case 'YES_NO':
      if (s !== 'Yes' && s !== 'No') return { error: 'Choose Yes or No.' };
      return ok(s, s);
    default:
      return ok(s, s);
  }
}

/** Evaluates a ShowIf condition against normalised answers ({qid: {value}}). */
function isQuestionVisible(q, answers) {
  if (!q.ShowIf) return true;
  const c = parseShowIf(q.ShowIf);
  if (!c) return true;
  const a = answers[c.questionId];
  const v = a ? a.value : '';
  if (Array.isArray(v)) {
    const has = v.indexOf(c.value) >= 0;
    return c.op === '!=' ? !has : (c.op === '=' ? has : false);
  }
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

function decodeAnswer(q, stored) {
  if (q && MULTI_VALUE_TYPES.indexOf(q.QuestionType) >= 0 && /^\[/.test(stored || '')) return parseJson(stored, []);
  return stored;
}
