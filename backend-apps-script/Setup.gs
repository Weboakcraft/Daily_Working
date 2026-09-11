/**
 * setupOakcraftSystem() — creates/repairs all sheets, headers, defaults and the first admin.
 * Safe to run repeatedly: it never overwrites or clears existing data.
 *
 * seedDemoData() / removeDemoData() — development-only demo records, all flagged IsDemo = TRUE.
 */

const DEFAULT_DEPARTMENTS = ['SALES', 'DIGITAL MARKETING', 'ECOMMERCE', 'ACCOUNTS', 'GEM', 'BACKEND', 'STORE', 'PACKAGING'];

function deptIdFor(name) { return 'DEPT-' + name.replace(/[^A-Z0-9]+/g, '-'); }

/** [key, section, text, type, required, extras] */
function defaultQuestionSpecs() {
  const N = function (key, text, req, extra) { return [key, 'KPI', text, 'NUMBER', !!req, Object.assign({ validation: { min: 0 } }, extra || {})]; };
  const D = function (key, text, req) { return [key, 'KPI', text, 'DECIMAL', !!req, { validation: { min: 0 } }]; };
  const L = function (key, text) { return [key, 'KPI', text, 'LONG_TEXT', false, {}]; };
  const Y = function (key, text) { return [key, 'KPI', text, 'YES_NO', false, {}]; };
  const M = function (key, text, options) { return [key, 'KPI', text, 'MULTI_SELECT', false, { options: options }]; };
  return {
    common: [
      ['COMMON_TODAY_WORK', 'WORK_SUMMARY', 'What work did you perform today?', 'LONG_TEXT', true, { help: 'A short summary in your own words.', validation: { minLength: 10 } }],
      ['COMMON_COMPLETED', 'COMPLETED', 'What tasks did you complete today?', 'LONG_TEXT', false, { help: 'Optional if you added them in the task list.' }],
      ['COMMON_PENDING', 'PENDING', 'What tasks are still pending?', 'LONG_TEXT', false, {}],
      ['COMMON_CARRY_FORWARD', 'CARRY_FORWARD', 'What work is being carried forward to tomorrow?', 'LONG_TEXT', false, {}],
      ['COMMON_BLOCKER_FLAG', 'BLOCKERS', 'Did you face any issue or blocker today?', 'YES_NO', true, {}],
      ['COMMON_BLOCKER_DETAIL', 'BLOCKERS', 'Explain the issue.', 'LONG_TEXT', true, { showIfKey: 'COMMON_BLOCKER_FLAG=Yes', help: 'What is blocked, since when, and who can help.' }],
      ['COMMON_FOLLOWUPS', 'FOLLOWUPS', 'Which follow-ups were completed today?', 'LONG_TEXT', false, {}],
      ['COMMON_MEETINGS', 'MEETINGS', 'List important meetings, calls or discussions.', 'LONG_TEXT', false, {}],
      ['COMMON_TOMORROW_PLAN', 'TOMORROW_PLAN', 'What are your planned tasks for tomorrow?', 'LONG_TEXT', true, {}],
      ['COMMON_NOTES', 'NOTES', 'Anything else management should know?', 'LONG_TEXT', false, {}]
    ],
    departments: {
      'SALES': [
        N('SALES_LEADS_CONTACTED', 'Leads contacted', true), N('SALES_NEW_LEADS', 'New leads received', true), N('SALES_CALLS', 'Calls made'),
        N('SALES_FOLLOWUPS', 'Follow-ups completed'), N('SALES_MEETINGS', 'Meetings / showroom visits'), N('SALES_QUOTES_CREATED', 'Quotations created'),
        N('SALES_QUOTES_FOLLOWED', 'Quotations followed up'), N('SALES_ORDERS', 'Orders received'), D('SALES_ORDER_VALUE', 'Order value (₹)'),
        N('SALES_NEW_CUSTOMERS', 'New customers'), N('SALES_EXISTING_FOLLOWUPS', 'Existing customer follow-ups'), N('SALES_LOST', 'Lost opportunities'),
        ['SALES_LOST_REASONS', 'KPI', 'Reasons for lost opportunities', 'LONG_TEXT', true, { showIfKey: 'SALES_LOST>0' }],
        L('SALES_TOMORROW_FOLLOWUPS', "Tomorrow's follow-ups")
      ],
      'DIGITAL MARKETING': [
        N('DM_CAMPAIGNS_WORKED', 'Campaigns worked on', true), N('DM_CAMPAIGNS_LAUNCHED', 'Campaigns launched'), N('DM_POSTS', 'Posts created', true),
        N('DM_CREATIVES', 'Creatives created'), N('DM_VIDEOS', 'Videos created'), N('DM_LEADS', 'Leads generated'), N('DM_TRAFFIC', 'Website sessions'),
        L('DM_SOCIAL', 'Social media activities'), N('DM_ENGAGEMENT', 'Engagement (likes, comments, shares)'), L('DM_SEO', 'SEO activities'),
        N('DM_KEYWORDS', 'Keywords worked on'), M('DM_ADS_OPTIMISED', 'Ad platforms optimised today', ['Google Ads', 'Meta Ads', 'Marketplace Ads', 'LinkedIn Ads', 'None'])
      ],
      'ECOMMERCE': [
        N('EC_ORDERS_RECEIVED', 'Orders received', true), N('EC_ORDERS_PROCESSED', 'Orders processed', true), N('EC_LISTED', 'Products listed'),
        N('EC_UPDATED', 'Products updated'), N('EC_DESCRIPTIONS', 'Product descriptions updated'), N('EC_IMAGES', 'Images updated'),
        M('EC_MARKETPLACES', 'Marketplaces worked on', ['Amazon', 'Flipkart', 'Website', 'Meesho', 'IndiaMART', 'Other']),
        N('EC_RETURNS', 'Returns'), N('EC_CANCELLATIONS', 'Cancellations'), N('EC_QUERIES', 'Customer queries handled'), D('EC_REVENUE', 'Revenue (₹)'),
        N('EC_PENDING_ORDERS', 'Pending orders'), L('EC_INVENTORY_ISSUES', 'Inventory issues')
      ],
      'ACCOUNTS': [
        N('AC_INVOICES', 'Invoices created', true), N('AC_PAYMENTS_COUNT', 'Payments received (count)'), D('AC_PAYMENTS_AMOUNT', 'Payments received (₹)'),
        N('AC_PAYMENT_FOLLOWUPS', 'Payment follow-ups', true), D('AC_OUTSTANDING_REVIEWED', 'Outstanding amount reviewed (₹)'), Y('AC_BANK_RECO', 'Bank reconciliation done today?'),
        N('AC_TALLY', 'Tally entries'), N('AC_PURCHASE', 'Purchase entries'), N('AC_SALES', 'Sales entries'),
        M('AC_GST', 'GST-related work', ['GSTR-1', 'GSTR-3B', 'E-way bill', 'E-invoice', 'ITC reconciliation', 'None']),
        N('AC_RECON', 'Vendor / customer reconciliations'), N('AC_EXPENSES', 'Expense entries'), L('AC_PENDING', 'Pending accounting work')
      ],
      'GEM': [
        N('GEM_CHECKED', 'Tenders checked', true), N('GEM_IDENTIFIED', 'Tenders identified as suitable', true), N('GEM_PREPARED', 'Tenders prepared'),
        N('GEM_SUBMITTED', 'Tenders submitted'), N('GEM_REGISTRATIONS', 'Registrations / vendor assessments'), L('GEM_DOCUMENTATION', 'Documentation work'),
        M('GEM_PORTAL', 'Portal activities', ['Bid participation', 'Catalogue update', 'Order acceptance', 'Invoice / CRAC', 'Payment follow-up', 'Other']),
        N('GEM_FOLLOWUPS', 'Follow-ups'), N('GEM_OPPORTUNITIES', 'New opportunities'), N('GEM_PENDING', 'Pending submissions')
      ],
      'BACKEND': [
        N('BE_TASKS_DONE', 'Backend tasks completed', true), N('BE_DATA_ENTRIES', 'Data entries'), L('BE_DOCUMENTATION', 'Documentation'),
        L('BE_COORDINATION', 'Internal coordination'), N('BE_SUPPORT', 'Customer / order support cases'), L('BE_IMPROVEMENTS', 'Process improvements'),
        L('BE_PENDING', 'Pending operational work'), N('BE_RESOLVED', 'Issues resolved'), N('BE_ISSUES_PENDING', 'Issues pending')
      ],
      'STORE': [
        N('ST_RECEIVED', 'Stock received (items)', true), N('ST_ISSUED', 'Stock issued (items)', true), N('ST_TRANSFERRED', 'Stock transferred (items)'),
        Y('ST_INVENTORY_UPDATED', 'Inventory updated in system?'), Y('ST_VERIFICATION', 'Stock verification done?'), N('ST_DAMAGED', 'Damaged items'),
        L('ST_SHORTAGE', 'Shortage / excess found'), N('ST_DISPATCH', 'Dispatches coordinated'), N('ST_DISCREPANCIES', 'Inventory discrepancies'),
        L('ST_PENDING', 'Pending store work')
      ],
      'PACKAGING': [
        N('PK_ORDERS_PACKED', 'Orders packed', true), N('PK_ITEMS_PACKED', 'Items packed', true), N('PK_READY', 'Orders ready for dispatch'),
        N('PK_DISPATCH', 'Dispatches coordinated'), L('PK_MATERIAL_USED', 'Packaging material used'), N('PK_DAMAGED', 'Damaged packaging'),
        N('PK_REPACKED', 'Items repacked'), N('PK_PENDING', 'Pending packing'), L('PK_ISSUES', 'Packaging issues'),
        ['PK_MATERIAL_STOCK', 'KPI', 'Packaging material stock level', 'DROPDOWN', false, { options: ['Sufficient', 'Low', 'Critical'] }]
      ]
    }
  };
}

