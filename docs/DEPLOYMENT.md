# Vertex Legacy deployment runbook

The supported deployment is a Cloudflare Worker for the Next.js application and a
Railway service for the NestJS API and PostgreSQL database. The current production URLs are:

- Web: `https://vertex-legacy.joshua27emmanuel30.workers.dev`
- API: `https://vertex-legacy-1.onrender.com/v1`
- Auth0 audience: `https://api.vertex-legacy.com`
- Auth0 callback: `https://vertex-legacy.joshua27emmanuel30.workers.dev/auth/callback`
- Auth0 logout URL: `https://vertex-legacy.joshua27emmanuel30.workers.dev`
- Auth0 web origin: `https://vertex-legacy.joshua27emmanuel30.workers.dev`

## Render build command

Render has pnpm available through Corepack, but its `/usr/bin` directory is read-only. Do not run `corepack enable` in the Render dashboard. Use:

```sh
corepack pnpm install --frozen-lockfile && corepack pnpm db:generate && corepack pnpm --filter @vertex/api build
```

Use this start command:

```sh
corepack pnpm --filter @vertex/database migrate:deploy && corepack pnpm --filter @vertex/database seed && corepack pnpm --filter @vertex/api start
```

## Safety boundary

Production keeps money movement fail-closed by default. `PAYMENT_PROVIDER=manual` selects the
GCash/Maya review workflow, but destination details are not exposed and requests are rejected
until `MANUAL_PAYMENTS_ENABLED=true`. Enable it only for approved business/merchant wallets after
the required legal, compliance, reconciliation, and operational approvals. Manual payouts are
separately fail-closed and require encrypted destinations plus two-person finance review. KYC
remains a `licensed` placeholder until its approved integration is available.

Never place Auth0 client/session secrets, provider credentials, database URLs, or webhook
secrets in Git, `wrangler.jsonc`, Docker build arguments, logs, or `NEXT_PUBLIC_*`
variables.

## Preflight

Run from the repository root:

    corepack pnpm install --frozen-lockfile
    corepack pnpm db:generate
    corepack pnpm typecheck
    corepack pnpm lint
    corepack pnpm test
    corepack pnpm test:e2e
    corepack pnpm build

`git diff --check` must also return cleanly. The database migration is additive; use
`prisma migrate deploy`, never `migrate reset`, against an existing environment.

## Railway API

The repository is linked to the Railway `production` environment and `api` service.
`railway.json` builds `Dockerfile.api` and checks `/v1/health`. Configure these names
through Railway's encrypted variable store:

| Variable | Requirement |
| --- | --- |
| `DATABASE_URL` | Railway PostgreSQL reference |
| `WEB_ORIGIN` | Exact production web origin, without a path |
| `AUTH_PROVIDER` | `auth0` |
| `AUTH0_DOMAIN` | Auth0 tenant domain |
| `AUTH0_AUDIENCE` | `https://api.vertex-legacy.com` |
| `PAYMENT_PROVIDER` | `manual` for the reviewed GCash/Maya workflow |
| `MANUAL_PAYMENTS_ENABLED` | `false` until approved business wallets and finance operations are ready |
| `GCASH_DESTINATION_NUMBER` | approved GCash for Business destination; exposed to signed-in users when enabled |
| `MAYA_DESTINATION_NUMBER` | approved Maya Business destination; exposed to signed-in users when enabled |
| `PAYOUT_PROVIDER` | `manual` for the reviewed GCash/Maya payout workflow |
| `MANUAL_PAYOUTS_ENABLED` | `true` only after finance operations are approved |
| `PAYOUT_ACCOUNT_ENCRYPTION_KEY` | 32-byte random value encoded as 64 hexadecimal characters |
| `KYC_PROVIDER` | `licensed` until a real adapter is implemented |

Railway injects `PORT`; do not hardcode a production port. Deploy the tested working tree:

    railway status
    railway up --service api --environment production --ci

