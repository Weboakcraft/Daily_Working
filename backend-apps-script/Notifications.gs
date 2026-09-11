/**
 * Notification architecture.
 *
 * Providers are modular: each exposes send(recipient, message). Built-in providers use only
 * free Google services (Gmail via MailApp, Google Chat incoming webhook) plus a generic webhook
 * that can forward to any approved messaging gateway — no paid
 * service is hard-coded. Add a provider by registering it in NotificationProviders.
 */

const NotificationProviders = {
  EMAIL: {
    label: 'Email (Gmail)',
    send: function (recipient, message) {
      if (!recipient || !recipient.email) return false;
      MailApp.sendEmail({ to: recipient.email, subject: message.subject, body: message.text, name: getSettingsMap().COMPANY_NAME + ' Tracker' });
      return true;
    }
  },
  GOOGLE_CHAT: {
    label: 'Google Chat space',
    send: function (recipient, message) {
      const url = PropertiesService.getScriptProperties().getProperty('NOTIFY_CHAT_WEBHOOK');
      if (!url) return false;
      UrlFetchApp.fetch(url, { method: 'post', contentType: 'application/json', payload: JSON.stringify({ text: '*' + message.subject + '*\n' + message.text }), muteHttpExceptions: true });
      return true;
    }
  },
  WEBHOOK: {
    label: 'Custom webhook',
    send: function (recipient, message) {
      const url = PropertiesService.getScriptProperties().getProperty('NOTIFY_GENERIC_WEBHOOK');
      if (!url) return false;
      UrlFetchApp.fetch(url, {
        method: 'post', contentType: 'application/json', muteHttpExceptions: true,
        payload: JSON.stringify({ event: message.event, subject: message.subject, text: message.text, recipient: recipient ? { name: recipient.name, email: recipient.email, mobile: recipient.mobile } : null })
      });
      return true;
    }
  }
};

const Notify = {
  /** Sends one event to one or more recipients over the enabled channels. */
  dispatch: function (event, ctx) {
    const s = getSettingsMap();
    if (!s.NOTIFICATIONS_ENABLED || !(s.NOTIFY_EVENTS || {})[event]) return 0;
    const built = Notify.build(event, ctx, s);
    if (!built) return 0;
    return Notify.deliver(built.recipients, built.message, s);
  },

  deliver: function (recipients, message, s) {
    let sent = 0;
    (s.NOTIFY_CHANNELS || []).forEach(function (ch) {
      const provider = NotificationProviders[ch];
      if (!provider) return;
      // Group channels (Chat / webhook) receive a single message; email goes per recipient.
      const targets = ch === 'EMAIL' ? recipients : [recipients[0] || null];
      targets.forEach(function (r) {
        try { if (provider.send(r, message)) sent++; } catch (e) { logError(e, 'notify:' + ch + ':' + message.event, null, { subject: message.subject }); }
      });
    });
    return sent;
  },

  build: function (event, ctx, s) {
    const emps = indexBy(Db.readAll('Employees'), 'EmployeeID');
    const person = function (id) { const e = emps[id]; return e ? { name: e.EmployeeName, email: e.Email, mobile: e.Mobile } : null; };
    const app = s.COMPANY_NAME + ' ' + s.APP_SUBTITLE;
    switch (event) {
      case 'REPORT_REMINDER':
        return { recipients: ctx.employees.map(function (e) { return person(e.EmployeeID); }).filter(Boolean),
          message: { event: event, subject: 'Reminder: submit your daily report', text: 'Please submit today\'s report before ' + s.REPORT_DEADLINE + '. — ' + app } };
      case 'MISSING_REPORT':
        return { recipients: [person(ctx.managerId)].filter(Boolean),
          message: { event: event, subject: ctx.missing.length + ' report(s) not submitted for ' + ctx.date,
            text: 'Not submitted yet:\n' + ctx.missing.map(function (e) { return '• ' + e.EmployeeName; }).join('\n') + '\n— ' + app } };
      case 'LATE_REPORT':
        return { recipients: [person(ctx.report.ManagerID)].filter(Boolean),
          message: { event: event, subject: 'Late report: ' + ctx.employee.EmployeeName, text: ctx.employee.EmployeeName + ' submitted the report for ' + humanDate(ctx.report.ReportDate) + ' after the deadline. Report ID: ' + ctx.report.ReportID } };
      case 'FOLLOWUP_ASSIGNED':
      case 'HIGH_PRIORITY_BLOCKER': {
        const f = ctx.followUp;
        return { recipients: [person(f.OwnerID)].filter(Boolean),
          message: { event: event, subject: (event === 'HIGH_PRIORITY_BLOCKER' ? 'High-priority blocker: ' : 'Follow-up assigned: ') + f.Title,
            text: (f.Description || '') + '\nPriority: ' + f.Priority + (f.DueDate ? '\nDue: ' + humanDate(f.DueDate) : '') + (f.ReportID ? '\nReport: ' + f.ReportID : '') } };
      }
    }
    return null;
  }
};

