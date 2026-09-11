/**
 * "Send on WhatsApp" for submitted daily reports.
 *
 * Workflow (mandatory feature):
 *  1. The employee completes and submits the daily report.
 *  2. A "Send on WhatsApp" button appears (receipt, today's submitted report, and the employee's own report detail).
 *  3. Clicking it builds a formatted WhatsApp message from the report exactly as saved on the server.
 *  4. WhatsApp opens (app on phones, WhatsApp Web or Desktop on computers) with the message pre-filled.
 *  5. The employee chooses the contact or group, and 6. presses Send in WhatsApp.
 *  7. The tracker never sends anything by itself: there is no server call, API or automation involved.
 */
import { html, setHTML, icon, raw, openModal, toast, fmtDate, fmtDateTime, fmtMinutes, fmtNum, titleCase } from './app.js';
import { SECTION_LABELS } from './question-controls.js';

const SECTION_ORDER = ['WORK_SUMMARY', 'COMPLETED', 'PENDING', 'CARRY_FORWARD', 'KPI', 'BLOCKERS', 'FOLLOWUPS', 'MEETINGS', 'TOMORROW_PLAN', 'NOTES'];
const TASK_GROUPS = [['COMPLETED', 'Completed'], ['IN PROGRESS', 'In progress'], ['PENDING', 'Pending'], ['BLOCKED', 'Blocked'], ['CARRIED FORWARD', 'Carried forward']];
const WA_ICON = raw('<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M4.5 19.5l1.2-3.6A8 8 0 1 1 8.4 18.6z"/><path d="M9 10.5h6M9 13.5h4"/></svg>');

/** Only the employee who owns a submitted (or late) report can share it. */
export function canShareOnWhatsApp(report, user) {
  return !!report && !!user && report.employeeId === user.id && (report.status === 'SUBMITTED' || report.status === 'LATE');
}

function isEmptyAnswer(a) {
  return a === '' || a === null || a === undefined || (Array.isArray(a) && a.length === 0);
}

function formatAnswer(r) {
  const a = r.answer;
  if (Array.isArray(a)) return a.join(', ');
  if ((r.type === 'NUMBER' || r.type === 'DECIMAL') && /₹/.test(r.text)) return '₹' + fmtNum(a, 2);
  if (r.type === 'NUMBER' || r.type === 'DECIMAL') return fmtNum(a, 2);
  if (r.type === 'DATE') return fmtDate(String(a));
  return String(a).trim();
}

function questionLine(r) {
  const text = String(r.text || '').trim();
  return '• ' + text + (/[?:]$/.test(text) ? ' ' : ': ') + formatAnswer(r);
}

/**
 * Builds the WhatsApp message from a report detail (the getReport API response).
 * WhatsApp formatting: *bold*, _italic_.
 */
export function buildWhatsAppMessage(d, companyName) {
  const r = d.report;
  const company = companyName || 'Oakcraft';
  const lines = [];
  lines.push('*' + company + ': daily work report*');
  lines.push('*' + d.employee.name + '*' + (d.employee.designation ? ', ' + d.employee.designation : '') + ', ' + titleCase(d.department.name));
  lines.push('Date: ' + fmtDate(r.date));
  lines.push('Submitted: ' + fmtDateTime(r.submittedAt) + (r.late ? ' (after the deadline)' : ' (on time)'));
  lines.push('Report ID: ' + r.reportId);

  const tasks = (d.tasks || []).filter((t) => t.status !== 'CANCELLED');
  lines.push('');
  lines.push('*Tasks: ' + r.taskCompleted + ' of ' + r.taskTotal + ' completed' + (r.workMinutes ? ', ' + fmtMinutes(r.workMinutes) + ' recorded' : '') + '*');
  if (!tasks.length) lines.push('No tasks recorded.');
  TASK_GROUPS.forEach(([status, label]) => {
    const group = tasks.filter((t) => t.status === status);
    if (!group.length) return;
    lines.push('_' + label + '_');
    group.forEach((t) => {
      const bits = [];
      if (t.priority === 'HIGH' || t.priority === 'URGENT') bits.push(titleCase(t.priority) + ' priority');
      if (t.relatedEntity) bits.push((t.relatedType ? titleCase(t.relatedType) + ': ' : '') + t.relatedEntity);
      if (t.duration) bits.push(fmtMinutes(t.duration));
      lines.push('• ' + (t.title || 'Untitled task') + (bits.length ? ' (' + bits.join(', ') + ')' : ''));
      if (t.description) lines.push('   ' + t.description.replace(/\s*\n\s*/g, ' '));
      if (t.remarks) lines.push('   ' + (status === 'BLOCKED' ? 'Blocked by: ' : 'Remarks: ') + t.remarks.replace(/\s*\n\s*/g, ' '));
    });
  });

  const answered = (d.responses || []).filter((x) => !isEmptyAnswer(x.answer));
  const sections = SECTION_ORDER.concat(answered.map((x) => x.section).filter((s) => SECTION_ORDER.indexOf(s) < 0));
  const seen = {};
  sections.forEach((section) => {
    if (seen[section]) return;
    seen[section] = true;
    const items = answered.filter((x) => x.section === section);
    if (!items.length) return;
    const label = section === 'KPI' ? titleCase(d.department.name) + ' numbers' : (SECTION_LABELS[section] || titleCase(section));
    lines.push('');
    lines.push('*' + label + '*');
    items.forEach((x) => {
      if (x.type === 'LONG_TEXT') {
        if (items.length > 1) lines.push('_' + String(x.text).trim() + '_');
        lines.push(formatAnswer(x));
      } else {
        lines.push(questionLine(x));
      }
    });
  });

  lines.push('');
  lines.push('Sent from the ' + company + ' Daily Working Tracker');
  return lines.join('\n').replace(/\n{3,}/g, '\n\n');
}

