# Suppliers

The **Suppliers** page (admin role) is the directory of the places you buy kegs from, plus a
price book derived automatically from what you've actually paid. It lives entirely behind
the admin login: it shows owner cost, which never reaches a public surface.

## The directory

Each supplier card carries contact details (contact person, phone, email, address, delivery
day/notes), the weekly opening hours, and the derived price book. Editors can add and edit
suppliers; only admins can delete one, and deleting a supplier keeps the purchase history on
its kegs — only the link to the supplier clears.

## Opening hours

Hours are entered as a **weekly grid**, one row per day, because most suppliers don't keep
the same hours all week:

- Tick a day to open it, then set its opening and closing time. Untick it for **Closed**.
- **Copy to all** stamps that day's times across the whole week — the fast path when five
  weekdays are identical, after which you fix up the weekend.
- The **Hours note** underneath is a free-text line for the things a grid can't express:
  "call ahead", "closed public holidays".

On the card, days that share the same hours collapse into one line — `Mon–Fri 9 AM–5 PM ·
Sat 10 AM–2 PM · Sun Closed` — and a live **OPEN NOW** / **CLOSED** badge tells you at a
glance whether it's worth phoning right now. The badge reads the browser's clock, so it's
correct for whoever is looking at the tablet.

Suppliers created before structured hours existed keep whatever text was typed in the old
single Hours field; it shows as the hours note (with no open/closed badge, since there's no
structured week to judge). Filling in the grid replaces it.

## The price book

The price book is never typed in. It's read straight out of keg purchase history — every keg
you record with a supplier and a cost contributes one row per beer and size, showing the most
recent price you paid. Rows are flagged:

- **★ best price** — no other supplier has sold you that beer and size cheaper.
- **only source** — nobody else has sold it to you at all.

The header sums it up: supplier count, kegs purchased, and year-to-date spend.

## Who can see keg costs

Owner cost (what you paid for a keg, the deposit, the supplier, the purchase date) is
private by default:

- **Public surfaces** (wall, menu, board, guest phones) **never** see cost — at most the
  marked-up display price, and only when pricing is enabled. This is a hard rule with no
  toggle.
- **Editor and admin accounts** always see costs — editors record them, admins analyze them.
- **Viewer accounts** don't see costs by default: keg lists, the on-deck queue, and the
  money KPIs on Analytics (cost per pint, value on tap) come back with cost fields blank.
  If you want read-only accounts to see them, opt in at **Settings → Pricing → "Show keg
  costs to viewer accounts"**.

## See also

- [docs/setup/kegtron-cloud.md](setup/kegtron-cloud.md) — devices and sensors.
- [CONTRIBUTING.md](../CONTRIBUTING.md) — the docs/changelog/wiki rule.
