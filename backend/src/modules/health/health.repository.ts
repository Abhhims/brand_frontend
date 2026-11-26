/**
 * Repository layer: talks to data stores and nothing else. No HTTP, no business rules.
 * Here that is just "can I reach Postgres / Redis"; in other modules it holds every Drizzle query.
 */
import type { Pool } from "pg"
import type { Redis } from "ioredis"

export class HealthRepository {
  constructor(
    private readonly pool: Pool,
    private readonly redis: Redis,
  ) {}

  async pingPostgres(): Promise<void> {
    await this.pool.query("select 1")
  }

  async pingRedis(): Promise<void> {
    await this.redis.ping()
  }
}
