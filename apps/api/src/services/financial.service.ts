import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { LedgerAccountType, MoneyRequestStatus, Prisma } from "@prisma/client";
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
  submitManualDepositSchema,
  submitManualPayoutSchema,
  TransitionError,
  withdrawableBalance,
  withdrawalQuoteSchema,
} from "@vertex/types";
import { randomUUID } from "node:crypto";
import { PrismaService } from "./prisma.service";
import { ConfigService } from "./config.service";
import { LedgerService } from "./ledger.service";
import { ProvidersService } from "./providers.service";
import { decryptPayoutIdentifier } from "./payout-account-crypto";

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
    const manual = process.env.PAYMENT_PROVIDER === "manual";
    if (manual && process.env.MANUAL_PAYMENTS_ENABLED !== "true") {
      throw new ServiceUnavailableException(
        "Manual GCash and Maya deposits are awaiting approved business-wallet activation.",
      );
    }
    if (manual && !input.paymentChannel) {
      throw new BadRequestException("Select GCash or Maya before creating a cash-in request.");
    }
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
      if (
        prior.userId !== userId ||
        prior.amountCentavos !== amount ||
        (manual && prior.paymentChannel !== input.paymentChannel)
      ) {
        throw new ConflictException("Idempotency key was already used for a different request.");
      }
      return this.serialize(prior);
    }
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { profile: true },
    });
    return this.prisma.$transaction(async (tx) => {
      const created = await tx.deposit.create({
        data: {
          userId,
          amountCentavos: amount,
          idempotencyKey: input.idempotencyKey,
          provider: manual ? "manual-" + input.paymentChannel!.toLowerCase() : "mock",
          paymentChannel: manual ? input.paymentChannel! : null,
          status: manual ? MoneyRequestStatus.AWAITING_PROVIDER : MoneyRequestStatus.PENDING,
        },
      });
      if (manual) return this.serialize(created);
      const checkout = await this.providers.createDepositCheckout({
        depositId: created.id,
        amountCentavos: amount,
        currency: "PHP",
        customerEmail: user.email,
        customerPhone: user.mobile ?? undefined,
        returnUrl: `${process.env.WEB_ORIGIN}/investor/wallet?deposit=success`,
        webhookUrl: `${process.env.INTERNAL_API_URL}/providers/webhook`,
      });
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

  async submitManualDeposit(userId: string, depositId: string, raw: unknown) {
    if (
      process.env.PAYMENT_PROVIDER !== "manual" ||
      process.env.MANUAL_PAYMENTS_ENABLED !== "true"
    ) {
      throw new ServiceUnavailableException("Manual wallet deposits are not enabled.");
    }
    const input = submitManualDepositSchema.parse(raw);
    const normalizedReference = input.paymentReference.trim().toUpperCase();

    return this.prisma.$transaction(async (tx) => {
      const deposit = await tx.deposit.findUnique({ where: { id: depositId } });
      if (!deposit || deposit.userId !== userId) throw new NotFoundException("Deposit not found.");
      if (!deposit.paymentChannel || !deposit.provider.startsWith("manual-")) {
        throw new ConflictException("This deposit is not a manual wallet transfer.");
      }
      const providerReference =
        "MANUAL:" + deposit.paymentChannel + ":" + normalizedReference;
      if (
        deposit.status === MoneyRequestStatus.AWAITING_REVIEW &&
        deposit.providerReference === providerReference
      ) {
        return this.serialize(deposit);
      }
      if (deposit.status !== MoneyRequestStatus.AWAITING_PROVIDER) {
        throw new ConflictException("This deposit can no longer accept payment details.");
      }
      const duplicate = await tx.deposit.findFirst({
        where: { providerReference, id: { not: deposit.id } },
        select: { id: true },
      });
      if (duplicate) {
        throw new ConflictException("That transaction reference was already submitted.");
      }
      const claimed = await tx.deposit.updateMany({
        where: {
          id: deposit.id,
          status: MoneyRequestStatus.AWAITING_PROVIDER,
        },
        data: {
          providerReference,
          senderName: input.senderName,
          senderMobileLast4: input.senderMobileLast4,
          submittedAt: new Date(),
          status: MoneyRequestStatus.AWAITING_REVIEW,
        },
      });
      if (claimed.count !== 1) {
        const current = await tx.deposit.findUniqueOrThrow({ where: { id: deposit.id } });
        if (
          current.status === MoneyRequestStatus.AWAITING_REVIEW &&
          current.providerReference === providerReference
        ) {
          return this.serialize(current);
        }
        throw new ConflictException("Payment details were already submitted for this deposit.");
      }
      const submitted = await tx.deposit.findUniqueOrThrow({ where: { id: deposit.id } });
      await tx.notification.create({
        data: {
          userId,
          type: "DEPOSIT_REVIEW_PENDING",
          title: "Cash-in submitted for verification",
          body: "Finance must match the wallet transaction before your balance can be credited.",
          data: { depositId: deposit.id, paymentChannel: deposit.paymentChannel },
        },
      });
      return this.serialize(submitted);
    });
  }

  async approveManualDeposit(depositId: string, reviewerId: string, reason: string) {
    return this.prisma.$transaction(async (tx) => {
      const deposit = await tx.deposit.findUnique({ where: { id: depositId } });
      if (!deposit) throw new NotFoundException("Deposit not found.");
      if (!deposit.provider.startsWith("manual-")) {
        throw new ConflictException("Only manual wallet deposits can be reviewed here.");
      }
      if (deposit.status === MoneyRequestStatus.COMPLETED) return this.serialize(deposit);
      if (deposit.status !== MoneyRequestStatus.AWAITING_REVIEW || !deposit.providerReference) {
        throw new ConflictException("Only submitted deposits awaiting review can be approved.");
      }
      const claimed = await tx.deposit.updateMany({
        where: { id: deposit.id, status: MoneyRequestStatus.AWAITING_REVIEW },
        data: { status: MoneyRequestStatus.PROCESSING },
      });
      if (claimed.count !== 1) throw new ConflictException("Deposit is already being reviewed.");

      const platformCash = await tx.ledgerAccount.findUniqueOrThrow({
        where: { code: "PLATFORM:CASH" },
      });
      const userCash = await tx.ledgerAccount.findFirstOrThrow({
        where: { userId: deposit.userId, type: LedgerAccountType.USER_DEPOSITED_CASH },
      });
      const posted = await this.ledger.post(tx, {
        reference: "DEP-" + deposit.id.slice(0, 8).toUpperCase(),
        idempotencyKey: "manual-deposit:" + deposit.id,
        kind: "MANUAL_DEPOSIT_SETTLEMENT",
        description: `${deposit.paymentChannel ?? "Wallet"} transfer verified by finance`,
        metadata: {
          depositId: deposit.id,
          providerReference: deposit.providerReference,
          reviewerId,
        },
        lines: [
          { accountId: platformCash.id, direction: "DEBIT", amountCentavos: deposit.amountCentavos },
          { accountId: userCash.id, direction: "CREDIT", amountCentavos: deposit.amountCentavos },
        ],
      });
      const completed = await tx.deposit.update({
        where: { id: deposit.id },
        data: {
          status: MoneyRequestStatus.COMPLETED,
          completedAt: new Date(),
          ledgerTransactionId: posted.id,
          reviewedBy: reviewerId,
          reviewReason: reason,
        },
      });
      await tx.wallet.update({
        where: { userId: deposit.userId },
        data: {
          depositedAvailableCentavos: { increment: deposit.amountCentavos },
          projectionVersion: { increment: 1 },
        },
      });
      await tx.notification.create({
        data: {
          userId: deposit.userId,
          type: "DEPOSIT_COMPLETED",
          title: "Cash-in verified",
          body: "Finance matched your wallet transfer and credited your deposited balance.",
          data: { depositId: deposit.id },
        },
      });
      return this.serialize(completed);
    });
  }

  async rejectManualDeposit(depositId: string, reviewerId: string, reason: string) {
    return this.prisma.$transaction(async (tx) => {
      const deposit = await tx.deposit.findUnique({ where: { id: depositId } });
      if (!deposit) throw new NotFoundException("Deposit not found.");
      if (!deposit.provider.startsWith("manual-")) {
        throw new ConflictException("Only manual wallet deposits can be reviewed here.");
      }
      if (deposit.status !== MoneyRequestStatus.AWAITING_REVIEW) {
        throw new ConflictException("Only submitted deposits awaiting review can be rejected.");
      }
      const claimed = await tx.deposit.updateMany({
        where: {
          id: deposit.id,
          status: MoneyRequestStatus.AWAITING_REVIEW,
        },
        data: {
          status: MoneyRequestStatus.REJECTED,
          failureReason: reason,
          reviewedBy: reviewerId,
          reviewReason: reason,
        },
      });
      if (claimed.count !== 1) throw new ConflictException("Deposit is already being reviewed.");
      const rejected = await tx.deposit.findUniqueOrThrow({ where: { id: deposit.id } });
      await tx.notification.create({
        data: {
          userId: deposit.userId,
          type: "DEPOSIT_REJECTED",
          title: "Cash-in could not be verified",
          body: "Finance could not match the submitted transfer. Review the reason before trying again.",
          data: { depositId: deposit.id, reason },
        },
      });
      return this.serialize(rejected);
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
    const manualPayout = this.activePayoutProvider() === "manual";
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

    const payoutAccount = await this.prisma.payoutAccount.findUniqueOrThrow({
      where: { id: input.payoutAccountId },
    });

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
      const reviewRequired =
        manualPayout || amount >= config.manualReviewThresholdCentavos;

      let providerResult: {
        provider: string;
        providerReference: string | null;
        status: "pending" | "processing" | "completed" | "failed";
      } = manualPayout
        ? { provider: "manual", providerReference: null, status: "pending" }
        : {
            provider: "mock",
            providerReference: "mock_payout_" + randomUUID(),
            status: "pending",
          };
      if (!["mock", "manual"].includes(this.activePayoutProvider())) {
        providerResult = await this.providers.createPayout({
          withdrawalId: "", // Will be updated after creation
          amountCentavos: amount,
          currency: "PHP",
          destination: {
            type: payoutAccount.type === "EWALLET" ? "ewallet" : "bank_account",
            accountHolderName: payoutAccount.accountHolderName,
            accountDetails: {
              accountNumber: payoutAccount.maskedIdentifier,
              bankCode: payoutAccount.providerToken ?? "",
              ewalletType: payoutAccount.type === "EWALLET" ? "GCASH" : undefined,
              ewalletId: payoutAccount.type === "EWALLET" ? payoutAccount.maskedIdentifier : undefined,
            },
          },
          webhookUrl: `${process.env.INTERNAL_API_URL}/providers/webhook`,
        });
      }

      const withdrawal = await tx.withdrawal.create({
        data: {
          userId,
          payoutAccountId: input.payoutAccountId,
          requestedCentavos: amount,
          feeCentavos: BigInt(quote.feeCentavos),
          netCentavos: BigInt(quote.netCentavos),
          status: !quote.window.isOpen
            ? MoneyRequestStatus.SCHEDULED
            : manualPayout || reviewRequired
              ? MoneyRequestStatus.AWAITING_REVIEW
              : MoneyRequestStatus.PROCESSING,
          idempotencyKey: input.idempotencyKey,
          provider: providerResult.provider,
          providerReference: providerResult.providerReference,
          scheduledFor: quote.window.nextOpenAt ? new Date(quote.window.nextOpenAt) : null,
          reservationTxnId: posted.id,
          reviewRequired,
        },
      });

      // Update payout with actual withdrawal ID
      if (!["mock", "manual"].includes(this.activePayoutProvider()) && providerResult.providerReference) {
        // Provider already has the withdrawal ID in metadata
      }

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
            : "Your payout is being processed.",
          data: { withdrawalId: withdrawal.id },
        },
      });
      return this.serialize(withdrawal);
    });
  }

  private assertManualPayoutEnabled() {
    if (
      this.activePayoutProvider() !== "manual" ||
      process.env.MANUAL_PAYOUTS_ENABLED !== "true"
    ) {
      throw new ServiceUnavailableException("Manual GCash and Maya payouts are not enabled.");
    }
  }

  async getManualPayoutInstruction(withdrawalId: string) {
    this.assertManualPayoutEnabled();
    const withdrawal = await this.prisma.withdrawal.findUniqueOrThrow({
      where: { id: withdrawalId },
      include: { payoutAccount: true },
    });
    if (
      withdrawal.provider !== "manual" ||
      withdrawal.status !== MoneyRequestStatus.PROCESSING
    ) {
      throw new ConflictException("Only approved manual payouts can reveal a payout instruction.");
    }
    if (!withdrawal.payoutAccount.verifiedAt) {
      throw new ConflictException("The payout destination is not verified.");
    }
    let accountIdentifier: string;
    try {
      accountIdentifier = decryptPayoutIdentifier(
        withdrawal.payoutAccount.encryptedIdentifier,
      );
    } catch {
      throw new ConflictException(
        "The payout destination must be re-entered using the secure GCash/Maya form.",
      );
    }
    return {
      withdrawalId: withdrawal.id,
      channel: withdrawal.payoutAccount.institutionName,
      accountHolderName: withdrawal.payoutAccount.accountHolderName,
      accountIdentifier,
      netCentavos: withdrawal.netCentavos.toString(),
      currency: withdrawal.currency,
    };
  }

  async submitManualPayout(withdrawalId: string, actorUserId: string, raw: unknown) {
    this.assertManualPayoutEnabled();
    const input = submitManualPayoutSchema.parse(raw);
    const normalizedReference = input.transactionReference.trim().toUpperCase();
    const providerReference = "MANUAL-PAYOUT:" + normalizedReference;

    return this.prisma.$transaction(async (tx) => {
      const withdrawal = await tx.withdrawal.findUniqueOrThrow({
        where: { id: withdrawalId },
      });
      if (withdrawal.provider !== "manual") {
        throw new ConflictException("This withdrawal is not a manual wallet payout.");
      }
      if (
        withdrawal.status === MoneyRequestStatus.AWAITING_PROVIDER &&
        withdrawal.providerReference === providerReference
      ) {
        return this.serialize(withdrawal);
      }
      if (withdrawal.status !== MoneyRequestStatus.PROCESSING) {
        throw new ConflictException("Only an approved withdrawal can record a transfer.");
      }
      const duplicate = await tx.withdrawal.findFirst({
        where: { providerReference, id: { not: withdrawal.id } },
        select: { id: true },
      });
      if (duplicate) {
        throw new ConflictException("That payout transaction reference was already used.");
      }
      const claimed = await tx.withdrawal.updateMany({
        where: {
          id: withdrawal.id,
          status: MoneyRequestStatus.PROCESSING,
          providerReference: null,
        },
        data: {
          status: MoneyRequestStatus.AWAITING_PROVIDER,
          providerReference,
          payoutSubmittedBy: actorUserId,
          payoutSubmittedAt: new Date(),
          payoutNote: input.note ?? null,
        },
      });
      if (claimed.count !== 1) {
        throw new ConflictException("A payout transfer was already recorded.");
      }
      const submitted = await tx.withdrawal.findUniqueOrThrow({
        where: { id: withdrawal.id },
      });
      await tx.notification.create({
        data: {
          userId: withdrawal.userId,
          type: "WITHDRAWAL_TRANSFER_RECORDED",
          title: "Withdrawal transfer sent",
          body: "Finance recorded the wallet transfer. A second reviewer must confirm settlement.",
          data: { withdrawalId: withdrawal.id },
        },
      });
      return this.serialize(submitted);
    });
  }

  async settleManualPayout(
    withdrawalId: string,
    confirmerUserId: string,
    reason: string,
  ) {
    this.assertManualPayoutEnabled();
    return this.prisma.$transaction(async (tx) => {
      const withdrawal = await tx.withdrawal.findUniqueOrThrow({
        where: { id: withdrawalId },
      });
      if (withdrawal.status === MoneyRequestStatus.COMPLETED) {
        return this.serialize(withdrawal);
      }
      if (
        withdrawal.provider !== "manual" ||
        withdrawal.status !== MoneyRequestStatus.AWAITING_PROVIDER ||
        !withdrawal.providerReference ||
        !withdrawal.payoutSubmittedBy
      ) {
        throw new ConflictException(
          "Only a recorded manual transfer awaiting confirmation can settle.",
        );
      }
      if (withdrawal.payoutSubmittedBy === confirmerUserId) {
        throw new ForbiddenException(
          "The finance user who recorded the transfer cannot confirm its settlement.",
        );
      }
      const claimed = await tx.withdrawal.updateMany({
        where: {
          id: withdrawal.id,
          status: MoneyRequestStatus.AWAITING_PROVIDER,
        },
        data: { status: MoneyRequestStatus.PROCESSING },
      });
      if (claimed.count !== 1) {
        throw new ConflictException("The payout is already being confirmed.");
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
        kind: "MANUAL_WITHDRAWAL_SETTLEMENT",
        description: "Finance-confirmed GCash/Maya payout and withdrawal fee",
        metadata: {
          withdrawalId: withdrawal.id,
          providerReference: withdrawal.providerReference,
          payoutSubmittedBy: withdrawal.payoutSubmittedBy,
          payoutConfirmedBy: confirmerUserId,
          reason,
        },
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
      const completed = await tx.withdrawal.update({
        where: { id: withdrawal.id },
        data: {
          status: MoneyRequestStatus.COMPLETED,
          settlementTxnId: posted.id,
          payoutConfirmedBy: confirmerUserId,
          payoutConfirmedAt: new Date(),
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
          body: "The GCash/Maya payout was independently confirmed.",
          data: { withdrawalId: withdrawal.id },
        },
      });
      return this.serialize(completed);
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
    return this.prisma.$transaction(async (tx) => {
      const reviewed = await tx.withdrawal.updateMany({
        where: {
          status: MoneyRequestStatus.SCHEDULED,
          scheduledFor: { lte: now },
          reviewRequired: true,
        },
        data: { status: MoneyRequestStatus.AWAITING_REVIEW },
      });
      const automatic = await tx.withdrawal.updateMany({
        where: {
          status: MoneyRequestStatus.SCHEDULED,
          scheduledFor: { lte: now },
          reviewRequired: false,
        },
        data: { status: MoneyRequestStatus.PROCESSING },
      });
      return { count: reviewed.count + automatic.count };
    });
  }

  private async reverseWithdrawalReservation(
    tx: Prisma.TransactionClient,
    withdrawal: {
      id: string;
      userId: string;
      requestedCentavos: bigint;
      status: MoneyRequestStatus;
      reservationTransaction: { metadata: Prisma.JsonValue } | null;
    },
    reason: string,
  ) {
      const claimed = await tx.withdrawal.updateMany({
        where: { id: withdrawal.id, status: withdrawal.status },
        data: { status: MoneyRequestStatus.FAILED },
      });
      if (claimed.count !== 1) {
        throw new ConflictException("The withdrawal is already being settled or reversed.");
      }
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
        metadata: { withdrawalId: withdrawal.id, reason },
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
        where: { id: withdrawal.id },
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
      await tx.notification.create({
        data: {
          userId: withdrawal.userId,
          type: "WITHDRAWAL_REVERSED",
          title: "Withdrawal returned to your balance",
          body: "The payout failed verification and the reserved funds were restored.",
          data: { withdrawalId: withdrawal.id, reason },
        },
      });
      return this.serialize(result);
  }

  async failManualPayout(
    withdrawalId: string,
    confirmerUserId: string,
    reason: string,
  ) {
    this.assertManualPayoutEnabled();
    return this.prisma.$transaction(async (tx) => {
      const withdrawal = await tx.withdrawal.findUniqueOrThrow({
        where: { id: withdrawalId },
        include: { reservationTransaction: true },
      });
      if (
        withdrawal.provider !== "manual" ||
        withdrawal.status !== MoneyRequestStatus.AWAITING_PROVIDER ||
        !withdrawal.providerReference ||
        !withdrawal.payoutSubmittedBy
      ) {
        throw new ConflictException(
          "Only a recorded manual transfer awaiting confirmation can be failed.",
        );
      }
      if (withdrawal.payoutSubmittedBy === confirmerUserId) {
        throw new ForbiddenException(
          "The finance user who recorded the transfer cannot confirm its failure.",
        );
      }
      return this.reverseWithdrawalReservation(tx, withdrawal, reason);
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
      this.guardTransition(() => assertReversibleWithdrawal(withdrawal.status));
      if (withdrawal.provider === "manual" && withdrawal.providerReference) {
        throw new ConflictException(
          "A recorded manual transfer must use the confirm-failed action.",
        );
      }
      return this.reverseWithdrawalReservation(tx, withdrawal, reason);
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
      const claimed = await tx.withdrawal.updateMany({
        where: { id: withdrawalId, status: MoneyRequestStatus.AWAITING_REVIEW },
        data: {
          status: MoneyRequestStatus.PROCESSING,
          reviewedBy: reviewerId,
          reviewReason: reason,
        },
      });
      if (claimed.count !== 1) {
        throw new ConflictException("The withdrawal is already being reviewed.");
      }
      return this.serialize(
        await tx.withdrawal.findUniqueOrThrow({ where: { id: withdrawalId } }),
      );
    });
  }

  private activePayoutProvider(): string {
    return process.env.PAYOUT_PROVIDER ?? "mock";
  }
}
