# Cleaning reminders and unclaimed pours

## Line-cleaning reminders

The dashboard and **Taps & kegs** page show cleaning reminders for taps with an active keg
containing beer. Empty, kicked, and archived taps do not create cleaning reminders. Cleaning
history is retained when a keg becomes empty; putting a new keg on the tap makes it eligible for
reminders again.

To pause reminders for a particular tap, open **Taps & kegs**, expand that tap's details, and
choose **Ignore reminders**. Choose **Resume reminders** to turn them back on. Ignoring reminders
does not record a cleaning or change the cleaning history, and it stays in effect across keg
changes until you resume it.

Ignored taps never appear under **Needs attention**, but the dashboard lists them in a short
"Line-cleaning reminders are off for …" note so a paused line isn't forgotten. Each tap in that
note, and each dashboard cleaning action, opens **Taps & kegs** with that tap expanded and
scrolled into view.

## The Pours page

**Pours** (in the admin sidebar) lists every recorded pour, newest first, and refreshes every 15
seconds. Use **Refresh** to check immediately.

- **Filters** — **Unclaimed only**, a **Drinker** filter, and a **From**/**To** date range (local
  days, inclusive). Filters apply on the server before the page limit, so an old unclaimed pour is
  never hidden behind newer activity. **Clear filters** resets them.
- **Load older pours** — the page shows 100 pours at a time; this button pages further back until
  the history runs out. Auto-refresh keeps however many pours you've loaded.
- **Times** — pours from the last day read as "12 min ago"; older ones show the date and time.
  Hover a time for the full timestamp.
- **Assign one pour** (editor or admin) — change the **Drinker** picker on a row. Choosing
  **Unclaimed** clears the drinker.
- **Assign several at once** (editor or admin) — tick rows (or the header checkbox for every
  loaded row), pick a drinker or **Unclaimed** under **Assign to**, and choose **Apply**. The
  change is all-or-nothing: if any pour can't be updated, none are.

Every admin assignment is written to **Logs** under the **Pours** source. Viewer accounts see the
list read-only. On a phone, the time and volume fold under the beer name and the tap column is
hidden so the drinker picker stays on screen.

## Guest claims on the menu

The public menu only offers claims during its recent-pour window (10 minutes) and says so above
the list. **Refresh pours** re-checks immediately; if a refresh fails, the last list stays visible
with a notice. A pour that has aged out of the window can still be assigned from the admin Pours
page.

## API

| Method & path | Role | Purpose |
| --- | --- | --- |
| `GET /api/pours` | viewer | Newest first. Query: `limit` (1–2000, default 500), `unclaimed=true`, `drinkerId`, `kegId`, `since`/`until` (ISO, inclusive), `beforeId` (keyset cursor: pours after that pour in the list; unknown id → 404). |
| `PATCH /api/pours/:id/drinker` | editor | `{ "drinkerId": number \| null }` — assign or unclaim one pour. |
| `PATCH /api/pours/drinker` | editor | `{ "pourIds": number[] (1–500), "drinkerId": number \| null }` — bulk assign/unclaim in one transaction; any unknown pour id → 404 and nothing changes. |
| `PUT /api/taps/:id/cleanings/reminders` | editor | `{ "ignored": boolean }` — ignore or resume a tap's cleaning reminders. |