Container startup applies migrations before starting NestJS. Production seeding creates only
roles/permissions, initial platform records, VIP plans, and commission rules. It does not
create demo identities, mock KYC records, demo payout accounts, or demo balances. Repeated
production seeds preserve administrator-selected configuration versions and plan/rule active
states.

Verify after deployment:

    curl.exe --silent --show-error --include https://vertex-legacy-1.onrender.com/v1/health

Expected before activation: HTTP 200 with `status: "ok"` and `moneyMovement: "disabled"`.
After deliberate activation, expect `moneyMovement: "manual-review"`.

### Manual GCash/Maya cash-in controls

1. User selects only GCash or Maya and creates an idempotent pending intent.
2. The API returns the configured destination. Only GCash receives the versioned QR asset.
3. User sends the exact amount and submits the wallet reference, sender name, and last four digits.
4. Deposit enters `AWAITING_REVIEW`; no balance or ledger entry changes.
5. A user with `deposit:review` compares the submission to the official receiving-wallet record.
6. Approval atomically claims the request, posts one balanced idempotent ledger transaction, and
   updates the wallet projection. Rejection credits nothing. Both decisions require reasons and
   create audit records.

Never approve from a screenshot alone. Match the receiving account, amount, reference, sender,
and timestamp against the official business-wallet transaction history. Personal Maya accounts
must not be used for business collection without Maya's written agreement; use GCash/Maya merchant
accounts and retain settlement/reconciliation records.

### Manual GCash/Maya payout controls

1. A verified user registers a GCash or Maya destination; the full identifier is encrypted at rest.
2. Withdrawal creation reserves the gross amount and enters review without posting a settlement.
3. An authorized reviewer approves the withdrawal for payout.
4. Finance reveals the destination through a permissioned, audited action and sends the exact net amount.
5. Finance records the real wallet transaction reference; this does not finalize the ledger.
6. A different authorized reviewer confirms settlement, which atomically posts the balanced ledger entries.
7. If the transfer failed, that second reviewer instead confirms failure; the reservation is atomically
   reversed and the user's funds are restored. A recorded transfer cannot use the generic reversal route.

Never log or expose `PAYOUT_ACCOUNT_ENCRYPTION_KEY`, and never place it in the web application.

## Cloudflare web

The non-secret Worker variables are versioned in `apps/web/wrangler.jsonc`:

- `AUTH_PROVIDER=auth0`
- `AUTH0_AUDIENCE`
- `INTERNAL_API_URL`
- `NEXT_PUBLIC_API_URL`
- `WEB_ORIGIN`

The encrypted Cloudflare secret store must contain these names:

- `APP_BASE_URL`
- `AUTH0_DOMAIN`
- `AUTH0_CLIENT_ID`
- `AUTH0_CLIENT_SECRET`
- `AUTH0_SECRET`

List names without revealing values:

    corepack pnpm --filter @vertex/web exec wrangler secret list

The project builds OpenNext inside Linux because a Windows-generated bundle is not portable
to Workers. `apps/web/.env.local` is mounted as a Docker BuildKit secret and must remain
uncommitted:

    corepack pnpm --filter @vertex/web run deploy

After deployment, verify `/plans`, `/login`, and `/auth/login`. Auth0 must list the exact
callback above, and the allowed logout and web-origin entries must use the same production
origin.

## Health-check troubleshooting

For a local API using `API_PORT=10000`, verify the listener and endpoint independently:

    netstat -ano | Select-String ':10000'
    curl.exe --noproxy "*" --silent --show-error --include http://127.0.0.1:10000/v1/health
    curl.exe --noproxy "*" --silent --show-error --include http://localhost:10000/v1/health

Nest binds to `0.0.0.0`. A harness must wait for “Nest application successfully started”
or retry the endpoint with a bounded timeout. It must request `/v1/health`, not `/health`.
On Windows, use `curl.exe --noproxy "*"` when a system proxy causes a false localhost
failure. Before starting another API, check whether the configured port already has a listener.

## Post-deploy acceptance

