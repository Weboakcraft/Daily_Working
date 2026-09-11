# Deploying the Oakcraft Daily Working Tracker

This guide assumes no programming experience. Set aside about 45 minutes. You need:

- A Google account that will own the data (ideally a company account such as `admin@oakcraft.in`, not a personal one).
- A free GitHub account (github.com).
- The project files, unzipped on your computer.

The finished system has three parts:

1. **Google Sheet:** the database. Only the owner account opens it.
2. **Apps Script Web App:** the server that checks logins and permissions and reads and writes the Sheet.
3. **GitHub Pages website:** what employees open on their phones and computers.

---

## Part 1: Create the database and server (Google)

### 1.1 Create the Sheet

1. Go to **sheets.google.com** while signed in to the owner account.
2. Click **Blank spreadsheet**.
3. Click "Untitled spreadsheet" at the top left and rename it **Oakcraft Daily Working Tracker Database**.

### 1.2 Open Apps Script

1. In the Sheet menu, click **Extensions → Apps Script**. A new tab opens with a file called `Code.gs`.
2. Click "Untitled project" at the top and rename it **Oakcraft Tracker Backend**.

### 1.3 Set the project time zone and manifest

1. On the left, click the **gear icon (Project Settings)**.
2. Set **Time zone** to **(GMT+05:30) India Standard Time**.
3. Tick **Show "appsscript.json" manifest file in editor**.
4. Click the **< > (Editor)** icon on the left to return to the files.
5. Click `appsscript.json`, select all its text, delete it, and paste the contents of `backend-apps-script/appsscript.json` from the project folder. Press **Ctrl+S** (Cmd+S on Mac).

### 1.4 Add the 15 code files

The files must be added **in this order**, because Apps Script loads them top to bottom:

| # | File name to create | Copy contents from |
|---|---|---|
| 1 | Config | `backend-apps-script/Config.gs` |
| 2 | Utils | `backend-apps-script/Utils.gs` |
| 3 | Db | `backend-apps-script/Db.gs` |
| 4 | Settings | `backend-apps-script/Settings.gs` |
| 5 | Audit | `backend-apps-script/Audit.gs` |
| 6 | Auth | `backend-apps-script/Auth.gs` |
| 7 | Main | `backend-apps-script/Main.gs` |
| 8 | Employees | `backend-apps-script/Employees.gs` |
| 9 | Questions | `backend-apps-script/Questions.gs` |
| 10 | Reports | `backend-apps-script/Reports.gs` |
| 11 | Tasks | `backend-apps-script/Tasks.gs` |
| 12 | Analytics | `backend-apps-script/Analytics.gs` |
| 13 | SearchExport | `backend-apps-script/SearchExport.gs` |
| 14 | Notifications | `backend-apps-script/Notifications.gs` |
| 15 | Setup | `backend-apps-script/Setup.gs` |

For the first file you can reuse `Code.gs`:

1. Right-click `Code.gs` (or use its ⋮ menu) → **Rename** → type `Config` (Apps Script adds `.gs`).
2. Delete everything inside it, open `Config.gs` from the project folder in a text editor (Notepad, TextEdit), copy all of it, and paste it in. Press **Ctrl+S**.

For each of the other files:

1. Click the **+** next to "Files" → **Script**.
2. Type the name from the table (for example `Utils`) and press Enter.
3. Delete the sample `function myFunction() {}` text, paste the file's contents, and press **Ctrl+S**.

When you finish, the file list should show the 15 names in the order above, plus `appsscript.json`. If one is out of order, drag it into place.

### 1.5 Run the setup

1. Open the **Setup.gs** file.
2. In the toolbar, open the function dropdown (it may show `deptIdFor`) and choose **setupOakcraftSystem**.
3. Click **Run**.
4. Google asks for permission the first time:
   - Click **Review permissions** and choose the owner account.
   - You will see "Google hasn't verified this app". This is normal for your own script. Click **Advanced → Go to Oakcraft Tracker Backend (unsafe)**.
   - Click **Allow**.
5. Wait for "Execution completed" in the log at the bottom (usually under a minute).
6. **Write down the admin login from the log.** It looks like:
   `FIRST ADMIN CREATED → username: admin  temporary password: Oak-1a2b3c4d7`
   You will change this password at first login. If you lose it, see "Lost the admin password" below.

