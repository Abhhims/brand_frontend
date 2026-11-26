/**
 * Does a piece of text refer to the brand? Strong terms, weak terms,
 * context words and relevance (D-25), literal brand match (D-20). Shared by every module that reads
 * free text (social media now; apps, APKs and documents later).
 *
 *   strong terms   brand words/phrases with 6+ letters once spaces are removed: count on their own
 *   weak terms     short abbreviations ("KCPL", "Navi"): an exact word, and only together with a context word
 *   context words  4+ letter words from the brand name / keywords ("Kodachadri Chits Private Limited" → kodachadri,
 *                  chits) that confirm a short abbreviation means this brand; company words never count
 *
 * A look-alike of a long name (8+ letters) stands on its own; of a 6–7 letter name it needs context, since one
 * letter is already ~15 % of the name.
 */
import { brandTerms, type BrandContext } from "./brand-context.js"
import { bestSimilarity, brandTermsInText } from "./similarity.js"

export const STRONG_TERM_LEN = 6
export const FUZZY_ALONE_LEN = 8
export const COMPANY_WORDS = new Set([
  "private", "limited", "public", "company", "group", "india", "global", "services", "service", "solutions", "technologies",
  "technology", "official", "agent", "the", "and", "corp", "corporation", "enterprises", "holdings", "international", "bank",
])

const flat = (t: string) => t.toLowerCase().replace(/[^a-z0-9]/g, "")
const unique = <T>(xs: T[]) => [...new Set(xs)]

export interface Relevance {
  strongHits: string[]
  weakHits: string[]
  contextHits: string[]
  /** best name similarity (0–100) of the item's name to a strong term */
  similarity: number
  relevant: boolean
  /** strong + weak hits, de-duplicated */
  termsUsed: string[]
}

const allTerms = (ctx: BrandContext) => [...brandTerms(ctx), ...ctx.productTerms]

/** Distinctive brand words/phrases (6+ letters once spaces are removed); all terms when none is that long */
export function strongTerms(ctx: BrandContext): string[] {
  const strong = allTerms(ctx).filter((t) => flat(t).length >= STRONG_TERM_LEN)
  return strong.length ? strong : brandTerms(ctx)
}

/** Short abbreviations: only count as an exact word, and only together with context */
export function weakTerms(ctx: BrandContext): string[] {
  return allTerms(ctx).filter((t) => flat(t).length < STRONG_TERM_LEN)
}

/** Words from the brand name/keywords that confirm a short abbreviation refers to this brand */
export function contextWords(ctx: BrandContext): string[] {
  const words = [ctx.name, ...brandTerms(ctx), ...ctx.productTerms].join(" ").toLowerCase().match(/[a-z]{4,}/g) ?? []
  const weak = new Set(weakTerms(ctx).map(flat)) // an abbreviation is never its own confirmation
  return unique(words.filter((w) => !COMPANY_WORDS.has(w) && !weak.has(w)))
}

/** Does `text` (and the item's `name`, e.g. the account name) refer to this brand? */
export function relevance(ctx: BrandContext, text: string, name: string | null = null, threshold = 85): Relevance {
  const strongT = strongTerms(ctx)
  const strong = brandTermsInText(text, strongT)
  const weak = brandTermsInText(text, weakTerms(ctx))
  const context = brandTermsInText(text, contextWords(ctx))
  const longTerms = strongT.filter((t) => flat(t).length >= FUZZY_ALONE_LEN)
  const mediumTerms = strongT.filter((t) => flat(t).length < FUZZY_ALONE_LEN)
  const simLong = name && longTerms.length ? bestSimilarity(name, longTerms).score : 0
  const simMedium = name && mediumTerms.length ? bestSimilarity(name, mediumTerms).score : 0
  const relevant =
    strong.length > 0 || simLong >= threshold || (weak.length > 0 && context.length > 0) || (simMedium >= threshold && (context.length > 0 || weak.length > 0))
  return {
    strongHits: strong,
    weakHits: weak,
    contextHits: context,
    similarity: Math.max(simLong, simMedium),
    relevant,
    termsUsed: unique([...strong, ...weak]),
  }
}

/** Exact brand name inside an identifier (domain label, handle, package), ignoring punctuation and case (D-20) */
export function literalBrandIn(identifier: string, terms: string[]): boolean {
  const hay = flat(identifier)
  return terms.some((t) => t.trim() && hay.includes(flat(t)))
}
