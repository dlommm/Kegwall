# Kegwall V2 — UI redesign blueprint

> **Status: APPROVED, implementation in progress** (see [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md)). Earlier status note: nothing below was implemented at design time. Every
> mockup is a *proposed* design built from synthetic data. No production code has changed. Work
> starts only after the owner explicitly says *"Approve the design and begin implementation"*
> (see §L).

| | |
| --- | --- |
| Blueprint version | **0.8**. **Design approved by the owner for implementation planning.** Production code is still not authorized until the implementation plan is approved |
| Pour Lab (live motion preview) | **https://claude.ai/artifact/7tttK7NPN2ViqfEMwmh2Ks**. Source and frames in [`v0.2/pour-lab/`](v0.2/pour-lab) |
| Date | 2026-10-22 |
| **Current review sheet (v0.2)** | **https://claude.ai/artifact/NL4AVD1HVcN3H7FUfDSTHJ**. Prototypes and renders in [`v0.2/`](v0.2) |
| Source reviewed | `dlommm/Kegwall` `main` @ **`223ed35c5009c1741b79ca8095d721f8976bbccb`** = `origin/main`, package version **1.17.0** |
| Working branch | `design/kegwall-v2` (docs only) |
| v0.1 mockups (superseded) | Design canvas https://claude.ai/artifact/SjjVUVSSuWnmZrDPRaGnE3. Sources in [`mockups/`](mockups). Kept for the record |
| Architecture | [ADR-0001](ADR-0001-frontend-architecture.md) |
| **Implementation plan** | [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) (approved 2026-10-22, in progress). Supersedes §J |
| Baseline screenshots | [`baseline/`](baseline). Re-generate with the [visual harness](../../../scripts/visual/README.md) |

---

## A. Executive design summary

Kegwall already does a lot right: live Kegtron data, 11 wall looks, 10 themes, 5 pour takeovers,
a QR menu with claiming, a kiosk, and an admin that covers the whole taproom. What holds it back
is presentation and structure:

- the TV wall is hard to read from across a room,
- the default look reads as colored rectangles rather than beer,
- the admin gives every alert the same weight,
- and all of it sits in one 10,000-line stylesheet shared by every screen.

**The idea for V2: the beer is the color.** Each beer's real SRM color is the only saturated color
on a wall. It fills a glass of that beer's style, and the glass is the keg gauge. Everything
around it is quiet: a warm cellar ground, cream type, copper only on actions. During a pour the
same glass fills with the *measured* ounces. The language carries through the admin (tap rail),
the phone menu and the kiosk, so the product reads as one thing.

**Target experience**

- **TV:** readable from 10 feet at 720p, 1080p and 4K, identical in composition, beautiful when
  idle and unmistakable when a tap pours.
- **Admin:** opens on what needs doing tonight, grouped and ranked.
- **Phone:** a brewery menu that answers "what's on, how strong, how much is left" in one glance.
- **Kiosk:** usable in three seconds with wet hands.

**Why now:** the visual and structural debt is concrete and measurable (§B). Fixing it screen by
screen in the global stylesheet would cost more than rebuilding the styling layer once.

## B. Baseline analysis

### B.1 What was reviewed

| Item | Value |
| --- | --- |
| Commit | `223ed35` on `main`, equal to `origin/main` at review time (clean tree) |
| Version | 1.17.0 (semantic-release, conventional commits) |
| Runtime | Node 24.19, Fastify 5.11, better-sqlite3 13, Zod 4 |
| Frontend | React 19.2, react-router 8.3, Vite 8.2, Tailwind 4.3 (`@tailwindcss/vite`), Recharts 3.10, TypeScript 7 |
| Fonts | Self-hosted Fontsource: Oswald, Inter, Barlow, Barlow Condensed, IBM Plex Mono, Caveat, Playfair Display |
| Tests | Vitest: 215 test files, 110 under `tests/web`. Playwright e2e: `wall`, `cleaning`, `automations` specs. Gate: `npm test && npm run typecheck && npm run build`, plus `npm run test:e2e` |
| Deployment | Docker, Raspberry Pi installer with Chromium kiosk (`cage` + chromium) or **native cog / WPE WebKit**, Android WebView tablet wrapper (`android/`), shelved Flutter client (`apps/wall-native/`) |
| Customization today | Per wall: `look` (11), `theme.id` (10) + `theme.overrides` (validated CSS tokens), `cardTemplate` (4), `fillStyle` (liquid/keg), `takeover.style` (6) + `minMl`, `viewRotation`, `pages`, `fields`, `header`, `ticker`, `showQr`, `display.{sizeIn,resolution,uiScale}`, `displayPower`, raw `customCss`. Admin: 3 per-browser appearances (Midnight Slate, Workshop, Console) |

### B.2 How the screenshots were captured

The capture script (now [`scripts/visual/capture.ts`](../../../scripts/visual/README.md)) boots the real server (`buildApp`, `startSources: false`, so no
BLE/MQTT/UDP/cloud and no notifications) against a temporary data directory. It seeds a
deterministic synthetic taproom: 12 taps, one with a very long name, a cider with no IBU/SRM, a
4% and a 9% keg, one kicked keg, 45 days of pours, 6 pourers and 2 automations. It drives
Playwright through every route. Live pours are synthetic `pour_started` / `pour_progress` /
`pour_completed` events on the in-process bus; no hardware was touched. 89 captures were taken at
720p, 1080p, 4K, desktop (1440), laptop (1280), tablet (1024 × 768 / 800 × 1280) and phone
(390 × 844). A curated set is committed:

| Sheet | Contents |
| --- | --- |
| [Looks](baseline/sheets/looks.jpg) | All 11 looks at 1080p, 8 taps (alphabetical: chalkboard … zen) |
| [Themes](baseline/sheets/themes.jpg) | All 10 themes on the classic look |
| [Wall variants](baseline/sheets/wallvariants.jpg) | 720p / 1080p / 4K, 4 & 12 taps, keg fill, templates, rotation, screensaver, leaderboard, pairing |
| [Pour](baseline/sheets/pour.jpg) | Each takeover style, active and just completed |
| [Admin 1](baseline/sheets/admin1.jpg) · [2](baseline/sheets/admin2.jpg) · [3](baseline/sheets/admin3.jpg) | Every admin page, setup, login, the three admin looks |
| [Phone](baseline/sheets/mobile.jpg) · [Tablet](baseline/sheets/tablet.jpg) | Menu, claim sheet, kiosk states, admin at small widths |

