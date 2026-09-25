import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { vertexPrisma?: PrismaClient };

export const prisma =
  globalForPrisma.vertexPrisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.vertexPrisma = prisma;

export * from "@prisma/client";
