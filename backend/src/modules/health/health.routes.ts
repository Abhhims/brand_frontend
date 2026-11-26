/**
 * Routes: maps URL + method to a controller method and declares the contract (DTOs, docs tag, auth rule).
 *   GET /health/live   the process is up (restart it if this fails)
 *   GET /health/ready  Postgres and Redis answer (stop sending traffic here if this fails)
 */
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod"
import type { HealthController } from "./health.controller.js"
import { LiveDto, ReadyDto } from "./health.dto.js"

export const healthRoutes =
  (controller: HealthController): FastifyPluginAsyncZod =>
  async (app) => {
    app.get("/live", { config: { rateLimit: false }, schema: { tags: ["health"], response: { 200: LiveDto } } }, controller.live)
    app.get(
      "/ready",
      { config: { rateLimit: false }, schema: { tags: ["health"], response: { 200: ReadyDto, 503: ReadyDto } } },
      controller.ready,
    )
  }
