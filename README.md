# Vertex Legacy

Vertex Legacy is a sandbox-first investment operations platform built as a TypeScript modular monolith. It includes a responsive public site, investor application, finance/compliance workflows, administration console, PostgreSQL double-entry ledger, provider adapters, background worker, OpenAPI documentation, tests, and an AWS production baseline.

Live money movement is **not enabled**. Local KYC, deposits, and payouts are explicit simulations. Production requires licensed providers, credentials, regulatory approval, legal disclosures, security review, and reconciliation certification.

## Stack

- pnpm + Turborepo on Node.js 24 LTS
- Next.js App Router, React, Tailwind CSS, Radix/shadcn-style primitives, React Hook Form, Zod, TanStack Query, Apache ECharts
- NestJS REST API with Swagger/OpenAPI
- PostgreSQL + Prisma migrations; Redis + BullMQ; SQS queue adapter
- Auth0 or Amazon Cognito JWT validation in production; local mock identity adapter
- Vitest, Supertest, and Playwright
- Docker Compose for PostgreSQL and Redis
- AWS ECS Fargate, RDS Multi-AZ, ElastiCache, S3, SQS, KMS, Secrets Manager baseline

## Prerequisites

- Node.js 24 LTS
- Corepack
- Docker Desktop with Docker Compose

## Exact local setup

Run these commands from the repository root:

    Copy-Item .env.example .env
    corepack prepare pnpm@10.17.1 --activate
    corepack pnpm install
    docker compose up -d
    corepack pnpm db:generate
    corepack pnpm db:migrate
    corepack pnpm db:seed
    corepack pnpm dev

The workspace commands load the root `.env` explicitly, including filtered Prisma, API, web, and worker commands. Prisma Client generation is an explicit setup step instead of running inside every build, which prevents Windows native-engine file locks while the API is active. On Windows, if `pnpm install` reports `EACCES` for a native package, stop any running Vertex dev/test processes that may be holding `node_modules`, then rerun the install; do not delete dependencies while those processes are active.

Open:

- Web: http://localhost:3000
- API: http://localhost:4000/v1
- OpenAPI: http://localhost:4000/docs

Demonstration identities:

- investor.demo@vertex.local
- finance.demo@vertex.local
- admin.demo@vertex.local

There are no local passwords. The local identity cookie and MFA code 123456 are development-only controls and are rejected in production.

## Sandbox money flow

Cash-in creates a pending provider intent. Clicking **Complete sandbox payment** asks the mock provider adapter to emit a signed server-side event. Only that verified, deduplicated event posts balanced ledger entries and refreshes the wallet projection.

Withdrawals require verified KYC, MFA, a verified payout account, sufficient withdrawable funds, the configured minimum, and the Asia/Manila operating window. The API calculates and records gross amount, Withdrawal fee, and net payout. Large requests enter finance review. A sandbox settlement or failed-payout reversal creates separate balanced ledger transactions.

## Commands

    corepack pnpm build
    corepack pnpm typecheck
    corepack pnpm test
    corepack pnpm test:e2e
    corepack pnpm db:seed

To reset all local PostgreSQL and Redis data:

    docker compose down -v
    docker compose up -d
    corepack pnpm db:migrate
    corepack pnpm db:seed

The reset removes local container volumes and cannot be undone.

## Production provider replacement

Set AUTH_PROVIDER to auth0 or cognito and configure the matching issuer/audience values. Replace PAYMENT_PROVIDER, PAYOUT_PROVIDER, and KYC_PROVIDER with licensed adapters. Production startup rejects mock providers. Implement adapter-specific checkout, signed webhook verification, payout status handling, KYC case/document exchange, reconciliation exports, and secrets in AWS Secrets Manager.

Never update the wallet from a browser return URL. Provider state changes must arrive through verified server-to-server events with immutable payload retention and idempotency.

## Documentation

- [Existing-state audit](docs/EXISTING_STATE.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Security considerations](docs/SECURITY.md)
- [AWS baseline](infra/aws/README.md)

## Reference assets

The supplied screenshots and video are retained in docs/reference for design provenance only. The product intentionally excludes their lime palette, casino-style rewards, daily-profit claims, deceptive urgency, and deposit-funded referral mechanics. The supplied logo.jfif is used as the official Vertex Legacy mark because logo(2).jfif was not present.
