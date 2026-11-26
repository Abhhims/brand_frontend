/** argon2id password hashing shared by login and the bootstrap admin. */
import { argon2id, hash } from "argon2"

/** Same parameters as the legacy argon2-cffi defaults, so existing password hashes keep verifying */
export const ARGON2_OPTIONS = { type: argon2id, timeCost: 3, memoryCost: 65_536, parallelism: 4, hashLength: 32 } as const

let dummyHash: Promise<string> | undefined

/**
 * A hash of a random value with the real parameters. Login verifies against it when the
 * account is missing or inactive, so every failed login costs the same argon2 time.
 */
export function getDummyHash(): Promise<string> {
  dummyHash ??= hash(crypto.randomUUID(), ARGON2_OPTIONS)
  return dummyHash
}
