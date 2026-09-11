/**
 * System settings. Non-secret settings live in the Settings sheet; secrets
 * (webhook URLs, password pepper) live in Script Properties and are never returned.
 */

function settingDefs() {
  return {
    COMPANY_NAME: { def: 'Oakcraft', type: 'string', pub: true, desc: 'Company name shown in the app' },
    APP_SUBTITLE: { def: 'Daily Working Tracker', type: 'string', pub: true, desc: 'Subtitle shown under the company name' },
    TIMEZONE: { def: 'Asia/Kolkata', type: 'timezone', pub: true, desc: 'Timezone used for report dates and deadlines' },
    OFFICE_START_TIME: { def: '09:30', type: 'time', pub: true, desc: 'Office start time (HH:mm)' },
    OFFICE_END_TIME: { def: '19:00', type: 'time', pub: true, desc: 'Office end time (HH:mm)' },
    REPORT_DEADLINE: { def: '19:00', type: 'time', pub: true, desc: 'Daily report deadline (HH:mm)' },
    GRACE_PERIOD_MINUTES: { def: 15, type: 'int', min: 0, max: 600, pub: true, desc: 'Minutes after the deadline before a report is LATE' },
    WORKING_DAYS: { def: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'], type: 'days', pub: true, desc: 'Days on which reports are expected' },
    HOLIDAYS: { def: [], type: 'holidays', pub: true, desc: 'Holiday calendar (JSON list of {date, name})' },
    LOCK_AFTER_DEADLINE: { def: false, type: 'bool', pub: true, desc: 'Block submissions after deadline + grace (admin can reopen)' },
    BACKDATE_DAYS_ALLOWED: { def: 1, type: 'int', min: 0, max: 7, pub: true, desc: 'How many past days an employee may still report for' },
    CARRY_FORWARD_ENABLED: { def: true, type: 'bool', pub: true, desc: 'Show unfinished work from previous days' },
    AUTO_FOLLOWUP_FOR_BLOCKERS: { def: true, type: 'bool', pub: false, desc: 'Create follow-ups automatically for reported blockers' },
    TASK_CATEGORIES: { def: ['Client work', 'Follow-up', 'Documentation', 'Coordination', 'Operations', 'Meeting', 'Other'], type: 'list', pub: true, desc: 'Task categories offered to employees' },
    SESSION_HOURS: { def: 12, type: 'int', min: 1, max: 168, pub: false, desc: 'Login session length in hours' },
    MAX_LOGIN_ATTEMPTS: { def: 5, type: 'int', min: 3, max: 20, pub: false, desc: 'Failed logins before a 15-minute lock' },
    PRODUCTIVITY_SCORE_ENABLED: { def: true, type: 'bool', pub: true, desc: 'Show the transparent productivity score' },
    PRODUCTIVITY_WEIGHTS: {
      def: { CONSISTENCY: 15, TASK_COMPLETION: 25, KPI: 25, TIMELINESS: 15, PLANNING: 10, BLOCKER_RESOLUTION: 10 },
      type: 'weights', pub: true, desc: 'Productivity score weights (must total 100)'
    },
    SHOW_REMARKS_TO_EMPLOYEE: { def: true, type: 'bool', pub: true, desc: 'Employees can read manager remarks on their reports' },
    NOTIFICATIONS_ENABLED: { def: false, type: 'bool', pub: false, desc: 'Master switch for notifications' },
    NOTIFY_CHANNELS: { def: ['EMAIL'], type: 'channels', pub: false, desc: 'Notification channels' },
    NOTIFY_EVENTS: {
      def: { REPORT_REMINDER: true, MISSING_REPORT: true, LATE_REPORT: true, FOLLOWUP_ASSIGNED: true, HIGH_PRIORITY_BLOCKER: true },
      type: 'events', pub: false, desc: 'Which events send notifications'
    },
    REMINDER_MINUTES_BEFORE: { def: 30, type: 'int', min: 5, max: 240, pub: false, desc: 'Reminder lead time before the deadline' },
    BRAND_PRIMARY: { def: '#1B4F8A', type: 'color', pub: true, desc: 'Primary brand colour' },
    BRAND_ACCENT: { def: '#0E7C86', type: 'color', pub: true, desc: 'Accent brand colour' }
  };
}

const NOTIFY_CHANNEL_KEYS = ['EMAIL', 'GOOGLE_CHAT', 'WEBHOOK'];
const NOTIFY_EVENT_KEYS = ['REPORT_REMINDER', 'MISSING_REPORT', 'LATE_REPORT', 'FOLLOWUP_ASSIGNED', 'HIGH_PRIORITY_BLOCKER'];
const WEIGHT_KEYS = ['CONSISTENCY', 'TASK_COMPLETION', 'KPI', 'TIMELINESS', 'PLANNING', 'BLOCKER_RESOLUTION'];
const DAY_KEYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

let SETTINGS_MEMO = null;

function parseSettingValue(def, raw) {
  if (raw === '' || raw === undefined || raw === null) return def.def;
  switch (def.type) {
    case 'int': return Math.round(num(raw, def.def));
    case 'bool': return bool(raw);
    case 'days': case 'holidays': case 'list': case 'weights': case 'channels': case 'events':
      return parseJson(raw, def.def);
    default: return String(raw);
  }
}

/** Parsed settings merged with defaults (memoised per execution). */
function getSettingsMap() {
  if (SETTINGS_MEMO) return SETTINGS_MEMO;
  const defs = settingDefs();
  const rows = {};
  try { Db.readAll('Settings').forEach(function (r) { rows[r.SettingKey] = r.SettingValue; }); } catch (e) { /* before setup */ }
  const out = {};
  Object.keys(defs).forEach(function (k) { out[k] = parseSettingValue(defs[k], rows[k]); });
  SETTINGS_MEMO = out;
  return out;
}

function publicSettings() {
  const defs = settingDefs(), s = getSettingsMap(), out = {};
  Object.keys(defs).forEach(function (k) { if (defs[k].pub) out[k] = s[k]; });
  return out;
}

/** Validates one setting value; returns the normalised value or throws. */
function validateSetting(key, def, v) {
  const fail = function (msg) { throw appError('VALIDATION', msg, { fieldErrors: (function () { const e = {}; e[key] = msg; return e; })() }); };
  switch (def.type) {
    case 'string': { const s = cleanText(v, 120); if (!s) fail('This field is required.'); return s; }
    case 'time': if (!isValidTime(v)) fail('Use 24-hour HH:mm format.'); return String(v);
    case 'int': {
      const n = Number(v);
      if (!Number.isInteger(n) || n < def.min || n > def.max) fail('Enter a whole number between ' + def.min + ' and ' + def.max + '.');
      return n;
    }
    case 'bool': return bool(v);
    case 'timezone':
      try { Utilities.formatDate(new Date(), String(v), 'yyyy-MM-dd'); } catch (e) { fail('Unknown timezone.'); }
      if (!/^[A-Za-z_]+\/[A-Za-z_\/]+$|^UTC$/.test(String(v))) fail('Unknown timezone.');
      return String(v);
    case 'days': {
      if (!Array.isArray(v) || !v.length) fail('Choose at least one working day.');
      const days = uniq(v.map(String)).filter(function (d) { return DAY_KEYS.indexOf(d) >= 0; });
      if (!days.length) fail('Choose at least one working day.');
      return DAY_KEYS.filter(function (d) { return days.indexOf(d) >= 0; });
    }
    case 'holidays': {
      if (!Array.isArray(v)) fail('Holidays must be a list.');
      return v.map(function (h) {
        if (!h || !isValidDateStr(h.date)) fail('Every holiday needs a valid date.');
        return { date: h.date, name: cleanText(h.name, 80) || 'Holiday' };
      }).sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    }
    case 'list': {
      if (!Array.isArray(v)) fail('Must be a list.');
      const list = uniq(v.map(function (x) { return cleanText(x, 60); }).filter(Boolean));
      if (!list.length) fail('Add at least one item.');
      return list.slice(0, 50);
    }
    case 'weights': {
      const out = {};
      let total = 0;
      WEIGHT_KEYS.forEach(function (k) {
        const n = Number((v || {})[k]);
        if (!(n >= 0 && n <= 100)) fail('Each weight must be between 0 and 100.');
        out[k] = n; total += n;
      });
      if (Math.abs(total - 100) > 0.01) fail('Weights must add up to 100 (currently ' + total + ').');
      return out;
    }
    case 'channels': {
      if (!Array.isArray(v)) fail('Channels must be a list.');
      return v.filter(function (c) { return NOTIFY_CHANNEL_KEYS.indexOf(c) >= 0; });
    }
    case 'events': {
      const out = {};
      NOTIFY_EVENT_KEYS.forEach(function (k) { out[k] = bool((v || {})[k]); });
      return out;
    }
    case 'color':
      if (!/^#[0-9A-Fa-f]{6}$/.test(String(v))) fail('Use a hex colour like #1B4F8A.');
      return String(v).toUpperCase();
    default: return cleanText(v, 500);
  }
}

// ---------------- API ----------------

function apiGetSettings(p, user) {
  if (user.role !== 'ADMIN') return { settings: publicSettings() };
  const props = PropertiesService.getScriptProperties();
  const mask = function (v) { return v ? '••••' + String(v).slice(-6) : ''; };
  const defs = settingDefs();
  return {
    settings: getSettingsMap(),
    descriptions: Object.keys(defs).reduce(function (m, k) { m[k] = defs[k].desc; return m; }, {}),
    secrets: {
      chatWebhook: mask(props.getProperty('NOTIFY_CHAT_WEBHOOK')),
      genericWebhook: mask(props.getProperty('NOTIFY_GENERIC_WEBHOOK'))
    },
    triggersInstalled: ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'runScheduledJobs'; })
  };
}

