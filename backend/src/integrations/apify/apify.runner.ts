/**
 * Runs an actor once per input and returns one result per input.
 *
 * - All runs are started first, then awaited, so they execute in parallel on Apify.
 * - Shared time budget (APIFY_RUN_TIMEOUT_SECONDS); runs still going at the deadline are aborted.
 * - Results of successful runs are cached in Redis for APIFY_CACHE_MINUTES, keyed by actor + input. When two
 *   workers need the same search at once, a lock makes one run it and the other wait for its result — so the
 *   same search is never paid for twice.
 * - A failing run is reported in its result. ApifyError is thrown only when nothing could be started at all.
 */
import { createHash } from "node:crypto"
import type { Redis } from "ioredis"
import type { ApifyClient } from "./apify.client.js"
import { ApifyError, TERMINAL_STATUSES, type ApifyItem, type ApifyRun, type RunRequest, type RunResult } from "./apify.types.js"

export interface ApifyRunnerOptions {
  runTimeoutSeconds: number
  cacheMinutes: number
  keyPrefix: string
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** JSON with sorted keys, so the same input always gives the same cache key */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`
  }
  return JSON.stringify(value)
}

const emptyResult = (patch: Partial<RunResult>): RunResult => ({
  items: [],
  status: "NOT-STARTED",
  error: null,
  cached: false,
  runId: null,
  datasetId: null,
  usageUsd: null,
  startedAt: null,
  finishedAt: null,
  ...patch,
})

export class ApifyRunner {
  constructor(
    private readonly client: ApifyClient,
    private readonly redis: Redis,
    private readonly opts: ApifyRunnerOptions,
  ) {}

  cacheKey(actor: string, req: RunRequest): string {
    const hash = createHash("sha256").update(stableStringify([actor, req.input, req.maxItems])).digest("hex")
    return `${this.opts.keyPrefix}apify:${hash}`
  }

  async runMany(actor: string, requests: RunRequest[]): Promise<RunResult[]> {
    const results: (RunResult | undefined)[] = new Array(requests.length)
    const started: { n: number; run: ApifyRun; key: string; maxItems: number }[] = []
    const errors: ApifyError[] = []

    for (const [n, req] of requests.entries()) {
      const key = this.cacheKey(actor, req)
      let cached = await this.cacheGet(key)
      if (cached === null && !(await this.claim(key))) cached = await this.awaitOther(key)
      if (cached !== null) {
        results[n] = emptyResult({ items: cached, status: "SUCCEEDED", cached: true })
        continue
      }
      try {
        const run = await this.client.startRun(actor, req.input, req.maxItems)
        started.push({ n, run, key, maxItems: req.maxItems })
      } catch (err) {
        await this.release(key)
        const e = err instanceof ApifyError ? err : new ApifyError(String(err))
        errors.push(e)
        results[n] = emptyResult({ error: e.message })
        if (e.fatalForAccount) break
      }
    }
    if (errors.length && !started.length && !results.some((r) => r && !r.error)) throw errors[0]

    const deadline = Date.now() + this.opts.runTimeoutSeconds * 1000
    for (const { n, run: first, key, maxItems } of started) {
      let run = first
      try {
        run = await this.waitUntilDone(run, deadline)
        const items = run.defaultDatasetId ? await this.client.datasetItems(run.defaultDatasetId, maxItems) : []
        const ok = run.status === "SUCCEEDED"
        if (ok) await this.cachePut(key, items)
        results[n] = this.toResult(run, { items, error: ok || items.length ? null : `run ${run.status.toLowerCase()}` })
      } catch (err) {
        results[n] = this.toResult(run, { error: (err as Error).message })
      } finally {
        await this.release(key)
      }
    }
    return results.map((r) => r ?? emptyResult({ error: "not started" }))
  }

  private toResult(run: ApifyRun, patch: Partial<RunResult>): RunResult {
    return emptyResult({
      status: run.status,
      runId: run.id,
      datasetId: run.defaultDatasetId ?? null,
      usageUsd: run.usageTotalUsd ?? null,
      startedAt: run.startedAt ? new Date(run.startedAt) : null,
      finishedAt: run.finishedAt ? new Date(run.finishedAt) : new Date(),
      ...patch,
    })
  }

  private async waitUntilDone(run: ApifyRun, deadline: number): Promise<ApifyRun> {
    let current = run
    while (!TERMINAL_STATUSES.has(current.status) && Date.now() < deadline) {
      current = await this.client.waitForRun(current.id)
    }
    if (!TERMINAL_STATUSES.has(current.status)) {
      await this.client.abortRun(current.id).catch(() => undefined)
      current = { ...current, status: "TIMED-OUT" }
    }
    return current
  }

  // ------------------------------------------------------------------ cache + lock (best effort: Redis down = no cache)
  private get cacheOn() {
    return this.opts.cacheMinutes > 0
  }

  private async cacheGet(key: string): Promise<ApifyItem[] | null> {
    if (!this.cacheOn) return null
    try {
      const raw = await this.redis.get(key)
      return raw ? (JSON.parse(raw) as ApifyItem[]) : null
    } catch {
      return null
    }
  }

  private async cachePut(key: string, items: ApifyItem[]) {
    if (!this.cacheOn) return
    await this.redis.set(key, JSON.stringify(items), "EX", this.opts.cacheMinutes * 60).catch(() => undefined)
  }

  /** true when this process may run the search (nobody else is running the same one right now) */
  private async claim(key: string): Promise<boolean> {
    if (!this.cacheOn) return true
    try {
      return (await this.redis.set(`${key}:lock`, "1", "EX", this.opts.runTimeoutSeconds + 120, "NX")) === "OK"
    } catch {
      return true
    }
  }

  private async release(key: string) {
    if (this.cacheOn) await this.redis.del(`${key}:lock`).catch(() => undefined)
  }

  /** Wait for another worker's run of the same search; null (= run it here) if it fails or takes too long */
  private async awaitOther(key: string): Promise<ApifyItem[] | null> {
    const deadline = Date.now() + (this.opts.runTimeoutSeconds + 60) * 1000
    while (Date.now() < deadline) {
      const cached = await this.cacheGet(key)
      if (cached !== null) return cached
      try {
        if (!(await this.redis.exists(`${key}:lock`))) return null
      } catch {
        return null
      }
      await sleep(5_000)
    }
    return null
  }
}
