/** API contract for brands. Field names and rules match the legacy API. */
import { z } from "zod"
import { ALLOW_KINDS } from "../../common/allowlist.js"
import { PageQueryDto, pageDto, queryBool } from "../../common/dto.js"

export const RISK_LEVELS = ["Low", "Medium", "High", "Critical"] as const
export const AUTO_SCAN_FREQUENCIES = ["daily", "every_3_days", "weekly"] as const
/** Scanners a brand can pick for automatic scans; none picked = every scanner */
export const AUTO_RUNNERS = ["domains", "apk", "rogue_app", "social", "social_media", "documents", "logo", "email_posture"] as const
export const ASSET_KINDS = ["logo", "favicon", "app_icon"] as const

// ------------------------------------------------------------------ requests
export const AllowInDto = z.object({
  kind: z.enum(ALLOW_KINDS),
  value: z.string().min(1).max(500),
})
export type AllowInput = z.infer<typeof AllowInDto>

export const CreateBrandDto = z
  .object({
    name: z.string().trim().min(1).max(200),
    description: z.string().nullable().optional(),
    keywords: z.array(z.string()).default([]),
    product_terms: z.array(z.string()).default([]),
    is_active: z.boolean().default(true),
    alert_min_level: z.enum(RISK_LEVELS).default("Medium"),
    auto_scan_enabled: z.boolean().default(false),
    auto_scan_frequency: z.enum(AUTO_SCAN_FREQUENCIES).default("daily"),
    /** null or empty = every scanner */
    auto_scan_runners: z.array(z.enum(AUTO_RUNNERS)).nullable().optional(),
    allowlist: z.array(AllowInDto).default([]),
  })
  .strict()
export type CreateBrandInput = z.infer<typeof CreateBrandDto>

/** Only the fields sent (and not null) are changed */
export const UpdateBrandDto = z
  .object({
    name: z.string().trim().min(1).max(200).nullable(),
    description: z.string().nullable(),
    keywords: z.array(z.string()).nullable(),
    product_terms: z.array(z.string()).nullable(),
    is_active: z.boolean().nullable(),
    alert_min_level: z.enum(RISK_LEVELS).nullable(),
    auto_scan_enabled: z.boolean().nullable(),
    auto_scan_frequency: z.enum(AUTO_SCAN_FREQUENCIES).nullable(),
    auto_scan_runners: z.array(z.enum(AUTO_RUNNERS)).nullable(),
  })
  .partial()
  .strict()
export type UpdateBrandInput = z.infer<typeof UpdateBrandDto>

/** GET /brands/search */
export const SearchBrandsQueryDto = PageQueryDto.extend({
  /** text found in the name, description, keywords, product terms or any allowlist value (domain, handle, app…) */
  q: z.string().trim().max(200).optional(),
  is_active: queryBool,
  /** only brands that have (true) or lack (false) at least one official domain */
  has_domain: queryBool,
  /** only brands with automatic scans on/off */
  auto_scan_enabled: queryBool,
  sort: z.enum(["name", "created_at"]).default("name"),
})
export type SearchBrandsQuery = z.infer<typeof SearchBrandsQueryDto>

/** POST /brands/:id/details — add to what the brand already has (nothing is removed) */
const valueList = z.array(z.string().trim().min(1).max(500)).max(200).optional()
export const AddDetailsDto = z
  .object({
    keywords: valueList,
    product_terms: valueList,
    /** official websites, e.g. "zentrova.com" or "https://www.zentrova.com" */
    domains: valueList,
    /** domains the brand sends email from */
    email_domains: valueList,
    /** official social accounts: profile URLs or @handles */
    social_handles: valueList,
    /** official app package names, e.g. "com.zentrova.app" */
    packages: valueList,
    /** official app-store publisher / developer names */
    publishers: valueList,
    /** SHA-256 fingerprints of the official app signing certificates */
    signing_certs: valueList,
    description: z.string().max(5000).optional(),
  })
  .strict()
  .refine((v) => Object.values(v).some((x) => (Array.isArray(x) ? x.length > 0 : x !== undefined)), { message: "Send at least one detail to add" })
export type AddDetailsInput = z.infer<typeof AddDetailsDto>

export const BrandIdParamDto = z.object({ id: z.string().uuid() })
export const AssetParamDto = z.object({ id: z.string().uuid(), assetId: z.string().uuid() })
export const AllowParamDto = z.object({ id: z.string().uuid(), allowId: z.string().uuid() })

// ------------------------------------------------------------------ responses
export const AssetDto = z.object({
  id: z.string(),
  kind: z.enum(ASSET_KINDS),
  filename: z.string(),
  content_type: z.string(),
  sha256: z.string(),
  phash: z.string().nullable(),
  mmh3: z.number().nullable(),
  created_at: z.string(),
  /** time-limited download link */
  url: z.string().nullable(),
})
export type AssetOut = z.infer<typeof AssetDto>

export const AllowDto = z.object({ id: z.string(), kind: z.enum(ALLOW_KINDS), value: z.string() })

export const BrandDto = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  keywords: z.array(z.string()),
  product_terms: z.array(z.string()),
  is_active: z.boolean(),
  alert_min_level: z.enum(RISK_LEVELS),
  auto_scan_enabled: z.boolean(),
  auto_scan_frequency: z.string(),
  auto_scan_runners: z.array(z.string()),
  last_auto_scan_at: z.string().nullable(),
  next_auto_scan_at: z.string().nullable(),
  created_at: z.string(),
  assets: z.array(AssetDto),
  allowlist: z.array(AllowDto),
  /** open alerts for this brand (0 until the findings/alerts module is ported) */
  open_alerts: z.number(),
})
export type BrandOut = z.infer<typeof BrandDto>

export const BrandSearchItemDto = BrandDto.extend({
  /** where q was found: name, description, keyword, product_term, domain, email_domain, social_handle, package, publisher, signing_cert */
  matched_on: z.array(z.string()),
})
export const BrandSearchPageDto = pageDto(BrandSearchItemDto)

export const AddDetailsResultDto = z.object({
  brand: BrandDto,
  /** what was new and saved */
  added: z.object({
    keywords: z.array(z.string()),
    product_terms: z.array(z.string()),
    allowlist: z.array(AllowDto),
    description: z.boolean(),
  }),
  /** what was not saved, and why (already present, not readable, …) */
  skipped: z.array(z.object({ field: z.string(), value: z.string(), reason: z.string() })),
})
