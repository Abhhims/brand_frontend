/**
 * Brands — business rules:
 * - keywords / product terms: trimmed, de-duplicated, and never website addresses (those belong in the allowlist)
 * - no keywords given → the brand name in lower case
 * - allowlist values normalised (see common/allowlist.ts) and de-duplicated; signing certs must be 64 hex chars
 * - brand names are unique (409)
 * - official images: must be a readable image ≤ 5 MB; stored in object storage with fingerprints for matching
 */
import { randomUUID } from "node:crypto"
import { normalizeAllow, type AllowKind } from "../../common/allowlist.js"
import { AppError, conflict, notFound } from "../../common/errors.js"
import { faviconHash, hashesFor } from "../../common/imaging.js"
import type { ObjectStorage } from "../../integrations/storage/object-storage.js"
import { logger } from "../../infra/logger.js"
import type { AddDetailsInput, AllowInput, CreateBrandInput, SearchBrandsQuery, UpdateBrandInput } from "./brands.dto.js"
import { toAllowDto, toAssetDto, toBrandDto } from "./brands.mapper.js"
import { isUniqueViolation, type BrandAggregate, type BrandRow, type BrandsRepository, type NewBrand } from "./brands.repository.js"

export const MAX_ASSET_BYTES = 5 * 1024 * 1024
const FREQUENCY_DAYS: Record<string, number> = { daily: 1, every_3_days: 3, weekly: 7 }
const URL_LIKE = /^(https?:\/\/|www\.)|\.(com|in|net|org|co|io)(\/|$)/i

/** Open-alert counts per brand. Supplied by the alerts module once it exists; until then every brand has 0. */
export type OpenAlertCounter = (brandIds: string[]) => Promise<Map<string, number>>

export class BrandsService {
  constructor(
    private readonly repo: BrandsRepository,
    private readonly storage: ObjectStorage,
    private readonly openAlerts: OpenAlertCounter = async () => new Map(),
  ) {}

  // ------------------------------------------------------------------ brands
  async list() {
    return this.toDtos(await this.repo.listAggregates())
  }

  async get(id: string) {
    return (await this.toDtos([await this.aggregate(id)]))[0]!
  }

  async create(input: CreateBrandInput) {
    const name = input.name.trim()
    const allow = new Map<string, { kind: AllowKind; value: string }>()
    for (const item of input.allowlist) {
      const value = normalizeAllowValue(item.kind, item.value)
      allow.set(`${item.kind}\u0000${value}`, { kind: item.kind, value })
    }
    const values: NewBrand = {
      name,
      description: input.description ?? null,
      keywords: cleanTerms(input.keywords).length ? cleanTerms(input.keywords) : [name.toLowerCase()],
      productTerms: cleanTerms(input.product_terms),
      isActive: input.is_active,
      alertMinLevel: input.alert_min_level,
      autoScanEnabled: input.auto_scan_enabled,
      autoScanFrequency: input.auto_scan_frequency,
      autoScanRunners: input.auto_scan_runners ?? [],
    }
    try {
      const row = await this.repo.create(values, [...allow.values()])
      return this.get(row.id)
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict("A brand with this name already exists")
      throw err
    }
  }

  async update(id: string, input: UpdateBrandInput) {
    await this.aggregate(id)
    const set: Partial<NewBrand> = {}
    if (input.name != null) set.name = input.name.trim()
    if (input.description != null) set.description = input.description
    if (input.keywords != null) set.keywords = cleanTerms(input.keywords)
    if (input.product_terms != null) set.productTerms = cleanTerms(input.product_terms)
    if (input.is_active != null) set.isActive = input.is_active
    if (input.alert_min_level != null) set.alertMinLevel = input.alert_min_level
    if (input.auto_scan_enabled != null) set.autoScanEnabled = input.auto_scan_enabled
    if (input.auto_scan_frequency != null) set.autoScanFrequency = input.auto_scan_frequency
    if (input.auto_scan_runners != null) set.autoScanRunners = input.auto_scan_runners
    try {
      await this.repo.update(id, set)
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict("A brand with this name already exists")
      throw err
    }
    return this.get(id)
  }

  async delete(id: string): Promise<void> {
    const keys = await this.repo.storageKeys(id)
    if (!(await this.repo.delete(id))) throw notFound("Brand")
    // Files are removed after the rows; a failed file delete only leaves an orphan file, never a broken brand
    await Promise.all(keys.map((k) => this.storage.delete(k).catch((err) => logger.warn({ err, key: k }, "could not delete asset file"))))
  }

