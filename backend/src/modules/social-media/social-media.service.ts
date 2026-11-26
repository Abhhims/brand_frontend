/**
 * Social media monitoring — business logic.
 *
 *   startCollection   API asks for a collection → a scan run is recorded and a background job queued (fast)
 *   runCollection     the worker runs every Apify source and the free web-search source for the brand, stores the
 *                     items, records each actor run and its cost, analyses the stored items (within a time budget)
 *                     and closes the scan with an honest status per source and step
 *   analyseItems      on demand: (re-)analyse a brand's items now (POST /items/analyse)
 *   reviewItem        analyst decision (same statuses and note rule as phishing results)
 *   list / get / summary / status / usage   read side for the UI
 *
 * Analysis (analysis/social-analyser.ts): official accounts are skipped (stored as
 * relevant = false), every other item gets relevance, scam contacts and wording, an official-logo check of its
 * thumbnail, a risk score (common/scoring.ts social_media rules) and a confidence.
 */
import { inDateRange, type BrandContext } from "../../common/brand-context.js"
import { scoreBreakdown } from "../../common/scoring.js"
import { offsetOf } from "../../common/dto.js"
import { AppError, badRequest, notFound } from "../../common/errors.js"
import type { OfficialLogos } from "../../common/logo-comparison.js"
import { NOTE_REQUIRED, type ReviewInput } from "../../common/review.js"
import { deriveRunStatus, ScanReport } from "../../common/scan-report.js"
import { logger } from "../../infra/logger.js"
import type { ApifyClient } from "../../integrations/apify/apify.client.js"
import type { ObjectStorage } from "../../integrations/storage/object-storage.js"
import type { LogoTemplate } from "../../integrations/vision/logo-matcher.js"
import type { BrandsRepository } from "../brands/brands.repository.js"
import type { LogoTemplates } from "../brands/logo-templates.js"
import type { ScansRepository } from "../scans/scans.repository.js"
import { isOfficialItem, type Analysis, type ImageStats, type SocialAnalyser } from "./analysis/social-analyser.js"
import type { AnalyseInput, AnalyseResult, CollectionPlatform, ItemsQuery, ListCollectionsQuery, StartCollectionInput, SummaryQuery, UsageQuery } from "./social-media.dto.js"
import { toApifyRunDto, toCollectionDto, toSocialItemDetailDto, toSocialItemDto } from "./social-media.mapper.js"
import type { ItemAnalysis, NewApifyRun, NewSocialItem, SocialItemRow, SocialMediaRepository } from "./social-media.repository.js"
import type { ApifyCollector } from "./sources/apify/apify.collector.js"
import type { SourceKind } from "./sources/apify/apify.sources.js"
import { itemKey, type SocialItem } from "./sources/social-item.js"

/** How the service queues work, injected so tests can run jobs inline */
export type Enqueue = (name: string, data: Record<string, unknown>, opts?: { jobId?: string; attempts?: number }) => Promise<void>

export const COLLECT_JOB = "social-media.collect"
export const ANALYSIS_COMPONENT = "Content analysis"
export const LOGO_COMPONENT = "Logo matching (thumbnails)"
/** items analysed per call at most (the rest stay pending for the next call) */
const MAX_ITEMS_PER_ANALYSIS = 5000

/** Small cache around the account lookup, so the status page does not call Apify on every load */
export type CacheFn = <T>(key: string[], ttlSeconds: number, compute: () => Promise<T>) => Promise<T>

export interface SocialMediaSettings {
  itemsPerQuery: number
  scamQueryCount: number
  maxChargeUsd: number
  runTimeoutSeconds: number
  cacheMinutes: number
  /** analysis time budget at the end of a collection */
  analysisBudgetSeconds: number
  /** analysis time budget of one POST /items/analyse request */
  analyseRequestSeconds: number
  /** items analysed at the same time (thumbnail downloads + logo comparison) */
  analysisConcurrency: number
}

/** Analysis and logo collaborators */
export interface SocialAnalysisDeps {
  analyser: SocialAnalyser
  logos: Pick<LogoTemplates, "forBrand">
  storage: Pick<ObjectStorage, "signedUrl">
}

const LEVELS = ["Low", "Medium", "High", "Critical"] as const

export class SocialMediaService {
  constructor(
    private readonly repo: SocialMediaRepository,
    private readonly scans: ScansRepository,
    private readonly brands: BrandsRepository,
    private readonly collector: ApifyCollector,
    private readonly apify: ApifyClient,
    private readonly enqueue: Enqueue,
    private readonly cache: CacheFn,
    private readonly settings: SocialMediaSettings,
    private readonly deps: SocialAnalysisDeps,
  ) {}

