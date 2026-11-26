/**
 * Route guards (like Spring Security's @PreAuthorize). Add to a route as `preHandler: guards.user` or
 * `guards.admin`. After a guard runs, `request.user` is the signed-in user.
 */
import type { FastifyRequest } from "fastify"
import { forbidden } from "../../common/errors.js"
import type { UserRow } from "../users/users.repository.js"
import type { AuthService } from "./auth.service.js"

declare module "fastify" {
  interface FastifyRequest {
    user?: UserRow
  }
}

export type Guard = (request: FastifyRequest) => Promise<void>

export function createGuards(auth: AuthService) {
  const user: Guard = async (request) => {
    const header = request.headers.authorization
    const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined
    request.user = await auth.authenticate(token)
  }
  const admin: Guard = async (request) => {
    await user(request)
    if (request.user?.role !== "admin") throw forbidden()
  }
  return { user, admin }
}

export type Guards = ReturnType<typeof createGuards>

/** The signed-in user inside a guarded handler */
export function currentUser(request: FastifyRequest): UserRow {
  if (!request.user) throw new Error("currentUser() used on a route without an auth guard")
  return request.user
}
