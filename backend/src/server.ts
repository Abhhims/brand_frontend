/**
 * API process entry point. Stateless: run as many copies as traffic needs behind a load balancer.
 * On SIGTERM it stops taking new requests, finishes the ones in flight, then closes DB/Redis connections.
 */
import closeWithGrace from "close-with-grace"
import { buildApp } from "./app.js"
import { env } from "./config/env.js"
import { closeDb } from "./infra/db.js"
import { closeQueues } from "./infra/queue.js"
import { redis } from "./infra/redis.js"

const app = await buildApp()

closeWithGrace({ delay: 10_000 }, async ({ err, signal }) => {
  if (err) app.log.error({ err }, "shutting down after error")
  else app.log.info({ signal }, "shutting down")
  await app.close()
  await closeQueues()
  await redis.quit()
  await closeDb()
})

await app.listen({ host: env.HOST, port: env.PORT })
