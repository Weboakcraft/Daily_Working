/** Employee master and department master. */
import { api, ApiError } from './api.js';
import {
  html, setHTML, $, $$, on, icon, toast, errorMessage, renderError, skeleton, emptyState, renderTable, pagerHtml, field, formValues,
  showFieldErrors, submitForm, withBusy, openModal, confirmDialog, attr, fmtDate, titleCase, hashQuery, setHashQuery, downloadBlob, esc, collapsibleFilters
} from './app.js';
import { toCsv } from './export.js';

const ROLES = ['EMPLOYEE', 'MANAGER', 'ADMIN'];
const EMPLOYMENT = ['Full-time', 'Part-time', 'Contract', 'Intern', 'Probation', 'Notice period', 'Exited'];

export function generatePassword() {
  const letters = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ', digits = '23456789';
  const rnd = (n) => { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] % n; };
  let p = 'Oak';
  for (let i = 0; i < 5; i++) p += letters[rnd(letters.length)];
  for (let i = 0; i < 3; i++) p += digits[rnd(digits.length)];
  return p;
}

/** Minimal RFC 4180 CSV parser (quotes, escaped quotes, commas and newlines inside quotes). */
export function parseCsv(text) {
  text = text.replace(/^\uFEFF/, '');
  const rows = [];
  let row = [], cell = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else inQ = false; }
      else cell += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((x) => x.trim() !== '')) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((x) => x.trim() !== '')) rows.push(row);
  return rows;
}

function copyButton(text, label) {
  return html`<button class="btn sm" type="button" data-copy-text="${text}">${icon('copy')}${label || 'Copy'}</button>`;
}
function bindCopy(root) {
  on(root, 'click', '[data-copy-text]', async (e, b) => {
    try { await navigator.clipboard.writeText(b.dataset.copyText); toast('Copied.'); } catch (err) { toast('Copy is blocked. Select the text and copy it manually.', 'bad'); }
  });
}

// ============================ Employees ============================

