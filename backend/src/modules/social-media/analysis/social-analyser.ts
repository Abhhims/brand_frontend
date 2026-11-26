/**
 * Analyses one collected social item for brand abuse.
 *
 *   1. official?   the brand's own account (official handle) or a URL on an official domain → not a finding
 *   2. relevant?   brand name in the text, a look-alike account name (common/relevance.ts), the official logo in the
 *                  thumbnail, or — for short / ambiguous brand names (D-25) — the short name together with scam
 *                  wording or contact details + scam wording (D-45: a phone number alone is not brand context)
 *   3. signals     brand_in_content, typo_similarity (accounts/channels only), social_image_match, scam contacts,
 *                  fake customer-care claim, scam wording, brand abuse, paid ad → score(…, "social_media") + tier
 *   4. confidence  common/confidence.ts; a web-search hit with no stored image stays a Candidate (D-33)
 *
 * The text part is pure (analyseText / buildAnalysis); SocialAnalyser adds the thumbnail: downloaded through the
 * safe fetcher (≤ 2 MB), compared with the official logos, and stored as PNG evidence when the item is relevant.
 */
import { createHash } from "node:crypto"
import sharp from "sharp"
import type { BrandContext } from "../../../common/brand-context.js"
import { brandTerms } from "../../../common/brand-context.js"
import { assess, type Confidence } from "../../../common/confidence.js"
import { literalBrandIn, relevance, strongTerms, type Relevance } from "../../../common/relevance.js"
import { score, scoreBreakdown, type ScoreResult, type Signals } from "../../../common/scoring.js"
import { socialHandle } from "../../../common/social-handle.js"
import { logger } from "../../../infra/logger.js"
import type { SafeFetcher } from "../../../integrations/http/safe-fetch.js"
import type { ObjectStorage } from "../../../integrations/storage/object-storage.js"
import type { LogoComparison, LogoMatcher, LogoTemplate } from "../../../integrations/vision/logo-matcher.js"
import {
  abusePhrases,
  contactDetails,
  dropOfficial,
  fakeSupportClaim,
  normalize,
  scamPhrases,
  SCORED_CONTACTS,
  strongPhrases,
  wrongDetailsPhrases,
  type Contacts,
} from "./text.js"

export const MAX_THUMBNAIL_BYTES = 2 * 1024 * 1024
export const TYPE_LABEL: Record<string, string> = { video: "video", post: "post", ad: "ad", channel: "channel", account: "account" }

/** What the analyser needs to know about an item (a social_items row has all of it) */
export interface AnalysableItem {
  key: string
  platform: string
  contentType: string
  url: string
  title: string
  text: string
  author: string | null
  authorHandle: string | null
  authorUrl: string | null
  authorId: string | null
  publishedAt: Date | null
  thumbnailUrl: string | null
  metrics: Record<string, unknown>
  discovery: string
  query: string | null
  raw: Record<string, unknown>
}

export type StoredEvidence = { kind: string; key: string; content_type: string; meta: Record<string, unknown> }

export interface TextFindings {
  official: boolean
  rel: Relevance
  contacts: Contacts
  scoredContacts: Contacts
  phrases: string[]
  titlePhrases: string[]
  /** short brand name + scam wording (or contacts + scam wording) in the same text (D-25 / D-45) */
  scamContext: boolean
  /** the strong brand name is in the text, or literally in the author name / title */
  brandNamed: boolean
}

export interface LogoResult {
  matched: boolean
  score: number | null
  comparison: (LogoComparison & { source: "thumbnail" }) | null
  evidence: StoredEvidence | null
}

export interface Analysis {
  relevant: boolean
  /** why it was not analysed further */
  skipped: "official" | null
  signals: Signals
  risk: ScoreResult
  confidence: Confidence
  details: Record<string, unknown>
  headline: string | null
  reasons: string[]
  evidence: StoredEvidence[]
  logoComparison: Record<string, unknown> | null
  /** Finding (analysed with evidence) or Candidate (search snippet only, D-33) */
  stage: "Finding" | "Candidate"
}

