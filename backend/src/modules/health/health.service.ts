/**
 * Service layer: the business logic. Knows nothing about HTTP (no request/reply objects), so the same logic
 * can be called from a controller, a background job or a test.
 */
import type { Check, Ready } from "./health.dto.js"
import type { HealthRepository } from "./health.repository.js"

export class HealthService {
  constructor(private readonly repo: HealthRepository) {}

  live() {
    return { status: "ok" as const }
  }

  async readiness(): Promise<Ready> {
    const [postgres, redis] = await Promise.all([timed(() => this.repo.pingPostgres()), timed(() => this.repo.pingRedis())])
    return { status: postgres.ok && redis.ok ? "ok" : "degraded", checks: { postgres, redis } }
  }
}

async function timed(fn: () => Promise<void>): Promise<Check> {
  const start = performance.now()
  try {
    await fn()
    return { ok: true, ms: Math.round(performance.now() - start) }
  } catch (err) {
    return { ok: false, ms: Math.round(performance.now() - start), error: (err as Error).message }
  }
}