/**
 * Clears cached copies of Employees, Departments, Questions and Settings.
 * Needed after anyone edits those tabs directly in the Sheet (the app otherwise refreshes within 30 minutes).
 */
function clearTableCache() {
  Object.keys(CACHED_TABLES).forEach(function (name) { Db.invalidate(name); });
  SETTINGS_MEMO = null;
}

/** Menu action: apply manual Sheet edits to the app immediately. */
function refreshAppCache() {
  clearTableCache();
  const msg = 'The app now uses the latest Employees, Departments, Questions and Settings from this Sheet.';
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) { /* editor */ }
  return msg;
}

function setupOakcraftSystem() {
  const props = PropertiesService.getScriptProperties();
  let ss = null;
  try { ss = SpreadsheetApp.getActiveSpreadsheet(); } catch (e) { ss = null; }
  if (!ss && props.getProperty('SPREADSHEET_ID')) ss = SpreadsheetApp.openById(props.getProperty('SPREADSHEET_ID'));
  if (!ss) ss = SpreadsheetApp.create('Oakcraft Daily Working Tracker — Database');
  props.setProperty('SPREADSHEET_ID', ss.getId());
  getPepper();
  clearTableCache();

  const log = [];
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    Object.keys(SHEETS).forEach(function (name) {
      let sh = ss.getSheetByName(name);
      if (!sh) { sh = ss.insertSheet(name); log.push('Created sheet ' + name); }
      const want = SHEETS[name];
      const lastCol = sh.getLastColumn();
      const current = lastCol ? sh.getRange(1, 1, 1, lastCol).getValues()[0].map(String) : [];
      const hasAny = current.some(function (h) { return h; });
      if (!hasAny) {
        sh.getRange(1, 1, 1, want.length).setValues([want]);
      } else {
        const missing = want.filter(function (h) { return current.indexOf(h) < 0; });
        if (missing.length) {
          sh.getRange(1, lastCol + 1, 1, missing.length).setValues([missing]);
          log.push('Added columns to ' + name + ': ' + missing.join(', '));
        }
      }
      const width = sh.getLastColumn();
      if (sh.getMaxColumns() > width) sh.deleteColumns(width + 1, sh.getMaxColumns() - width);
      sh.getRange(1, 1, sh.getMaxRows(), width).setNumberFormat('@');
      sh.getRange(1, 1, 1, width).setFontWeight('bold').setBackground('#2B2F2C').setFontColor('#FFFFFF');
      sh.setFrozenRows(1);
    });
    const blank = ss.getSheetByName('Sheet1');
    if (blank && ss.getSheets().length > 1 && blank.getLastRow() === 0) ss.deleteSheet(blank);
    Db.resetMemo();

    const now = nowIso();
    // Settings
    const defs = settingDefs();
    const existingSettings = indexBy(Db.readAll('Settings'), 'SettingKey');
    const newSettings = Object.keys(defs).filter(function (k) { return !existingSettings[k]; }).map(function (k) {
      const v = defs[k].def;
      return { SettingKey: k, SettingValue: typeof v === 'object' ? JSON.stringify(v) : String(v), Description: defs[k].desc, UpdatedAt: now };
    });
    Db.insert('Settings', newSettings);
    if (newSettings.length) log.push('Added ' + newSettings.length + ' default settings');

    // Departments
    const depts = Db.readAll('Departments');
    if (!depts.length) {
      Db.insert('Departments', DEFAULT_DEPARTMENTS.map(function (n) {
        return { DepartmentID: deptIdFor(n), DepartmentName: n, ManagerID: '', Status: 'Active', Description: '', CreatedAt: now, UpdatedAt: now };
      }));
      log.push('Created 8 default departments');
    }

    // Questions (insert only keys that don't exist yet)
    const specs = defaultQuestionSpecs();
    const existingQ = Db.readAll('Questions');
    const byKey = {};
    existingQ.forEach(function (q) { if (q.QuestionKey) byKey[q.QuestionKey] = q; });
    const deptByName = {};
    Db.readAll('Departments').forEach(function (d) { deptByName[d.DepartmentName] = d.DepartmentID; });
    const toInsert = [];
    const build = function (spec, deptId, order) {
      if (byKey[spec[0]]) return;
      const ex = spec[5] || {};
      const row = {
        QuestionID: newId('QST'), DepartmentID: deptId, QuestionKey: spec[0], Section: spec[1], QuestionText: spec[2], QuestionType: spec[3],
        Required: spec[4], Options: JSON.stringify(ex.options || []), DisplayOrder: order, Validation: JSON.stringify(ex.validation || {}),
        HelpText: ex.help || '', DefaultValue: '', ShowIf: '', Status: 'Active', CreatedAt: now, UpdatedAt: now, _showIfKey: ex.showIfKey
      };
      byKey[spec[0]] = row;
      toInsert.push(row);
    };
    specs.common.forEach(function (sp, i) { build(sp, COMMON_DEPARTMENT_ID, (i + 1) * 10); });
    Object.keys(specs.departments).forEach(function (dn) {
      if (!deptByName[dn]) return;
      specs.departments[dn].forEach(function (sp, i) { build(sp, deptByName[dn], (i + 1) * 10); });
    });
    toInsert.forEach(function (row) {
      if (!row._showIfKey) return;
      const m = /^([A-Z0-9_]+)(.*)$/.exec(row._showIfKey);
      if (m && byKey[m[1]]) row.ShowIf = byKey[m[1]].QuestionID + m[2];
    });
    Db.insert('Questions', toInsert);
    if (toInsert.length) log.push('Added ' + toInsert.length + ' default questions');

    // First admin
    const admins = Db.readAll('Employees').filter(function (e) { return e.Role === 'ADMIN' && e.Status === 'Active'; });
    if (!admins.length) {
      const all = Db.readAll('Employees');
      const username = all.some(function (e) { return e.Username === 'admin'; }) ? 'admin' + Math.floor(Math.random() * 900 + 100) : 'admin';
      const password = 'Oak-' + Utilities.getUuid().replace(/-/g, '').slice(0, 8) + '7';
      const emp = {
        EmployeeID: nextEmployeeId(all), EmployeeName: 'System Administrator', DepartmentID: deptIdFor('BACKEND'), Designation: 'Administrator',
        Role: 'ADMIN', ManagerID: '', Email: '', Mobile: '', JoiningDate: todayStr(), EmploymentStatus: 'Full-time', Username: username,
        Status: 'Active', ReportRequired: false, IsDemo: false, CreatedAt: now, UpdatedAt: now
      };
      Db.insert('Employees', [emp]);
      const cred = Db.findOne('Credentials', 'EmployeeID', emp.EmployeeID);
      if (!cred) Db.insert('Credentials', [makeCredential(emp.EmployeeID, username, password, true)]);
      log.push('FIRST ADMIN CREATED → username: ' + username + '  temporary password: ' + password + '  (you must change it at first login)');
    }
  } finally {
    lock.releaseLock();
  }
  SETTINGS_MEMO = null;
  const summary = 'Oakcraft setup complete.\n' + (log.length ? log.join('\n') : 'Everything was already set up — no changes made.');
  Logger.log(summary);
  try { SpreadsheetApp.getUi().alert(summary); } catch (e) { /* no UI when run from editor */ }
  return summary;
}

