import { Queue } from "bullmq";
import IORedis from "ioredis";

const REDIS_URL = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";

export const connection = new IORedis(REDIS_URL, {
  maxRetriesPerRequest: null,
});

export const queue = new Queue("feature-pipeline", { connection });