  // ------------------------------------------------------------------ official images
  async addAsset(brandId: string, kind: "logo" | "favicon" | "app_icon", filename: string, data: Buffer, contentType: string | null) {
    await this.aggregate(brandId)
    if (data.length > MAX_ASSET_BYTES) throw new AppError(413, "File is larger than 5 MB")
    const hashes = await hashesFor(data)
    if (!hashes) throw new AppError(422, "Not a readable image (PNG, JPG, GIF, WEBP, ICO, BMP)")

    const name = (filename || `${kind}.png`).replace(/[/\\]/g, "_").slice(0, 200)
    const stored = await this.storage.put(`brands/${brandId}/${kind}/${randomUUID().replace(/-/g, "")}-${name}`, data, contentType)
    const row = await this.repo.insertAsset({
      brandId,
      kind,
      filename: name,
      storageKey: stored.storageKey,
      contentType: stored.contentType,
      sha256: stored.sha256,
      phash: hashes.phash,
      dhash: hashes.dhash,
      mmh3: kind === "favicon" ? faviconHash(data) : null,
    })
    return toAssetDto(row, await this.storage.signedUrl(row.storageKey))
  }

  async deleteAsset(brandId: string, assetId: string): Promise<void> {
    const asset = await this.repo.findAsset(brandId, assetId)
    if (!asset) throw notFound("Asset")
    await this.repo.deleteAsset(assetId)
    // legacy left the file in storage; removing it keeps storage from filling with orphans
    await this.storage.delete(asset.storageKey).catch((err) => logger.warn({ err, key: asset.storageKey }, "could not delete asset file"))
  }

  // ------------------------------------------------------------------ allowlist
  async listAllow(brandId: string) {
    await this.aggregate(brandId)
    return (await this.repo.listAllow(brandId)).map(toAllowDto)
  }

  async addAllow(brandId: string, input: AllowInput) {
    await this.aggregate(brandId)
    try {
      return toAllowDto(await this.repo.insertAllow(brandId, input.kind, normalizeAllowValue(input.kind, input.value)))
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict("Already in the allowlist")
      throw err
    }
  }

  async deleteAllow(brandId: string, allowId: string): Promise<void> {
    if (!(await this.repo.deleteAllow(brandId, allowId))) throw notFound("Allowlist entry")
  }

  // ------------------------------------------------------------------ helpers
  // ------------------------------------------------------------------ search & details
  /** Free-text search across names, descriptions, keywords, product terms and every allowlist value */
  async search(q: SearchBrandsQuery) {
    const { ids, total } = await this.repo.search(
      { q: q.q, isActive: q.is_active, hasDomain: q.has_domain, autoScanEnabled: q.auto_scan_enabled, sort: q.sort },
      { offset: (q.page - 1) * q.page_size, limit: q.page_size },
    )
    const aggs = await this.repo.listAggregates(ids)
    const byId = new Map(aggs.map((a) => [a.brand.id, a]))
    const ordered = ids.map((id) => byId.get(id)).filter((a): a is BrandAggregate => !!a)
    const dtos = await this.toDtos(ordered)
    const needle = q.q?.toLowerCase()
    const items = dtos.map((d, i) => ({ ...d, matched_on: needle ? matchedOn(ordered[i]!, needle) : [] }))
    return { items, total, page: q.page, page_size: q.page_size }
  }