export async function renderEmployees(ctx) {
  const c = ctx.content;
  const admin = ctx.user.role === 'ADMIN';
  const q = hashQuery();
  setHTML(c, html`${ctx.head(admin ? 'Employees' : 'My team', admin ? 'Add people, set their department, role and manager, and control access.' : 'People whose reports you can see.', admin ? html`
      <button class="btn" type="button" data-export>${icon('download')}<span class="btn-text">Export</span></button>
      <button class="btn" type="button" data-import>${icon('upload')}<span class="btn-text">Import</span></button>
      <button class="btn primary" type="button" data-add>${icon('plus')}Add employee</button>` : '')}
    <form class="filters" data-filters role="search"></form><div data-counts></div><div class="panel" data-results>${skeleton(8)}</div>`);
  let depts;
  try { depts = await api('getDepartments', { includeInactive: admin }); } catch (e) { if (ctx.isCurrent()) renderError($('[data-results]', c), e, () => renderEmployees(ctx)); return; }
  if (!ctx.isCurrent()) return;
  const deptOpts = depts.map((d) => ({ value: d.departmentId, label: titleCase(d.name) + (d.status === 'Active' ? '' : ' (inactive)') }));
  const form = $('[data-filters]', c);
  setHTML(form, html`<div class="field search-field"><label for="emp-search">Search</label><input class="input" type="search" id="emp-search" name="search" value="${q.get('search') || ''}" placeholder="Name, ID, username, email or mobile"></div>
    ${field({ name: 'departmentId', label: 'Department', type: 'select', value: q.get('departmentId') || '', placeholder: 'All departments', options: deptOpts })}
    ${field({ name: 'role', label: 'Role', type: 'select', value: q.get('role') || '', placeholder: 'Any role', options: ROLES })}
    ${field({ name: 'status', label: 'Status', type: 'select', value: q.has('status') ? q.get('status') : 'Active', placeholder: 'Active and inactive', options: ['Active', 'Inactive'] })}`);
  collapsibleFilters(form);
  let page = 1, items = [], timer = null;
  const load = async () => {
    const v = formValues(form);
    const results = $('[data-results]', c);
    try {
      const pg = await api('getEmployees', { filters: v, page, pageSize: 50, sort: 'name' });
      if (!ctx.isCurrent()) return;
      items = pg.items;
      setHTML($('[data-counts]', c), html`<p class="small muted" style="margin:0 0 10px">${pg.total} ${pg.total === 1 ? 'person' : 'people'} match. ${pg.counts.active} active, ${pg.counts.inactive} inactive.</p>`);
      setHTML(results, html`<div data-table></div>${pagerHtml(pg)}`);
      renderTable($('[data-table]', results), {
        caption: 'Employees', rows: items,
        empty: emptyState('No employees match', admin ? 'Clear the filters or add an employee.' : 'Try clearing the filters.', admin ? html`<button class="btn primary" type="button" data-add>${icon('plus')}Add employee</button>` : ''),
        columns: [
          { key: 'name', label: 'Name', primary: true, sortable: true, render: (e) => html`<a href="employee.html#analytics/${e.employeeId}">${e.name}</a><span class="sub">${e.employeeId}, ${e.username}${e.isDemo ? ', demo' : ''}</span>` },
          { key: 'departmentName', label: 'Department', sortable: true, render: (e) => html`${titleCase(e.departmentName)}<span class="sub">${e.designation}</span>` },
          { key: 'role', label: 'Role', sortable: true, render: (e) => titleCase(e.role) },
          { key: 'managerName', label: 'Manager', sortable: true, render: (e) => e.managerName || '–' },
          { key: 'status', label: 'Status', sortable: true, render: (e) => html`<span class="pill ${e.status === 'Active' ? 'ok' : 'off'}">${e.status}</span>${e.reportRequired ? '' : html`<span class="sub">Report optional</span>`}` },
          { key: 'joiningDate', label: 'Joined', sortable: true, render: (e) => e.joiningDate ? fmtDate(e.joiningDate, 'tiny') + ' ' + e.joiningDate.slice(0, 4) : '–' },
          ...(admin ? [{ key: 'actions', label: 'Actions', render: (e) => html`<div class="row" style="gap:4px;flex-wrap:nowrap">
            <button class="btn sm" type="button" data-edit="${e.employeeId}">Edit</button>
            <button class="btn sm ghost" type="button" data-reset="${e.employeeId}" aria-label="Reset password for ${e.name}">${icon('key')}</button>
            ${e.employeeId === ctx.user.id ? '' : html`<button class="btn sm ghost" type="button" data-status="${e.employeeId}">${e.status === 'Active' ? 'Deactivate' : 'Reactivate'}</button>`}</div>` }] : [])
        ]
      });
    } catch (e) { if (ctx.isCurrent()) renderError(results, e, load); }
  };
  form.addEventListener('change', () => { page = 1; setHashQuery(formValues(form), true); load(); });
  form.addEventListener('input', (e) => { if (e.target.type === 'search') { clearTimeout(timer); timer = setTimeout(() => { page = 1; setHashQuery(formValues(form), true); load(); }, 350); } });
  form.addEventListener('submit', (e) => e.preventDefault());
  on(c, 'click', '[data-page]', (e, b) => { page = Number(b.dataset.page); load(); });
  if (admin) {
    const refresh = () => load();
    on(c, 'click', '[data-add]', () => openEmployeeDialog(ctx, null, depts, refresh));
    on(c, 'click', '[data-edit]', (e, b) => openEmployeeDialog(ctx, items.find((x) => x.employeeId === b.dataset.edit), depts, refresh));
    on(c, 'click', '[data-reset]', (e, b) => openResetDialog(items.find((x) => x.employeeId === b.dataset.reset)));
    on(c, 'click', '[data-status]', async (e, b) => {
      const emp = items.find((x) => x.employeeId === b.dataset.status);
      const deactivate = emp.status === 'Active';
      const ok = await confirmDialog({
        title: deactivate ? 'Deactivate ' + emp.name + '?' : 'Reactivate ' + emp.name + '?',
        message: deactivate ? 'They will be signed out and cannot sign in. Their reports and history stay available.' : 'They will be able to sign in again with their existing password.',
        confirmText: deactivate ? 'Deactivate' : 'Reactivate', danger: deactivate
      });
      if (!ok) return;
      await withBusy(b, async () => {
        try { await api('setEmployeeStatus', { employeeId: emp.employeeId, status: deactivate ? 'Inactive' : 'Active' }, { write: true }); toast(deactivate ? 'Employee deactivated.' : 'Employee reactivated.'); load(); }
        catch (err) { toast(errorMessage(err), 'bad'); }
      });
    });
    $('[data-import]', c).onclick = () => openImportDialog(ctx, refresh);
    $('[data-export]', c).onclick = (e) => withBusy(e.currentTarget, async () => {
      try {
        const pg = await api('getEmployees', { filters: formValues(form), page: 1, pageSize: 200 });
        let all = pg.items;
        for (let p = 2; p <= pg.pages; p++) all = all.concat((await api('getEmployees', { filters: formValues(form), page: p, pageSize: 200 })).items);
        const cols = [['employeeId', 'Employee ID'], ['name', 'Name'], ['departmentName', 'Department'], ['designation', 'Designation'], ['role', 'Role'], ['managerName', 'Manager'], ['email', 'Email'], ['mobile', 'Mobile'], ['joiningDate', 'Joining date'], ['employmentStatus', 'Employment status'], ['username', 'Username'], ['status', 'Status'], ['reportRequired', 'Report required']];
        downloadBlob('oakcraft-employees.csv', new Blob([toCsv({ columns: cols.map((x) => ({ key: x[0], label: x[1] })), rows: all })], { type: 'text/csv;charset=utf-8' }));
      } catch (err) { toast(errorMessage(err), 'bad'); }
    });
  }
  load();
}