### B.3 Confirmed issues (with evidence)

Severity: **S1** breaks or misleads, **S2** clearly hurts use, **S3** polish.

| # | Sev | Issue | Evidence |
| --- | --- | --- | --- |
| 1 | S1 | Classic wall at 720p leaves a **white band** below the frame | [`wall-main-720.jpg`](baseline/wall-main-720.jpg) |
| 2 | S1 | Classic wall at 4K: **beer names overflow and overlap** neighbouring cards; the second row is cut off | [`wall-main-4k.jpg`](baseline/wall-main-4k.jpg) |
| 3 | S1 | 12 taps at 6 columns **clips the second row** at 1080p | [`wall-taps12-1080.jpg`](baseline/wall-taps12-1080.jpg) |
| 4 | S1 | QR-menu **claim sheet is translucent**; the list beneath reads through it after 2.5 s of settling | [`menu-claim-sheet-settled.jpg`](baseline/menu-claim-sheet-settled.jpg) |
| 5 | S2 | TV meta text (brewery, style, ABV, last pour) renders at ≈ 10–12 px at 1080p | [Looks sheet](baseline/sheets/looks.jpg), [themes sheet](baseline/sheets/themes.jpg) |
| 6 | S2 | The default (classic) card's fill is a **flat SRM rectangle**; at a glance the wall reads as color swatches, and the kicked/empty card looks the same as a dark beer | [`wall-main-1080.jpg`](baseline/wall-main-1080.jpg) |
| 7 | S2 | **Themes on the classic look are near-identical**: only the ground shifts | [Themes sheet](baseline/sheets/themes.jpg) |
| 8 | S2 | Several looks leave **large dead areas**: Zen centres a small list in an empty screen, Columns leaves most of each column empty, Compact uses a third of the screen | [`wall-look-zen-1080.jpg`](baseline/wall-look-zen-1080.jpg), [`wall-look-columns-1080.jpg`](baseline/wall-look-columns-1080.jpg), [`wall-tpl-compact-1080.jpg`](baseline/wall-tpl-compact-1080.jpg) |
| 9 | S2 | **Dock and Fill takeovers have no completion state**: they return straight to the wall | [`pour-dock-complete-1080.jpg`](baseline/pour-dock-complete-1080.jpg), [`pour-fill-complete-1080.jpg`](baseline/pour-fill-complete-1080.jpg) |
| 10 | S2 | **Split takeover's panel is light on a dark wall**, breaking the theme | [`pour-split-active-1080.jpg`](baseline/pour-split-active-1080.jpg) |
| 11 | S2 | Dashboard "Needs attention" lists **11 separate identical "Tap N is due for a line cleaning" rows** above everything else; important items (cloud down, kegs almost gone) are diluted | [`admin-dashboard.jpg`](baseline/admin-dashboard.jpg) |
| 12 | S2 | Wall Editor is a **3,900 px-tall form** in a narrow column; its preview shows sample beers, not the wall's own taps | [`admin-wall-editor.jpg`](baseline/admin-wall-editor.jpg) |
| 13 | S2 | Displays & Presence zones list **rows identified only by wall name**: walls sharing a display name are indistinguishable | [`admin-presence.jpg`](baseline/admin-presence.jpg) |
| 14 | S2 | Kiosk armed state: a small line of text at the top of an empty 1024 × 768 screen | [`tablet-kiosk-armed.jpg`](baseline/tablet-kiosk-armed.jpg) |
| 15 | S2 | Phone menu: style and ABV columns squeeze the beer name into 2-word lines ("CITRA / HAZE") | [`menu-mobile.jpg`](baseline/menu-mobile.jpg) |
| 16 | S3 | Analytics shows **"Avg quality 0"** when no pour has a quality score; it should read "—" | [Admin 2 sheet](baseline/sheets/admin2.jpg) |
| 17 | S3 | Kiosk avatar tiles and labels are small for a wet-hands touch screen (names ≈ 11 px) | [`tablet-kiosk-avatars.jpg`](baseline/tablet-kiosk-avatars.jpg) |
| 18 | S3 | No beer detail view on the phone menu: rows are not tappable for description or rating | Code: `MenuPage.tsx` renders `TapCard template="compact"` with no detail route |

**Needs verification (observed only with synthetic events):** in the Full takeover's completion
card, the number shown was the last live counter (8.0 oz / 236 mL), while the server logged the
completed pour as 412 mL. Real hardware streams progress up to the final value, so the gap may
not occur in practice. Confirm on a Kegtron before treating it as a bug. **M0 code check:** the gap is by design
in `useTakeover.ts`, which shows "the last counter value seen before `pouring` flipped false"
and never reads the recorded pour row. It is a real gap whenever the last UDP packet lags the
final volume; M5 fixes it by carrying the recorded volume to the wall. The screensaver capture
used Playwright's fake clock, which also stalled the WebSocket ("Reconnecting…"), so it does not
show the true screensaver.

**Structural findings (code):** see the ADR's context table. In short: a single 225 KB global
stylesheet for every surface, 69 distinct font sizes, 29 radii, Tailwind installed but only used
as a reset (18 of 1,980 `className`s), and the five largest components at 714–1,203 lines each
(`PresencePage`, `WallEditor`, `AutomationBuilder`, `StatsPage`, `TabletPage`).

### B.4 Strengths to keep

- **Live data path.** WebSocket snapshots with `stabilizeTaps` and memoized looks: no remounts, and
  saves never reset scroll (a repo invariant).
- **The look/theme split** (`look` vs `theme` vs `cardTemplate`) is the right model; V2 deepens it
  rather than replacing it.
- **Safe theming.** Overrides are Zod-validated against CSS injection; owner cost never reaches
  public payloads (an invariant, with a test).
- **Distinct looks.** Departures, Terminal, Ledger, Editorial and Chalkboard each have a real
  personality worth keeping.
- **Full takeover composition** (beer + live ounces + glass) is already close to right.
- **Admin coverage and test suite.** A rebuild can be checked against them.

## C. Visual design concepts

### C.1 v0.2 directions (current)

**Owner feedback on v0.1:** the concepts "still feel very AI generated". Owner reference: the GSBS
redesign sheet, for its sense of a product with its own personality. Owner constraint: *no borrowed
or public imagery*. The personality must come from the UI itself and fit the whole application.

