/**
 * Aggregations for the dashboard, straight from social_items (no dummy data). Queries only.
 * Counted items are the ones about the brand: not official, and relevant (or not analysed yet).
 * "Open" = review status New / Investigating / Confirmed Threat. Filtered by brand, risk level and reason.
 */
import { and, count, desc, eq, gte, inArray, lt, max, min, sql, type SQL } from "drizzle-orm"
import type { Db } from "../../infra/db.js"
import { brands, scanRuns, socialItems } from "../../db/schema/index.js"

export interface DashFilter {
  brandIds?: string[]
  riskLevels?: string[]
  reasons?: string[]
}

const OPEN = ["New", "Investigating", "Confirmed Threat"]
const d = socialItems

export class DashboardRepository {
  constructor(private readonly db: Db) {}

  private base(f: DashFilter): SQL[] {
    const w: SQL[] = [eq(d.isOfficial, false), sql`${d.relevant} is not false`]
    if (f.brandIds?.length) w.push(inArray(d.brandId, f.brandIds))
    if (f.riskLevels?.length) w.push(inArray(d.riskLevel, f.riskLevels))
    if (f.reasons?.length) w.push(sql`${d.reasons} && array[${sql.join(f.reasons.map((r) => sql`${r}`), sql`, `)}]::text[]`)
    return w
  }

  async openByRisk(f: DashFilter) {
    return this.db
      .select({ level: d.riskLevel, n: count() })
      .from(d)
      .where(and(...this.base(f), inArray(d.reviewStatus, OPEN)))
      .groupBy(d.riskLevel)
  }

  async oldestOpenHigh(f: DashFilter): Promise<Date | null> {
    const [r] = await this.db
      .select({ at: min(d.firstSeen) })
      .from(d)
      .where(and(...this.base(f), inArray(d.reviewStatus, OPEN), inArray(d.riskLevel, ["High", "Critical"])))
    return r?.at ?? null
  }

  async newCount(f: DashFilter, from: Date, to: Date) {
    const [r] = await this.db.select({ n: count() }).from(d).where(and(...this.base(f), gte(d.firstSeen, from), lt(d.firstSeen, to)))
    return Number(r?.n ?? 0)
  }

  /** new items per day (UTC) and risk level */
  async daily(f: DashFilter, from: Date, to: Date) {
    const day = sql<string>`to_char(date_trunc('day', ${d.firstSeen} at time zone 'UTC'), 'YYYY-MM-DD')`
    return this.db
      .select({ day, level: d.riskLevel, n: count() })
      .from(d)
      .where(and(...this.base(f), gte(d.firstSeen, from), lt(d.firstSeen, to)))
      .groupBy(day, d.riskLevel)
  }

  /** items first seen in the window that an analyst confirmed */
  async confirmed(f: DashFilter, from: Date, to: Date) {
    const [r] = await this.db
      .select({ n: count() })
      .from(d)
      .where(and(...this.base(f), gte(d.firstSeen, from), lt(d.firstSeen, to), inArray(d.reviewStatus, ["Confirmed Threat", "Resolved"])))
    return Number(r?.n ?? 0)
  }

  /** decisions made in the window: median hours from first seen to decision, and the share marked False Positive */
  async decisions(f: DashFilter, from: Date, to: Date) {
    const [r] = await this.db
      .select({
        median: sql<number | null>`percentile_cont(0.5) within group (order by extract(epoch from (${d.reviewedAt} - ${d.firstSeen})) / 3600)`,
        total: count(),
        fp: sql<number>`count(*) filter (where ${d.reviewStatus} = 'False Positive')`,
      })
      .from(d)
      .where(and(...this.base(f), gte(d.reviewedAt, from), lt(d.reviewedAt, to), sql`${d.reviewStatus} <> 'New'`))
    return { median: r?.median === null || r?.median === undefined ? null : Number(r.median), total: Number(r?.total ?? 0), fp: Number(r?.fp ?? 0) }
  }

  async openByStatus(f: DashFilter) {
    return this.db.select({ status: d.reviewStatus, n: count() }).from(d).where(and(...this.base(f), inArray(d.reviewStatus, OPEN))).groupBy(d.reviewStatus)
  }

  async closedByStatus(f: DashFilter, from: Date, to: Date) {
    return this.db
      .select({ status: d.reviewStatus, n: count() })
      .from(d)
      .where(and(...this.base(f), sql`${d.reviewStatus} not in ('New', 'Investigating', 'Confirmed Threat')`, gte(d.reviewedAt, from), lt(d.reviewedAt, to)))
      .groupBy(d.reviewStatus)
  }

