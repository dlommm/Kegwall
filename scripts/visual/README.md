# Visual harness

Screenshot every Kegwall surface from a seeded synthetic taproom, then compare two runs pixel by
pixel. Used by every Kegwall V2 milestone (see
[the implementation plan](../../docs/design/kegwall-v2/IMPLEMENTATION_PLAN.md)).

| File | What it does |
| --- | --- |
| `seed.ts` | 12 taps (long name, cider with no IBU/SRM, 4 % and 9 % kegs, one kicked keg), 45 days of pours, 6 pourers, 2 automations, an admin login, and one wall per look, theme, layout variant and takeover style |
| `capture.ts` | Boots the real server (`startSources: false`: no hardware, no notifications) on a temporary data dir and photographs the TV wall (720p / 1080p / 4K), live pours, phone menu, tablet kiosk and every admin page |
| `diff.ts` | Compares two capture folders, writes red-highlighted diff images and an `index.html` report, and exits 1 when a shot changes more than `--max-pct` |
| `wpe-probe.html` | Standalone page for the display device: lists which CSS features the engine supports and measures pour-motion frame rate |

```sh
npm run build
npm run visual:capture -- .visual/before          # on the old code
npm run visual:capture -- .visual/after           # on the new code
npm run visual:diff -- .visual/before .visual/after --max-pct 0.5
```

`.visual/` is git-ignored. A name filter limits a run: `npm run visual:capture -- .visual/x pour`.
If Playwright's pinned browser isn't installed, run `npx playwright install chromium` or set
`KEGWALL_CHROMIUM=/path/to/chrome`.

**Noise floor.** Two runs of the same code differ by up to ~0.12 % per shot, all from the wall
clock and relative times ("2m ago"). The server listens on a fixed port (`VISUAL_PORT`, default
47900) so wall URLs shown in the admin don't change between runs.

**Probe on a display.** Copy `wpe-probe.html` to the device and open it in the wall's browser
(`cog file:///home/pi/wpe-probe.html`, or Chromium in kiosk mode). After 10 s it prints a JSON
block with feature support and frame rates; record it in ADR-0001's display-engine table.
