# FaceVault KYC Plugin for HollaEx

AI-powered identity verification for HollaEx-powered exchanges. Replace manual KYC review or cloud providers (Sumsub, iDenfy, Onfido) with FaceVault — flat pricing, no annual contracts, self-hosted option for enterprise.

- [Blog post](https://facevault.id/blog/hollaex-kyc-plugin)
- [Integration guide](https://facevault.id/integrations)

## Features

- AI face matching (ArcFace cosine similarity, 99.7% accuracy)
- Document OCR & MRZ extraction (passports, IDs, driver's licences)
- 15-signal document fraud detection with tilt challenge
- Liveness detection & 11-signal anti-spoofing fusion
- Optional proof of address verification
- Encrypted at rest (AES-256-GCM)
- GDPR-compliant with configurable data retention
- Webhook replay protection (signed_at timestamp)

## Quick Start

### 1. Get a FaceVault API key

Sign up at [devdash.facevault.id](https://devdash.facevault.id). Free tier includes 50 verifications/month.

### 2. Install the plugin

**Option A — Upload JSON:**

Download [`facevault-kyc.json`](https://raw.githubusercontent.com/khreechari/facevault-hollaex/main/facevault-kyc.json) or build it yourself:

```bash
git clone https://github.com/khreechari/facevault-hollaex.git
cd facevault-hollaex
node build.js
# Upload facevault-kyc.json via HollaEx Operator Control Panel → Plugins → Add Third Party Plugin
```

**Option B — HollaEx CLI:**

```bash
hollaex plugin --install --file facevault-kyc.json
```

### 3. Configure

In the HollaEx Operator Control Panel → Plugins → FaceVault KYC:

| Setting | Description |
|---------|-------------|
| `api_key` | Your FaceVault API key (`fv_live_...`) |
| `api_url` | FaceVault API URL (default: `https://facevault.id`) |
| `webhook_secret` | Webhook signing secret from [devdash.facevault.id](https://devdash.facevault.id) |
| `verified_level` | HollaEx user level to assign on successful KYC (default: `2`) |
| `require_poa` | Require proof of address document (default: `false`) |

### 4. Set up webhook

In your FaceVault dashboard ([devdash.facevault.id](https://devdash.facevault.id)), set the webhook URL to:

```
https://your-exchange.com/plugins/facevault/webhook
```

## How It Works

```
User clicks "Verify" on exchange
        ↓
Plugin creates FaceVault session (POST /api/v1/sessions)
        ↓
User opens FaceVault KYC webapp in new tab
        ↓
User scans ID → tilt challenge → liveness check → selfie → (optional PoA)
        ↓
FaceVault processes: face match, OCR, fraud detection, anti-spoofing
        ↓
Webhook fires to /plugins/facevault/webhook (HMAC-signed)
        ↓
Plugin updates HollaEx user verification level
```

## Verification Steps

1. **ID Document** — Auto-scan with edge detection, perspective correction, OCR/MRZ extraction
2. **Tilt Challenge** — Tilt the card to prove it's physical (detects screen replay)
3. **Liveness Check** — Turn head left → center (anti-spoofing)
4. **Selfie** — Face comparison against ID photo (ArcFace neural network)
5. **Proof of Address** (optional) — Utility bill / bank statement with name cross-check

## Trust Scoring

FaceVault returns a 0-100 trust score with a decision:

| Score | Decision | Plugin Action |
|-------|----------|--------------|
| ≥ 70 | Accept | Upgrades user to `verified_level` |
| 40-69 | Review | Marks as pending (status 1) |
| < 40 | Reject | Marks as rejected (status 2) |

## Pricing

| Plan | Price | Included | Overage |
|------|-------|----------|---------|
| Free | $0 | 50/mo | — |
| Starter | $49/mo | 500/mo | $0.99 |
| Pro | $199/mo | 5,000/mo | $0.35 |
| Enterprise | Custom | Unlimited | — |

## Development

```bash
# Build the plugin JSON
node build.js

# Build minified
node build.js --minify
```

### Plugin structure

```
facevault-hollaex/
├── config.json         # Plugin metadata & configuration schema
├── server.js           # Express routes (session, webhook, status)
├── web/views/Main.js   # React component for the verification page
├── build.js            # Generates uploadable plugin JSON
├── facevault-kyc.json   # Pre-built plugin (ready to upload)
├── package.json
└── README.md
```

## Self-Hosted FaceVault

For enterprise operators who need biometric data on their own infrastructure, FaceVault can be self-hosted. Contact [support@facevault.id](mailto:support@facevault.id) for details.

Set `api_url` in plugin config to your self-hosted URL (e.g. `https://kyc.your-exchange.com`).

## Verify Download

```bash
sha256sum facevault-kyc.json
# d6b804cd6ef1619148c1b829247ce48018edb55d65e16eb840159e64ab15c50e
```

## License

MIT
