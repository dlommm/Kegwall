# Customizing walls

A "wall" is a public, unauthenticated display page (`/wall/:slug`) meant for a TV or
kiosk display — a rotating grid of tap cards. Everything below is configured per-wall in
the admin UI at **Settings -> Walls -> (pick a wall) -> Edit** (editor role or higher);
this doc explains what each option actually does, sourced from the wall config schema
(`src/server/core/wallConfig.ts`).

## Layout

- **Columns** (1-6) — grid width.
- **Card template** — `full`, `standard`, `compact`, or `minimal`. Controls how much detail
  (ABV, IBU, brewery, description...) each tap card shows; denser templates fit more taps
  on screen.
- **Pages** — group taps into rotating pages (e.g. 8 taps split across 2 pages of 4) if you
  have more taps than fit comfortably on one screen at your chosen column count.
- **Rotation** — seconds between page rotations, minimum 3s.
- **Transition** — `crossfade`, `slide`, or `none` between page rotations.
- **Header** — optional title text, and toggles for a live clock and ambient temperature
  (from a bound Kegtron Pro monitor's sensor, if any).
- **Ticker** — optional scrolling text banner.
- **Fields** — per-field visibility toggles (which beer attributes show on cards).
- **QR code** — optionally show a QR code linking to a menu/detail page.

## Themes

Four built-in themes (`src/web/themes/themes.ts`): `taproom`, `chalkboard`, `bright`, and
`mono`. Each defines a set of CSS custom-property tokens (colors, fonts). Pick a base theme,
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

## Screensaver

`screensaver.enabled` (off by default) turns on an OLED-friendly idle mode after
`screensaver.startAfterMinutes` (default 10, minimum 1) of the wall having been mounted
with no interaction: the display dims its logo and rotates a highlighted tap, reducing
static-pixel burn-in risk on displays left running 24/7. This is a display-content-level
idle mode, separate from — and complementary to — your OS/browser's own screen-blanking
settings; see
[docs/install/raspberry-pi.md#kiosk-mode-wall](install/raspberry-pi.md#kiosk-mode-wall)
for disabling X11 screen blanking so the two don't fight each other (you generally want
this app's screensaver, not the OS one, actually engaging).

## See also

- [docs/install/raspberry-pi.md](install/raspberry-pi.md) — kiosk-mode display setup.
- [docs/recovery.md](recovery.md) — backups cover wall configs too (they're stored in the
  same database as everything else).
