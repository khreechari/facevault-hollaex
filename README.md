# FaceVault KYC Plugin for HollaEx

AI-powered identity verification for HollaEx-powered exchanges. Replace manual KYC review or cloud providers (Sumsub, iDenfy, Onfido) with FaceVault — flat pricing, no annual contracts, self-hosted option for enterprise.

## Features

- AI face matching (ArcFace cosine similarity)
- Document OCR & MRZ extraction (passports, IDs, licences)
- 15-signal document fraud detection
- Liveness detection & anti-spoofing
- Optional proof of address verification
- Encrypted at rest (AES-256-GCM)
- GDPR-compliant with configurable data retention

## Quick Start

### 1. Get a FaceVault API key

Sign up at [facevault.id](https://facevault.id) or self-host FaceVault on your own server.

### 2. Install the plugin

**Option A — Upload JSON:**

```bash
cd integrations/hollaex
node build.js
# Upload facevault-kyc.json via HollaEx Operator Control Panel → Plugins
```

**Option B — HollaEx CLI:**

```bash
hollaex plugin --install --file facevault-kyc.json
```

### 3. Configure

In the HollaEx Operator Control Panel → Plugins → FaceVault KYC:

| Setting | Description |
|---------|-------------|
| `api_key` | Your FaceVault API key (`sk_live_...`) |
| `api_url` | FaceVault API URL (default: `https://facevault.id`) |
| `webhook_secret` | Webhook signing secret from your FaceVault dashboard |
| `verified_level` | HollaEx user level to assign on successful KYC (default: `2`) |
| `require_poa` | Require proof of address document (default: `false`) |

### 4. Set up webhook

In your FaceVault dashboard, set the webhook URL to:

```
https://your-exchange.com/plugins/facevault/webhook
```

## How It Works

```
User clicks "Verify" on exchange
        ↓
Plugin creates FaceVault session (POST /api/v1/sessions)
        ↓
User redirected to FaceVault KYC webapp
        ↓
User scans ID → liveness check → selfie → (optional PoA)
        ↓
FaceVault processes: face match, OCR, fraud detection, anti-spoofing
        ↓
Webhook fires to /plugins/facevault/webhook (HMAC-signed)
        ↓
Plugin updates HollaEx user verification level
```

## Verification Flow

1. **ID Document** — Auto-scan with edge detection, perspective correction, OCR/MRZ extraction
2. **Tilt Challenge** — Prove the document is physical (not a screen photo)
3. **Liveness Check** — Turn head left → center (anti-spoofing)
4. **Selfie** — Face match against ID photo (ArcFace, threshold 0.45)
5. **Proof of Address** (optional) — Utility bill / bank statement with name cross-check

## Trust Scoring

FaceVault returns a 0-100 trust score with a decision:

| Score | Decision | Plugin Action |
|-------|----------|--------------|
| ≥ 70 | Accept | Upgrades user to `verified_level` |
| 40-69 | Review | Marks as pending (status 1) |
| < 40 | Reject | Marks as rejected (status 2) |

## Development

```bash
# Build the plugin JSON
npm run build

# Build minified
npm run build:minify
```

### Plugin structure

```
facevault-hollaex/
├── config.json         # Plugin metadata & configuration schema
├── server.js           # Express routes (session, webhook, status)
├── web/views/Main.js   # React component for the verification page
├── build.js            # Generates uploadable plugin JSON
├── package.json
└── README.md
```

## Self-Hosted FaceVault

For operators who want to run FaceVault on their own infrastructure:

```bash
# Pull and run FaceVault (Docker)
docker compose up -d

# Set api_url in plugin config to your self-hosted URL
# e.g., https://kyc.your-exchange.com
```

With self-hosted FaceVault, all biometric data stays on your servers. No third-party AI APIs (AWS, Google, Azure).

## License

MIT — Plugin code is open source. FaceVault platform is commercially licensed.
