/**
 * Login and token checks:
 * - argon2id passwords (same parameters as legacy, so old hashes verify)
 * - HS256 JWT {sub: user id, role}, valid JWT_EXPIRE_MINUTES; no refresh tokens
 * - the role is always re-read from the database, never trusted from the token
 */
import { verify as verifyPassword } from "argon2"
import { createSigner, createVerifier } from "fast-jwt"
import { AppError, unauthorized } from "../../common/errors.js"
import type { UserRow, UsersRepository } from "../users/users.repository.js"
import type { LoginInput } from "./auth.dto.js"

export interface AuthSettings {
  jwtSecret: string
  jwtExpireMinutes: number
}

export class AuthService {
  private readonly sign: (payload: Record<string, unknown>) => string
  private readonly verifyToken: (token: string) => { sub?: string }

  constructor(
    private readonly users: UsersRepository,
    settings: AuthSettings,
  ) {
    this.sign = createSigner({ key: settings.jwtSecret, algorithm: "HS256", expiresIn: settings.jwtExpireMinutes * 60_000 })
    this.verifyToken = createVerifier({ key: settings.jwtSecret, algorithms: ["HS256"] })
  }

  async login(input: LoginInput): Promise<{ token: string; user: UserRow }> {
    const user = await this.users.findByEmail(input.email)
    const ok = user?.isActive && (await verifyPassword(user.passwordHash, input.password).catch(() => false))
    if (!user || !ok) throw new AppError(401, "Invalid email or password")
    return { token: this.sign({ sub: user.id, role: user.role }), user }
  }

  /** The active user behind a bearer token, or 401 */
  async authenticate(token: string | undefined): Promise<UserRow> {
    if (!token) throw unauthorized()
    let sub: string | undefined
    try {
      sub = this.verifyToken(token).sub
    } catch {
      throw unauthorized()
    }
    const user = sub ? await this.users.findById(sub) : undefined
    if (!user || !user.isActive) throw unauthorized()
    return user
  }
}
