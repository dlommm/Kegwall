# Kegwall V2 — implementation plan

> **Status: APPROVED 2026-10-22.** The owner approved this plan and the D1–D10 recommendations
> ("Cool lets do it!") and asked for the milestones to be built one at a time, each committed and
> reviewed before the next, until V2 is done. Progress is tracked in §9.

| | |
| --- | --- |
| Plan version | 1.1 (2026-10-22), approved |
| Implements | [UI_REDESIGN_BLUEPRINT.md](UI_REDESIGN_BLUEPRINT.md) v0.8 (design approved for planning) |
| Visual source of truth | Consolidated artifact https://claude.ai/artifact/NL4AVD1HVcN3H7FUfDSTHJ (Pour Lab inside as `pour-lab.html`); prototypes in [`v0.2/prototypes/`](v0.2/prototypes), Pour Lab in [`v0.2/pour-lab/`](v0.2/pour-lab) |
| Architecture | [ADR-0001](ADR-0001-frontend-architecture.md): tokens + CSS Modules, Radix for admin only, 1920 × 1080 rem stage, no animation/CSS-in-JS runtime |
| Base | `main` @ `223ed35` (v1.17.0) |
| Supersedes | Blueprint §J (that roadmap predates v0.2 and still describes v0.1 "Cellar") |

---

## 1. What gets built

From the approved design, in one list:

- **14 wall looks.** The 11 existing IDs redrawn from their names (`classic`, `ledger`, `gallery`,
  `columns`, `chalkboard`, `editorial`, `neon`, `terminal`, `poster`, `departures`, `zen`) plus
  `just-tapped`, `handles`, `tally`. Every look shows what's left twice: a picture readable across
  the room, and **pints left**. Themes stay as ground/ink colorways inside each look.
- **Shared wall language.** Tap marker (beer color + initials + tap number, ink by contrast,
  replaced by label art when present), pints left, sentence headlines generated from live data,
  public price per pint (when pricing is on), ounces tonight, pours per hour, kick forecast.
- **Pour takeovers.** Six redone styles (`full`, `spotlight`, `split`, `dock`, `fill`, `off` →
  shown as **Badge**), three new (`tappull`, `kegdrain`, `gameon`), the optional **Cheers** finish,
  the shared **beer stream** component, and **dynamic multi-pour** for every style (lanes for 1–3
  pours, 2 × 2 at 4, chip for the rest).
- **Wall moments** (opt-in): `kicked`, `tapped`, `milestone`.
- **One admin.** Top-bar shell with six destinations (Tonight, Taps & kegs, Beers, People,
  Screens, Insights) plus Settings, notifications, account menu and Ctrl K. Every page on one
  template: sentence header, one primary action, sub-tabs, one main list/table, right-hand drawer.
  The three admin appearances are dropped. No feature is removed.
- **Wall Editor studio** with live preview of the wall's real taps (Wall / Live pour /
  Screensaver), the 14-look gallery, spotlight setting, takeover and moments settings.
- **Phone menu + beer sheet, tablet kiosk, sign-in and first-run setup** in the same language.

## 2. Decisions needed before Milestone 1

These are the blueprint's open questions (§L), updated for v0.8. Each has a recommendation; the
plan below assumes the recommendation unless the owner says otherwise.

| # | Decision | Recommendation | Why |
| --- | --- | --- | --- |
| D1 | **Existing `classic` walls on upgrade** | Re-skin to the v0.4 `classic`. No `classic-v1` | The owner asked for the old looks to be redone from their names; a frozen copy doubles maintenance |
| D2 | **Defaults for new walls** | Look `just-tapped`, theme unchanged (`midnight-slate`). Existing walls keep their stored values | Matches the blueprint recommendation; no stored config is rewritten |
| D3 | **Just Tapped spotlight rule** | New optional `spotlight: { mode: 'newest' \| 'pinned', tapId? }`, default `newest` (most recently tapped keg) | The prototype's Wall Editor already shows a spotlight setting |
| D4 | **`flight` as a stored style** | Do **not** add `flight` to the enum. Multi-pour is automatic for every style (v0.7) | v0.7 says Flight is "simply this behavior"; the v0.6 schema line predates that |
| D5 | **Per-beer glass override column** | No. Derive the glass from style (`data/beerStyles.ts`) | No schema change; only the pour takeovers draw a glass now |
| D6 | **Legacy BEM class names for `customCss`** | Keep them on elements for all of 2.x; add documented `data-look`, `data-tap-state`, `data-surface` hooks; remove in 3.0 | Stored `customCss` keeps matching |
| D7 | **Phone style-family chips** (Light / Hoppy / Dark / Sour) | Add; client-side from `beerStyles.ts` | No API change |
| D8 | **Release shape** | Build on a long-lived integration branch `v2`; merge to `main` once as **2.0.0** (`BREAKING CHANGE:` visual change + custom-CSS selector note) | semantic-release cuts a release on every `main` merge; shipping half an admin redesign as 1.x would leave users with two looks. See §4 |
| D9 | **Hardware** | Need one Pi 4/5 running `cog` (WPE) with one Kegtron for M0 baselines and the two hardware checks | Perf targets and the container-query fallback depend on it |
| D10 | **Old admin appearance setting** | Ignore the stored `kegtron.adminTheme`; delete the picker | Owner decision v0.4; nothing to migrate |

