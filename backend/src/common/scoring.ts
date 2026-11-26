/**
 * Risk scoring (SCORING_POLICY "2026-10-16", docs/port §3.1).
 *
 * One pure function. Modules describe WHAT THEY OBSERVED as Signals; this module alone decides the points, the
 * 0–100 score and the risk level.
 *
 *   score = min(100, Σ points of the rules that fired)
 *   → clamped into the module's allowed level range (the number moves with it, so score and level never disagree)
 *   → for look-alike domain modules, capped when the evidence is weak (D-29): a name match alone is never Critical
 *   levels: 0–29 Low · 30–59 Medium · 60–79 High · 80–100 Critical
 */

export type RiskLevel = "Low" | "Medium" | "High" | "Critical"
export type ScoredModule =
  | "typosquat"
  | "mx"
  | "phishing"
  | "apk"
  | "rogue_app"
  | "logo"
  | "social"
  | "documents"
  | "email"
  | "email_posture"
  | "dmarc"
  | "social_media"

/** (rule, points) — the order is the order rules are reported in */
export const RULE_POINTS = {
  brand_exact_in_domain: 40, // RSK-01
  typo_similarity_gt_80: 25, // RSK-02 (strictly > 80, D-05)
  mx_present: 15, // RSK-03
  https: 10, // RSK-04
  login_payment_keywords: 20, // RSK-05
  official_logo: 30, // RSK-06
  login_page_clone: 30, // Node addition: copy of the brand's official login page (layout pHash + OCR text + form fields)
  social_image_match: 20, // RSK-07
  publisher_mismatch: 25, // RSK-08
  doc_brand_keyword: 30,
  doc_official_domain: 20,
  doc_sensitive_pattern: 30,
  doc_many_emails: 20,
  brand_in_content: 20,
  scam_contact_details: 30,
  scam_language: 20,
  paid_ad: 10,
  fake_support_claim: 30,
  brand_abuse: 15,
  known_malicious_url: 40,
  single_source_url_hit: 15,
  malware_attachment: 40,
  suspicious_attachment: 20,
  auth_fail_brand_from: 30,
  lookalike_sender: 25,
  brand_impersonation: 20,
  reply_to_mismatch: 10,
  credential_or_payment_language: 15,
  young_domain: 10,
  bad_sender_ip: 10,
  rspamd_phish: 10,
  live_phishing_page: 20,
  lookalike_can_send: 10,
  posture_dmarc_missing: 40,
  posture_dmarc_none: 20,
  posture_spf_missing: 40,
  posture_spf_softfail: 10,
  posture_dkim_missing: 10,
  posture_mta_sts_missing: 5,
} as const
export type RuleName = keyof typeof RULE_POINTS

export const TYPO_SIMILARITY_THRESHOLD = 80
export const MAX_SCORE = 100
export const SCORING_POLICY = "2026-10-16"

/** D-29/D-45: highest score allowed when the evidence is weak (look-alike domain modules only) */
export const SCORE_CAPS = { parked_page: 29, no_brand_evidence: 29, no_brand_login_form: 59, no_website: 79 } as const
export type CapName = keyof typeof SCORE_CAPS
export const CAP_REASONS: Record<CapName, string> = {
  parked_page: "Parked / for-sale page — capped at Low",
  no_brand_evidence: "No brand content on the page (logo, favicon, brand name or official-site link) — capped at Low",
  no_brand_login_form: "Login/payment form but no brand content on the page — capped at Medium",
  no_website: "No website seen, so no brand content or phishing behaviour observed — capped at High",
}
const CAPPED_MODULES: ScoredModule[] = ["typosquat", "mx", "phishing"]

export const LEVEL_RANGE: Record<RiskLevel, [number, number]> = { Low: [0, 29], Medium: [30, 59], High: [60, 79], Critical: [80, 100] }

/** Levels each module may report (D-03) */
export const MODULE_LEVELS: Record<ScoredModule, [RiskLevel, RiskLevel]> = {
  typosquat: ["Low", "Critical"],
  mx: ["Low", "Critical"],
  phishing: ["Low", "Critical"],
  apk: ["Medium", "High"],
  rogue_app: ["Medium", "High"],
  logo: ["Medium", "High"],
  social: ["Low", "High"],
  documents: ["Medium", "Critical"],
  email: ["Low", "Critical"],
  email_posture: ["Low", "Critical"],
  dmarc: ["Low", "Critical"],
  social_media: ["Low", "Critical"],
}

