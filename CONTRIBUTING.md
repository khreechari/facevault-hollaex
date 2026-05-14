# Contributing

Thanks for taking the time to contribute! This plugin is small but
load-bearing for FaceVault's HollaEx integrations, so we ask for a bit
of rigour to keep it stable.

## Repo layout

- `web/views/Main.js` — React component embedded in the HollaEx kit.
- `web/views/utils.js` — pure helpers (kit-state mapping, version
  compare, trust allowlist). Anything testable in isolation lives here.
- `web/views/__tests__/` — Jest unit tests.
- `build.js` — produces `facevault-kyc.json` (dashboard) and
  `facevault-kyc.marketplace.json` (App Store).
- `webpack.config.js` — bundles `web/views/Main.js` into
  `dist/facevault-kyc-view.js`.
- `.github/workflows/release.yml` — on tag push, runs tests, builds the
  three artefacts plus checksums, and publishes them as GH release assets.

## Local development

```bash
git clone https://github.com/khreechari/facevault-hollaex.git
cd facevault-hollaex
npm install
npm test            # runs the Jest suite
node build.js                 # writes facevault-kyc.json
node build.js --marketplace   # writes facevault-kyc.marketplace.json
npx webpack                   # writes dist/facevault-kyc-view.js
```

`dist/` is git-ignored — the bundle is produced by CI on release and
attached to the GitHub release. Don't commit it.

## Pull requests

- One topic per PR. If the change touches the React component and the
  build script, split it.
- Add or update tests when touching anything in `utils.js` — the
  existing suite is the safety net that catches HollaEx kit-state
  regressions (which have shipped to prod twice).
- Bump `package.json` `version` and add a `CHANGELOG.md` entry only
  if you are explicitly cutting a release.
- Keep the public surface of `web_view[0].meta` stable. Adding new
  fields is fine; renaming or removing existing ones breaks every
  installed JSON in the wild.

## Code style

- Stick to the existing style: 2-space tabs in JS files (matches the
  rest of the repo), single quotes, semicolons.
- New helpers go in `utils.js` rather than as private methods on the
  React component, so they remain testable.
- Comments should explain *why*, not *what*. The `Main.js` header is a
  good reference for tone.
- Avoid runtime dependencies. The webview is loaded inside an arbitrary
  exchange's page; every byte and every imported module increases the
  blast radius if a dependency goes bad. The current zero-runtime-deps
  setup is intentional.

## Reporting a security issue

See [SECURITY.md](SECURITY.md). Please do not open public issues for
security-relevant bugs.

## License

By contributing you agree your contribution will be licensed under the
[MIT License](LICENSE) — the same as the rest of the project.
