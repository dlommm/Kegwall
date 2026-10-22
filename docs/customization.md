# Customizing walls

A "wall" is a public, unauthenticated display page (`/wall/:slug`) meant for a TV or
kiosk display — a rotating grid of tap cards. Everything below is configured per-wall in
the admin UI at **Settings -> Walls -> (pick a wall) -> Edit** (editor role or higher);
this doc explains what each option actually does, sourced from the wall config schema
(`src/server/core/wallConfig.ts`).

## Looks

A wall's **look** is its whole layout. Kegwall 2.0 redraws the looks so a wall reads like a
taproom board rather than a dashboard. Every redrawn look:

- shows each beer's real color (from its SRM) and a **tap marker**: the beer's color, its
  initials and its tap number. Uploaded label art replaces the initials;
- states what's left **twice**: as a picture (a fill, a bar, a plate) and in servings, for
  example "≈ 32 pints left". Servings use **Settings → Site → Serving size**: a pint-sized
  serving (440–600 mL) reads as pints, anything else as pours;
- is drawn on a fixed 1920 × 1080 layout scaled to the screen, so a 720p, 1080p or 4K TV
  shows the same composition (letterboxed in the theme's background if the screen isn't
  16:9). **Display fit → UI scale** still enlarges the type;
- uses the Kegwall type (Big Shoulders Display and Atkinson Hyperlegible) whatever the
  theme's own fonts are, and picks text colors that meet WCAG contrast in every theme.

| Look | What it is | Taps per page |
| --- | --- | --- |
| `just-tapped` (**default for new walls**) | The spotlight keg owns half the screen as a field of its own color, with its tap number set huge. The rest are listed beside it with pints left. Kicked kegs move to a sentence in the footer | 12 |
| `classic` | Every card is its keg, filled from the bottom to the level, pints left as the big number. 1–4 taps show as large cards, 5–8 as two rows of cards, 9–12 as board rows | 12 |
| `ledger` | The cellar ledger: when each keg went on, what poured tonight, a level bar with pints left, and when it will kick | 12 |
| `columns` | Each column is the keg, filled in the beer's color | 8 |
| `gallery` | A museum wall: each beer a framed plate painted to its level, with a wall label | 8 |

`chalkboard`, `editorial`, `neon`, `terminal`, `poster`, `departures` and `zen` are still
the pre-2.0 designs and are redrawn next. `handles` and `tally` are reserved for two new
looks and show as `classic` until they ship.

**Spotlight** (Just Tapped): by default the most recently tapped keg leads. Pin a tap to
keep one beer in the spotlight; if that tap is empty or kicked, the newest keg leads instead.

