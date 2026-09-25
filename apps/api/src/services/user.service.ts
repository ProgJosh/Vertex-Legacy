import { ConflictException, Inject, Injectable } from "@nestjs/common";
import { LedgerAccountType, NormalBalance, UserStatus } from "@prisma/client";
import { createHmac } from "node:crypto";
import { z } from "zod";
import { Roles } from "@vertex/types";
import { PrismaService } from "./prisma.service";
import { LedgerService } from "./ledger.service";
import { ConfigService } from "./config.service";
import { ProvidersService } from "./providers.service";

const registerSchema = z.object({
  email: z.string().email(),
  mobile: z.string().min(8).max(20).optional(),
  firstName: z.string().min(1).max(80),
  lastName: z.string().min(1).max(80),
});

const kycSchema = z.object({
  individualFingerprint: z.string().min(12).max(200),
});

@Injectable()
export class UserService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(LedgerService) private readonly ledger: LedgerService,
    @Inject(ConfigService) private readonly config: ConfigService,
    @Inject(ProvidersService) private readonly providers: ProvidersService,
  ) {}

  async registerMock(raw: unknown) {
    this.providers.assertSandbox("kyc");
    const input = registerSchema.parse(raw);
    const existing = await this.prisma.user.findUnique({ where: { email: input.email } });
    if (existing) throw new ConflictException("An account already exists for this email.");
    const role = await this.prisma.role.findUniqueOrThrow({ where: { name: Roles.INVESTOR } });
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: input.email.toLowerCase(),
          mobile: input.mobile ?? null,
          status: UserStatus.ACTIVE,
          emailVerifiedAt: new Date(),
          profile: {
            create: { firstName: input.firstName, lastName: input.lastName },
          },
          identities: {
            create: { provider: "mock", providerSubject: "mock:" + input.email.toLowerCase() },
          },
          wallet: { create: {} },
          roles: { create: { roleId: role.id } },
          kycCases: { create: { provider: "mock", status: "NOT_STARTED" } },
        },
        include: { profile: true },
      });
      const prefix = "USER:" + user.id;
      for (const [suffix, name, type] of [
        ["CASH", "Deposited cash", LedgerAccountType.USER_DEPOSITED_CASH],
        ["PROMO", "Promotional credits", LedgerAccountType.USER_PROMOTIONAL_CREDIT],
        ["INVESTED", "Invested funds", LedgerAccountType.USER_INVESTED_FUNDS],
        ["COMMISSION", "Commissions", LedgerAccountType.USER_COMMISSION],
        ["RESERVE", "Withdrawal reserve", LedgerAccountType.USER_WITHDRAWAL_RESERVE],
      ] as const) {
        await tx.ledgerAccount.create({
          data: {
            userId: user.id,
            code: prefix + ":" + suffix,
            name,
            type,
            normalBalance: NormalBalance.CREDIT,
          },
        });
      }
      return user;
    });
  }

  async completeMockKyc(userId: string, raw: unknown) {
    this.providers.assertSandbox("kyc");
    const input = kycSchema.parse(raw);
    const secret = process.env.MOCK_SESSION_SECRET ?? "local-development-only";
    const fingerprint = createHmac("sha256", secret)
      .update(input.individualFingerprint.trim().toLowerCase())
      .digest("hex");
    const duplicate = await this.prisma.user.findFirst({
      where: { verifiedIndividualHash: fingerprint, id: { not: userId } },
    });
    if (duplicate) {
      throw new ConflictException("This verified individual is already linked to an account.");
    }
    return this.prisma.$transaction(async (tx) => {
      const latest = await tx.kycCase.findFirst({
        where: { userId },
        orderBy: { createdAt: "desc" },
      });
      if (latest?.status === "VERIFIED") return latest;
      const kyc = latest
        ? await tx.kycCase.update({
            where: { id: latest.id },
            data: { status: "VERIFIED", submittedAt: new Date(), reviewedAt: new Date() },
          })
        : await tx.kycCase.create({
            data: {
              userId,
              provider: "mock",
              status: "VERIFIED",
              submittedAt: new Date(),
              reviewedAt: new Date(),
            },
          });
      await tx.user.update({
        where: { id: userId },
        data: { verifiedIndividualHash: fingerprint },
      });
      const config = await this.config.active(tx);
      const existingBonus = await tx.ledgerTransaction.findUnique({
        where: { idempotencyKey: "signup-bonus:" + userId },
      });
      if (!existingBonus) {
        const promo = await tx.ledgerAccount.findFirstOrThrow({
          where: { userId, type: LedgerAccountType.USER_PROMOTIONAL_CREDIT },
        });
        const clearing = await tx.ledgerAccount.findUniqueOrThrow({
          where: { code: "PLATFORM:ADJUSTMENT" },
        });
        await this.ledger.post(tx, {
          reference: "BONUS-" + userId.slice(0, 8).toUpperCase(),
          idempotencyKey: "signup-bonus:" + userId,
          kind: "SIGNUP_PROMOTIONAL_CREDIT",
          description: "One-time verified-individual promotional credit",
          metadata: { userId },
          lines: [
            {
              accountId: clearing.id,
              direction: "DEBIT",
              amountCentavos: config.signupBonusCentavos,
            },
            {
              accountId: promo.id,
              direction: "CREDIT",
              amountCentavos: config.signupBonusCentavos,
            },
          ],
        });
        await tx.wallet.update({
          where: { userId },
          data: {
            promotionalAvailableCentavos: { increment: config.signupBonusCentavos },
            projectionVersion: { increment: 1 },
          },
        });
      }
      return kyc;
    });
  }
}
