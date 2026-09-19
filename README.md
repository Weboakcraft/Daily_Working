# Oakcraft Daily Working Tracker

An internal daily reporting system for Oakcraft. Every employee records what they worked on, their department's numbers, blockers and tomorrow's plan in one short report. Managers see who has reported, what moved and what is stuck, and follow issues through to resolution.

It runs entirely on free services: the website is hosted on **GitHub Pages**, the server is a **Google Apps Script** Web App, and the data lives in a **Google Sheet** that only your Google account can open.

Deployment steps for non-developers are in **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)**. Design decisions are recorded in [docs/design-notes.md](docs/design-notes.md).

---

## 1. What it does

**For employees (phone-first)**
- A step-by-step daily report: unfinished work from earlier days, today's tasks, work summary, department numbers, issues and follow-ups, tomorrow's plan, then a review screen.
- Drafts save automatically every few seconds. If the connection drops, answers are kept on the device and offered back when the page is reopened.
- Submitting gives a receipt with a Report ID. Pressing Submit twice, or a retry on a flaky network, never creates a second report.
The reporting window closes at **21:15** (9:15 PM). The form counts down to it, saves what is pending a few seconds before, and then closes itself — and the server refuses anything that arrives afterwards, so the two can never disagree. A report that missed the window needs an admin to reopen it. The time, the grace period and whether the window closes at all are all in Settings → Reporting; see "Reporting window" below.
- **Send on WhatsApp:** after submitting, the employee can share the full report on WhatsApp in a ready-formatted message. WhatsApp opens with the message filled in; the employee chooses the contact or group and presses Send. The tracker never sends anything by itself (see section 11a).
- Unfinished tasks are offered the next day: continue them, mark them done, or cancel them.
- A home screen with today's status, this month's numbers, open follow-ups and an eight-week trend, plus personal analytics and report history.

**For managers**
- An overview that answers "who has reported?" in one sentence, a day ledger (people × days grid) showing gaps at a glance, and charts for submissions, task status, department output, monthly completion, workload and late submissions.
- A daily management summary with a "Copy as text" button for WhatsApp or email.
- Department analytics with KPI totals against targets, daily/weekly/monthly trends and an employee comparison table.
- Report detail with review comments, review status and follow-ups with an owner and due date.
- Automatic insights: lowest and highest reporting departments, repeated unfinished work, recurring blockers, rising workloads, frequent late submissions, repeatedly carried tasks and notable KPI changes.

**For admins**
- Employee master (add, edit, deactivate, reset password, CSV import and export) and department master.
- A visual question builder for common and per-department questions with 12 answer types, validation rules, daily targets, default answers and show-only-when conditions, with a live preview and a full form preview.
- Settings for the reporting deadline, grace period, working days, holidays, task categories, productivity score weights, sign-in rules, branding and notifications.
- Reopen submitted reports with a reason, an audit log of every change and a system error log.
- Exports to Excel, CSV and PDF (print) that respect each user's permissions.

## 2. Roles and permissions

Permissions are enforced by the server on every request; hiding a button in the browser is never the only protection.

| | Employee | Manager | Admin |
|---|---|---|---|
| Submit own daily report, see own history and analytics | Yes | Yes | Yes |
| See reports, tasks and analytics of others | No | Own department(s) and direct reports | Everyone |
| Review reports, add remarks, create follow-ups | No | Yes (not own report) | Yes |
| Update a follow-up assigned to them | Status and resolution | Yes | Yes |
| Overview, daily summary, department analytics, exports | No | Scoped to their team | Everyone |
| Reopen a submitted report | No | No | Yes |
| Employees, departments, questions, settings, audit log | No | Read-only team list | Yes |

A manager's scope is: departments where they are set as manager, plus employees whose "Reports to" is them.

## 3. Architecture

```
Browser (GitHub Pages)                Google Apps Script Web App              Google Sheet
HTML + CSS + JavaScript modules  ──►  doPost(action, token, payload)   ──►  13 tabs, one per table
  js/api.js: one POST endpoint         Main.gs router, role checks            (Employees, Reports, Tasks,
  text/plain body (no CORS preflight)  Auth.gs sessions and hashing            Responses, Questions, ...)
  requestId for safe retries           Db.gs batched reads/writes, locking
```

- No passwords, keys or spreadsheet IDs are in the website. `js/config.js` holds only the public Web App URL; every request carries a session token that the server checks.
- The Web App runs as the account that deployed it, so employees never need access to the Sheet.
- All values are stored as plain text in the Sheet (dates as `yyyy-MM-dd` in company time, timestamps as ISO UTC) so Sheets never reformats them.

