/**
 * Applies pending SQL migrations from ./drizzle, then makes sure the first admin exists.
 * Run before starting a new API version (deploy step), never from inside the API process: with many API
 * instances starting at once, only this one-off step should change the schema.
 */
import { migrate } from "drizzle-orm/node-postgres/migrator"
import { closeDb, db } from "../infra/db.js"
import { logger } from "../infra/logger.js"
import { ensureBootstrapAdmin } from "./bootstrap.js"

try {
  await migrate(db, { migrationsFolder: "./drizzle" })
  logger.info("migrations applied")
  await ensureBootstrapAdmin()
} catch (err) {
  logger.error({ err }, "migration failed")
  process.exitCode = 1
} finally {
  await closeDb()
}
