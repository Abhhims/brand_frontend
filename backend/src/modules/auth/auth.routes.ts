/**
 *   POST /api/v1/auth/login   public — email + password → bearer token
 *   GET  /api/v1/auth/me      signed in — the current user
 */
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod"
import { ErrorDto } from "../../common/dto.js"
import type { AuthController } from "./auth.controller.js"
import { LoginDto, TokenDto, UserDto } from "./auth.dto.js"
import type { Guards } from "./auth.guards.js"

export const authRoutes =
  (controller: AuthController, guards: Guards): FastifyPluginAsyncZod =>
  async (app) => {
    app.post(
      "/login",
      {
        // brute-force protection on top of the global limit
        config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
        schema: { tags: ["auth"], body: LoginDto, response: { 200: TokenDto, 401: ErrorDto } },
      },
      controller.login,
    )
    app.get(
      "/me",
      { preHandler: guards.user, schema: { tags: ["auth"], security: [{ bearer: [] }], response: { 200: UserDto, 401: ErrorDto } } },
      controller.me,
    )
  }
