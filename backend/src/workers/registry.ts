/**
 * Every background job handler and repeating schedule, collected from the modules.
 * To add jobs: write <feature>.jobs.ts in the module (a function of its service) and add it below.
 */
import type { Job } from "bullmq"
import type { Container } from "../container.js"
import type { QueueName } from "../infra/queue.js"
import { socialMediaJobs } from "../modules/social-media/social-media.jobs.js"
import { systemJobs } from "../modules/system/system.jobs.js"

export type JobHandler = (job: Job) => Promise<unknown>
export type JobHandlers = Partial<Record<QueueName, Record<string, JobHandler>>>

export function buildHandlers(container: Container): Record<QueueName, Record<string, JobHandler>> {
  const modules: JobHandlers[] = [systemJobs, socialMediaJobs(container.services.socialMedia)]

  const handlers: Record<QueueName, Record<string, JobHandler>> = { default: {}, browser: {}, system: {} }
  for (const m of modules) {
    for (const [queue, jobs] of Object.entries(m) as [QueueName, Record<string, JobHandler>][]) {
      for (const [name, fn] of Object.entries(jobs)) {
        if (handlers[queue][name]) throw new Error(`Duplicate job handler ${queue}/${name}`)
        handlers[queue][name] = fn
      }
    }
  }
  return handlers
}

/** Repeating jobs (replaces Celery beat). The worker registers them; BullMQ de-duplicates by id. */
export const schedules: { queue: QueueName; id: string; name: string; every?: number; cron?: string }[] = [
  // e.g. { queue: "system", id: "auto-scan-planner", name: "plan-auto-scans", cron: "0 * * * *" },
]
