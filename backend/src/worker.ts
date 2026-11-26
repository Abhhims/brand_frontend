/**
 * Worker process entry point: runs background jobs, separate from the API so heavy scans never slow requests.
 * Scale by running more worker processes. Choose which queues a process serves with WORKER_QUEUES, e.g.
 *   WORKER_QUEUES=browser   on machines sized for headless browsers
 *   WORKER_QUEUES=default,system   everywhere else
 */
import closeWithGrace from "close-with-grace"
import { Worker } from "bullmq"
import { env } from "./config/env.js"
import { createContainer } from "./container.js"
import { buildHandlers, schedules } from "./workers/registry.js"
import { closeDb } from "./infra/db.js"
import { logger } from "./infra/logger.js"
import { closeQueues, getQueue, QUEUES, queueConnection, type QueueName } from "./infra/queue.js"
import { redis } from "./infra/redis.js"

const handlers = buildHandlers(createContainer())
const wanted = env.WORKER_QUEUES.filter((q): q is QueueName => (QUEUES as readonly string[]).includes(q))

const workers = wanted.map((queue) => {
  const worker = new Worker(
    queue,
    async (job) => {
      const handler = handlers[queue][job.name]
      if (!handler) throw new Error(`No handler for job "${job.name}" on queue "${queue}"`)
      return handler(job)
    },
    { connection: queueConnection(), prefix: env.QUEUE_PREFIX, concurrency: env.WORKER_CONCURRENCY },
  )
  worker.on("failed", (job, err) => logger.error({ err, queue, job: job?.name, jobId: job?.id }, "job failed"))
  return worker
})

for (const s of schedules.filter((s) => wanted.includes(s.queue))) {
  await getQueue(s.queue).upsertJobScheduler(s.id, s.cron ? { pattern: s.cron } : { every: s.every ?? 60_000 }, { name: s.name })
}

logger.info({ queues: wanted, concurrency: env.WORKER_CONCURRENCY }, "worker started")

closeWithGrace({ delay: 60_000 }, async ({ err, signal }) => {
  if (err) logger.error({ err }, "worker shutting down after error")
  else logger.info({ signal }, "worker shutting down")
  // Let running jobs finish before exiting
  await Promise.all(workers.map((w) => w.close()))
  await closeQueues()
  await redis.quit()
  await closeDb()
})
