/** HTTP layer for auth. */
import type { FastifyRequest } from "fastify"
import type { LoginInput } from "./auth.dto.js"
import { currentUser } from "./auth.guards.js"
import { toUserDto } from "./auth.mapper.js"
import type { AuthService } from "./auth.service.js"

export class AuthController {
  constructor(private readonly service: AuthService) {}

  login = async (request: FastifyRequest<{ Body: LoginInput }>) => {
    const { token, user } = await this.service.login(request.body)
    return { access_token: token, token_type: "bearer" as const, user: toUserDto(user) }
  }

  me = async (request: FastifyRequest) => toUserDto(currentUser(request))
}
