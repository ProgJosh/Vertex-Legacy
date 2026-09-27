import { BadRequestException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { AppController } from "./app.controller";
import { PaymentProviderRegistry } from "./services/payment-providers";

const validPlan = {
  slug: "vip-test",
  name: "VIP Test",
  description: "A test plan with a documented fixed schedule.",
  category: "Company VIP",
  minimumCentavos: "25000",
  maximumCentavos: "25000",
  durationDays: 60,
  riskClassification: "High",
  managementFeeRate: "0.000000",
  dailyPayoutCentavos: "4000",
  totalReturnCentavos: "240000",
  targetPerformanceLow: null,
  targetPerformanceHigh: null,
  terms: "Test terms disclose risk and the complete fixed schedule.",
  status: "DRAFT",
  reason: "Regression test plan creation",
} as const;

function controllerWith(
  prisma: Record<string, unknown>,
  audit = { record: vi.fn() },
) {
  const registry = new PaymentProviderRegistry();
  return {
    controller: new AppController(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      audit as never,
      registry as never,
      {} as never,
    ),
    audit,
  };
}

describe("admin plan schedule validation", () => {
  it("rejects a total return that contradicts the daily payout and duration", async () => {
    const prisma = { plan: { create: vi.fn() } };
    const { controller } = controllerWith(prisma);

    await expect(
      controller.createPlan({ id: "admin" } as never, {
        ...validPlan,
        totalReturnCentavos: "239999",
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.plan.create).not.toHaveBeenCalled();
  });

  it("rejects a maximum below the minimum", async () => {
    const prisma = { plan: { create: vi.fn() } };
    const { controller } = controllerWith(prisma);

    await expect(
      controller.createPlan({ id: "admin" } as never, {
        ...validPlan,
        maximumCentavos: "24999",
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.plan.create).not.toHaveBeenCalled();
  });

  it("persists the daily payout and matching total return as integer centavos", async () => {
    const create = vi.fn(
      async ({ data }: { data: Record<string, unknown> }) => ({
        id: "plan-id",
        ...data,
      }),
    );
    const prisma = { plan: { create } };
    const { controller, audit } = controllerWith(prisma);

    await controller.createPlan({ id: "admin" } as never, validPlan);

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        dailyPayoutCentavos: 4_000n,
        totalReturnCentavos: 240_000n,
        minimumCentavos: 25_000n,
        maximumCentavos: 25_000n,
      }),
    });
    expect(audit.record).toHaveBeenCalledTimes(1);
  });
});

describe("production identity review submission", () => {
  it("moves a not-started case into the admin review queue", async () => {
    const existing = {
      id: "kyc-id",
      userId: "user-id",
      status: "NOT_STARTED",
    };
    const submitted = {
      ...existing,
      provider: "manual-review",
      status: "PENDING",
      submittedAt: new Date(),
    };
    const findFirst = vi.fn().mockResolvedValue(existing);
    const update = vi.fn().mockResolvedValue(submitted);
    const create = vi.fn();
    const prisma = { kycCase: { findFirst, update, create } };
    const { controller, audit } = controllerWith(prisma);

    await expect(
      controller.submitKycForReview({ id: "user-id" } as never),
    ).resolves.toEqual(submitted);

    expect(update).toHaveBeenCalledWith({
      where: { id: "kyc-id" },
      data: expect.objectContaining({
        provider: "manual-review",
        status: "PENDING",
        submittedAt: expect.any(Date),
      }),
    });
    expect(create).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: "user-id",
        action: "KYC_SUBMIT",
        resourceId: "kyc-id",
        outcome: "SUCCESS",
      }),
    );
  });

  it("is idempotent while a case is already pending", async () => {
    const pending = {
      id: "kyc-id",
      userId: "user-id",
      status: "PENDING",
    };
    const update = vi.fn();
    const create = vi.fn();
    const prisma = {
      kycCase: {
        findFirst: vi.fn().mockResolvedValue(pending),
        update,
        create,
      },
    };
    const { controller, audit } = controllerWith(prisma);

    await expect(
      controller.submitKycForReview({ id: "user-id" } as never),
    ).resolves.toEqual(pending);

    expect(update).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });
});
