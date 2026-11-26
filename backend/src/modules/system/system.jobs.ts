/**
 * Background job handlers for the system module. A job handler is a thin entry point like a controller:
 * read job.data, call a service, return the result. Business logic stays in services.
 */
import type { JobHandlers } from "../../workers/registry.js"
import { logger } from "../../infra/logger.js"

export const systemJobs: JobHandlers = {
  system: {
    /** Proves the queue round-trip works end to end; also used by tests */
    ping: async (job) => {
      logger.info({ jobId: job.id }, "ping job ran")
      return { pong: true, at: new Date().toISOString() }
    },
  },
}
