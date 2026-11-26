/**
 * Read-only snapshot of a brand that scan modules work from.
 * Built once per scan by the brands repository; modules never query brand tables themselves.
 */
import type { ImageHashes } from "./imaging.js"
import { socialHandle } from "./social-handle.js"

export interface BrandContext {
  id: string
  name: string
  keywords: string[]
  productTerms: string[]
  officialDomains: string[]
  officialHandles: string[]
  /** domains the brand sends email from (allowlist email_domain) */
  emailDomains: string[]
  /** fingerprints of the official logos / app icons and favicons, for image matching on suspicious pages */
  logoHashes: ImageHashes[]
  faviconHashes: ImageHashes[]
  /** Shodan favicon hashes of the official favicons */
  faviconMmh3: number[]
  /** Optional scan date range: only content published inside it is kept (unknown dates are kept) */
  dateFrom: Date | null
  dateTo: Date | null
}

export interface AssetEntry {
  kind: string
  phash: string | null
  dhash: string | null
  mmh3: number | null
}

export interface AllowEntry {
  kind: string
  value: string
}

export function buildBrandContext(
  brand: { id: string; name: string; keywords: string[]; productTerms: string[] },
  allowlist: AllowEntry[],
  range: { dateFrom?: Date | null; dateTo?: Date | null } = {},
  assets: AssetEntry[] = [],
): BrandContext {
  const hashes = (kinds: string[]) =>
    assets.filter((a) => kinds.includes(a.kind) && a.phash && a.dhash).map((a) => ({ phash: a.phash!, dhash: a.dhash! }))
  const of = (kind: string) => allowlist.filter((a) => a.kind === kind).map((a) => a.value)
  return {
    id: brand.id,
    name: brand.name,
    keywords: brand.keywords,
    productTerms: brand.productTerms,
    officialDomains: of("domain").map((d) => d.toLowerCase()),
    officialHandles: of("social_handle").map(socialHandle),
    emailDomains: of("email_domain").map((d) => d.toLowerCase()),
    logoHashes: hashes(["logo", "app_icon"]),
    faviconHashes: hashes(["favicon"]),
    faviconMmh3: assets.filter((a) => a.kind === "favicon" && a.mmh3 !== null).map((a) => a.mmh3!),
    dateFrom: range.dateFrom ?? null,
    dateTo: range.dateTo ?? null,
  }
}

/** Brand words to search for: keywords, else the brand name */
export const brandTerms = (ctx: BrandContext): string[] => (ctx.keywords.length ? ctx.keywords : [ctx.name])

/** The name scammers use: the shortest of the first three terms ("Navi" rather than "Navi Private Limited") */
export const scamBase = (ctx: BrandContext): string =>
  brandTerms(ctx)
    .slice(0, 3)
    .reduce((a, b) => (b.length < a.length ? b : a))

const unique = <T>(xs: T[]) => [...new Set(xs)]

/**
 * Search queries for a brand: `brand` = first two terms (recent content); `scam` = the first `scamCount` scam
 * templates with {brand} filled in (searched over a longer window).
 */
export function socialQueries(ctx: BrandContext, scamTemplates: string[], scamCount: number): { brand: string[]; scam: string[] } {
  const brand = unique(brandTerms(ctx).slice(0, 2))
  const base = scamBase(ctx)
  const scam = unique(scamTemplates.slice(0, Math.max(0, scamCount)).map((q) => q.replaceAll("{brand}", base)))
  return { brand, scam }
}

/** True when the date is inside the scan's range, or the date is unknown/unparseable (never hide on doubt) */
export function inDateRange(ctx: BrandContext, value: string | null | undefined): boolean {
  if (!ctx.dateFrom && !ctx.dateTo) return true
  if (!value) return true
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return true
  const day = d.toISOString().slice(0, 10)
  return (!ctx.dateFrom || day >= ctx.dateFrom.toISOString().slice(0, 10)) && (!ctx.dateTo || day <= ctx.dateTo.toISOString().slice(0, 10))
}
