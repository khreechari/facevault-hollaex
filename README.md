# FaceVault KYC Plugin for HollaEx

[![CI](https://github.com/kaditham-technologies/facevault-hollaex/actions/workflows/ci.yml/badge.svg)](https://github.com/kaditham-technologies/facevault-hollaex/actions/workflows/ci.yml)

AI-powered identity verification for HollaEx-powered exchanges. Replace manual KYC review or cloud providers (Sumsub, iDenfy, Onfido) with FaceVault — flat pricing, no annual contracts, self-hosted option for enterprise.

- [Integration guide](https://facevault.id/integrations)
- [Blog post](https://facevault.id/blog/hollaex-kyc-plugin)

## Features

- AI face matching (ArcFace cosine similarity)
- Document OCR & MRZ extraction (passports, IDs, driver's licences)
- 15-signal document fraud detection
- Liveness detection & multi-signal anti-spoofing fusion
- Optional proof of address verification
- Encrypted at rest (AES-256-GCM)
- GDPR-compliant with configurable data retention

## Architecture (v2 — Cloud-compatible)

This plugin is a **branded launcher**. Verification runs end-to-end on FaceVault's hosted page (`/v/<your-slug>`); the embedded webview is purely a verify button + status display. There are no plugin server scripts, so it works on **HollaEx Cloud** (which blocks `/plugins/*` server routes) and on self-hosted kits.

The webview reads its operator-specific slug from the props HollaEx passes in — either `web_view[0].meta` (when the JSON is dashboard-generated with a baked slug) or `public_meta.slug` (when it's the generic marketplace JSON and the operator typed their slug into HollaEx's Configure UI). The bundle accepts both shapes from a single source. Verification results are polled from `https://facevault.id/api/v1/external_users/status` — no operator-side server code required.

## What works on HollaEx Cloud + self-hosted

- Full end-to-end verification (face match, document OCR, liveness, anti-spoofing)
- Branded hosted page with the operator's logo, accent color, and copy
- Status badge in the user's KYC tab updates live as the verification completes (passed / under review / failed)
- Operator sees every completed session in the FaceVault dashboard
- Webhook delivery (Starter+ tier) to the operator's own endpoint with full result payload
- **Auto-flipping the HollaEx user's verification level on accept** — via the webhook glue below (Cloud + self-hosted)

## Install

Two ways to install. Pick whichever matches how you obtained the plugin.

### Option A: Dashboard download (recommended)

1. **Sign up** at [devdash.facevault.id](https://devdash.facevault.id) (free tier: 50 verifications/month).
2. **Create a hosted page**: Dashboard → Hosted Verification → Add Site. Set a slug (e.g. `acme-exchange`) and brand the page.
3. **Generate the plugin**: on the same site card, click the ⋮ menu → "HollaEx plugin…" → Download.
4. **Install in HollaEx**: Operator Control Panel → Plugins → Add Third Party Plugin → paste the downloaded JSON.
5. **Activate** the plugin and reload your exchange. Users see "Verify Identity" in their KYC tab. No further configuration needed — the slug + origins are baked into the JSON.

### Option B: HollaEx Marketplace install

If you installed FaceVault from HollaEx's App Store — or want the generic JSON without signing up first — the plugin ships with a configurable `slug` field in `public_meta`.

Direct download (latest):

- [`facevault-kyc.marketplace.json`](https://github.com/kaditham-technologies/facevault-hollaex/releases/latest/download/facevault-kyc.marketplace.json) — always points at the latest release. Also mirrored at [`facevault.id/facevault-kyc.marketplace.json`](https://facevault.id/facevault-kyc.marketplace.json).

After installing it in HollaEx:

1. **Sign up** at [devdash.facevault.id](https://devdash.facevault.id) and create a hosted-verification site (just for the slug — you don't have to download a JSON).
2. In your HollaEx Operator Control Panel, open the FaceVault plugin's **Configure** dialog and paste your slug into the `slug` field. (Self-hosted FaceVault deployments: override `hosted_base` / `api_base` by editing `web_view[0].meta` in the JSON directly before installing.)
3. Save and activate. The plugin reads the slug from `public_meta` at runtime.

## Staying up to date (v2.0.4+)

The webview self-checks for plugin updates. On every render it fetches
[`api.facevault.id/api/v1/integrations/hollaex/manifest`](https://api.facevault.id/api/v1/integrations/hollaex/manifest)
and compares the released `latest_version` against the `installed_version`
baked into your JSON's `web_view[0].meta`. When the installed JSON is behind:

- **Operators / admins** see an upgrade banner above the verify button:
  *"Plugin update available — vX.Y.Z"*. They're detected via HollaEx
  `user.is_admin === true`, or — on HollaEx Cloud, which exposes no `is_admin`
  flag — a role whose `user.permissions` include an `/admin/…` entry.
- **Regular exchange users** see nothing change.

Clicking **Update now** fetches the latest marketplace JSON from the GitHub
release, copies it to the operator's clipboard, and opens the HollaEx
operator panel in a new tab. The operator pastes the JSON into
Plugins → Add Third Party Plugin (or Edit) and saves.

By default the upgrade flow opens `<exchange>/operator/`. If your HollaEx
kit serves admin from a different path, override it by adding
`"operator_path": "/admin/"` to `web_view[0].meta` in your installed
JSON. Only same-origin absolute paths are accepted.

Clicking **What's new** opens the changelog on this repo's release page.
Per-session dismissal is supported (banner returns next visit until you
actually update). New versions re-prompt automatically.

If the manifest endpoint can't be reached — CSP/CORS on a self-hosted
exchange, network blip, GitHub outage — the banner silently doesn't show
and the plugin behaves normally. The manifest is cached server-side and
falls back to stale data during GH outages, so transient errors don't
break operator dashboards.

## Capacity

- **30 verification starts per (operator, IP) per hour** — corporate NATs verifying compliance teams in batch are fine.
- **Daily verification cap** is configurable per site in the FaceVault dashboard.
- **Monthly tier limits** apply (free 50 / starter 500 / pro 5,000).
- Cloudflare Turnstile is enabled by default on hosted pages — bot traffic is filtered before it reaches the verification flow.

## Auto-flipping user verification level

Promote users from level 1 → 2 (or whatever target tier) when FaceVault returns `accept` by running a small webhook receiver. It takes FaceVault's webhook, verifies the HMAC, and calls HollaEx's admin API to flip the user's verification level. Works on HollaEx Cloud and self-hosted. Cloudflare Workers shown below; any serverless platform (Lambda, Cloud Run, plain Express) works.

```js
// Cloudflare Worker — facevault-to-hollaex glue
//
// Env vars:
//   FV_WEBHOOK_SECRET    — from your FaceVault site (revealed once on creation)
//   HOLLAEX_API_URL      — e.g. https://yourexchange.hollaex.com/v2
//   HOLLAEX_ADMIN_TOKEN  — HollaEx admin bearer token (HMAC-signed JWT)
//   VERIFIED_LEVEL       — target HollaEx verification level (default 2)

export default {
  async fetch(request, env) {
    if (request.method !== 'POST') return new Response('method not allowed', { status: 405 });

    const sig = request.headers.get('x-facevault-signature') || '';
    const raw = await request.text();
    if (!(await verifyHmac(env.FV_WEBHOOK_SECRET, raw, sig))) {
      return new Response('bad signature', { status: 401 });
    }

    const event = JSON.parse(raw);
    if (event.event !== 'verification.completed') return new Response('ignored', { status: 200 });

    // external_user_id = "hollaex_<numeric_id>" — set by the FaceVault plugin webview
    const m = (event.external_user_id || '').match(/^hollaex_(\d+)$/);
    if (!m) return new Response('not a hollaex session', { status: 200 });
    const userId = parseInt(m[1], 10);

    const accepted = event.status === 'passed' && event.trust_decision === 'accept';
    if (!accepted) return new Response('not accepted', { status: 200 });

    // HollaEx admin API: POST /v2/admin/upgrade-user
    // (controller: server/api/controllers/admin.js → upgradeUser → toolsLib.user.changeUserVerificationLevelById)
    const target = parseInt(env.VERIFIED_LEVEL || '2', 10);
    const res = await fetch(`${env.HOLLAEX_API_URL}/admin/upgrade-user`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.HOLLAEX_ADMIN_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ user_id: userId, verification_level: target }),
    });
    return new Response(await res.text(), { status: res.status });
  },
};

async function verifyHmac(secret, body, hexSig) {
  // FaceVault signs the exact bytes it sends (sha256-hex). HMAC the RAW body —
  // do not JSON.parse + re-stringify, which can change the bytes (non-ASCII
  // escaping, number formatting) and reject valid webhooks. The final
  // comparison is constant-time (XOR loop, never short-circuits) so an
  // attacker can't probe the expected signature byte-by-byte via response
  // timing. If you're on a Node/Express stack instead of a Worker, prefer
  // `import { verifySignature } from 'facevault'` from the published npm
  // package — same crypto, same constant-time guarantee, one line.
  if (typeof hexSig !== 'string' || hexSig.length === 0) return false;
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  const expected = [...new Uint8Array(mac)].map(b => b.toString(16).padStart(2, '0')).join('');
  if (expected.length !== hexSig.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ hexSig.charCodeAt(i);
  }
  return diff === 0;
}
```

Point your FaceVault site's webhook URL at this Worker. Verifications that complete with `trust_decision: accept` will auto-flip the HollaEx user level.

## Building from source

```bash
git clone https://github.com/kaditham-technologies/facevault-hollaex.git
cd facevault-hollaex
npm install
node build.js               # facevault-kyc.json (generic template)
node build.js --marketplace # facevault-kyc.marketplace.json (HollaEx App Store shape)
npx webpack                 # rebuild webview bundle (writes dist/facevault-kyc-view.js)
```

The dashboard-baked JSON (Option A) is the preferred path for most operators — zero HollaEx-side config and origins are pre-locked to your exchange. The generic `facevault-kyc.marketplace.json` (Option B) is the App Store install — same plugin, but you type your slug in HollaEx → Plugins → Configure after install.

## Support

- Email: [support@facevault.id](mailto:support@facevault.id)
- Docs: [facevault.id/docs](https://facevault.id/docs)
- Issues: [github.com/kaditham-technologies/facevault-hollaex/issues](https://github.com/kaditham-technologies/facevault-hollaex/issues)

## License

MIT
