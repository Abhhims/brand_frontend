/** API contract for social media monitoring (collection + analysis + review). snake_case like the rest of the API. */
import { z } from "zod"
import { isoDay, PageQueryDto, pageDto, queryArray, queryBool } from "../../common/dto.js"
import { LogoComparisonDto } from "../../common/logo-comparison.js"
import { REVIEW_STATUSES } from "../../common/review.js"
import { APIFY_PLATFORMS, SOURCE_KINDS } from "./sources/apify/apify.sources.js"

export { ReviewDto, type ReviewInput } from "../../common/review.js"

/** Collection sources: the Apify platforms plus the free web-search source (every platform, search snippets) */
export const COLLECTION_PLATFORMS = APIFY_PLATFORMS
export type CollectionPlatform = (typeof COLLECTION_PLATFORMS)[number]
export const RISK_LEVELS = ["Low", "Medium", "High", "Critical"] as const
export const CONTENT_TYPES = ["video", "post", "ad", "channel", "account"] as const

// ------------------------------------------------------------------ requests
export const StartCollectionDto = z
  .object({
    brand_id: z.string().uuid(),
    /** default: every platform enabled in APIFY_PLATFORMS (Instagram) */
    platforms: z.array(z.enum(COLLECTION_PLATFORMS)).min(1).optional(),
    /** default: both content and profiles */
    kinds: z.array(z.enum(SOURCE_KINDS as [string, ...string[]])).min(1).optional(),
    /** keep only content published in this range (accounts and unknown dates are always kept) */
    date_from: isoDay.optional(),
    date_to: isoDay.optional(),
  })
  .strict()
export type StartCollectionInput = z.infer<typeof StartCollectionDto>

export const ListCollectionsQueryDto = z.object({
  brand_id: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
})
export type ListCollectionsQuery = z.infer<typeof ListCollectionsQueryDto>

export const ItemsQueryDto = PageQueryDto.extend({
  brand_id: queryArray(z.string().uuid()),
  /** e.g. Instagram, instagram, meta_ads (case and punctuation ignored) */
  platform: queryArray(z.string().max(40)),
  content_type: queryArray(z.enum(CONTENT_TYPES)),
  risk_level: queryArray(z.enum(RISK_LEVELS)),
  min_risk: z.coerce.number().int().min(0).max(100).optional(),
  /** true (default) = about the brand, or not analysed yet (plus official items when include_official=true); false = analysed and not about the brand; all = both */
  relevant: z
    .enum(["true", "false", "1", "0", "all"])
    .default("true")
    .transform((v) => (v === "all" ? undefined : v === "true" || v === "1")),
  review_status: queryArray(z.enum(REVIEW_STATUSES)),
  /** true = risk Medium or above (score >= 30) */
  flagged_only: queryBool,
  /** true = official logo found in the thumbnail */
  logo_match: queryBool,
  scan_id: z.string().uuid().optional(),
  /** text in title, text, author name, handle or URL */
  q: z.string().trim().max(200).optional(),
  /** official brand accounts are hidden unless asked for */
  include_official: queryBool,
  /** risk = riskiest first (default); recent = last seen first; published; first_seen. last_seen = recent (older clients) */
  sort: z.enum(["risk", "recent", "published", "first_seen", "last_seen"]).default("risk"),
})
export type ItemsQuery = z.infer<typeof ItemsQueryDto>

export const UsageQueryDto = z.object({
  brand_id: z.string().uuid().optional(),
  days: z.coerce.number().int().min(1).max(365).default(30),
})
export type UsageQuery = z.infer<typeof UsageQueryDto>

export const IdParamDto = z.object({ id: z.string().uuid() })

export const AnalyseDto = z
  .object({
    brand_id: z.string().uuid(),
    /** true = only items never analysed; default false = re-analyse every item of the brand (oldest analysis first) */
    only_pending: z.boolean().optional(),
  })
  .strict()
export type AnalyseInput = z.infer<typeof AnalyseDto>

