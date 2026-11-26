/** API contract for the dashboard overview (real data from social_items). */
import { z } from "zod"
import { isoDay, queryArray } from "../../common/dto.js"

/** Why an item was flagged — the reason chips social analysis sets (analysis/social-analyser.ts reasonsFor) */
export const SOCIAL_REASONS = [
  { key: "fake contact details", label: "Fake contact details (phone / WhatsApp / UPI)" },
  { key: "fake customer care", label: "Fake customer care / helpline" },
  { key: "scam wording", label: "Scam wording (KYC, refund, prize…)" },
  { key: "brand abuse", label: "Brand abuse" },
  { key: "official logo", label: "Official logo used" },
] as const

export const CONTENT_TYPE_LABELS: Record<string, string> = {
  post: "Posts",
  video: "Videos / reels",
  account: "Accounts (possible impersonation)",
  ad: "Ads",
  channel: "Channels",
}

export const OverviewQueryDto = z
  .object({
    brand_id: queryArray(z.string().uuid()),
    risk_level: queryArray(z.enum(["Low", "Medium", "High", "Critical"])),
    /** reason chips: fake contact details, fake customer care, scam wording, brand abuse, official logo */
    reason: queryArray(z.string().max(40)),
    /** period length ending today (ignored when from/to are given) */
    days: z.coerce.number().int().min(1).max(365).default(30),
    from: isoDay.optional(),
    to: isoDay.optional(),
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, { message: "from must be on or before to" })
export type OverviewQuery = z.infer<typeof OverviewQueryDto>

const Comparable = z.object({ value: z.number().nullable(), previous: z.number().nullable() })
const ByRisk = z.object({ Critical: z.number(), High: z.number(), Medium: z.number(), Low: z.number() })
const Row = z.object({ key: z.string(), label: z.string(), current: z.number(), previous: z.number(), open: z.number(), open_high: z.number() })

export const OverviewDto = z.object({
  generated_at: z.string(),
  period: z.object({ from: z.string(), to: z.string(), days: z.number() }),
  last_scan_at: z.string().nullable(),
  /** parts of the newest social media collection per brand that could not run (coverage is reduced until they do) */
  coverage_gaps: z.array(z.object({ brand: z.string(), part: z.string(), status: z.string(), message: z.string() })),
  brands_in_scope: z.number(),
  open: z.object({ total: z.number(), by_risk: ByRisk, oldest_high_at: z.string().nullable() }),
  new_alerts: Comparable.extend({ daily: z.array(z.number()) }),
  confirmed: Comparable,
  median_hours_to_decision: Comparable,
  false_positive_rate: Comparable,
  trend: z.array(z.object({ date: z.string(), total: z.number(), low: z.number(), medium: z.number(), high: z.number(), critical: z.number() })),
  workflow: z.object({ open: z.record(z.string(), z.number()), closed: z.record(z.string(), z.number()) }),
  /** why items were flagged: fake contact details, fake customer care, scam wording, brand abuse, official logo */
  reasons: z.array(Row),
  /** posts, videos, accounts */
  content_types: z.array(Row),
  brands: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      open: z.number(),
      by_risk: ByRisk,
      current: z.number(),
      previous: z.number(),
      last_scan_at: z.string().nullable(),
      gaps: z.number(),
    }),
  ),
  attention: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      url: z.string(),
      platform: z.string(),
      content_type: z.string(),
      author_handle: z.string().nullable(),
      brand_id: z.string(),
      brand_name: z.string().nullable(),
      risk_score: z.number(),
      risk_level: z.string(),
      confidence: z.number(),
      review_status: z.string(),
      logo_match: z.boolean(),
      reasons: z.array(z.string()),
      first_seen: z.string(),
    }),
  ),
  attention_total: z.number(),
})
export type OverviewOut = z.infer<typeof OverviewDto>
