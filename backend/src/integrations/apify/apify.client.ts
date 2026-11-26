/**
 * Low-level Apify REST client: one method per API call, no caching and no business logic.
 * The token goes in the Authorization header, never in a URL (URLs end up in logs).
 */
import { ApifyError, type ApifyAccount, type ApifyItem, type ApifyRun } from "./apify.types.js"

const BASE = "https://api.apify.com/v2/"
/** Seconds Apify holds a "wait for finish" request open */
export const WAIT_SECONDS = 60

export class ApifyClient {
  constructor(
    private readonly token: string | undefined,
    private readonly maxChargeUsd: number,
  ) {}

  get configured() {
    return Boolean(this.token)
  }

  /** Start an actor run. `actor` is "owner/name". */
  async startRun(actor: string, input: Record<string, unknown>, maxItems: number): Promise<ApifyRun> {
    const qs = new URLSearchParams({ maxItems: String(maxItems), maxTotalChargeUsd: String(this.maxChargeUsd) })
    const body = await this.call<{ data: ApifyRun }>("POST", `acts/${actor.replace("/", "~")}/runs?${qs}`, input)
    return body.data
  }

  /** Current state of a run; Apify keeps the request open up to WAIT_SECONDS while it is still running. */
  async waitForRun(runId: string): Promise<ApifyRun> {
    const body = await this.call<{ data: ApifyRun }>("GET", `actor-runs/${runId}?waitForFinish=${WAIT_SECONDS}`)
    return body.data
  }

  async abortRun(runId: string): Promise<void> {
    await this.call("POST", `actor-runs/${runId}/abort`)
  }

  /** Dataset items, without the error / "no results" placeholder items some actors write next to real ones. */
  async datasetItems(datasetId: string, limit: number): Promise<ApifyItem[]> {
    const qs = new URLSearchParams({ clean: "true", format: "json", limit: String(limit) })
    const data = await this.call<unknown>("GET", `datasets/${datasetId}/items?${qs}`)
    if (!Array.isArray(data)) return []
    return data.filter((i): i is ApifyItem => typeof i === "object" && i !== null && !("error" in i && i.error) && !("noResults" in i && i.noResults))
  }

  /** The account the token belongs to (used to check the token and show the plan). */
  async account(): Promise<ApifyAccount> {
    const body = await this.call<{ data: ApifyAccount }>("GET", "users/me")
    return body.data
  }

  private async call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    if (!this.token) throw new ApifyError("APIFY_TOKEN not set", 401)
    let res: Response
    try {
      res = await fetch(BASE + path, {
        method,
        headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json", Accept: "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout((WAIT_SECONDS + 30) * 1000),
      })
    } catch (err) {
      throw new ApifyError(`Apify API unreachable: ${(err as Error).message}`, 0)
    }
    const text = await res.text()
    let data: unknown = null
    try {
      data = text ? JSON.parse(text) : null
    } catch {
      /* non-JSON body */
    }
    if (!res.ok) {
      const err = (data as { error?: { message?: string; type?: string } } | null)?.error
      throw new ApifyError(`HTTP ${res.status}: ${err?.message ?? err?.type ?? text.slice(0, 200)}`, res.status)
    }
    return data as T
  }
}
