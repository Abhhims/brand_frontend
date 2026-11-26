/**
 * Allowlist value normalisation, so the same official value is
 * always stored the same way and scans can compare reliably:
 *   domain         "https://www.Example.com/login" → "example.com"
 *   email_domain   "support@Example.com"          → "example.com"
 *   package        Play Store URL or package       → "com.example.app"
 *   social_handle  profile URL → "instagram.com/examplebank"; bare handle → "examplebank"
 *   signing_cert   "AB:CD:…" / "SHA-256: ab cd …"  → "ABCD…" (64 hex)
 *   publisher      kept exactly as written in the store
 */
import { socialHandle } from "./social-handle.js"

export const ALLOW_KINDS = ["domain", "package", "publisher", "social_handle", "email_domain", "signing_cert"] as const
export type AllowKind = (typeof ALLOW_KINDS)[number]

const HOST_ALIASES: Record<string, string> = { "twitter.com": "x.com", "fb.com": "facebook.com", "youtu.be": "youtube.com" }
const LOOKS_LIKE_URL = /^(www\.)?[a-z0-9-]+\.[a-z]{2,}\//i

function host(value: string): string {
  try {
    return new URL(value.includes("://") ? value : `https://${value}`).hostname.toLowerCase().replace(/^www\./, "")
  } catch {
    return ""
  }
}

export function normalizeDomain(value: string): string {
  let v = value.trim().toLowerCase()
  if (v.includes("://") || v.includes("/")) v = host(v)
  return v.replace(/^www\./, "").replace(/^[/.]+|[/.]+$/g, "")
}

/** "site/handle" for a profile URL (same name on two sites stays two entries); a bare handle stays bare */
export function socialEntry(value: string): string {
  const v = value.trim()
  const handle = socialHandle(v)
  if (!(v.includes("://") || LOOKS_LIKE_URL.test(v)) || !handle) return handle
  const h = host(v).replace(/^m\./, "").replace(/^mobile\./, "")
  return `${HOST_ALIASES[h] ?? h}/${handle}`
}

export function normalizeFingerprint(value: string): string {
  return value
    .replace("SHA-256", "")
    .replace("SHA256", "")
    .replace("sha256", "")
    .replace(/[^0-9a-fA-F]/g, "")
    .toUpperCase()
}

export function normalizeAllow(kind: AllowKind, value: string): string {
  const v = value.trim()
  switch (kind) {
    case "domain":
      return normalizeDomain(v)
    case "email_domain":
      return normalizeDomain(v.split("@").pop() ?? "")
    case "package": {
      const m = /[?&]id=([\w.]+)/.exec(v) // Play Store URL → package
      return (m ? m[1]! : v).toLowerCase()
    }
    case "social_handle":
      return socialEntry(v)
    case "signing_cert":
      return normalizeFingerprint(v)
    case "publisher":
      return v
  }
}