export const SummaryQueryDto = z.object({ brand_id: z.string().uuid().optional() })
export type SummaryQuery = z.infer<typeof SummaryQueryDto>

// ------------------------------------------------------------------ responses
export const ComponentDto = z.object({
  name: z.string(),
  status: z.enum(["ok", "skipped", "not_configured", "unavailable", "failed"]),
  message: z.string(),
  counts: z.record(z.string(), z.number()),
  fatal: z.boolean().optional(),
})

export const CollectionDto = z.object({
  id: z.string(),
  brand_id: z.string(),
  brand_name: z.string().nullable(),
  module: z.string(),
  trigger: z.string(),
  status: z.string(),
  started_at: z.string().nullable(),
  finished_at: z.string().nullable(),
  stats: z.record(z.string(), z.unknown()),
  components: z.array(ComponentDto),
  error: z.string().nullable(),
  created_at: z.string(),
})
export type CollectionOut = z.infer<typeof CollectionDto>

export const ApifyRunDto = z.object({
  id: z.string(),
  source: z.string(),
  actor: z.string(),
  label: z.string(),
  status: z.string(),
  apify_run_id: z.string().nullable(),
  item_count: z.number(),
  max_items: z.number(),
  cached: z.boolean(),
  usage_usd: z.number().nullable(),
  error: z.string().nullable(),
  started_at: z.string().nullable(),
  finished_at: z.string().nullable(),
})

export const CollectionDetailDto = CollectionDto.extend({
  apify_runs: z.array(ApifyRunDto),
  cost_usd: z.number(),
})

export const SocialItemDto = z.object({
  id: z.string(),
  brand_id: z.string(),
  scan_id: z.string().nullable(),
  key: z.string(),
  platform: z.string(),
  content_type: z.string(),
  url: z.string(),
  item_id: z.string().nullable(),
  title: z.string(),
  text: z.string(),
  author: z.string().nullable(),
  author_handle: z.string().nullable(),
  author_url: z.string().nullable(),
  author_id: z.string().nullable(),
  published_at: z.string().nullable(),
  thumbnail_url: z.string().nullable(),
  metrics: z.record(z.string(), z.unknown()),
  discovery: z.string(),
  query: z.string().nullable(),
  is_official: z.boolean(),
  first_seen: z.string(),
  last_seen: z.string(),
  times_seen: z.number(),

  // ---- analysis (null / defaults until analysed)
  analysed_at: z.string().nullable(),
  /** about the brand; false = analysed and not about it (or official); null = not analysed yet */
  relevant: z.boolean().nullable(),
  /** 0–100 (common/scoring.ts social_media rules + tier); 0 when not relevant */
  risk_score: z.number(),
  /** Low | Medium | High | Critical */
  risk_level: z.string(),
  /** 0–100: how good the evidence is */
  confidence: z.number(),
  confidence_level: z.string(),
  /** Finding = analysed with evidence (platform data or stored thumbnail); Candidate = search snippet only (D-33) */
  stage: z.enum(["Finding", "Candidate"]).nullable(),
  /** came from a platform API (Apify) rather than a web-search snippet */
  structured: z.boolean(),
  /** e.g. "Brand used in Instagram post (fake contact details, fake customer care)" */
  headline: z.string().nullable(),
  /** fake contact details | fake customer care | scam wording | brand abuse | official logo */
  reasons: z.array(z.string()),
  signals: z.record(z.string(), z.union([z.boolean(), z.number(), z.null()])),
  /** phone / whatsapp / upi published next to the brand (scored) */
  scam_contacts: z.record(z.string(), z.array(z.string())),
  /** other contact links (Telegram): shown, not scored */
  other_links: z.record(z.string(), z.array(z.string())),
  scam_phrases: z.array(z.string()),
  brand_terms: z.array(z.string()),
  /** the platform's original thumbnail / profile picture URL (thumbnail_url = stored copy when there is one) */
  thumbnail_source_url: z.string().nullable(),
  logo_match: z.boolean(),
  logo_match_score: z.number().nullable(),
  logo_comparison: LogoComparisonDto.nullable().describe("thumbnail vs official logo, side by side (null when not compared)"),
  review_status: z.string(),
  review_note: z.string().nullable(),
  reviewed_at: z.string().nullable(),
  reviewed_by: z.string().nullable(),
})
export type SocialItemOut = z.infer<typeof SocialItemDto>
export const SocialItemPageDto = pageDto(SocialItemDto)