  // ------------------------------------------------------------------ commands
  async startCollection(input: StartCollectionInput, trigger: "manual" | "schedule" = "manual") {
    const brand = await this.brands.findById(input.brand_id)
    if (!brand) throw notFound("Brand")
    if (input.date_from && input.date_to && input.date_from > input.date_to) throw badRequest("date_from must be on or before date_to")

    await this.scans.closeStale(brand.id, "social_media")
    const run = await this.scans.create({
      brandId: brand.id,
      module: "social_media",
      trigger,
      stats: {
        runner: "social_media",
        collector: "apify",
        platforms: input.platforms ?? null,
        kinds: input.kinds ?? null,
        ...(input.date_from ? { date_from: input.date_from } : {}),
        ...(input.date_to ? { date_to: input.date_to } : {}),
      },
    })
    try {
      // attempts: 1 — a retry would pay for the same searches again (successful ones are cached, failed are not)
      await this.enqueue(COLLECT_JOB, { scanRunId: run.id }, { jobId: run.id, attempts: 1 })
    } catch (err) {
      const message = (err as Error).message
      await this.scans.finish(run.id, {
        status: "failed",
        stats: run.stats,
        components: [{ name: "Task queue", status: "failed", message, counts: {}, fatal: true }],
        error: `Could not queue scan: ${message}`,
      })
    }
    return toCollectionDto({ ...(await this.scans.findById(run.id))! })
  }

  async cancelCollection(id: string) {
    const run = await this.scans.findById(id)
    if (!run || run.module !== "social_media") throw notFound("Collection")
    if (!(await this.scans.cancel(id))) throw badRequest(`Collection already ${run.status}`)
    return toCollectionDto((await this.scans.findById(id))!)
  }

  /** Background job body. Safe to call twice: a finished or cancelled run is skipped. */
  async runCollection(scanRunId: string): Promise<{ skipped?: string; status?: string }> {
    const run = await this.scans.findById(scanRunId)
    if (!run) return { skipped: "run not found" }
    if (!(await this.scans.markRunning(scanRunId))) return { skipped: `already ${run.status}` }

    const stats = { ...run.stats }
    const report = new ScanReport()
    const apifyRows: NewApifyRun[] = []
    let crashed = false
    try {
      const range = {
        dateFrom: typeof stats.date_from === "string" ? new Date(stats.date_from) : null,
        dateTo: typeof stats.date_to === "string" ? new Date(stats.date_to) : null,
      }
      const ctx = await this.brands.loadContext(run.brandId, range)
      if (!ctx) throw new Error("Brand no longer exists")

      const platforms = (stats.platforms as CollectionPlatform[] | null) ?? undefined
      const kinds = (stats.kinds as SourceKind[] | null) ?? undefined
      const items: SocialItem[] = await this.collector.collect(ctx, report, {
        platforms,
        kinds,
        onRun: (source, actor, planned, result) =>
          apifyRows.push({
            scanRunId,
            brandId: run.brandId,
            source: source.name,
            actor,
            input: planned.input,
            label: planned.label,
            maxItems: planned.maxItems,
            status: result.status,
            apifyRunId: result.runId,
            datasetId: result.datasetId,
            itemCount: result.items.length,
            cached: result.cached,
            usageUsd: result.usageUsd,
            error: result.error,
            startedAt: result.startedAt,
            finishedAt: result.finishedAt,
          }),
      })
      if (!report.anyOk) report.failed("Social media sources", "No source could be searched", true)

      if (await this.scans.isCancelled(scanRunId)) {
        stats.stopped = "cancelled"
      } else {
        const kept = this.inRange(items, ctx)
        const rows = this.toRows(kept, ctx, scanRunId)
        const { created, updated, ids } = await this.repo.upsertItems(rows)
        Object.assign(stats, {
          items_collected: items.length,
          outside_date_range: items.length - kept.length,
          items_stored: rows.length,
          created,
          updated,
          official: rows.filter((r) => r.isOfficial).length,
        })
        // analyse what was just stored, within the time budget (the rest stays pending for POST /items/analyse)
        if (ids.length) {
          const result = await this.analyseBrand(ctx, { ids, deadline: Date.now() + this.settings.analysisBudgetSeconds * 1000, report })
          stats.analysis = result
        }
      }
    } catch (err) {
      crashed = true
      report.failed("Scan engine", (err as Error).message.slice(0, 300), true)
      logger.error({ err, scanRunId }, "social media collection crashed")
    } finally {
      await this.repo.insertApifyRuns(apifyRows).catch((err) => logger.error({ err }, "could not record apify runs"))
    }

    stats.apify_runs = apifyRows.filter((r) => !r.cached && r.apifyRunId).length
    stats.apify_cached = apifyRows.filter((r) => r.cached).length
    stats.apify_cost_usd = round(apifyRows.reduce((a, r) => a + (r.usageUsd ?? 0), 0))
    const components = report.components
    const status = deriveRunStatus(components, crashed)
    await this.scans.finish(scanRunId, { status, stats, components, error: report.errors.slice(0, 50).join("\n") || null })
    return { status }
  }