/** Came from a structured API (Apify) rather than a search-result snippet */
export const isStructured = (i: Pick<AnalysableItem, "discovery">) => !i.discovery.toLowerCase().startsWith("web search")

/** The brand's own account or content: official handle, or a URL on an official domain (legacy _official) */
export function isOfficialItem(ctx: BrandContext, i: Pick<AnalysableItem, "url" | "authorHandle" | "authorId" | "authorUrl" | "contentType">): boolean {
  let host = ""
  try {
    host = new URL(i.url).hostname.toLowerCase()
  } catch {
    /* not a URL */
  }
  host = host.replace(/^www\./, "")
  if (host && ctx.officialDomains.some((d) => host === d || host.endsWith(`.${d}`))) return true
  const names = new Set([i.authorHandle, i.authorId, i.authorUrl].filter((x): x is string => !!x).map((x) => socialHandle(x)))
  if (i.contentType === "channel" || i.contentType === "account") names.add(socialHandle(i.url))
  return ctx.officialHandles.some((h) => names.has(h))
}

/** Steps 1–2 without the image: who posted it, does it name the brand, which contacts and scam wording */
export function analyseText(ctx: BrandContext, item: AnalysableItem): TextFindings {
  const text = normalize([item.title, item.text, item.author ?? "", item.authorHandle ?? ""].filter(Boolean).join(" "))
  const rel = relevance(ctx, text, normalize(item.author || item.title))
  const contacts = dropOfficial(contactDetails(text), ctx.officialDomains, ctx.officialHandles)
  const phrases = scamPhrases(text)
  const scoredContacts = Object.fromEntries(Object.entries(contacts).filter(([k]) => (SCORED_CONTACTS as readonly string[]).includes(k))) as Contacts
  const strong = strongPhrases(phrases)
  const hasScored = Object.keys(scoredContacts).length > 0
  return {
    official: isOfficialItem(ctx, item),
    rel,
    contacts,
    scoredContacts,
    phrases,
    titlePhrases: scamPhrases(`${item.title} ${item.author ?? ""}`),
    scamContext: rel.weakHits.length > 0 && (strong.length > 0 || (hasScored && phrases.length > 0)),
    brandNamed: rel.strongHits.length > 0 || literalBrandIn(`${item.author ?? ""} ${item.title}`, strongTerms(ctx)),
  }
}

/** Worth a closer look (thumbnail stored) without the image: about the brand by its text */
export const textRelevant = (t: TextFindings) => !t.official && (t.rel.relevant || t.scamContext)

/** What was observed, as scoring signals (legacy social_signals) */
export function socialSignals(item: Pick<AnalysableItem, "contentType">, t: TextFindings, logoMatch: boolean): Signals {
  const isAccount = item.contentType === "channel" || item.contentType === "account"
  return {
    brand_in_content: t.brandNamed || t.rel.relevant,
    // name similarity only counts for accounts/channels (impersonation), not for a post that mentions the brand
    typo_similarity: isAccount ? t.rel.similarity || null : null,
    social_image_match: logoMatch,
    scam_contact_details: Object.keys(t.scoredContacts).length > 0,
    fake_support_claim: fakeSupportClaim(t.titlePhrases, t.phrases),
    scam_language: wrongDetailsPhrases(t.phrases).length > 0,
    brand_abuse: abusePhrases(t.phrases).length > 0,
    paid_ad: item.contentType === "ad",
  }
}

/** Short reasons, in the legacy headline order */
export function reasonsFor(s: Signals): string[] {
  return (
    [
      [s.scam_contact_details, "fake contact details"],
      [s.fake_support_claim, "fake customer care"],
      [s.scam_language, "scam wording"],
      [s.brand_abuse, "brand abuse"],
      [s.social_image_match, "official logo"],
    ] as const
  )
    .filter(([flag]) => !!flag)
    .map(([, label]) => label)
}

