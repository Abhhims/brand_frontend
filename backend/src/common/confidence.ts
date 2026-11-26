/**
 * Confidence (CONFIDENCE_POLICY "2026-10-16", docs/port §3.2).
 *
 * Risk says how bad it would be; confidence says how good the evidence is:
 *   - independent kinds of evidence (name, page content, contact details, visuals, identity, threat intel) agree
 *   - it was observed directly (page fetched) rather than read from a search snippet
 *   - nothing that should have been checked is unknown
 *   - nothing contradicts it (parked page, live page about something else)
 * Every point is a named factor with a reason, kept with the result.
 */
import type { RuleName, ScoredModule } from "./scoring.js"

export const CONFIDENCE_POLICY = "2026-10-16"
const BASE = 20

const FAMILIES: Record<string, [number, string, RuleName[]]> = {
  content: [
    15,
    "The content itself shows abuse (login/payment form, scam or support wording, sensitive data)",
    ["login_payment_keywords", "scam_language", "fake_support_claim", "brand_abuse", "credential_or_payment_language", "doc_sensitive_pattern", "doc_many_emails"],
  ],
  contact: [15, "Contact details published next to the brand (phone, WhatsApp, Telegram, UPI)", ["scam_contact_details"]],
  visual: [15, "Official logo or favicon matched", ["official_logo", "social_image_match", "login_page_clone"]],
  identity: [15, "Publisher / sender / signer is not the brand's (verified against official values)", ["publisher_mismatch", "lookalike_sender", "auth_fail_brand_from"]],
  infrastructure: [5, "Infrastructure is ready for abuse (mail server, TLS, SPF, young domain)", ["mx_present", "https", "lookalike_can_send", "young_domain", "bad_sender_ip", "reply_to_mismatch"]],
}
const NAME_RULES: RuleName[] = ["brand_exact_in_domain", "typo_similarity_gt_80", "brand_in_content", "doc_brand_keyword", "brand_impersonation", "doc_official_domain"]
const POSTURE_MODULES: ScoredModule[] = ["email_posture", "dmarc"]
const DOMAIN_MODULES: ScoredModule[] = ["typosquat", "mx", "phishing", "logo"]

export interface Factor {
  factor: string
  points: number
  why: string
}
export interface Confidence {
  score: number
  level: "Low" | "Medium" | "High"
  policy: string
  factors: Factor[]
}

export const confidenceLevel = (v: number): Confidence["level"] => (v >= 70 ? "High" : v >= 40 ? "Medium" : "Low")

/**
 * `fired` = scoring rules that fired; `details` = the result's output fields (legacy names: "Website Live",
 * "Registrar", "Threat Intel", "Not Checked", "Discovery Source", "Parked Page", "Brand Evidence On Page");
 * `analysed` = analysed with evidence (not just discovered); `captured` = page/image evidence stored;
 * `links` = other results sharing a strong identifier.
 */
export function assess(
  module: ScoredModule,
  fired: RuleName[],
  details: Record<string, unknown>,
  opts: { analysed: boolean; captured: boolean; links?: number },
): Confidence {
  const f = new Set(fired)
  const out: Factor[] = []
  const add = (factor: string, points: number, why: string) => out.push({ factor, points, why })
  const notChecked = details["Not Checked"]

  if (POSTURE_MODULES.includes(module)) {
    add("direct_observation", 70, "Read directly from the domain's DNS records / DMARC reports")
    if (Array.isArray(notChecked) && notChecked.length) add("not_checked", -10, `Not checked: ${notChecked.join(", ")}`)
    return result(out)
  }

  add("base", BASE, "Detected by an automated check")
  let families = 0
  for (const [name, [points, why, rules]] of Object.entries(FAMILIES)) {
    if (rules.some((r) => f.has(r))) {
      add(name, points, why)
      if (points >= 15) families++
    }
  }
  if (f.has("known_malicious_url") || f.has("malware_attachment")) {
    add("threat_intel", 30, "Listed as malicious by two or more independent threat-intelligence sources")
    families++
  } else if (["single_source_url_hit", "rspamd_phish", "live_phishing_page", "suspicious_attachment"].some((r) => f.has(r as RuleName))) {
    add("threat_intel_single", 10, "One threat-intelligence source or engine flags it (not corroborated)")
  }
  if (families === 0 && NAME_RULES.some((r) => f.has(r))) add("name_only", -10, "Only the name matches; nothing else ties it to abuse of the brand")
  if (families >= 2) add("corroborated", 10, `${families} independent kinds of evidence agree`)
  const links = opts.links ?? 0
  if (links) add("correlated", 10, `Shares a certificate, signer, contact or server with ${links} other finding${links > 1 ? "s" : ""} (same operator likely)`)

  add(opts.analysed ? "observed" : "candidate", opts.analysed ? 10 : -10, opts.analysed ? "Analysed with evidence (Finding)" : "Discovered only, not analysed yet (Candidate)")
  if (opts.captured) add("captured", 10, "Evidence captured directly (page, favicon or matched image)")

  if (details["Website Live"] === "unknown (capture failed)") add("capture_failed", -10, "Website could not be captured; page content unknown")
  if (details["Registrar"] === "lookup failed") add("whois_failed", -5, "Registration (WHOIS/RDAP) lookup failed")
  const intel = String(details["Threat Intel"] ?? "")
  if (DOMAIN_MODULES.includes(module) && (intel === "Not checked" || intel.includes("not checked:"))) add("intel_partial", -5, `Threat intelligence incomplete: ${intel}`)
  if (Array.isArray(notChecked) && notChecked.length) add("not_checked", -10, `Not checked: ${notChecked.join(", ")}`)
  if (String(details["Discovery Source"] ?? "").toLowerCase().startsWith("web search")) add("snippet_only", -10, "Found through a search-result snippet, not platform data")

  if (details["Parked Page"] === true) add("parked", -20, "Parked / for-sale page: no active abuse seen")
  if (details["Website Live"] === true && details["Brand Evidence On Page"] === false && details["Parked Page"] !== true)
    add("no_brand_on_page", -15, "The live page shows no brand content")
  return result(out)
}

function result(factors: Factor[]): Confidence {
  const value = Math.max(0, Math.min(100, factors.reduce((a, x) => a + x.points, 0)))
  return { score: value, level: confidenceLevel(value), policy: CONFIDENCE_POLICY, factors }
}
