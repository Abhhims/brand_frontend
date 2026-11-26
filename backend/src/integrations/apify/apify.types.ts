/** Types for the Apify REST API (https://docs.apify.com/api/v2) — only the fields this app reads. */

/** A raw dataset item from an actor. Shapes differ per actor; mappers turn them into app types. */
export type ApifyItem = Record<string, unknown>

export type ApifyRunStatus = "READY" | "RUNNING" | "SUCCEEDED" | "FAILED" | "ABORTING" | "ABORTED" | "TIMING-OUT" | "TIMED-OUT"

export const TERMINAL_STATUSES: ReadonlySet<string> = new Set(["SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"])

export interface ApifyRun {
  id: string
  actId?: string
  status: ApifyRunStatus | string
  startedAt?: string
  finishedAt?: string | null
  defaultDatasetId?: string
  /** What the run cost so far, in USD */
  usageTotalUsd?: number
}

export interface ApifyAccount {
  username?: string
  plan?: { id?: string; monthlyUsageCreditsUsd?: number }
}

/** One actor input to run, with its own result cap (Apify bills per result). */
export interface RunRequest {
  input: Record<string, unknown>
  maxItems: number
}

/** The outcome of one RunRequest. A failed run is reported here; it does not throw. */
export interface RunResult {
  items: ApifyItem[]
  /** Apify run status, or NOT-STARTED when it never started */
  status: string
  error: string | null
  /** true when the items came from the Redis cache (no new run, no cost) */
  cached: boolean
  runId: string | null
  datasetId: string | null
  usageUsd: number | null
  startedAt: Date | null
  finishedAt: Date | null
}

/** Apify could not be used at all: bad token, no credit, API unreachable. */
export class ApifyError extends Error {
  constructor(
    message: string,
    /** HTTP status from Apify, 0 when the API could not be reached */
    public readonly status = 0,
  ) {
    super(message)
    this.name = "ApifyError"
  }

  get unreachable() {
    return this.status === 0
  }

  /** 401 bad token, 402 no credit, 403 actor not allowed: every other run would fail the same way */
  get fatalForAccount() {
    return this.status === 401 || this.status === 402 || this.status === 403
  }
}
