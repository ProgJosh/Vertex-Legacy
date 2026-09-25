import { Worker } from "bullmq";
import IORedis from "ioredis";
import { prisma } from "@vertex/database";

const connection = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", {
  maxRetriesPerRequest: null,
});

const worker = new Worker(
  "vertex-jobs",
  async (job) => {
    switch (job.name) {
      case "notification.deliver":
        await prisma.notification.update({
          where: { id: String(job.data.notificationId) },
          data: {},
        });
        return { delivered: true, channel: "in-app" };
      case "reconciliation.daily":
        return { queuedForProviderComparison: true };
      case "statement.generate":
        return { queuedForSanitizedExport: true };
      default:
        throw new Error("Unsupported job type: " + job.name);
    }
  },
  { connection, concurrency: 5 },
);

worker.on("failed", (job, error) => {
  console.error(
    JSON.stringify({
      level: "error",
      event: "worker.job.failed",
      jobId: job?.id,
      jobName: job?.name,
      message: error.message,
    }),
  );
});

async function shutdown() {
  await worker.close();
  await connection.quit();
  await prisma.$disconnect();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