## 4. Technology

- **Frontend:** plain HTML5, CSS3 and JavaScript ES modules. No build step and no framework. Charts are drawn with built-in SVG code. The IBM Plex typeface is included under the SIL Open Font License (`assets/fonts/OFL-LICENSE.txt`).
- **Excel export** loads SheetJS from cdnjs only when someone exports; if it cannot load, a CSV is downloaded instead.
- **Backend:** Google Apps Script (V8 runtime), SpreadsheetApp, CacheService, LockService, PropertiesService, MailApp, UrlFetchApp and time-based triggers.
- **Testing (development only):** Node.js, a local Apps Script simulator, and Playwright for browser tests.

## 5. Folder structure

```
index.html            Redirects to the right home page for the signed-in user
login.html            Sign in and first-login password change
employee.html         Home, today's report, my reports, my analytics, profile
reports.html          Reports list and detail, tasks, follow-ups
dashboard.html        Overview, daily summary, department analytics
admin.html            Employees, departments, report questions, settings, audit log
css/style.css         Design tokens, layout shell and shared components
css/dashboard.css     Charts, day ledger, report form, question builder, settings
css/responsive.css    Tablet and phone layouts
js/config.js          The Web App URL (the only file you edit to deploy)
js/api.js             API client with retries and duplicate protection
js/auth.js            Sign-in session helpers
js/app.js             Safe templating, components, formatting, app shell and router
js/charts.js          SVG charts
js/login.js           Login page
js/report-form.js     Daily report form (steps, auto-save, offline backup, submit)
js/report-form-tasks.js  Task editor inside the report form
js/question-controls.js  Renders and validates the 12 question types
js/analytics.js       Employee home, employee analytics, productivity score, profile
js/dashboard.js       Overview, daily summary, department analytics
js/reports.js         Reports list, report detail, tasks, follow-ups
js/employees.js       Employee and department masters, CSV import
js/questions.js       Question builder
js/admin.js           Settings, audit and error logs
js/export.js          Excel, CSV and PDF exports
js/whatsapp.js        Send on WhatsApp: message builder and share dialog
assets/               Logo, favicon and fonts
backend-apps-script/  The 15 Apps Script files (copy these into Apps Script)
docs/                 Deployment guide and design notes
tests/                Simulator, automated tests and local preview server (not deployed)
tools/preview/        Builds the single-file offline preview (not deployed)
```

## 6. Setup and deployment (summary)

1. Create a Google Sheet, open **Extensions → Apps Script**, and add the 15 files from `backend-apps-script/` in the listed order.
2. Run `setupOakcraftSystem` once and note the admin username and temporary password it prints.
3. Deploy as a Web App (**Execute as: Me**, **Who has access: Anyone**) and copy the `/exec` URL.
4. Paste the URL into `js/config.js`, push the repository to GitHub and turn on GitHub Pages.
5. Sign in as the admin, change the password, then add departments' managers, employees and holidays.

Full, click-by-click instructions: **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)**.

## 7. Demo data

Demo data is for trying the system; never load it into the live database.

- Load: in the Sheet, **Oakcraft → Load demo data** (or run `seedDemoData`). It creates 25 people across all 8 departments with about 45 days of reports, tasks, answers, reviews and follow-ups.
- Every demo record has `IsDemo = TRUE`. All demo logins use the password `Demo@1234`, for example `demo.admin` (admin), `demo.anil` (sales manager) and `demo.priya` (sales executive).
- Remove: **Oakcraft → Remove demo data** (or run `removeDemoData`). Only rows marked as demo are deleted.

## 8. Google Sheet structure

The first column of every tab is its ID. Extra columns you add by hand are preserved. Running setup again adds any missing columns without touching data.

