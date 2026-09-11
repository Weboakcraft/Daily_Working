# Design notes — Oakcraft Daily Working Tracker

## Subject, audience, primary job
Oakcraft makes premium office seating in Delhi. The tracker is used by ~100 staff: sales executives
on phones between calls, packers and store staff on the shop floor, accountants at desks, and managers
who need to know, in seconds, who has reported and what is stuck.
Primary jobs: (1) an employee files a complete report in 3–5 minutes on a phone; (2) a manager answers
"who hasn't reported and what's blocked?" at a glance.

## Pass 1 — plan
Color
- Graphite `#22262A` — text, primary buttons on light surfaces
- Walnut `#6B4226` — brand, active navigation, primary actions (configurable in Settings)
- Brass `#B8863B` — single accent: focus ring, carried-forward marks (configurable)
- Mesh `#EEF0EF` — app background, the cool grey of office-chair mesh (not warm cream)
- Panel `#FFFFFF`, rules `#D8DCDA`
- Status set (always paired with a text label, never colour alone): moss `#2F6B45`, amber `#8A5A00`,
  brick `#9B3B2A`, slate `#335F80`, neutral `#6A7076`

Type
- IBM Plex Sans for everything readable; IBM Plex Sans Condensed (600) for page titles and figures —
  it reads like the dimension tables in a furniture spec sheet and fits more numbers on a phone.
- Tabular numerals for all figures. Sentence case everywhere; no all-caps labels.

Layout
```
desktop                                           phone (report form)
┌────────────┬──────────────────────────────────┐  ┌──────────────────────┐
│ Oakcraft   │ [search reports, people, tasks]  │  │ Today's report  Draft│
│            ├──────────────────────────────────┤  │ Due by 7:00 PM       │
│ Overview   │ 38 of 46 reports are in for today│  │ ▮▮▮▯▯▯  Tasks        │
│ Summary    │ ▮▮▮▮▮▮▮▮▮▮▮▮▯▯▯  (segmented bar) │  │ ┌ task ───────────┐  │
│ Reports    │ ledger strip: figures split by   │  │ │ title   status  │  │
│ Tasks      │ vertical rules (one panel)       │  │ └─────────────────┘  │
│ Follow-ups │ day ledger heatmap (people×days) │  │ + Add task           │
│ …          │ charts in a 2-column grid        │  ├──────────────────────┤
└────────────┴──────────────────────────────────┘  │ Saved 10:42  [Next]  │
                                                    └──────────────────────┘
```
Left-aligned throughout; figures right-aligned in tables.

Principles
1. Answer the manager's question in a sentence first, figures second.
2. Status carries a word and a colour.
3. Workshop precision: condensed figures, thin rules, restrained radius (panels 8px, controls 6px,
   status pills fully round) — hierarchy expressed through radius, not one radius for everything.
4. The phone form is one-handed: large targets, number steppers, sticky save/next bar.

## Review against generic defaults (changes made)
- First idea was a dark graphite sidebar with a coloured active item — the standard SaaS shell.
  Changed to a sidebar that sits on the mesh background with walnut text and a walnut rule for the
  active item, so the white work surfaces carry the weight.
- First idea for the dashboard hero was a big KPI number with a small label. Replaced with a plain
  sentence ("38 of 46 reports are in for today") above a segmented bar, because that is literally the
  question managers ask.
- KPI "cards" replaced with a single ledger strip divided by rules, avoiding a row of identical cards.
- Rejected a monospace face for IDs/figures (a generated-UI tell); Plex Condensed with tabular numerals.
- Numbered step markers are used only in the report form, which really is a sequence.

The one bold element: the day ledger — a people × days grid of status swatches that makes gaps in
reporting visible instantly and links each swatch to the report.
