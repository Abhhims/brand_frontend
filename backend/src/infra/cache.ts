/**
 * Read-through cache on Redis.
 *
 *   const stats = await cache.getOrSet(["stats", "executive", brandId], 60, () => computeStats(brandId))
 *
 * - Keys are namespaced (REDIS_KEY_PREFIX + "cache:" + parts), so several environments can share one Redis.
 * - Stampede protection: when a hot key expires, one process recomputes it and the others wait briefly for the
 *   fresh value, instead of all of them hitting Postgres at once.
 * - invalidate(prefix) drops a whole group of keys (e.g. every "stats" key) after a write.
 * - If Redis is down, the request still succeeds: the value is computed directly and a warning is logged.
 */
import { env } from "../config/env.js"
import { logger } from "./logger.js"
import { redis } from "./redis.js"

type KeyPart = string | number | boolean | null | undefined
const ROOT = `${env.REDIS_KEY_PREFIX}cache:`
const keyOf = (parts: KeyPart[]) => ROOT + parts.map((p) => (p === null || p === undefined ? "_" : String(p))).join(":")
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function get<T>(parts: KeyPart[]): Promise<T | undefined> {
  const raw = await redis.get(keyOf(parts))
  return raw === null ? undefined : (JSON.parse(raw) as T)
}

async function set(parts: KeyPart[], value: unknown, ttlSeconds = env.CACHE_DEFAULT_TTL_SECONDS): Promise<void> {
  await redis.set(keyOf(parts), JSON.stringify(value), "EX", ttlSeconds)
}

async function getOrSet<T>(parts: KeyPart[], ttlSeconds: number, compute: () => Promise<T>): Promise<T> {
  const key = keyOf(parts)
  let gotLock: boolean
  try {
    const hit = await redis.get(key)
    if (hit !== null) return JSON.parse(hit) as T
    gotLock = (await redis.set(`${key}:lock`, "1", "PX", 10_000, "NX")) === "OK"
    if (!gotLock) {
      // Another process is computing this value: wait up to ~2 s for its result
      for (let i = 0; i < 20; i++) {
        await sleep(100)
        const v = await redis.get(key)
        if (v !== null) return JSON.parse(v) as T
      }
    }
  } catch (err) {
    logger.warn({ err, key }, "cache unavailable, computing directly")
    return compute()
  }

  const value = await compute()
  try {
    await redis.set(key, JSON.stringify(value), "EX", ttlSeconds)
    if (gotLock) await redis.del(`${key}:lock`)
  } catch (err) {
    logger.warn({ err, key }, "cache write failed")
  }
  return value
}

/** Delete every cached key that starts with these parts. Uses SCAN (never KEYS), so it is safe on a large Redis. */
async function invalidate(prefixParts: KeyPart[]): Promise<number> {
  const match = `${keyOf(prefixParts)}*`
  let cursor = "0"
  let removed = 0
  do {
    const [next, keys] = await redis.scan(cursor, "MATCH", match, "COUNT", 500)
    cursor = next
    if (keys.length) removed += await redis.unlink(...keys)
  } while (cursor !== "0")
  return removed
}

export const cache = { get, set, getOrSet, invalidate, keyOf }