  /** POST /items/analyse: (re-)analyse a brand's items now, within the request time budget */
  async analyseItems(input: AnalyseInput): Promise<AnalyseResult> {
    const ctx = await this.brands.loadContext(input.brand_id)
    if (!ctx) throw notFound("Brand")
    // only_pending: never analysed (analysed_at null ⇔ "before the epoch"); else everything analysed before now
    const before = input.only_pending ? new Date(0) : new Date()
    return this.analyseBrand(ctx, { before, deadline: Date.now() + this.settings.analyseRequestSeconds * 1000 })
  }

  /**
   * Analyse items of one brand: the given ids, or every item analysed before `before`. Stops starting new items at
   * the deadline; what is left is counted as `remaining`. Every step is recorded on `report` when given.
   */
  private async analyseBrand(ctx: BrandContext, opts: { ids?: string[]; before?: Date; deadline: number; report?: ScanReport }): Promise<AnalyseResult> {
    const started = Date.now()
    const report = opts.report
    let templates: LogoTemplate[] = []
    try {
      templates = await this.deps.logos.forBrand(ctx.id)
      if (!templates.length) report?.skipped(LOGO_COMPONENT, "No official logo uploaded for this brand — thumbnails are kept but not compared")
    } catch (err) {
      report?.failed(LOGO_COMPONENT, `Official logos could not be prepared: ${(err as Error).message}`.slice(0, 300))
      logger.warn({ err, brandId: ctx.id }, "logo templates failed")
    }

    const rows = await this.repo.itemsForAnalysis(ctx.id, { ids: opts.ids, before: opts.before, limit: MAX_ITEMS_PER_ANALYSIS })
    const images: ImageStats = { downloaded: 0, failed: 0, compared: 0, matched: 0, stored: 0 }
    const out: AnalyseResult = {
      brand_id: ctx.id,
      analysed: 0,
      relevant: 0,
      flagged: 0,
      official_skipped: 0,
      by_level: Object.fromEntries(LEVELS.map((l) => [l, 0])),
      images,
      remaining: 0,
      failed: 0,
      duration_seconds: 0,
    }
    const errors: string[] = []
    let next = 0
    let unreached = 0
    const worker = async () => {
      while (next < rows.length) {
        if (Date.now() > opts.deadline) {
          unreached = rows.length - next
          next = rows.length
          return
        }
        const row = rows[next++]!
        try {
          const a = await this.deps.analyser.analyse(ctx, row, templates, images)
          await this.repo.saveAnalysis(row.id, toAnalysisRow(a))
          out.analysed++
          if (a.skipped === "official") out.official_skipped++
          if (a.relevant) {
            out.relevant++
            out.by_level[a.risk.level] = (out.by_level[a.risk.level] ?? 0) + 1
            if (a.risk.score >= 30) out.flagged++
          }
        } catch (err) {
          out.failed++
          errors.push(`${row.url}: ${(err as Error).message}`.slice(0, 200))
          logger.warn({ err, item: row.id }, "social item analysis failed")
        }
      }
    }
    await Promise.all(Array.from({ length: Math.max(1, this.settings.analysisConcurrency) }, worker))

    out.remaining = opts.ids ? unreached : await this.repo.countPending(ctx.id, opts.before ?? new Date(started))
    out.duration_seconds = Math.round((Date.now() - started) / 100) / 10
    if (report) {
      if (rows.length === 0) report.skipped(ANALYSIS_COMPONENT, "No items to analyse")
      else if (out.analysed > 0) report.ok(ANALYSIS_COMPONENT, { analysed: out.analysed, relevant: out.relevant, flagged: out.flagged, official: out.official_skipped })
      if (out.remaining) report.unavailable(ANALYSIS_COMPONENT, `${out.remaining} items not analysed within the time budget — POST /social-media/items/analyse to continue`)
      if (errors.length) report.failed(ANALYSIS_COMPONENT, `${errors.length} items failed: ${errors.slice(0, 3).join("; ")}`)
      if (templates.length) report.ok(LOGO_COMPONENT, { compared: images.compared, matched: images.matched, thumbnails_failed: images.failed })
    }
    return out
  }

