# Changelog

All notable changes to the FaceVault HollaEx plugin.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[v2.0.4]: https://github.com/khreechari/facevault-hollaex/releases/tag/v2.0.4
[v2.0.3]: https://github.com/khreechari/facevault-hollaex/releases/tag/v2.0.3
[v2.0.2]: https://github.com/khreechari/facevault-hollaex/releases/tag/v2.0.2
[v2.0.1]: https://github.com/khreechari/facevault-hollaex/releases/tag/v2.0.1
[v2.0.0]: https://github.com/khreechari/facevault-hollaex/releases/tag/v2.0.0
[v1.0.1]: https://github.com/khreechari/facevault-hollaex/releases/tag/v1.0.1
