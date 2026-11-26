/**
 * Builds the Fastify app without starting it, so tests can call it directly (app.inject) and server.ts can
 * listen on a port. Every feature module registers its routes under /api/v1, the same paths as the legacy API.
 */
import Fastify from "fastify"
import cors from "@fastify/cors"
import helmet from "@fastify/helmet"
import multipart from "@fastify/multipart"
import rateLimit from "@fastify/rate-limit"
import sensible from "@fastify/sensible"
import swagger from "@fastify/swagger"
import swaggerUi from "@fastify/swagger-ui"
import { jsonSchemaTransform, serializerCompiler, validatorCompiler, type ZodTypeProvider } from "fastify-type-provider-zod"
import { randomUUID } from "node:crypto"
import { env } from "./config/env.js"
import { loggerOptions } from "./infra/logger.js"
import { redis } from "./infra/redis.js"
import { dbRead } from "./infra/db.js"
import { createContainer, type Container } from "./container.js"
import errors from "./plugins/error-handler.js"
import { authRoutes } from "./modules/auth/auth.routes.js"
import { brandRoutes } from "./modules/brands/brands.routes.js"
import { healthRoutes } from "./modules/health/health.routes.js"
import { dashboardRoutes } from "./modules/dashboard/dashboard.routes.js"
import { socialMediaRoutes } from "./modules/social-media/social-media.routes.js"

/** Tests may pass a container built with fake repositories/services. */
export async function buildApp(container: Container = createContainer()) {
  const { controllers, guards } = container
  const app = Fastify({
    logger: loggerOptions,
    // Trust exactly TRUST_PROXY hops of X-Forwarded-For (0 = trust none), so client IPs cannot be spoofed
    trustProxy: (_address: string, hop: number) => hop < env.TRUST_PROXY,
    // Reuse the caller's request id (from a load balancer) or make one; it appears on every log line
    genReqId: (req) => (req.headers["x-request-id"] as string | undefined) ?? randomUUID(),
    requestIdHeader: "x-request-id",
    bodyLimit: 10 * 1024 * 1024,
  }).withTypeProvider<ZodTypeProvider>()

  // Request and response bodies are validated against zod schemas declared on each route
  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(serializerCompiler)

  app.addHook("onSend", async (request, reply) => {
    reply.header("x-request-id", request.id)
  })

  await app.register(errors)
  await app.register(sensible)
  await app.register(helmet, { contentSecurityPolicy: false })
  // file uploads (multipart/form-data); each route sets its own size limit
  await app.register(multipart, { limits: { files: 1, fields: 10, fileSize: 25 * 1024 * 1024 } })
  // every method the API uses (the plugin default is only GET, HEAD, POST, which blocks PATCH/DELETE from browsers)
  await app.register(cors, { origin: env.CORS_ORIGINS, credentials: true, methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"] })
  // Counted in Redis, so the limit holds across every API instance behind the load balancer
  await app.register(rateLimit, {
    max: env.RATE_LIMIT_PER_MINUTE,
    timeWindow: "1 minute",
    redis,
    nameSpace: `${env.REDIS_KEY_PREFIX}ratelimit:`,
    skipOnError: true,
  })

  if (env.API_DOCS_ENABLED) {
    await app.register(swagger, {
      openapi: {
        info: { title: "Brand Intelligence API", version: "1.0.0" },
        components: { securitySchemes: { bearer: { type: "http", scheme: "bearer", bearerFormat: "JWT" } } },
      },
      transform: jsonSchemaTransform,
    })
    await app.register(swaggerUi, { routePrefix: "/docs" })
  }

  await app.register(healthRoutes(controllers.health), { prefix: "/health" })
  await app.register(
    async (api) => {
      // One line per feature module
      await api.register(authRoutes(controllers.auth, guards), { prefix: "/auth" })
      await api.register(brandRoutes(controllers.brands, guards), { prefix: "/brands" })
      await api.register(socialMediaRoutes(controllers.socialMedia, guards), { prefix: "/social-media" })
      await api.register(dashboardRoutes(controllers.dashboard, guards, dbRead), { prefix: "/dashboard" })
      api.get("/", { schema: { hide: true } }, async () => ({ name: "Brand Intelligence API", version: "1.0.0" }))
    },
    { prefix: "/api/v1" },
  )

  return app
}

export type App = Awaited<ReturnType<typeof buildApp>>
