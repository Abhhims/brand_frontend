/**
 * Redis connections. One shared client for cache and rate limits. BullMQ needs its own connections with
 * maxRetriesPerRequest = null (it uses blocking commands), so queues call createRedis({ forQueue: true }).
 */
import { Redis } from "ioredis"
import { env } from "../config/env.js"
import { logger } from "./logger.js"

export function createRedis(opts: { forQueue?: boolean } = {}) {
  const client = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: opts.forQueue ? null : 3,
    enableReadyCheck: true,
  })
  client.on("error", (err) => logger.error({ err }, "Redis error"))
  return client
}

export const redis = createRedis()