Go back to the Sheet tab and reload it. You should see 13 tabs (Employees, Credentials, Sessions, Departments, Questions, Reports, Tasks, Responses, Remarks, FollowUps, Settings, AuditLog, ErrorLog) and a new **Oakcraft** menu.

Running setup again later is safe: it only adds what is missing and never deletes data.

### 1.6 Deploy the Web App

1. In Apps Script, click **Deploy → New deployment**.
2. Click the gear next to "Select type" and choose **Web app**.
3. Fill in:
   - Description: `Oakcraft tracker v1`
   - **Execute as: Me** (the owner account)
   - **Who has access: Anyone**
4. Click **Deploy**, and authorise again if asked.
5. Copy the **Web app URL**. It ends in **/exec**. Keep it for Part 2.

"Anyone" means the website can reach the server without a Google login. People still need an Oakcraft username and password, and the server checks permissions on every request. Do not use the URL ending in `/dev`; it only works for you.

**Check it:** paste the `/exec` URL into a new browser tab. You should see text like `{"ok":true,"data":{"app":"Oakcraft Daily Working Tracker","status":"running",...}}`.

---

## Part 2: Publish the website (GitHub Pages)

### 2.1 Create the repository

1. Sign in at **github.com** and click **+ → New repository**.
2. Name it `oakcraft-tracker`.
3. Choose **Public**. GitHub Pages on a free personal account needs a public repository. This is safe: the website contains no passwords, keys or data, and the pages ask search engines not to index them. If your organisation has a paid GitHub plan, you can choose Private.
4. Click **Create repository**.

### 2.2 Upload the files

1. On the new repository page, click **uploading an existing file**.
2. Open the project folder on your computer, select everything **inside** it (`index.html`, `login.html`, the other `.html` files, and the `css`, `js`, `assets`, `docs`, `backend-apps-script` folders and `README.md`), and drag it into the browser. You may leave out the `tests` folder; it is not needed to run the system.
3. Wait for the uploads to finish, then click **Commit changes**.

Check that `index.html` is at the top level of the repository, not inside another folder.

### 2.3 Connect the website to the server

1. In the repository, open the `js` folder and click `config.js`.
2. Click the **pencil icon (Edit)**.
3. Replace `PASTE_YOUR_APPS_SCRIPT_WEB_APP_URL_HERE` with your `/exec` URL, keeping the quote marks:
   `APPS_SCRIPT_URL: 'https://script.google.com/macros/s/AKfy..../exec',`
4. Click **Commit changes**.

### 2.4 Turn on GitHub Pages

1. In the repository, click **Settings → Pages**.
2. Under "Build and deployment", set **Source: Deploy from a branch**, **Branch: main**, folder **/(root)**, and click **Save**.
3. Wait 1 to 3 minutes and refresh. The site address appears at the top, for example `https://your-name.github.io/oakcraft-tracker/`.

---

## Part 3: First sign-in and configuration

1. Open the site address. Sign in with the admin username and temporary password from step 1.5.
2. Choose a new password (at least 8 characters with letters and numbers).
3. Open **Settings** (left menu, Administration) and check, in order:
   - **Reporting window:** deadline (default 7:00 pm), grace period (15 minutes), how many past days employees may still report for.
   - **Working days and holidays:** default Monday to Saturday; add this year's holidays.
   - **Company and branding**, **Tasks and follow-ups** categories, **Productivity score** weights.
4. **Add managers first.** Go to **Employees → Add employee** and create each department head with the role **Manager**. Each new person gets a temporary password; use **Copy sign-in message** to send it to them privately.
5. **Assign department managers.** Go to **Departments**, click **Edit** on each department and choose its manager.
6. **Add everyone else**, either one at a time or with **Employees → Import**. Download the template, fill it in Excel or Google Sheets, save as CSV and upload. Download the results file straight away; it contains any generated passwords.
7. **Review the questions.** Open **Report questions**, check the common questions and each department's numbers, add daily targets where useful, and use **Preview form** to see what employees will see.
8. **Optional: notifications.** In **Settings → Notifications**, choose channels and events, switch notifications on, save, click **Install scheduled reminders**, then **Send a test to me**. Email needs an email address on the employee record.

