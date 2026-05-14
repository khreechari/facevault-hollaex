# Changelog

All notable changes to the FaceVault HollaEx plugin.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [v2.0.7] — 2026-05-14

### Fixed
- **Tab strip icon now renders.** HollaEx kit's `Image` component
  (`web/src/components/Image/index.js`) decides inline-SVG vs `<img>`
  rendering via `icon.indexOf('.svg') > 0`. A plain
  `data:image/svg+xml;base64,...` URL fails that check, falls through
  to `<img>`, and base64-encoded SVG in `<img>` renders unreliably
  across browsers — the verification tab showed a blank slot next to
  the FaceVault label. Appending `#shield.svg` is a URL fragment
  ignored by the data-URL parser but flips the kit's substring check
  so it routes through ReactSVG and inlines the icon. The shield
  itself now also inherits `currentColor` so it picks up the kit's
  active icon colour rather than a fixed green that may not contrast
  against custom themes.
- Mirrored in the dashboard JSON generator
  (`api/app/services/hollaex_plugin.py`).

## [v2.0.6] — 2026-05-14

### Added
- `operator_path` field in `web_view[0].meta`. Operators on a HollaEx
  kit that routes admin somewhere other than `/operator/` can override
  the destination of the upgrade-now "open operator panel" action by
  setting this in their JSON before installing. Sanitised to reject
  any value that isn't a same-origin absolute path, so a hostile
  meta value can't redirect the admin off-site.
- `SECURITY.md` — disclosure channel + response timeline.
- `CONTRIBUTING.md` and `CODE_OF_CONDUCT.md` — standard FOSS docs.
- `coverageThreshold` gate on the test suite (90% lines, 100% functions,
  80% branches on `utils.js`). CI runs `npm run test:coverage` so a
  regression in helper coverage blocks publish.
- Workflow now sources the GitHub release body from the matching
  `CHANGELOG.md` section (`body_path`), so future releases auto-populate
  with the content you wrote in the changelog instead of just the
  Full-Changelog compare link.
- 9 additional unit tests covering the new `sanitizeOperatorPath` and
  `readOperatorPath` helpers (43 tests total).

### Changed
- Polling loop now pauses when the tab is in the background
  (`document.hidden`) and resumes when it comes back. Halves the request
  budget for users who park us in another tab.
- Exponential backoff on consecutive poll errors (doubles each failure,
  capped at 30s). A transient API outage no longer burns 600 fixed-rate
  requests per session.
- All async `setState` calls guarded by an `_isMounted` flag, eliminating
  the React warning when a component unmounts during an in-flight fetch.

### Removed
- `dist/facevault-kyc-view.js` is no longer committed to git. The bundle
  is built by CI and published as a release asset; committing it
  invited drift between source and built artefact.

### Fixed
- LICENSE copyright updated to `Kaditham Holdings Pte Ltd` and uses the
  `2026-present` form so future-year additions don't need a date bump.
- `.gitignore` expanded to cover `dist/`, `coverage/`, OS cruft, and
  editor scratch.

## [v2.0.5] — 2026-05-14

### Added
- React error boundary at the top of the webview so a render exception
  can never break the host HollaEx page. Falls back to a small
  "temporarily unavailable" notice and logs the original error.
- Origin allowlist on the upgrade-now flow. The marketplace JSON URL
  is now verified against `github.com` / `facevault.id` before fetch
  + clipboard write, so a compromised manifest endpoint can't trick
  an admin into pasting attacker-controlled content into HollaEx admin.
- Jest test suite for the kit-state, version-compare, and trust-allowlist
  helpers (34 tests). Wired into CI before the release build.

### Changed
- Verify CTA is now a real `<button>` (was an `<a>` styled as one). Fixes
  the case where the disabled-looking pending state was still navigable.
- Upgrade-now button shows a working state and disables itself while a
  fetch is in flight, preventing duplicate submissions.
- Banner dismiss now also clears the "copied" indicator so it doesn't
  reappear stale when the banner returns next session.
- Misleading "processed on-premises" copy corrected to reflect the
  hosted-page architecture: "processed on FaceVault's secure
  infrastructure".