/** "Brand used in Instagram post (fake contact details, fake customer care)" (legacy headline_for) */
export function headlineFor(platform: string, contentType: string, s: Signals): string {
  const why = reasonsFor(s)
  return `Brand used in ${platform} ${TYPE_LABEL[contentType] ?? contentType}${why.length ? ` (${why.join(", ")})` : ""}`
}

const flatten = (c: Contacts) => Object.entries(c).flatMap(([k, vs]) => (vs ?? []).map((v) => `${k}: ${v}`))

/** Steps 3–4: signals, score, confidence and the legacy detail fields */
export function buildAnalysis(ctx: BrandContext, item: AnalysableItem, t: TextFindings, logo: LogoResult): Analysis {
  const structured = isStructured(item)
  const evidence = logo.evidence ? [logo.evidence] : []
  if (t.official) {
    const risk = score({}, "social_media")
    return {
      relevant: false,
      skipped: "official",
      signals: {},
      risk,
      confidence: assess("social_media", [], {}, { analysed: false, captured: false }),
      details: { Official: true, "Skipped Because": "Official brand account or content (official handle / domain)" },
      headline: null,
      reasons: [],
      evidence: [],
      logoComparison: null,
      stage: "Candidate",
    }
  }
  const relevant = t.rel.relevant || logo.matched || t.scamContext
  const signals = socialSignals(item, t, logo.matched)
  const risk = score(signals, "social_media")
  const analysed = structured || evidence.length > 0 // D-33: an uncaptured search hit stays a Candidate
  const label = TYPE_LABEL[item.contentType] ?? item.contentType
  const { Views, Likes, Comments, ...otherMetrics } = item.metrics
  const details: Record<string, unknown> = {
    Platform: item.platform,
    "Content Type": label.charAt(0).toUpperCase() + label.slice(1),
    Title: item.title.slice(0, 300),
    Author: item.author,
    "Author URL": item.authorUrl,
    URL: item.url,
    Published: item.publishedAt ? item.publishedAt.toISOString() : null,
    Views: Views ?? null,
    Likes: Likes ?? null,
    Comments: Comments ?? null,
    ...Object.fromEntries(Object.entries(otherMetrics).filter(([, v]) => v !== null && v !== undefined)),
    "Brand Terms": t.rel.termsUsed,
    "Name Similarity": t.rel.similarity ? Math.round(t.rel.similarity) : null,
    "Logo Match": logo.matched,
    "Logo Match Score": logo.score ? Math.round(logo.score) : null,
    "Scam Contacts": flatten(t.scoredContacts),
    "Other Links": flatten(Object.fromEntries(Object.entries(t.contacts).filter(([k]) => !(SCORED_CONTACTS as readonly string[]).includes(k))) as Contacts),
    Contacts: t.contacts,
    "Scam Phrases": t.phrases,
    "Text Excerpt": item.text.slice(0, 500),
    "Thumbnail URL": item.thumbnailUrl,
    Screenshot: false,
    "Discovery Source": item.discovery,
    "Found By Search": item.query,
    "Structured Data": structured,
    Stage: analysed ? "Finding" : "Candidate",
    ...(item.raw.tags ? { Tags: item.raw.tags } : {}),
  }
  const confidence = assess("social_media", risk.fired, details, { analysed, captured: evidence.length > 0 })
  details.Risk = scoreBreakdown(risk)
  return {
    relevant,
    skipped: null,
    signals,
    risk: relevant ? risk : { ...risk, score: 0, level: "Low" },
    confidence,
    details,
    headline: relevant ? headlineFor(item.platform, item.contentType, signals) : null,
    reasons: relevant ? reasonsFor(signals) : [],
    evidence: relevant ? evidence : [],
    logoComparison: logo.comparison as Record<string, unknown> | null,
    stage: analysed ? "Finding" : "Candidate",
  }
}

