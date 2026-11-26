/** Background jobs for social media monitoring. Thin entry points: read job data, call the service. */
import type { JobHandlers } from "../../workers/registry.js"
import { COLLECT_JOB, type SocialMediaService } from "./social-media.service.js"

export const socialMediaJobs = (service: SocialMediaService): JobHandlers => ({
  default: {
    [COLLECT_JOB]: async (job) => service.runCollection(String(job.data.scanRunId)),
  },
})