/** wa.me with only a text parameter lets the person choose the contact or group inside WhatsApp. */
export function whatsAppUrl(message) {
  return 'https://wa.me/?text=' + encodeURIComponent(message);
}

export function whatsAppButtonHtml(extraClass) {
  return html`<button class="btn whatsapp ${extraClass || ''}" type="button" data-whatsapp disabled aria-busy="true">${WA_ICON}Preparing WhatsApp message</button>`;
}

function shareDialog(message, opened) {
  const url = whatsAppUrl(message);
  const m = openModal({
    title: 'Send your report on WhatsApp',
    wide: true,
    body: html`<div class="stack">
      <p>${opened
        ? 'WhatsApp is opening with your report filled in. Choose the contact or group, check the message, then press Send in WhatsApp.'
        : 'Press Open WhatsApp, choose the contact or group, check the message, then press Send in WhatsApp.'}</p>
      <p class="small muted">The tracker never sends WhatsApp messages by itself. Nothing is sent until you press Send in WhatsApp.</p>
      <div class="field"><label for="wa-message">Message</label>
        <textarea class="textarea" id="wa-message" rows="14" readonly>${message}</textarea>
        <span class="hint">If WhatsApp did not open, copy the message and paste it into the chat.</span></div>
    </div>`,
    footer: html`<button class="btn" type="button" data-close>Close</button>
      <button class="btn" type="button" data-copy>${icon('copy')}Copy message</button>
      <a class="btn whatsapp" href="${url}" target="_blank" rel="noopener noreferrer" data-open>${WA_ICON}${opened ? 'Open WhatsApp again' : 'Open WhatsApp'}</a>`,
    initialFocus: opened ? '[data-close]' : '[data-open]'
  });
  m.el.querySelector('[data-copy]').onclick = async () => {
    const box = m.el.querySelector('#wa-message');
    try { await navigator.clipboard.writeText(message); toast('Message copied. Paste it into WhatsApp.'); }
    catch (e) { box.focus(); box.select(); toast('Press Ctrl+C (or long-press and Copy) to copy the selected message.', 'info'); }
  };
  return m;
}

/** Opens WhatsApp with the message. Must run inside the click handler so browsers allow the new tab. */
export function openWhatsApp(message) {
  const w = window.open(whatsAppUrl(message), '_blank');
  if (w) { try { w.opener = null; } catch (e) { /* cross-origin */ } }
  shareDialog(message, !!w);
}

/**
 * Wires a "Send on WhatsApp" button. `load` returns (a promise of) the getReport response.
 * The message is prepared in advance so the click can open WhatsApp immediately.
 */
export function bindWhatsAppButton(btn, load, companyName) {
  if (!btn) return;
  let message = null;
  const setReady = () => { btn.disabled = false; btn.removeAttribute('aria-busy'); setHTML(btn, html`${WA_ICON}Send on WhatsApp`); };
  const prepare = () => Promise.resolve().then(load).then((d) => { message = buildWhatsAppMessage(d, companyName); setReady(); return message; });
  prepare().catch(() => {
    btn.disabled = false; btn.removeAttribute('aria-busy');
    setHTML(btn, html`${WA_ICON}Send on WhatsApp`);
  });
  btn.onclick = async () => {
    if (message) { openWhatsApp(message); return; }
    btn.disabled = true; btn.setAttribute('aria-busy', 'true');
    try { shareDialog(await prepare(), false); }
    catch (e) { setReady(); toast('The report could not be loaded for WhatsApp. Check your connection and try again.', 'bad'); }
  };
}
