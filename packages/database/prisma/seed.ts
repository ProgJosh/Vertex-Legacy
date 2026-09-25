import {
  EntryDirection,
  KycStatus,
  LedgerAccountType,
  LedgerTransactionStatus,
  NormalBalance,
  PlanStatus,
  Prisma,
  PrismaClient,
  UserStatus,
} from "@prisma/client";
import { Permissions, Roles } from "@vertex/types";
import { platformSeed } from "@vertex/config";

const db = new PrismaClient();

const permissionsByRole: Record<string, string[]> = {
  [Roles.INVESTOR]: [
    Permissions.USER_READ_SELF,
    Permissions.WALLET_READ_SELF,
    Permissions.DEPOSIT_CREATE_SELF,
    Permissions.WITHDRAWAL_CREATE_SELF,
    Permissions.PLAN_SUBSCRIBE_SELF,
  ],
  [Roles.FINANCE_COMPLIANCE]: [
    Permissions.KYC_REVIEW,
    Permissions.WITHDRAWAL_REVIEW,
    Permissions.RECONCILIATION_REVIEW,
    Permissions.AUDIT_READ,
  ],
  [Roles.ADMIN]: Object.values(Permissions),
};

async function seedRole(name: string, description: string) {
  const role = await db.role.upsert({
    where: { name },
    update: { description },
    create: { name, description },
  });
  for (const key of permissionsByRole[name] ?? []) {
    const permission = await db.permission.upsert({
      where: { key },
      update: {},
      create: { key, description: key.replaceAll(":", " ") },
    });
    await db.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
      update: {},
      create: { roleId: role.id, permissionId: permission.id },
    });
  }
  return role;
}

async function createAccounts(userId: string, prefix: string) {
  const specs = [
    ["CASH", "Deposited cash", LedgerAccountType.USER_DEPOSITED_CASH],
    ["PROMO", "Promotional credits", LedgerAccountType.USER_PROMOTIONAL_CREDIT],
    ["INVESTED", "Invested funds", LedgerAccountType.USER_INVESTED_FUNDS],
    ["COMMISSION", "Commissions", LedgerAccountType.USER_COMMISSION],
    ["RESERVE", "Withdrawal reserve", LedgerAccountType.USER_WITHDRAWAL_RESERVE],
  ] as const;
  const result: Record<string, string> = {};
  for (const [suffix, name, type] of specs) {
    const account = await db.ledgerAccount.upsert({
      where: { code: prefix + ":" + suffix },
      update: {},
      create: {
        userId,
        code: prefix + ":" + suffix,
        name,
        type,
        normalBalance: NormalBalance.CREDIT,
      },
    });
    result[suffix] = account.id;
  }
  return result;
}