  async reviewItem(id: string, input: ReviewInput, by: string) {
    if (NOTE_REQUIRED.has(input.status) && !input.note) throw new AppError(422, `A note is required when marking ${input.status}`)
    if (!(await this.repo.setReview(id, { status: input.status, note: input.note ?? null, by }))) throw notFound("Item")
    return this.getItem(id)
  }

  // ------------------------------------------------------------------ queries
  async listCollections(q: ListCollectionsQuery) {
    const rows = await this.scans.list({ module: "social_media", brandId: q.brand_id, limit: q.limit })
    return rows.map(toCollectionDto)
  }

  async getCollection(id: string) {
    const run = await this.scans.findById(id)
    if (!run || run.module !== "social_media") throw notFound("Collection")
    const runs = await this.repo.apifyRunsForScan(id)
    return {
      ...toCollectionDto(run),
      apify_runs: runs.map(toApifyRunDto),
      cost_usd: round(runs.reduce((a, r) => a + (r.usageUsd ?? 0), 0)),
    }
  }

  async listItems(q: ItemsQuery) {
    const { items, total } = await this.repo.listItems(
      {
        brandIds: q.brand_id,
        platforms: q.platform,
        contentTypes: q.content_type,
        scanRunId: q.scan_id,
        q: q.q,
        includeOfficial: q.include_official ?? false,
        relevant: q.relevant,
        riskLevels: q.risk_level,
        minRisk: q.min_risk,
        reviewStatuses: q.review_status,
        flaggedOnly: q.flagged_only,
        logoMatch: q.logo_match,
        sort: q.sort,
      },
      { offset: offsetOf(q), limit: q.page_size },
    )
    const { urls, logos } = await this.links(items)
    return { items: items.map((r) => toSocialItemDto(r, urls, logos)), total, page: q.page, page_size: q.page_size }
  }

  async getItem(id: string) {
    const item = await this.repo.findItem(id)
    if (!item) throw notFound("Item")
    const { urls, logos } = await this.links([item])
    return toSocialItemDetailDto(item, urls, logos)
  }

  /** Dashboard cards: counts by platform × risk level, content type, reason and review status */
  async summary(q: SummaryQuery) {
    if (q.brand_id && !(await this.brands.findById(q.brand_id))) throw notFound("Brand")
    const [s, [last]] = await Promise.all([this.repo.summary(q.brand_id), this.scans.list({ module: "social_media", brandId: q.brand_id, limit: 1 })])
    const empty = () => ({ Low: 0, Medium: 0, High: 0, Critical: 0, total: 0 })
    const platforms = new Map<string, ReturnType<typeof empty>>()
    const levels = empty()
    for (const r of s.byPlatform) {
      const p = platforms.get(r.platform) ?? empty()
      const level = (LEVELS as readonly string[]).includes(r.level) ? (r.level as (typeof LEVELS)[number]) : "Low"
      p[level] += r.n
      p.total += r.n
      levels[level] += r.n
      levels.total += r.n
      platforms.set(r.platform, p)
    }
    const iso = (v: string | Date | null) => (v ? new Date(v).toISOString() : null)
    return {
      brand_id: q.brand_id ?? null,
      collected: s.totals.collected,
      relevant: s.totals.relevant,
      flagged: s.totals.flagged,
      pending_analysis: s.totals.pending,
      logo_matches: s.totals.logoMatches,
      by_platform: [...platforms].map(([platform, c]) => ({ platform, ...c })).sort((a, b) => b.total - a.total || a.platform.localeCompare(b.platform)),
      by_risk_level: levels,
      by_content_type: s.byType.map((r) => ({ content_type: r.contentType, total: r.n, flagged: r.flagged })).sort((a, b) => b.total - a.total),
      by_reason: s.byReason.map((r) => ({ reason: r.reason, count: r.n })),
      by_review_status: Object.fromEntries(s.byReview.map((r) => [r.status, r.n])),
      last_collection: last
        ? { id: last.id, status: last.status, started_at: iso(last.startedAt), finished_at: iso(last.finishedAt), created_at: last.createdAt.toISOString() }
        : null,
      last_seen: iso(s.totals.lastSeen),
      last_analysed: iso(s.totals.lastAnalysed),
    }
  }