1. API health is HTTP 200 and money movement is disabled.
2. The public plans endpoint returns VIP 1–10 with daily payout and total return fields.
3. The public commission endpoint returns active levels 1, 2, and 3 at 27%, 2%, and 1%.
4. The web plans page renders those API records, not a static schedule.
5. Login redirects to Auth0 and returns through `/auth/callback`.
6. First Auth0 login provisions one local identity, investor role, profile, wallet, KYC case,
   and five ledger accounts idempotently.
7. No response, build log, or repository file contains a client secret or session secret.

## Staging environment (Fly.io + Cloudflare Workers)

Staging uses **mock providers** so the sandbox works end-to-end without real credentials.

### Fly.io API (staging)

Create a Fly.io app and PostgreSQL/Redis:

```bash
flyctl apps create vertex-legacy-api-staging
flyctl postgres create --name vertex-legacy-staging-db --region sin
flyctl redis create --name vertex-legacy-staging-redis --region sin
```

Attach the database/redis to the app:

```bash
flyctl postgres attach vertex-legacy-staging-db --app vertex-legacy-api-staging
flyctl redis attach vertex-legacy-staging-redis --app vertex-legacy-api-staging
```

Set staging environment variables (via `flyctl secrets set` or web UI):

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | (from `flyctl postgres attach` output) |
| `REDIS_URL` | (from `flyctl redis attach` output) |
| `NODE_ENV` | `development` |
| `AUTH_PROVIDER` | `mock` |
| `PAYMENT_PROVIDER` | `mock` |
| `PAYOUT_PROVIDER` | `mock` |
| `KYC_PROVIDER` | `mock` |
| `WEB_ORIGIN` | `https://vertex-legacy-staging.joshua27emmanuel30.workers.dev` |
| `MOCK_PROVIDER_WEBHOOK_SECRET` | random 32+ char string |
| `MOCK_SESSION_SECRET` | random 32+ char string |

Deploy using the staging Fly config:

```bash
flyctl deploy --config fly.toml
```

Verify:

```bash
curl.exe --silent --show-error --include https://vertex-legacy-api-staging.fly.dev/v1/health
```

Expected: HTTP 200 with `status: "ok"` and `moneyMovement: "sandbox"`.

### Cloudflare Web (staging)

Create a new Cloudflare Worker for staging (or use a staging subdomain):

1. In Cloudflare dashboard: Workers & Pages → Create application → Worker
2. Name: `vertex-legacy-staging`
3. Build command: `corepack pnpm --filter @vertex/web run deploy` (runs Linux OpenNext build)
4. Environment variables (non-secret, in Worker settings):
   - `AUTH_PROVIDER` = `mock`
   - `AUTH0_AUDIENCE` = `https://api.vertex-legacy.com`
   - `INTERNAL_API_URL` = `https://vertex-legacy-api-staging.fly.dev/v1`
   - `NEXT_PUBLIC_API_URL` = `https://vertex-legacy-api-staging.fly.dev/v1`
   - `WEB_ORIGIN` = `https://vertex-legacy-staging.joshua27emmanuel30.workers.dev`
5. Secrets (encrypted in Worker settings):
   - `APP_BASE_URL` = `https://vertex-legacy-staging.joshua27emmanuel30.workers.dev`
   - `AUTH0_DOMAIN` = (can use same Auth0 tenant or mock)
   - `AUTH0_CLIENT_ID` = (if using Auth0)
   - `AUTH0_CLIENT_SECRET` = (if using Auth0)
   - `AUTH0_SECRET` = random 32+ char string

The staging web app will use `AUTH_PROVIDER=mock` which enables local demo accounts without Auth0.

### Staging acceptance

1. API health: `moneyMovement: "sandbox"`
2. `/plans` shows VIP 1–10 with daily payout/total return from API
3. `/login` shows "Local demo accounts" notice (mock auth)
4. Deposit → `/investor/cash-in` works with mock checkout
5. Withdrawal → mock payout completes in sandbox
6. No real payment credentials anywhere
