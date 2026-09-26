import { describe, expect, it } from "vitest";
import { companyCommissionLevels, companyVipPlans } from "./index";

describe("authoritative company schedules", () => {
  it("contains the ten published VIP tiers in ascending price order", () => {
    expect(companyVipPlans).toHaveLength(10);
    expect(companyVipPlans.map((plan) => plan.name)).toEqual(
      Array.from({ length: 10 }, (_, index) => "VIP " + (index + 1)),
    );
    expect(companyVipPlans.map((plan) => plan.priceCentavos)).toEqual([
      25_000n,
      30_000n,
      50_000n,
      100_000n,
      200_000n,
      500_000n,
      1_000_000n,
      1_300_000n,
      1_450_000n,
      1_500_000n,
    ]);
  });

  it("keeps every stated total equal to daily payout times the 60-day cycle", () => {
    for (const plan of companyVipPlans) {
      expect(plan.cycleDays).toBe(60);
      expect(plan.totalReturnCentavos).toBe(
        plan.dailyPayoutCentavos * BigInt(plan.cycleDays),
      );
    }
  });

  it("matches the published 27/2/1 commission schedule", () => {
    expect(
      companyCommissionLevels.map(({ level, rateBasisPoints }) => ({
        level,
        rateBasisPoints,
      })),
    ).toEqual([
      { level: 1, rateBasisPoints: 2_700 },
      { level: 2, rateBasisPoints: 200 },
      { level: 3, rateBasisPoints: 100 },
    ]);
  });
});
