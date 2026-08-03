# Contributing to Kegwall

A young project — bug reports and merge requests welcome. For anything nontrivial, open an issue
first to discuss the approach.

## Local gate

Run the full gate before sending an MR:

```sh
npm test && npm run typecheck && npm run build && npm run test:e2e
```

- `npm run typecheck` checks **both** tsconfigs (server + `tsconfig.web.json`, which covers
  `src/web` and `tests/`). Don't rely on a bare `tsc` — it misses web/test errors that fail CI.
- `npm run test:e2e` is Playwright against a production build; CI does **not** run it (no browser
  stack on the shared runner), so run it locally before releasing.

## Commits drive releases

Releases are fully automated. Use [Conventional Commits](https://www.conventionalcommits.org/):

| Prefix | Effect |
| --- | --- |
| `fix:` | patch release |
| `feat:` | minor release |
| `feat!:` / `BREAKING CHANGE:` footer | major release |
| `docs:` / `chore:` / `test:` | no release |

Your commit **subject becomes the CHANGELOG line and the GitLab release note**, so write it as the
change you'd want a user to read — not "wip" or "fix stuff".

## Docs, changelog, and wiki are part of the change

Any change to a **user-visible feature, install/upgrade step, config key, or public API** must
update all three in the same change:

1. **Docs** — the page(s) under [`docs/`](docs/README.md) for the area you touched. Adding a page?
   Add it to the docs index (`docs/README.md`) too.
2. **Changelog** — carried by the conventional-commit subject (see above); semantic-release writes
   [`CHANGELOG.md`](CHANGELOG.md) from it.
3. **Wiki** — the mirroring page in the
   [GitLab Wiki](https://github.com/dlommm/Kegwall/wiki). The in-repo `docs/` tree
   is the source of truth; the wiki mirrors it. Update it with:

   ```sh
   git clone https://github.com/dlommm/Kegwall.wiki.git
   # edit the matching page, then:
   git -C kegwall.wiki add -A && git -C kegwall.wiki commit -m "docs: sync <topic>" && git -C kegwall.wiki push
   ```

An MR that changes behaviour without touching docs is incomplete. Reviewers should send it back.

## Invariants

Some rules are load-bearing — a change that breaks one is a bug even if tests pass:

- Owner keg **cost never leaves the server** on any public endpoint (wall, menu, leaderboard,
  passport, `/ws`). Enforced at the API layer.
- **One** house leaderboard. Games decorate it; they never fork it.
- Saving a wall never remounts the preview or resets scroll; per-wall UI scale is a CSS variable.
- New UI works across every wall theme + all 3 admin looks, ≥44px touch targets on tablet/menu.