| Tab | Purpose | Key columns |
|---|---|---|
| Employees | People and their access | EmployeeID, EmployeeName, DepartmentID, Designation, Role, ManagerID, Email, Mobile, JoiningDate, EmploymentStatus, Username, Status, ReportRequired, IsDemo |
| Credentials | Password hashes (never sent to browsers) | EmployeeID, Username, PasswordHash, Salt, MustChange |
| Sessions | Active sign-ins (only a hash of each token) | SessionID, TokenHash, EmployeeID, ExpiresAt, Revoked |
| Departments | Department master | DepartmentID, DepartmentName, ManagerID, Status |
| Questions | Report questions (common = `ALL`) | QuestionID, DepartmentID, QuestionKey, Section, QuestionText, QuestionType, Required, Options, DisplayOrder, Validation, HelpText, DefaultValue, ShowIf, Status |
| Reports | One row per employee per day | ReportID, UniqueKey, EmployeeID, DepartmentID, ReportDate, Status, SubmittedAt, FirstSubmittedAt, LateFlag, ReviewStatus, task totals, WorkMinutes, HasBlocker |
| Tasks | Tasks inside reports | TaskID, ReportID, TaskTitle, Category, StartTime, EndTime, Duration, Priority, Status, RelatedType, RelatedEntity, SourceTaskID, CarriedToTaskID, CarryCount, Deleted |
| Responses | Answers to questions | ResponseID, ReportID, QuestionID, QuestionText (as asked), Answer |
| Remarks | Manager reviews | RemarkID, ReportID, AuthorID, Comment, FollowUpRequired, ReviewStatus |
| FollowUps | Items that need action | FollowUpID, ReportID, TaskID, EmployeeID, OwnerID, Title, Priority, DueDate, Status, Source, Resolution |
| Settings | System settings | SettingKey, SettingValue |
| AuditLog | Who changed what | LogID, UserID, Action, Entity, EntityID, OldValue, NewValue, Timestamp |
| ErrorLog | Unexpected server errors | ErrorID, Timestamp, UserID, Action, Message, Stack |

Do not rename or delete the built-in columns. Do not edit Credentials or Sessions by hand; use the app to reset passwords. The app keeps a cached copy of Employees, Departments, Questions and Settings for speed; after editing those tabs directly in the Sheet, click **Oakcraft → Apply manual edits to the app now** (otherwise the change shows up within 30 minutes).

**Reporting window.** Three settings decide it, and they only make sense together:

| Setting | Live value | What it does |
| --- | --- | --- |
| `REPORT_DEADLINE` | `21:15` | The time reports are due, in the company timezone. |
| `GRACE_PERIOD_MINUTES` | `0` | Minutes after the deadline in which a report is still accepted, marked LATE. At 0 there is no such window. |
| `LOCK_AFTER_DEADLINE` | `TRUE` | Whether the deadline actually shuts. At TRUE nothing is accepted after deadline + grace. |

With grace at 0 and the lock on, 21:15 is a hard stop: nothing is ever marked LATE, because a late report cannot be created. Turn the lock off, or give it a grace period, and LATE comes back.