**Diagnosis of v0.1.**
- All three concepts shared one skeleton (header, 8 equal rounded boxes, footer). Nothing led.
- An SVG glass icon stood in for an idea.
- The palettes were the generated defaults: dark + cream + copper, and paper + serif.
- Status was shown as tiles and percent bars.

**v0.2 rules.**
- Every direction starts from something only a taproom with keg monitors has.
- The beer's own SRM color is used as whole fields, not swatches.
- Keg level is stated in pints, in a bartender's words.
- Status is written as a sentence generated from real data.
- One thing leads each screen.

Prototypes: [`v0.2/prototypes/`](v0.2/prototypes) (open any `.html`). Renders: [`v0.2/renders/`](v0.2/renders).

| | **A · Just Tapped** (recommended base) | **B · Tap Handles** | **C · Tally** |
| --- | --- | --- | --- |
| Idea | The bar's "just tapped" board: the newest (or pinned) keg owns half the screen as a field of its own color. When a tap pours, that half *becomes the glass*, filling by measured ounces against the serving-size scale | The bar back: each tap is a handle in its beer's color with a framed sight glass showing the keg; the pouring handle tips forward like a pulled tap | A bartender's tally board: the night written as a sentence, every keg as its remaining pints in tally marks |
| Type | Big Shoulders Display (names, numbers) + Atkinson Hyperlegible (text) | Anybody (condensed, stamped) + Atkinson Hyperlegible | Atkinson Hyperlegible only |
| Ground | Near-black; the list panel takes a deep tone of the spotlight beer | Bar-back black, steel drip tray | Bright board `#F4F3EF`, black rules |
| Renders | `a-tv`, `a-pour`, `a-phone`, `a-admin` | `b-tv`, `b-phone` | `c-tv`, `c-phone` |
| Strength | Beer leads; pour is the same layout (cheap on a Pi); works with zero artwork | Most physical and memorable | Calmest; the tally is genuinely new data design |
| Main risk | Needs a spotlight rule; ink contrast across SRM extremes | 8 per page; kitsch risk | Glare at night; 124-pint half-barrels need "1 mark = 5 pints" |

**Shared new elements:**
- **Tap marker.** A beer's color, initials and tap number, with ink chosen by contrast. It replaces label art; uploaded art can replace the marker.
- **Pints left** as the keg unit.
- **Sentence headlines.**
- **Top-bar admin shell** with six destinations instead of the 17-item sidebar.

**Look library (v0.3).** At the owner's request, every option stays. All 11 existing look IDs
are rebuilt in the v0.2 language, and Just Tapped (`just-tapped`), Tap Handles (`handles`) and
Tally (`tally`) are added as new IDs, for 14 looks in total. The prototype is
`v0.2/prototypes/looks.html#<id>`.

| Look ID | V2 voice |
| --- | --- |
| `classic` | Cards with marker, name, style, and pints left as the anchor |
| `ledger` | Bright two-column list of every tap |
| `gallery` | Six beers as solid color fields with a giant tap number |
| `columns` | Each column is the keg, filled in the beer's color |
| `chalkboard` | Caveat hand lettering on slate; pints as chalk tallies |
| `editorial` | Wine-list page, Playfair italics |
| `neon` | Tilt Neon sign tubes in each beer's color |
| `terminal` | IBM Plex Mono command output with ASCII levels |
| `poster` | Full-width color bands, huge names |
| `departures` | Split-flap board with ON TAP / LAST CALL / POURING |
| `zen` | One beer at a time, quiet list beside |

Themes remain as ground and ink colorways inside each look.

**v0.4 supersedes the table above.** At the owner's request, each look is redrawn from its name,
with IDs unchanged. Every look must show what's left twice: as a picture readable across the room
and as pints left.

| Look ID | v0.4 idea | What's-left picture |
| --- | --- | --- |
| `classic` | The tap list where every card is its keg | Card fills in the beer's deep tone |
| `ledger` | The cellar ledger: tapped, tonight, left, kicks in | Level bar + pints + kick forecast |
| `gallery` | A museum wall of framed color plates with wall labels | Plate painted to the level |
| `columns` | Each column is the keg | Column fill |
| `chalkboard` | The chalk menu with prices | Chalk tally gates (one stroke = one pint) |
| `editorial` | A magazine feature + contents page | Feature figure + per-row level bars |
| `neon` | A wall of bar signs | Neon ring drawn to the level |
| `terminal` | A live `top` with sparklines and a pour log | ASCII level bars |
| `poster` | A festival line-up; the newest keg headlines | Level strip + "N left" per act |
| `departures` | Kegs as flights, sorted by kick time | Pints flaps + "departs in" + Boarding / Departed |
| `zen` | One beer at a time | The orb fills to the level |

New data shown, all of it already in Kegwall:
- the public price per pint (only when the owner turns prices on);
- ounces poured tonight and pours per hour;
- the kick forecast.

**Admin, v0.4: one look and feel.** The three admin appearances (`midnight`, `workshop`,
`console`) become one design. The stored per-browser `kegtron.adminTheme` value is simply ignored,
so nothing needs migrating.

Every page follows the same template:
- a sentence header, one line of support, and at most one primary action;
- sub-tabs for the destination's sections;
- one main list or table, with details and editing in a right-hand drawer;
- six destinations plus notifications, settings and the account menu in the top bar.

Rendered pages (`v0.2/prototypes/admin-*.html`):
- **Tonight**
- **Taps & kegs:** Taps (swap drawer), Kegs (costs, suppliers, price book)
- **Beers**
- **People:** pourers and accounts
- **Screens:** walls, paired screens with power state, presence, plus the Wall Editor
- **Insights:** overview, every pour
- **Settings:** settings, automations, diagnostics (doctor and live log)
- **Menus:** Screens menu, notifications, account, Ctrl K
- **Sign in and first-run setup**
- **Phone menu**

**Admin and configuration (v0.3).** All screens use the same top-bar shell. Prototypes are in
`v0.2/prototypes/admin-*.html`:

- **Taps & kegs**, with the swap-keg drawer open.
- **Beers**, with the editor open, a live marker preview and optional label art.
- **Wall Editor**: section rail, live preview with Wall / Live pour / Screensaver, a 14-look
  gallery, spotlight setting and colors.
- **Settings**: grouped sections and source states.
- **Automations**: sentence rules, with six run-state glyphs.
- **Menus**: Screens dropdown, account menu with the 3 admin appearances, Ctrl K palette.
- **Phone admin menu.**

