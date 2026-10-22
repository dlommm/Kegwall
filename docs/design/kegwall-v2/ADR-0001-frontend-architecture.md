# ADR-0001 — Kegwall V2 frontend architecture

| | |
| --- | --- |
| Status | **Accepted** (2026-10-22) with the [V2 blueprint](UI_REDESIGN_BLUEPRINT.md) and [implementation plan](IMPLEMENTATION_PLAN.md) |
| Date | 2026-10-22 |
| Reviewed source | `main` @ `223ed35` (v1.17.0) |
| Deciders | Application owner |

## Context

Measured on the reviewed commit (`npm run build`, Vite 8, Tailwind 4.3, React 19.2):

| Fact | Value | Why it matters |
| --- | --- | --- |
| `src/web/index.css` | **10,302 lines / 225 KB** (one file) | Every surface (TV wall, admin, menu, kiosk, takeovers, 11 looks) shares one global stylesheet |
| Built CSS | **230.5 KB / 32.3 KB gz**, one file in the entry chunk | A wall kiosk on a Pi downloads and parses all the admin CSS it never uses |
| Public entry JS | 374 KB / 113.7 KB gz | Wall, menu, tablet, board and pairing are all eager in `App.tsx` |
| Admin chunk | 815 KB / 208.9 KB gz | Already lazy (one `React.lazy` boundary). Includes Recharts |
| Face recognition | 1.56 MB, lazy `import()` | Already isolated. Keep it that way |
| Fonts | 65 `.woff2` files, 1.3 MB, all `@font-face` declared from `main.tsx` | Browsers fetch only faces in use, but every surface parses every declaration |
| Tailwind usage | `@import "tailwindcss"` present. **18 of 1,980** `className` attributes use utilities | In practice Tailwind is only a reset. Styling is hand-written BEM |
| Distinct `font-size` values | 69 (227 hard-coded `px` sizes, 8 `clamp()`) | No type scale. TV legibility depends on per-rule tuning |
| Distinct `border-radius` values | 29 | No radius scale |
| Theme tokens | `themes.ts` is 10 themes × 1 flat token map, injected as a `<style>` by `ThemeProvider` | Good base. Tokens are colors + fonts only, with no spacing, type or elevation |
| Tests | 215 test files (110 under `tests/web`), Playwright e2e (3 specs) | A safety net strong enough to refactor against |
| Display engines | Chromium kiosk, **cog / WPE WebKit** (Pi + mini-PC), Android `WebView`, phone browsers | CSS must work in WPE WebKit and Android WebView, not just desktop Chrome |

Baseline rendering defects that come from the architecture rather than taste (screenshots in
[`baseline/`](baseline)):

1. **The classic wall leaves a white band at 720p** (`wall-main-720.jpg`): the frame does not fill
   the viewport and the body has no themed background.
2. **At 4K the classic wall's beer names overflow their cards and overlap** (`wall-main-4k.jpg`):
   names scale with the viewport while the card and meta text do not.
3. **12 taps at 6 columns clips the second row** at 1080p (`wall-taps12-1080.jpg`): there is no
   density rule tied to tap count.
4. **The QR-menu claim sheet is see-through.** The list under it reads through the sheet, even
   after the transition has settled (`menu-claim-sheet-settled.jpg`).
5. Meta text on the TV renders at roughly 10–12 px at 1080p, which is unreadable at 10 feet.

## Decision

**Keep React 19 + TypeScript + Vite. Replace the global stylesheet with a token layer + scoped CSS
Modules, split CSS per surface, and adopt headless accessible primitives for admin overlays
only.** In the options' terms: **B (tokens + CSS Modules), plus a narrow slice of C (Radix
primitives) for the admin.** No framework rewrite and no runtime CSS-in-JS.

### The pieces

1. **`src/web/design/tokens.css`**, the one source of design values, in three tiers:
   - *primitives*: raw palette, type families, radii scale (4 values), space scale (8 px base);
   - *semantic*: `--color-ground`, `--color-surface-1/2`, `--color-ink-1/2/3`, `--color-accent`,
     `--color-good/caution/problem/info`, `--radius-card`, `--space-*`, `--font-display/text`,
     `--motion-*`;
   - *surface scales*: `--tv-*` (stage type scale), `--admin-*`, `--touch-*` (≥ 44 px targets,
     56–64 px primary actions on the kiosk).
   Existing theme token names (`--bg`, `--surface`, `--text`, `--accent`, …) stay as **aliases**
   of the semantic tokens, so stored `theme.overrides` and user `customCss` keep working.
2. **Typed theme registry.** `themes.ts` grows from a flat map into
   `{ id, name, mode: 'dark' | 'light', tokens, preview }` with a Zod-validated override schema
   (it already constrains values) and a generated preview swatch for the editor. All 10 stored IDs
   stay; a new `cellar` theme becomes the default **for new walls only**.
3. **CSS Modules co-located with components** (`TapCard.module.css`, `looks/LedgerLook.module.css`,
   `takeover/FullTakeover.module.css`, …). Vite supports them natively, they are scoped at build
   time, add zero runtime, and give each of the 11 looks its own file instead of a slice of a
   10k-line sheet. A set of stable **public hooks** for custom CSS is kept or added as plain
   attributes and global classes (the existing `.kegtron-theme-scope` and `data-testid`s, plus new
   `data-look`, `data-tap-state` and `data-surface` attributes) and documented as the
   customization API.
4. **Per-surface CSS splitting.** `index.css` shrinks to reset + tokens + fonts. The wall, menu,
   tablet and admin CSS live in their route chunks (route-level `React.lazy` for `/menu`,
   `/tablet`, `/board` as well as `/admin`), so a TV loads only wall + look + takeover CSS.
