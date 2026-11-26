/** Scan run response shape shared by every scan module (phishing websites, email posture, …). */
import { z } from "zod"
import type { ScanRunRow } from "./scans.repository.js"

export const ScanComponentDto = z.object({
  name: z.string(),
  status: z.enum(["ok", "skipped", "not_configured", "unavailable", "failed"]),
  message: z.string(),
  counts: z.record(z.string(), z.number()),
  fatal: z.boolean().optional(),
})

export const ScanRunDto = z.object({
  id: z.string(),
  brand_id: z.string(),
  brand_name: z.string().nullable(),
  module: z.string(),
  /** manual | schedule */
  trigger: z.string(),
  /** queued | running | completed | partially_completed | completed_with_errors | failed | cancelled */
  status: z.string(),
  started_at: z.string().nullable(),
  finished_at: z.string().nullable(),
  /** what was asked for at start, totals after the run */
  stats: z.record(z.string(), z.unknown()),
  /** what each part of the scan did (a source that could not run says so) */
  components: z.array(ScanComponentDto),
  error: z.string().nullable(),
  created_at: z.string(),
})
export type ScanRunOut = z.infer<typeof ScanRunDto>

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null)

export const toScanRunDto = (r: ScanRunRow & { brandName?: string | null }): ScanRunOut => ({
  id: r.id,
  brand_id: r.brandId,
  brand_name: r.brandName ?? null,
  module: r.module,
  trigger: r.trigger,
  status: r.status,
  started_at: iso(r.startedAt),
  finished_at: iso(r.finishedAt),
  stats: r.stats,
  components: r.components,
  error: r.error,
  created_at: r.createdAt.toISOString(),
})
