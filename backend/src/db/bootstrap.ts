/** First admin account: created only when the users table is empty. */
import { argon2id, hash } from "argon2"
import { count } from "drizzle-orm"
import { env } from "../config/env.js"
import { db } from "../infra/db.js"
import { logger } from "../infra/logger.js"
import { users } from "./schema/index.js"

/** Same parameters as the legacy argon2-cffi defaults, so existing password hashes keep verifying */
export const ARGON2_OPTIONS = { type: argon2id, timeCost: 3, memoryCost: 65_536, parallelism: 4, hashLength: 32 } as const

export async function ensureBootstrapAdmin(): Promise<void> {
  const [row] = await db.select({ n: count() }).from(users)
  if ((row?.n ?? 0) > 0) return
  await db.insert(users).values({
    email: env.BOOTSTRAP_ADMIN_EMAIL.trim().toLowerCase(),
    name: "Administrator",
    role: "admin",
    passwordHash: await hash(env.BOOTSTRAP_ADMIN_PASSWORD, ARGON2_OPTIONS),
  })
  logger.info({ email: env.BOOTSTRAP_ADMIN_EMAIL }, "bootstrap admin created")
}