**Kick forecast and tonight.** "Tonight" counts pours since 4 am, so a late night stays one
night. The kick forecast divides what's left by the keg's pour rate over the last 7 days
(or since it was tapped, if that's sooner).

## Layout

- **Pages** — group taps into rotating pages. With no pages set, a wall with more taps than
  its look holds (see the table above) splits into pages automatically.
- **Rotation** — seconds between page rotations, minimum 3s.
- **Transition** — `crossfade`, `slide`, or `none` between page rotations.
- **Header** — optional title text, and toggles for a live clock and the kegerator
  temperature (from a bound Kegtron Pro monitor's sensor, if any).
- **Ticker** — optional footer text.
- **QR code** — show a scannable code for the phone menu and claiming pours.
- **Columns, card template, fields and fill style** apply only to the pre-2.0 looks. The
  redrawn looks choose their own composition; the settings are kept so switching back to
  an older look restores them.

## Themes

Ten built-in themes (`src/web/themes/themes.ts`): `midnight-slate` (default), `cream`,
`cellar-teal`, `taproom-green`, `amber-glow`, `arcade`, `taproom`, `chalkboard`, `bright`
and `mono`. Each defines a set of CSS custom-property tokens (colors, fonts). On the redrawn
2.0 looks a theme sets the background, surfaces and text colors; secondary text and warning
colors are adjusted automatically so they stay readable on that theme. Pick a base theme,
then optionally override individual tokens (color pickers/text fields in the editor) without
writing CSS — token overrides are applied as scoped CSS custom properties on the wall,
validated against a safe `--custom-property: value` shape before being written to the page
(so a stray value here can't break out of its own CSS declaration).

## Custom CSS — read the trust model before you paste anything here

The wall editor also has a raw **Custom CSS** textarea, with this warning shown directly
above the save button:

> Custom CSS runs on every screen showing this wall — only paste CSS you trust.

Take that literally. This field is genuinely raw CSS, injected as the *last* stylesheet in
the page (so it wins the normal cascade over every theme token and built-in style),
scoped under the wall's theme wrapper element. It is rendered as React `children` inside a
`<style>` tag — meaning it's inserted as plain **text content**, not via
`dangerouslySetInnerHTML` or any HTML-parsing path, so it cannot smuggle an actual
`</style>` tag to break out into the surrounding page and inject arbitrary HTML/script (this
was specifically checked; see the phase 3 review notes). But within CSS itself, it is
otherwise **completely unrestricted** — full cascade power, `content:` tricks,
`background: url(...)` for a request to any URL of the author's choosing (visible to
anyone watching network traffic, and enough to leak *when* a wall is being viewed and by
what layout), aggressive `position`/`z-index`/`transform` tricks that can visually hide or
relocate elements. None of that is sandboxed.

The practical takeaway: this is edit access to a `<style>` tag on a page that's often shown
on a shared TV in a public space. Anyone with editor or admin credentials can set it — it's
gated by the same role as the rest of the wall editor, not by anything stricter. Treat this
the same way you'd treat handing someone `<style>` access to your public site: fine for
your own CSS, or CSS from a source you actually trust, not something to paste blindly from
a random forum post.

### Styling the redrawn looks

The 2.0 looks use generated class names, which change between releases, so don't target
them. Use the stable hooks instead:

| Hook | On |
| --- | --- |
| `.kegtron-theme-scope` | The wall's theme wrapper (unchanged) |
| `[data-look="just-tapped"]` (and every other look id) | The look's root |
| `[data-surface="wall"]` | The 1920 × 1080 stage |
| `[data-tap-state="ok" \| "low" \| "pouring" \| "kicked" \| "empty"]` | Each tap's row, card or column |
| `[data-testid="tap-marker"]` | Each tap marker |

The pre-2.0 looks keep their old class names throughout 2.x.

## Display power

The wall editor's **Display power** fieldset controls a server-owned idle/wake state
machine (the presence engine), independent per wall:

- **Screensaver after (minutes, blank = never)** — after this many minutes of no
  activity, the display drops into a dimmed screensaver stage: a dim clock overlay over
  the wall's title, rotating a highlighted tap every few seconds and drifting the whole
  layout by a subpixel or two — an OLED-friendly idle mode that reduces static-pixel
  burn-in risk on displays left running 24/7. Leave it blank and the wall never
  screensaves.
- **Screens off after (minutes, blank = never)** — after this many minutes of no
  activity (the same idle-since-last-activity clock as Screensaver above, not stacked on
  top of it — set it larger than the screensaver minutes and the wall simply passes
  through the screensaver stage on its way to off), the display goes to a full black
  "soft off" overlay. Leave it blank and the wall never goes to the off stage. If both
  fields are blank, the wall stays active indefinitely.
- **Camera motion wake (tablet)** — opt in to have the kegerator tablet's front camera
  (frame-differencing in the browser, no ML, nothing leaves the device) count as activity
  too, alongside touches and pours.

"Activity" resets the idle clock and wakes an already-dimmed/off display back to
`active`: a tap or pour on any wall, a touch/tap on the tablet or the screensaver/off
overlay itself, camera motion (when enabled), or an external motion sensor wired up via
MQTT or the presence webhook (**Settings → Sources → MQTT motion topics** /
**Settings → Integrations → Presence**).

This is a display-**content**-level idle mode — the browser tab keeps rendering, it just
shows a dim clock or a black overlay — separate from your OS/browser's own
screen-blanking settings; see
[docs/install/raspberry-pi.md#kiosk-mode-wall](install/raspberry-pi.md#kiosk-mode-wall)
for disabling X11 screen blanking so the two don't fight each other (you generally want
this app's display power, not the OS one, actually engaging). It's also separate from
actually powering down the physical panel (backlight/HDMI) — see
[docs/install/display-agent.md](install/display-agent.md) for wiring the "off" stage up
to real screen power control (HDMI-CEC, DPMS, a tablet's Fully Kiosk API, Home
Assistant, etc).

## Pairing screens by code

The **Displays** admin page mints a short pairing code per screen; the TV opens
`/display` and types it to learn which wall it shows. Two rules to know:

- **Codes expire 15 minutes after they're minted.** If the TV reports an expired code
  (or you're pairing a display created before this rule existed), press **New code** on
  the Displays page (or `POST /api/displays/:id/regenerate-code`, editor role) and type
  the fresh one. Expiry only gates *pairing* — a screen that's already paired keeps its
  own token and stays connected through code regeneration.
- Pairing-code values are never written to the app log.

## See also

- [docs/install/display-agent.md](install/display-agent.md) — real panel power-off (not
  just the in-browser dim/black stages above) driven off the same presence engine.
- [docs/install/raspberry-pi.md](install/raspberry-pi.md) — kiosk-mode display setup.
- [docs/recovery.md](recovery.md) — backups cover wall configs too (they're stored in the
  same database as everything else).
