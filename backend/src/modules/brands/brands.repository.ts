/** Database access for brands, their official assets and their allowlists. Queries only — no business rules. */
import { and, asc, count, desc, eq, exists, ilike, inArray, or, sql, type SQL } from "drizzle-orm"
import { buildBrandContext, type BrandContext } from "../../common/brand-context.js"
import type { Db } from "../../infra/db.js"
import { brandAllowlist, brandAssets, brands } from "../../db/schema/index.js"

export type BrandRow = typeof brands.$inferSelect
export type NewBrand = typeof brands.$inferInsert
export type AssetRow = typeof brandAssets.$inferSelect
export type NewAsset = typeof brandAssets.$inferInsert
export type AllowRow = typeof brandAllowlist.$inferSelect

/** A brand with its assets and allowlist, as the API returns it */
export interface BrandAggregate {
  brand: BrandRow
  assets: AssetRow[]
  allowlist: AllowRow[]
}

/** Postgres error code for a unique-constraint violation */
export const UNIQUE_VIOLATION = "23505"
export const isUniqueViolation = (err: unknown) =>
  (err as { code?: string })?.code === UNIQUE_VIOLATION || (err as { cause?: { code?: string } })?.cause?.code === UNIQUE_VIOLATION

export class BrandsRepository {
  constructor(private readonly db: Db) {}

  // ------------------------------------------------------------------ brands
  async findById(id: string): Promise<BrandRow | undefined> {
    const [row] = await this.db.select().from(brands).where(eq(brands.id, id)).limit(1)
    return row
  }

  /** Brands with assets and allowlist in 3 queries total (not 1 + 2 per brand) */
  async listAggregates(ids?: string[]): Promise<BrandAggregate[]> {
    const rows = await this.db
      .select()
      .from(brands)
      .where(ids ? inArray(brands.id, ids) : undefined)
      .orderBy(asc(brands.name))
    if (!rows.length) return []
    const brandIds = rows.map((b) => b.id)
    const [assets, allow] = await Promise.all([
      this.db.select().from(brandAssets).where(inArray(brandAssets.brandId, brandIds)).orderBy(asc(brandAssets.createdAt)),
      this.db.select().from(brandAllowlist).where(inArray(brandAllowlist.brandId, brandIds)).orderBy(asc(brandAllowlist.createdAt)),
    ])
    return rows.map((brand) => ({
      brand,
      assets: assets.filter((a) => a.brandId === brand.id),
      allowlist: allow.filter((a) => a.brandId === brand.id),
    }))
  }

