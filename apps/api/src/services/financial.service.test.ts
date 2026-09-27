import { afterEach, describe, expect, it, vi } from "vitest";
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

describe("manual wallet deposit integrity", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("creates a reviewable GCash intent without calling an external checkout", async () => {
    vi.stubEnv("PAYMENT_PROVIDER", "manual");
    vi.stubEnv("MANUAL_PAYMENTS_ENABLED", "true");
    const created = {
      id: "00000000-0000-0000-0000-000000000911",
      userId: "00000000-0000-0000-0000-000000000912",
      amountCentavos: 25_000n,
      idempotencyKey: "33333333-3333-4333-8333-333333333333",
      provider: "manual-gcash",
      paymentChannel: "GCASH",
      status: "AWAITING_PROVIDER",
    };
    const tx = { deposit: { create: vi.fn().mockResolvedValue(created) } };
    const prisma = {
      deposit: { findUnique: vi.fn().mockResolvedValue(null) },
      user: { findUniqueOrThrow: vi.fn().mockResolvedValue({ email: "test@example.com", mobile: null }) },
      $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const providers = { createDepositCheckout: vi.fn() };
    const service = new FinancialService(
      prisma as never,
      { active: vi.fn().mockResolvedValue({ minimumDepositCentavos: 25_000n }) } as never,
      {} as never,
      providers as never,
    );

    await expect(service.createDeposit(created.userId, {
      amount: "250.00",
      idempotencyKey: created.idempotencyKey,
      paymentChannel: "GCASH",
    })).resolves.toMatchObject({
      provider: "manual-gcash",
      paymentChannel: "GCASH",
      amountCentavos: "25000",
    });
    expect(providers.createDepositCheckout).not.toHaveBeenCalled();
  });

  it("atomically submits wallet details and leaves the balance unchanged for review", async () => {
    vi.stubEnv("PAYMENT_PROVIDER", "manual");
    vi.stubEnv("MANUAL_PAYMENTS_ENABLED", "true");
    const deposit = {
      id: "00000000-0000-0000-0000-000000000916",
      userId: "00000000-0000-0000-0000-000000000917",
      amountCentavos: 25_000n,
      provider: "manual-maya",
      paymentChannel: "MAYA",
      providerReference: null,
      status: "AWAITING_PROVIDER",
    };
    const submitted = {
      ...deposit,
      providerReference: "MANUAL:MAYA:ABC123456",
      status: "AWAITING_REVIEW",
    };
    const tx = {
      deposit: {
        findUnique: vi.fn().mockResolvedValue(deposit),
        findFirst: vi.fn().mockResolvedValue(null),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: vi.fn().mockResolvedValue(submitted),
      },
      notification: { create: vi.fn() },
      wallet: { update: vi.fn() },
    };
    const prisma = {
      $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const ledger = { post: vi.fn() };
    const service = new FinancialService(prisma as never, {} as never, ledger as never, {} as never);

    await expect(service.submitManualDeposit(deposit.userId, deposit.id, {
      paymentReference: "abc123456",
      senderName: "Test Sender",
      senderMobileLast4: "4567",
    })).resolves.toMatchObject({
      providerReference: "MANUAL:MAYA:ABC123456",
      status: "AWAITING_REVIEW",
    });

    expect(tx.deposit.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: deposit.id, status: "AWAITING_PROVIDER" },
      data: expect.objectContaining({ status: "AWAITING_REVIEW" }),
    }));
    expect(ledger.post).not.toHaveBeenCalled();
    expect(tx.wallet.update).not.toHaveBeenCalled();
  });

  it("posts one balanced ledger settlement when finance approves a matched transfer", async () => {
    const deposit = {
      id: "00000000-0000-0000-0000-000000000913",
      userId: "00000000-0000-0000-0000-000000000914",
      amountCentavos: 25_000n,
      provider: "manual-gcash",
      paymentChannel: "GCASH",
      providerReference: "MANUAL:GCASH:1234567890",
      status: "AWAITING_REVIEW",
    };
    const tx = {
      deposit: {
        findUnique: vi.fn().mockResolvedValue(deposit),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        update: vi.fn().mockResolvedValue({ ...deposit, status: "COMPLETED", ledgerTransactionId: "ledger-1" }),
      },
      ledgerAccount: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "platform-cash" }),
        findFirstOrThrow: vi.fn().mockResolvedValue({ id: "user-cash" }),
      },
      wallet: { update: vi.fn() },
      notification: { create: vi.fn() },
    };
    const prisma = {
      $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const ledger = { post: vi.fn().mockResolvedValue({ id: "ledger-1" }) };
    const service = new FinancialService(prisma as never, {} as never, ledger as never, {} as never);

    await service.approveManualDeposit(deposit.id, "00000000-0000-0000-0000-000000000915", "Matched official GCash record");

    expect(ledger.post).toHaveBeenCalledWith(tx, expect.objectContaining({
      idempotencyKey: "manual-deposit:" + deposit.id,
      kind: "MANUAL_DEPOSIT_SETTLEMENT",
      lines: [
        { accountId: "platform-cash", direction: "DEBIT", amountCentavos: 25_000n },
        { accountId: "user-cash", direction: "CREDIT", amountCentavos: 25_000n },
      ],
    }));
    expect(tx.wallet.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ depositedAvailableCentavos: { increment: 25_000n } }),
    }));
  });

  it("does not let a rejection overwrite a deposit already claimed by another reviewer", async () => {
    const deposit = {
      id: "00000000-0000-0000-0000-000000000918",
      userId: "00000000-0000-0000-0000-000000000919",
      amountCentavos: 25_000n,
      provider: "manual-gcash",
      paymentChannel: "GCASH",
      providerReference: "MANUAL:GCASH:987654321",
      status: "AWAITING_REVIEW",
    };
    const tx = {
      deposit: {
        findUnique: vi.fn().mockResolvedValue(deposit),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        findUniqueOrThrow: vi.fn(),
      },
      notification: { create: vi.fn() },
    };
    const prisma = {
      $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const service = new FinancialService(prisma as never, {} as never, {} as never, {} as never);

    await expect(service.rejectManualDeposit(
      deposit.id,
      "00000000-0000-0000-0000-000000000920",
      "No matching receiving-wallet transaction",
    )).rejects.toThrow("Deposit is already being reviewed.");

    expect(tx.deposit.findUniqueOrThrow).not.toHaveBeenCalled();
    expect(tx.notification.create).not.toHaveBeenCalled();
  });
});
