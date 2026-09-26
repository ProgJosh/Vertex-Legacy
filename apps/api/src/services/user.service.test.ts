import { describe, expect, it, vi } from "vitest";
import { UserService } from "./user.service";

function service(prisma: object) {
  return new UserService(prisma as never, {} as never, {} as never, {} as never);
}

describe("UserService Auth0 provisioning", () => {
  it("creates the complete local investor graph on first login", async () => {
    const tx = {
      identityProviderAccount: { findUnique: vi.fn().mockResolvedValue(null) },
      user: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: "user-1" }),
      },
      ledgerAccount: { create: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
      identityProviderAccount: {
        findUnique: vi.fn().mockResolvedValue(null),
        update: vi.fn(),
      },
      role: { findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "investor-role" }) },
      $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    };

    const userId = await service(prisma).provisionAuth0User({
      subject: "auth0|new-user",
      email: "New.User@example.com",
      emailVerified: true,
      givenName: "New",
      familyName: "User",
    });

    expect(userId).toBe("user-1");
    expect(tx.user.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        email: "new.user@example.com",
        profile: { create: { firstName: "New", lastName: "User" } },
        identities: {
          create: expect.objectContaining({
            provider: "auth0",
            providerSubject: "auth0|new-user",
          }),
        },
        wallet: { create: {} },
        roles: { create: { roleId: "investor-role" } },
        kycCases: { create: { provider: "auth0", status: "NOT_STARTED" } },
      }),
    });
    expect(tx.ledgerAccount.create).toHaveBeenCalledTimes(5);
  });

  it("updates last login without provisioning the same Auth0 identity twice", async () => {
    const update = vi.fn().mockResolvedValue({});
    const prisma = {
      identityProviderAccount: {
        findUnique: vi.fn().mockResolvedValue({ id: "identity-1", userId: "user-1" }),
        update,
      },
    };

    const userId = await service(prisma).provisionAuth0User({
      subject: "auth0|existing-user",
      email: "existing@example.com",
      emailVerified: true,
    });

    expect(userId).toBe("user-1");
    expect(update).toHaveBeenCalledWith({
      where: { id: "identity-1" },
      data: { lastLoginAt: expect.any(Date) },
    });
  });
});
