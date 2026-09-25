import { Injectable } from "@nestjs/common";
import { EntryDirection, LedgerTransactionStatus, Prisma } from "@prisma/client";
import { assertBalanced, type LedgerLine } from "@vertex/types";

type PostInput = {
  reference: string;
  idempotencyKey: string;
  kind: string;
  description: string;
  metadata?: Prisma.InputJsonValue;
  lines: LedgerLine[];
};

@Injectable()
export class LedgerService {
  async post(tx: Prisma.TransactionClient, input: PostInput) {
    assertBalanced(input.lines);
    const existing = await tx.ledgerTransaction.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
      include: { entries: true },
    });
    if (existing) return existing;

    return tx.ledgerTransaction.create({
      data: {
        reference: input.reference,
        idempotencyKey: input.idempotencyKey,
        kind: input.kind,
        description: input.description,
        ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
        status: LedgerTransactionStatus.POSTED,
        postedAt: new Date(),
        entries: {
          create: input.lines.map((line) => ({
            accountId: line.accountId,
            direction:
              line.direction === "DEBIT" ? EntryDirection.DEBIT : EntryDirection.CREDIT,
            amountCentavos: line.amountCentavos,
          })),
        },
      },
      include: { entries: true },
    });
  }
}