const NO_LOGO: LogoResult = { matched: false, score: null, comparison: null, evidence: null }

export interface ImageStats {
  downloaded: number
  failed: number
  compared: number
  matched: number
  stored: number
}

/** Adds the image side (download, logo comparison, evidence) to the pure analysis */
export class SocialAnalyser {
  constructor(
    private readonly fetcher: Pick<SafeFetcher, "fetch">,
    private readonly storage: Pick<ObjectStorage, "put">,
    private readonly matcher: LogoMatcher | null,
  ) {}

  /**
   * Analyse one item. `templates` = the brand's prepared official logos ([] = no logo comparison). The thumbnail is
   * downloaded when the item is relevant by its text (to keep a copy) or when there are logos to compare it with.
   */
  async analyse(ctx: BrandContext, item: AnalysableItem, templates: LogoTemplate[], stats?: ImageStats): Promise<Analysis> {
    const t = analyseText(ctx, item)
    if (t.official) return buildAnalysis(ctx, item, t, NO_LOGO)
    const wantImage = !!item.thumbnailUrl && (textRelevant(t) || (templates.length > 0 && !!this.matcher))
    const logo = wantImage ? await this.checkThumbnail(ctx, item, templates, textRelevant(t), stats) : NO_LOGO
    return buildAnalysis(ctx, item, t, logo)
  }

  private async checkThumbnail(ctx: BrandContext, item: AnalysableItem, templates: LogoTemplate[], keep: boolean, stats?: ImageStats): Promise<LogoResult> {
    const url = item.thumbnailUrl!
    let bytes: Buffer
    try {
      const r = await this.fetcher.fetch(url, { maxBytes: MAX_THUMBNAIL_BYTES, timeoutMs: 15_000, headers: { accept: "image/*" } })
      if (r.status !== 200 || !r.body.length) throw new Error(`HTTP ${r.status}`)
      bytes = r.body
      if (stats) stats.downloaded++
    } catch (err) {
      if (stats) stats.failed++
      logger.debug({ url, err: (err as Error).message }, "thumbnail not downloaded")
      return NO_LOGO
    }
    // a real PNG whatever the platform served (WebP, JPEG, HEIC…): the UI shows it next to the official logo
    const png = await sharp(bytes, { density: 144 }).rotate().resize(1400, 1400, { fit: "inside", withoutEnlargement: true }).png().toBuffer().catch(() => null)
    if (!png) {
      if (stats) stats.failed++
      return NO_LOGO
    }
    let comparison: LogoComparison | null = null
    if (this.matcher && templates.length) {
      try {
        comparison = await this.matcher.compare(templates, png, [ctx.name, ...brandTerms(ctx)])
        if (stats) stats.compared++
        if (comparison.matched && stats) stats.matched++
      } catch (err) {
        logger.warn({ url, err: (err as Error).message }, "logo comparison failed")
      }
    }
    const matched = comparison?.matched === true
    let evidence: StoredEvidence | null = null
    if (keep || matched) {
      const hash = (b: Buffer | string) => createHash("sha256").update(b).digest("hex").slice(0, 16)
      const key = `evidence/${ctx.id}/social/${hash(item.key)}/thumbnail-${hash(png)}.png`
      try {
        await this.storage.put(key, png, "image/png")
        const size = await sharp(png).metadata()
        evidence = {
          kind: "image",
          key,
          content_type: "image/png",
          meta: { url, role: "thumbnail", matched, logo_match_score: comparison?.score ?? null, image_size: [size.width ?? 0, size.height ?? 0] },
        }
        if (stats) stats.stored++
      } catch (err) {
        logger.warn({ err, key }, "could not store thumbnail")
      }
    }
    return { matched, score: comparison?.score ?? null, comparison: comparison ? { ...comparison, source: "thumbnail" } : null, evidence }
  }
}
