/** API contract for the health endpoints: what goes in and out. */
import { z } from "zod"

export const LiveDto = z.object({ status: z.literal("ok") })

export const CheckDto = z.object({ ok: z.boolean(), ms: z.number(), error: z.string().optional() })
export type Check = z.infer<typeof CheckDto>

export const ReadyDto = z.object({
  status: z.enum(["ok", "degraded"]),
  checks: z.object({ postgres: CheckDto, redis: CheckDto }),
})
export type Ready = z.infer<typeof ReadyDto>
