import { describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import {
  calculateCommission,
  commissionRuleLevel,
  CommissionService,
} from "./commission.service";
import { assertBalanced } from "@vertex/types";

describe("commission eligibility math", () => {
  it("calculates a commission from a documented fee event", () => {
    expect(calculateCommission(10_000n, new Prisma.Decimal("0.10"))).toBe(1_000n);
  });

  it("applies the configured cap", () => {
    expect(calculateCommission(100_000n, new Prisma.Decimal("0.10"), 5_000n)).toBe(5_000n);
  });

  it("honors an explicit zero cap", () => {
    expect(calculateCommission(100_000n, new Prisma.Decimal("0.10"), 0n)).toBe(0n);
  });

  it("rejects deposit-like zero-value events", () => {
    expect(() => calculateCommission(0n, new Prisma.Decimal("0.10"))).toThrow();
  });

  it("balances a commission reversal", () => {
    expect(() =>
      assertBalanced([
        { accountId: "user-commission", direction: "DEBIT", amountCentavos: 1_000n },
        { accountId: "commission-expense", direction: "CREDIT", amountCentavos: 1_000n },
      ]),
    ).not.toThrow();
  });
});

describe("three-level qualified commission schedule", () => {
  it("reads only supported integer levels from eligibility", () => {
    expect(commissionRuleLevel({ level: 1 })).toBe(1);
    expect(commissionRuleLevel({ level: 3 })).toBe(3);
    expect(commissionRuleLevel({ level: 4 })).toBeNull();
    expect(commissionRuleLevel({ level: "1" })).toBeNull();
  });

  it("creates idempotent 27/2/1 events across an eligible referral chain", async () => {
    const referrals = new Map([
      ["buyer", { referredUserId: "buyer", referrerUserId: "level-1", status: "ELIGIBLE" }],
      ["level-1", { referredUserId: "level-1", referrerUserId: "level-2", status: "ELIGIBLE" }],
      ["level-2", { referredUserId: "level-2", referrerUserId: "level-3", status: "ELIGIBLE" }],
    ]);
    const upsert = vi.fn(async ({ create }: { create: Record<string, unknown> }) => create);
    const prisma = {
      investmentOrder: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "order", userId: "buyer" }),
      },
      commissionRule: {
        findMany: vi.fn().mockResolvedValue([
          { id: "rule-1", rate: new Prisma.Decimal("0.27"), capCentavos: null, minimumSourceCentavos: null, eligibility: { level: 1 } },
          { id: "rule-2", rate: new Prisma.Decimal("0.02"), capCentavos: null, minimumSourceCentavos: null, eligibility: { level: 2 } },
          { id: "rule-3", rate: new Prisma.Decimal("0.01"), capCentavos: null, minimumSourceCentavos: null, eligibility: { level: 3 } },
        ]),
      },
      referral: {
        findUnique: vi.fn(({ where }: { where: { referredUserId: string } }) =>
          Promise.resolve(referrals.get(where.referredUserId) ?? null),
        ),
      },
      user: {
        findFirst: vi.fn(({ where }: { where: { id: string } }) =>
          Promise.resolve({ id: where.id }),
        ),
      },
      commissionEvent: { upsert },
    };
    const service = new CommissionService(prisma as never, {} as never);

    const events = await service.createForQualifiedFee("order", 10_000n);

    expect(events.map((event) => event.amountCentavos)).toEqual([2_700n, 200n, 100n]);
    expect(events.map((event) => event.beneficiaryUserId)).toEqual([
      "level-1",
      "level-2",
      "level-3",
    ]);
    expect(upsert).toHaveBeenCalledTimes(3);
  });

  it("stops on an ineligible link instead of skipping around it", async () => {
    const prisma = {
      investmentOrder: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "order", userId: "buyer" }),
      },
      commissionRule: {
        findMany: vi.fn().mockResolvedValue([
          { id: "rule-1", rate: new Prisma.Decimal("0.27"), capCentavos: null, minimumSourceCentavos: null, eligibility: { level: 1 } },
        ]),
      },
      referral: {
        findUnique: vi.fn().mockResolvedValue({
          referredUserId: "buyer",
          referrerUserId: "level-1",
          status: "INELIGIBLE",
        }),
      },
      user: { findFirst: vi.fn() },
      commissionEvent: { upsert: vi.fn() },
    };
    const service = new CommissionService(prisma as never, {} as never);

    await expect(service.createForQualifiedFee("order", 10_000n)).resolves.toEqual([]);
    expect(prisma.user.findFirst).not.toHaveBeenCalled();
    expect(prisma.commissionEvent.upsert).not.toHaveBeenCalled();
  });
});