// ============================ DEMO DATA ============================

function demoRandom(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function demoPeople() {
  // [username, name, department, designation, role]
  return [
    ['demo.admin', 'Neha Kapoor', 'BACKEND', 'Operations Head', 'ADMIN'],
    ['demo.anil', 'Anil Verma', 'SALES', 'Sales Manager', 'MANAGER'], ['demo.priya', 'Priya Sharma', 'SALES', 'Sales Executive', 'EMPLOYEE'], ['demo.rohit', 'Rohit Gupta', 'SALES', 'Sales Executive', 'EMPLOYEE'],
    ['demo.kavya', 'Kavya Nair', 'DIGITAL MARKETING', 'Marketing Manager', 'MANAGER'], ['demo.arjun', 'Arjun Mehta', 'DIGITAL MARKETING', 'Performance Marketer', 'EMPLOYEE'], ['demo.sana', 'Sana Qureshi', 'DIGITAL MARKETING', 'Graphic Designer', 'EMPLOYEE'],
    ['demo.vikas', 'Vikas Yadav', 'ECOMMERCE', 'Ecommerce Manager', 'MANAGER'], ['demo.pooja', 'Pooja Bansal', 'ECOMMERCE', 'Marketplace Executive', 'EMPLOYEE'], ['demo.imran', 'Imran Khan', 'ECOMMERCE', 'Catalogue Executive', 'EMPLOYEE'],
    ['demo.sunita', 'Sunita Agarwal', 'ACCOUNTS', 'Accounts Manager', 'MANAGER'], ['demo.deepak', 'Deepak Jain', 'ACCOUNTS', 'Accountant', 'EMPLOYEE'], ['demo.meera', 'Meera Iyer', 'ACCOUNTS', 'Accounts Executive', 'EMPLOYEE'],
    ['demo.rajesh', 'Rajesh Malhotra', 'GEM', 'Tender Manager', 'MANAGER'], ['demo.nikita', 'Nikita Saxena', 'GEM', 'Tender Executive', 'EMPLOYEE'], ['demo.harsh', 'Harsh Chauhan', 'GEM', 'Documentation Executive', 'EMPLOYEE'],
    ['demo.alok', 'Alok Tiwari', 'BACKEND', 'Backend Lead', 'MANAGER'], ['demo.ritu', 'Ritu Singh', 'BACKEND', 'MIS Executive', 'EMPLOYEE'], ['demo.farhan', 'Farhan Ali', 'BACKEND', 'Support Executive', 'EMPLOYEE'],
    ['demo.manoj', 'Manoj Kumar', 'STORE', 'Store Manager', 'MANAGER'], ['demo.suresh', 'Suresh Pal', 'STORE', 'Store Keeper', 'EMPLOYEE'], ['demo.geeta', 'Geeta Rawat', 'STORE', 'Inventory Assistant', 'EMPLOYEE'],
    ['demo.ramesh', 'Ramesh Thakur', 'PACKAGING', 'Packaging Supervisor', 'MANAGER'], ['demo.sonu', 'Sonu Prajapati', 'PACKAGING', 'Packer', 'EMPLOYEE'], ['demo.lakshmi', 'Lakshmi Devi', 'PACKAGING', 'Packer', 'EMPLOYEE']
  ];
}

function demoTaskTemplates() {
  return {
    'SALES': [['Called inbound leads from IndiaMART', 'Follow-up', 'CUSTOMER'], ['Prepared quotation for OC-511 chairs', 'Client work', 'CUSTOMER'], ['Showroom visit with corporate buyer', 'Meeting', 'CUSTOMER'], ['Followed up pending quotations', 'Follow-up', 'CUSTOMER'], ['Negotiated bulk order pricing', 'Client work', 'ORDER'], ['Updated CRM with call notes', 'Documentation', '']],
    'DIGITAL MARKETING': [['Launched Meta lead campaign for ergonomic chairs', 'Client work', 'PROJECT'], ['Designed carousel creatives', 'Operations', 'PROJECT'], ['Edited product video reel', 'Operations', 'PRODUCT'], ['Optimised Google Ads keywords', 'Operations', ''], ['On-page SEO for chair category pages', 'Operations', ''], ['Scheduled Instagram posts', 'Operations', '']],
    'ECOMMERCE': [['Processed Amazon orders', 'Operations', 'ORDER'], ['Listed new mesh chair variants on Flipkart', 'Operations', 'PRODUCT'], ['Updated product images', 'Operations', 'PRODUCT'], ['Resolved customer return query', 'Client work', 'ORDER'], ['Reconciled marketplace payouts', 'Documentation', ''], ['Fixed listing suppression issue', 'Operations', 'PRODUCT']],
    'ACCOUNTS': [['Created sales invoices in Tally', 'Documentation', 'ORDER'], ['Payment follow-up with dealers', 'Follow-up', 'CUSTOMER'], ['Bank reconciliation', 'Documentation', ''], ['Filed GSTR-1 working', 'Documentation', ''], ['Vendor ledger reconciliation', 'Documentation', 'VENDOR'], ['Booked purchase entries', 'Documentation', 'VENDOR']],
    'GEM': [['Checked new GeM bids for revolving chairs', 'Operations', 'TENDER'], ['Prepared technical compliance annexure', 'Documentation', 'TENDER'], ['Submitted bid documents', 'Operations', 'TENDER'], ['Updated catalogue on GeM', 'Operations', 'PRODUCT'], ['Followed up on CRAC for delivered order', 'Follow-up', 'ORDER'], ['Vendor assessment documentation', 'Documentation', '']],
    'BACKEND': [['Order data entry and verification', 'Operations', 'ORDER'], ['Coordinated dispatch schedule with store', 'Coordination', ''], ['Resolved customer delivery query', 'Client work', 'ORDER'], ['Prepared daily MIS report', 'Documentation', ''], ['Updated SOP document', 'Documentation', 'PROJECT'], ['Warranty claim coordination', 'Coordination', 'CUSTOMER']],
    'STORE': [['Received raw material consignment', 'Operations', 'VENDOR'], ['Issued components to production', 'Operations', ''], ['Cycle count of castor wheels', 'Operations', 'PRODUCT'], ['Updated stock register', 'Documentation', ''], ['Coordinated dispatch loading', 'Coordination', 'ORDER'], ['Checked damaged goods returned', 'Operations', 'ORDER']],
    'PACKAGING': [['Packed chairs for Delhi dispatch', 'Operations', 'ORDER'], ['Packed marketplace orders', 'Operations', 'ORDER'], ['Repacked damaged cartons', 'Operations', 'ORDER'], ['Checked packaging material stock', 'Operations', ''], ['Labelled dispatch-ready orders', 'Operations', 'ORDER'], ['Coordinated with transporter', 'Coordination', 'ORDER']]
  };
}

function seedDemoData() {
  Db.resetMemo();
  if (Db.readAll('Employees').some(function (e) { return bool(e.IsDemo); })) {
    const msg = 'Demo data already exists. Run removeDemoData() first if you want to recreate it.';
    Logger.log(msg);
    return msg;
  }
  const s = getSettingsMap();
  const rnd = demoRandom(20260910);
  const pick = function (arr) { return arr[Math.floor(rnd() * arr.length)]; };
  const intBetween = function (a, b) { return a + Math.floor(rnd() * (b - a + 1)); };
  const now = nowIso();
  const today = todayStr();
  const deptByName = {};
  Db.readAll('Departments').forEach(function (d) { deptByName[d.DepartmentName] = d; });
  const questions = Db.readAll('Questions').filter(function (q) { return q.Status === 'Active'; });
  const qKey = indexBy(questions.filter(function (q) { return q.QuestionKey; }), 'QuestionKey');
  const password = 'Demo@1234';

  const out = { Employees: [], Credentials: [], Reports: [], Tasks: [], Responses: [], Remarks: [], FollowUps: [] };
  const existing = Db.readAll('Employees');
  let nextNum = parseInt(nextEmployeeId(existing).slice(4), 10);
  const people = demoPeople().filter(function (p) { return deptByName[p[2]]; }).map(function (p) {
    const d = deptByName[p[2]];
    const emp = {
      EmployeeID: 'EMP-' + ('0000' + (nextNum++)).slice(-4), EmployeeName: p[1], DepartmentID: d.DepartmentID, Designation: p[3], Role: p[4], ManagerID: '',
      Email: p[0].replace('demo.', '') + '.demo@oakcraft.in', Mobile: '98' + String(10000000 + Math.floor(rnd() * 89999999)), JoiningDate: addDays(today, -intBetween(120, 900)),
      EmploymentStatus: 'Full-time', Username: p[0], Status: 'Active', ReportRequired: p[4] !== 'ADMIN', IsDemo: true, CreatedAt: now, UpdatedAt: now
    };
    out.Employees.push(emp);
    out.Credentials.push(makeCredential(emp.EmployeeID, emp.Username, password, false));
    return emp;
  });
  const admin = people.filter(function (e) { return e.Role === 'ADMIN'; })[0];
  const managerOf = {};
  people.forEach(function (e) { if (e.Role === 'MANAGER') managerOf[e.DepartmentID] = e; });
  people.forEach(function (e) {
    if (e.Role === 'EMPLOYEE') e.ManagerID = managerOf[e.DepartmentID] ? managerOf[e.DepartmentID].EmployeeID : '';
    if (e.Role === 'MANAGER' && admin) e.ManagerID = admin.EmployeeID;
  });

  const templates = demoTaskTemplates();
  const at = function (date, hhmm) { return Utilities.parseDate(date + ' ' + hhmm, s.TIMEZONE, 'yyyy-MM-dd HH:mm').toISOString(); };
  const hm = function (min) { return ('0' + Math.floor(min / 60)).slice(-2) + ':' + ('0' + (min % 60)).slice(-2); };
  const openByEmp = {};
  const dates = dateRange(addDays(today, -45), today).filter(function (d) { return workingDayInfo(d, s).working; });
  const deadlineMin = timeToMin(s.REPORT_DEADLINE);

  dates.forEach(function (date) {
    people.forEach(function (emp) {
      if (!bool(emp.ReportRequired)) return;
      const isToday = date === today;
      if (rnd() < (isToday ? 0.45 : 0.1)) return; // not started
      const deptName = Object.keys(deptByName).filter(function (n) { return deptByName[n].DepartmentID === emp.DepartmentID; })[0];
      const reportId = newId('RPT');
      const lateFlag = !isToday && rnd() < 0.12;
      const status = isToday ? (rnd() < 0.5 ? 'DRAFT' : 'SUBMITTED') : (lateFlag ? 'LATE' : 'SUBMITTED');
      const submittedAt = status === 'DRAFT' ? '' : at(date, hm(lateFlag ? deadlineMin + s.GRACE_PERIOD_MINUTES + intBetween(5, 90) : deadlineMin - intBetween(5, 60)));
      const report = {
        ReportID: reportId, UniqueKey: emp.EmployeeID + '|' + date, EmployeeID: emp.EmployeeID, DepartmentID: emp.DepartmentID, ReportDate: date, Status: status,
        StartedAt: at(date, hm(deadlineMin - 70)), LastSavedAt: submittedAt || at(date, hm(deadlineMin - 30)), SubmittedAt: submittedAt, FirstSubmittedAt: submittedAt,
        LateFlag: lateFlag, ManagerID: emp.ManagerID, ReviewStatus: 'NOT REVIEWED', ManagerRemarks: '', ReopenedAt: '', ReopenedBy: '', ReopenReason: '',
        HasBlocker: false, IsDemo: true, CreatedAt: at(date, hm(deadlineMin - 70)), UpdatedAt: submittedAt || now
      };
      // Tasks: continue some open work from the previous day, then add new tasks
      const tasks = [];
      let clock = timeToMin(s.OFFICE_START_TIME) + 15;
      const addTask = function (title, category, relType, source) {
        const dur = intBetween(3, 16) * 10;
        const st = source
          ? pick(['COMPLETED', 'COMPLETED', 'COMPLETED', 'IN PROGRESS', 'CARRIED FORWARD'])
          : pick(['COMPLETED', 'COMPLETED', 'COMPLETED', 'COMPLETED', 'COMPLETED', 'COMPLETED', 'IN PROGRESS', 'PENDING', 'BLOCKED']);
        const pr = pick(['LOW', 'MEDIUM', 'MEDIUM', 'MEDIUM', 'HIGH', 'HIGH', 'URGENT']);
        const t = {
          TaskID: newId('TSK'), ReportID: reportId, EmployeeID: emp.EmployeeID, DepartmentID: emp.DepartmentID, ReportDate: date, TaskTitle: title,
          Description: '', Category: category, StartTime: hm(clock), EndTime: hm(Math.min(clock + dur, 23 * 60)), Duration: Math.min(dur, 23 * 60 - clock),
          Priority: source ? source.Priority : pr, Status: st, RelatedType: relType, RelatedEntity: relType ? relType.charAt(0) + relType.slice(1).toLowerCase() + ' #' + intBetween(1001, 9999) : '',
          Remarks: st === 'BLOCKED' ? pick(['Waiting for approval from customer', 'Material not received from vendor', 'Portal down since morning', 'Payment confirmation pending']) : '',
          SourceTaskID: source ? source.TaskID : '', CarriedToTaskID: '', CarryCount: source ? num(source.CarryCount) + 1 : 0, DisplayOrder: tasks.length + 1,
          Deleted: false, IsDemo: true, CreatedAt: report.CreatedAt, UpdatedAt: report.UpdatedAt
        };
        if (source) { source.CarriedToTaskID = t.TaskID; t.RelatedEntity = source.RelatedEntity; }
        clock += dur + 10;
        tasks.push(t);
      };
      // Most open work is continued; the rest was closed off outside the report (completed or cancelled).
      (openByEmp[emp.EmployeeID] || []).forEach(function (src) {
        if (rnd() < 0.75) addTask(src.TaskTitle, src.Category, src.RelatedType, src);
        else if (!isToday) { src.Status = pick(['COMPLETED', 'COMPLETED', 'CANCELLED']); src.Remarks = src.Status === 'CANCELLED' ? 'No longer required' : 'Closed later'; }
      });
      const n = intBetween(2, 4);
      for (let i = 0; i < n; i++) { const tp = pick(templates[deptName] || templates.BACKEND); addTask(tp[0], tp[1], tp[2], null); }
      openByEmp[emp.EmployeeID] = status === 'DRAFT' ? [] : tasks.filter(function (t) { return OPEN_TASK_STATUSES.indexOf(t.Status) >= 0; });
      applyAggregates(report, tasks);

      // Responses
      const answers = {};
      const done = tasks.filter(function (t) { return t.Status === 'COMPLETED'; }).map(function (t) { return t.TaskTitle; });
      const open = tasks.filter(function (t) { return t.Status !== 'COMPLETED'; }).map(function (t) { return t.TaskTitle; });
      const blocker = rnd() < 0.14;
      const put = function (key, val) { if (qKey[key] && val !== '') answers[qKey[key].QuestionID] = val; };
      put('COMMON_TODAY_WORK', 'Worked on ' + tasks.map(function (t) { return t.TaskTitle.toLowerCase(); }).join(', ') + '.');
      put('COMMON_COMPLETED', done.join('\n'));
      put('COMMON_PENDING', open.join('\n'));
      put('COMMON_CARRY_FORWARD', open.slice(0, 2).join('\n'));
      put('COMMON_BLOCKER_FLAG', blocker ? 'Yes' : 'No');
      if (blocker) put('COMMON_BLOCKER_DETAIL', pick(['Vendor has not confirmed the delivery date for mesh fabric.', 'Customer approval pending on revised quotation.', 'GeM portal was slow; could not upload documents.', 'Tally license expired on one system.']));
      put('COMMON_MEETINGS', rnd() < 0.5 ? 'Daily coordination call with ' + (managerOf[emp.DepartmentID] ? managerOf[emp.DepartmentID].EmployeeName : 'team') : '');
      put('COMMON_TOMORROW_PLAN', rnd() < 0.9 ? 'Continue ' + (open[0] || 'regular work') + ' and pick up new requests.' : '');
      questions.filter(function (q) { return q.DepartmentID === emp.DepartmentID && q.Section === 'KPI'; }).forEach(function (q) {
        if (answers[q.QuestionID] !== undefined) return;
        if (q.QuestionType === 'NUMBER') answers[q.QuestionID] = String(q.QuestionKey === 'SALES_LOST' ? intBetween(0, 2) : intBetween(0, /PACKED|ITEMS|RECEIVED|ISSUED|TRAFFIC|ENGAGEMENT/.test(q.QuestionKey) ? 120 : 15));
        else if (q.QuestionType === 'DECIMAL') answers[q.QuestionID] = String(intBetween(5, 250) * 1000);
        else if (q.QuestionType === 'YES_NO') answers[q.QuestionID] = rnd() < 0.7 ? 'Yes' : 'No';
        else if (q.QuestionType === 'MULTI_SELECT') { const opts = parseJson(q.Options, []); answers[q.QuestionID] = JSON.stringify([pick(opts)]); }
        else if (q.QuestionType === 'DROPDOWN') answers[q.QuestionID] = pick(parseJson(q.Options, ['']));
        else if (q.QuestionType === 'LONG_TEXT' && rnd() < 0.5) answers[q.QuestionID] = 'Routine ' + q.QuestionText.toLowerCase() + ' completed.';
      });
      const lostQ = qKey.SALES_LOST_REASONS, lostCount = qKey.SALES_LOST;
      if (lostQ && lostCount && answers[lostCount.QuestionID] && Number(answers[lostCount.QuestionID]) > 0 && emp.DepartmentID === lostQ.DepartmentID) {
        answers[lostQ.QuestionID] = pick(['Price higher than local competitor', 'Customer postponed purchase', 'Required delivery in 2 days']);
      }
      const qById = indexBy(questions, 'QuestionID');
      Object.keys(answers).forEach(function (qid) {
        out.Responses.push({ ResponseID: newId('RSP'), ReportID: reportId, QuestionID: qid, EmployeeID: emp.EmployeeID, DepartmentID: emp.DepartmentID, ReportDate: date, QuestionText: qById[qid].QuestionText, Answer: answers[qid], IsDemo: true, CreatedAt: report.CreatedAt, UpdatedAt: report.UpdatedAt });
      });
      report.HasBlocker = blocker || num(report.TaskBlocked) > 0;
      report._blocker = blocker;

      if (status !== 'DRAFT') {
        if (blocker) {
          out.FollowUps.push({ FollowUpID: newId('FUP'), ReportID: reportId, TaskID: '', EmployeeID: emp.EmployeeID, DepartmentID: emp.DepartmentID, OwnerID: emp.ManagerID, Title: 'Blocker reported by ' + emp.EmployeeName, Description: answers[qKey.COMMON_BLOCKER_DETAIL.QuestionID] || '', Priority: 'HIGH', DueDate: nextWorkingDay(date, s), Status: daysBetween(date, today) > 5 ? pick(['RESOLVED', 'CLOSED', 'IN PROGRESS']) : pick(['OPEN', 'IN PROGRESS']), Source: 'BLOCKER', Resolution: '', CreatedBy: emp.EmployeeID, IsDemo: true, CreatedAt: submittedAt, UpdatedAt: submittedAt, ResolvedAt: '' });
        }
        if (daysBetween(date, today) > 1 && rnd() < 0.45 && emp.ManagerID) {
          const reviewStatus = pick(['REVIEWED', 'REVIEWED', 'REVIEWED', 'FOLLOW-UP REQUIRED']);
          const comment = reviewStatus === 'REVIEWED' ? pick(['Good progress, keep it up.', 'Noted. Please close pending quotations by Friday.', 'Thanks for the detailed update.']) : 'Please share an update on the blocked items tomorrow morning.';
          out.Remarks.push({ RemarkID: newId('RMK'), ReportID: reportId, AuthorID: emp.ManagerID, Comment: comment, FollowUpRequired: reviewStatus === 'FOLLOW-UP REQUIRED', Priority: 'MEDIUM', ReviewStatus: reviewStatus, IsDemo: true, CreatedAt: addDays(date, 1) + 'T05:00:00.000Z' });
          report.ReviewStatus = reviewStatus;
          report.ManagerRemarks = comment;
        }
      }
      out.FollowUps.forEach(function (f) { if ((f.Status === 'RESOLVED' || f.Status === 'CLOSED') && !f.ResolvedAt) { f.ResolvedAt = f.UpdatedAt; f.Resolution = 'Resolved after coordination with the concerned team.'; } });
      out.Reports.push(report);
      Array.prototype.push.apply(out.Tasks, tasks);
    });
  });

  // Task statuses can change after their report was built (closed-off work), so recompute report totals.
  const tasksByReport = groupBy(out.Tasks, function (t) { return t.ReportID; });
  out.Reports.forEach(function (r) {
    applyAggregates(r, tasksByReport[r.ReportID] || []);
    r.HasBlocker = r._blocker || num(r.TaskBlocked) > 0;
    delete r._blocker;
  });

  Db.withLock(function () {
    ['Employees', 'Credentials', 'Reports', 'Tasks', 'Responses', 'Remarks', 'FollowUps'].forEach(function (name) { Db.insert(name, out[name]); });
    const depts = Db.readAll('Departments');
    const upd = depts.filter(function (d) { return !d.ManagerID && managerOf[d.DepartmentID]; });
    upd.forEach(function (d) { d.ManagerID = managerOf[d.DepartmentID].EmployeeID; d.UpdatedAt = now; });
    Db.update('Departments', upd);
  });
  const msg = 'Demo data created: ' + out.Employees.length + ' employees, ' + out.Reports.length + ' reports, ' + out.Tasks.length + ' tasks, ' +
    out.Responses.length + ' answers, ' + out.FollowUps.length + ' follow-ups. All demo logins use password ' + password + ' (e.g. demo.admin, demo.anil, demo.priya).';
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) { /* editor */ }
  return msg;
}

