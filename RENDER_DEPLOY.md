# Render Deployment Guide for Vertex Legacy Staging

## Prerequisites
1. Render account (free tier available, no credit card required)
2. GitHub repo connected to Render
3. PayMongo account (for GCash payments)
4. Xendit account (for payouts)

## Quick Deploy (5 minutes)

### 1. Push to GitHub
```bash
git add .
git commit -m "feat: payment providers + staging config"
git push origin master
```

### 2. Create Render Services
1. Go to https://dashboard.render.com
2. **New → Blueprint** → Connect your GitHub repo
3. Render detects `render.yaml` and creates:
   - `vertex-legacy-api` (Web Service, Docker)
   - `vertex-legacy-db` (PostgreSQL)
   - `vertex-legacy-redis` (Redis)

### 3. Add Secrets (In Render Dashboard)
For `vertex-legacy-api` service → Environment → Add Secret:

| Key | Value | Source |
|-----|-------|--------|
| `DATABASE_URL` | Auto-filled | From `vertex-legacy-db` |
| `REDIS_URL` | Auto-filled | From `vertex-legacy-redis` |
| `PAYMONGO_SECRET_KEY` | `sk_test_...` | PayMongo Dashboard → Settings |
| `PAYMONGO_WEBHOOK_SECRET` | `whsec_...` | PayMongo Dashboard → Webhooks |
| `XENDIT_SECRET_KEY` | `xnd_development_...` | Xendit Dashboard → Settings |
| `XENDIT_WEBHOOK_TOKEN` | `...` | Xendit Dashboard → Webhooks |
| `MOCK_PROVIDER_WEBHOOK_SECRET` | `openssl rand -hex 32` | Generate locally |
| `MOCK_SESSION_SECRET` | `openssl rand -hex 32` | Generate locally |

### 4. Configure Webhooks

**PayMongo Dashboard** → Webhooks:
- URL: `https://vertex-legacy-api.onrender.com/v1/providers/webhook`
- Events: `source.chargeable`, `payment.paid`, `payment.failed`

**Xendit Dashboard** → Webhooks:
- URL: `https://vertex-legacy-api.onrender.com/v1/providers/webhook`
- Events: `invoice.paid`, `invoice.expired`, `disbursement.completed`, `disbursement.failed`

### 5. Deploy
Click **Deploy** in Render. First deploy takes ~5-10 minutes.

### 6. Verify
```bash
curl https://vertex-legacy-api.onrender.com/v1/health
# {"status":"ok","service":"vertex-legacy-api","moneyMovement":"sandbox"}

curl https://vertex-legacy-api.onrender.com/v1/public/plans
# Returns VIP 1-10 with dailyPayoutCentavos, totalReturnCentavos

curl https://vertex-legacy-api.onrender.com/v1/public/commission-levels
# Returns 3 levels: 27%, 2%, 1%
```

### 6. Deploy Web App (Cloudflare Workers)
The Linux OpenNext artifact is already built:

```bash
# Option A: Cloudflare Dashboard (recommended)
# 1. Workers & Pages → Create application → Worker
# 2. Name: vertex-legacy-staging
# 3. Build: corepack pnpm --filter @vertex/web run deploy

# Option B: Wrangler CLI
corepack pnpm --filter @vertex/web run deploy
```

Set these in Cloudflare Worker vars:
- `AUTH_PROVIDER=mock`
- `INTERNAL_API_URL=https://vertex-legacy-api.onrender.com/v1`
- `NEXT_PUBLIC_API_URL=https://vertex-legacy-api.onrender.com/v1`
- `WEB_ORIGIN=https://vertex-legacy-staging.pages.dev`

## Test Real Payments

### Deposit (GCash via PayMongo)
```bash
# 1. Create deposit
curl -X POST https://vertex-legacy-api.onrender.com/v1/deposits \
  -H "Authorization: Bearer <token>" \
  -H "Idempotency-Key: <uuid>" \
  -d '{"amount": "250.00"}'

# 2. Opens GCash checkout URL
# 3. After payment, webhook auto-completes deposit
```

### Withdrawal (GCash via Xendit)
```bash
# 1. Add payout account (GCash)
curl -X POST https://vertex-legacy-api.onrender.com/v1/me/payout-accounts \
  -H "Authorization: Bearer <token>" \
  -d '{"institutionName":"GCash","accountHolderName":"Test User","accountIdentifier":"09123456789"}'

# 2. Request withdrawal
curl -X POST https://vertex-legacy-api.onrender.com/v1/withdrawals \
  -H "Authorization: Bearer <token>" \
  -H "Idempotency-Key: <uuid>" \
  -d '{"amount":"150.00","payoutAccountId":"<id>","mfaCode":"123456"}'

# 3. Admin approves → Xendit disbursement → GCash receives funds
```

## Costs (Free Tier Limits)
| Resource | Limit |
|----------|-------|
| Web Service | 750 hrs/mo (sleeps after 15 min idle) |
| PostgreSQL | 90 days free, then $7/mo |
| Redis | 25 MB free |
| Bandwidth | 100 GB/mo |

## Production Migration
When ready for production:
1. Upgrade Render plan
2. Set `PAYMENT_PROVIDER=paymongo`, `PAYOUT_PROVIDER=xendit`, `KYC_PROVIDER=licensed`
3. Use Auth0 instead of mock auth
4. Configure real webhook secrets