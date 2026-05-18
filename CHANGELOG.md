# Changelog

All notable changes to the FaceVault HollaEx plugin.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [v2.0.14] — 2026-05-18

### Fixed

- **Manual-review verdicts now reach the user without a reload.** The status
  poller treated `in_review` as terminal and stopped; a later
  reviewer accept/reject was never re-fetched, so the webview showed
  "Under review" forever unless the user manually reloaded. `in_review`
  is no longer terminal — the poll loop continues through it (still
  bounded by the 30-min deadline + error backoff, paused on
  `document.hidden`) and stops only on a truly final `passed`/`failed`.
  On visibility regain it restarts a fresh bounded window if the previous
  one lapsed, so a verdict decided while the tab was backgrounded still
  surfaces.
- **Signed-poll token is now actually consumed.** Across real HollaEx
  KYC the `fv_poll_token` postMessage was delivered to the opener and
  passed every guard, but the bundle never switched to `?token=` (it
  polled legacy `?slug=` and stopped at `in_review`). Two causes fixed:
  (1) the token-capture `message` listener and the popup handle now live
  on a module-scoped channel that survives a HollaEx mid-flow
  unmount/remount of the webview (instead of dying with the React
  instance and never re-arming) — so it stays installed for the entire
  life of the verify popup, torn down only on token capture or popup
  close, never on a timer/visibility/step change; (2) on token receipt
  the poll loop is (re)started so the token is consumed even if the loop
  had already exited. `e.origin` is matched exactly against the hosted
  origin and `e.source` stays strictly the original `window.open()`
  handle (preserved across remounts by the module channel). Legacy
  `(slug, external_user_id)` polling remains a true fallback only —
  used when no token ever arrives.



### Added

- **Signed-poll token support.** The verify popup is now opened with an
  opener (named `fvkyc_verify` window, no `noopener,noreferrer`) so the
  FaceVault hosted `/v/<slug>/done` page can `postMessage` a short-lived,
  session-bound `fv_poll_token` back to the plugin. A strictly gated,
  one-shot `message` listener accepts it only when `e.origin` equals the
  configured `hosted_base` origin, `e.source` is the exact popup handle,
  `data.type === 'fv_poll_token'`, and the token is a string under 1 KB;
  any failing check is ignored and never throws. Once held, status polling
  uses `?token=` (bound to the unguessable session id) instead of the
  guessable `?slug=&external_user_id=`, closing an unauthenticated
  enumeration vector on the public status endpoint.

### Changed

- `_launchVerify` is the only `window.open` whose flags changed; the
  upgrade/changelog `window.open`s keep `noopener,noreferrer`.

### Compatibility

- Fully backward compatible. The legacy `(slug, external_user_id)` poll
  keeps running from launch and is the automatic fallback, so operators on
  the old API/site — or any popup that never delivers a token (blocked,
  closed early) — are unaffected. Operators re-paste the updated plugin
  JSON once (same one-time action as the v2.0.8 icon fix).
  `require_signed_poll` must not be enabled for a tenant until that tenant
  has re-pasted this version and a verification has been confirmed
  end-to-end on the `?token=` path.

## [v2.0.12] — 2026-05-17

### Changed

- **Webview UI/UX redesign.** The verification panel is now a self-contained,
  theme-locked card (owns its background, text colour, and font) so it
  renders identically on a light or dark HollaEx kit instead of inheriting
  unpredictable host styles. Stronger typographic hierarchy with explicit
  colours (no more opacity-as-hierarchy), a gradient-stroked shield mark,
  a neutral first-run status (a brand-new user no longer sees an alarming
  red "Not Verified"), a three-step process row (Document → Face match →
  Liveness) replacing the ghosted feature chips, a tactile gradient CTA
  with hover/active/focus states, an animated "Identity verified" state,
  and a security footer. Hover/motion come from a single scoped, injected
  `<style>` (selectors namespaced under `.fvkyc-root`, keyframes gated
  behind `prefers-reduced-motion`); all layout/colour remain inline so the
  component still renders correctly if a strict host CSP blocks the tag.

- **"Update now" copies the install URL, not the JSON.** HollaEx Cloud's
  "Manually upgrade" dialog has no paste-JSON field — only "upload a JSON"
  or "input url path". The banner now copies the marketplace JSON *URL*
  (paste straight into the Input URL path field), shows that URL as
  selectable text as a clipboard-blocked fallback, and still opens the
  operator panel. No JSON is fetched client-side anymore. The
  `isTrustedMarketplaceUrl` allowlist still gates it — arguably more
  important now that the operator hands the URL to HollaEx's installer.

- Webview bundle cache-buster bumped to `?v=10` (bundle changed).

## [v2.0.11] — 2026-05-17