  /** Is Apify usable, which sources run, and with what limits */
  async apifyStatus() {
    const account = this.apify.configured
      ? await this.cache(["apify", "account"], 600, async () => {
          try {
            const a = await this.apify.account()
            return { ok: true, username: a.username ?? null, plan: a.plan?.id ?? null, error: null }
          } catch (err) {
            return { ok: false, username: null, plan: null, error: (err as Error).message }
          }
        })
      : { ok: false, username: null, plan: null, error: "APIFY_TOKEN not set" }
    return {
      configured: this.apify.configured,
      account,
      settings: {
        items_per_query: this.settings.itemsPerQuery,
        scam_queries: this.settings.scamQueryCount,
        max_charge_usd_per_run: this.settings.maxChargeUsd,
        run_timeout_seconds: this.settings.runTimeoutSeconds,
        cache_minutes: this.settings.cacheMinutes,
      },
      sources: this.collector.sourceStatus(),
    }
  }

  /** Apify spend over the last N days, per source */
  async usage(q: UsageQuery) {
    const since = new Date(Date.now() - q.days * 86_400_000)
    const rows = await this.repo.apifyUsage(since, q.brand_id)
    const sources = rows.map((r) => ({
      source: r.source,
      runs: r.runs,
      cached: r.cached,
      failed: r.failed,
      items: r.items ?? 0,
      usage_usd: round(r.usageUsd ?? 0),
    }))
    return {
      since: since.toISOString(),
      total_usd: round(sources.reduce((a, s) => a + s.usage_usd, 0)),
      total_runs: sources.reduce((a, s) => a + s.runs, 0),
      sources,
    }
  }

  // ------------------------------------------------------------------ helpers
  /** Signed links of stored evidence, and the official logos the comparisons refer to (one lookup per brand) */
  private async links(rows: SocialItemRow[]): Promise<{ urls: Map<string, string | null>; logos: OfficialLogos }> {
    const urls = new Map<string, string | null>()
    await Promise.all(rows.flatMap((r) => r.evidence).map(async (e) => urls.set(e.key, await this.deps.storage.signedUrl(e.key).catch(() => null))))
    const logos: OfficialLogos = new Map()
    for (const id of new Set(rows.filter((r) => r.logoComparison).map((r) => r.brandId)))
      for (const a of await this.brands.logoAssets(id)) logos.set(a.id, { name: a.filename, url: await this.deps.storage.signedUrl(a.storageKey).catch(() => null) })
    return { urls, logos }
  }

  /** Date-range filter: accounts/channels are exempt, unknown dates are kept */
  private inRange(items: SocialItem[], ctx: BrandContext) {
    return items.filter((i) => i.contentType === "account" || i.contentType === "channel" || inDateRange(ctx, i.published))
  }

  private toRows(items: SocialItem[], ctx: BrandContext, scanRunId: string): NewSocialItem[] {
    const byKey = new Map<string, NewSocialItem>()
    for (const i of items) {
      const key = itemKey(i)
      if (byKey.has(key)) continue // first source wins, as in legacy
      const published = i.published ? new Date(i.published) : null
      byKey.set(key, {
        brandId: ctx.id,
        scanRunId,
        key,
        platform: i.platform,
        contentType: i.contentType,
        url: i.url,
        itemId: i.itemId?.slice(0, 300) ?? null,
        title: i.title,
        text: i.text,
        author: i.author,
        authorHandle: i.authorHandle?.slice(0, 300) ?? null,
        authorUrl: i.authorUrl,
        authorId: i.authorId?.slice(0, 300) ?? null,
        publishedAt: published && !Number.isNaN(published.getTime()) ? published : null,
        thumbnailUrl: i.thumbnailUrl,
        metrics: i.metrics,
        discovery: i.discovery,
        query: i.query,
        isOfficial: isOfficialItem(ctx, i),
        raw: i.raw,
      })
    }
    return [...byKey.values()]
  }
}

/** Analysis → the columns stored on the item. Not relevant → risk 0 / Low (it is not a finding). */
function toAnalysisRow(a: Analysis): ItemAnalysis {
  return {
    relevant: a.relevant,
    riskScore: a.risk.score,
    riskLevel: a.risk.level,
    signals: a.signals as Record<string, boolean | number | null>,
    scoring: { risk: { ...scoreBreakdown(a.risk), ...(a.relevant ? {} : { not_relevant: true }) }, confidence: a.confidence },
    confidence: a.confidence.score,
    confidenceLevel: a.confidence.level,
    details: a.details,
    headline: a.headline,
    reasons: a.reasons,
    evidence: a.evidence,
    logoComparison: a.logoComparison,
  }
}

const round = (n: number) => Math.round(n * 10_000) / 10_000
