import { Inject, Injectable, ServiceUnavailableException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "./prisma.service";

@Injectable()
export class ConfigService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async active(tx: Prisma.TransactionClient | PrismaService = this.prisma) {
    const config = await tx.platformConfiguration.findFirst({
      where: { active: true, effectiveAt: { lte: new Date() } },
      orderBy: { version: "desc" },
    });
    if (!config) throw new ServiceUnavailableException("Platform configuration is unavailable.");
    return config;
  }
}