Page map:
- **Tonight:** dashboard and notifications.
- **Taps & kegs:** taps, kegs, swap, on deck, cleaning, suppliers, monitors.
- **Beers:** library and catalog.
- **People:** pourers, accounts, leaderboard, face sign-in.
- **Screens:** walls, displays, presence, kiosk, games.
- **Insights:** analytics, pours, logs.
- **Settings:** taproom, pricing, sources, Home Assistant, notifications, automations, backups,
  doctor.

**Recommendation:** A's language for the whole product, all 14 looks selectable, Just Tapped as
the default for *new* walls, and pints left as the keg unit everywhere.

**Pour takeovers (v0.5).** The live preview is the Pour Lab. Every style plays a whole pour:
idle, start, measured updates about once a second, finish, return.

| `takeover.style` | Status | What happens |
| --- | --- | --- |
| `full` | Redone | The screen becomes the beer; the name rises in; a large glass fills by measured oz ÷ serving size; bubbles rise; the foam head forms past about half a glass |
| `spotlight` | Redone | The pouring card lifts (scale 1.08, white edge) and fills with the beer; other cards dim to 22%; live oz badge on the card |
| `split` | Redone | The wall slides aside (scale 0.9); a panel rises in the beer's color with the counter |
| `dock` | Redone | A bar rises from the bottom and fills left to right; the wall lifts to make room |
| `fill` | Redone | The screen floods with the beer to the measured level, with a moving surface, and drains on return |
| `off` | Redone as **Badge** | A live oz badge on the pouring card only. Stored value `off` keeps meaning this, so nothing migrates |
| `tappull` | **New** | A giant handle in the beer's color tips forward, the stream starts, and the glass below fills |
| `kegdrain` | **New** | The keg empties live; pints left counts down to two decimals; kick forecast underneath |
| `gameon` | **New** | Only while a game runs: the pourer's bar moves toward the goal live; the order updates at the finish |
| `cheers` | **New finish** (option on any full-screen style) | Two glasses meet; "Cheers, Alex"; recorded volume; the passport pour number stamps in |

Rules, all shown in the lab:
- **Trigger:** starts only after `takeover.minMl` (default 60 mL).
- **Counter:** eases toward the latest measured Kegtron value (900 ms ease-out) and is clamped so it
  never exceeds it.
- **Finish:** always shows the recorded pour row's volume, then returns to the wall within 6 s.
- **Motion:** liquid moves only via `transform: scaleY/scaleX`; bubbles and waves are short CSS
  loops that run only while pouring.
- **Reduced motion:** every move becomes a fade, and the numbers still update.

**v0.6: a signature effect per style.** Each style now has its own moment, so they no longer
read as one fill with bubbles:

| Style | Signature |
| --- | --- |
| `full` | A stream falls into the glass and rings splash at the surface; the head spills over the rim at the finish |
| `spotlight` | The card tips toward the room (rotateX 8°); ripple rings pulse out; the number bumps on every measured update |
| `split` | A diagonal cut-in; a giant tap numeral drifts behind the counter |
| `dock` | A sheen runs along the bar; at the finish it becomes a "+13.9 oz" pill that flies onto the tap's card |
| `fill` | The beer's name is printed across the screen and recolors as the beer rises over it |
| `off` / Badge | Foam fizzes off the live badge |
| `tappull` | The handle springs with overshoot; droplets splash in the glass; at the finish the glass slides off down the bar |
| `kegdrain` | A ghost line marks where the keg started, so the pour's share is visible |
| `gameon` | Sparks at the head of the bar; at the finish the rows swap, confetti bursts, "Alex takes the lead" |
| Cheers finish | Foam splashes as the glasses clink. Offered on single-pour full-screen styles only |

**New in v0.6:**
- **`flight`:** two taps pouring at once. The screen splits into one lane per tap, each filling
  in its own beer, with its own counter and pourer. Any style falls back to Flight while two or
  more taps pour.
- **Wall moments** (events, not pours; new optional `wallMoments` config, all off by default):
  - `kicked`: foam sputters, a KICKED stamp slams, and the next on-deck keg slides in. Triggered
    by the existing kick detection.
  - `tapped`: a curtain of the new beer's color wipes up and its name stamps in. Triggered by a
    keg swap.
  - `milestone`: the pour count rolls over (100, 500, 1,000 and so on, taproom or pourer) with a
    burst of rings, from pour history.

All effects use transform and opacity, apart from Split's one-shot clip-path wipe. Loops (bubbles,
ripples, sheen, fizz) run only while a pour is active, and reduced motion turns every effect into a
fade. On the finish, the counter shows the recorded value exactly.

**v0.7: a real stream, and pours that adapt.**

- **Beer stream component**, used by Full and Tap Pull and available to any style:
  - a steel spout;
  - a tapered body with slanted ripples flowing downward and a light and shade edge;
  - a foam bloom where it lands, riding the liquid level;
  - it appears only on the first measured update, and on finish the tail drops into the glass.
  It is cheap enough for a Pi: one small element with a background-position loop while pouring.
- **Dynamic multi-pour.** Takeovers adapt live to however many taps are pouring.
  - Full opens a lane per pour that glides in (flex-basis transition, 0.8 s): one pour is full
    screen, two are halves, three are thirds. Four or more go to a 2×2 grid, and past four the
    oldest is summarized as a chip.
  - Each lane runs its own pour and its own finish ("Cheers, Jordan · 9.4 oz recorded"), then
    collapses while the others carry on.
  - Lane layouts use container-query units: wide lanes keep the side-by-side glass, narrow lanes
    stack. WPE support for container queries needs confirming, with a fallback.
- **The same rule for every style:**
  - Spotlight lifts every pouring card.
  - Dock stacks one bar per pour.
  - Split stacks panels on the right.
  - Fill splits into vertical floods.
  - Tap Pull shows a handle per pour.
  - Badge marks each card.
  - Keg Drain and Game On fall back to lanes.
  - Flight is now simply this behavior, not a separate choice.

Schema: `takeover.style` gains `tappull`, `kegdrain`, `gameon` and `flight` (additive enum
values). Also added: an optional `takeover.finish: 'plain' | 'cheers'`, and an optional
`wallMoments: { kicked, tapped, milestone }` of booleans.

Needs verification on hardware:
- the Kegtron UDP update rate per model;
- that the recorded volume reaches the completion screen (baseline finding in §B.3). Sections D–K below still describe v0.1 "Cellar". They will be
re-derived from the direction the owner picks; the architecture (ADR-0001), migration rules and
roadmap are unaffected.

