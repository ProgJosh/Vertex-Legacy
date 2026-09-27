import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import { LedgerAccountType, Prisma } from "@prisma/client";
import { PrismaService } from "./prisma.service";
import { LedgerService } from "./ledger.service";

const REWARDS_PHP = [5, 3, 5, 4, 4, 5, 10, 4, 3, 3, 5, 5, 4, 4, 20, 3, 5, 3, 4, 4, 4, 5, 3, 4, 5, 5, 5, 5, 5, 30] as const;

function manilaDay(at = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

function previousDay(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day!));
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

@Injectable()
export class DailyRewardService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(LedgerService) private readonly ledger: LedgerService,
  ) {}

  private async history(userId: string) {
    const transactions = await this.prisma.ledgerTransaction.findMany({
      where: { idempotencyKey: { startsWith: "daily-check-in:" + userId + ":" } },
      select: { idempotencyKey: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 90,
    });
    return transactions.map((item) => item.idempotencyKey.split(":").at(-1)!).filter(Boolean);
  }

  private streakFor(days: string[], today: string) {
    const claimed = new Set(days);
    let cursor = claimed.has(today) ? today : previousDay(today);
    let streak = 0;
    while (claimed.has(cursor) && streak < 30) {
      streak += 1;
      cursor = previousDay(cursor);
    }
    return streak;
  }

  async status(userId: string) {
    const today = manilaDay();
    const days = await this.history(userId);
    const streak = this.streakFor(days, today);
    return {
      today,
      checkedInToday: days.includes(today),
      streak,
      cycleDay: Math.min(streak + (days.includes(today) ? 0 : 1), 30),
      nextRewardCentavos: BigInt(REWARDS_PHP[Math.min(streak, 29)]! * 100),
      rewardsCentavos: REWARDS_PHP.map((value) => BigInt(value * 100)),
      claimedDays: days,
      disclosure: "Daily rewards are non-withdrawable promotional credits, not cash deposits or guaranteed investment returns.",
    };
  }

  async claim(userId: string) {
    const today = manilaDay();
    const key = "daily-check-in:" + userId + ":" + today;
    const existing = await this.prisma.ledgerTransaction.findUnique({ where: { idempotencyKey: key } });
    if (existing) return this.status(userId);
    const days = await this.history(userId);
    const streak = this.streakFor(days, today);
    const reward = BigInt(REWARDS_PHP[Math.min(streak, 29)]! * 100);

    await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findFirst({
        where: { id: userId, status: "ACTIVE", kycCases: { some: { status: "VERIFIED" } } },
        select: { id: true },
      });
      if (!user) throw new BadRequestException("Verified KYC is required for daily rewards.");
      const prior = await tx.ledgerTransaction.findUnique({ where: { idempotencyKey: key } });
      if (prior) return;
      const [promo, clearing] = await Promise.all([
        tx.ledgerAccount.findFirstOrThrow({ where: { userId, type: LedgerAccountType.USER_PROMOTIONAL_CREDIT } }),
        tx.ledgerAccount.findUniqueOrThrow({ where: { code: "PLATFORM:ADJUSTMENT" } }),
      ]);
      await this.ledger.post(tx, {
        reference: "CHECKIN-" + today.replaceAll("-", "") + "-" + userId.slice(0, 8).toUpperCase(),
        idempotencyKey: key,
        kind: "DAILY_PROMOTIONAL_REWARD",
        description: "Daily check-in promotional reward",
        metadata: { userId, manilaDay: today, streakDay: streak + 1 },
        lines: [
          { accountId: clearing.id, direction: "DEBIT", amountCentavos: reward },
          { accountId: promo.id, direction: "CREDIT", amountCentavos: reward },
        ],
      });
      await tx.wallet.update({
        where: { userId },
        data: { promotionalAvailableCentavos: { increment: reward }, projectionVersion: { increment: 1 } },
      });
      await tx.notification.create({
        data: { userId, type: "DAILY_REWARD", title: "Daily reward claimed", body: "Your non-withdrawable promotional reward was added to your promotional balance." },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return this.status(userId);
  }
}