- Decorative SVG icons marked `aria-hidden`, contrast bumped on subtle
  text (note + chip + meta) to clear WCAG AA.

### Fixed
- README no longer links to a non-existent `v1.4.3` release. Legacy
  in-process plugin path removed — the webhook glue covers both
  HollaEx Cloud and self-hosted.
- Dead `pollError` state removed.

## [v2.0.4] — 2026-05-14

### Added
- **In-app plugin update detection.** Webview fetches a manifest from
  `api.facevault.id/api/v1/integrations/hollaex/manifest` on each render
  and compares the released `latest_version` to the new `installed_version`
  baked into `web_view[0].meta`. Admin users on stale versions see an
  upgrade banner with one-click clipboard copy + operator-panel deep link.
  Regular exchange users see no change.
- `installed_version` field in every generated JSON's `web_view[0].meta`,
  sourced from `package.json` at build time.

### Notes
- Pre-v2.0.4 installs have no `installed_version` in their JSON. The new
  bundle treats missing as `0.0.0` so the first cohort sees the banner
  once, upgrades, and never sees a phantom banner again.
- The manifest endpoint is server-side cached (10-min TTL) and degrades
  gracefully on GitHub API outages — the plugin keeps working normally.

## [v2.0.3] — 2026-05-13

### Fixed
- Blank tab strip on certain HollaEx kit versions: moved the localization
  string/icon registries from inline `value` into the kit-native lookup-key
  + `strings`/`icons` shape.
- Stock identity tab no longer renders alongside our tab. Plugin `type`
  is now `external_kyc` (outside the kit's stock-tab whitelist) instead
  of `kyc`, so HollaEx doesn't auto-mount its "page under construction"
  placeholder next to ours.

## [v2.0.2] — 2026-04-30

### Fixed
- Marketplace bundle slug lookup against HollaEx kit state — bundle now
  checks both `props.plugins` and `props.enabledPlugins`, since different
  kit versions expose plugin configs in different keys.

## [v2.0.1] — 2026-04-22

### Changed
- Slimmed `public_meta` to just `slug`. `hosted_base` / `api_base` no
  longer appear in the operator's HollaEx Configure UI — they only need
  to be overridden by self-hosted FaceVault deployments, which can edit
  `web_view[0].meta` directly in the JSON before installing.

## [v2.0.0] — 2026-04-17

### Added
- **Webview-only architecture** (Cloud-compatible). Verification runs
  end-to-end on FaceVault's hosted page; the embedded webview is a
  branded launcher + status poller. No plugin server scripts — works
  on HollaEx Cloud (which blocks `/plugins/*` server routes) and on
  self-hosted kits.
- Marketplace template (`facevault-kyc.marketplace.json`) for HollaEx
  App Store installation, with operator-configurable slug in `public_meta`.

### Changed
- Removed `server.js` and all in-process webhook handling. Self-hosted
  operators who want in-process verification-level flipping should pin
  to v1.4.3 (see README "Auto-flipping user verification level").

## [v1.0.1] — 2026-04-08

### Fixed
- Webapp URL pattern (`?sid=&st=`) and a build.js regression that produced
  a malformed JSON for non-dashboard installs.

[v2.0.7]: https://github.com/khreechari/facevault-hollaex/releases/tag/v2.0.7
[v2.0.6]: https://github.com/khreechari/facevault-hollaex/releases/tag/v2.0.6
[v2.0.5]: https://github.com/khreechari/facevault-hollaex/releases/tag/v2.0.5
[v2.0.4]: https://github.com/khreechari/facevault-hollaex/releases/tag/v2.0.4
[v2.0.3]: https://github.com/khreechari/facevault-hollaex/releases/tag/v2.0.3
[v2.0.2]: https://github.com/khreechari/facevault-hollaex/releases/tag/v2.0.2
[v2.0.1]: https://github.com/khreechari/facevault-hollaex/releases/tag/v2.0.1
[v2.0.0]: https://github.com/khreechari/facevault-hollaex/releases/tag/v2.0.0
[v1.0.1]: https://github.com/khreechari/facevault-hollaex/releases/tag/v1.0.1
