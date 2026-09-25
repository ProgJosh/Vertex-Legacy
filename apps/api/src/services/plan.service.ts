import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable } from "@nestjs/common";
import { LedgerAccountType, Prisma } from "@prisma/client";
import { parseCentavos } from "@vertex/types";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { PrismaService } from "./prisma.service";
import { LedgerService } from "./ledger.service";

const subscribeSchema = z.object({
  amount: z.string().regex(/^(0|[1-9]\d*)(?:\.\d{1,2})?$/),
  idempotencyKey: z.string().uuid(),
});

@Injectable()
export class PlanService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(LedgerService) private readonly ledger: LedgerService,
  ) {}

  async subscribe(userId: string, slug: string, raw: unknown) {
    const input = subscribeSchema.parse(raw);
    const amount = parseCentavos(input.amount);
    const prior = await this.prisma.investmentOrder.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
    });
    if (prior) {
      if (prior.userId !== userId || prior.amountCentavos !== amount) {
        throw new ConflictException("Idempotency key was already used for a different order.");
      }
      return prior;
    }
    return this.prisma.$transaction(async (tx) => {
      const [plan, user, wallet] = await Promise.all([
        tx.plan.findUnique({ where: { slug } }),
        tx.user.findUnique({
          where: { id: userId },
          include: { kycCases: { orderBy: { createdAt: "desc" }, take: 1 } },
        }),
        tx.wallet.findUnique({ where: { userId } }),
      ]);
      if (!plan || plan.status !== "ACTIVE") throw new BadRequestException("Plan is not available.");
      if (user?.kycCases[0]?.status !== "VERIFIED") {
        throw new ForbiddenException("Verified KYC is required to subscribe.");
      }
      if (!wallet || wallet.depositedAvailableCentavos < amount) {
        throw new BadRequestException("Insufficient deposited balance.");
      }
      if (amount < plan.minimumCentavos || (plan.maximumCentavos && amount > plan.maximumCentavos)) {
        throw new BadRequestException("Amount is outside this plan's configured limits.");
      }
      if (plan.capacityCentavos && plan.subscribedCentavos + amount > plan.capacityCentavos) {
        throw new BadRequestException("Plan capacity is no longer available.");
      }
      const unitPrice = new Prisma.Decimal("100.0000000000");
      const units = new Prisma.Decimal(amount.toString()).div(100).div(unitPrice);
      const cash = await tx.ledgerAccount.findFirstOrThrow({
        where: { userId, type: LedgerAccountType.USER_DEPOSITED_CASH },
      });
      const invested = await tx.ledgerAccount.findFirstOrThrow({
        where: { userId, type: LedgerAccountType.USER_INVESTED_FUNDS },
      });
      const posted = await this.ledger.post(tx, {
        reference: "INV-" + randomUUID().slice(0, 8).toUpperCase(),
        idempotencyKey: "investment:" + input.idempotencyKey,
        kind: "PLAN_SUBSCRIPTION",
        description: "Subscription to " + plan.name,
        metadata: { planId: plan.id, planSlug: plan.slug },
        lines: [
          { accountId: cash.id, direction: "DEBIT", amountCentavos: amount },
          { accountId: invested.id, direction: "CREDIT", amountCentavos: amount },
        ],
      });
      const order = await tx.investmentOrder.create({
        data: {
          userId,
          planId: plan.id,
          amountCentavos: amount,
          unitPrice,
          units,
          status: "ACTIVE",
          idempotencyKey: input.idempotencyKey,
          ledgerTransactionId: posted.id,
          completedAt: new Date(),
        },
      });
      await tx.holding.upsert({
        where: { userId_planId: { userId, planId: plan.id } },
        update: {
          units: { increment: units },
          costBasisCentavos: { increment: amount },
        },
        create: {
          userId,
          planId: plan.id,
          units,
          costBasisCentavos: amount,
        },
      });
      await tx.wallet.update({
        where: { userId },
        data: {
          depositedAvailableCentavos: { decrement: amount },
          projectionVersion: { increment: 1 },
        },
      });
      await tx.plan.update({
        where: { id: plan.id },
        data: { subscribedCentavos: { increment: amount } },
      });
      return order;
    });
  }
}