/**
 * Time-driven job (every 15 minutes). Sends the pre-deadline reminder and the missing-report
 * summary once per day each, and purges expired sessions nightly.
 */
function runScheduledJobs() {
  const s = getSettingsMap();
  const props = PropertiesService.getScriptProperties();
  const today = todayStr();
  const now = new Date();
  try { purgeExpiredSessions(props, today); } catch (e) { logError(e, 'job:purgeSessions'); }
  if (!s.NOTIFICATIONS_ENABLED || !workingDayInfo(today, s).working) return;
  const dl = reportDeadline(today, s);
  const deadline = new Date(dl.deadline), graceEnd = new Date(dl.graceEnd);
  const employees = Db.readAll('Employees').filter(function (e) { return e.Status === 'Active' && bool(e.ReportRequired) && (!e.JoiningDate || e.JoiningDate <= today); });
  const submitted = {};
  Db.rangeBy('Reports', 'ReportDate', today, today).forEach(function (r) { if (isSubmittedStatus(r.Status)) submitted[r.EmployeeID] = true; });
  const missing = employees.filter(function (e) { return !submitted[e.EmployeeID]; });

  const reminderAt = new Date(deadline.getTime() - s.REMINDER_MINUTES_BEFORE * 60000);
  if (s.NOTIFY_EVENTS.REPORT_REMINDER && now >= reminderAt && now < deadline && props.getProperty('JOB_REMINDER') !== today) {
    props.setProperty('JOB_REMINDER', today);
    if (missing.length) Notify.dispatch('REPORT_REMINDER', { employees: missing });
  }
  if (s.NOTIFY_EVENTS.MISSING_REPORT && now >= graceEnd && props.getProperty('JOB_MISSING') !== today) {
    props.setProperty('JOB_MISSING', today);
    const depts = indexBy(Db.readAll('Departments'), 'DepartmentID');
    const byManager = groupBy(missing, function (e) { return e.ManagerID || (depts[e.DepartmentID] ? depts[e.DepartmentID].ManagerID : '') || 'NONE'; });
    Object.keys(byManager).forEach(function (mid) {
      if (mid !== 'NONE') Notify.dispatch('MISSING_REPORT', { managerId: mid, missing: byManager[mid], date: today });
    });
  }
}

function purgeExpiredSessions(props, today) {
  if (props.getProperty('JOB_PURGE') === today) return;
  props.setProperty('JOB_PURGE', today);
  Db.withLock(function () {
    const cutoff = new Date(Date.now() - 7 * 86400000).toISOString();
    const old = Db.readAll('Sessions').filter(function (r) { return r.ExpiresAt < cutoff; });
    if (old.length) Db.removeRows('Sessions', old);
  });
}

/** Menu / editor helper. */
function installTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'runScheduledJobs') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('runScheduledJobs').timeBased().everyMinutes(15).create();
  return true;
}

function apiInstallTriggers(p, user) {
  installTriggers();
  audit(user, 'TRIGGERS_INSTALLED', 'Settings', 'SYSTEM', '', { handler: 'runScheduledJobs', everyMinutes: 15 });
  return { installed: true };
}

function apiSendTestNotification(p, user) {
  const s = getSettingsMap();
  const me = getEmployeeOrThrow(user.id);
  const channels = Array.isArray(p.channels) && p.channels.length ? p.channels : s.NOTIFY_CHANNELS;
  const results = channels.map(function (ch) {
    const provider = NotificationProviders[ch];
    if (!provider) return { channel: ch, ok: false, message: 'Unknown channel.' };
    try {
      const ok = provider.send({ name: me.EmployeeName, email: me.Email, mobile: me.Mobile }, { event: 'TEST', subject: 'Test notification', text: 'Notifications from ' + s.COMPANY_NAME + ' Daily Working Tracker are working.' });
      return { channel: ch, ok: ok, message: ok ? 'Sent.' : (ch === 'EMAIL' ? 'Add an email address to your profile first.' : 'Webhook URL is not configured.') };
    } catch (e) {
      return { channel: ch, ok: false, message: String(e.message || e).slice(0, 200) };
    }
  });
  audit(user, 'TEST_NOTIFICATION_SENT', 'Settings', 'SYSTEM', '', results);
  return { results: results };
}
