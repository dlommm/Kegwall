# Admin dashboard and navigation

The dashboard brings today's pour totals, active taps, temperature readings, and source status
together above the tap list. Temperature probes share one summary card, including humidity and
warming notices where available. The activity card shows the five latest events; open **Logs**
for the full history or **Pours** to assign an unclaimed pour. Taps whose line-cleaning reminders
are ignored are listed in a short note below **Needs attention** (see
[Cleaning reminders and unclaimed pours](cleaning-and-pours.md)).

## Getting around

The admin has one top bar and no sidebar. From the left:

- your taproom's name, which takes you back to the dashboard;
- six destinations: **Tonight**, **Taps & kegs**, **Beers**, **People**, **Screens** and
  **Insights**;
- **Search** (or **Ctrl K** / **⌘K** from anywhere) to jump to any page by typing part of its
  name; use the arrow keys and **Enter**, or **Escape** to close;
- the notification bell, with the number of unread notifications;
- **Settings**;
- your account menu (your initials): your name and role, **Open the wall**, **Sign out** and the
  running Kegwall version.

When a destination has more than one page, its pages show as tabs under the top bar:

| Destination | Tabs |
|---|---|
| Tonight | the dashboard (notifications are behind the bell) |
| Taps & kegs | Taps, Kegs, Suppliers, Monitors |
| Beers | the beer library |
| People | pourers and accounts (the page's own tabs) |
| Screens | Walls, Displays, Presence, Games |
| Insights | Analytics, Every pour, Logs |
| Settings | Settings, Automations, Home Assistant, Diagnostics |

Every address that worked before still works, including `/admin/users` and `/admin/pourers`,
which open under **People**. Pages only admins may open (Kegs, Suppliers, Presence, Settings and
accounts) are hidden from editors and viewers in the bar, the tabs and Search; for them,
**Settings** opens Automations.

Every admin page shows its own title, and the browser tab is named after the current section (for
example "Pours · Kegwall"), so several open admin tabs stay easy to tell apart.

## One look, light or dark

The admin has a single design. It is dark by default and switches to its light counterpart when
your device is set to a light appearance. The old **Appearance** choice (Midnight Slate, Workshop,
Console) has been removed; a choice saved in a browser is ignored.

## Phones and tablets

On narrow screens the destinations move into **Menu** at the top right, which opens them as a
sheet along with Settings, **Open the wall** and **Sign out**. The sheet closes when you choose a
page, press **Escape** or tap outside it. Every control in the bar and the sheet is at least 44 px
tall.