  /**
   * Add details to a brand without removing anything: keywords and product terms are merged (case-insensitive),
   * domains / handles / apps / certificates are normalised and added to the allowlist. Each value that is not
   * saved is listed in `skipped` with the reason, so one bad value never blocks the rest.
   */
  async addDetails(id: string, input: AddDetailsInput) {
    const agg = await this.aggregate(id)
    const skipped: { field: string; value: string; reason: string }[] = []

    const merge = (field: "keywords" | "product_terms", current: string[], incoming: string[] | undefined) => {
      const have = new Set(current.map((t) => t.toLowerCase()))
      const added: string[] = []
      for (const raw of incoming ?? []) {
        const t = raw.trim()
        if (URL_LIKE.test(t)) skipped.push({ field, value: t, reason: "Looks like a website address — send it in domains instead" })
        else if (have.has(t.toLowerCase())) skipped.push({ field, value: t, reason: "Already present" })
        else {
          have.add(t.toLowerCase())
          added.push(t)
        }
      }
      return added
    }
    const keywords = merge("keywords", agg.brand.keywords, input.keywords)
    const productTerms = merge("product_terms", agg.brand.productTerms, input.product_terms)

    const FIELD_KIND: [keyof AddDetailsInput, AllowKind][] = [
      ["domains", "domain"],
      ["email_domains", "email_domain"],
      ["social_handles", "social_handle"],
      ["packages", "package"],
      ["publishers", "publisher"],
      ["signing_certs", "signing_cert"],
    ]
    const existing = new Set(agg.allowlist.map((a) => `${a.kind}\u0000${a.value}`))
    const toAdd: { kind: AllowKind; value: string }[] = []
    for (const [field, kind] of FIELD_KIND) {
      for (const raw of (input[field] as string[] | undefined) ?? []) {
        let value: string
        try {
          value = normalizeAllowValue(kind, raw)
        } catch (err) {
          skipped.push({ field, value: raw, reason: (err as Error).message })
          continue
        }
        const key = `${kind}\u0000${value}`
        if (existing.has(key)) {
          skipped.push({ field, value: raw, reason: "Already in the allowlist" })
          continue
        }
        existing.add(key)
        toAdd.push({ kind, value })
      }
    }

    const update: Partial<NewBrand> = {}
    if (keywords.length) update.keywords = [...agg.brand.keywords, ...keywords]
    if (productTerms.length) update.productTerms = [...agg.brand.productTerms, ...productTerms]
    const descriptionChanged = input.description !== undefined && input.description !== agg.brand.description
    if (descriptionChanged) update.description = input.description
    await this.repo.update(id, update)
    const inserted = await this.repo.insertAllowMany(id, toAdd)

    return {
      brand: await this.get(id),
      added: { keywords, product_terms: productTerms, allowlist: inserted.map(toAllowDto), description: descriptionChanged },
      skipped,
    }
  }

  private async aggregate(id: string): Promise<BrandAggregate> {
    const agg = await this.repo.findAggregate(id)
    if (!agg) throw notFound("Brand")
    return agg
  }

  private async toDtos(aggs: BrandAggregate[]) {
    const counts = await this.openAlerts(aggs.map((a) => a.brand.id))
    const urls = new Map<string, string | null>()
    await Promise.all(
      aggs.flatMap((a) => a.assets).map(async (asset) => urls.set(asset.id, await this.storage.signedUrl(asset.storageKey).catch(() => null))),
    )
    return aggs.map((a) => toBrandDto(a, { assetUrls: urls, openAlerts: counts.get(a.brand.id) ?? 0, nextAutoScanAt: nextAutoScan(a.brand) }))
  }
}

/** Which parts of a brand contain the (lower-case) search text */
function matchedOn(a: BrandAggregate, needle: string): string[] {
  const hit = (v: string | null | undefined) => !!v && v.toLowerCase().includes(needle)
  const out = new Set<string>()
  if (hit(a.brand.name)) out.add("name")
  if (hit(a.brand.description)) out.add("description")
  if (a.brand.keywords.some(hit)) out.add("keyword")
  if (a.brand.productTerms.some(hit)) out.add("product_term")
  for (const e of a.allowlist) if (hit(e.value)) out.add(e.kind)
  return [...out]
}

/** Trim, drop empties, de-duplicate; reject website addresses (every module searches for these words) */
export function cleanTerms(values: string[]): string[] {
  const terms = [...new Set(values.map((v) => v.trim()).filter(Boolean))]
  const urls = terms.filter((t) => URL_LIKE.test(t))
  if (urls.length) {
    throw new AppError(
      422,
      `Keywords and product terms must be words such as the brand name, not website addresses (${urls.slice(0, 3).join(", ")}). ` +
        "Add websites under Allowlist → Domain.",
    )
  }
  return terms
}

function normalizeAllowValue(kind: AllowKind, raw: string): string {
  const value = normalizeAllow(kind, raw)
  if (!value) throw new AppError(422, `Could not read a ${kind.replace(/_/g, " ")} from that value`)
  if (kind === "signing_cert" && !/^[0-9A-F]{64}$/.test(value)) {
    throw new AppError(422, "A signing certificate must be its SHA-256 fingerprint (64 hex characters)")
  }
  return value
}

/** When the next automatic scan is due: never when off; now when never scanned; else last + frequency */
export function nextAutoScan(b: BrandRow): Date | null {
  if (!b.autoScanEnabled) return null
  if (!b.lastAutoScanAt) return new Date()
  return new Date(b.lastAutoScanAt.getTime() + (FREQUENCY_DAYS[b.autoScanFrequency] ?? 1) * 86_400_000)
}
