/** API contract for auth. Field names match the legacy API, so the frontend works unchanged. */
import { z } from "zod"

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

export const LoginDto = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(320)
    .regex(EMAIL, "Enter a valid email address"),
  password: z.string().min(1).max(200),
})
export type LoginInput = z.infer<typeof LoginDto>

export const UserDto = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
  role: z.enum(["admin", "analyst"]),
  is_active: z.boolean(),
  created_at: z.string(),
})
export type UserOut = z.infer<typeof UserDto>

export const TokenDto = z.object({ access_token: z.string(), token_type: z.literal("bearer"), user: UserDto })