export const SOCIAL_REASONS = {
  critical: "Contact details published as the brand's customer care / helpline, or with scam wording",
  high: "Customer-care claim without a visible number (check the video), wrong-details scam wording, or brand abuse with the official logo / look-alike name",
  medium: "Contact details without support wording, brand abuse (earning or referral bait, cashback lure, unofficial APK), logo use or ad",
  low: "Informative content (how-to, news, review)",
} as const
type Tier = keyof typeof SOCIAL_REASONS
const TIER_LEVEL: Record<Tier, RiskLevel> = { critical: "Critical", high: "High", medium: "Medium", low: "Low" }

/** What a module observed. Booleans default to false; typo_similarity null = not measured. */
export type Signals = Partial<Record<Exclude<RuleName, "typo_similarity_gt_80">, boolean>> & {
  typo_similarity?: number | null
  /** D-29 context for live look-alike websites (no points) */
  page_live?: boolean
  brand_on_page?: boolean
  parked_page?: boolean
}

export interface ScoreResult {
  score: number
  level: RiskLevel
  fired: RuleName[]
  /** before the module clamp and caps, for transparency */
  raw_score: number
  /** D-29 cap that lowered the score, if any */
  cap: CapName | null
  tier: Tier | null
}

export function levelFor(value: number): RiskLevel {
  if (value >= 80) return "Critical"
  if (value >= 60) return "High"
  if (value >= 30) return "Medium"
  return "Low"
}

export function firedRules(s: Signals): RuleName[] {
  return (Object.keys(RULE_POINTS) as RuleName[]).filter((name) =>
    name === "typo_similarity_gt_80" ? s.typo_similarity != null && s.typo_similarity > TYPO_SIMILARITY_THRESHOLD : !!s[name],
  )
}

function capFor(s: Signals, module: ScoredModule): CapName | null {
  if (!CAPPED_MODULES.includes(module)) return null
  if (s.parked_page && s.page_live) return "parked_page"
  if (s.known_malicious_url) return null // D-46: ≥ 2 independent listings are observed malicious behaviour
  if (!s.page_live) return "no_website"
  if (!s.brand_on_page) return s.login_payment_keywords ? "no_brand_login_form" : "no_brand_evidence"
  return null
}

export function socialTier(s: Signals): Tier {
  const lookalike = s.typo_similarity != null && s.typo_similarity > TYPO_SIMILARITY_THRESHOLD
  if (s.scam_contact_details && (s.fake_support_claim || s.scam_language)) return "critical"
  if (s.fake_support_claim || s.scam_language || (s.brand_abuse && (s.social_image_match || lookalike))) return "high"
  if (s.scam_contact_details || s.brand_abuse || s.social_image_match || s.paid_ad || lookalike) return "medium"
  return "low"
}

export function score(signals: Signals, module: ScoredModule): ScoreResult {
  const fired = firedRules(signals)
  const raw = Math.min(MAX_SCORE, fired.reduce((a, n) => a + RULE_POINTS[n], 0))
  const [lowest, highest] = MODULE_LEVELS[module]
  let value = Math.min(Math.max(raw, LEVEL_RANGE[lowest][0]), LEVEL_RANGE[highest][1])

  let cap = capFor(signals, module)
  if (cap && value > SCORE_CAPS[cap]) value = SCORE_CAPS[cap]
  else cap = null // only report a cap that actually lowered the score

  let tier: Tier | null = null
  if (module === "social_media") {
    tier = socialTier(signals)
    const [lo, hi] = LEVEL_RANGE[TIER_LEVEL[tier]]
    value = Math.min(Math.max(value, lo), hi)
  }
  return { score: value, level: levelFor(value), fired, raw_score: raw, cap, tier }
}

/** Stored with every result so it can be reproduced and explained later (D-45) */
export function scoreBreakdown(r: ScoreResult) {
  return {
    score: r.score,
    level: r.level,
    raw_score: r.raw_score,
    cap: r.cap,
    cap_reason: r.cap ? CAP_REASONS[r.cap] : null,
    policy: SCORING_POLICY,
    ...(r.tier ? { tier: r.tier } : {}),
    rules: Object.fromEntries(r.fired.map((n) => [n, RULE_POINTS[n]])) as Record<string, number>,
  }
}

/** §3.1 MX tiers, reported as a separate "Email Risk" field (MX-04) */
export function emailRisk(mxPresent: boolean, websiteLive: boolean): RiskLevel {
  if (mxPresent && websiteLive) return "High"
  if (mxPresent) return "Medium"
  return "Low"
}