async function openEmployeeDialog(ctx, emp, depts, done) {
  const dir = await api('getEmployeeDirectory', { includeInactive: false }).catch(() => []);
  const managers = dir.filter((p) => p.role !== 'EMPLOYEE' && (!emp || p.employeeId !== emp.employeeId)).map((p) => ({ value: p.employeeId, label: p.name + ' (' + titleCase(p.role) + ')' }));
  if (emp && emp.managerId && !managers.some((m) => m.value === emp.managerId)) managers.push({ value: emp.managerId, label: emp.managerName || emp.managerId });
  const deptOpts = depts.filter((d) => d.status === 'Active' || (emp && d.departmentId === emp.departmentId)).map((d) => ({ value: d.departmentId, label: titleCase(d.name) }));
  const e = emp || { role: 'EMPLOYEE', employmentStatus: 'Full-time', reportRequired: true, joiningDate: ctx.today };
  const m = openModal({
    title: emp ? 'Edit ' + emp.name : 'Add employee', wide: true,
    body: html`<form class="form-grid" novalidate>
      ${field({ name: 'name', label: 'Full name', required: true, value: e.name, maxlength: 100 })}
      ${field({ name: 'username', label: 'Username', required: true, value: e.username, maxlength: 40, hint: 'Letters, numbers, dot, dash or underscore. Used to sign in.', attrs: 'autocapitalize="none" spellcheck="false"' })}
      ${field({ name: 'departmentId', label: 'Department', type: 'select', required: true, value: e.departmentId, placeholder: 'Choose…', options: deptOpts })}
      ${field({ name: 'designation', label: 'Designation', value: e.designation, maxlength: 80 })}
      ${field({ name: 'role', label: 'Role', type: 'select', value: e.role, options: ROLES.map((r) => ({ value: r, label: titleCase(r) })), hint: 'Managers see their department and direct reports. Admins see everything.' })}
      ${field({ name: 'managerId', label: 'Reports to', type: 'select', value: e.managerId, placeholder: 'No reporting manager', options: managers })}
      ${field({ name: 'email', label: 'Email', type: 'email', value: e.email, maxlength: 120, placeholder: 'name@oakcraft.in' })}
      ${field({ name: 'mobile', label: 'Mobile', type: 'tel', value: e.mobile, maxlength: 20, inputmode: 'tel' })}
      ${field({ name: 'joiningDate', label: 'Joining date', type: 'date', value: e.joiningDate })}
      ${field({ name: 'employmentStatus', label: 'Employment status', type: 'select', value: e.employmentStatus, options: EMPLOYMENT.map((x) => ({ value: x, label: x })) })}
      ${field({ name: 'reportRequired', label: 'Must submit a daily report', type: 'switch', value: e.reportRequired, full: true })}
      ${emp ? '' : html`<div class="field full"><label for="new-pw">Temporary password<span class="req">*</span></label>
        <div class="row" style="flex-wrap:nowrap"><input class="input" id="new-pw" name="password" value="${generatePassword()}" autocomplete="off" spellcheck="false"><button class="btn" type="button" data-gen>Generate</button></div>
        <span class="hint">They must change it the first time they sign in.</span><span class="error" data-error-for="password"></span></div>`}
    </form>`,
    footer: html`<button class="btn" type="button" data-close>Cancel</button><button class="btn primary" type="button" data-save>${emp ? 'Save changes' : 'Add employee'}</button>`
  });
  const form = m.el.querySelector('form');
  const gen = m.el.querySelector('[data-gen]');
  if (gen) gen.onclick = () => { form.password.value = generatePassword(); };
  const btn = m.el.querySelector('[data-save]');
  btn.onclick = async () => {
    const v = formValues(form);
    const errors = {};
    if (!v.name) errors.name = 'Employee name is required.';
    if (!/^[a-z0-9._-]{3,40}$/i.test(v.username)) errors.username = 'Use 3–40 letters, numbers, dot, dash or underscore.';
    if (!v.departmentId) errors.departmentId = 'Choose a department.';
    if (!emp && !(v.password.length >= 8 && /[A-Za-z]/.test(v.password) && /\d/.test(v.password))) errors.password = 'At least 8 characters with letters and numbers.';
    if (showFieldErrors(form, errors)) return;
    const password = v.password; delete v.password;
    const payload = { employee: Object.assign({}, v, emp ? { employeeId: emp.employeeId } : {}) };
    if (!emp) payload.password = password;
    try {
      const saved = await submitForm(form, btn, () => api(emp ? 'updateEmployee' : 'saveEmployee', payload, { write: true }), emp ? 'Changes saved.' : null);
      m.close();
      done();
      if (!emp) showCredentials(ctx, saved, password, 'Employee added');
    } catch (err) { /* shown */ }
  };
}

