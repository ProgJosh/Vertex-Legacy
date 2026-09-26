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
  return cap !== null && cap !== undefined && calculated > cap ? cap : calculated;
}

export function commissionRuleLevel(eligibility: Prisma.JsonValue): number | null {
  if (
    !eligibility ||
    typeof eligibility !== "object" ||
    Array.isArray(eligibility)
  ) {
    return null;
  }
  const level = (eligibility as Prisma.JsonObject).level;
  return typeof level === "number" &&
    Number.isInteger(level) &&
    level >= 1 &&
    level <= 3
    ? level
    : null;
}

@Injectable()
export class CommissionService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(LedgerService) private readonly ledger: LedgerService,
  ) {}

  async createForQualifiedFee(orderId: string, sourceFeeCentavos: bigint, at = new Date()) {
    if (sourceFeeCentavos <= 0n) {
      throw new BadRequestException("Qualifying source fee must be positive.");
    }
    const order = await this.prisma.investmentOrder.findUniqueOrThrow({
      where: { id: orderId },
    });
    const rules = await this.prisma.commissionRule.findMany({
      where: {
        active: true,
        qualifyingEvent: "PLAN_SERVICE_FEE_CONFIRMED",
        effectiveFrom: { lte: at },
        OR: [{ effectiveUntil: null }, { effectiveUntil: { gte: at } }],
      },
      orderBy: { effectiveFrom: "desc" },
    });

    // The newest active rule wins for each published level, allowing a dated
    // replacement without paying two rules at the same level.
    const rulesByLevel = new Map<number, (typeof rules)[number]>();
    for (const rule of rules) {
      const level = commissionRuleLevel(rule.eligibility);
      if (level && !rulesByLevel.has(level)) rulesByLevel.set(level, rule);
    }

    const events = [];
    const visited = new Set<string>([order.userId]);
    let referredUserId = order.userId;
    for (let level = 1; level <= 3; level += 1) {
      const referral = await this.prisma.referral.findUnique({
        where: { referredUserId },
      });
      if (
        !referral ||
        referral.status !== "ELIGIBLE" ||
        visited.has(referral.referrerUserId)
      ) {
        break;
      }

      const beneficiaryUserId = referral.referrerUserId;
      visited.add(beneficiaryUserId);
      referredUserId = beneficiaryUserId;
      const rule = rulesByLevel.get(level);
      if (!rule) continue;
      if (
        rule.minimumSourceCentavos !== null &&
        sourceFeeCentavos < rule.minimumSourceCentavos
      ) {
        continue;
      }

      const eligibleBeneficiary = await this.prisma.user.findFirst({
        where: {
          id: beneficiaryUserId,
          status: "ACTIVE",
          kycCases: { some: { status: "VERIFIED" } },
        },
        select: { id: true },
      });
      if (!eligibleBeneficiary) continue;

      const amount = calculateCommission(sourceFeeCentavos, rule.rate, rule.capCentavos);
      if (amount <= 0n) continue;
      events.push(
        await this.prisma.commissionEvent.upsert({
          where: {
            beneficiaryUserId_ruleId_sourceOrderId_sourceEventType: {
              beneficiaryUserId,
              ruleId: rule.id,
              sourceOrderId: order.id,
              sourceEventType: "PLAN_SERVICE_FEE_CONFIRMED",
            },
          },
          update: {},
          create: {
            beneficiaryUserId,
            ruleId: rule.id,
            sourceOrderId: order.id,
            sourceEventType: "PLAN_SERVICE_FEE_CONFIRMED",
            reason:
              "Level " +
              level +
              " configured share of a confirmed plan service fee; never funded by a deposit alone.",
            amountCentavos: amount,
          },
        }),
      );
    }
    return events;
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