## 3. Constraints carried into every milestone

**Repo invariants (CLAUDE.md) and how each is held:**

- **Owner keg cost never reaches a public endpoint.** M2 adds public fields (pints left, tonight,
  pours/hour, forecast). They are computed server-side from non-cost data and pass through
  `toPublicTapState`. The existing raw-body test in `tests/routes/public.test.ts` is extended to
  the new fields and to the `wall_moment` WebSocket frame.
- **Exactly one leaderboard.** `gameon` and the milestone moment read and decorate the existing
  leaderboard data; neither keeps its own ranking.
- **Saves never remount or reset scroll.** Looks stay memoized behind `stabilizeTaps`; the Wall
  Editor's `useWallDraft` never re-keys the preview; per-wall scale stays the `--ui-scale` CSS
  variable on the stage.
- **All wall themes + touch targets.** Every look is checked against every theme by the contrast
  script (from M3), and every touch surface against the 44 px audit (from M7). With one admin look,
  "3 admin looks" becomes "the one admin look, light and dark system preference".
- **Schema-first per feature.** Every milestone that adds config lands the Zod change and its
  round-trip test first, in the same PR.

**Stored config is never rewritten.** All `wallConfigSchema` changes are additive with defaults
that reproduce today's parsed value. Keys that a redrawn look no longer uses (`cardTemplate`,
`fillStyle`, `glyphMode`, `columns`) are still parsed and round-tripped; each look documents which
it honors.

