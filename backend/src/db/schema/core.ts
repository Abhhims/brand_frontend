/**
 * Foundation tables: users, brands and what belongs to a brand, platform settings.
 * Ported from the legacy schema (docs/port/PYTHON-BACKEND-REFERENCE.md §1.2). Detection tables
 * (scan_runs, findings, alerts, evidence, …) are added as each module is ported.
 */
import { sql } from "drizzle-orm"
import { boolean, index, integer, jsonb, pgTable, text, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core"
import { createdAt, id, tstz } from "./columns.js"
import { allowKindEnum, assetKindEnum, riskLevelEnum, roleEnum } from "./enums.js"

export const users = pgTable(
  "users",
  {
    id: id(),
    /** stored lower-case */
    email: varchar({ length: 320 }).notNull(),
    name: varchar({ length: 200 }).notNull(),
    /** argon2id PHC string; compatible with hashes from the legacy backend */
    passwordHash: varchar({ length: 255 }).notNull(),
    role: roleEnum().notNull().default("analyst"),
    isActive: boolean().notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("ix_users_email").on(t.email)],
)

export const brands = pgTable("brands", {
  id: id(),
  name: varchar({ length: 200 }).notNull().unique(),
  description: text(),
  keywords: varchar().array().notNull().default(sql`'{}'::varchar[]`),
  productTerms: varchar().array().notNull().default(sql`'{}'::varchar[]`),
  isActive: boolean().notNull().default(true),
  /** Findings below this level are kept but do not raise alerts */
  alertMinLevel: riskLevelEnum().notNull().default("Medium"),
  autoScanEnabled: boolean().notNull().default(false),
  /** daily | every_3_days | weekly */
  autoScanFrequency: varchar({ length: 20 }).notNull().default("daily"),
  /** empty = every runner */
  autoScanRunners: varchar().array().notNull().default(sql`'{}'::varchar[]`),
  lastAutoScanAt: tstz(),
  createdAt: createdAt(),
})

/** Official images (logo, favicon, app icon) used to recognise copies */
export const brandAssets = pgTable(
  "brand_assets",
  {
    id: id(),
    brandId: uuid()
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    kind: assetKindEnum().notNull(),
    filename: varchar({ length: 255 }).notNull(),
    /** brands/{brand_id}/{kind}/{hex}-{filename} in object storage */
    storageKey: varchar({ length: 500 }).notNull(),
    contentType: varchar({ length: 100 }).notNull(),
    sha256: varchar({ length: 64 }).notNull(),
    phash: varchar({ length: 64 }),
    dhash: varchar({ length: 64 }),
    /** favicon only: Shodan-style favicon hash (signed 32-bit) */
    mmh3: integer(),
    createdAt: createdAt(),
  },
  (t) => [index("ix_brand_assets_brand_id").on(t.brandId)],
)

/**
 * The brand's official login pages: captured by the sandboxed browser worker (screenshot + page fingerprint + form
 * signature) so suspicious sites can be compared with them (copied-login-page detection).
 */
export const brandLoginPages = pgTable(
  "brand_login_pages",
  {
    id: id(),
    brandId: uuid()
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    url: text().notNull(),
    /** pending | ready | failed */
    status: varchar({ length: 20 }).notNull().default("pending"),
    title: text(),
    screenshotKey: varchar({ length: 500 }),
    /** layout fingerprint + OCR words (integrations/vision/page-similarity PageFingerprint) */
    fingerprint: jsonb().$type<Record<string, unknown> | null>(),
    /** form signature (phishing-sites/login-form FormSignature) */
    form: jsonb().$type<Record<string, unknown> | null>(),
    error: text(),
    capturedAt: tstz(),
    createdAt: createdAt(),
  },
  (t) => [index("ix_brand_login_pages_brand_id").on(t.brandId), uniqueIndex("uq_brand_login_pages_brand_url").on(t.brandId, t.url)],
)

/** Official domains, packages, handles… that must never be reported as threats */
export const brandAllowlist = pgTable(
  "brand_allowlist",
  {
    id: id(),
    brandId: uuid()
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    kind: allowKindEnum().notNull(),
    /** normalised before insert */
    value: varchar({ length: 500 }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("uq_brand_allowlist_brand_kind_value").on(t.brandId, t.kind, t.value),
    index("ix_brand_allowlist_brand_id").on(t.brandId),
  ],
)

/** Platform-wide key/value settings (e.g. auto_scan = {"enabled": true}) */
export const appSettings = pgTable("app_settings", {
  key: varchar({ length: 100 }).primaryKey(),
  value: jsonb().notNull(),
  updatedAt: tstz().notNull().defaultNow(),
  updatedBy: uuid().references(() => users.id, { onDelete: "set null" }),
})
