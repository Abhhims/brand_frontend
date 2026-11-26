/** Database access for collected social items and Apify run records. Queries only — no business rules. */
import { and, asc, count, desc, eq, gte, ilike, inArray, isNull, lt, or, sql, sum, type SQL } from "drizzle-orm"
import type { Db } from "../../infra/db.js"
import { apifyRuns, socialItems } from "../../db/schema/index.js"

export type SocialItemRow = typeof socialItems.$inferSelect
export type NewSocialItem = typeof socialItems.$inferInsert
export type ApifyRunRow = typeof apifyRuns.$inferSelect
export type NewApifyRun = typeof apifyRuns.$inferInsert

export interface ItemFilter {
  brandIds?: string[]
  /** compared case- and punctuation-insensitively: "instagram", "Instagram", "meta_ads" = "Meta Ads" */
  platforms?: string[]
  contentTypes?: string[]
  scanRunId?: string
  /** text in title, text, author, handle or URL */
  q?: string
  includeOfficial: boolean
  /** true = relevant or not analysed yet; false = analysed and not about the brand; undefined = both */
  relevant?: boolean
  riskLevels?: string[]
  minRisk?: number
  reviewStatuses?: string[]
  /** risk Medium or above (score >= 30) */
  flaggedOnly?: boolean
  logoMatch?: boolean
  sort: "risk" | "recent" | "published" | "last_seen" | "first_seen"
}

/** Analysis results written back to an item */
export interface ItemAnalysis {
  relevant: boolean
  riskScore: number
  riskLevel: string
  signals: Record<string, boolean | number | null>
  scoring: Record<string, unknown>
  confidence: number
  confidenceLevel: string
  details: Record<string, unknown>
  headline: string | null
  reasons: string[]
  evidence: { kind: string; key: string; content_type: string; meta: Record<string, unknown> }[]
  logoComparison: Record<string, unknown> | null
}

/** "Meta Ads" / "meta_ads" -> "metaads" (SQL side) */
const platformKey = sql`regexp_replace(lower(${socialItems.platform}), '[^a-z0-9]', '', 'g')`
export const platformKeyOf = (p: string) => p.toLowerCase().replace(/[^a-z0-9]/g, "")
/** flagged = Medium or above */
export const FLAGGED_MIN_SCORE = 30

/** Rows per INSERT statement: big enough to be fast, small enough to stay under Postgres' parameter limit */
const CHUNK = 500

export class SocialMediaRepository {
  constructor(
    private readonly db: Db,
    private readonly dbRead: Db,
  ) {}

  /**
   * Insert new items; for items already known (same brand + key), refresh their content and bump last_seen /
   * times_seen. Returns how many were new and how many were updated.
   */
  async upsertItems(rows: NewSocialItem[]): Promise<{ created: number; updated: number; ids: string[] }> {
    let created = 0
    let updated = 0
    const ids: string[] = []
    for (let i = 0; i < rows.length; i += CHUNK) {
      const result = await this.db
        .insert(socialItems)
        .values(rows.slice(i, i + CHUNK))
        .onConflictDoUpdate({
          target: [socialItems.brandId, socialItems.key],
          set: {
            scanRunId: sql`excluded.scan_run_id`,
            title: sql`excluded.title`,
            text: sql`excluded.text`,
            thumbnailUrl: sql`coalesce(excluded.thumbnail_url, ${socialItems.thumbnailUrl})`,
            metrics: sql`excluded.metrics`,
            raw: sql`excluded.raw`,
            query: sql`coalesce(excluded.query, ${socialItems.query})`,
            isOfficial: sql`excluded.is_official`,
            lastSeen: sql`now()`,
            timesSeen: sql`${socialItems.timesSeen} + 1`,
          },
        })
        // xmax = 0 only for freshly inserted rows
        .returning({ id: socialItems.id, inserted: sql<boolean>`(xmax = 0)` })
      for (const r of result) {
        if (r.inserted) created++
        else updated++
        ids.push(r.id)
      }
    }
    return { created, updated, ids }
  }