Changing a default in the code does not move a Sheet that is already set up — the stored value wins. `setupOakcraftSystem` applies each shipped change once (it records which, so an admin's later edit is never overwritten), and **Oakcraft → Apply the reporting deadline to this Sheet** forces the current window on demand.

**Report statuses:** NOT STARTED (no row yet), DRAFT, SUBMITTED, LATE (first submitted after deadline plus grace), REOPENED.
**Task statuses:** COMPLETED, IN PROGRESS, PENDING, BLOCKED, CARRIED FORWARD, CANCELLED. **Priorities:** LOW, MEDIUM, HIGH, URGENT.

## 9. API reference

Every call is an HTTP POST to the Web App URL with a JSON body sent as `text/plain`:

```json
{ "action": "getReports", "token": "<session token>", "payload": { "filters": { "from": "2026-09-01", "to": "2026-09-10" } }, "requestId": "optional-uuid-for-writes" }
```

Responses are `{ "ok": true, "data": ... }` or `{ "ok": false, "error": { "code", "message", "fieldErrors"?, "errorId"? } }`. A `GET` to the URL returns a health check.

| Area | Actions (minimum role) |
|---|---|
| Sign-in | `login` (public), `logout`, `me`, `changePassword` |
| Employees | `getEmployees`, `getEmployeeDirectory` (manager), `getEmployee`, `saveEmployee`, `updateEmployee`, `setEmployeeStatus`, `resetPassword`, `importEmployees` (admin) |
| Departments and questions | `getDepartments`, `getQuestions`, `saveDepartment`, `saveQuestion`, `updateQuestion`, `reorderQuestions` (admin) |
| Reports and tasks | `getTodayReport`, `saveDraft`, `submitReport`, `getReport`, `getReports`, `getTasks`, `saveTask`, `updateTask`, `saveManagerRemark` (manager), `reopenReport` (admin) |
| Follow-ups | `getFollowUps`, `saveFollowUp` |
| Analytics and search | `getMyDashboard`, `getEmployeeAnalytics`, `search`, `getDashboardData`, `getDepartmentAnalytics` (manager) |
| Exports, settings, logs | `exportReport` (manager), `getSettings`, `saveSettings`, `getAuditLogs`, `getErrorLogs`, `installTriggers`, `sendTestNotification` (admin) |

Common error codes: `UNAUTHORIZED`, `PASSWORD_CHANGE_REQUIRED`, `FORBIDDEN`, `VALIDATION`, `NOT_FOUND`, `REPORT_LOCKED`, `LOCKED`, `RATE_LIMITED`, `BUSY`, `SETUP_REQUIRED`, `SERVER_ERROR`.

## 10. Productivity score

The score is shown with its full breakdown so nobody has to guess how it was calculated. It is a conversation aid, not a sole basis for decisions. Weights are set in **Settings → Productivity score** and must add up to 100 (defaults in brackets).

- **Report consistency (15):** submitted reports as a share of expected reports.
- **Task completion (25):** completed tasks as a share of all tasks (cancelled tasks excluded).
- **Department KPI (25):** for number questions with a daily target, progress toward the target (capped at 100%); other department questions count as answered or not.
- **Timeliness (15):** submitted reports that were on time.
- **Work planning (10):** submitted reports that include tomorrow's plan.
- **Blocker resolution (10):** follow-ups from the person's reports that were resolved or closed.

When a part has no data (for example, no follow-ups were raised), it is marked "not counted" and its weight is shared among the others.

## 11. Notifications

Nothing is sent until an admin switches notifications on in **Settings → Notifications**.

- **Channels:** email through the deploying Google account (free daily quota applies), a Google Chat space webhook, or a custom webhook for a service you already use, such as a WhatsApp gateway. Webhook URLs are stored in Script Properties and never shown in full.
- **Events:** reminder before the deadline, missing-report summary to managers after the grace period, late submission, follow-up assigned, blocker or urgent blocked task.
- Scheduled reminders need the 15-minute trigger: **Settings → Install scheduled reminders** (or **Oakcraft → Install scheduled jobs** in the Sheet). The same job removes expired sessions.

## 11a. Send on WhatsApp (employee sharing)

This is a standard feature of the daily report and is separate from the automatic notifications above.

1. The employee completes and submits the daily report.
2. A **Send on WhatsApp** button appears on the submission receipt, on today's report once it is submitted, and on the employee's own report page. It is not shown for drafts, reopened reports or other people's reports.
3. Clicking it builds a WhatsApp-formatted message from the report as saved on the server: name, designation, department, date, submission time (on time or late), Report ID, tasks grouped by status with priority, customer or order reference, time spent and remarks, then every answered question grouped by report section, including department numbers, blockers, follow-ups and tomorrow's plan.
4. WhatsApp opens with the message pre-filled: the app on phones, WhatsApp Web or WhatsApp Desktop on computers. It uses WhatsApp's public `https://wa.me/?text=` link, so no WhatsApp account, API key or business number is configured in the tracker.
5. The employee picks the contact or group in WhatsApp.
6. The employee presses Send in WhatsApp.
7. The tracker makes no server call when sharing and cannot send, schedule or read WhatsApp messages. A dialog also shows the full message with **Copy message** and **Open WhatsApp again**, for devices where WhatsApp does not open.

## 12. Security

- Passwords are salted, peppered and hashed 400 times with SHA-256; the pepper lives in Script Properties, not the Sheet.
- Session tokens are random 64-character values; only their SHA-256 hash is stored. Sessions expire (12 hours by default) and are revoked on sign-out, password change, password reset and deactivation.
- Repeated failed sign-ins lock the username for 15 minutes; requests are rate-limited per user.
- Every action checks role and data scope on the server. Inactive employees are rejected on every request.
- Text is cleaned and length-limited; values starting with `=`, `+`, `-` or `@` are stored as text so the Sheet never runs them as formulas. CSV exports are protected the same way.
- The frontend escapes all data before displaying it.
- Unexpected errors show a reference ID to users; details go only to the Error log (and to admins).
- Every change to employees, departments, questions, settings, reports, remarks, follow-ups, exports and sign-ins is written to the Audit log with the before and after values (secrets removed).

## 13. Testing

The `tests/` folder is development tooling and is not deployed. It needs Node.js 18 or newer; browser tests also need Playwright (`npm install -g playwright && npx playwright install chromium`).

```bash
node tests/backend.test.js    # 46 backend tests: the real .gs files run in a Google Apps Script simulator
node tests/check-imports.js   # every module import and API action name resolves
node tests/dev-server.js      # local preview at http://localhost:8080 with the real backend and demo data
node tests/ui-smoke.js        # every page, three roles, desktop and phone (needs the preview server)
node tests/ui-flows.js        # end-to-end: submit on a phone, Send on WhatsApp, manager review, admin reopen/add employee/settings/export
```

**Offline preview file.** `tools/preview/` builds a single HTML file that runs the real frontend and the real backend code inside the browser with demo data (saved in that browser's local storage). It needs no Google account or server, so it is handy for showing the system to management before deploying. It is not the live system and must not hold real data.

```bash
npm install -g esbuild
NODE_PATH=$(npm root -g) node tools/preview/build-preview.js   # writes dist/oakcraft-tracker-preview.html
```

The simulator imitates Sheets, Cache, Lock and Properties closely, but it is not Google's service. After deploying, do the checks in the "Test the live system" section of the deployment guide.

## 14. Troubleshooting

| Symptom | Likely cause and fix |
|---|---|
| "Connect the tracker to its backend" page | `js/config.js` still has the placeholder URL. Paste the `/exec` URL and push. |
| "The server sent an unexpected response" | The Web App access is not "Anyone", or the URL is the `/dev` test URL. Redeploy with access "Anyone" and use `/exec`. |
| "The system is not ready yet" / `SETUP_REQUIRED` | Run `setupOakcraftSystem` again; it repairs missing sheets and columns. |
| Changes to `.gs` files have no effect | Apps Script serves the deployed version. Use **Deploy → Manage deployments → Edit → New version**; the URL stays the same. |
| Someone is locked out | Wait 15 minutes, or an admin resets their password from Employees. |
| A report was submitted with a mistake | An admin opens the report and chooses **Reopen** with a reason. |
| "Reporting for … closed at 21:15" | The window shut before the report was submitted. An admin opens the report and chooses Reopen with a reason; the window does not reopen by itself. |
| The deadline in the app is not 21:15 | The Sheet holds an older value. In the Sheet, choose Oakcraft → Apply the reporting deadline to this Sheet, or set it in Settings → Reporting. |
| "The system is busy" while saving | Every write queues on one lock. It should now be rare; if it happens daily, check the Error log for slow actions and see the note about the write queue under Known limits. |
| The app looks like an old version | The browser keeps a copy of the app, refreshed whenever `APP_VERSION` in `js/config.js` changes. Bump that value when you publish frontend changes. |
| Excel export downloads a CSV | The browser could not load the Excel helper from cdnjs (network or blocker). The CSV opens in Excel. |
| Reminders are not sent | Notifications switched off, no channel selected, triggers not installed, or the employee has no email address. Use **Send a test to me**. |
| An error shows "Reference: ERR-…" | Find that ID in **Audit log → System errors** for the technical details. |

## 15. Maintenance and customisation

- **Questions:** change them in **Report questions**. Retire rather than delete; past answers keep the question text as it was asked.
- **Departments:** add them in the app. A department can be deactivated only after its employees are moved.
- **Employees leaving:** deactivate them. Their history stays in all reports and analytics.
- **Branding:** company name, subtitle and colours are in Settings; replace `assets/logo-mark.svg` and `assets/favicon.svg` for your own logo.
- **Backups:** use **File → Version history** or **File → Make a copy** of the Sheet regularly, for example monthly.
- **Updating the backend:** paste changed `.gs` files, then publish a new version of the existing deployment and run `setupOakcraftSystem` once to add any new columns or settings.

## 16. Known limits

- Google Apps Script quotas apply (for example, script run time of 6 minutes per call and daily email limits). Normal daily use by around 100 people is well within them; very large exports over long periods can be slow.
- Requests take roughly 1–3 seconds because Apps Script starts per request; the app shows loading states and saves drafts in the background. The app itself is served from the browser's own cache after the first visit, so only the data waits on the network.
- Writes across the whole system queue on one Google Apps Script lock. Reads and validation happen before that lock is taken and only the writes hold it, and drafts save on a 20-second idle timer rather than on every keystroke, which is what makes a roomful of people reporting at the same time workable. It is still a single queue: if the team grows several times over, saving reports is the part that will need splitting up first.
- Google Sheets comfortably holds several years of reports for a team of this size. If the Sheet grows toward a few hundred thousand task rows, archive old years into a copy.
- PDF export uses the browser's print dialog ("Save as PDF").
