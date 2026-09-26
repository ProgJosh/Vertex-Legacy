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
import { companyCommissionLevels, companyVipPlans, platformSeed } from "@vertex/config";

const db = new PrismaClient();

/** Stable UUIDs keep the level rules idempotent across re-seeds. */
const levelRuleId = (level: number) =>
  "00000000-0000-4000-8000-0000000003" + String(level).padStart(2, "0");

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
  const production = process.env.NODE_ENV === "production";
  const investorRole = await seedRole(Roles.INVESTOR, "Verified customer with self-service investing permissions.");
  const financeRole = await seedRole(
    Roles.FINANCE_COMPLIANCE,
    "Finance and compliance review permissions without platform administration.",
  );
  const adminRole = await seedRole(Roles.ADMIN, "Platform administration with audited sensitive actions.");

  let demoInvestorId: string | null = null;
  let demoAdminId: string | null = null;
  if (!production) {
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
  demoInvestorId = investor.id;
  demoAdminId = admin.id;

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
  }

  await db.platformConfiguration.upsert({
    where: { version: 1 },
    // A deployment restart must not overwrite a later configuration version or
    // reactivate version 1 after an administrator has superseded it.
    update: {},
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
      changeReason: production
        ? "Initial platform configuration"
        : "Initial demonstration configuration",
      updatedById: demoAdminId,
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
      name: "Opening balance and promotion clearing",
      type: LedgerAccountType.ADJUSTMENT_CLEARING,
      normalBalance: NormalBalance.DEBIT,
    },
  });
  if (demoInvestorId) {
  const accounts = await createAccounts(demoInvestorId, "USER:" + demoInvestorId);

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
  }

  // The company VIP schedule replaces the earlier generic mandates. Retiring them
  // rather than deleting them keeps existing orders, holdings and statements
  // referentially intact while /public/plans returns only the current schedule.
  await db.plan.updateMany({
    where: { slug: { in: ["vertex-core-income", "vertex-balanced-opportunities", "vertex-capital-preservation"] } },
    data: { status: PlanStatus.ARCHIVED },
  });

  for (const [index, plan] of companyVipPlans.entries()) {
    const slug = "vip-" + String(index + 1);
    const totalReturnRate =
      Number(plan.totalReturnCentavos) / Number(plan.priceCentavos);
    const values = {
      name: plan.name,
      description:
        plan.name +
        " is a fixed " +
        plan.cycleDays +
        "-day company plan at a " +
        "₱" +
        (Number(plan.priceCentavos) / 100).toLocaleString("en-PH") +
        " subscription price, with a stated daily payout of ₱" +
        (Number(plan.dailyPayoutCentavos) / 100).toLocaleString("en-PH") +
        " and a stated total return of ₱" +
        (Number(plan.totalReturnCentavos) / 100).toLocaleString("en-PH") +
        " across the cycle.",
      category: "Company VIP",
      minimumCentavos: plan.priceCentavos,
      maximumCentavos: plan.priceCentavos,
      durationDays: plan.cycleDays,
      riskClassification: "High",
      managementFeeRate: new Prisma.Decimal("0.000000"),
      targetPerformanceLow: new Prisma.Decimal(totalReturnRate.toFixed(6)),
      targetPerformanceHigh: new Prisma.Decimal(totalReturnRate.toFixed(6)),
      performanceLabel: "Company schedule · return not guaranteed",
      dailyPayoutCentavos: plan.dailyPayoutCentavos,
      totalReturnCentavos: plan.totalReturnCentavos,
      eligibilityRequirements: { kyc: "VERIFIED", minimumAge: 18 },
      terms:
        "Fixed-price, fixed-duration company plan. The daily payout and total return shown are the figures published in the company plan schedule; they are a stated schedule, not a guaranteed or assured return, and the platform does not underwrite them. Returns are not guaranteed and capital is at risk. Availability is subject to capacity, suitability and provider approval. Confirm the current schedule with Vertex Legacy before subscribing.",
      availableFrom: new Date("2026-01-01T00:00:00Z"),
      capacityCentavos: null,
      status: PlanStatus.ACTIVE,
      promotionalBadge: null,
    };
    const { status, ...scheduleValues } = values;
    await db.plan.upsert({
      where: { slug },
      // The published schedule is the source of truth, so a re-seed reconciles
      // numeric drift. Production preserves an administrator's pause/close
      // decision instead of silently reactivating a plan during deployment.
      update: production ? scheduleValues : values,
      create: { slug, ...scheduleValues, status },
    });
  }

  for (const level of companyCommissionLevels) {
    await db.commissionRule.upsert({
      where: { id: levelRuleId(level.level) },
      update: {
        name: level.name,
        rate: new Prisma.Decimal(
          (level.rateBasisPoints / 10_000).toFixed(6),
        ),
        ...(!production ? { active: true } : {}),
        eligibility: {
          kyc: "VERIFIED",
          selfReferral: false,
          depositAloneQualifies: false,
          level: level.level,
        },
      },
      create: {
        id: levelRuleId(level.level),
        name: level.name,
        qualifyingEvent: "PLAN_SERVICE_FEE_CONFIRMED",
        rate: new Prisma.Decimal((level.rateBasisPoints / 10_000).toFixed(6)),
        capCentavos: null,
        minimumSourceCentavos: null,
        eligibility: {
          kyc: "VERIFIED",
          selfReferral: false,
          depositAloneQualifies: false,
          level: level.level,
        },
        effectiveFrom: new Date("2026-01-01T00:00:00Z"),
        active: true,
      },
    });
  }

  if (!production) await db.announcement.upsert({
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
  .then(() =>
    console.log(
      process.env.NODE_ENV === "production"
        ? "Vertex Legacy platform reference data seeded."
        : "Vertex Legacy demonstration data seeded.",
    ),
  )
  .finally(() => db.$disconnect());
