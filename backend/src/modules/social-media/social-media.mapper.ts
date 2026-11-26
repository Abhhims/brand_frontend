/** Entity → DTO conversions for the social media module. */
import type { ScanRunRow } from "../scans/scans.repository.js"
import { toLogoComparisonDto, type OfficialLogos, type StoredLogoComparison } from "../../common/logo-comparison.js"
import type { CollectionOut, SocialItemOut } from "./social-media.dto.js"
import type { ApifyRunRow, SocialItemRow } from "./social-media.repository.js"

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null)

export const toCollectionDto = (r: ScanRunRow & { brandName?: string | null }): CollectionOut => ({
  id: r.id,
  brand_id: r.brandId,
  brand_name: r.brandName ?? null,
  module: r.module,
  trigger: r.trigger,
  status: r.status,
  started_at: iso(r.startedAt),
  finished_at: iso(r.finishedAt),
  stats: r.stats,
  components: r.components,
  error: r.error,
  created_at: r.createdAt.toISOString(),
})

export const toApifyRunDto = (r: ApifyRunRow) => ({
  id: r.id,
  source: r.source,
  actor: r.actor,
  label: r.label,
  status: r.status,
  apify_run_id: r.apifyRunId,
  item_count: r.itemCount,
  max_items: r.maxItems,
  cached: r.cached,
  usage_usd: r.usageUsd,
  error: r.error,
  started_at: iso(r.startedAt),
  finished_at: iso(r.finishedAt),
})

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [])
const contactMap = (v: unknown, keep: (k: string) => boolean): Record<string, string[]> =>
  v && typeof v === "object" ? Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([k]) => keep(k)).map(([k, xs]) => [k, strings(xs)])) : {}
const SCORED = new Set(["phone", "whatsapp", "upi"])

/** The stored thumbnail copy of an item, if any */
export const thumbnailEvidence = (r: SocialItemRow) => r.evidence.find((e) => e.kind === "image" && e.meta.role === "thumbnail")

/**
 * Row → list item. `urls` = signed links of stored evidence (by key); `logos` = official logos by asset id. Both are
 * resolved by the service for the rows being returned.
 */
export function toSocialItemDto(r: SocialItemRow, urls: Map<string, string | null> = new Map(), logos: OfficialLogos = new Map()): SocialItemOut {
  const d = r.details
  const thumb = thumbnailEvidence(r)
  const stored = thumb ? (urls.get(thumb.key) ?? null) : null
  const stage = d.Stage === "Finding" || d.Stage === "Candidate" ? d.Stage : null
  return {
    id: r.id,
    brand_id: r.brandId,
    scan_id: r.scanRunId,
    key: r.key,
    platform: r.platform,
    content_type: r.contentType,
    url: r.url,
    item_id: r.itemId,
    title: r.title,
    text: r.text,
    author: r.author,
    author_handle: r.authorHandle,
    author_url: r.authorUrl,
    author_id: r.authorId,
    published_at: iso(r.publishedAt),
    thumbnail_url: stored ?? r.thumbnailUrl,
    metrics: r.metrics,
    discovery: r.discovery,
    query: r.query,
    is_official: r.isOfficial,
    first_seen: r.firstSeen.toISOString(),
    last_seen: r.lastSeen.toISOString(),
    times_seen: r.timesSeen,
    analysed_at: iso(r.analysedAt),
    relevant: r.relevant,
    risk_score: r.riskScore,
    risk_level: r.riskLevel,
    confidence: r.confidence,
    confidence_level: r.confidenceLevel,
    stage,
    structured: !r.discovery.toLowerCase().startsWith("web search"),
    headline: r.headline,
    reasons: r.reasons,
    signals: r.signals,
    scam_contacts: contactMap(d.Contacts, (k) => SCORED.has(k)),
    other_links: contactMap(d.Contacts, (k) => !SCORED.has(k)),
    scam_phrases: strings(d["Scam Phrases"]),
    brand_terms: strings(d["Brand Terms"]),
    thumbnail_source_url: r.thumbnailUrl,
    logo_match: r.signals.social_image_match === true,
    logo_match_score: typeof d["Logo Match Score"] === "number" ? (d["Logo Match Score"] as number) : null,
    logo_comparison: toLogoComparisonDto(r.logoComparison as StoredLogoComparison | null, { foundImageUrl: stored, foundImageSource: r.thumbnailUrl, logos }),
    review_status: r.reviewStatus,
    review_note: r.reviewNote,
    reviewed_at: iso(r.reviewedAt),
    reviewed_by: r.reviewedBy,
  }
}

/** Row → full item: list fields + every detail field, the score breakdown and the evidence links */
export const toSocialItemDetailDto = (r: SocialItemRow, urls: Map<string, string | null> = new Map(), logos: OfficialLogos = new Map()) => ({
  ...toSocialItemDto(r, urls, logos),
  details: r.details,
  scoring: r.scoring,
  evidence: r.evidence.map((e) => ({ kind: e.kind, content_type: e.content_type, url: urls.get(e.key) ?? null, meta: e.meta })),
})
