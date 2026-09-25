import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import { LedgerAccountType, Prisma } from "@prisma/client";
import { PrismaService } from "./prisma.service";
import { LedgerService } from "./ledger.service";

export function calculateCommission(
  sourceFeeCentavos: bigint,
  rate: Prisma.Decimal,
  cap?: bigint | null,
) {
  if (sourceFeeCentavos <= 0n) throw new Error("Qualifying source fee must be positive.");
  const calculated = BigInt(
    new Prisma.Decimal(sourceFeeCentavos.toString()).mul(rate).toDecimalPlaces(0).toString(),
  );
  return cap && calculated > cap ? cap : calculated;
}

@Injectable()
export class CommissionService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(LedgerService) private readonly ledger: LedgerService,
  ) {}

  async createForQualifiedFee(orderId: string, sourceFeeCentavos: bigint, at = new Date()) {
    const order = await this.prisma.investmentOrder.findUniqueOrThrow({
      where: { id: orderId },
    });
    const referral = await this.prisma.referral.findUnique({
      where: { referredUserId: order.userId },
    });
    if (!referral || referral.referrerUserId === order.userId || referral.status !== "ELIGIBLE") {
      return null;
    }
    const rule = await this.prisma.commissionRule.findFirst({
      where: {
        active: true,
        qualifyingEvent: "PLAN_SERVICE_FEE_CONFIRMED",
        effectiveFrom: { lte: at },
        OR: [{ effectiveUntil: null }, { effectiveUntil: { gte: at } }],
      },
      orderBy: { effectiveFrom: "desc" },
    });
    if (!rule) return null;
    if (rule.minimumSourceCentavos && sourceFeeCentavos < rule.minimumSourceCentavos) return null;
    const amount = calculateCommission(sourceFeeCentavos, rule.rate, rule.capCentavos);
    if (amount <= 0n) throw new BadRequestException("Commission result must be positive.");
    return this.prisma.commissionEvent.upsert({
      where: {
        beneficiaryUserId_ruleId_sourceOrderId_sourceEventType: {
          beneficiaryUserId: referral.referrerUserId,
          ruleId: rule.id,
          sourceOrderId: order.id,
          sourceEventType: "PLAN_SERVICE_FEE_CONFIRMED",
        },
      },
      update: {},
      create: {
        beneficiaryUserId: referral.referrerUserId,
        ruleId: rule.id,
        sourceOrderId: order.id,
        sourceEventType: "PLAN_SERVICE_FEE_CONFIRMED",
        reason: "Configured share of a confirmed plan service fee; not funded by a deposit.",
        amountCentavos: amount,
      },
    });
  }

  async approveAndPost(eventId: string) {
    return this.prisma.$transaction(async (tx) => {
      const event = await tx.commissionEvent.findUniqueOrThrow({ where: { id: eventId } });
      if (event.status === "PAID") return event;
      const userAccount = await tx.ledgerAccount.findFirstOrThrow({
        where: {
          userId: event.beneficiaryUserId,
          type: LedgerAccountType.USER_COMMISSION,
        },
      });
      let expense = await tx.ledgerAccount.findUnique({
        where: { code: "PLATFORM:COMMISSION_EXPENSE" },
      });
      if (!expense) {
        expense = await tx.ledgerAccount.create({
          data: {
            code: "PLATFORM:COMMISSION_EXPENSE",
            name: "Qualified commission expense",
            type: LedgerAccountType.PLATFORM_COMMISSION_EXPENSE,
            normalBalance: "DEBIT",
          },
        });
      }
      const posted = await this.ledger.post(tx, {
        reference: "COM-" + event.id.slice(0, 8).toUpperCase(),
        idempotencyKey: "commission:post:" + event.id,
        kind: "QUALIFIED_COMMISSION",
        description: event.reason,
        metadata: { commissionEventId: event.id, sourceOrderId: event.sourceOrderId },
        lines: [
          { accountId: expense.id, direction: "DEBIT", amountCentavos: event.amountCentavos },
          {
            accountId: userAccount.id,
            direction: "CREDIT",
            amountCentavos: event.amountCentavos,
          },
        ],
      });
      await tx.wallet.update({
        where: { userId: event.beneficiaryUserId },
        data: {
          commissionAvailableCentavos: { increment: event.amountCentavos },
          projectionVersion: { increment: 1 },
        },
      });
      return tx.commissionEvent.update({
        where: { id: event.id },
        data: {
          status: "PAID",
          approvedAt: new Date(),
          paidAt: new Date(),
          ledgerTransactionId: posted.id,
        },
      });
    });
  }

  async reverse(eventId: string, reason: string) {
    return this.prisma.$transaction(async (tx) => {
      const event = await tx.commissionEvent.findUniqueOrThrow({ where: { id: eventId } });
      if (event.status === "REVERSED") return event;
      if (event.status !== "PAID") throw new BadRequestException("Only paid commissions can be reversed.");
      const userAccount = await tx.ledgerAccount.findFirstOrThrow({
        where: {
          userId: event.beneficiaryUserId,
          type: LedgerAccountType.USER_COMMISSION,
        },
      });
      const expense = await tx.ledgerAccount.findUniqueOrThrow({
        where: { code: "PLATFORM:COMMISSION_EXPENSE" },
      });
      const posted = await this.ledger.post(tx, {
        reference: "COM-REV-" + event.id.slice(0, 8).toUpperCase(),
        idempotencyKey: "commission:reverse:" + event.id,
        kind: "COMMISSION_REVERSAL",
        description: reason,
        metadata: { commissionEventId: event.id, sourceOrderId: event.sourceOrderId },
        lines: [
          {
            accountId: userAccount.id,
            direction: "DEBIT",
            amountCentavos: event.amountCentavos,
          },
          {
            accountId: expense.id,
            direction: "CREDIT",
            amountCentavos: event.amountCentavos,
          },
        ],
      });
      await tx.wallet.update({
        where: { userId: event.beneficiaryUserId },
        data: {
          commissionAvailableCentavos: { decrement: event.amountCentavos },
          projectionVersion: { increment: 1 },
        },
      });
      await tx.commissionEvent.create({
        data: {
          beneficiaryUserId: event.beneficiaryUserId,
          ruleId: event.ruleId,
          sourceOrderId: event.sourceOrderId,
          sourceEventType: "REVERSAL",
          reason,
          amountCentavos: event.amountCentavos,
          status: "REVERSED",
          ledgerTransactionId: posted.id,
          reversalOfId: event.id,
        },
      });
      return tx.commissionEvent.update({
        where: { id: event.id },
        data: { status: "REVERSED" },
      });
    });
  }
}
