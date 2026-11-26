/**
 * Dashboard overview — every number computed from stored, analysed social media items (Instagram posts, videos and
 * accounts that use the brand), compared with the previous period of the same length. Cached briefly in Redis.
 */
import type { ScanComponent } from "../../common/scan-report.js"
import type { CacheFn } from "../social-media/social-media.service.js"
import { CONTENT_TYPE_LABELS, SOCIAL_REASONS, type OverviewOut, type OverviewQuery } from "./dashboard.dto.js"
import type { DashboardRepository } from "./dashboard.repository.js"

const DAY = 86_400_000
const LEVELS = ["Critical", "High", "Medium", "Low"] as const

const n = (v: unknown) => Number(v ?? 0)
const utcDay = (d: Date) => d.toISOString().slice(0, 10)

export class DashboardService {
  constructor(
    private readonly repo: DashboardRepository,
    private readonly cache: CacheFn,
  ) {}

  async overview(q: OverviewQuery): Promise<OverviewOut> {
    const key = ["dashboard", "overview", JSON.stringify(q)]
    return this.cache(key, 30, () => this.compute(q))
  }

  private async compute(q: OverviewQuery): Promise<OverviewOut> {
    const now = new Date()
    const end = q.to ? new Date(Math.min(now.getTime(), Date.parse(`${q.to}T00:00:00Z`) + DAY)) : now
    const start = q.from ? new Date(`${q.from}T00:00:00Z`) : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - (q.days - 1) * DAY)
    const days = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / DAY))
    const prevStart = new Date(start.getTime() - days * DAY)
    const f = { brandIds: q.brand_id, riskLevels: q.risk_level, reasons: q.reason }

    const [openRisk, oldest, cur, prev, daily, confCur, confPrev, decCur, decPrev, openStatus, closedStatus, groups, brandRows, scans, attention, lastAny] =
      await Promise.all([
        this.repo.openByRisk(f),
        this.repo.oldestOpenHigh(f),
        this.repo.newCount(f, start, end),
        this.repo.newCount(f, prevStart, start),
        this.repo.daily(f, start, end),
        this.repo.confirmed(f, start, end),
        this.repo.confirmed(f, prevStart, start),
        this.repo.decisions(f, start, end),
        this.repo.decisions(f, prevStart, start),
        this.repo.openByStatus(f),
        this.repo.closedByStatus(f, start, end),
        this.repo.groups(f, start, end, prevStart),
        this.repo.brandRows(f, start, end, prevStart),
        this.repo.lastScans(q.brand_id),
        this.repo.attention(f, 8),
        this.repo.lastScanAny(q.brand_id),
      ])

    const byRisk = { Critical: 0, High: 0, Medium: 0, Low: 0 }
    for (const r of openRisk) if (r.level in byRisk) byRisk[r.level as keyof typeof byRisk] = n(r.n)

    // trend: one row per day of the period, oldest first
    const trend = Array.from({ length: days }, (_, i) => ({ date: utcDay(new Date(start.getTime() + i * DAY)), total: 0, low: 0, medium: 0, high: 0, critical: 0 }))
    const idx = new Map(trend.map((t, i) => [t.date, i]))
    for (const r of daily) {
      const i = idx.get(r.day)
      if (i === undefined) continue
      const k = r.level.toLowerCase() as "low"
      trend[i]![k] += n(r.n)
      trend[i]!.total += n(r.n)
    }

    const gapsByBrand = new Map<string, { part: string; status: string; message: string }[]>()
    for (const s of scans) {
      const comps = (s.components ?? []) as ScanComponent[]
      gapsByBrand.set(
        s.brandId,
        comps.filter((c) => c.status === "failed" || c.status === "unavailable" || c.status === "not_configured").map((c) => ({ part: c.name, status: c.status, message: c.message })),
      )
    }
    const lastScanOf = new Map(scans.map((s) => [s.brandId, s.finishedAt]))
    const brandName = new Map(brandRows.map((b) => [b.id, b.name]))

    type Counts = { current: unknown; previous: unknown; open: unknown; open_high: unknown }
    const empty: Counts = { current: 0, previous: 0, open: 0, open_high: 0 }
    const row = (key: string, label: string, v: Counts) => ({
      key,
      label,
      current: n(v.current),
      previous: n(v.previous),
      open: n(v.open),
      open_high: n(v.open_high),
    })

    return {
      generated_at: now.toISOString(),
      period: { from: utcDay(start), to: utcDay(new Date(end.getTime() - 1)), days },
      last_scan_at: lastAny ? lastAny.toISOString() : null,
      coverage_gaps: [...gapsByBrand].flatMap(([id, gaps]) => gaps.map((g) => ({ brand: brandName.get(id) ?? id, ...g }))),
      brands_in_scope: brandRows.length,
      open: { total: LEVELS.reduce((a, l) => a + byRisk[l], 0), by_risk: byRisk, oldest_high_at: oldest ? oldest.toISOString() : null },
      new_alerts: { value: cur, previous: prev, daily: trend.map((t) => t.total) },
      confirmed: { value: confCur, previous: confPrev },
      median_hours_to_decision: { value: decCur.median, previous: decPrev.median },
      false_positive_rate: { value: decCur.total ? decCur.fp / decCur.total : null, previous: decPrev.total ? decPrev.fp / decPrev.total : null },
      trend,
      workflow: {
        open: Object.fromEntries(["New", "Investigating", "Confirmed Threat"].map((s) => [s, n(openStatus.find((x) => x.status === s)?.n)])),
        closed: Object.fromEntries(["Resolved", "False Positive", "Legitimate", "Ignored"].map((s) => [s, n(closedStatus.find((x) => x.status === s)?.n)])),
      },
      reasons: SOCIAL_REASONS.map((r) => row(r.key, r.label, groups.reasons.find((x) => x.key === r.key) ?? empty)),
      content_types: groups.contentTypes.map((t) => row(t.key, CONTENT_TYPE_LABELS[t.key] ?? t.key, t)),
      brands: brandRows.map((b) => {
        const r = { Critical: n(b.critical), High: n(b.high), Medium: n(b.medium), Low: n(b.low) }
        const last = lastScanOf.get(b.id)
        return {
          id: b.id,
          name: b.name,
          open: r.Critical + r.High + r.Medium + r.Low,
          by_risk: r,
          current: n(b.current),
          previous: n(b.previous),
          last_scan_at: last ? last.toISOString() : null,
          gaps: gapsByBrand.get(b.id)?.length ?? 0,
        }
      }),
      attention: attention.items.map((r) => ({
        id: r.id,
        title: r.headline ?? (r.title || r.url),
        url: r.url,
        platform: r.platform,
        content_type: r.contentType,
        author_handle: r.authorHandle,
        brand_id: r.brandId,
        brand_name: r.brandName,
        risk_score: r.riskScore,
        risk_level: r.riskLevel,
        confidence: r.confidence,
        review_status: r.reviewStatus,
        logo_match: r.signals.social_image_match === true,
        reasons: r.reasons,
        first_seen: r.firstSeen.toISOString(),
      })),
      attention_total: attention.total,
    }
  }
}
