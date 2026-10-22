# Kegwall 2.0.0 — draft release notes

Collected milestone by milestone on the `v2` branch. semantic-release owns `CHANGELOG.md`; when
`v2` merges to `main` and 2.0.0 cuts, this draft becomes that entry's hand-written body.

## Changed

- **Changed:** TVs, phones and kiosks download only their own screen's code and styles. A wall
  now loads 88 KB of CSS instead of 230 KB, and 237 KB of JavaScript instead of 374 KB; the
  admin's styles load only with the admin.

## Added

- **Added:** every tap in the live wall feed now carries tonight's pours and volume (since
  4 am), pours in the last hour and a projected kick date, and the wall payload carries the
  taproom's serving size. None of it reveals keg cost.

## Fixed

## Developer

- **Added:** a visual harness (`npm run visual:capture`, `npm run visual:diff`) that seeds a
  synthetic taproom, photographs every surface at TV, desktop, tablet and phone sizes, and
  pixel-diffs two runs. Plus `scripts/visual/wpe-probe.html` to check a display's browser engine.