  /** per reason chip and per content type: new in window, previous window, open, open high */
  async groups(f: DashFilter, from: Date, to: Date, prevFrom: Date) {
    const inCur = sql`${d.firstSeen} >= ${from} and ${d.firstSeen} < ${to}`
    const inPrev = sql`${d.firstSeen} >= ${prevFrom} and ${d.firstSeen} < ${from}`
    const isOpen = sql`${d.reviewStatus} in ('New','Investigating','Confirmed Threat')`
    const openHigh = sql`${isOpen} and ${d.riskLevel} in ('High','Critical')`
    const where = and(...this.base(f))!
    const cols = sql`count(*) filter (where ${inCur}) as current,
             count(*) filter (where ${inPrev}) as previous,
             count(*) filter (where ${isOpen}) as open,
             count(*) filter (where ${openHigh}) as open_high`
    type GroupRow = { key: string; current: number; previous: number; open: number; open_high: number }
    const [reasons, types] = await Promise.all([
      this.db.execute<GroupRow>(sql`select r as key, ${cols} from ${d}, unnest(${d.reasons}) r where ${where} group by r`),
      this.db.execute<GroupRow>(sql`select ${d.contentType} as key, ${cols} from ${d} where ${where} group by ${d.contentType}`),
    ])
    return { reasons: reasons.rows, contentTypes: types.rows }
  }

  async brandRows(f: DashFilter, from: Date, to: Date, prevFrom: Date) {
    const w = this.base({ ...f, brandIds: undefined })
    const isOpen = sql`${d.reviewStatus} in ('New','Investigating','Confirmed Threat')`
    return this.db
      .select({
        id: brands.id,
        name: brands.name,
        low: sql<number>`count(${d.id}) filter (where ${isOpen} and ${d.riskLevel} = 'Low')`,
        medium: sql<number>`count(${d.id}) filter (where ${isOpen} and ${d.riskLevel} = 'Medium')`,
        high: sql<number>`count(${d.id}) filter (where ${isOpen} and ${d.riskLevel} = 'High')`,
        critical: sql<number>`count(${d.id}) filter (where ${isOpen} and ${d.riskLevel} = 'Critical')`,
        current: sql<number>`count(${d.id}) filter (where ${d.firstSeen} >= ${from} and ${d.firstSeen} < ${to})`,
        previous: sql<number>`count(${d.id}) filter (where ${d.firstSeen} >= ${prevFrom} and ${d.firstSeen} < ${from})`,
      })
      .from(brands)
      .leftJoin(d, and(eq(d.brandId, brands.id), ...w))
      .where(f.brandIds?.length ? inArray(brands.id, f.brandIds) : undefined)
      .groupBy(brands.id, brands.name)
      .orderBy(brands.name)
  }

  /** newest finished social media collection per brand: when, and which parts could not run */
  async lastScans(brandIds?: string[]) {
    return this.db
      .selectDistinctOn([scanRuns.brandId], { brandId: scanRuns.brandId, finishedAt: scanRuns.finishedAt, components: scanRuns.components, status: scanRuns.status })
      .from(scanRuns)
      .where(and(eq(scanRuns.module, "social_media"), sql`${scanRuns.finishedAt} is not null`, brandIds?.length ? inArray(scanRuns.brandId, brandIds) : undefined))
      .orderBy(scanRuns.brandId, desc(scanRuns.finishedAt))
  }

  /** riskiest open High / Critical items */
  async attention(f: DashFilter, limit: number) {
    const where = and(...this.base(f), inArray(d.reviewStatus, OPEN), inArray(d.riskLevel, ["High", "Critical"]))
    const rows = await this.db
      .select({ row: d, brandName: brands.name })
      .from(d)
      .leftJoin(brands, eq(brands.id, d.brandId))
      .where(where)
      .orderBy(desc(d.riskScore), desc(d.confidence), desc(d.firstSeen))
      .limit(limit)
    const [t] = await this.db.select({ n: count() }).from(d).where(where)
    return { items: rows.map((r) => ({ ...r.row, brandName: r.brandName })), total: Number(t?.n ?? 0) }
  }

  async lastScanAny(brandIds?: string[]) {
    const [r] = await this.db
      .select({ at: max(scanRuns.finishedAt) })
      .from(scanRuns)
      .where(and(eq(scanRuns.module, "social_media"), brandIds?.length ? inArray(scanRuns.brandId, brandIds) : undefined))
    return r?.at ?? null
  }
}