  private itemWhere(filter: ItemFilter): SQL | undefined {
    // escape LIKE wildcards so a search for "50%" means the text 50%
    const like = `%${(filter.q ?? "").replace(/[\\%_]/g, (c) => `\\${c}`)}%`
    return and(
      filter.brandIds?.length ? inArray(socialItems.brandId, filter.brandIds) : undefined,
      filter.platforms?.length ? inArray(platformKey, filter.platforms.map(platformKeyOf)) : undefined,
      filter.contentTypes?.length ? inArray(socialItems.contentType, filter.contentTypes) : undefined,
      filter.scanRunId ? eq(socialItems.scanRunId, filter.scanRunId) : undefined,
      filter.includeOfficial ? undefined : eq(socialItems.isOfficial, false),
      // official items are stored as not relevant: include_official=true still shows them
      filter.relevant === true
        ? filter.includeOfficial
          ? sql`(${socialItems.relevant} is not false or ${socialItems.isOfficial})`
          : sql`${socialItems.relevant} is not false`
        : filter.relevant === false
          ? eq(socialItems.relevant, false)
          : undefined,
      filter.riskLevels?.length ? inArray(socialItems.riskLevel, filter.riskLevels) : undefined,
      filter.minRisk !== undefined ? gte(socialItems.riskScore, filter.minRisk) : undefined,
      filter.flaggedOnly ? gte(socialItems.riskScore, FLAGGED_MIN_SCORE) : undefined,
      filter.reviewStatuses?.length ? inArray(socialItems.reviewStatus, filter.reviewStatuses) : undefined,
      filter.logoMatch === undefined
        ? undefined
        : filter.logoMatch
          ? sql`${socialItems.signals}->>'social_image_match' = 'true'`
          : sql`coalesce(${socialItems.signals}->>'social_image_match', 'false') <> 'true'`,
      filter.q
        ? or(
            ilike(socialItems.title, like),
            ilike(socialItems.text, like),
            ilike(socialItems.author, like),
            ilike(socialItems.authorHandle, like),
            ilike(socialItems.url, like),
          )
        : undefined,
    )
  }

  async listItems(filter: ItemFilter, page: { offset: number; limit: number }) {
    const where = this.itemWhere(filter)
    const order =
      filter.sort === "published"
        ? [sql`${socialItems.publishedAt} desc nulls last`, desc(socialItems.id)]
        : filter.sort === "first_seen"
          ? [desc(socialItems.firstSeen), desc(socialItems.id)]
          : filter.sort === "recent" || filter.sort === "last_seen"
            ? [desc(socialItems.lastSeen), desc(socialItems.id)]
            : [desc(socialItems.riskScore), desc(socialItems.confidence), desc(socialItems.lastSeen), desc(socialItems.id)]

    const [items, [total]] = await Promise.all([
      this.dbRead
        .select()
        .from(socialItems)
        .where(where)
        .orderBy(...order)
        .offset(page.offset)
        .limit(page.limit),
      this.dbRead.select({ n: count() }).from(socialItems).where(where),
    ])
    return { items, total: total?.n ?? 0 }
  }

  /**
   * Items of a brand to analyse: the given ids, or every item not analysed since `before` (never-analysed first,
   * then the oldest analysis), at most `limit`.
   */
  async itemsForAnalysis(brandId: string, opts: { ids?: string[]; before?: Date; limit: number }): Promise<SocialItemRow[]> {
    if (opts.ids && !opts.ids.length) return []
    return this.db
      .select()
      .from(socialItems)
      .where(
        and(
          eq(socialItems.brandId, brandId),
          opts.ids ? inArray(socialItems.id, opts.ids) : undefined,
          opts.before ? or(isNull(socialItems.analysedAt), lt(socialItems.analysedAt, opts.before)) : undefined,
        ),
      )
      .orderBy(sql`${socialItems.analysedAt} asc nulls first`, asc(socialItems.id))
      .limit(opts.limit)
  }

  /** Items of a brand still waiting for (re-)analysis */
  async countPending(brandId: string, before: Date): Promise<number> {
    const [r] = await this.dbRead
      .select({ n: count() })
      .from(socialItems)
      .where(and(eq(socialItems.brandId, brandId), or(isNull(socialItems.analysedAt), lt(socialItems.analysedAt, before))))
    return r?.n ?? 0
  }

  async saveAnalysis(id: string, a: ItemAnalysis): Promise<void> {
    await this.db
      .update(socialItems)
      .set({ ...a, analysedAt: new Date() })
      .where(eq(socialItems.id, id))
  }

