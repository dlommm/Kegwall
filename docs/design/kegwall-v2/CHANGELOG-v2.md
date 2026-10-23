# Kegwall 2.0.0 — draft release notes

Collected milestone by milestone on the `v2` branch. semantic-release owns `CHANGELOG.md`; when
`v2` merges to `main` and 2.0.0 cuts, this draft becomes that entry's hand-written body.

## Changed

- **Changed:** the admin opens on **Tonight** instead of the dashboard: a sentence about the
  night, what needs doing, the last pour, every tap as a glass with servings left, pours by hour,
  screens, hardware, the next kegs to kick and the latest activity.
- **Changed:** the admin has a top bar instead of a sidebar: six destinations (Tonight, Taps &
  kegs, Beers, People, Screens, Insights), Search, the notification bell, Settings and an account
  menu. A destination's pages show as tabs under the bar; every existing admin address still
  works. On phones the destinations open from **Menu** as a sheet.
- **Changed:** one admin design, dark by default and light when the device prefers it.

- **Changed:** pour takeovers are rebuilt. Full shows a glass filling from a stream of beer,
  Split slides a panel in the beer's color, Dock lifts the wall for a filling bar, Fill floods
  the screen, Spotlight lifts the pouring card, and Off keeps the wall still with a live
  counter on the pouring row. Every style handles several taps pouring at once, one lane each.

- **Changed:** the Chalkboard, Editorial, Neon, Terminal, Poster, Departures and Zen looks are
  redrawn from their names, each showing what's left as a picture and in pints: chalk tally
  gates, a magazine contents page with level rules, neon rings, ASCII gauges with the pour
  log, a festival line-up, a split-flap board sorted by kick time, and an orb.
- **Changed:** every part of a wall (rotation, leaderboard view, banners, game strip, pour
  takeovers, screensaver) scales with the screen the same way, so a 4K TV no longer needs
  the browser zoom workaround.

- **Changed:** the Classic, Ledger, Columns and Gallery wall looks are redrawn. Every card,
  row, column or plate is the keg itself, filled in the beer's color, with what's left stated
  in pints ("≈ 32 pints left") using the taproom's serving size. Classic picks its layout by
  tap count (large cards, two rows of cards, or board rows). **Existing walls on these looks
  change appearance on upgrade.**
- **Changed:** redrawn looks render on a fixed 1920 × 1080 layout scaled to the screen, so
  720p, 1080p and 4K TVs show the same composition with no white band at 720p and no
  overlapping names at 4K; text is never smaller than 22 px at 1080p.
- **Changed:** themes keep their colors, but secondary text and warning colors on redrawn
  looks are adjusted to meet WCAG contrast in every theme.

- **Changed:** TVs, phones and kiosks download only their own screen's code and styles. A wall
  now loads 88 KB of CSS instead of 230 KB, and 237 KB of JavaScript instead of 374 KB; the
  admin's styles load only with the admin.

## Added

- **Added:** **Ctrl K** / **⌘K** opens Search from anywhere in the admin: type part of a page's
  name, arrow to it and press Enter. Editors and viewers never see admin-only pages there.

- **Added:** three pour takeover styles: **Tap Pull** (a handle swings, the glass fills and
  slides off), **Keg Drain** (the keg empties live, pints left count down) and **Game On**
  (the pour moves the pourer up a running game).
- **Added:** a **Cheers** finish for single full-screen pours, with the pourer's passport
  pour number.
- **Added:** opt-in **wall moments**: Just kicked, Just tapped and Pour milestones (the house's
  every-100th pour and each pourer's own hundreds).

- **Added:** two new wall looks: **Tap Handles** (each tap a handle in its beer's color with a
  sight glass; the pouring handle tips forward) and **Tally** (the night as a sentence, every
  keg's pints left as tally marks).
- **Added:** prices on the Chalkboard look when pricing is turned on.

- **Added:** the **Just Tapped** wall look, the default for new walls: the newest (or a
  pinned) keg fills half the screen in its own color, with the tap list beside it.
- **Added:** tap markers (the beer's color, initials and tap number) on every redrawn look;
  uploaded label art replaces the initials.
- **Added:** stable custom-CSS hooks: `[data-look]`, `[data-surface="wall"]`,
  `[data-tap-state]` and `[data-testid="tap-marker"]`.

- **Added:** every tap in the live wall feed now carries tonight's pours and volume (since
  4 am), pours in the last hour and a projected kick date, and the wall payload carries the
  taproom's serving size. None of it reveals keg cost.

## Removed

- **Removed:** the admin **Appearance** setting (Midnight Slate, Workshop, Console). A saved
  choice is ignored.

## Fixed

- **Fixed:** **Needs attention** listed one row per tap for the same problem (eleven "Tap N is
  due for a line cleaning" rows buried a source that was down). Each kind is now one row with one
  action, ranked problem, then caution, then information.
- **Fixed:** the end of a pour showed the last live reading instead of the recorded volume,
  which could be several ounces short when the last Kegtron packet lagged the final pour.
- **Fixed:** the Dock and Fill takeovers had no finish; Split's light panel broke dark themes.

## Developer

- **Added:** `npm run visual:contrast` renders every redrawn look in every theme and fails on
  any text below WCAG AA contrast.

- **Added:** a visual harness (`npm run visual:capture`, `npm run visual:diff`) that seeds a
  synthetic taproom, photographs every surface at TV, desktop, tablet and phone sizes, and
  pixel-diffs two runs. Plus `scripts/visual/wpe-probe.html` to check a display's browser engine.