function showCredentials(ctx, emp, password, title) {
  const text = 'Oakcraft Daily Working Tracker\nSign in: ' + location.origin + location.pathname.replace(/[^/]*$/, '') + 'login.html\nUsername: ' + emp.username + '\nTemporary password: ' + password + '\nYou will be asked to choose a new password.';
  const m = openModal({
    title,
    body: html`<p>Share these sign-in details with ${emp.name} privately. The password is not shown again.</p>
      <dl class="kv" style="margin:12px 0"><dt>Username</dt><dd><strong>${emp.username}</strong></dd><dt>Temporary password</dt><dd><strong>${password}</strong></dd></dl>
      <div class="row">${copyButton(text, 'Copy sign-in message')}</div>`,
    footer: html`<button class="btn primary" type="button" data-close>Done</button>`
  });
  bindCopy(m.el);
}

function openResetDialog(emp) {
  const m = openModal({
    title: 'Reset password for ' + emp.name,
    body: html`<form class="stack" novalidate><p>${emp.name} will be signed out everywhere and must choose a new password at next sign-in.</p>
      <div class="field"><label for="rp">New temporary password<span class="req">*</span></label>
      <div class="row" style="flex-wrap:nowrap"><input class="input" id="rp" name="newPassword" value="${generatePassword()}" autocomplete="off" spellcheck="false"><button class="btn" type="button" data-gen>Generate</button></div>
      <span class="error" data-error-for="newPassword"></span></div></form>`,
    footer: html`<button class="btn" type="button" data-close>Cancel</button><button class="btn danger" type="button" data-save>Reset password</button>`
  });
  const form = m.el.querySelector('form');
  m.el.querySelector('[data-gen]').onclick = () => { form.newPassword.value = generatePassword(); };
  const btn = m.el.querySelector('[data-save]');
  btn.onclick = async () => {
    const pw = form.newPassword.value.trim();
    try {
      await submitForm(form, btn, () => api('resetPassword', { employeeId: emp.employeeId, newPassword: pw }, { write: true }));
      m.close();
      showCredentials(null, emp, pw, 'Password reset');
    } catch (err) { /* shown */ }
  };
}

const IMPORT_COLUMNS = ['name', 'department', 'designation', 'role', 'managerUsername', 'email', 'mobile', 'joiningDate', 'employmentStatus', 'username', 'password', 'reportRequired'];

