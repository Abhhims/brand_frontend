/**
 * Detection result tables for the first Node versions of the phishing-website and email modules.
 *
 *   phishing_domains        one row per (brand, look-alike domain): latest DNS / website / email-record / intel facts
 *   email_posture_checks    one row per check of a brand domain's email security (SPF, DMARC, DKIM, MTA-STS)
 *   email_messages          one row per analysed suspicious email (.eml upload), deduplicated per brand
 *
 * These hold module output. Turning them into scored findings and alerts happens when the findings model is
 * ported (docs/port §4); until then the `suspected` / `verdict` fields are the module's own judgement.
 */
import { boolean, doublePrecision, index, integer, jsonb, pgTable, text, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core"
import { createdAt, id, tstz } from "./columns.js"
import { brands } from "./core.js"
import { scanRuns } from "./scans.js"

export const phishingDomains = pgTable(
  "phishing_domains",
  {
    id: id(),
    brandId: uuid()
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    /** the scan that last checked it (null for one-off checks) */
    scanRunId: uuid().references(() => scanRuns.id, { onDelete: "set null" }),
    domain: varchar({ length: 253 }).notNull(),
    /** how it was found: a typo pattern (omission, homoglyph…) or a source (certificate-transparency, phishing-feed, manual) */
    source: varchar({ length: 40 }).notNull(),
    /** registered | nxdomain | unknown */
    dnsStatus: varchar({ length: 12 }).notNull(),
    a: jsonb().$type<string[]>().notNull().default([]),
    mx: jsonb().$type<string[]>().notNull().default([]),
    ns: jsonb().$type<string[]>().notNull().default([]),
    /** 0–100 against the closest brand term */
    similarity: doublePrecision().notNull().default(0),
    closestTerm: varchar({ length: 200 }),
    /** website answered (any HTTP status) */
    live: boolean(),
    httpStatus: integer(),
    finalUrl: text(),
    pageTitle: text(),
    /** facts about the page, SPF/DMARC, intel hits — see PhishingDomainDto.details */
    details: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    /** yes/no facts used for the verdict — see PhishingDomainDto.signals */
    signals: jsonb().$type<Record<string, boolean | number | null>>().notNull().default({}),
    /** looks like an active phishing site for this brand */
    suspected: boolean().notNull().default(false),
    /** short human label, e.g. "Suspected phishing website" */
    verdict: varchar({ length: 60 }).notNull(),
    /** phishing (live site) | mx (mail only) | typosquat (registered, nothing else) */
    stage: varchar({ length: 12 }).notNull().default("typosquat"),
    /** 0–100 risk score and level from common/scoring.ts (same rules as the legacy backend) */
    riskScore: integer().notNull().default(0),
    riskLevel: varchar({ length: 10 }).notNull().default("Low"),
    /** {risk: score breakdown (rules, cap, policy), confidence: {score, level, factors}} */
    scoring: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    confidence: integer().notNull().default(0),
    confidenceLevel: varchar({ length: 10 }).notNull().default("Low"),
    /** fraud themes seen on the page or in the name (jobs, education, rewards_lottery…) */
    fraudThemes: jsonb().$type<string[]>().notNull().default([]),
    /** stored evidence in object storage: [{kind, key, content_type, meta}] */
    evidence: jsonb().$type<{ kind: string; key: string; content_type: string; meta: Record<string, unknown> }[]>().notNull().default([]),
    /** analyst decision: New | Investigating | Confirmed Threat | False Positive | Legitimate | Ignored | Resolved */
    reviewStatus: varchar({ length: 20 }).notNull().default("New"),
    reviewNote: text(),
    reviewedAt: tstz(),
    reviewedBy: varchar({ length: 320 }),

    firstSeen: tstz().notNull().defaultNow(),
    lastChecked: tstz().notNull().defaultNow(),
    timesChecked: integer().notNull().default(1),
  },
  (t) => [
    uniqueIndex("uq_phishing_domains_brand_domain").on(t.brandId, t.domain),
    index("ix_phishing_domains_brand_checked").on(t.brandId, t.lastChecked.desc()),
    index("ix_phishing_domains_suspected").on(t.brandId, t.suspected),
    index("ix_phishing_domains_risk").on(t.brandId, t.riskScore.desc()),
    index("ix_phishing_domains_first_seen").on(t.firstSeen.desc()),
  ],
)

export const emailPostureChecks = pgTable(
  "email_posture_checks",
  {
    id: id(),
    brandId: uuid().references(() => brands.id, { onDelete: "cascade" }),
    domain: varchar({ length: 253 }).notNull(),
    /** good | issues | error */
    status: varchar({ length: 10 }).notNull(),
    /** one entry per problem, e.g. {code: "dmarc_none", message: "…"} */
    issues: jsonb().$type<{ code: string; severity: "high" | "medium" | "low"; message: string }[]>().notNull().default([]),
    /** raw findings: records found, policies, selectors */
    result: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    /** 0–100 risk score and level from common/scoring.ts (same rules as the legacy backend) */
    riskScore: integer().notNull().default(0),
    riskLevel: varchar({ length: 10 }).notNull().default("Low"),
    /** {risk: score breakdown (rules, cap, policy), confidence: {score, level, factors}} */
    scoring: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    checkedAt: createdAt(),
  },
  (t) => [index("ix_email_posture_brand_domain").on(t.brandId, t.domain, t.checkedAt.desc())],
)

export const emailMessages = pgTable(
  "email_messages",
  {
    id: id(),
    brandId: uuid()
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    /** Message-ID, else sha256 of the raw message — the same email uploaded twice updates one row */
    fingerprint: varchar({ length: 500 }).notNull(),
    sha256: varchar({ length: 64 }).notNull(),
    /** raw .eml in object storage */
    storageKey: text(),
    /** upload (mailbox intake later) */
    channel: varchar({ length: 20 }).notNull().default("upload"),
    subject: text().notNull().default(""),
    fromAddress: varchar({ length: 320 }),
    fromDomain: varchar({ length: 253 }),
    replyTo: varchar({ length: 320 }),
    returnPath: varchar({ length: 320 }),
    senderIp: varchar({ length: 64 }),
    receivedAt: tstz(),
    /** SPF / DKIM / DMARC from Authentication-Results, plus our own DMARC lookup */
    auth: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    urls: jsonb().$type<Record<string, unknown>[]>().notNull().default([]),
    attachments: jsonb().$type<Record<string, unknown>[]>().notNull().default([]),
    signals: jsonb().$type<Record<string, boolean>>().notNull().default({}),
    details: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    /** Likely phishing | Suspicious | Low risk */
    verdict: varchar({ length: 20 }).notNull(),
    /** 0–100 risk score and level from common/scoring.ts (same rules as the legacy backend) */
    riskScore: integer().notNull().default(0),
    riskLevel: varchar({ length: 10 }).notNull().default("Low"),
    /** {risk: score breakdown (rules, cap, policy), confidence: {score, level, factors}} */
    scoring: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    /** analyst decision: New | Investigating | Confirmed Threat | False Positive | Legitimate | Ignored | Resolved */
    reviewStatus: varchar({ length: 20 }).notNull().default("New"),
    reviewNote: text(),
    reviewedAt: tstz(),
    reviewedBy: varchar({ length: 320 }),
    analysedAt: tstz().notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("uq_email_messages_brand_fingerprint").on(t.brandId, t.fingerprint),
    index("ix_email_messages_brand_created").on(t.brandId, t.createdAt.desc()),
  ],
)
