import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import { Queue } from "bullmq";
import type { Redis } from "ioredis";

export type JobEnvelope = {
  name: string;
  payload: Record<string, unknown>;
  idempotencyKey: string;
};

export interface QueueAdapter {
  enqueue(job: JobEnvelope): Promise<void>;
}

export class BullMqQueueAdapter implements QueueAdapter {
  private readonly queue: Queue;

  constructor(connection: Redis) {
    this.queue = new Queue("vertex-jobs", { connection });
  }

  async enqueue(job: JobEnvelope) {
    await this.queue.add(job.name, job.payload, {
      jobId: job.idempotencyKey,
      attempts: 5,
      backoff: { type: "exponential", delay: 2_000 },
      removeOnComplete: 500,
      removeOnFail: 1_000,
    });
  }
}

export class SqsQueueAdapter implements QueueAdapter {
  private readonly client = new SQSClient({
    region: process.env.AWS_REGION ?? "ap-southeast-1",
  });

  async enqueue(job: JobEnvelope) {
    if (!process.env.SQS_QUEUE_URL) throw new Error("SQS_QUEUE_URL is required.");
    await this.client.send(
      new SendMessageCommand({
        QueueUrl: process.env.SQS_QUEUE_URL,
        MessageBody: JSON.stringify(job),
        MessageDeduplicationId: job.idempotencyKey,
        MessageGroupId: "vertex-financial-jobs",
      }),
    );
  }
}
