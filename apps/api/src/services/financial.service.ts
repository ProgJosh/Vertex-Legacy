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
  calculateWithdrawal,
  createDepositSchema,
  createWithdrawalSchema,
  getWithdrawalWindowStatus,
  parseCentavos,
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
    const created = await this.prisma.deposit.create({
      data: {
        userId,
        amountCentavos: amount,
        idempotencyKey: input.idempotencyKey,
        provider: "mock",
        status: MoneyRequestStatus.PENDING,
      },
    });
    const checkout = this.providers.createDepositCheckout(created.id);
    const deposit = await this.prisma.deposit.update({
      where: { id: created.id },
      data: {
        provider: checkout.provider,
        providerReference: checkout.providerReference,
        checkoutUrl: checkout.checkoutUrl,
        status: MoneyRequestStatus.AWAITING_PROVIDER,
      },
    });
    return this.serialize(deposit);
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
      if (deposit.status === MoneyRequestStatus.COMPLETED) return this.serialize(deposit);

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
    const withdrawable =
      wallet.depositedAvailableCentavos +
      wallet.commissionAvailableCentavos +
      (config.promotionalCreditsWithdrawable ? wallet.promotionalAvailableCentavos : 0n);
    if (amount > withdrawable) throw new BadRequestException("Insufficient withdrawable balance.");

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
      const fromDeposit =
        wallet.depositedAvailableCentavos >= amount ? amount : wallet.depositedAvailableCentavos;
      const fromCommission = amount - fromDeposit;
      if (fromCommission > wallet.commissionAvailableCentavos) {
        throw new BadRequestException("Insufficient withdrawable balance.");
      }
      const accounts = await tx.ledgerAccount.findMany({ where: { userId } });
      const cash = accounts.find(
        (account) => account.type === LedgerAccountType.USER_DEPOSITED_CASH,
      );
      const commission = accounts.find(
        (account) => account.type === LedgerAccountType.USER_COMMISSION,
      );
      const reserve = accounts.find(
        (account) => account.type === LedgerAccountType.USER_WITHDRAWAL_RESERVE,
      );
      if (!cash || !commission || !reserve) throw new Error("Required ledger accounts are missing.");

      const posted = await this.ledger.post(tx, {
        reference: "WDR-RES-" + randomUUID().slice(0, 8).toUpperCase(),
        idempotencyKey: "withdrawal:reserve:" + input.idempotencyKey,
        kind: "WITHDRAWAL_RESERVATION",
        description: "Reserve requested withdrawal amount",
        metadata: {
          sourceDepositCentavos: fromDeposit.toString(),
          sourceCommissionCentavos: fromCommission.toString(),
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

  async settleMockWithdrawal(withdrawalId: string) {
    this.providers.assertSandbox("payout");
    return this.prisma.$transaction(async (tx) => {
      const withdrawal = await tx.withdrawal.findUniqueOrThrow({ where: { id: withdrawalId } });
      if (withdrawal.status === MoneyRequestStatus.COMPLETED) return this.serialize(withdrawal);
      if (
        withdrawal.status !== MoneyRequestStatus.PROCESSING &&
        withdrawal.status !== MoneyRequestStatus.AWAITING_REVIEW
      ) {
        throw new ConflictException("Withdrawal is not ready for settlement.");
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
      const result = await tx.withdrawal.update({
        where: { id: withdrawalId },
        data: {
          status: MoneyRequestStatus.COMPLETED,
          settlementTxnId: posted.id,
          providerReference: "mock_payout_" + randomUUID(),
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
      return this.serialize(result);
    });
  }

  async reverseFailedWithdrawal(withdrawalId: string, reason: string) {
    return this.prisma.$transaction(async (tx) => {
      const withdrawal = await tx.withdrawal.findUniqueOrThrow({
        where: { id: withdrawalId },
        include: { reservationTransaction: true },
      });
      if (withdrawal.status === MoneyRequestStatus.REVERSED) return this.serialize(withdrawal);
      const metadata = (withdrawal.reservationTransaction?.metadata ?? {}) as Record<string, string>;
      const toDeposit = BigInt(metadata.sourceDepositCentavos ?? "0");
      const toCommission = BigInt(metadata.sourceCommissionCentavos ?? "0");
      const accounts = await tx.ledgerAccount.findMany({ where: { userId: withdrawal.userId } });
      const cash = accounts.find(
        (item) => item.type === LedgerAccountType.USER_DEPOSITED_CASH,
      );
      const commission = accounts.find(
        (item) => item.type === LedgerAccountType.USER_COMMISSION,
      );
      const reserve = accounts.find(
        (item) => item.type === LedgerAccountType.USER_WITHDRAWAL_RESERVE,
      );
      if (!cash || !commission || !reserve) throw new Error("Required ledger accounts are missing.");
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
          reservedCentavos: { decrement: withdrawal.requestedCentavos },
          projectionVersion: { increment: 1 },
        },
      });
      return this.serialize(result);
    });
  }
}
