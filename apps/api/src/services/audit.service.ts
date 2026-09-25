import { Inject, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { PrismaService } from "./prisma.service";

@Injectable()
export class AuditService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  record(input: {
    actorUserId?: string;
    action: string;
    resourceType: string;
    resourceId?: string;
    reason?: string;
    outcome: "SUCCESS" | "DENIED" | "FAILED";
    before?: Prisma.InputJsonValue;
    after?: Prisma.InputJsonValue;
    correlationId?: string;
  }) {
    return this.prisma.auditLog.create({
      data: {
        action: input.action,
        resourceType: input.resourceType,
        outcome: input.outcome,
        correlationId: input.correlationId ?? randomUUID(),
        ...(input.actorUserId !== undefined ? { actorUserId: input.actorUserId } : {}),
        ...(input.resourceId !== undefined ? { resourceId: input.resourceId } : {}),
        ...(input.reason !== undefined ? { reason: input.reason } : {}),
        ...(input.before !== undefined ? { before: input.before } : {}),
        ...(input.after !== undefined ? { after: input.after } : {}),
      },
    });
  }
}
