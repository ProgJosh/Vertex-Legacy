# AWS production baseline

This Terraform baseline creates the encrypted persistence and compute layer for Vertex Legacy: RDS PostgreSQL Multi-AZ, ElastiCache Redis with encryption and failover, private ECS Fargate services, S3, SQS with a dead-letter queue, KMS, Secrets Manager, CloudWatch logs, and least-privilege task roles.

It intentionally requires an organization-owned VPC, private subnets, security groups, database subnet group, immutable ECR images, CloudFront, WAF, ALB listeners, ACM certificates, and DNS. Those controls depend on the operator's network, domain, incident-response, and compliance design.

Before applying:

1. Complete threat modelling, regulatory review, and data classification.
2. Supply licensed identity, KYC, payment, payout, broker, and custody providers.
3. Put provider credentials only in Secrets Manager.
4. Add CloudFront and WAF, private ALB target groups, health checks, autoscaling, backup alarms, GuardDuty/Security Hub, and an OTLP collector.
5. Run terraform plan in CI with policy checks. Never apply from a developer laptop to production.
