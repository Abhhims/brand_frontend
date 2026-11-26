/**
 * Social media collection tables (new in the Node backend):
 *   apify_runs    every Apify actor run: what was searched, what it returned, what it cost (audit + cost reports)
 *   social_items  every post/video/ad/account collected for a brand, one row per item (deduplicated by key)
 * Every item is analysed after collection (social-media/analysis): relevance to the brand, scam contacts and wording,
 * official-logo match on its thumbnail → risk score + confidence (common/scoring.ts), plus the analyst's review.
 */
import { boolean, doublePrecision, index, integer, jsonb, pgTable, text, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core"
import { createdAt, id, tstz } from "./columns.js"
import { brands } from "./core.js"
import { scanRuns } from "./scans.js"

export const apifyRuns = pgTable(
  "apify_runs",
  {
    id: id(),
    scanRunId: uuid().references(() => scanRuns.id, { onDelete: "cascade" }),
    brandId: uuid().references(() => brands.id, { onDelete: "cascade" }),
    /** the source that asked for it, e.g. "Apify Instagram" */
    source: varchar({ length: 80 }).notNull(),
    actor: varchar({ length: 200 }).notNull(),
    input: jsonb().$type<Record<string, unknown>>().notNull(),
    /** the searches this run covers, for display */
    label: text().notNull().default(""),
    maxItems: integer().notNull(),
    /** Apify status (SUCCEEDED, FAILED, TIMED-OUT…) or NOT-STARTED */
    status: varchar({ length: 20 }).notNull(),
    apifyRunId: varchar({ length: 40 }),
    datasetId: varchar({ length: 40 }),
    itemCount: integer().notNull().default(0),
    /** served from the Redis cache: no new run, no cost */
    cached: boolean().notNull().default(false),
    usageUsd: doublePrecision(),
    error: text(),
    startedAt: tstz(),
    finishedAt: tstz(),
    createdAt: createdAt(),
  },
  (t) => [index("ix_apify_runs_scan_run_id").on(t.scanRunId), index("ix_apify_runs_created_at").on(t.createdAt)],
)

export const socialItems = pgTable(
  "social_items",
  {
    id: id(),
    brandId: uuid()
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    /** the scan that last saw it */
    scanRunId: uuid().references(() => scanRuns.id, { onDelete: "set null" }),
    /** "{platform}:{type}:{id or url}" — the same item seen again updates this row */
    key: varchar({ length: 1000 }).notNull(),
    platform: varchar({ length: 40 }).notNull(),
    /** video | post | ad | channel | account */
    contentType: varchar({ length: 20 }).notNull(),
    url: text().notNull(),
    itemId: varchar({ length: 300 }),
    title: text().notNull().default(""),
    text: text().notNull().default(""),
    author: text(),
    authorHandle: varchar({ length: 300 }),
    authorUrl: text(),
    authorId: varchar({ length: 300 }),
    publishedAt: tstz(),
    thumbnailUrl: text(),
    metrics: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    /** where it came from, e.g. "Apify (Instagram)" */
    discovery: varchar({ length: 100 }).notNull(),
    /** the search that found it */
    query: text(),
    /** account belongs to the brand (official handle or domain) */
    isOfficial: boolean().notNull().default(false),
    raw: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    firstSeen: tstz().notNull().defaultNow(),
    lastSeen: tstz().notNull().defaultNow(),
    timesSeen: integer().notNull().default(1),

    // ---- analysis (null until analysed; re-run on every collection that sees the item again)
    analysedAt: tstz(),
    /** about the brand (name, look-alike name, logo or short name + scam wording); false = not about the brand or official */
    relevant: boolean(),
    /** 0–100 risk score and level from common/scoring.ts (social_media rules and tiers) */
    riskScore: integer().notNull().default(0),
    riskLevel: varchar({ length: 10 }).notNull().default("Low"),
    /** what was observed, as scoring signals */
    signals: jsonb().$type<Record<string, boolean | number | null>>().notNull().default({}),
    /** {risk: score breakdown (rules, tier, policy), confidence: {score, level, factors}} */
    scoring: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    confidence: integer().notNull().default(0),
    confidenceLevel: varchar({ length: 10 }).notNull().default("Low"),
    /** legacy output fields: Brand Terms, Scam Contacts, Scam Phrases, Logo Match… */
    details: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    /** e.g. "Brand used in Instagram post (fake contact details, fake customer care)" */
    headline: text(),
    /** short reasons shown as chips: "fake contact details", "fake customer care", "scam wording"… */
    reasons: text().array().notNull().default([]),
    /** stored evidence in object storage: [{kind, key, content_type, meta}] (the thumbnail copy) */
    evidence: jsonb().$type<{ kind: string; key: string; content_type: string; meta: Record<string, unknown> }[]>().notNull().default([]),
    /** official logo vs thumbnail comparison (integrations/vision/logo-matcher), null when not compared */
    logoComparison: jsonb().$type<Record<string, unknown>>(),

    // ---- analyst decision (same statuses and rules as phishing_domains)
    reviewStatus: varchar({ length: 20 }).notNull().default("New"),
    reviewNote: text(),
    reviewedAt: tstz(),
    reviewedBy: varchar({ length: 320 }),
  },
  (t) => [
    uniqueIndex("uq_social_items_brand_key").on(t.brandId, t.key),
    index("ix_social_items_brand_last_seen").on(t.brandId, t.lastSeen.desc()),
    index("ix_social_items_brand_platform").on(t.brandId, t.platform),
    index("ix_social_items_brand_published").on(t.brandId, t.publishedAt.desc()),
    index("ix_social_items_brand_risk").on(t.brandId, t.riskScore.desc()),
    index("ix_social_items_brand_relevant_level").on(t.brandId, t.relevant, t.riskLevel),
  ],
)
