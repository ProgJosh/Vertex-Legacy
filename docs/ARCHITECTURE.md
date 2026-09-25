# Vertex Legacy architecture

Vertex Legacy is a TypeScript modular monolith. It keeps financial invariants inside one transactional boundary while separating deployable web, API, and background-worker processes.

## Runtime map

- apps/web: Next.js App Router frontend, public site, investor application, and administration console.
- apps/api: NestJS REST API, OpenAPI, server-side authorization, business workflows, and provider webhooks.
- apps/worker: BullMQ worker for notifications, reconciliation, statements, and provider callbacks. An SQS adapter is the production boundary.
- packages/database: Prisma schema, migrations, client, and demonstration seed.
- packages/types: shared contracts and integer-centavo money utilities.
- packages/config: environment validation and platform defaults used only to seed the configuration table.
- packages/api-client: typed HTTP client used by the web application.
- packages/ui: shared presentation primitives and formatting.

## Trust boundaries

The browser never posts ledger entries or balances. It submits commands with idempotency keys. The API authenticates, authorizes, validates, evaluates platform configuration, and commits business records plus balanced ledger entries in a single PostgreSQL transaction.

Production authentication is delegated to Auth0 or Amazon Cognito. The mock identity adapter is enabled only for local development and refuses to boot in production. Payment, payout, and KYC providers follow the same adapter pattern. Their mock implementations are sandbox-only.

## Money model

PHP money is represented as integer centavos (BIGINT in PostgreSQL and bigint in TypeScript). Rates, unit prices, NAV, and percentages use PostgreSQL NUMERIC and decimal-string inputs. JavaScript floating point is not used for money calculations.

Ledger transactions are append-only. Every posted transaction has at least two entries, total debits equal total credits, and completion locks the record. Corrections reference the original and add a reversal transaction. Wallet balances are read projections over ledger accounts, never editable fields.

## Main workflows

1. Deposit intent is created idempotently.
2. The sandbox provider creates checkout context.
3. Only a verified signed webhook can post cash and wallet ledger entries.
4. Withdrawal quote evaluates KYC, MFA, minimum, schedule, fee, and withdrawable funds.
5. Authorization reserves funds; compliance may require review.
6. Provider completion posts settlement and fee entries; failure releases the reserve by reversal.
7. Plan subscriptions move deposited cash into invested-funds accounts.
8. Commission events are produced only for configured qualifying plan/service-fee events and preserve their source transaction.

## Production deployment

The infra/aws directory describes the intended AWS topology: CloudFront and WAF in front of the web/API load balancer; ECS Fargate services; RDS PostgreSQL Multi-AZ; ElastiCache Redis; S3 document storage; SQS queues; KMS; and Secrets Manager. It is a baseline requiring organization-specific networking, certificates, identity-provider configuration, provider credentials, compliance review, and a licensed financial/payment partner before real money is enabled.