async function main() {
  const investorRole = await seedRole(Roles.INVESTOR, "Verified customer with self-service investing permissions.");
  const financeRole = await seedRole(
    Roles.FINANCE_COMPLIANCE,
    "Finance and compliance review permissions without platform administration.",
  );
  const adminRole = await seedRole(Roles.ADMIN, "Platform administration with audited sensitive actions.");

  const investor = await db.user.upsert({
    where: { email: "investor.demo@vertex.local" },
    update: {},
    create: {
      email: "investor.demo@vertex.local",
      mobile: "+639170000101",
      status: UserStatus.ACTIVE,
      emailVerifiedAt: new Date(),
      mobileVerifiedAt: new Date(),
      mfaEnabledAt: new Date(),
      verifiedIndividualHash: "demo-investor-001",
      profile: {
        create: {
          firstName: "Mara",
          lastName: "Santos",
          nationality: "Filipino",
          city: "Makati",
          region: "Metro Manila",
        },
      },
      identities: {
        create: { provider: "mock", providerSubject: "demo-investor" },
      },
      wallet: {
        create: {
          depositedAvailableCentavos: 2_500_000n,
          promotionalAvailableCentavos: platformSeed.signupBonusCentavos,
        },
      },
      kycCases: {
        create: {
          provider: "mock",
          providerCaseId: "demo-kyc-investor",
          status: KycStatus.VERIFIED,
          submittedAt: new Date(),
          reviewedAt: new Date(),
          riskRating: "STANDARD",
        },
      },
      payoutAccounts: {
        create: {
          type: "BANK",
          institutionName: "Demonstration Bank",
          accountHolderName: "Mara Santos",
          encryptedIdentifier: "DEMO_ONLY_NOT_A_REAL_ACCOUNT",
          maskedIdentifier: "•••• 1842",
          verifiedAt: new Date(),
        },
      },
    },
  });

  const finance = await db.user.upsert({
    where: { email: "finance.demo@vertex.local" },
    update: {},
    create: {
      email: "finance.demo@vertex.local",
      status: UserStatus.ACTIVE,
      emailVerifiedAt: new Date(),
      mfaEnabledAt: new Date(),
      profile: { create: { firstName: "Finance", lastName: "Reviewer" } },
      identities: { create: { provider: "mock", providerSubject: "demo-finance" } },
    },
  });

  const admin = await db.user.upsert({
    where: { email: "admin.demo@vertex.local" },
    update: {},
    create: {
      email: "admin.demo@vertex.local",
      status: UserStatus.ACTIVE,
      emailVerifiedAt: new Date(),
      mfaEnabledAt: new Date(),
      profile: { create: { firstName: "Platform", lastName: "Administrator" } },
      identities: { create: { provider: "mock", providerSubject: "demo-admin" } },
    },
  });

  for (const [userId, roleId] of [
    [investor.id, investorRole.id],
    [finance.id, financeRole.id],
    [admin.id, adminRole.id],
  ] as const) {
    await db.userRole.upsert({
      where: { userId_roleId: { userId, roleId } },
      update: {},
      create: { userId, roleId },
    });
  }

  await db.platformConfiguration.upsert({
    where: { version: 1 },
    update: { active: true },
    create: {
      version: 1,
      signupBonusCentavos: platformSeed.signupBonusCentavos,
      minimumDepositCentavos: platformSeed.minimumDepositCentavos,
      minimumWithdrawalCentavos: platformSeed.minimumWithdrawalCentavos,
      withdrawalFeeRate: new Prisma.Decimal("0.050000"),
      withdrawalOpensAt: platformSeed.withdrawalOpensAt,
      withdrawalClosesAt: platformSeed.withdrawalClosesAt,
      withdrawalTimezone: platformSeed.withdrawalTimezone,
      withdrawalOutsideWindowMode: platformSeed.withdrawalOutsideWindowMode,
      defaultCurrency: platformSeed.currency,
      promotionalCreditsWithdrawable: platformSeed.promotionalCreditsWithdrawable,
      manualReviewThresholdCentavos: 5_000_000n,
      active: true,
      effectiveAt: new Date("2026-01-01T00:00:00Z"),
      changeReason: "Initial demonstration configuration",
      updatedById: admin.id,
    },
  });

  const platformCash = await db.ledgerAccount.upsert({
    where: { code: "PLATFORM:CASH" },
    update: {},
    create: {
      code: "PLATFORM:CASH",
      name: "Provider settlement cash",
      type: LedgerAccountType.PLATFORM_CASH,
      normalBalance: NormalBalance.DEBIT,
    },
  });
  const adjustment = await db.ledgerAccount.upsert({
    where: { code: "PLATFORM:ADJUSTMENT" },
    update: {},
    create: {
      code: "PLATFORM:ADJUSTMENT",
      name: "Demonstration opening balance clearing",
      type: LedgerAccountType.ADJUSTMENT_CLEARING,
      normalBalance: NormalBalance.DEBIT,
    },
  });
  const accounts = await createAccounts(investor.id, "USER:" + investor.id);

  if (!(await db.ledgerTransaction.findUnique({ where: { idempotencyKey: "seed:opening-cash" } }))) {
    await db.ledgerTransaction.create({
      data: {
        reference: "DEMO-OPENING-CASH",
        idempotencyKey: "seed:opening-cash",
        kind: "DEMONSTRATION_OPENING_BALANCE",
        status: LedgerTransactionStatus.POSTED,
        description: "Demonstration deposited balance; not real funds.",
        postedAt: new Date(),
        entries: {
          create: [
            { accountId: platformCash.id, direction: EntryDirection.DEBIT, amountCentavos: 2_500_000n },
            { accountId: accounts.CASH!, direction: EntryDirection.CREDIT, amountCentavos: 2_500_000n },
          ],
        },
      },
    });
  }

  if (!(await db.ledgerTransaction.findUnique({ where: { idempotencyKey: "seed:signup-bonus" } }))) {
    await db.ledgerTransaction.create({
      data: {
        reference: "DEMO-SIGNUP-BONUS",
        idempotencyKey: "seed:signup-bonus",
        kind: "SIGNUP_PROMOTIONAL_CREDIT",
        status: LedgerTransactionStatus.POSTED,
        description: "One-time demonstration promotional credit; non-withdrawable by default.",
        postedAt: new Date(),
        entries: {
          create: [
            {
              accountId: adjustment.id,
              direction: EntryDirection.DEBIT,
              amountCentavos: platformSeed.signupBonusCentavos,
            },
            {
              accountId: accounts.PROMO!,
              direction: EntryDirection.CREDIT,
              amountCentavos: platformSeed.signupBonusCentavos,
            },
          ],
        },
      },
    });
  }

  const plans = [
    {
      slug: "vertex-core-income",
      name: "Vertex Core Income",
      description: "A measured income-oriented mandate using eligible fixed-income and cash instruments.",
      category: "Income",
      minimumCentavos: 250_000n,
      maximumCentavos: 5_000_000n,
      durationDays: 180,
      riskClassification: "Moderate",
      managementFeeRate: new Prisma.Decimal("0.012500"),
      targetPerformanceLow: new Prisma.Decimal("0.040000"),
      targetPerformanceHigh: new Prisma.Decimal("0.065000"),
      promotionalBadge: "Income focus",
    },
    {
      slug: "vertex-balanced-opportunities",
      name: "Vertex Balanced Opportunities",
      description: "A diversified mandate designed for investors seeking measured long-term capital growth.",
      category: "Balanced",
      minimumCentavos: 500_000n,
      maximumCentavos: 10_000_000n,
      durationDays: 365,
      riskClassification: "Moderate–high",
      managementFeeRate: new Prisma.Decimal("0.015000"),
      targetPerformanceLow: new Prisma.Decimal("0.060000"),
      targetPerformanceHigh: new Prisma.Decimal("0.100000"),
      promotionalBadge: "Diversified",
    },
    {
      slug: "vertex-capital-preservation",
      name: "Vertex Capital Preservation",
      description: "A lower-volatility mandate prioritizing liquidity discipline and capital preservation.",
      category: "Conservative",
      minimumCentavos: 100_000n,
      maximumCentavos: 3_000_000n,
      durationDays: 90,
      riskClassification: "Low",
      managementFeeRate: new Prisma.Decimal("0.007500"),
      targetPerformanceLow: new Prisma.Decimal("0.025000"),
      targetPerformanceHigh: new Prisma.Decimal("0.040000"),
      promotionalBadge: null,
    },
  ];

  for (const plan of plans) {
    await db.plan.upsert({
      where: { slug: plan.slug },
      update: {},
      create: {
        ...plan,
        eligibilityRequirements: { kyc: "VERIFIED", minimumAge: 18 },
        terms:
          "Targets are illustrative, not guaranteed. Capital is at risk. Availability is subject to suitability and provider approval.",
        availableFrom: new Date("2026-01-01T00:00:00Z"),
        capacityCentavos: 100_000_000n,
        status: PlanStatus.ACTIVE,
      },
    });
  }

  await db.announcement.upsert({
    where: { id: "00000000-0000-0000-0000-000000000101" },
    update: {},
    create: {
      id: "00000000-0000-0000-0000-000000000101",
      title: "Demonstration environment",
      body: "All balances, plans, transactions, and provider actions in this environment are demonstration data.",
      audience: "ALL",
      publishedAt: new Date(),
    },
  });
}

main()
  .then(() => console.log("Vertex Legacy demonstration data seeded."))
  .finally(() => db.$disconnect());