### C.2 v0.1 directions (superseded)

Three directions were built as 1920 × 1080 TV walls with the same 8 synthetic taps (canvas row 1).

| | **A — Cellar** (Modern Craft Taproom) | **B — Label** (Boutique Brewery) | **C — Flow** (Next-gen Digital Beer Wall) |
| --- | --- | --- | --- |
| Board | `Main.dc.html` | `ConceptB.dc.html` | `ConceptC.dc.html` |
| Idea | The glass of the beer's style is the keg gauge, filled in its SRM color | The wall is a printed brewery menu | Each tap column is the keg itself, filled to its measured level |
| Ground / ink | Stained-oak black `#15110D` / cream `#F4EBDD` | Paper `#ECE6DA` / ink `#1C1915` | Blue-black `#0A0C0F` / `#EEF2F5` |
| Accent | Copper `#D38D52`, actions only | Bottle green `#2E5A45`, sparingly | None beyond the beer colors |
| Type | Barlow Condensed (names, numbers) + Inter | Playfair Display + Inter | Barlow Condensed 700 + Inter |
| 10-ft legibility | Excellent: 42 px names, 22 px minimum | Very good in rows; serif names need ≥ 44 px | Good for numbers; names wrap to 3 lines in narrow columns |
| Long names | 2-line clamp, card reserves the space | 1-line ellipsis | 3-line clamp |
| Scales to 12+ taps | Yes: board-row ladder step (`Wall12`) | Yes: it is already rows | Poorly: columns get too narrow past 8 |
| Pour moment | Same glass fills live | Needs a separate device | Column fills live: dramatic |
| Low-power cost | Static SVG per card | Lowest (text + bars) | Large colored areas; cheap if transform-only |
| Fit with existing brand | Close to Midnight Slate / Taproom / Amber Glow; keeps copper | Close to Cream + Editorial | New |

**Recommendation: A as the foundation for the whole product.** Keep B and C as *looks*: B becomes
the refreshed **Editorial** look, and C ships as a new **Flow** look (new ID `flow`). That way the
three directions add personality without splitting the design system.

## D. Proposed visual direction: "Cellar"

- **Ground and surfaces.** Warm near-black ground, two surface steps, separation by tone, never by
  shadow at rest. Light counterpart "Workshop" for the admin and light walls. Full role table on
  the canvas's *Design system foundations* board.
- **Color is data.** The beer's SRM color is the only saturated color on a wall. Copper is
  reserved for the primary action, the QR prompt and the pouring state. Status uses good / caution
  / problem / info, each with its own shape (§F).
- **Typography.** Barlow Condensed 600/700 for beer names and numbers (already self-hosted), Inter
  for all text. Two families on the TV; looks that need a voice (Chalkboard → Caveat, Terminal and
  Departures → IBM Plex Mono, Editorial → Playfair) keep theirs. TV scale at the 1080p stage:
  display 168, title 56, card name 42, body 26, **meta 22 minimum**. Admin: 24 / 15 / 14 / 12.
- **Composition.** One logical 1920 × 1080 stage, equal outer margins (64 px), a 24 px gutter,
  and a density ladder by tap count.
- **Signature elements.** The style glassware set (shaker pint, stange, tulip, weizen, snifter),
  each mapped from the beer's style; a cream foam line; the tap number set large in tertiary ink.
- **Elevation.** Flat. Shadows only on what floats (sheets, menus, dialogs, the claim bar).
- **Motion.** Short, purposeful, compositor-only (§I).

## E. Screen-by-screen redesign

Each item points to its canvas board. Boards marked *interactive* respond in Play.

### E.1 Public TV wall (`WallTaproom`, `Wall12`)

- Header: logo mark + site name + subtitle, kegerator temperature and clock in tabular figures.
- **Card:** glass gauge (left), tap number + ABV + IBU (right), name (2-line clamp, reserved
  height), brewery · style, then a status line in words: "83% left · ≈ 32 pints", "Pouring now ·
  6.2 oz", "4% left — almost gone", "Kicked · next up: Old Thunder" (from the On-deck queue).
- Label artwork, when a beer has it, appears as a 44 px roundel beside the name. Missing art is
  normal, not an error state.
- Footer: ticker text, rotation page indicator, QR with "Scan for the menu and claim your pour".
- **Density ladder (per page):** 1–4 taps hero cards (2 × 2); 5–8 card grid (4 × 2); 9–12 board
  rows (2 × 6, `Wall12`); 13+ auto-paginate into the 9–12 ladder step. `columns` remains an
  explicit override.
- **Stage scaling** fixes issues 1–3: the same composition at 720p, 1080p and 4K, multiplied by
  `display.uiScale`.
- **All 11 looks stay** and are rebuilt on tokens with their own module. Each keeps its
  composition and must pass the 22 px meta floor. Zen and Columns get denser layouts (issue 8).
  Screensaver, rotation and leaderboard keep their behavior and take the new tokens.

### E.2 Live pour (`PourLive`, `PourComplete`)

- **Full:** beer identity on the left, a huge live counter ("8.0 oz") captioned "Measured live by
  the Kegtron on tap 1 · 236 mL so far", keg remaining, and the attributed pourer when a kiosk
  session is armed. On the right, a large glass filled to *measured volume ÷ configured serving
  size*, with 8 / 12 / 16 oz marks. Past a full serving the glass stays full with a foam cap and
  the counter keeps counting. **No simulated progress anywhere.**
- **Complete:** the **recorded** volume ("13.9 oz · 412 mL in 6.1 s"), the keg delta
  ("83% → 81%"), a claim card with QR when unattributed (10-minute window), and "Back to the wall
  in 6 s".
- **All six styles stay:** `off`, `full`, `spotlight`, `split`, `dock`, `fill`. Each gets an
  active and a completion state (fixes issue 9) and takes the wall's theme (fixes issue 10).
  Thresholds (`minMl`) unchanged.
- Reduced motion: no slide or scale; the counter and fill still update.

### E.3 Wall Editor (`WallEditor`, *interactive*)

A studio layout instead of a long form:

- **Top bar:** breadcrumb, unsaved-change count, Revert, Simulate a pour (preview only, nothing
  recorded), Save to TVs.
- **Left rail:** eight sections (Look · Theme and color · Content · Layout and pages · Pour takeover ·
  Rotation and screensaver · Display fit · Advanced CSS) with a dot on each changed section.
