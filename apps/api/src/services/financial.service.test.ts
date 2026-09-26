import { describe, expect, it, vi } from "vitest";
import { FinancialService } from "./financial.service";

describe("deposit checkout integrity", () => {
  it("rejects the transaction when checkout creation fails before the idempotency key is committed", async () => {
    const created = {
      id: "00000000-0000-0000-0000-000000000901",
      userId: "00000000-0000-0000-0000-000000000902",
      amountCentavos: 25_000n,
      idempotencyKey: "11111111-1111-4111-8111-111111111111",
      provider: "mock",
      status: "PENDING",
    };
    const tx = {
      deposit: {
        create: vi.fn().mockResolvedValue(created),
        update: vi.fn(),
      },
      user: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({ email: "test@example.com", mobile: null }),
      },
    };
    const prisma = {
      deposit: { findUnique: vi.fn().mockResolvedValue(null) },
      user: { findUniqueOrThrow: vi.fn().mockResolvedValue({ email: "test@example.com", mobile: null }) },
      $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const config = {
      active: vi.fn().mockResolvedValue({ minimumDepositCentavos: 25_000n }),
    };
    const providers = {
      createDepositCheckout: vi.fn(() => {
        throw new Error("provider unavailable");
      }),
    };
    const service = new FinancialService(
      prisma as never,
      config as never,
      {} as never,
      providers as never,
    );

    await expect(
      service.createDeposit(created.userId, {
        amount: "250.00",
        idempotencyKey: created.idempotencyKey,
      }),
    ).rejects.toThrow("provider unavailable");

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.deposit.create).toHaveBeenCalledTimes(1);
    expect(tx.deposit.update).not.toHaveBeenCalled();
  });

  it("replays an existing matching deposit without creating another checkout", async () => {
    const existing = {
      id: "00000000-0000-0000-0000-000000000903",
      userId: "00000000-0000-0000-0000-000000000904",
      amountCentavos: 25_000n,
      idempotencyKey: "22222222-2222-4222-8222-222222222222",
      provider: "mock",
      status: "AWAITING_PROVIDER",
    };
    const prisma = {
      deposit: { findUnique: vi.fn().mockResolvedValue(existing) },
      user: { findUniqueOrThrow: vi.fn().mockResolvedValue({ email: "test@example.com", mobile: null }) },
      $transaction: vi.fn(),
    };
    const config = {
      active: vi.fn().mockResolvedValue({ minimumDepositCentavos: 25_000n }),
    };
    const providers = { createDepositCheckout: vi.fn() };
    const service = new FinancialService(
      prisma as never,
      config as never,
      {} as never,
      providers as never,
    );

    await expect(
      service.createDeposit(existing.userId, {
        amount: "250.00",
        idempotencyKey: existing.idempotencyKey,
      }),
    ).resolves.toMatchObject({
      id: existing.id,
      amountCentavos: "25000",
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(providers.createDepositCheckout).not.toHaveBeenCalled();
  });
});