Consider making your own admin account a normal person record too (department, reports-to) if you also submit daily reports, and add a second admin so there is always a backup.

---

## Part 4: Test the live system (10 minutes)

Do these before announcing the system:

1. Create a test employee and a test manager for the same department.
2. On a phone, sign in as the test employee, change the password, fill today's report, and submit. You should get a receipt with a Report ID.
3. On the receipt, tap **Send on WhatsApp**. WhatsApp should open with the whole report typed in. Choose a test contact (for example yourself) and press Send in WhatsApp. Nothing is sent unless you press Send.
4. Press Submit again or reopen **Today's report**: it should say the report is already submitted.
5. Sign in as the test manager on a computer: the report should appear under **Reports** and in **Overview**. Add a review with a follow-up.
6. As admin, open the report and **Reopen** it with a reason; as the employee, check that it can be edited and submitted again.
7. As admin, export reports to Excel and check **Audit log** for these actions.
8. Deactivate the two test accounts when you are done.

---

## Optional: try it with demo data first

To explore with realistic sample data, use a **separate copy** so demo records never mix with real ones:

1. Complete Part 1 in a second Sheet (for example "Oakcraft Tracker DEMO") with its own Web App deployment, and use that URL in a second copy of the website (or temporarily in `config.js`).
2. In that Sheet, click **Oakcraft → 2. Load demo data (development only)**. It takes 1 to 3 minutes.
3. Sign in with `demo.admin`, `demo.anil` (sales manager) or `demo.priya` (sales executive). All demo passwords are `Demo@1234`.
4. Remove it any time with **Oakcraft → 3. Remove demo data**; only rows marked `IsDemo = TRUE` are deleted.

---

## Updating the system later

**Website files (HTML, CSS, JS):** upload the changed files to the GitHub repository (or edit them there) and commit. Keep your `js/config.js` URL. The site updates within a few minutes; ask people to refresh.

**Server files (.gs):**

1. Paste the changed files into Apps Script and save.
2. Click **Deploy → Manage deployments**, select the deployment, click the **pencil (Edit)**, set **Version: New version**, and click **Deploy**. The `/exec` URL stays the same.
3. Run **setupOakcraftSystem** once to add any new columns or settings.

Without step 2, the live system keeps running the old version.

---

## Troubleshooting

**The site shows "Connect the tracker to its backend".** `js/config.js` still has the placeholder, or the URL is missing its quote marks. Fix it in GitHub and wait a minute.

**"The server sent an unexpected response".** The deployment access is not "Anyone", the URL ends in `/dev`, or the deployment was archived. Create a new deployment with the settings in step 1.6 and update `config.js`.

**"The system is not ready yet".** A sheet or column is missing, often after someone renamed or deleted a column. Run `setupOakcraftSystem` again.

**Lost the admin password.** If another admin exists, they can reset it from Employees. If not, in the Sheet open the **Employees** tab, find the admin row, and set its **Status** to `Inactive`. Then run `setupOakcraftSystem`: because no active admin exists, it creates a new admin and prints a new temporary password. Afterwards, sign in with the new admin, reactivate the old record if you want, and reset its password.

**Someone is locked out after wrong passwords.** Wait 15 minutes or reset their password from Employees.

**Reminders are not arriving.** Check that notifications are on, a channel is selected, scheduled reminders are installed, and the person has an email address. Use **Send a test to me**. Free Google accounts can send about 100 emails a day; Google Workspace accounts can send more.

**An error message shows "Reference: ERR-…".** Open **Audit log → System errors** and find that reference for details.

---

## Good practice

- Keep the Sheet private; never share it with employees. They use the website.
- Do not edit the Credentials or Sessions tabs by hand.
- Do not rename tabs or built-in column headings. You may add your own extra columns at the right.
- If you edit the Employees, Departments, Questions or Settings tabs directly, click **Oakcraft → Apply manual edits to the app now** so the website uses the change straight away.
- Make a monthly copy of the Sheet (**File → Make a copy**) as a backup.
- Deactivate people who leave instead of deleting them, so their history stays intact.