### Added

- **Component render tests for the upgrade banner and clipboard flow.**
  `utils.test.js` covers the pure helpers, but the React component itself —
  the banner-gating booleans in `render()` and the `_handleUpgrade`
  clipboard / operator-panel deep link — had no automated guard, and every
  bug in the HollaEx Cloud upgrade-path work (admin gate, version pin, CORS
  fetch, `operator_path`) surfaced in exactly that code. A new
  `web/views/__tests__/Main.test.js` (jsdom) asserts: the banner is hidden
  for trading users and shown for operators only when a newer version
  exists, dismiss is version-scoped, the verify CTA is inert while review
  is pending, the error boundary renders its fallback on an inner throw,
  and `_handleUpgrade` refuses an untrusted `marketplace_json_url` while a
  trusted one copies the JSON and opens `/admin/plugins`.

### Changed

- Test-only devDependencies added (`react`, `react-dom`,
  `@testing-library/react`, `@testing-library/jest-dom`,
  `jest-environment-jsdom`). `react` / `react-dom` are externalised by
  webpack (peers of the HollaEx kit), so the shipped bundle is byte-for-byte
  unchanged and the cache-buster stays `?v=9`. No runtime dependency was
  added — the zero-runtime-deps posture is intact.

## [v2.0.10] — 2026-05-16

### Fixed

- **Upgrade-now landed on `/account` instead of the plugin page on
  HollaEx Cloud.** `web_view[0].meta.operator_path` was unset, so the
  bundle fell back to the open-source kit's `/operator/` route. HollaEx
  Cloud serves plugin management at `/admin/plugins` (confirmed on a
  live Cloud exchange); `/operator/` there just SPA-redirects to
  `/account`. Both the dashboard-generated JSON
  (`api/app/services/hollaex_plugin.py`) and the generic + marketplace
  templates now set `operator_path: /admin/plugins`, so after "Update
  now" copies the JSON the operator lands directly on the plugin page.
  Sanitised bundle-side to same-origin absolute paths only (unchanged).
  No webview/bundle change — cache-buster stays `?v=9`.

## [v2.0.9] — 2026-05-16

### Fixed

- **Upgrade banner never reached HollaEx Cloud operators.** The banner
  fetch and render were gated on `user.is_admin === true`. A live capture
  of an operator-Admin session on HollaEx Cloud (kit 2.17.6) confirmed the
  kit does **not** expose `user.is_admin` at all — operator status is
  carried by `user.permissions`, an array of `/admin/<area>:<verb>` strings
  the kit attaches only to users whose role matches a defined operator role
  (`server/api/controllers/user.js`). So the people who can actually act on
  a plugin upgrade were exactly the ones the gate excluded. The manifest
  fetch is now gated on slug only (it is cheap — server-side Redis-cached,
  one request per mount); the banner *render* uses a new
  `isOperatorOrAdmin` check that recognises the permissions array and still
  honours legacy `is_admin === true` for older / self-hosted kits.

- **Native "Manually upgrade" was a permanent no-op.** The plugin's
  top-level integer `version` was hardcoded to `1` on every release. The
  kit upgrades a plugin only when the submitted `version` differs from the
  installed one (`server/plugins/controllers.js`: `if (plugin.version ===
  version) throw 'Version is already installed'` — a strict-equality check,
  not ordered, and not used for marketplace identity, which is name + type).
  With `version` pinned at `1`, every "Manually upgrade" returned "version
  already installed". `version` is now derived monotonically from the
  semver (`major*10000 + minor*100 + patch`; 2.0.9 → `20009`) in both
  `build.js` and the dashboard JSON generator
  (`api/app/services/hollaex_plugin.py`), so native upgrade works for the
  entire existing operator base (all currently on `version: 1`) and stays
  correct for every future release.

### Changed

- Webview bundle cache-buster bumped to `?v=9` (bundle changed).

## [v2.0.8] — 2026-05-15

### Fixed
- **Tab strip icon, take two — the v2.0.7 fix didn't hold.** Appending
  `#shield.svg` to the `data:` URI did flip the kit's `.svg` substring
  check and route the icon into react-inlinesvg instead of `<img>` — but
  react-inlinesvg *fetches* the icon string, and it can't fetch a `data:`
  URI, so it silently left the tab placeholder un-injected (DOM-confirmed
  on HollaEx kit 2.17.6). Replaced the inline base64 data URI with a real
  hosted asset, `https://facevault.id/plugins/facevault-shield.svg`
  (served with `access-control-allow-origin: *` since the kit fetches it
  cross-origin; `.svg` extension kept so the kit still routes it to the
  injector). The SVG ships as a release asset and `sync-hollaex-plugin.sh`
  deploys it beside the bundle.

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
