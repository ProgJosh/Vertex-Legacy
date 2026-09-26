# Vertex Legacy deployment runbook

The supported deployment is a Cloudflare Worker for the Next.js application and a
Railway service for the NestJS API and PostgreSQL database. The current production URLs are:

- Web: `https://vertex-legacy.joshua27emmanuel30.workers.dev`
- API: `https://api-production-8c96.up.railway.app/v1`
- Auth0 audience: `https://api.vertex-legacy.com`
- Auth0 callback: `https://vertex-legacy.joshua27emmanuel30.workers.dev/auth/callback`

## Safety boundary

Production uses `PAYMENT_PROVIDER=licensed`, `PAYOUT_PROVIDER=licensed`, and
`KYC_PROVIDER=licensed` as fail-closed placeholders. Those values disable mock money
movement; they do not implement a live provider. Do not accept real deposits or payouts until
a licensed adapter, signed webhooks, reconciliation, operational approval, and the required
legal/compliance work are complete.

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
| `PAYMENT_PROVIDER` | `licensed` until a real adapter is implemented |
| `PAYOUT_PROVIDER` | `licensed` until a real adapter is implemented |
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

    curl.exe --silent --show-error --include https://api-production-8c96.up.railway.app/v1/health

Expected: HTTP 200 with `status: "ok"` and `moneyMovement: "disabled"`.

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