**Platform.** One bundle for Chromium kiosk, `cog` / WPE WebKit, Android WebView and phones.
Container queries, `:has()`, `color-mix()` and `@starting-style` sit behind `@supports` with a
plain fallback. Motion is `transform` / `opacity` only (Split's one-shot `clip-path` excepted);
loops run only while a pour is active; `prefers-reduced-motion` turns movement into fades and keeps
the numbers live.

**Fonts.** The prototypes load Google Fonts; production self-hosts through Fontsource, like today.
New: Big Shoulders Display, Atkinson Hyperlegible, Anybody (Handles), Tilt Neon (Neon). Kept:
Caveat, Playfair Display, IBM Plex Mono. Dropped once unused (M11): Oswald, Inter, Barlow, Barlow
Condensed. Each surface declares only the faces it uses.

## 4. Branching, review and release

- `v2` branches from `main`. Each milestone is one or more PRs into `v2` from `v2/mNN-<slug>`
  branches. `main` is merged into `v2` weekly so fixes keep flowing.
- Every PR passes the local gate `npm test && npm run typecheck && npm run build`, plus
  `npm run test:e2e` and the visual harness (§6).
- Every PR that changes user-visible behavior updates `docs/` and records a changelog line in a
  `CHANGELOG-v2.md` draft on the branch (semantic-release owns `CHANGELOG.md`; the draft becomes the
  hand-enriched 2.0.0 entry). The wiki is updated when 2.0.0 merges, since it mirrors `main`.
- Each milestone ends with an owner demo: rendered captures from the harness at 720p / 1080p / 4K,
  phone and tablet, plus a Pi capture where relevant. The owner approves before the next milestone
  starts. Deviations from the design are recorded in the blueprint's change history first.
- `v2` → `main` happens only on the owner's instruction (M11). Nothing is deployed, released or
  merged without it.
- If the owner prefers incremental 1.x releases instead (D8), M3–M6 can ship to `main` on their
  own because new looks and styles are additive; M7–M10 would still need to land together.

## 5. Milestones

Size: **S** ≈ 1 PR, **M** ≈ 2–3 PRs, **L** ≈ 4+ PRs. Order is by dependency; M3/M4 and M7/M8 can
overlap once their foundations land.

```
M0 ─ M1 ─ M2 ─┬─ M3 ─ M4 ─────────┐
              ├─ M5 ─ M6 ─────────┤
              └─ M7 ─ M8 ─ M9 ─ M10 ┴─ M11
```

### M0 · Preparation and baselines (S, no user-visible change)

- Create `v2`. Move `tools/capture-baseline.mts` into `scripts/visual/` as a reusable harness
  (seed, routes, viewports) that writes to an ignored output folder and can diff two runs.
- Pi baseline (D9): wall idle CPU / memory, 24 h heap soak, takeover fps under `cog` and Chromium;
  Kegtron UDP update rate per model; confirm whether the recorded volume reaches the completion
  screen (blueprint §B.3 "needs verification").
- WPE probe page: one static page testing container queries, `:has()`, `color-mix()`,
  `@starting-style`, `rem` stage scaling and the `background-position` stream loop. Record results
  in the ADR.
- **Exit:** baselines and probe results committed to the blueprint §I and the ADR.

### M1 · Foundation (M)

- `src/web/design/tokens.css`: primitives → semantic → surface scales (`--tv-*`, `--admin-*`,
  `--touch-*`), motion tokens. Legacy theme names (`--bg`, `--surface`, `--text`, `--accent`, …)
  become aliases, so `theme.overrides`, `customCss` and the Flutter client keep working.
- `themes.ts` → typed registry `{ id, name, mode, tokens, preview }`; the Zod override rules are
  unchanged.
- `Stage` component: root size `min(100vw / 120, 100vh / 67.5) × --ui-scale`, themed body
  background. Fixes the 720p white band and 4K overflow at the root.
- CSS Modules wired; per-surface CSS split. `React.lazy` for `/menu`, `/tablet`, `/board`.
- Fontsource packages for the new families, declared per surface.
- **Exit:** every existing screen renders the same as the M0 baseline (pixel diff within
  tolerance); wall entry JS and CSS measured against §I; gate green.

### M2 · Wall data and shared wall parts (M)

- Server: public tap fields `pintsLeft`, `tonightOz`, `poursPerHour`, `kickForecast`, `nextOnDeck`
  (from existing `kegForecast`, on-deck queue and pours). Price per pint already exists. Extend the
  public no-cost test.
- Schema: `look` + `just-tapped`, `handles`, `tally`; `spotlight` (D3). Round-trip tests on stored
  fixtures.
- Web parts: `TapMarker` (contrast-picked ink, label art swap), `PintsLeft`, `Headline` (pure
  sentence generator, unit-tested on edge cases: kicked, empty wall, one tap, no forecast),
  `WallShell` (header, ticker, QR, page dots on the stage), `lookRegistry` replacing the switch in
  `WallLook.tsx`, contrast utility shared with the test script.
- **Exit:** new fields visible on `/api` public snapshot without cost fields; parts covered by
  `tests/web`.

### M3 · Looks, part 1 (L)

`just-tapped` (new default for new walls), `classic`, `ledger`, `columns`, `gallery`. Each look
is one folder: component + module CSS + harness entry. Density ladder by taps per page (≤ 4,
5–8, 9–12, 13+ paginate) applies where the look is a grid.

- Long names (2-line clamp with reserved height), no-SRM cider, kicked keg, 4 and 12 taps,
  720p / 1080p / 4K all in the harness set.
- Contrast script (`scripts/visual/contrast.mts`): every look × theme, text ≥ 4.5:1, large ≥ 3:1.
- **Exit:** blueprint issues 1, 2, 3, 5, 6, 8 closed for these looks; meta text ≥ 22 px at the
  1080p stage; screenshot assertion per look in Playwright.

### M4 · Looks, part 2 and wall extras (L)

`chalkboard`, `editorial`, `neon`, `terminal`, `poster`, `departures`, `zen`, `handles`, `tally`.
Screensaver, view rotation, leaderboard view, pairing screen, host-stats strip and banner lane
restyled onto the stage.

- **Exit:** all 14 looks pass the contrast script and the harness set; old look CSS deleted from
  `index.css` in the same PRs.

### M5 · Pour engine and redone styles (L)

- `useTakeover` becomes a lane model: one lane per active pour above `minMl`, ordered by start,
  each with its own phase (start → pouring → finish → collapse). Counter eases toward the latest
  measured value (900 ms ease-out) and is clamped to it; finish shows the **recorded** pour row's
  volume, then returns within 6 s. Unit tests drive it with synthetic bus events, including
  overlapping pours and a pour that ends while another starts.
- `BeerStream` component (spout, tapered body, foam bloom, tail drop).
- Redone styles with signatures and the multi-pour rule: `full` (lanes, stream, head spill),
  `spotlight`, `split`, `dock` (pill flies to card), `fill` (name recolors), Badge (`off`).
- **Exit:** blueprint issues 9, 10 closed; Pi fps ≥ 50 under `cog` with 1 and 3 pours; reduced
  motion verified; harness captures each style mid-pour and finished.

### M6 · New styles, Cheers and wall moments (M)

- Schema: `takeover.style` + `tappull`, `kegdrain`, `gameon`; `takeover.finish: 'plain' |
  'cheers'` (default `plain`); `wallMoments: { kicked, tapped, milestone }` (all `false`).
- Styles: `tappull` (pivot swing with spring, chrome faucet, tilted glass), `kegdrain` (ghost line,
  two-decimal pints), `gameon` (only while a game runs; falls back to lanes otherwise), Cheers
  finish on single-pour full-screen styles.
- Server: a structured `wall_moment` WebSocket frame `{ kind, tapId, beerId, count?, scope? }`
  emitted from the existing `keg_kicked` / `keg_tapped` events and `milestones.ts`. Pourer
  milestones are new (count per pourer). The existing `wall_banner` celebration stays for walls
  with moments off, so no wall shows both.
- **Exit:** moment frames carry no cost fields (test); each style and moment in the harness.

### M7 · Admin shell and Tonight (M)

- Radix primitives (Dialog, Popover, DropdownMenu, Select, Tabs, Tooltip, Toast) skinned with
  tokens: `Button`, `Input`, `Switch`, `Table`, `Drawer`, `EmptyState`, `Skeleton`, `ErrorState`,
  `StatusDot` (six run states, shape + color).
- `AdminLayout` → top bar with six destinations, Settings, notifications bell, account menu,
  Ctrl K palette, phone menu. `adminNav.ts` becomes a destination → sub-tab map; **every current
  URL keeps working** (sub-tabs link the existing paths, including `/admin/users` and
  `/admin/pourers`), and role filtering (`adminOnly`) carries over.
- `PageTemplate` (sentence header, primary action, sub-tabs, main list, drawer).
- Tonight page (dashboard): grouped and ranked attention items (one row per kind), tap rail,
  pours tonight, hardware state, next kegs to kick.
- Remove the appearance picker and `adminTheme.ts` (D10).
- **Exit:** issue 11 closed; keyboard and focus audit on the shell; admin chunk ≤ +40 KB gz.

### M8 · Admin pages (L)

Each page moved onto `PageTemplate`, its slice of `index.css` deleted in the same PR, and its
existing tests kept green:

- **Taps & kegs:** taps (swap drawer replaces `SwapWizard` modal steps, same API), kegs, on deck,
  cleaning, suppliers, monitors. Owner cost only where it is today.
- **Beers:** library and catalog, editor drawer with live marker preview and label art.
- **People:** pourers, accounts, face sign-in.
- **Insights:** analytics (KPIs as type, "—" not 0, one data hue), every pour, logs.
- **Settings:** taproom, pricing, sources, Home Assistant, notifications, automations (sentence
  rules, six run-state glyphs), backups, diagnostics (doctor and live log).
- Large files split while moving: `AutomationBuilder` (931), `StatsPage` (789), `UsersPage`
  (657), `MonitorsPage` (681).
- **Exit:** issue 16 closed; no admin route still uses the old shell; e2e `automations` and
  `cleaning` specs green.

### M9 · Screens and the Wall Editor (L)

- **Screens:** walls, paired displays with power state, presence zones (wall name **and** slug),
  kiosk, games. `PresencePage` (1,203 lines) split.
- **Wall Editor studio:** section rail with changed-section dots, live 16:9 stage of the wall's
  **real** taps with Wall / Live pour / Screensaver modes and "Simulate a pour" (preview only,
  nothing recorded), 14-look gallery, spotlight, takeover style + finish + `minMl`, wall moments,
  colors, display fit, advanced CSS (validated inline). One `useWallDraft` reducer (saved vs
  draft, dirty sections, revert).
- **Exit:** issues 12, 13 closed; saved configs byte-identical on round-trip for every fixture;
  the preview never remounts on edit.

### M10 · Phone menu, kiosk, sign-in and setup (M)

- Phone menu: name on its own line, style · ABV · IBU, marker and pints left, search, existing
  filters plus style-family chips (D7), passport chip, persistent claim bar.
- Beer sheet: opaque bottom sheet with focus trap, description, 48 px rating stars, claim rows
  with 44 px buttons.
- Kiosk: who's pouring (56 px search, 64 px avatars on 132 px tiles), armed / pouring / done as
  one composition. Attribution and 5 s auto sign-out unchanged. `TabletPage` (714) split.
- Sign-in and first-run setup on the admin template.
- **Exit:** issues 4, 14, 15, 17, 18 closed; 44 px audit script passes on phone and tablet; e2e
  `wall` spec green.

### M11 · Validation, cleanup and release (M)

- `index.css` reduced to reset + tokens + font declarations; a script fails CI on unused
  selectors. Unused fonts and components (`LiquidFill`, `KegFill`, old glyphs) removed if no look
  uses them.
- Full matrix: contrast (14 looks × 10 themes), screenshot per look and per takeover style,
  reduced motion, keyboard, 24 h Pi soak, perf against every row of blueprint §I.
- Before/after set for the release notes; custom-CSS selector changes listed.
- Docs: every affected page under `docs/` (walls, looks, takeovers, admin, menu, kiosk, config
  reference), the hand-written 2.0.0 CHANGELOG entry from `CHANGELOG-v2.md`, wiki mirrored after
  merge.
- **Exit:** owner sign-off; on the owner's instruction, `v2` → `main` with `BREAKING CHANGE:`,
  semantic-release cuts 2.0.0; check its CHANGELOG entry and enrich it.

## 6. How the work is checked

| Check | Where | From |
| --- | --- | --- |
| Local gate + e2e | every PR | M0 |
| Visual harness diff (seeded taproom, 720p / 1080p / 4K / desktop / tablet / phone) | every PR touching UI | M0 |
| Pixel-identical-to-baseline | M1 only (the foundation must change nothing) | M1 |
| Config round-trip on stored fixtures | every schema change | M2 |
| Public no-cost body test (snapshot + `wall_moment`) | every public data change | M2 |
| Contrast script, every look × theme | CI | M3 |
| Playwright screenshot assertion per look / takeover | CI | M3 / M5 |
| Pi under `cog`: fps, idle CPU, heap soak | milestone demo | M0, M5, M11 |
| 44 px touch audit | CI | M7 |
| Reduced-motion and keyboard pass | milestone demo | M5, M7, M11 |

## 7. Risks

| Risk | Mitigation |
| --- | --- |
| WPE lacks container queries, breaking narrow pour lanes | M0 probe; stacked-lane fallback behind `@supports` |
| Pi can't hold 50 fps with 3 lanes + stream | M0 baseline sets the budget; stream loop is one element; drop ripples/bubbles past 2 lanes |
| Long-lived `v2` branch drifts from `main` | Weekly merge from `main`; M1's foundation is additive and small |
| Kegtron update rate too slow for a smooth counter | Easing covers ~1 s gaps; verified in M0 |
| A stored `customCss` stops matching | Legacy BEM classes kept for 2.x (D6); release note lists changes |
| Admin rebuild drops a feature | M8 checklist generated from the current routes, settings groups and API calls; each ticked off in the PR |
| Scope creep | Changes to the design go into the blueprint change history first; material ones go back to the owner |

**Rollback:** until the 2.0.0 merge, `main` is untouched. After it, no stored data has been migrated, so
reinstalling 1.17.x keeps every wall's config (new keys such as `spotlight` are ignored by 1.x).

## 8. What happens next

1. Owner reviews this plan and answers D1–D10 (or accepts the recommendations).
2. On *"Approve the design and begin implementation"*, M0 starts. Each milestone ends with a demo
   and needs the owner's go-ahead before the next one.

## 9. Progress

| Milestone | Status | Commit |
| --- | --- | --- |
| M0 · Preparation and baselines | Done. Harness, probe, 88-shot baseline; Pi and WPE measurements pending hardware | see git log |