5. **The TV stage.** Walls render on a **logical 1920 × 1080 stage**. Root font size is
   `min(100vw / 120, 100vh / 67.5)` × `--ui-scale`, and every wall dimension is in `rem`. 720p,
   1080p and 4K then show the same composition (fixes defects 1–2), and the per-wall `uiScale`
   keeps working as a multiplier. A **density ladder** picks the composition by tap count per
   page (≤ 4 hero cards, 5–8 card grid, 9–12 board rows, 13+ auto-paginate), which fixes defect 3.
6. **Admin primitives.** Radix UI primitives (Dialog, Popover, DropdownMenu, Select, Tabs, Tooltip,
   Toast) are imported per package and styled with our tokens. They are used **only in the admin
   chunk**. Hand-written components stay for everything on the wall, menu and kiosk.
7. **Motion.** No animation library. CSS transitions plus WAAPI for one-shot sequences; the
   liquid level animates via `transform: scaleY()` on a composited layer, never `height`. One
   `--motion-*` token set; `prefers-reduced-motion` drops travel and keeps opacity and counters.
8. **Charts.** Keep Recharts (already shipped, admin-only). Restyle through tokens; one data hue
   per chart.

## Options considered

Scored 1 (poor) to 5 (best) against the criteria in the brief.

| Criterion | A. React + Tailwind, restructure | **B. Tokens + CSS Modules** | C. + Radix/shadcn primitives | D. vanilla-extract / Panda (build-time typed CSS) | E. Framework swap (Svelte, Solid, Next) |
| --- | --- | --- | --- | --- | --- |
| Design freedom | 4 | 5 | 4 (admin) | 5 | 4 |
| Maintainability | 3: utility soup across 11 looks | 4 | 4 | 4 | 2: two codebases during the move |
| CSS size / split | 4 (purged) | 5 (per chunk) | 4 | 5 | 4 |
| Runtime overhead on Pi/WPE | 5 | 5 | 4 (admin only) | 5 | 4–5 |
| Accessibility | 3 | 3 | **5** (focus traps, ARIA, keyboard) | 3 | 3 |
| Theme + custom CSS support | 3: utilities fight user CSS | **5**: tokens + stable hooks | 4 | 4 | 3 |
| Migration cost | 2: rewrite all 1,980 `className`s into utilities | **4**: file-by-file, can ship per milestone | 4 | 3: new toolchain, TS-only style files | 1 |
| Ecosystem / licensing | MIT, mature | Native to Vite | MIT, mature | MIT, smaller community | MIT |
| Testing | unchanged | unchanged (class names stable via hooks) | unchanged | unchanged | rewrite all 110 web tests |

**Rejected:**

- **A (Tailwind-first).** Tailwind is already installed, but the code is BEM. Moving 1,980 class
  attributes to utilities is churn with little gain. Looks need art-directed CSS, not utility
  composition, and user `customCss` would end up fighting utility specificity. Tailwind stays
  available (it supplies the preflight reset and exposes the tokens through `@theme`) but is not
  mandated.
- **Full shadcn/ui.** Its copy-in components bring a neutral SaaS look the brief explicitly rejects.
  We take the Radix primitives underneath and draw our own skin.
- **D (vanilla-extract/Panda).** Typed tokens are attractive, but CSS custom properties plus a
  TS token map in `themes.ts` give 90% of that without a second compiler or `.css.ts` files that
  contributors and the shelved Flutter client can't read.
- **E (framework replacement).** No evidence React limits us. The wall's hot path is already
  memoized (`stabilizeTaps`, memoized looks), SSR has no value on a LAN kiosk, and WPE compatibility
  is a CSS question, not a framework one. A rewrite would discard 110 web test files.
- **Runtime CSS-in-JS (Emotion, styled-components).** It adds per-render style work on a Pi, which
  runs the wall continuously.
- **Motion / GSAP.** Nothing in the proposed motion needs a library. On low-power TVs, CSS on the
  compositor beats `requestAnimationFrame` loops.

## Consequences

**Expected benefits (to be measured, not assumed):** wall CSS payload falls from 230 KB to the
wall's own share (target ≤ 60 KB raw). The public entry JS shrinks once menu, tablet and board are
lazy. The wall renders the same at 720p, 1080p and 4K. Each look is one module that can be read
alone.

**Risks:**

- *WPE WebKit feature support.* `cog` on Raspberry Pi OS ships a WPE version we haven't pinned.
  Container queries, `:has()`, `color-mix()` and `@starting-style` must be verified on the actual
  device before use, each behind a plain fallback. The stage-unit approach uses only `min()`,
  `rem` and custom properties, which WPE has supported for years.
- *Custom CSS breakage.* Selectors in stored `customCss` that target today's BEM classes
  (`.tap-card__name`, …) would stop matching once classes are hashed. Mitigation: keep the
  documented hooks (`data-*` attributes and the `kegtron-theme-scope` class) plus a compatibility
  layer that leaves the legacy BEM class names on the elements during the V2 major version. A
  release note lists what changes.
- *Visual regressions across 11 looks × 11 themes.* Mitigation: the capture harness in
  [`tools/`](tools/capture-baseline.mts) gives a before/after set per milestone, and Playwright
  screenshot assertions are added for one theme per look.
- *Shelved Flutter client (`apps/wall-native`)* reads theme tokens by name; the alias layer keeps
  those names.

**Rollback:** each milestone lands as its own PR behind no flags. The token layer is additive (old
names alias new ones), so any milestone can be reverted on its own. Stored wall configs are never
migrated destructively (see the blueprint's §H).