function apiSaveSettings(p, user) {
  const incoming = p.settings || {};
  const defs = settingDefs();
  const current = getSettingsMap();
  const changes = {};
  Object.keys(incoming).forEach(function (k) {
    if (!defs[k]) return;
    const val = validateSetting(k, defs[k], incoming[k]);
    if (JSON.stringify(val) !== JSON.stringify(current[k])) changes[k] = val;
  });
  if (changes.REPORT_DEADLINE || changes.OFFICE_START_TIME || changes.OFFICE_END_TIME) {
    const start = changes.OFFICE_START_TIME || current.OFFICE_START_TIME;
    const end = changes.OFFICE_END_TIME || current.OFFICE_END_TIME;
    assert(timeToMin(end) > timeToMin(start), 'VALIDATION', 'Office end time must be after the start time.', { fieldErrors: { OFFICE_END_TIME: 'Must be after the start time.' } });
  }

  const secrets = p.secrets || {};
  const props = PropertiesService.getScriptProperties();
  const secretChanges = [];
  [['chatWebhook', 'NOTIFY_CHAT_WEBHOOK', /^https:\/\/chat\.googleapis\.com\//], ['genericWebhook', 'NOTIFY_GENERIC_WEBHOOK', /^https:\/\//]]
    .forEach(function (s) {
      const v = secrets[s[0]];
      if (v === undefined || v === null || v === '') return;
      if (v === '__CLEAR__') { props.deleteProperty(s[1]); secretChanges.push(s[1] + ' cleared'); return; }
      assert(s[2].test(String(v)), 'VALIDATION', 'Webhook URL is not valid.', { fieldErrors: (function () { const e = {}; e[s[0]] = 'Enter a valid https URL.'; return e; })() });
      props.setProperty(s[1], String(v).trim());
      secretChanges.push(s[1] + ' updated');
    });

  if (Object.keys(changes).length) {
    Db.withLock(function () {
      const rows = indexBy(Db.readAll('Settings'), 'SettingKey');
      const now = nowIso(), ins = [], upd = [];
      Object.keys(changes).forEach(function (k) {
        const stored = typeof changes[k] === 'object' ? JSON.stringify(changes[k]) : String(changes[k]);
        if (rows[k]) { rows[k].SettingValue = stored; rows[k].UpdatedAt = now; upd.push(rows[k]); }
        else ins.push({ SettingKey: k, SettingValue: stored, Description: defs[k].desc, UpdatedAt: now });
      });
      Db.update('Settings', upd);
      Db.insert('Settings', ins);
    });
    const old = {};
    Object.keys(changes).forEach(function (k) { old[k] = current[k]; });
    audit(user, 'SETTINGS_CHANGED', 'Settings', 'SYSTEM', old, changes);
    SETTINGS_MEMO = null;
  }
  if (secretChanges.length) audit(user, 'SECRETS_CHANGED', 'Settings', 'SYSTEM', '', secretChanges);
  return { saved: Object.keys(changes).length + secretChanges.length, settings: getSettingsMap() };
}

// ---------------- Calendar helpers ----------------

function workingDayInfo(date, s) {
  if ((s.WORKING_DAYS || []).indexOf(dayCode(date)) < 0) return { working: false, reason: 'Weekly off' };
  const hol = (s.HOLIDAYS || []).filter(function (h) { return h.date === date; })[0];
  if (hol) return { working: false, reason: hol.name || 'Holiday' };
  return { working: true, reason: '' };
}

function nextWorkingDay(date, s) {
  let d = addDays(date, 1);
  for (let i = 0; i < 21; i++) { if (workingDayInfo(d, s).working) return d; d = addDays(d, 1); }
  return addDays(date, 1);
}

function reportDeadline(date, s) {
  const deadline = Utilities.parseDate(date + ' ' + s.REPORT_DEADLINE, s.TIMEZONE, 'yyyy-MM-dd HH:mm');
  const graceEnd = new Date(deadline.getTime() + num(s.GRACE_PERIOD_MINUTES) * 60000);
  return { deadline: deadline.toISOString(), graceEnd: graceEnd.toISOString(), graceMinutes: num(s.GRACE_PERIOD_MINUTES), time: s.REPORT_DEADLINE };
}
