# Security considerations

The acceptance baseline is OWASP ASVS. Financial actions use server-side authentication, permission checks, request validation, idempotency, immutable audit records, and append-only ledger entries.

## Implemented safeguards

- Production rejects mock identity, KYC, payment, and payout providers.
- Role and permission checks execute in the API.
- MFA and completed KYC are required for withdrawals.
- Rate limiting, strict request validation, security headers, CORS allowlisting, and redacted structured logging are enabled.
- Webhooks require signature verification, retain the original payload, and are deduplicated by provider/event identifier.
- Sensitive administrative actions require a reason and create an audit record.
- Payout accounts expose only masked identifiers.
- Tokens, OTPs, passwords, full account numbers, and signed secrets must never be logged.

## External work required before production

- Complete independent penetration testing and ASVS verification.
- Configure Auth0 or Cognito tenants, MFA, recovery, session limits, and breached-password controls.
- Select licensed KYC, payment, payout, broker/custodian providers and complete their security reviews.
- Confirm Philippine regulatory, securities, AML, data-protection, tax, and consumer-disclosure obligations with qualified counsel.
- Configure KMS keys, Secrets Manager rotation, private networking, WAF rules, backup/restore drills, audit retention, and incident response.
- Replace all sandbox adapters and complete provider reconciliation certification.
