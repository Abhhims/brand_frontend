/**
 * GET /dashboard/breakdown — the explorer: social media items about the brand grouped by reason (why flagged),
 * content type (post / video / account) or platform, split by risk level, with a daily trend. Real data only.
 */
import type { FastifyRequest } from "fastify"
import { and, eq, inArray, sql, type SQL } from "drizzle-orm"
import { z } from "zod"
import { isoDay, queryArray, queryBool } from "../../common/dto.js"
import { socialItems as d } from "../../db/schema/index.js"
import type { Db } from "../../infra/db.js"
import { CONTENT_TYPE_LABELS, SOCIAL_REASONS } from "./dashboard.dto.js"

export const BreakdownQueryDto = z.object({
  /** reason = why flagged; content_type = post / video / account; platform = where it was posted */
  group: z.enum(["reason", "content_type", "platform"]).default("reason"),
  /** new = first seen in the period; open = still open now */
  measure: z.enum(["new", "open"]).default("new"),
  brand_id: queryArray(z.string().uuid()),
  risk_level: queryArray(z.enum(["Low", "Medium", "High", "Critical"])),
  reason: queryArray(z.string().max(40)),
  content_type: queryArray(z.string().max(20)),
  platform: queryArray(z.string().max(40)),
  logo_match: queryBool,
  days: z.coerce.number().int().min(1).max(365).default(30),
  from: isoDay.optional(),
  to: isoDay.optional(),
})
export type BreakdownQuery = z.infer<typeof BreakdownQueryDto>

const Risk = z.object({ Critical: z.number(), High: z.number(), Medium: z.number(), Low: z.number() })
export const BreakdownDto = z.object({
  group: z.string(),
  measure: z.string(),
  period: z.object({ from: z.string(), to: z.string(), days: z.number() }),
  total: z.number(),
  rows: z.array(z.object({ key: z.string(), label: z.string(), total: z.number(), previous: z.number().nullable(), by_risk: Risk })),
  trend: z.array(z.object({ date: z.string(), total: z.number(), low: z.number(), medium: z.number(), high: z.number(), critical: z.number() })),
})

const DAY = 86_400_000
const textArray = (xs: string[]) => sql`array[${sql.join(xs.map((x) => sql`${x}`), sql`, `)}]::text[]`

export const breakdownHandler = (db: Db) => async (request: FastifyRequest<{ Querystring: BreakdownQuery }>) => {
  const q = request.query
  const now = new Date()
  const end = q.to ? new Date(Math.min(now.getTime(), Date.parse(`${q.to}T00:00:00Z`) + DAY)) : now
  const start = q.from ? new Date(`${q.from}T00:00:00Z`) : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - (q.days - 1) * DAY)
  const days = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / DAY))
  const prevStart = new Date(start.getTime() - days * DAY)

  // only items about the brand; the brand's own accounts are never results
  const w: SQL[] = [eq(d.isOfficial, false), sql`${d.relevant} is not false`]
  if (q.brand_id?.length) w.push(inArray(d.brandId, q.brand_id))
  if (q.risk_level?.length) w.push(inArray(d.riskLevel, q.risk_level))
  if (q.reason?.length) w.push(sql`${d.reasons} && ${textArray(q.reason)}`)
  if (q.content_type?.length) w.push(inArray(d.contentType, q.content_type))
  if (q.platform?.length) w.push(inArray(d.platform, q.platform))
  if (q.logo_match) w.push(sql`(${d.signals}->>'social_image_match')::boolean is true`)
  const filter = and(...w)!

  const scope = q.measure === "open" ? sql`${d.reviewStatus} in ('New','Investigating','Confirmed Threat')` : sql`${d.firstSeen} >= ${start} and ${d.firstSeen} < ${end}`
  const prev = q.measure === "open" ? sql`false` : sql`${d.firstSeen} >= ${prevStart} and ${d.firstSeen} < ${start}`
  const key = q.group === "reason" ? sql`r` : q.group === "content_type" ? sql`${d.contentType}` : sql`${d.platform}`
  const from = q.group === "reason" ? sql`${d}, unnest(${d.reasons}) r` : sql`${d}`

  const rows = await db.execute<{ key: string; total: string; previous: string; critical: string; high: string; medium: string; low: string }>(sql`
    select ${key} as key,
      count(*) filter (where ${scope}) as total,
      count(*) filter (where ${prev}) as previous,
      count(*) filter (where ${scope} and ${d.riskLevel} = 'Critical') as critical,
      count(*) filter (where ${scope} and ${d.riskLevel} = 'High') as high,
      count(*) filter (where ${scope} and ${d.riskLevel} = 'Medium') as medium,
      count(*) filter (where ${scope} and ${d.riskLevel} = 'Low') as low
    from ${from} where ${filter}
    group by 1 order by 2 desc`)
  const trend = await db.execute<{ day: string; level: string; n: string }>(sql`
    select to_char(date_trunc('day', ${d.firstSeen} at time zone 'UTC'), 'YYYY-MM-DD') as day, ${d.riskLevel} as level, count(*) as n
    from ${from} where ${filter} and ${d.firstSeen} >= ${start} and ${d.firstSeen} < ${end}
    group by 1, 2`)

  const label = (k: string) =>
    q.group === "reason" ? (SOCIAL_REASONS.find((r) => r.key === k)?.label ?? k) : q.group === "content_type" ? (CONTENT_TYPE_LABELS[k] ?? k) : k
  const series = Array.from({ length: days }, (_, i) => ({ date: new Date(start.getTime() + i * DAY).toISOString().slice(0, 10), total: 0, low: 0, medium: 0, high: 0, critical: 0 }))
  const idx = new Map(series.map((s, i) => [s.date, i]))
  for (const t of trend.rows) {
    const i = idx.get(t.day)
    if (i === undefined) continue
    series[i]![t.level.toLowerCase() as "low"] += Number(t.n)
    series[i]!.total += Number(t.n)
  }
  const out = rows.rows
    .map((r) => ({
      key: r.key,
      label: label(r.key),
      total: Number(r.total),
      previous: q.measure === "open" ? null : Number(r.previous),
      by_risk: { Critical: Number(r.critical), High: Number(r.high), Medium: Number(r.medium), Low: Number(r.low) },
    }))
    .filter((r) => r.total > 0 || (r.previous ?? 0) > 0)
  return {
    group: q.group,
    measure: q.measure,
    period: { from: start.toISOString().slice(0, 10), to: new Date(end.getTime() - 1).toISOString().slice(0, 10), days },
    total: out.reduce((a, r) => a + r.total, 0),
    rows: out,
    trend: series,
  }
}
