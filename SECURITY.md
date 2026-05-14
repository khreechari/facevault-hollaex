# Security Policy

## Reporting a vulnerability

If you believe you have found a security issue in the FaceVault HollaEx
plugin or the FaceVault services it depends on (manifest endpoint,
hosted verification page, status polling endpoint), please **do not open
a public GitHub issue**.

Instead, email **security@facevault.id** with:

- A description of the issue and its impact.
- Reproduction steps or a proof-of-concept.
- Affected version (run `node -e "console.log(require('./package.json').version)"`
  in your clone, or check `web_view[0].meta.installed_version` in the
  installed JSON).
- Whether you have already disclosed the issue elsewhere.

We will acknowledge receipt within **3 business days** and aim to ship
a fix within **30 days** for high-severity issues. We will credit you in
the release notes unless you ask to remain anonymous.

## Scope

In scope:

- This plugin's webview bundle and JSON templates.
- The `/api/v1/integrations/hollaex/manifest` endpoint that the bundle
  polls for update detection.
- The `/api/v1/external_users/status` endpoint used for status polling.
- The hosted verification page at `facevault.id/v/<slug>`.

Out of scope:

- HollaEx core kit issues (report to the upstream HollaEx team).
- Operator misconfiguration (e.g. an exchange exposing its own admin
  panel to the public internet).
- DoS / volumetric attacks — the endpoints are rate-limited at the
  edge.
- Theoretical issues without a demonstrated impact path.

## Supply chain

- All GitHub Actions used in the release workflow are SHA-pinned.
- Release artefacts include an unsigned `SHA256SUMS.txt`. We are
  evaluating sigstore signing for a future release.
- The webview bundle is served from `facevault.id` with
  `Cache-Control: no-store` so a compromised cached entry cannot
  persist after we ship a fix.
