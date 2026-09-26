import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Headers,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { Permissions, Roles } from "@vertex/types";
import { Public } from "./common/public.decorator";
import { RequirePermissions } from "./common/permissions.decorator";
import {
  AuthenticatedUser,
  CurrentUser,
} from "./common/current-user.decorator";
import { PrismaService } from "./services/prisma.service";
import { ConfigService } from "./services/config.service";
import { FinancialService } from "./services/financial.service";
import { UserService } from "./services/user.service";
import { PlanService } from "./services/plan.service";
import { AuditService } from "./services/audit.service";

const reasonSchema = z.object({ reason: z.string().min(8).max(500) });

@ApiTags("vertex")
@ApiBearerAuth()
@Controller()
export class AppController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ConfigService) private readonly config: ConfigService,
    @Inject(FinancialService) private readonly financial: FinancialService,
    @Inject(UserService) private readonly users: UserService,
    @Inject(PlanService) private readonly plans: PlanService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  @Public()
  @Get("health")
  health() {
    const sandboxMoneyMovement =
      process.env.PAYMENT_PROVIDER === "mock" &&
      process.env.NODE_ENV !== "production";
    return {
      status: "ok",
      service: "vertex-legacy-api",
      moneyMovement: sandboxMoneyMovement ? "sandbox" : "disabled",
    };
  }

  @Public()
  @Get("public/config")
  async publicConfig() {
    const config = await this.config.active();
    return {
      signupBonusCentavos: config.signupBonusCentavos,
      minimumDepositCentavos: config.minimumDepositCentavos,
      minimumWithdrawalCentavos: config.minimumWithdrawalCentavos,
      withdrawalFeeRate: config.withdrawalFeeRate,
      withdrawalOpensAt: config.withdrawalOpensAt,
      withdrawalClosesAt: config.withdrawalClosesAt,
      withdrawalTimezone: config.withdrawalTimezone,
      withdrawalOutsideWindowMode: config.withdrawalOutsideWindowMode,
      defaultCurrency: config.defaultCurrency,
      promotionalCreditsWithdrawable: config.promotionalCreditsWithdrawable,
    };
  }

  @Public()
  @Get("public/plans")
  publicPlans() {
    // Ascending minimum is ascending VIP tier, so the published schedule order is
    // preserved without depending on a presentation-only badge.
    return this.prisma.plan.findMany({
      where: { status: "ACTIVE" },
      orderBy: [{ minimumCentavos: "asc" }, { name: "asc" }],
    });
  }

  @Public()
  @Get("public/commission-levels")
  async publicCommissionLevels() {
    const rules = await this.prisma.commissionRule.findMany({
      where: { qualifyingEvent: "PLAN_SERVICE_FEE_CONFIRMED" },
      orderBy: { rate: "desc" },
    });
    return rules.map((rule) => ({
      id: rule.id,
      name: rule.name,
      rate: rule.rate.toString(),
      level:
        typeof rule.eligibility === "object" && rule.eligibility !== null
          ? ((rule.eligibility as { level?: unknown }).level ?? null)
          : null,
      active: rule.active,
      qualifyingEvent: rule.qualifyingEvent,
      effectiveFrom: rule.effectiveFrom,
    }));
  }

  @Public()
  @Get("public/plans/:slug")
  async publicPlan(@Param("slug") slug: string) {
    const plan = await this.prisma.plan.findUnique({
      where: { slug },
      include: { documents: true },
    });
    if (!plan || plan.status !== "ACTIVE")
      throw new NotFoundException("Plan not found.");
    return plan;
  }

  @Public()
  @Get("public/announcements")
  announcements() {
    return this.prisma.announcement.findMany({
      where: {
        publishedAt: { lte: new Date() },
        OR: [{ expiresAt: null }, { expiresAt: { gte: new Date() } }],
      },
      orderBy: { publishedAt: "desc" },
    });
  }

  @Public()
  @Post("auth/mock/register")
  register(@Body() body: unknown) {
    return this.users.registerMock(body);
  }

  @Public()
  @Post("auth/mock/login")
  async login(@Body() body: unknown) {
    if (
      (process.env.AUTH_PROVIDER ?? "mock") !== "mock" ||
      process.env.NODE_ENV === "production"
    ) {
      throw new NotFoundException();
    }
    const input = z.object({ email: z.string().email() }).parse(body);
    const user = await this.prisma.user.findUnique({
      where: { email: input.email.toLowerCase() },
      include: { profile: true, roles: { include: { role: true } } },
    });
    if (!user || user.status !== "ACTIVE")
      throw new NotFoundException("Demonstration account not found.");
    return {
      userId: user.id,
      email: user.email,
      name: user.profile
        ? user.profile.firstName + " " + user.profile.lastName
        : user.email,
      roles: user.roles.map((item) => item.role.name),
      mode: "local-demonstration-only",
    };
  }

  @RequirePermissions(Permissions.USER_READ_SELF)
  @Post("auth/provision")
  provision(@CurrentUser() current: AuthenticatedUser) {
    return { provisioned: true, userId: current.id };
  }

  @RequirePermissions(Permissions.USER_READ_SELF)
  @Get("me")
  async me(@CurrentUser() current: AuthenticatedUser) {
    return this.prisma.user.findUniqueOrThrow({
      where: { id: current.id },
      include: {
        profile: true,
        wallet: true,
        roles: { include: { role: true } },
        kycCases: { orderBy: { createdAt: "desc" }, take: 1 },
        payoutAccounts: { where: { active: true } },
        sessions: {
          where: { revokedAt: null },
          orderBy: { lastSeenAt: "desc" },
        },
      },
    });
  }

  @RequirePermissions(Permissions.USER_READ_SELF)
  @Patch("me/profile")
  async updateProfile(
    @CurrentUser() current: AuthenticatedUser,
    @Body() body: unknown,
  ) {
    const input = z
      .object({
        firstName: z.string().min(1).max(80),
        lastName: z.string().min(1).max(80),
        nationality: z.string().max(80).optional(),
        city: z.string().max(100).optional(),
        region: z.string().max(100).optional(),
      })
      .parse(body);
    return this.prisma.profile.update({
      where: { userId: current.id },
      data: {
        firstName: input.firstName,
        lastName: input.lastName,
        ...(input.nationality !== undefined
          ? { nationality: input.nationality }
          : {}),
        ...(input.city !== undefined ? { city: input.city } : {}),
        ...(input.region !== undefined ? { region: input.region } : {}),
      },
    });
  }

  @RequirePermissions(Permissions.USER_READ_SELF)
  @Post("me/kyc/mock/complete")
  completeKyc(
    @CurrentUser() current: AuthenticatedUser,
    @Body() body: unknown,
  ) {
    return this.users.completeMockKyc(current.id, body);
  }

  @RequirePermissions(Permissions.USER_READ_SELF)
  @Post("me/security/mfa/mock-enable")
  async enableMfa(@CurrentUser() current: AuthenticatedUser) {
    if ((process.env.AUTH_PROVIDER ?? "mock") !== "mock")
      throw new NotFoundException();
    await this.prisma.user.update({
      where: { id: current.id },
      data: { mfaEnabledAt: new Date() },
    });
    return { enabled: true, note: "Local demonstration MFA code: 123456" };
  }

  @RequirePermissions(Permissions.USER_READ_SELF)
  @Post("me/payout-accounts")
  async createPayoutAccount(
    @CurrentUser() current: AuthenticatedUser,
    @Body() body: unknown,
  ) {
    const input = z
      .object({
        institutionName: z.string().min(2).max(120),
        accountHolderName: z.string().min(2).max(160),
        accountIdentifier: z.string().min(4).max(80),
      })
      .parse(body);
    const suffix = input.accountIdentifier.slice(-4);
    return this.prisma.payoutAccount.create({
      data: {
        userId: current.id,
        type: "BANK",
        institutionName: input.institutionName,
        accountHolderName: input.accountHolderName,
        encryptedIdentifier: "sandbox-token:" + crypto.randomUUID(),
        maskedIdentifier: "•••• " + suffix,
        verifiedAt: process.env.KYC_PROVIDER === "mock" ? new Date() : null,
      },
    });
  }

  @RequirePermissions(Permissions.WALLET_READ_SELF)
  @Get("me/wallet")
  wallet(@CurrentUser() current: AuthenticatedUser) {
    return this.prisma.wallet.findUniqueOrThrow({
      where: { userId: current.id },
    });
  }

  @RequirePermissions(Permissions.WALLET_READ_SELF)
  @Get("me/transactions")
  async transactions(@CurrentUser() current: AuthenticatedUser) {
    const [deposits, withdrawals, investments, commissions] = await Promise.all(
      [
        this.prisma.deposit.findMany({
          where: { userId: current.id },
          orderBy: { createdAt: "desc" },
        }),
        this.prisma.withdrawal.findMany({
          where: { userId: current.id },
          orderBy: { createdAt: "desc" },
        }),
        this.prisma.investmentOrder.findMany({
          where: { userId: current.id },
          include: { plan: true },
          orderBy: { createdAt: "desc" },
        }),
        this.prisma.commissionEvent.findMany({
          where: { beneficiaryUserId: current.id },
          orderBy: { createdAt: "desc" },
        }),
      ],
    );
    return [
      ...deposits.map((item) => ({
        id: item.id,
        kind: "Cash-in",
        reference: item.providerReference,
        amountCentavos: item.amountCentavos,
        status: item.status,
        createdAt: item.createdAt,
      })),
      ...withdrawals.map((item) => ({
        id: item.id,
        kind: "Withdrawal",
        reference: item.providerReference,
        amountCentavos: -item.requestedCentavos,
        status: item.status,
        createdAt: item.createdAt,
      })),
      ...investments.map((item) => ({
        id: item.id,
        kind: "Plan subscription · " + item.plan.name,
        reference: item.idempotencyKey,
        amountCentavos: -item.amountCentavos,
        status: item.status,
        createdAt: item.createdAt,
      })),
      ...commissions.map((item) => ({
        id: item.id,
        kind: "Qualified commission",
        reference: item.sourceOrderId,
        amountCentavos: item.amountCentavos,
        status: item.status,
        createdAt: item.createdAt,
      })),
    ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  @RequirePermissions(Permissions.WALLET_READ_SELF)
  @Get("me/portfolio")
  portfolio(@CurrentUser() current: AuthenticatedUser) {
    return this.prisma.holding.findMany({
      where: { userId: current.id },
      include: {
        plan: {
          include: { valuations: { orderBy: { asOf: "desc" }, take: 1 } },
        },
      },
      orderBy: { openedAt: "desc" },
    });
  }

  @RequirePermissions(Permissions.WALLET_READ_SELF)
  @Get("me/commissions")
  commissions(@CurrentUser() current: AuthenticatedUser) {
    return this.prisma.commissionEvent.findMany({
      where: { beneficiaryUserId: current.id },
      include: { rule: true, sourceOrder: { include: { plan: true } } },
      orderBy: { createdAt: "desc" },
    });
  }

  @RequirePermissions(Permissions.USER_READ_SELF)
  @Get("me/referrals")
  async referrals(@CurrentUser() current: AuthenticatedUser) {
    return {
      referralCode: "VTX-" + current.id.slice(0, 8).toUpperCase(),
      programStatement:
        "Rewards apply only to documented qualifying service-fee events and never to deposits.",
      referrals: await this.prisma.referral.findMany({
        where: { referrerUserId: current.id },
        include: { referred: { include: { profile: true } } },
        orderBy: { createdAt: "desc" },
      }),
    };
  }

  @RequirePermissions(Permissions.USER_READ_SELF)
  @Get("me/notifications")
  notifications(@CurrentUser() current: AuthenticatedUser) {
    return this.prisma.notification.findMany({
      where: { userId: current.id },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
  }

  @RequirePermissions(Permissions.USER_READ_SELF)
  @Get("me/statements")
  async statement(
    @CurrentUser() current: AuthenticatedUser,
    @Query("month") month?: string,
  ) {
    const safeMonth = /^\d{4}-\d{2}$/.test(month ?? "")
      ? month!
      : new Date().toISOString().slice(0, 7);
    const [year, monthNumber] = safeMonth.split("-").map(Number);
    const from = new Date(Date.UTC(year!, monthNumber! - 1, 1));
    const to = new Date(Date.UTC(year!, monthNumber!, 1));
    const entries = await this.prisma.ledgerEntry.findMany({
      where: {
        account: { userId: current.id },
        createdAt: { gte: from, lt: to },
        transaction: { status: "POSTED" },
      },
      include: { transaction: true, account: true },
      orderBy: { createdAt: "asc" },
    });
    return {
      statementPeriod: safeMonth,
      generatedAt: new Date(),
      fileName: "vertex-statement-" + safeMonth + ".json",
      entries,
      disclosure:
        "Demonstration statement. Not proof of live funds or regulated custody.",
    };
  }

  @RequirePermissions(Permissions.DEPOSIT_CREATE_SELF)
  @Post("deposits")
  createDeposit(
    @CurrentUser() current: AuthenticatedUser,
    @Body() body: unknown,
    @Headers("idempotency-key") headerKey?: string,
  ) {
    const payload = {
      ...(body as object),
      idempotencyKey: headerKey ?? (body as any)?.idempotencyKey,
    };
    return this.financial.createDeposit(current.id, payload);
  }

  @RequirePermissions(Permissions.DEPOSIT_CREATE_SELF)
  @Post("providers/mock/deposits/:id/complete")
  completeDeposit(
    @CurrentUser() current: AuthenticatedUser,
    @Param("id") id: string,
  ) {
    return this.financial.completeMockDeposit(current.id, id);
  }

  @RequirePermissions(Permissions.WITHDRAWAL_CREATE_SELF)
  @Post("withdrawals/quote")
  quoteWithdrawal(
    @CurrentUser() current: AuthenticatedUser,
    @Body() body: unknown,
  ) {
    return this.financial.quoteWithdrawal(current.id, body);
  }

  @RequirePermissions(Permissions.WITHDRAWAL_CREATE_SELF)
  @Post("withdrawals")
  createWithdrawal(
    @CurrentUser() current: AuthenticatedUser,
    @Body() body: unknown,
    @Headers("idempotency-key") headerKey?: string,
  ) {
    const payload = {
      ...(body as object),
      idempotencyKey: headerKey ?? (body as any)?.idempotencyKey,
    };
    return this.financial.createWithdrawal(current.id, payload);
  }

  @RequirePermissions(Permissions.PLAN_SUBSCRIBE_SELF)
  @Post("plans/:slug/subscribe")
  subscribe(
    @CurrentUser() current: AuthenticatedUser,
    @Param("slug") slug: string,
    @Body() body: unknown,
    @Headers("idempotency-key") headerKey?: string,
  ) {
    const payload = {
      ...(body as object),
      idempotencyKey: headerKey ?? (body as any)?.idempotencyKey,
    };
    return this.plans.subscribe(current.id, slug, payload);
  }

  @RequirePermissions(Permissions.USER_READ_SELF)
  @Get("support/cases")
  supportCases(@CurrentUser() current: AuthenticatedUser) {
    return this.prisma.supportCase.findMany({
      where: { userId: current.id },
      include: { notes: true },
      orderBy: { createdAt: "desc" },
    });
  }

  @RequirePermissions(Permissions.USER_READ_SELF)
  @Post("support/cases")
  async createSupportCase(
    @CurrentUser() current: AuthenticatedUser,
    @Body() body: unknown,
  ) {
    const input = z
      .object({
        subject: z.string().min(4).max(160),
        category: z.string().min(2).max(60),
        message: z.string().min(10).max(5_000),
      })
      .parse(body);
    const support = await this.prisma.supportCase.create({
      data: {
        userId: current.id,
        subject: input.subject,
        category: input.category,
        notes: { create: { authorUserId: current.id, body: input.message } },
      },
    });
    return support;
  }

  @RequirePermissions(Permissions.USER_MANAGE)
  @Get("admin/users")
  adminUsers() {
    return this.prisma.user.findMany({
      include: {
        profile: true,
        roles: { include: { role: true } },
        kycCases: { orderBy: { createdAt: "desc" }, take: 1 },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  @RequirePermissions(Permissions.USER_MANAGE)
  @Patch("admin/users/:id/status")
  async updateUserStatus(
    @CurrentUser() current: AuthenticatedUser,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const input = z
      .object({
        status: z.enum(["ACTIVE", "SUSPENDED", "CLOSED"]),
        reason: z.string().min(8).max(500),
      })
      .parse(body);
    if (current.id === id && input.status !== "ACTIVE") {
      throw new BadRequestException(
        "Administrators cannot suspend or close their own account.",
      );
    }
    const before = await this.prisma.user.findUniqueOrThrow({ where: { id } });
    const updated = await this.prisma.user.update({
      where: { id },
      data: { status: input.status },
    });
    await this.audit.record({
      actorUserId: current.id,
      action: "USER_STATUS_UPDATE",
      resourceType: "User",
      resourceId: id,
      reason: input.reason,
      outcome: "SUCCESS",
      before: { status: before.status },
      after: { status: updated.status },
    });
    return updated;
  }

  @RequirePermissions(Permissions.ROLE_MANAGE)
  @Post("admin/users/:id/roles")
  async assignUserRole(
    @CurrentUser() current: AuthenticatedUser,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const input = z
      .object({
        roleName: z.enum([
          Roles.INVESTOR,
          Roles.FINANCE_COMPLIANCE,
          Roles.ADMIN,
        ]),
        reason: z.string().min(8).max(500),
      })
      .parse(body);
    await this.prisma.user.findUniqueOrThrow({ where: { id } });
    const role = await this.prisma.role.findUniqueOrThrow({
      where: { name: input.roleName },
    });
    const assignment = await this.prisma.userRole.upsert({
      where: { userId_roleId: { userId: id, roleId: role.id } },
      create: { userId: id, roleId: role.id, assignedBy: current.id },
      update: { assignedBy: current.id, assignedAt: new Date() },
      include: { role: true },
    });
    await this.audit.record({
      actorUserId: current.id,
      action: "USER_ROLE_ASSIGN",
      resourceType: "User",
      resourceId: id,
      reason: input.reason,
      outcome: "SUCCESS",
      after: { role: input.roleName },
    });
    return assignment;
  }

  @RequirePermissions(Permissions.KYC_REVIEW)
  @Get("admin/kyc")
  kycQueue() {
    return this.prisma.kycCase.findMany({
      where: { status: { in: ["PENDING", "IN_REVIEW"] } },
      include: { user: { include: { profile: true } }, documents: true },
      orderBy: { createdAt: "asc" },
    });
  }

  @RequirePermissions(Permissions.WITHDRAWAL_REVIEW)
  @Get("admin/deposits")
  adminDeposits() {
    return this.prisma.deposit.findMany({
      include: { user: { include: { profile: true } } },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
  }

  @RequirePermissions(Permissions.WITHDRAWAL_REVIEW)
  @Get("admin/withdrawals")
  adminWithdrawals() {
    return this.prisma.withdrawal.findMany({
      include: { user: { include: { profile: true } }, payoutAccount: true },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
  }

  @RequirePermissions(Permissions.WITHDRAWAL_REVIEW)
  @Post("admin/withdrawals/:id/approve")
  async approveWithdrawal(
    @CurrentUser() current: AuthenticatedUser,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const { reason } = reasonSchema.parse(body);
    const before = await this.prisma.withdrawal.findUniqueOrThrow({
      where: { id },
    });
    const updated = await this.financial.approveWithdrawal(id, current.id, reason);
    await this.audit.record({
      actorUserId: current.id,
      action: "WITHDRAWAL_APPROVE",
      resourceType: "Withdrawal",
      resourceId: id,
      reason,
      outcome: "SUCCESS",
      before: { status: before.status } as unknown as Prisma.InputJsonValue,
      after: { status: (updated as { status: string }).status } as unknown as Prisma.InputJsonValue,
    });
    return updated;
  }

  @RequirePermissions(Permissions.WITHDRAWAL_REVIEW)
  @Post("admin/withdrawals/:id/mock-settle")
  async settleWithdrawal(
    @CurrentUser() current: AuthenticatedUser,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const { reason } = reasonSchema.parse(body);
    const result = await this.financial.settleMockWithdrawal(id);
    await this.audit.record({
      actorUserId: current.id,
      action: "WITHDRAWAL_SANDBOX_SETTLE",
      resourceType: "Withdrawal",
      resourceId: id,
      reason,
      outcome: "SUCCESS",
    });
    return result;
  }

  @RequirePermissions(Permissions.WITHDRAWAL_REVIEW)
  @Post("admin/withdrawals/release-scheduled")
  async releaseScheduled(
    @CurrentUser() current: AuthenticatedUser,
    @Body() body: unknown,
  ) {
    const { reason } = reasonSchema.parse(body);
    const result = await this.financial.releaseDueScheduledWithdrawals();
    await this.audit.record({
      actorUserId: current.id,
      action: "WITHDRAWAL_RELEASE_SCHEDULED",
      resourceType: "Withdrawal",
      reason,
      outcome: "SUCCESS",
      after: { released: result.count },
    });
    return { released: result.count };
  }

  @RequirePermissions(Permissions.WITHDRAWAL_REVIEW)
  @Post("admin/withdrawals/:id/reverse")
  async reverseWithdrawal(
    @CurrentUser() current: AuthenticatedUser,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const { reason } = reasonSchema.parse(body);
    const result = await this.financial.reverseFailedWithdrawal(id, reason);
    await this.audit.record({
      actorUserId: current.id,
      action: "WITHDRAWAL_REVERSE",
      resourceType: "Withdrawal",
      resourceId: id,
      reason,
      outcome: "SUCCESS",
    });
    return result;
  }

  @RequirePermissions(Permissions.PLAN_MANAGE)
  @Get("admin/plans")
  adminPlans() {
    return this.prisma.plan.findMany({ orderBy: { createdAt: "desc" } });
  }

  @RequirePermissions(Permissions.CONFIG_MANAGE)
  @Get("admin/config")
  adminConfig() {
    return this.prisma.platformConfiguration.findMany({
      orderBy: { version: "desc" },
    });
  }

  @RequirePermissions(Permissions.CONFIG_MANAGE)
  @Post("admin/config")
  async updateConfig(
    @CurrentUser() current: AuthenticatedUser,
    @Body() body: unknown,
  ) {
    const currentConfig = await this.config.active();
    const input = z
      .object({
        minimumDepositCentavos: z.string().regex(/^\d+$/),
        minimumWithdrawalCentavos: z.string().regex(/^\d+$/),
        withdrawalFeeRate: z.string().regex(/^0\.\d{1,6}$/),
        withdrawalOpensAt: z.string().regex(/^\d{2}:\d{2}$/),
        withdrawalClosesAt: z.string().regex(/^\d{2}:\d{2}$/),
        withdrawalOutsideWindowMode: z.enum(["BLOCK", "SCHEDULE"]),
        reason: z.string().min(8).max(500),
      })
      .parse(body);
    const next = await this.prisma.$transaction(async (tx) => {
      await tx.platformConfiguration.updateMany({
        where: { active: true },
        data: { active: false },
      });
      return tx.platformConfiguration.create({
        data: {
          version: currentConfig.version + 1,
          signupBonusCentavos: currentConfig.signupBonusCentavos,
          minimumDepositCentavos: BigInt(input.minimumDepositCentavos),
          minimumWithdrawalCentavos: BigInt(input.minimumWithdrawalCentavos),
          withdrawalFeeRate: new Prisma.Decimal(input.withdrawalFeeRate),
          withdrawalOpensAt: input.withdrawalOpensAt,
          withdrawalClosesAt: input.withdrawalClosesAt,
          withdrawalTimezone: currentConfig.withdrawalTimezone,
          withdrawalOutsideWindowMode: input.withdrawalOutsideWindowMode,
          defaultCurrency: currentConfig.defaultCurrency,
          promotionalCreditsWithdrawable:
            currentConfig.promotionalCreditsWithdrawable,
          manualReviewThresholdCentavos:
            currentConfig.manualReviewThresholdCentavos,
          active: true,
          effectiveAt: new Date(),
          changeReason: input.reason,
          updatedById: current.id,
        },
      });
    });
    await this.audit.record({
      actorUserId: current.id,
      action: "PLATFORM_CONFIG_UPDATE",
      resourceType: "PlatformConfiguration",
      resourceId: next.id,
      reason: input.reason,
      outcome: "SUCCESS",
    });
    return next;
  }

  @RequirePermissions(Permissions.AUDIT_READ)
  @Get("admin/ledger")
  ledgerExplorer(@Query("reference") reference?: string) {
    return this.prisma.ledgerTransaction.findMany({
      ...(reference
        ? {
            where: {
              reference: { contains: reference, mode: "insensitive" as const },
            },
          }
        : {}),
      include: { entries: { include: { account: true } } },
      orderBy: { effectiveAt: "desc" },
      take: 200,
    });
  }

  @RequirePermissions(Permissions.RECONCILIATION_REVIEW)
  @Get("admin/reconciliation")
  reconciliation() {
    return this.prisma.reconciliationRun.findMany({
      include: { discrepancies: true },
      orderBy: { businessDate: "desc" },
      take: 100,
    });
  }

  @RequirePermissions(Permissions.AUDIT_READ)
  @Get("admin/audit-logs")
  auditLogs() {
    return this.prisma.auditLog.findMany({
      include: { actor: { include: { profile: true } } },
      orderBy: { createdAt: "desc" },
      take: 300,
    });
  }

  @RequirePermissions(Permissions.ROLE_MANAGE)
  @Get("admin/roles")
  roles() {
    return this.prisma.role.findMany({
      include: { permissions: { include: { permission: true } } },
      orderBy: { name: "asc" },
    });
  }

  @RequirePermissions(Permissions.PLAN_MANAGE)
  @Post("admin/plans")
  async createPlan(
    @CurrentUser() current: AuthenticatedUser,
    @Body() body: unknown,
  ) {
    const input = z
      .object({
        slug: z.string().regex(/^[a-z0-9-]+$/),
        name: z.string().min(3).max(120),
        description: z.string().min(20).max(1_000),
        category: z.string().min(2).max(80),
        minimumCentavos: z.string().regex(/^\d+$/),
        maximumCentavos: z.string().regex(/^\d+$/).nullable(),
        durationDays: z.coerce.number().int().positive().max(3_650),
        riskClassification: z.string().min(2).max(80),
        managementFeeRate: z.string().regex(/^0\.\d{1,6}$/),
        dailyPayoutCentavos: z.string().regex(/^\d+$/).optional(),
        totalReturnCentavos: z.string().regex(/^\d+$/).optional(),
        targetPerformanceLow: z
          .string()
          .regex(/^0\.\d{1,6}$/)
          .nullable(),
        targetPerformanceHigh: z
          .string()
          .regex(/^0\.\d{1,6}$/)
          .nullable(),
        terms: z.string().min(20).max(10_000),
        status: z.enum(["DRAFT", "ACTIVE", "PAUSED", "CLOSED"]),
        reason: z.string().min(8).max(500),
      })
      .parse(body);
    const { reason, dailyPayoutCentavos: dailyInput, totalReturnCentavos: totalInput, ...values } =
      input;
    const dailyPayoutCentavos = BigInt(dailyInput ?? "0");
    const totalReturnCentavos = totalInput
      ? BigInt(totalInput)
      : dailyPayoutCentavos * BigInt(values.durationDays);
    const minimumCentavos = BigInt(values.minimumCentavos);
    const maximumCentavos = values.maximumCentavos
      ? BigInt(values.maximumCentavos)
      : null;
    if (maximumCentavos !== null && maximumCentavos < minimumCentavos) {
      throw new BadRequestException(
        "Maximum subscription amount cannot be lower than the minimum.",
      );
    }
    if (
      totalReturnCentavos !==
      dailyPayoutCentavos * BigInt(values.durationDays)
    ) {
      throw new BadRequestException(
        "Total return must equal daily payout multiplied by duration days.",
      );
    }
    const plan = await this.prisma.plan.create({
      data: {
        ...values,
        minimumCentavos,
        maximumCentavos,
        dailyPayoutCentavos,
        totalReturnCentavos,
        managementFeeRate: new Prisma.Decimal(values.managementFeeRate),
        targetPerformanceLow: values.targetPerformanceLow
          ? new Prisma.Decimal(values.targetPerformanceLow)
          : null,
        targetPerformanceHigh: values.targetPerformanceHigh
          ? new Prisma.Decimal(values.targetPerformanceHigh)
          : null,
        performanceLabel: "Illustrative target",
        eligibilityRequirements: { kyc: "VERIFIED", minimumAge: 18 },
      },
    });
    await this.audit.record({
      actorUserId: current.id,
      action: "PLAN_CREATE",
      resourceType: "Plan",
      resourceId: plan.id,
      reason,
      outcome: "SUCCESS",
    });
    return plan;
  }

  @RequirePermissions(Permissions.PLAN_MANAGE)
  @Patch("admin/plans/:id/status")
  async updatePlanStatus(
    @CurrentUser() current: AuthenticatedUser,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const input = z
      .object({
        status: z.enum(["DRAFT", "ACTIVE", "PAUSED", "CLOSED", "ARCHIVED"]),
        reason: z.string().min(8).max(500),
      })
      .parse(body);
    const before = await this.prisma.plan.findUniqueOrThrow({ where: { id } });
    const updated = await this.prisma.plan.update({
      where: { id },
      data: { status: input.status },
    });
    await this.audit.record({
      actorUserId: current.id,
      action: "PLAN_STATUS_UPDATE",
      resourceType: "Plan",
      resourceId: id,
      reason: input.reason,
      outcome: "SUCCESS",
      before: { status: before.status },
      after: { status: updated.status },
    });
    return updated;
  }

  @RequirePermissions(Permissions.CONFIG_MANAGE)
  @Get("admin/commission-rules")
  commissionRules() {
    return this.prisma.commissionRule.findMany({
      orderBy: { effectiveFrom: "desc" },
    });
  }

  @RequirePermissions(Permissions.CONFIG_MANAGE)
  @Post("admin/commission-rules")
  async createCommissionRule(
    @CurrentUser() current: AuthenticatedUser,
    @Body() body: unknown,
  ) {
    const input = z
      .object({
        name: z.string().min(3).max(120),
        rate: z.string().regex(/^0\.\d{1,6}$/),
        capCentavos: z.string().regex(/^\d+$/).nullable(),
        minimumSourceCentavos: z.string().regex(/^\d+$/).nullable(),
        level: z.coerce.number().int().min(1).max(3),
        effectiveFrom: z.string().datetime(),
        reason: z.string().min(8).max(500),
      })
      .parse(body);
    const rule = await this.prisma.commissionRule.create({
      data: {
        name: input.name,
        qualifyingEvent: "PLAN_SERVICE_FEE_CONFIRMED",
        rate: new Prisma.Decimal(input.rate),
        capCentavos: input.capCentavos ? BigInt(input.capCentavos) : null,
        minimumSourceCentavos: input.minimumSourceCentavos
          ? BigInt(input.minimumSourceCentavos)
          : null,
        eligibility: {
          kyc: "VERIFIED",
          selfReferral: false,
          depositAloneQualifies: false,
          level: input.level,
        },
        effectiveFrom: new Date(input.effectiveFrom),
      },
    });
    await this.audit.record({
      actorUserId: current.id,
      action: "COMMISSION_RULE_CREATE",
      resourceType: "CommissionRule",
      resourceId: rule.id,
      reason: input.reason,
      outcome: "SUCCESS",
    });
    return rule;
  }

  @RequirePermissions(Permissions.USER_MANAGE)
  @Get("admin/referrals")
  adminReferrals() {
    return this.prisma.referral.findMany({
      include: {
        referrer: { include: { profile: true } },
        referred: { include: { profile: true } },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  @RequirePermissions(Permissions.CONFIG_MANAGE)
  @Get("admin/announcements")
  adminAnnouncements() {
    return this.prisma.announcement.findMany({
      orderBy: { createdAt: "desc" },
    });
  }

  @RequirePermissions(Permissions.CONFIG_MANAGE)
  @Post("admin/announcements")
  async createAnnouncement(
    @CurrentUser() current: AuthenticatedUser,
    @Body() body: unknown,
  ) {
    const input = z
      .object({
        title: z.string().min(3).max(140),
        body: z.string().min(10).max(5_000),
        audience: z.enum(["ALL", "INVESTOR", "ADMIN"]),
        reason: z.string().min(8).max(500),
      })
      .parse(body);
    const announcement = await this.prisma.announcement.create({
      data: {
        title: input.title,
        body: input.body,
        audience: input.audience,
        publishedAt: new Date(),
      },
    });
    await this.audit.record({
      actorUserId: current.id,
      action: "ANNOUNCEMENT_PUBLISH",
      resourceType: "Announcement",
      resourceId: announcement.id,
      reason: input.reason,
      outcome: "SUCCESS",
    });
    return announcement;
  }

  @RequirePermissions(Permissions.KYC_REVIEW)
  @Post("admin/kyc/:id/decision")
  async decideKyc(
    @CurrentUser() current: AuthenticatedUser,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const input = z
      .object({
        status: z.enum(["VERIFIED", "REJECTED"]),
        reason: z.string().min(8).max(500),
      })
      .parse(body);
    const updated = await this.prisma.kycCase.update({
      where: { id },
      data: {
        status: input.status,
        reviewedAt: new Date(),
        reviewedBy: current.id,
        rejectionReason: input.status === "REJECTED" ? input.reason : null,
      },
    });
    await this.audit.record({
      actorUserId: current.id,
      action: "KYC_DECISION",
      resourceType: "KycCase",
      resourceId: id,
      reason: input.reason,
      outcome: "SUCCESS",
      after: { status: updated.status },
    });
    return updated;
  }

  @RequirePermissions(Permissions.RECONCILIATION_REVIEW)
  @Post("admin/reconciliation")
  async startReconciliation(
    @CurrentUser() current: AuthenticatedUser,
    @Body() body: unknown,
  ) {
    const input = z
      .object({
        provider: z.string().min(2).max(80),
        businessDate: z.string().date(),
        reason: z.string().min(8).max(500),
      })
      .parse(body);
    const run = await this.prisma.reconciliationRun.create({
      data: {
        provider: input.provider,
        businessDate: new Date(input.businessDate + "T00:00:00Z"),
      },
    });
    await this.audit.record({
      actorUserId: current.id,
      action: "RECONCILIATION_START",
      resourceType: "ReconciliationRun",
      resourceId: run.id,
      reason: input.reason,
      outcome: "SUCCESS",
    });
    return run;
  }

  @RequirePermissions(Permissions.AUDIT_READ)
  @Get("admin/reports/summary")
  async reportSummary() {
    const [users, deposits, withdrawals, plans, openKyc] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.deposit.aggregate({
        where: { status: "COMPLETED" },
        _sum: { amountCentavos: true },
      }),
      this.prisma.withdrawal.aggregate({
        where: { status: "COMPLETED" },
        _sum: { requestedCentavos: true, feeCentavos: true },
      }),
      this.prisma.plan.count({ where: { status: "ACTIVE" } }),
      this.prisma.kycCase.count({
        where: { status: { in: ["PENDING", "IN_REVIEW"] } },
      }),
    ]);
    return {
      users,
      deposits,
      withdrawals,
      plans,
      openKyc,
      generatedAt: new Date(),
    };
  }
}