function removeDemoData() {
  Db.resetMemo();
  const counts = {};
  Db.withLock(function () {
    const demoEmpIds = {};
    Db.readAll('Employees').forEach(function (e) { if (bool(e.IsDemo)) demoEmpIds[e.EmployeeID] = true; });
    ['Reports', 'Tasks', 'Responses', 'Remarks', 'FollowUps'].forEach(function (name) {
      const rows = Db.readAll(name).filter(function (r) { return bool(r.IsDemo); });
      counts[name] = rows.length;
      Db.removeRows(name, rows);
    });
    const creds = Db.readAll('Credentials').filter(function (c) { return demoEmpIds[c.EmployeeID]; });
    Db.removeRows('Credentials', creds);
    const sessions = Db.readAll('Sessions').filter(function (x) { return demoEmpIds[x.EmployeeID]; });
    Db.removeRows('Sessions', sessions);
    const depts = Db.readAll('Departments').filter(function (d) { return demoEmpIds[d.ManagerID]; });
    depts.forEach(function (d) { d.ManagerID = ''; d.UpdatedAt = nowIso(); });
    Db.update('Departments', depts);
    const emps = Db.readAll('Employees').filter(function (e) { return demoEmpIds[e.EmployeeID]; });
    counts.Employees = emps.length;
    Db.removeRows('Employees', emps);
    const cache = CacheService.getScriptCache();
    sessions.forEach(function (x) { cache.remove('sess:' + x.TokenHash); });
  });
  const msg = 'Demo data removed: ' + JSON.stringify(counts);
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) { /* editor */ }
  return msg;
}
