/**
 * Postgres connection pools and the Drizzle query builder.
 * `db`     = primary: all writes, and reads that must see the latest write.
 * `dbRead` = read replica when DATABASE_READ_URL is set, otherwise the primary. Use it for lists, stats, exports.
 */
import pg from "pg"
import { drizzle } from "drizzle-orm/node-postgres"
import { env } from "../config/env.js"
import { logger } from "./logger.js"
import * as schema from "../db/schema/index.js"

function makePool(url: string, name: string) {
  const pool = new pg.Pool({
    connectionString: url,
    max: env.DB_POOL_MAX,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    statement_timeout: env.DB_STATEMENT_TIMEOUT_MS,
    application_name: `brandintel-${name}`,
  })
  pool.on("error", (err) => logger.error({ err, pool: name }, "idle Postgres client error"))
  return pool
}

export const pool = makePool(env.DATABASE_URL, "primary")
export const readPool = env.DATABASE_READ_URL ? makePool(env.DATABASE_READ_URL, "replica") : pool

export const db = drizzle(pool, { schema, casing: "snake_case" })
export const dbRead = readPool === pool ? db : drizzle(readPool, { schema, casing: "snake_case" })
export type Db = typeof db


export async function closeDb(): Promise<void> {
  await pool.end()
  if (readPool !== pool) await readPool.end()
}