- **Center:** the live 16:9 stage rendering **this wall's real taps**, with Fit / 100% and the
  page selector.
- **Right inspector:** thumbnails for looks and takeovers, swatch rows for themes, plain fields
  elsewhere, and progressive disclosure for color/font overrides and custom CSS (validated before
  save, errors inline).
- State: a single `useWallDraft` reducer (`saved` vs `draft`, dirty-section set, revert) replacing
  per-field state, so the saved config stays byte-compatible.

### E.4 Admin dashboard (`AdminDashboard`)

- **Framed-sheet shell:** a tinted frame holds the sidebar and top bar, and the work sits on one
  sheet. The sidebar is grouped: Taproom, Screens, Guests, Insights, System. The active item is a
  neutral fill, not a colored pill.
- **Tap rail (signature):** every tap as a small glass with its level, pouring and low states.
  One click goes to the tap.
- **Needs attention:** grouped and ranked (problem → caution → info), one row per *kind* ("11 taps
  due for line cleaning"), each with one action (fixes issue 11).
- **Pours today:** numbers as type, an hourly bar chart with the current hour in the one data hue,
  and recent pours with inline "Assign" for unclaimed rows.
- **Side column:** "Hardware right now" (each source's real state), kegerator temperature range,
  and "Next kegs to kick" from `kegForecast`.

### E.5 Phone QR menu (`MobileMenu`, `BeerSheet`, *interactive*)

- Name on its own line at full width, then "style · ABV · IBU" (fixes issue 15). Tap and level at
  the right edge, and a small style glass for each beer.
- Search, existing filters (All, New, Almost gone) plus **proposed** style-family chips (Light,
  Hoppy, Dark).
- **Beer sheet** (new, fixes issue 18): opaque bottom sheet (fixes issue 4) with ABV/IBU/tap/keg,
  description, 48 px rating stars, and "Was one of these yours?" claim rows with 44 px buttons.
- Persistent claim bar when pours are waiting. Passport chip in the header.

### E.6 Tablet kiosk (`KioskWho`, `KioskPouring`, *stage via Tweaks*)

- **Who's pouring:** 56 px search, two "poured recently" tiles, 64 px avatars on 132 px tiles,
  and a 64 px "I'm new — add me".
- **Armed / pouring / done:** one full-screen composition with name, an instruction headline and
  the glass. *Armed:* dashed empty glass. *Pouring:* live measured fill. *Done:* recorded volume,
  then the existing 5 s auto sign-out. Attribution logic is unchanged.

### E.7 Analytics (no board yet; follows the dashboard's rules)

KPIs as type, not tiles. One data hue per chart; no legend for a single series; 3–5 faint
gridlines. Missing values print "—", never 0 (fixes issue 16). Ranges 7d / 30d / 90d / custom.
Comparisons are stated in words ("same as last Wednesday"). Exports keep their current formats.

### E.8 Devices, displays and presence

Every row says **where its state comes from**: "Receiving · 2 s ago" (Kegtron), "Asleep · reported
by display agent", "Not set up". UI-only states (simulated pour, preview) use a dashed outline and
the words "Preview only". Zones show wall name **and slug** (fixes issue 13). Tap-to-device mapping
becomes a two-column port → tap table with inline change.

### E.9 Automations and notifications

Run states each get color **and** shape: Enabled (filled dot), Disabled (hollow ring), Pending
(clock), Executing (arc), Completed (check), Failed (cross). Rules read as one sentence ("When a
keg drops below 15%, notify in-app"). Backend behavior and safeguards are unchanged.

### E.10 Everything else

Beers, kegs, suppliers, swap wizard, pours, people, settings, logs, doctor, setup and login move
onto the same shell, tokens and primitives. Tables use rules and right-aligned numbers, and owner
cost appears only where it does today (admin-only).

## F. Component system

| Layer | Components | Notes |
| --- | --- | --- |
| Tokens | color roles, SRM scale, type scales (`tv`, `admin`, `touch`), space (8 px), radii (4 values), motion | `src/web/design/tokens.css` + `themes.ts` registry |
| Data glyphs | `Glass` (style → shape, level, SRM, foam), `LevelText`, `SrmSwatch`, `TapNumber`, `Abv` | One `Glass` replaces today's `LiquidFill`/`KegFill` split for cards; `KegFill` stays as `fillStyle: 'keg'` |
| TV | `Stage`, `WallHeader`, `TapCard` (variants: card, row, hero, column), `Ticker`, `QrPrompt`, `PageDots`, takeover shells × 6 | CSS Modules per look |
| Admin primitives | Button (primary, secondary, quiet, danger), IconButton, Input, Select, Switch, Tabs, Dialog, Sheet, Popover, Menu, Tooltip, Toast, Table, EmptyState, Skeleton, ErrorState | Radix underneath (dialog, popover, menu, select, tabs, tooltip, toast), skinned with tokens |
| Status | `StatusDot` (6 run states), `HealthRow` (hardware vs UI-only), `AttentionItem` | Shape + color, never color alone |
| Touch | `TouchButton` (56/64 px), `AvatarTile`, `BottomSheet` (opaque, drag handle, focus trap), `RatingStars` | ≥ 44 px always |
| Charts | `BarChart`, `LineChart`, `Sparkline`-free KPIs | Recharts, one data hue |

## G. Technology architecture

Summary of [ADR-0001](ADR-0001-frontend-architecture.md):

- Keep **React 19 + TypeScript + Vite**.
- Replace the global stylesheet with **tokens + CSS Modules** and per-surface CSS chunks.
- Add **Radix primitives for the admin only**.
- **No animation or CSS-in-JS runtime.**
- Walls render on a **1920 × 1080 rem stage**.
- Route-level lazy loading for `/menu`, `/tablet` and `/board`, as well as `/admin`.

Rejected: a Tailwind-utility rewrite, full shadcn/ui, vanilla-extract/Panda, a framework swap.

**Platform compatibility.** The same web bundle serves Chromium kiosks, **cog / WPE WebKit**, the
Android WebView wrapper (`android/`, which just loads `/tablet/<slug>` or `/wall/<slug>`) and phone
browsers. Any CSS beyond `min()`/`clamp()`/custom properties (container queries, `:has()`,
`@starting-style`, `color-mix()`) is gated behind `@supports` with a plain fallback and checked on
a Pi running `cog`. The shelved Flutter client reads theme token names, which the alias layer
preserves.

## H. Migration strategy

**Stored configuration is never rewritten.** All changes to `wallConfigSchema` are additive:

| Config key | Today | V2 |
| --- | --- | --- |
| `look` | 11 IDs, default `classic` | Same 11 IDs, plus `flow`. `classic` renders the new card (see open question 2) |
| `theme.id` | 10 IDs, default `midnight-slate` | Same 10, plus `cellar`, the default **for newly created walls only** |
| `theme.overrides` | Legacy token names | Still accepted; legacy names alias the semantic tokens |
| `fillStyle` | `liquid` (default), `keg` | Plus `glass`; existing walls keep their stored value |
| `cardTemplate`, `takeover.*`, `viewRotation`, `pages`, `fields`, `header`, `ticker`, `display.*`, `displayPower` | — | Unchanged meaning |
| `customCss` | Targets BEM classes | Legacy BEM class names stay on elements through V2. New stable `data-*` hooks documented; a release note lists deprecated selectors |

**Admin looks:** IDs `midnight`, `workshop`, `console` stay (localStorage key
`kegtron.adminTheme`). *Midnight Slate* is retoned to Cellar unless the owner prefers a fourth look.

**Routes:** unchanged (`/wall/:slug`, `/menu`, `/tablet/:slug`, `/board`, `/display`, `/admin/*`,
including the legacy `/admin/users` and `/admin/pourers` deep links).

**Code path:** each surface moves to tokens + modules in its milestone; the matching slice of
`index.css` is deleted in the same PR, so there is never a second copy. `index.css` ends as
reset + tokens + fonts.

**Possible schema addition (needs approval):** an optional per-beer `glass` override (nullable
column, defaulted from style). Without it, the glass is derived from `data/beerStyles.ts`.

## I. Performance and accessibility targets

Bundle numbers are measured baselines. Runtime numbers **still need a baseline on real
hardware** (a Pi 4/5 under `cog` and Chromium). M0 shipped the tools for it
([`scripts/visual/`](../../../scripts/visual/README.md): `wpe-probe.html` for engine features and
pour fps); the device run is pending until a Pi is available.

| Area | Baseline | Target |
| --- | --- | --- |
| CSS shipped to `/wall` | 230.5 KB (32.3 KB gz), all surfaces. **M1: 88.2 KB** | ≤ 60 KB raw for wall + one look + takeovers |
| Public entry JS | 374 KB (113.7 KB gz). **M1: 224.9 KB + 11.9 KB wall chunk** | ≤ 300 KB raw for `/wall` after menu/tablet/board go lazy |
| Admin chunk | 815 KB (208.9 KB gz) | Not larger than +40 KB gz with Radix; split per page group where easy |
| Wall idle CPU / memory (Pi, `cog`) | *not yet measured* | No continuous animation at idle; no heap growth > 10% over a 24 h soak |
| Pour animation | *not yet measured* | Transform/opacity only; ≥ 50 fps on the Pi under `cog` |
| TV legibility | meta ≈ 10–12 px at 1080p | ≥ 22 px at the 1080p stage, same proportion at 720p and 4K |
| Contrast | not audited | Text ≥ 4.5:1, large text ≥ 3:1, every theme × look, checked by script |
| Touch | kiosk names ≈ 11 px, small tiles | ≥ 44 px everywhere; kiosk primary actions 56–64 px |
| Keyboard / screen reader (admin) | partial | Visible focus everywhere; dialogs trap focus; every control labelled |
| Reduced motion | 12 rules today | Every animation has a reduced variant: no travel, keep opacity and live numbers |
| Color independence | — | Every status distinguishable by shape or text |

**Motion tokens:** press 120 ms (scale 0.97, ease-out); sheet/dialog 240 ms
`cubic-bezier(0.32, 0.72, 0, 1)`, exit 160 ms; takeover in 320 ms one-shot; the liquid level
follows each WebSocket frame via `transform: scaleY()`. No perpetual animation on an idle wall,
except the ticker, which pauses under reduced motion.

## J. Implementation roadmap

> **Superseded by [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md)**, which re-derives the
> milestones from the approved v0.8 design (14 looks, one admin, new pour styles and moments). The
> table below is the v0.1 roadmap, kept for the record.

Each milestone is its own PR from `design/kegwall-v2` work branches. Each one passes the local gate
(`npm test && npm run typecheck && npm run build`) plus `npm run test:e2e`, re-runs the capture
harness, and updates this blueprint, the docs, the CHANGELOG and the wiki, per the repo's rules.

| # | Milestone | Exit criteria |
| --- | --- | --- |
| 1 | **Foundation:** tokens, theme registry, stage, primitives, lazy routes, perf baseline on Pi | Tokens + aliases in place; every existing screen renders identically (pixel-diff on the harness set); Pi baseline recorded |
| 2 | **Public wall:** `Glass`, new `TapCard`, density ladder, classic + Taproom, 720p/1080p/4K | Issues 1, 2, 3, 5, 6 closed; all 11 looks still render |
| 3 | **Live pour:** 6 takeover styles, completion states, reduced motion | Issues 9, 10 closed; completion shows the recorded volume; Pi fps target met |
| 4 | **Wall Editor:** studio layout, `useWallDraft`, real-tap preview | Issue 12 closed; saved configs byte-compatible (round-trip test on fixtures) |
| 5 | **Admin:** shell, grouped nav, dashboard, taps, beers, kegs, suppliers, swap | Issue 11 closed; owner-cost invariant test still green |
| 6 | **Phone + kiosk:** menu, beer sheet, claim, passport, kiosk states | Issues 4, 14, 15, 17, 18 closed; 44 px audit passes |
| 7 | **Analytics + advanced:** stats, devices, displays, presence, automations, notifications, logs, doctor | Issues 13, 16 closed |
| 8 | **Theme × look validation** | Contrast script passes for every combination; one screenshot assertion per look |
| 9 | **Cleanup:** remove superseded CSS/components | `index.css` = reset + tokens + fonts; no dead selectors (scripted check) |
| 10 | **Final validation** | Full gate, e2e, a11y and reduced-motion checks, before/after set, measured perf vs §I |

## K. Risks and rollback

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| Existing walls look different after upgrade (classic re-skinned) | Certain if Q2 = "re-skin" | Owner surprise | Release as **2.0.0**; release notes with before/after; optional `classic-v1` look (Q2) |
| Stored `customCss` stops matching | Medium | A customized wall renders wrong | Keep legacy class names during V2; stable `data-*` hooks; changelog lists selectors |
| WPE WebKit lacks a CSS feature | Medium | Broken layout on native walls | `@supports` fallbacks; test on a Pi with `cog` every milestone |
| Visual regression in a rarely used look/theme | Medium | Ugly wall | Harness before/after per milestone; screenshot assertions (M8) |
| Radix inflates the admin chunk | Low | Slower admin first load | Per-package imports; measure; budget in §I |
| Scope creep beyond the approved design | Medium | Delay | §L change control: deviations recorded here first; material ones re-approved |
| Security regressions (CSP, theming injection) | Low | Defacement | Keep Zod override validation; no inline event handlers; CSP checked in M10 |

**Rollback:** every milestone is independently revertible, because the token layer is additive and
no stored data is migrated. Docker images and releases continue through semantic-release only from
`main` after owner merge. Nothing is deployed, released or merged by this work without explicit
instruction.

## L. Approval and change history

| | |
| --- | --- |
| Review status | **Design and implementation plan approved (2026-10-22).** Implementation in progress, milestone by milestone |
| Approved sections | §C.1 (14 looks, one admin, pour takeovers, wall moments) |
| Implementation status | In progress on branch `v2`; see the plan's §9. The open questions below are answered with recommendations as D1–D10 in [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) §2 |

### Open questions for the owner

0. **v0.2 direction (supersedes question 1):** does **A · Just Tapped** feel like Kegwall, or
   should B or C lead? What owns the spotlight by default: the newest keg, a pinned beer, or a
   rotation through new arrivals?
1. ~~**Direction:** approve A — Cellar as the foundation?~~ Superseded by v0.2.
2. **Existing walls on `classic`:** re-skin them to the new card on upgrade (recommended), or
   freeze the current design as `classic-v1`?
3. **Default theme** for *new* walls: `cellar`? (Existing walls keep theirs.)
4. **Admin looks:** retone *Midnight Slate* to Cellar, or add Cellar as a fourth look?
5. **Custom CSS:** keep legacy BEM class names for the whole V2 major, then remove in V3?
6. **Per-beer glass override** column: add it, or derive from style only?
7. **Phone filters:** add style-family chips (Light / Hoppy / Dark / Sour)?
8. **Release:** ship V2 as **2.0.0** (breaking: custom CSS selectors, visual change)?
9. **Hardware check:** can a Pi with `cog` and one Kegtron be made available for the performance
   baseline and the takeover-completion verification?

### Change history

| Version | Date | Change |
| --- | --- | --- |
| 0.1 | 2026-10-22 | Initial audit, 89 baseline captures (24 curated + 9 contact sheets), 3 concepts, 14 proposed boards, ADR-0001, roadmap. Submitted for review |
| 0.2 | 2026-10-22 | **Requested change:** owner found v0.1 concepts "very AI generated" and pointed to the GSBS sheet as the bar for personality. A first rework used public-domain artwork as label stand-ins; the owner then asked for **no public imagery**, so it was removed. **Delivered:** three new directions (Just Tapped, Tap Handles, Tally) as standalone prototypes, 8 renders, review sheet https://claude.ai/artifact/NL4AVD1HVcN3H7FUfDSTHJ. v0.1 Cellar marked superseded. Sections D–K pending the owner's pick |
| 0.3 | 2026-10-22 | **Owner feedback:** "much better". Keep all wall options (about 10, not one); the admin and configuration UI had not been shown. **Delivered:** 11 existing looks rebuilt in the v0.2 language plus 3 new (14 total); admin screens for Taps & kegs (swap drawer), Beers (editor), Wall Editor (14-look gallery), Settings, Automations, menus (dropdowns, account and appearance, Ctrl K) and phone admin; page map onto 6 destinations. Review sheet updated at the same link |
| 0.4 | 2026-10-22 | **Owner feedback:** the old looks didn't look much better; every wall must show what's left; one admin look and feel, fully redesigned, clean, with no feature lost; old looks may be redone from the ground up based on their names. **Delivered:** all 11 looks redrawn from their names, each showing what's left as a picture and in pints; a single admin template; 14 admin renders covering every current page plus menus, sign-in and setup; the appearance picker removed. Review sheet updated at the same link |
| 0.5 | 2026-10-22 | **Owner approved the direction** of one admin design and 14 wall looks (design approval only; implementation not yet authorized). **Requested:** redo the pour animations, completely if needed, make them pop, and propose new ones. **Delivered:** Pour Lab live preview with 6 redone styles (Badge replaces Off), 3 new styles (Tap Pull, Keg Drain, Game On) and the Cheers finish; frames for every style mid-pour and at the finish |
| 0.6 | 2026-10-22 | **Owner feedback:** the styles look alike; give each its own flare, and add a few more. **Delivered:** a signature effect for all 9 pour styles and the Cheers finish; new Flight (two taps at once); wall moments Just kicked, Just tapped and Milestone; finish counters snap to the recorded volume. Pour Lab updated at the same link; 26 frames in `v0.2/pour-lab/frames` |
| 0.7 | 2026-10-22 | **Owner feedback:** the single-line stream looks strange, so show a real flow of beer wherever there is one; when several taps pour at once, the takeover should adapt automatically (Full: one screen, then split, and so on). **Delivered:** stream component (spout, tapered flowing body, foam bloom, tail) in Full and Tap Pull; Full rebuilt as dynamic lanes for 1–3 pours with per-lane finishes; a "Pours at once" control in the Pour Lab; the multi-pour rule written for every style |
| 0.8 | 2026-10-22 | **Owner feedback:** Tap Pull didn't look natural. **Fixed:** the handle swings on its pivot (2D, spring), with a chrome faucet and spout; the glass starts tilted and straightens as it fills; the shared flowing stream reaches the surface. **Owner:** "good to proceed with the full design". All design consolidated into one artifact (https://claude.ai/artifact/NL4AVD1HVcN3H7FUfDSTHJ, with the Pour Lab as `pour-lab.html` inside it). **Status: approved for implementation planning.** Next: a per-milestone implementation plan for owner approval |
| 0.9 | 2026-10-22 | **Delivered:** [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) v1.0: 12 milestones (M0–M11) on a `v2` integration branch released once as 2.0.0, decisions D1–D10 with recommendations, invariant handling, schema additions, verification matrix. §J marked superseded. Awaiting owner approval; no code written |
| 1.0 | 2026-10-22 | **Owner approved the implementation plan** and the D1–D10 recommendations: build one milestone at a time on `v2`, commit and review each, continue until done |
