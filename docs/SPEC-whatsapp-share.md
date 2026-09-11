# Mandatory feature: Send daily report on WhatsApp

Add this section to the main development prompt. It is a required feature, not an optional enhancement.

---

## WHATSAPP REPORT SHARING (MANDATORY)

After an employee completes and submits the daily work report, the system must let the employee share the complete submitted report on WhatsApp through a manual, employee-controlled workflow.

### Workflow

1. The employee completes the entire daily work report and submits it successfully.
2. A **"Send on WhatsApp"** button becomes visible.
3. Clicking the button generates a properly formatted WhatsApp message containing all submitted work.
4. WhatsApp opens with the message pre-filled.
5. The employee selects the required WhatsApp contact or group.
6. The employee manually presses Send in WhatsApp.
7. The system does not send anything automatically.

### Where the button appears

- On the submission receipt shown immediately after a successful submit.
- On today's report screen once that report is submitted.
- On the employee's own report detail page for every submitted or late report.

The button must not appear for draft, not-started or reopened reports, or on reports that belong to someone else (including when a manager or admin views an employee's report).

### Message content

The message must be built from the report as saved on the server (not from unsaved form data) and use WhatsApp formatting (`*bold*`, `_italic_`). It must include:

- Company name and a "daily work report" title.
- Employee name, designation and department.
- Report date, submission date and time, and whether it was on time or submitted after the deadline.
- Report ID.
- Task summary: completed count, total tasks and total time recorded.
- Every task grouped by status (Completed, In progress, Pending, Blocked, Carried forward), each with title, high/urgent priority, related customer, order, tender or other reference, time spent, details and remarks (shown as "Blocked by" for blocked tasks). Cancelled tasks are excluded.
- Every answered question, grouped by report section in form order: work summary, completed work, pending work, carry forward, department KPIs (as "Question: value", with ₹ formatting for amounts), blockers and issues, follow-ups, meetings and calls, tomorrow's plan, notes. Unanswered questions are omitted.
- A closing line identifying the tracker.
- No placeholder or empty values such as "undefined", "null" or blank labels.

### Opening WhatsApp

- Use WhatsApp's public click-to-chat link `https://wa.me/?text=<URL-encoded message>` with no phone number, so WhatsApp asks the employee to choose the contact or group.
- On phones this opens the WhatsApp app; on computers it opens WhatsApp Desktop or WhatsApp Web.
- Open WhatsApp directly from the button click (so browsers do not block it) by preparing the message in advance.
- Also show a dialog containing the full message, a **Copy message** button and an **Open WhatsApp again** link, with the instruction to choose the contact and press Send, for devices where WhatsApp does not open or the message is too long.

### Restrictions

- No WhatsApp Business API, gateway, webhook, stored phone number, API key or third-party service is used for this feature.
- No server request is made when the button is used; the system never sends, schedules, reads or confirms WhatsApp messages.
- This feature is separate from, and must not be confused with, the admin-controlled automatic notifications (email, Google Chat, webhook).

### Acceptance criteria

1. Submitting a report shows "Send on WhatsApp" on the receipt; clicking it opens `https://wa.me/?text=…` exactly once.
2. The decoded message contains the Report ID, every non-cancelled task title with its reference, all answered questions and tomorrow's plan, and contains no "undefined", "null" or "[object".
3. No API/network request to the backend is made when the button is clicked.
4. The dialog's "Open WhatsApp again" link opens the same URL, and "Copy message" copies the same text.
5. The button is absent on drafts, reopened reports and on another person's report viewed by a manager or admin.
6. The button works on phone and desktop layouts without console errors.
