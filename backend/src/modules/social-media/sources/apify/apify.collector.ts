/**
 * Runs the Apify sources for one brand and returns the collected items.
 * Each source reports its own scan component:
 *   not_configured  no APIFY_TOKEN            skipped  platform not in APIFY_PLATFORMS
 *   unavailable     Apify unreachable         failed   actor or run failed
 *   ok              at least one run succeeded (counts: items, runs, cached)
 * One broken source never stops the others.
 */
import type { BrandContext } from "../../../../common/brand-context.js"
import type { ScanReport } from "../../../../common/scan-report.js"
import { logger } from "../../../../infra/logger.js"
import type { ApifyRunner } from "../../../../integrations/apify/apify.runner.js"
import { ApifyError, type RunResult } from "../../../../integrations/apify/apify.types.js"
import { itemKey, type SocialItem } from "../social-item.js"
import { APIFY_SOURCES, type ApifyPlatform, type ApifySettings, type ApifySourceDef, type PlannedRun, type SourceKind } from "./apify.sources.js"

/** Called for every actor run (or cache hit), so the caller can record runs and costs */
export type RunRecorder = (source: ApifySourceDef, actor: string, run: PlannedRun, result: RunResult) => void

export interface CollectOptions {
  platforms?: ApifyPlatform[]
  kinds?: SourceKind[]
  onRun?: RunRecorder
}

export class ApifyCollector {
  constructor(
    private readonly runner: ApifyRunner,
    private readonly settings: ApifySettings,
    private readonly configured: boolean,
  ) {}

  /** Which sources would run, and why not when they would not (for the status endpoint) */
  sourceStatus() {
    return APIFY_SOURCES.map((s) => ({
      name: s.name,
      platform: s.platform,
      kind: s.kind,
      actor: s.actor(this.settings),
      enabled: this.configured && this.settings.enabledPlatforms.includes(s.platform),
      reason: !this.configured
        ? "APIFY_TOKEN not set"
        : this.settings.enabledPlatforms.includes(s.platform)
          ? null
          : `'${s.platform}' not in APIFY_PLATFORMS`,
    }))
  }

  async collect(ctx: BrandContext, report: ScanReport, opts: CollectOptions = {}): Promise<SocialItem[]> {
    const sources = APIFY_SOURCES.filter(
      (s) => (!opts.platforms || opts.platforms.includes(s.platform)) && (!opts.kinds || opts.kinds.includes(s.kind)),
    )
    const out: SocialItem[] = []
    for (const source of sources) {
      try {
        out.push(...(await this.runSource(source, ctx, report, opts.onRun)))
      } catch (err) {
        report.failed(source.name, `${(err as Error).name}: ${(err as Error).message}`.slice(0, 300))
        logger.error({ err, source: source.name }, "apify source failed")
      }
    }
    return out
  }

  private async runSource(source: ApifySourceDef, ctx: BrandContext, report: ScanReport, onRun?: RunRecorder): Promise<SocialItem[]> {
    if (!this.configured) {
      report.notConfigured(source.name, "APIFY_TOKEN not set")
      return []
    }
    if (!this.settings.enabledPlatforms.includes(source.platform)) {
      report.skipped(source.name, `'${source.platform}' not in APIFY_PLATFORMS`)
      return []
    }
    const runs = source.plan(ctx, this.settings)
    if (!runs.length) {
      report.skipped(source.name, "no search terms for this brand")
      return []
    }
    const actor = source.actor(this.settings)

    let results: RunResult[]
    try {
      results = await this.runner.runMany(
        actor,
        runs.map((r) => ({ input: r.input, maxItems: r.maxItems })),
      )
    } catch (err) {
      const e = err instanceof ApifyError ? err : new ApifyError(String(err))
      const message = `${actor}: ${e.message}`.slice(0, 300)
      if (e.unreachable) report.unavailable(source.name, message)
      else report.failed(source.name, message)
      return []
    }

    const items: SocialItem[] = []
    results.forEach((res, i) => {
      const run = runs[i]!
      onRun?.(source, actor, run, res)
      if (res.error) report.failed(source.name, `${actor} '${run.label}': ${res.error}`.slice(0, 300))
      for (const raw of res.items) {
        try {
          const item = source.parse(raw)
          if (item) items.push({ ...item, query: item.query ?? run.label })
        } catch (err) {
          // one odd record must not lose the rest
          logger.info({ actor, err: (err as Error).message }, "apify item unreadable")
        }
      }
    })

    const kept = source.dedupe ? [...new Map(items.map((it) => [itemKey(it), it])).values()] : items
    if (results.some((r) => !r.error)) {
      report.ok(source.name, {
        items: kept.length,
        runs: results.filter((r) => !r.cached && r.runId).length,
        cached: results.filter((r) => r.cached).length,
      })
    }
    return kept
  }
}