function openImportDialog(ctx, done) {
  const m = openModal({
    title: 'Import employees from CSV', wide: true,
    body: html`<div class="stack">
      <p>Use one row per person. Required columns: <strong>name</strong>, <strong>department</strong> (name, e.g. SALES) and <strong>username</strong>. Leave <strong>password</strong> blank to generate one. Dates use YYYY-MM-DD. Up to 500 rows per file.</p>
      <div class="row"><button class="btn sm" type="button" data-template>${icon('download')}Download template</button></div>
      <div class="field"><label for="csv-file">CSV file</label><input class="input" type="file" id="csv-file" accept=".csv,text/csv"></div>
      <div data-preview></div></div>`,
    footer: html`<button class="btn" type="button" data-close>Close</button><button class="btn primary" type="button" data-run disabled>Import</button>`
  });
  let rows = [];
  m.el.querySelector('[data-template]').onclick = () => {
    const sample = [IMPORT_COLUMNS, ['Ravi Kumar', 'SALES', 'Sales Executive', 'EMPLOYEE', 'anil.verma', 'ravi@oakcraft.in', '9876543210', '2026-04-01', 'Full-time', 'ravi.kumar', '', 'TRUE']];
    downloadBlob('oakcraft-employee-import-template.csv', new Blob(['\uFEFF' + sample.map((r) => r.join(',')).join('\r\n')], { type: 'text/csv' }));
  };
  const preview = m.el.querySelector('[data-preview]');
  const run = m.el.querySelector('[data-run]');
  m.el.querySelector('#csv-file').onchange = async (e) => {
    const file = e.target.files[0];
    run.disabled = true; rows = [];
    if (!file) { preview.innerHTML = ''; return; }
    const parsed = parseCsv(await file.text());
    if (parsed.length < 2) { setHTML(preview, html`<div class="banner bad"><span class="banner-body">The file has no data rows.</span></div>`); return; }
    const header = parsed[0].map((h) => h.trim());
    const missing = ['name', 'department', 'username'].filter((h) => header.indexOf(h) < 0);
    if (missing.length) { setHTML(preview, html`<div class="banner bad"><span class="banner-body">Missing columns: ${missing.join(', ')}. Use the template headings exactly.</span></div>`); return; }
    rows = parsed.slice(1, 501).map((r) => { const o = {}; header.forEach((h, i) => { if (IMPORT_COLUMNS.indexOf(h) >= 0) o[h] = (r[i] || '').trim(); }); return o; });
    setHTML(preview, html`<p><strong>${rows.length}</strong> rows ready${parsed.length - 1 > 500 ? ' (only the first 500 are imported)' : ''}. Preview:</p>
      <div class="table-wrap"><table class="data"><thead><tr><th>Name</th><th>Department</th><th>Username</th><th>Role</th><th>Manager</th></tr></thead>
      <tbody>${rows.slice(0, 8).map((r) => html`<tr><td>${r.name}</td><td>${r.department}</td><td>${r.username}</td><td>${r.role || 'EMPLOYEE'}</td><td>${r.managerUsername || ''}</td></tr>`)}</tbody></table></div>`);
    run.disabled = false;
  };
  run.onclick = () => withBusy(run, async () => {
    try {
      const res = await api('importEmployees', { rows }, { write: true, retries: 0 });
      const out = res.results.map((r) => Object.assign({}, rows[r.row - 1], r));
      setHTML(preview, html`<div class="banner ${res.failed ? 'warn' : 'ok'}"><span class="banner-body">${res.imported} imported, ${res.failed} failed. Download the results now: generated passwords are not shown again.</span></div>
        <div class="row" style="margin-bottom:10px"><button class="btn sm primary" type="button" data-dl>${icon('download')}Download results</button></div>
        <div class="table-wrap"><table class="data"><thead><tr><th>Row</th><th>Name</th><th>Result</th></tr></thead><tbody>
        ${out.map((r) => html`<tr><td>${r.row}</td><td>${r.name}</td><td>${r.ok ? html`<span class="pill ok">Added ${r.employeeId}</span>` : html`<span class="pill bad plain">${r.error}</span>`}</td></tr>`)}</tbody></table></div>`);
      preview.querySelector('[data-dl]').onclick = () => downloadBlob('oakcraft-import-results.csv', new Blob([toCsv({
        columns: [{ key: 'row', label: 'Row' }, { key: 'name', label: 'Name' }, { key: 'username', label: 'Username' }, { key: 'employeeId', label: 'Employee ID' }, { key: 'temporaryPassword', label: 'Temporary password' }, { key: 'error', label: 'Error' }],
        rows: out
      })], { type: 'text/csv;charset=utf-8' }));
      run.disabled = true;
      if (res.imported) done();
    } catch (err) { toast(errorMessage(err), 'bad'); }
  });
}

