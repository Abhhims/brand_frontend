/**
 * Background job queues (BullMQ on Redis). Replaces Celery + beat from the legacy backend.
 *
 * Every queue is declared here, so the API (which adds jobs) and the workers (which run them) agree on names.
 * Separate queues let slow work scale independently from fast work:
 *   default  scans that only make HTTP/DNS calls
 *   browser  scans that drive a headless browser (heavy: fewer, bigger worker machines)
 *   system   housekeeping and scheduled jobs (auto-scan planner, cleanup)
 */
import { Queue, type JobsOptions } from "bullmq"
import type { Redis } from "ioredis"
import { env } from "../config/env.js"
import { createRedis } from "./redis.js"

export const QUEUES = ["default", "browser", "system"] as const
export type QueueName = (typeof QUEUES)[number]

/** Retry with backoff; keep finished jobs a while for debugging, then trim so Redis does not grow forever. */
export const defaultJobOptions: JobsOptions = {
  attempts: 3,
  backoff: { type: "exponential", delay: 10_000 },
  removeOnComplete: { age: 24 * 3600, count: 5_000 },
  removeOnFail: { age: 7 * 24 * 3600 },
}

let connection: Redis | undefined
const queues = new Map<QueueName, Queue>()

export function queueConnection(): Redis {
  connection ??= createRedis({ forQueue: true })
  return connection
}

export function getQueue(name: QueueName): Queue {
  let q = queues.get(name)
  if (!q) {
    q = new Queue(name, { connection: queueConnection(), prefix: env.QUEUE_PREFIX, defaultJobOptions })
    queues.set(name, q)
  }
  return q
}

export async function closeQueues(): Promise<void> {
  await Promise.all([...queues.values()].map((q) => q.close()))
  queues.clear()
  await connection?.quit()
  connection = undefined
}
