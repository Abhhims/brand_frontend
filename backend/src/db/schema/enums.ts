/** Postgres enum types. Values and spelling match the legacy schema exactly (docs/port §1.1). */
import { pgEnum } from "drizzle-orm/pg-core"

export const roleEnum = pgEnum("role", ["admin", "analyst"])

export const moduleNameEnum = pgEnum("module_name", [
  "typosquat",
  "mx",
  "phishing",
  "apk",
  "rogue_app",
  "social",
  "documents",
  "logo",
  "email",
  "email_posture",
  "dmarc",
  "social_media",
])

/** Compare levels in code with RISK_ORDER, never with Postgres enum ordering */
export const riskLevelEnum = pgEnum("risk_level", ["Low", "Medium", "High", "Critical"])
export const RISK_ORDER = ["Low", "Medium", "High", "Critical"] as const

export const findingDecisionEnum = pgEnum("finding_decision", [
  "New",
  "Investigating",
  "Confirmed Threat",
  "False Positive",
  "Legitimate",
  "Ignored",
  "Resolved",
])

export const findingStageEnum = pgEnum("finding_stage", ["Candidate", "Finding"])
export const assetKindEnum = pgEnum("asset_kind", ["logo", "favicon", "app_icon"])
export const allowKindEnum = pgEnum("allow_kind", ["domain", "package", "publisher", "social_handle", "email_domain", "signing_cert"])

export const scanStatusEnum = pgEnum("scan_status", [
  "queued",
  "running",
  "completed",
  "partially_completed",
  "completed_with_errors",
  "failed",
  "cancelled",
])

export const evidenceKindEnum = pgEnum("evidence_kind", ["screenshot", "favicon", "html", "metadata", "file", "ssl", "whois", "dns", "image"])