// ============================ Departments ============================

export async function renderDepartments(ctx) {
  const c = ctx.content;
  setHTML(c, html`${ctx.head('Departments', 'Each department has its own report questions and analytics.', html`<button class="btn primary" type="button" data-add>${icon('plus')}Add department</button>`)}<div class="panel" data-results>${skeleton(8)}</div>`);
  let depts = [];
  const load = async () => {
    const results = $('[data-results]', c);
    try {
      depts = await api('getDepartments', { includeInactive: true });
      if (!ctx.isCurrent()) return;
      renderTable(results, {
        caption: 'Departments', rows: depts,
        empty: emptyState('No departments', 'Run the setup in the Google Sheet, or add a department.'),
        columns: [
          { key: 'name', label: 'Department', primary: true, sortable: true, render: (d) => html`<strong>${titleCase(d.name)}</strong><span class="sub">${d.departmentId}${d.description ? ', ' + d.description : ''}</span>` },
          { key: 'managerName', label: 'Manager', sortable: true, render: (d) => d.managerName || html`<span class="muted">Not assigned</span>` },
          { key: 'employeeCount', label: 'Active employees', align: 'right', sortable: true },
          { key: 'status', label: 'Status', sortable: true, render: (d) => html`<span class="pill ${d.status === 'Active' ? 'ok' : 'off'}">${d.status}</span>` },
          { key: 'actions', label: 'Actions', render: (d) => html`<div class="row" style="gap:4px;flex-wrap:nowrap"><button class="btn sm" type="button" data-edit="${d.departmentId}">Edit</button><a class="btn sm ghost" href="admin.html#questions/${d.departmentId}">Questions</a></div>` }
        ]
      });
    } catch (e) { if (ctx.isCurrent()) renderError(results, e, load); }
  };
  on(c, 'click', '[data-add]', () => openDepartmentDialog(null, load));
  on(c, 'click', '[data-edit]', (e, b) => openDepartmentDialog(depts.find((d) => d.departmentId === b.dataset.edit), load));
  load();
}

async function openDepartmentDialog(dept, done) {
  const dir = await api('getEmployeeDirectory', {}).catch(() => []);
  const managers = dir.filter((p) => p.role !== 'EMPLOYEE').map((p) => ({ value: p.employeeId, label: p.name + ' (' + titleCase(p.departmentName) + ')' }));
  const d = dept || { status: 'Active' };
  const m = openModal({
    title: dept ? 'Edit ' + titleCase(dept.name) : 'Add department',
    body: html`<form class="stack" novalidate>
      ${field({ name: 'name', label: 'Department name', required: true, value: d.name, maxlength: 60, hint: 'Stored in capitals, e.g. QUALITY CONTROL.' })}
      ${field({ name: 'managerId', label: 'Department manager', type: 'select', value: d.managerId, placeholder: 'Not assigned', options: managers, hint: 'Only people with the Manager or Admin role are listed.' })}
      ${field({ name: 'description', label: 'Description', type: 'textarea', value: d.description, maxlength: 300, rows: 2 })}
      ${field({ name: 'status', label: 'Status', type: 'select', value: d.status, options: ['Active', 'Inactive'].map((x) => ({ value: x, label: x })), hint: 'A department can be deactivated only when it has no active employees.' })}
    </form>`,
    footer: html`<button class="btn" type="button" data-close>Cancel</button><button class="btn primary" type="button" data-save>${dept ? 'Save changes' : 'Add department'}</button>`
  });
  const form = m.el.querySelector('form');
  const btn = m.el.querySelector('[data-save]');
  btn.onclick = async () => {
    const v = formValues(form);
    if (!v.name) { showFieldErrors(form, { name: 'Department name is required.' }); return; }
    try {
      await submitForm(form, btn, () => api('saveDepartment', { department: Object.assign(v, dept ? { departmentId: dept.departmentId } : {}) }, { write: true }), dept ? 'Department saved.' : 'Department added.');
      m.close(); done();
    } catch (e) { /* shown */ }
  };
}
