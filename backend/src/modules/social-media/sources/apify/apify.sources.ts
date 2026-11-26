/**
 * Every Apify search the platform runs, as data: which actor, what input, how to read its output.
 * The inputs encode what each actor accepts.
 *
 * To add a platform: write a mapper in ./mappers, add an entry below, add its actor id to config/env.ts.
 */
import { socialQueries, type BrandContext } from "../../../../common/brand-context.js"
import type { SocialItem } from "../social-item.js"
import type { Json } from "./mappers/helpers.js"
import { instagramPost, instagramProfile } from "./mappers/instagram.mapper.js"

export const APIFY_PLATFORMS = ["instagram"] as const
export type ApifyPlatform = (typeof APIFY_PLATFORMS)[number]

/** content = posts/videos/ads found by searching; profiles = accounts found by searching names */
export type SourceKind = "content" | "profiles"
export const SOURCE_KINDS: readonly SourceKind[] = ["content", "profiles"]

export interface ApifySettings {
  enabledPlatforms: string[]
  itemsPerQuery: number
  scamQueryCount: number
  scamTemplates: string[]
  lookbackDays: number
  scamLookbackDays: number
  actors: {
    instagram: string
    instagramPosts: string
  }
}

/** One actor run to start: its input, its result cap, and the searches it covers (shown as "Found By Search") */
export interface PlannedRun {
  input: Record<string, unknown>
  maxItems: number
  label: string
}

export interface ApifySourceDef {
  /** component name shown on the scan, e.g. "Apify Instagram" */
  name: string
  platform: ApifyPlatform
  kind: SourceKind
  actor: (s: ApifySettings) => string
  plan: (ctx: BrandContext, s: ApifySettings) => PlannedRun[]
  parse: (raw: Json) => SocialItem | null
  /** drop repeats of the same item across runs */
  dedupe?: boolean
}

const PROFILES_PER_TERM = 10
const unique = <T>(xs: T[]) => [...new Set(xs)]
const queriesOf = (ctx: BrandContext, s: ApifySettings) => socialQueries(ctx, s.scamTemplates, s.scamQueryCount)
const allQueries = (ctx: BrandContext, s: ApifySettings) => {
  const q = queriesOf(ctx, s)
  return unique([...q.brand, ...q.scam])
}

export const APIFY_SOURCES: ApifySourceDef[] = [
  // ------------------------------------------------------------------ content
  {
    name: "Apify Instagram",
    platform: "instagram",
    kind: "content",
    actor: (s) => s.actors.instagramPosts,
    // Keyword search through the hashtag scraper: the main scraper's search found nothing in live tests (legacy note)
    plan: (ctx, s) => {
      const q = allQueries(ctx, s)
      const n = s.itemsPerQuery
      return q.length
        ? [{ input: { hashtags: q, keywordSearch: true, resultsType: "posts", resultsLimit: n }, maxItems: n * q.length, label: q.join(", ") }]
        : []
    },
    parse: instagramPost,
  },

  // ------------------------------------------------------------------ profiles (possible impersonating accounts)
  {
    name: "Apify Instagram profiles",
    platform: "instagram",
    kind: "profiles",
    actor: (s) => s.actors.instagram,
    plan: (ctx, s) => {
      const { brand } = queriesOf(ctx, s)
      return brand.length
        ? [
            {
              input: { search: brand.join(", "), searchType: "user", searchLimit: PROFILES_PER_TERM, resultsType: "details", resultsLimit: 1 },
              maxItems: PROFILES_PER_TERM * brand.length,
              label: brand.join(", "),
            },
          ]
        : []
    },
    parse: instagramProfile,
  },
]
