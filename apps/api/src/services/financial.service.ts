import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { LedgerAccountType, MoneyRequestStatus } from "@prisma/client";
import {
  allocateWithdrawal,
  assertApprovableWithdrawal,
  assertReversibleWithdrawal,
  assertSettleableWithdrawal,
  calculateWithdrawal,
  createDepositSchema,
  createWithdrawalSchema,
  getWithdrawalWindowStatus,
  parseCentavos,
  TransitionError,
  withdrawableBalance,
  withdrawalQuoteSchema,
} from "@vertex/types";
import { randomUUID } from "node:crypto";
import { PrismaService } from "./prisma.service";
import { ConfigService } from "./config.service";
import { LedgerService } from "./ledger.service";
import { ProvidersService } from "./providers.service";

@Injectable()
export class FinancialService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ConfigService) private readonly config: ConfigService,
    @Inject(LedgerService) private readonly ledger: LedgerService,
    @Inject(ProvidersService) private readonly providers: ProvidersService,
  ) {}

  private serialize<T>(value: T): T {
    return JSON.parse(
      JSON.stringify(value, (_key, item) => (typeof item === "bigint" ? item.toString() : item)),
    );
  }

  /** Maps a forbidden state transition onto 409 instead of an opaque 500. */
  private guardTransition(action: () => void) {
    try {
      action();
    } catch (error) {
      if (error instanceof TransitionError) {
        throw new ConflictException({
          message: error.message,
          code: error.code,
          status: error.status,
        });
      }
      throw error;
    }
  }

  async createDeposit(userId: string, raw: unknown) {
    const input = createDepositSchema.parse(raw);
    const amount = parseCentavos(input.amount);
    const config = await this.config.active();
    if (amount < config.minimumDepositCentavos) {
      throw new BadRequestException(
        "Minimum cash-in is " + config.minimumDepositCentavos.toString() + " centavos.",
      );
    }
    const prior = await this.prisma.deposit.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
    });
    if (prior) {
      if (prior.userId !== userId || prior.amountCentavos !== amount) {
        throw new ConflictException("Idempotency key was already used for a different request.");
      }
      return this.serialize(prior);
    }
    // The provider is contacted inside the transaction that persists the intent.
    // Writing the row first would leave an orphan PENDING deposit and a consumed
    // idempotency key whenever checkout fails, permanently stranding the customer
    // because every retry replays that unusable record.
    return this.prisma.$transaction(async (tx) => {
      const created = await tx.deposit.create({
        data: {
          userId,
          amountCentavos: amount,
          idempotencyKey: input.idempotencyKey,
          provider: "mock",
          status: MoneyRequestStatus.PENDING,
        },
      });
      const checkout = this.providers.createDepositCheckout(created.id);
      return this.serialize(
        await tx.deposit.update({
          where: { id: created.id },
          data: {
            provider: checkout.provider,
            providerReference: checkout.providerReference,
            checkoutUrl: checkout.checkoutUrl,
            status: MoneyRequestStatus.AWAITING_PROVIDER,
          },
        }),
      );
    });
  }

  async completeMockDeposit(userId: string, depositId: string) {
    this.providers.assertSandbox("payment");
    const payload = JSON.stringify({ type: "deposit.completed", depositId });
    const signature = this.providers.sign(payload);
    this.providers.verify(payload, signature);
    const eventId = "mock:deposit.completed:" + depositId;

    return this.prisma.$transaction(async (tx) => {
      const deposit = await tx.deposit.findUnique({ where: { id: depositId } });
      if (!deposit || deposit.userId !== userId) throw new NotFoundException("Deposit not found.");
      const existingWebhook = await tx.providerWebhook.findUnique({
        where: { provider_externalEventId: { provider: "mock", externalEventId: eventId } },
      });
      if (existingWebhook?.status === "PROCESSED") {
        return this.serialize(await tx.deposit.findUniqueOrThrow({ where: { id: depositId } }));
      }
      if (!existingWebhook) {
        await tx.providerWebhook.create({
          data: {
            provider: "mock",
            externalEventId: eventId,
            eventType: "deposit.completed",
            signature,
            rawPayload: { type: "deposit.completed", depositId },
            status: "VERIFIED",
          },
        });
      }
      if (deposit.status === MoneyRequestStatus.COMPLETED) {
        await tx.providerWebhook.update({
          where: { provider_externalEventId: { provider: "mock", externalEventId: eventId } },
          data: {
            status: "PROCESSED",
            processedAt: new Date(),
            processingResult: { depositId: deposit.id, duplicate: true },
          },
        });
        return this.serialize(deposit);
      }

      const platformCash = await tx.ledgerAccount.findUniqueOrThrow({
        where: { code: "PLATFORM:CASH" },
      });
      const userCash = await tx.ledgerAccount.findFirstOrThrow({
        where: { userId, type: LedgerAccountType.USER_DEPOSITED_CASH },
      });
      const posted = await this.ledger.post(tx, {
        reference: "DEP-" + deposit.id.slice(0, 8).toUpperCase(),
        idempotencyKey: "deposit:" + deposit.id,
        kind: "DEPOSIT_SETTLEMENT",
        description: "Sandbox deposit settlement",
        metadata: { depositId: deposit.id, providerReference: deposit.providerReference },
        lines: [
          {
            accountId: platformCash.id,
            direction: "DEBIT",
            amountCentavos: deposit.amountCentavos,
          },
          { accountId: userCash.id, direction: "CREDIT", amountCentavos: deposit.amountCentavos },
        ],
      });
      const completed = await tx.deposit.update({
        where: { id: deposit.id },
        data: {
          status: MoneyRequestStatus.COMPLETED,
          completedAt: new Date(),
          ledgerTransactionId: posted.id,
        },
      });
      await tx.wallet.update({
        where: { userId },
        data: {
          depositedAvailableCentavos: { increment: deposit.amountCentavos },
          projectionVersion: { increment: 1 },
        },
      });
      await tx.notification.create({
        data: {
          userId,
          type: "DEPOSIT_COMPLETED",
          title: "Cash-in completed",
          body: "Your sandbox cash-in is now reflected in your deposited balance.",
          data: { depositId: deposit.id },
        },
      });
      await tx.providerWebhook.update({
        where: { provider_externalEventId: { provider: "mock", externalEventId: eventId } },
        data: {
          status: "PROCESSED",
          processedAt: new Date(),
          processingResult: { depositId: deposit.id, ledgerTransactionId: posted.id },
        },
      });
      return this.serialize(completed);
    });
  }

  async quoteWithdrawal(userId: string, raw: unknown, now = new Date()) {
    const input = withdrawalQuoteSchema.parse(raw);
    const amount = parseCentavos(input.amount);
    const [config, user, wallet, payout] = await Promise.all([
      this.config.active(),
      this.prisma.user.findUnique({
        where: { id: userId },
        include: { kycCases: { orderBy: { createdAt: "desc" }, take: 1 } },
      }),
      this.prisma.wallet.findUnique({ where: { userId } }),
      this.prisma.payoutAccount.findFirst({
        where: {
          id: input.payoutAccountId,
          userId,
          active: true,
          verifiedAt: { not: null },
        },
      }),
    ]);
    if (!user || user.kycCases[0]?.status !== "VERIFIED") {
      throw new ForbiddenException("Completed KYC is required before withdrawing.");
    }
    if (!user.mfaEnabledAt) throw new ForbiddenException("MFA must be enabled before withdrawing.");
    if (!wallet) throw new NotFoundException("Wallet not found.");
    if (!payout) throw new BadRequestException("Select a verified payout account.");
    if (amount < config.minimumWithdrawalCentavos) {
      throw new BadRequestException(
        "Minimum withdrawal is " + config.minimumWithdrawalCentavos.toString() + " centavos.",
      );
    }
    const available = withdrawableBalance({
      deposited: wallet.depositedAvailableCentavos,
      commission: wallet.commissionAvailableCentavos,
      promotional: wallet.promotionalAvailableCentavos,
      promotionalWithdrawable: config.promotionalCreditsWithdrawable,
    });
    if (amount > available) throw new BadRequestException("Insufficient withdrawable balance.");

    const basisPoints = BigInt(
      config.withdrawalFeeRate.mul(10_000).toDecimalPlaces(0).toString(),
    );
    const calculation = calculateWithdrawal(amount, basisPoints);
    const window = getWithdrawalWindowStatus(now, {
      timezone: config.withdrawalTimezone,
      opensAt: config.withdrawalOpensAt,
      closesAt: config.withdrawalClosesAt,
      outsideWindowMode:
        config.withdrawalOutsideWindowMode === "SCHEDULE" ? "SCHEDULE" : "BLOCK",
    });
    return {
      requestedCentavos: calculation.requested.toString(),
      feeCentavos: calculation.fee.toString(),
      netCentavos: calculation.net.toString(),
      feeRate: config.withdrawalFeeRate.toString(),
      withdrawableCentavos: available.toString(),
      destination: {
        id: payout.id,
        institutionName: payout.institutionName,
        maskedIdentifier: payout.maskedIdentifier,
      },
      estimatedProcessingTime: "1–2 business days after approval",
      window,
    };
  }

  async createWithdrawal(userId: string, raw: unknown) {
    const input = createWithdrawalSchema.parse(raw);
    if ((process.env.AUTH_PROVIDER ?? "mock") === "mock" && input.mfaCode !== "123456") {
      throw new ForbiddenException("Invalid demonstration MFA code.");
    }
    // A reservation must never be taken for a payout channel that cannot deliver
    // it. Without this gate a licensed deployment strands customer funds in the
    // reserve account with no settlement path.
    this.providers.assertPayoutAvailable();
    const amount = parseCentavos(input.amount);
    const prior = await this.prisma.withdrawal.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
    });
    if (prior) {
      if (prior.userId !== userId || prior.requestedCentavos !== amount) {
        throw new ConflictException("Idempotency key was already used for a different request.");
      }
      return this.serialize(prior);
    }
    const quote = await this.quoteWithdrawal(userId, input);
    if (!quote.window.isOpen && quote.window.mode === "BLOCK") {
      throw new BadRequestException({
        message: "Withdrawals are currently closed.",
        nextOpenAt: quote.window.nextOpenAt,
      });
    }

    return this.prisma.$transaction(async (tx) => {
      const config = await this.config.active(tx);
      const wallet = await tx.wallet.findUniqueOrThrow({ where: { userId } });
      // Uses the same policy as the quote, so a quoted amount can always be
      // reserved. Promotional credit is included only when the active
      // configuration permits it, matching withdrawableBalance above.
      const { fromDeposit, fromCommission, fromPromotional, shortfall } = allocateWithdrawal(
        amount,
        {
          deposited: wallet.depositedAvailableCentavos,
          commission: wallet.commissionAvailableCentavos,
          promotional: config.promotionalCreditsWithdrawable
            ? wallet.promotionalAvailableCentavos
            : 0n,
        },
      );
      if (shortfall > 0n) {
        throw new BadRequestException("Insufficient withdrawable balance.");
      }
      const accounts = await tx.ledgerAccount.findMany({ where: { userId } });
      const cash = accounts.find(
        (account) => account.type === LedgerAccountType.USER_DEPOSITED_CASH,
      );
      const commission = accounts.find(
        (account) => account.type === LedgerAccountType.USER_COMMISSION,
      );
      const promotional = accounts.find(
        (account) => account.type === LedgerAccountType.USER_PROMOTIONAL_CREDIT,
      );
      const reserve = accounts.find(
        (account) => account.type === LedgerAccountType.USER_WITHDRAWAL_RESERVE,
      );
      if (!cash || !commission || !promotional || !reserve) {
        throw new Error("Required ledger accounts are missing.");
      }

      const posted = await this.ledger.post(tx, {
        reference: "WDR-RES-" + randomUUID().slice(0, 8).toUpperCase(),
        idempotencyKey: "withdrawal:reserve:" + input.idempotencyKey,
        kind: "WITHDRAWAL_RESERVATION",
        description: "Reserve requested withdrawal amount",
        metadata: {
          sourceDepositCentavos: fromDeposit.toString(),
          sourceCommissionCentavos: fromCommission.toString(),
          sourcePromotionalCentavos: fromPromotional.toString(),
        },
        lines: [
          ...(fromDeposit > 0n
            ? [{ accountId: cash.id, direction: "DEBIT" as const, amountCentavos: fromDeposit }]
            : []),
          ...(fromCommission > 0n
            ? [
                {
                  accountId: commission.id,
                  direction: "DEBIT" as const,
                  amountCentavos: fromCommission,
                },
              ]
            : []),
          ...(fromPromotional > 0n
            ? [
                {
                  accountId: promotional.id,
                  direction: "DEBIT" as const,
                  amountCentavos: fromPromotional,
                },
              ]
            : []),
          { accountId: reserve.id, direction: "CREDIT", amountCentavos: amount },
        ],
      });
      const reviewRequired = amount >= config.manualReviewThresholdCentavos;
      const withdrawal = await tx.withdrawal.create({
        data: {
          userId,
          payoutAccountId: input.payoutAccountId,
          requestedCentavos: amount,
          feeCentavos: BigInt(quote.feeCentavos),
          netCentavos: BigInt(quote.netCentavos),
          status: !quote.window.isOpen
            ? MoneyRequestStatus.SCHEDULED
            : reviewRequired
              ? MoneyRequestStatus.AWAITING_REVIEW
              : MoneyRequestStatus.PROCESSING,
          idempotencyKey: input.idempotencyKey,
          provider: "mock",
          scheduledFor: quote.window.nextOpenAt ? new Date(quote.window.nextOpenAt) : null,
          reservationTxnId: posted.id,
          reviewRequired,
        },
      });
      await tx.wallet.update({
        where: { userId },
        data: {
          depositedAvailableCentavos: { decrement: fromDeposit },
          commissionAvailableCentavos: { decrement: fromCommission },
          promotionalAvailableCentavos: { decrement: fromPromotional },
          reservedCentavos: { increment: amount },
          projectionVersion: { increment: 1 },
        },
      });
      await tx.notification.create({
        data: {
          userId,
          type: "WITHDRAWAL_CREATED",
          title: "Withdrawal request received",
          body: reviewRequired
            ? "Your request is awaiting finance review."
            : "Your sandbox payout is being processed.",
          data: { withdrawalId: withdrawal.id },
        },
      });
      return this.serialize(withdrawal);
    });
  }

  async settleMockWithdrawal(withdrawalId: string, now = new Date()) {
    this.providers.assertSandbox("payout");
    return this.prisma.$transaction(async (tx) => {
      const withdrawal = await tx.withdrawal.findUniqueOrThrow({ where: { id: withdrawalId } });
      if (withdrawal.status === MoneyRequestStatus.COMPLETED) return this.serialize(withdrawal);
      // Only PROCESSING requests settle. Reviewed requests require approval and
      // scheduled requests require promotion by the due-release job first.
      this.guardTransition(() =>
        assertSettleableWithdrawal(withdrawal.status, withdrawal.scheduledFor, now),
      );

      const eventId = "mock:payout.settled:" + withdrawalId;
      const payload = JSON.stringify({ type: "payout.settled", withdrawalId });
      const signature = this.providers.sign(payload);
      this.providers.verify(payload, signature);
      const existingWebhook = await tx.providerWebhook.findUnique({
        where: { provider_externalEventId: { provider: "mock", externalEventId: eventId } },
      });
      if (existingWebhook?.status === "PROCESSED") {
        return this.serialize(withdrawal);
      }
      if (!existingWebhook) {
        await tx.providerWebhook.create({
          data: {
            provider: "mock",
            externalEventId: eventId,
            eventType: "payout.settled",
            signature,
            rawPayload: { type: "payout.settled", withdrawalId },
            status: "VERIFIED",
          },
        });
      }

      const reserve = await tx.ledgerAccount.findFirstOrThrow({
        where: {
          userId: withdrawal.userId,
          type: LedgerAccountType.USER_WITHDRAWAL_RESERVE,
        },
      });
      const platformCash = await tx.ledgerAccount.findUniqueOrThrow({
        where: { code: "PLATFORM:CASH" },
      });
      let feeRevenue = await tx.ledgerAccount.findUnique({
        where: { code: "PLATFORM:FEE_REVENUE" },
      });
      if (!feeRevenue) {
        feeRevenue = await tx.ledgerAccount.create({
          data: {
            code: "PLATFORM:FEE_REVENUE",
            name: "Withdrawal fee revenue",
            type: LedgerAccountType.PLATFORM_FEE_REVENUE,
            normalBalance: "CREDIT",
          },
        });
      }
      const posted = await this.ledger.post(tx, {
        reference: "WDR-SET-" + withdrawal.id.slice(0, 8).toUpperCase(),
        idempotencyKey: "withdrawal:settle:" + withdrawal.id,
        kind: "WITHDRAWAL_SETTLEMENT",
        description: "Sandbox payout settlement and withdrawal fee",
        metadata: { withdrawalId },
        lines: [
          {
            accountId: reserve.id,
            direction: "DEBIT",
            amountCentavos: withdrawal.requestedCentavos,
          },
          {
            accountId: platformCash.id,
            direction: "CREDIT",
            amountCentavos: withdrawal.netCentavos,
          },
          {
            accountId: feeRevenue.id,
            direction: "CREDIT",
            amountCentavos: withdrawal.feeCentavos,
          },
        ],
      });
      const providerReference = "mock_payout_" + randomUUID();
      const result = await tx.withdrawal.update({
        where: { id: withdrawalId },
        data: {
          status: MoneyRequestStatus.COMPLETED,
          settlementTxnId: posted.id,
          providerReference,
          completedAt: new Date(),
        },
      });
      await tx.wallet.update({
        where: { userId: withdrawal.userId },
        data: {
          reservedCentavos: { decrement: withdrawal.requestedCentavos },
          projectionVersion: { increment: 1 },
        },
      });
      await tx.notification.create({
        data: {
          userId: withdrawal.userId,
          type: "WITHDRAWAL_COMPLETED",
          title: "Withdrawal completed",
          body: "The sandbox payout completed successfully.",
          data: { withdrawalId },
        },
      });
      await tx.providerWebhook.update({
        where: { provider_externalEventId: { provider: "mock", externalEventId: eventId } },
        data: {
          status: "PROCESSED",
          processedAt: new Date(),
          processingResult: { withdrawalId, ledgerTransactionId: posted.id, providerReference },
        },
      });
      return this.serialize(result);
    });
  }

  /**
   * Promotes scheduled withdrawals whose release time has passed into PROCESSING.
   * Without this a request created while the operating window was closed would
   * never leave SCHEDULED and could not be paid out.
   */
  async releaseDueScheduledWithdrawals(now = new Date()) {
    return this.prisma.withdrawal.updateMany({
      where: {
        status: MoneyRequestStatus.SCHEDULED,
        scheduledFor: { lte: now },
      },
      data: { status: MoneyRequestStatus.PROCESSING },
    });
  }

  async reverseFailedWithdrawal(withdrawalId: string, reason: string) {
    this.providers.assertSandbox("payout");
    return this.prisma.$transaction(async (tx) => {
      const withdrawal = await tx.withdrawal.findUniqueOrThrow({
        where: { id: withdrawalId },
        include: { reservationTransaction: true },
      });
      if (withdrawal.status === MoneyRequestStatus.REVERSED) return this.serialize(withdrawal);
      // A settled or already-released request holds no reservation, so posting a
      // reversal would debit the reserve account a second time and drive the
      // wallet's reserved balance negative.
      this.guardTransition(() => assertReversibleWithdrawal(withdrawal.status));

      const metadata = (withdrawal.reservationTransaction?.metadata ?? {}) as Record<string, string>;
      const toDeposit = BigInt(metadata.sourceDepositCentavos ?? "0");
      const toCommission = BigInt(metadata.sourceCommissionCentavos ?? "0");
      const toPromotional = BigInt(metadata.sourcePromotionalCentavos ?? "0");
      const accounts = await tx.ledgerAccount.findMany({ where: { userId: withdrawal.userId } });
      const cash = accounts.find(
        (item) => item.type === LedgerAccountType.USER_DEPOSITED_CASH,
      );
      const commission = accounts.find(
        (item) => item.type === LedgerAccountType.USER_COMMISSION,
      );
      const promotional = accounts.find(
        (item) => item.type === LedgerAccountType.USER_PROMOTIONAL_CREDIT,
      );
      const reserve = accounts.find(
        (item) => item.type === LedgerAccountType.USER_WITHDRAWAL_RESERVE,
      );
      if (!cash || !commission || !promotional || !reserve) {
        throw new Error("Required ledger accounts are missing.");
      }
      const posted = await this.ledger.post(tx, {
        reference: "WDR-REV-" + withdrawal.id.slice(0, 8).toUpperCase(),
        idempotencyKey: "withdrawal:reverse:" + withdrawal.id,
        kind: "WITHDRAWAL_REVERSAL",
        description: "Release reserved funds after failed payout",
        metadata: { withdrawalId, reason },
        lines: [
          {
            accountId: reserve.id,
            direction: "DEBIT",
            amountCentavos: withdrawal.requestedCentavos,
          },
          ...(toDeposit > 0n
            ? [{ accountId: cash.id, direction: "CREDIT" as const, amountCentavos: toDeposit }]
            : []),
          ...(toCommission > 0n
            ? [
                {
                  accountId: commission.id,
                  direction: "CREDIT" as const,
                  amountCentavos: toCommission,
                },
              ]
            : []),
          ...(toPromotional > 0n
            ? [
                {
                  accountId: promotional.id,
                  direction: "CREDIT" as const,
                  amountCentavos: toPromotional,
                },
              ]
            : []),
        ],
      });
      const result = await tx.withdrawal.update({
        where: { id: withdrawalId },
        data: {
          status: MoneyRequestStatus.REVERSED,
          rejectionReason: reason,
          reversalTxnId: posted.id,
        },
      });
      await tx.wallet.update({
        where: { userId: withdrawal.userId },
        data: {
          depositedAvailableCentavos: { increment: toDeposit },
          commissionAvailableCentavos: { increment: toCommission },
          promotionalAvailableCentavos: { increment: toPromotional },
          reservedCentavos: { decrement: withdrawal.requestedCentavos },
          projectionVersion: { increment: 1 },
        },
      });
      return this.serialize(result);
    });
  }

  /**
   * Promotes a reviewed withdrawal into PROCESSING. Rejects any
   * request that is not awaiting a decision, so a settled payout cannot be pushed
   * back into the processing queue and paid a second time.
   */
  async approveWithdrawal(withdrawalId: string, reviewerId: string, reason: string) {
    return this.prisma.$transaction(async (tx) => {
      const withdrawal = await tx.withdrawal.findUniqueOrThrow({ where: { id: withdrawalId } });
      this.guardTransition(() => assertApprovableWithdrawal(withdrawal.status));
      return this.serialize(
        await tx.withdrawal.update({
          where: { id: withdrawalId },
          data: {
            status: MoneyRequestStatus.PROCESSING,
            reviewedBy: reviewerId,
            reviewReason: reason,
          },
        }),
      );
    });
  }
}