  /** Brand ids matching a free-text search and filters, in the requested order, with the total count */
  async search(
    f: { q?: string; isActive?: boolean; hasDomain?: boolean; autoScanEnabled?: boolean; sort: "name" | "created_at" },
    page: { offset: number; limit: number },
  ): Promise<{ ids: string[]; total: number }> {
    const where: SQL[] = []
    if (f.q) {
      const like = `%${f.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
      where.push(
        or(
          ilike(brands.name, like),
          ilike(brands.description, like),
          sql`exists (select 1 from unnest(${brands.keywords}) k where k ilike ${like})`,
          sql`exists (select 1 from unnest(${brands.productTerms}) p where p ilike ${like})`,
          exists(
            this.db
              .select({ one: sql`1` })
              .from(brandAllowlist)
              .where(and(eq(brandAllowlist.brandId, brands.id), ilike(brandAllowlist.value, like))),
          ),
        )!,
      )
    }
    if (f.isActive !== undefined) where.push(eq(brands.isActive, f.isActive))
    if (f.autoScanEnabled !== undefined) where.push(eq(brands.autoScanEnabled, f.autoScanEnabled))
    if (f.hasDomain !== undefined) {
      const has = exists(
        this.db
          .select({ one: sql`1` })
          .from(brandAllowlist)
          .where(and(eq(brandAllowlist.brandId, brands.id), eq(brandAllowlist.kind, "domain"))),
      )
      where.push(f.hasDomain ? has : sql`not ${has}`)
    }
    const cond = where.length ? and(...where) : undefined
    const [rows, totals] = await Promise.all([
      this.db
        .select({ id: brands.id })
        .from(brands)
        .where(cond)
        .orderBy(f.sort === "name" ? asc(brands.name) : desc(brands.createdAt))
        .offset(page.offset)
        .limit(page.limit),
      this.db.select({ total: count() }).from(brands).where(cond),
    ])
    return { ids: rows.map((r) => r.id), total: Number(totals[0]?.total ?? 0) }
  }

  /** Several allowlist entries at once; existing (kind, value) pairs are left alone. Returns the new rows. */
  async insertAllowMany(brandId: string, entries: { kind: AllowRow["kind"]; value: string }[]): Promise<AllowRow[]> {
    if (!entries.length) return []
    return this.db
      .insert(brandAllowlist)
      .values(entries.map((e) => ({ ...e, brandId })))
      .onConflictDoNothing()
      .returning()
  }

  async findAggregate(id: string): Promise<BrandAggregate | undefined> {
    const [agg] = await this.listAggregates([id])
    return agg
  }

  /** Brand and its initial allowlist in one transaction: both saved or neither */
  async create(brand: NewBrand, allowlist: { kind: AllowRow["kind"]; value: string }[]): Promise<BrandRow> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx.insert(brands).values(brand).returning()
      if (allowlist.length) await tx.insert(brandAllowlist).values(allowlist.map((a) => ({ ...a, brandId: row!.id })))
      return row!
    })
  }

  async update(id: string, values: Partial<NewBrand>): Promise<void> {
    if (Object.keys(values).length) await this.db.update(brands).set(values).where(eq(brands.id, id))
  }

  /** Deletes the brand; every brand-scoped row (assets, allowlist, scans, items…) cascades in Postgres */
  async delete(id: string): Promise<boolean> {
    const rows = await this.db.delete(brands).where(eq(brands.id, id)).returning({ id: brands.id })
    return rows.length > 0
  }

  // ------------------------------------------------------------------ assets
  async insertAsset(values: NewAsset): Promise<AssetRow> {
    const [row] = await this.db.insert(brandAssets).values(values).returning()
    return row!
  }

  async findAsset(brandId: string, assetId: string): Promise<AssetRow | undefined> {
    const [row] = await this.db
      .select()
      .from(brandAssets)
      .where(and(eq(brandAssets.id, assetId), eq(brandAssets.brandId, brandId)))
      .limit(1)
    return row
  }

  async deleteAsset(assetId: string): Promise<void> {
    await this.db.delete(brandAssets).where(eq(brandAssets.id, assetId))
  }

  /** Official logos / app icons (what page images are compared with), oldest first */
  async logoAssets(brandId: string): Promise<{ id: string; kind: string; filename: string; storageKey: string }[]> {
    return this.db
      .select({ id: brandAssets.id, kind: brandAssets.kind, filename: brandAssets.filename, storageKey: brandAssets.storageKey })
      .from(brandAssets)
      .where(and(eq(brandAssets.brandId, brandId), inArray(brandAssets.kind, ["logo", "app_icon"])))
      .orderBy(brandAssets.createdAt)
  }

  async storageKeys(brandId: string): Promise<string[]> {
    const rows = await this.db.select({ key: brandAssets.storageKey }).from(brandAssets).where(eq(brandAssets.brandId, brandId))
    return rows.map((r) => r.key)
  }

  // ------------------------------------------------------------------ allowlist
  async listAllow(brandId: string): Promise<AllowRow[]> {
    return this.db.select().from(brandAllowlist).where(eq(brandAllowlist.brandId, brandId)).orderBy(asc(brandAllowlist.createdAt))
  }

  async insertAllow(brandId: string, kind: AllowRow["kind"], value: string): Promise<AllowRow> {
    const [row] = await this.db.insert(brandAllowlist).values({ brandId, kind, value }).returning()
    return row!
  }

  async deleteAllow(brandId: string, allowId: string): Promise<boolean> {
    const rows = await this.db
      .delete(brandAllowlist)
      .where(and(eq(brandAllowlist.id, allowId), eq(brandAllowlist.brandId, brandId)))
      .returning({ id: brandAllowlist.id })
    return rows.length > 0
  }

  // ------------------------------------------------------------------ for scan modules
  /** The brand plus its allowlist, as the snapshot scan modules work from */
  async loadContext(id: string, range: { dateFrom?: Date | null; dateTo?: Date | null } = {}): Promise<BrandContext | undefined> {
    const brand = await this.findById(id)
    if (!brand) return undefined
    const [allow, assets] = await Promise.all([
      this.db.select({ kind: brandAllowlist.kind, value: brandAllowlist.value }).from(brandAllowlist).where(eq(brandAllowlist.brandId, id)),
      this.db
        .select({ kind: brandAssets.kind, phash: brandAssets.phash, dhash: brandAssets.dhash, mmh3: brandAssets.mmh3 })
        .from(brandAssets)
        .where(eq(brandAssets.brandId, id)),
    ])
    return buildBrandContext(brand, allow, range, assets)
  }
}