  async setReview(id: string, values: { status: string; note: string | null; by: string }): Promise<boolean> {
    const rows = await this.db
      .update(socialItems)
      .set({ reviewStatus: values.status, reviewNote: values.note, reviewedBy: values.by, reviewedAt: new Date() })
      .where(eq(socialItems.id, id))
      .returning({ id: socialItems.id })
    return rows.length > 0
  }

  /** Dashboard counts over relevant (or not yet analysed), non-official items, optionally of one brand */
  async summary(brandId?: string) {
    const base = and(brandId ? eq(socialItems.brandId, brandId) : undefined, eq(socialItems.isOfficial, false))
    const rel = and(base, sql`${socialItems.relevant} is not false`)
    const flagged = sql<number>`count(*) filter (where ${socialItems.riskScore} >= ${FLAGGED_MIN_SCORE})`.mapWith(Number)
    const [byPlatform, byType, byReason, byReview, [totals]] = await Promise.all([
      this.dbRead
        .select({ platform: socialItems.platform, level: socialItems.riskLevel, n: count() })
        .from(socialItems)
        .where(rel)
        .groupBy(socialItems.platform, socialItems.riskLevel),
      this.dbRead.select({ contentType: socialItems.contentType, n: count(), flagged }).from(socialItems).where(rel).groupBy(socialItems.contentType),
      this.dbRead
        .select({ reason: sql<string>`r.reason`, n: count() })
        .from(sql`${socialItems} cross join lateral unnest(${socialItems.reasons}) as r(reason)`)
        .where(rel)
        .groupBy(sql`r.reason`)
        .orderBy(desc(count())),
      this.dbRead
        .select({ status: socialItems.reviewStatus, n: count() })
        .from(socialItems)
        .where(and(rel, gte(socialItems.riskScore, FLAGGED_MIN_SCORE)))
        .groupBy(socialItems.reviewStatus),
      this.dbRead
        .select({
          collected: count(),
          relevant: sql<number>`count(*) filter (where ${socialItems.relevant})`.mapWith(Number),
          flagged: sql<number>`count(*) filter (where ${socialItems.relevant} and ${socialItems.riskScore} >= ${FLAGGED_MIN_SCORE})`.mapWith(Number),
          pending: sql<number>`count(*) filter (where ${socialItems.analysedAt} is null)`.mapWith(Number),
          logoMatches: sql<number>`count(*) filter (where ${socialItems.relevant} and ${socialItems.signals}->>'social_image_match' = 'true')`.mapWith(Number),
          lastSeen: sql<string | null>`max(${socialItems.lastSeen})`,
          lastAnalysed: sql<string | null>`max(${socialItems.analysedAt})`,
        })
        .from(socialItems)
        .where(base),
    ])
    return { byPlatform, byType, byReason, byReview, totals: totals! }
  }

  async findItem(id: string): Promise<SocialItemRow | undefined> {
    const [row] = await this.dbRead.select().from(socialItems).where(eq(socialItems.id, id)).limit(1)
    return row
  }

  async insertApifyRuns(rows: NewApifyRun[]): Promise<void> {
    if (rows.length) await this.db.insert(apifyRuns).values(rows)
  }

  async apifyRunsForScan(scanRunId: string): Promise<ApifyRunRow[]> {
    return this.dbRead.select().from(apifyRuns).where(eq(apifyRuns.scanRunId, scanRunId)).orderBy(apifyRuns.createdAt)
  }

  /** Apify spend and volume since a date, optionally for one brand, grouped by source */
  async apifyUsage(since: Date, brandId?: string) {
    return this.dbRead
      .select({
        source: apifyRuns.source,
        runs: count(),
        cached: sql<number>`count(*) filter (where ${apifyRuns.cached})`.mapWith(Number),
        failed: sql<number>`count(*) filter (where ${apifyRuns.error} is not null)`.mapWith(Number),
        items: sum(apifyRuns.itemCount).mapWith(Number),
        usageUsd: sum(apifyRuns.usageUsd).mapWith(Number),
      })
      .from(apifyRuns)
      .where(and(gte(apifyRuns.createdAt, since), brandId ? eq(apifyRuns.brandId, brandId) : undefined))
      .groupBy(apifyRuns.source)
      .orderBy(apifyRuns.source)
  }
}