export const EvidenceDto = z.object({
  kind: z.string(),
  content_type: z.string(),
  /** time-limited download link */
  url: z.string().nullable(),
  meta: z.record(z.string(), z.unknown()),
})

export const SocialItemDetailDto = SocialItemDto.extend({
  /** legacy output fields: Platform, Content Type, Brand Terms, Scam Contacts, Scam Phrases, Logo Match, Risk… */
  details: z.record(z.string(), z.unknown()),
  /** {risk: {score, level, raw_score, tier, rules, policy}, confidence: {score, level, factors}} */
  scoring: z.record(z.string(), z.unknown()),
  evidence: z.array(EvidenceDto),
})

export const AnalyseResultDto = z.object({
  brand_id: z.string(),
  analysed: z.number(),
  relevant: z.number(),
  flagged: z.number(),
  official_skipped: z.number(),
  by_level: z.record(z.string(), z.number()),
  images: z.object({ downloaded: z.number(), failed: z.number(), compared: z.number(), matched: z.number(), stored: z.number() }),
  /** items not reached within the time budget (call again to continue) */
  remaining: z.number(),
  /** items whose analysis crashed (kept as they were) */
  failed: z.number(),
  duration_seconds: z.number(),
})
export type AnalyseResult = z.infer<typeof AnalyseResultDto>

const LevelCounts = z.object({ Low: z.number(), Medium: z.number(), High: z.number(), Critical: z.number(), total: z.number() })
export const SummaryDto = z.object({
  brand_id: z.string().nullable(),
  /** every collected non-official item */
  collected: z.number(),
  /** analysed and about the brand */
  relevant: z.number(),
  /** relevant with risk Medium or above (score >= 30) */
  flagged: z.number(),
  /** not analysed yet */
  pending_analysis: z.number(),
  /** relevant items showing the official logo */
  logo_matches: z.number(),
  /** relevant (or not yet analysed) items per platform and risk level, most items first */
  by_platform: z.array(LevelCounts.extend({ platform: z.string() })),
  by_risk_level: LevelCounts,
  by_content_type: z.array(z.object({ content_type: z.string(), total: z.number(), flagged: z.number() })),
  /** reason chips over relevant items, most frequent first */
  by_reason: z.array(z.object({ reason: z.string(), count: z.number() })),
  /** review status of flagged items */
  by_review_status: z.record(z.string(), z.number()),
  last_collection: z
    .object({ id: z.string(), status: z.string(), started_at: z.string().nullable(), finished_at: z.string().nullable(), created_at: z.string() })
    .nullable(),
  /** newest last_seen of any item */
  last_seen: z.string().nullable(),
  last_analysed: z.string().nullable(),
})

export const ApifyStatusDto = z.object({
  configured: z.boolean(),
  account: z.object({ ok: z.boolean(), username: z.string().nullable(), plan: z.string().nullable(), error: z.string().nullable() }),
  settings: z.object({
    items_per_query: z.number(),
    scam_queries: z.number(),
    max_charge_usd_per_run: z.number(),
    run_timeout_seconds: z.number(),
    cache_minutes: z.number(),
  }),
  sources: z.array(
    z.object({
      name: z.string(),
      platform: z.string(),
      kind: z.string(),
      actor: z.string(),
      enabled: z.boolean(),
      reason: z.string().nullable(),
    }),
  ),
})

export const UsageDto = z.object({
  since: z.string(),
  total_usd: z.number(),
  total_runs: z.number(),
  sources: z.array(
    z.object({ source: z.string(), runs: z.number(), cached: z.number(), failed: z.number(), items: z.number(), usage_usd: z.number() }),
  ),
})
