/** Entity → DTO. Never send password hashes or internal fields to clients. */
import type { UserRow } from "../users/users.repository.js"
import type { UserOut } from "./auth.dto.js"

export const toUserDto = (u: UserRow): UserOut => ({
  id: u.id,
  email: u.email,
  name: u.name,
  role: u.role,
  is_active: u.isActive,
  created_at: u.createdAt.toISOString(),
})
