/**
 * Database access for scan runs. Shared by every scan module (social media now; domains, APK, … later).
 */
import { and, desc, eq, inArray, lt, sql } from "drizzle-orm"
import type { ScanComponent, ScanStatus } from "../../common/scan-report.js"
import type { Db } from "../../infra/db.js"
import { brands, scanRuns } from "../../db/schema/index.js"

export type ScanRunRow = typeof scanRuns.$inferSelect
export type ModuleName = ScanRunRow["module"]

/** A queued/running scan older than this is treated as interrupted (worker restarted or crashed) */
const STALE_MINUTES = 90

export class ScansRepository {
  constructor(private readonly db: Db) {}

  async create(values: { brandId: string; module: ModuleName; trigger: string; stats: Record<string, unknown> }): Promise<ScanRunRow> {
    const [row] = await this.db.insert(scanRuns).values({ ...values, status: "queued" }).returning()
    return row!
  }

  async findById(id: string): Promise<(ScanRunRow & { brandName: string | null }) | undefined> {
    const [row] = await this.db
      .select({ run: scanRuns, brandName: brands.name })
      .from(scanRuns)
      .leftJoin(brands, eq(brands.id, scanRuns.brandId))
      .where(eq(scanRuns.id, id))
      .limit(1)
    return row ? { ...row.run, brandName: row.brandName } : undefined
  }

  async list(filter: { module?: ModuleName; brandId?: string; limit: number }) {
    const where = and(filter.module ? eq(scanRuns.module, filter.module) : undefined, filter.brandId ? eq(scanRuns.brandId, filter.brandId) : undefined)
    const rows = await this.db
      .select({ run: scanRuns, brandName: brands.name })
      .from(scanRuns)
      .leftJoin(brands, eq(brands.id, scanRuns.brandId))
      .where(where)
      .orderBy(desc(scanRuns.createdAt))
      .limit(filter.limit)
    return rows.map((r) => ({ ...r.run, brandName: r.brandName }))
  }

  /** Move queued/running → running. False when the run is already finished or cancelled (job must not run). */
  async markRunning(id: string): Promise<boolean> {
    const rows = await this.db
      .update(scanRuns)
      .set({ status: "running", startedAt: new Date(), error: null })
      .where(and(eq(scanRuns.id, id), inArray(scanRuns.status, ["queued", "running"])))
      .returning({ id: scanRuns.id })
    return rows.length > 0
  }

  /** Final state. A run cancelled meanwhile keeps its cancelled status. */
  async finish(id: string, values: { status: ScanStatus; stats: Record<string, unknown>; components: ScanComponent[]; error: string | null }) {
    await this.db
      .update(scanRuns)
      .set({ ...values, finishedAt: new Date() })
      .where(and(eq(scanRuns.id, id), sql`${scanRuns.status} <> 'cancelled'`))
  }

  /** Progress while running (stats + components so far); ignored once the run is finished or cancelled */
  async updateProgress(id: string, values: { stats: Record<string, unknown>; components?: ScanComponent[] }) {
    await this.db
      .update(scanRuns)
      .set(values)
      .where(and(eq(scanRuns.id, id), eq(scanRuns.status, "running")))
  }

  async isCancelled(id: string): Promise<boolean> {
    const [row] = await this.db.select({ status: scanRuns.status }).from(scanRuns).where(eq(scanRuns.id, id)).limit(1)
    return row?.status === "cancelled"
  }

  /** Cancel a queued/running run. False when it had already finished. */
  async cancel(id: string): Promise<boolean> {
    const rows = await this.db
      .update(scanRuns)
      .set({ status: "cancelled", finishedAt: new Date() })
      .where(and(eq(scanRuns.id, id), inArray(scanRuns.status, ["queued", "running"])))
      .returning({ id: scanRuns.id })
    return rows.length > 0
  }

  /** Runs stuck in queued/running for too long are closed as cancelled, so a new scan can replace them */
  async closeStale(brandId: string, module: ModuleName): Promise<number> {
    const rows = await this.db
      .update(scanRuns)
      .set({
        status: "cancelled",
        finishedAt: new Date(),
        error: sql`coalesce(${scanRuns.error} || E'\n', '') || 'Interrupted (worker restarted or timed out); a newer scan replaces it'`,
      })
      .where(
        and(
          eq(scanRuns.brandId, brandId),
          eq(scanRuns.module, module),
          inArray(scanRuns.status, ["queued", "running"]),
          lt(scanRuns.createdAt, new Date(Date.now() - STALE_MINUTES * 60_000)),
        ),
      )
      .returning({ id: scanRuns.id })
    return rows.length
  }
}
