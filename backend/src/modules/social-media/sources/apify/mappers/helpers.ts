/**
 * Helpers for reading scraper output. Actor JSON is untyped and changes between actor versions, so mappers
 * read it defensively: a missing field gives null, never an exception.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Json = any

/** First value that is not null/undefined/""/[]/{} */
export function first<T = Json>(...values: T[]): T | null {
  for (const v of values) {
    if (v === null || v === undefined || v === "") continue
    if (Array.isArray(v) && v.length === 0) continue
    if (typeof v === "object" && !Array.isArray(v) && Object.keys(v as object).length === 0) continue
    return v
  }
  return null
}

/** Epoch seconds/ms, ISO strings and X's "Fri Nov 24 17:49:36 +0000 2023" → ISO 8601; unknown text is kept */
export function toIso(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null
  if (typeof value === "number") return new Date(value > 1e11 ? value : value * 1000).toISOString()
  const text = String(value)
  const tw = /^[A-Z][a-z]{2} ([A-Z][a-z]{2}) (\d{2}) (\d{2}:\d{2}:\d{2}) ([+-]\d{4}) (\d{4})$/.exec(text)
  if (tw) {
    const d = new Date(`${tw[1]} ${tw[2]} ${tw[5]} ${tw[3]} GMT${tw[4]}`)
    if (!Number.isNaN(d.getTime())) return d.toISOString()
  }
  return text
}

export const str = (v: unknown): string | null => (v === null || v === undefined || v === "" ? null : String(v))
export const obj = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? v : {})
export const arr = (v: unknown): Json[] => (Array.isArray(v) ? v : [])

/** Author details kept in item.raw.author (used to build impersonation profiles) */
export const authorRaw = (avatar?: unknown, followers?: unknown, bio?: unknown, verified?: unknown) => ({
  author: { avatar: avatar ?? null, followers: followers ?? null, bio: bio ?? "", verified: verified ?? null },
})
