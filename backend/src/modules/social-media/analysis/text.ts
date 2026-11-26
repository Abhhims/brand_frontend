/**
 * Pure text checks for social media content: scam contact details and scam wording (no network, easy to test).
 *
 * Regex notes (Python `re` on str vs JavaScript):
 *   - Python's `\w` / `\b` are Unicode-aware; JS's are ASCII-only even with the `u` flag. Where the legacy pattern
 *     used them as boundaries they are spelled out here with WORD = [\p{L}\p{N}_] (what Python's \w matches).
 *   - Every pattern carries the `u` flag so Devanagari text and astral characters are read as whole code points.
 */

/** Python's `\w` for str patterns: letters and numbers of any script, and underscore */
const WORD = String.raw`[\p{L}\p{N}_]`
/** Python's `\b`: between a \w character and a non-\w character (or the text edge) */
const B = String.raw`(?:(?<=${WORD})(?!${WORD})|(?<!${WORD})(?=${WORD}))`

/** Number of the decimal digit `ch` (any script): digits come in complete runs of ten, 0 first */
function digitValue(ch: string): number {
  let cp = ch.codePointAt(0)!
  let n = 0
  while (/\p{Nd}/u.test(String.fromCodePoint(cp - 1))) {
    cp--
    n++
  }
  return n % 10
}

/**
 * Undo look-alike lettering scammers use to dodge filters: 𝕔𝕦𝕤𝕥𝕠𝕞𝕖𝕣 𝕔𝕒𝕣𝕖 / 𝐍𝐚𝐯𝐢 / ９８７… → plain text, and digits
 * of any script (Devanagari ९८७…) → 0-9.
 */
export function normalize(text: string | null | undefined): string {
  return (text ?? "").normalize("NFKC").replace(/\p{Nd}/gu, (c) => (c.charCodeAt(0) < 128 ? c : String(digitValue(c))))
}

// Indian mobile numbers (+91 optional) and toll-free numbers, plus international numbers written with a +
const PHONE_RE = new RegExp(
  String.raw`(?<![\p{L}\p{N}_/])(?:\+?91[\s.\-]?)?[6-9]\d{4}[\s.\-]?\d{5}(?!\d)` +
    String.raw`|(?<![\p{L}\p{N}_/])1[\s.\-]?8[05]0[\s.\-]?\d{3}[\s.\-]?\d{4}(?!\d)` +
    String.raw`|(?<![\p{L}\p{N}_/])\+(?!91)\d{1,3}[\s.\-]?\d{3,4}[\s.\-]?\d{3,4}[\s.\-]?\d{0,4}(?!\d)`,
  "gu",
)
const WHATSAPP_RE = /(?:wa\.me\/\+?\d+|api\.whatsapp\.com\/send\?phone=\+?\d+|chat\.whatsapp\.com\/[A-Za-z0-9]+)/giu
const TELEGRAM_RE = /(?<![\p{L}\p{N}_.])(?:t\.me|telegram\.me)\/(?!s\/)[A-Za-z0-9_+]{4,}/giu
// UPI virtual payment addresses: name@<bank/PSP handle>
const UPI_RE = new RegExp(
  String.raw`${B}[\p{L}\p{N}_.\-]{2,64}@(?:okaxis|okhdfcbank|okicici|oksbi|ybl|ibl|axl|paytm|upi|apl|yapl|ptsbi|pthdfc|ptaxis|ptyes` +
    String.raw`|fbl|airtel|jio|boi|sbi|icici|hdfcbank|axisbank|kotak|indus|federal|barodampay|ikwik|freecharge|naviaxis` +
    String.raw`|superyes|waaxis|wahdfcbank|waicici|wasbi)${B}`,
  "giu",
)

/** Example handles apps and posts use to explain UPI ("pay to name@ybl"), not real payment addresses */
export const PLACEHOLDER_UPI = new Set([
  "name", "yourname", "your.name", "username", "user", "example", "upiid", "upi", "mobile", "mobilenumber", "number", "phone",
  "xyz", "abc", "test", "id", "yourupi", "youruid",
])

// Social media criticality (see common/scoring.ts socialTier): three groups of wording.
/** 1. Fake support claim → Critical: the brand's "customer care / helpline number" published by someone else. */
export const SUPPORT_PHRASES = [
  "customer care", "customer support", "customer service", "helpline", "help line", "toll free", "care number",
  "helpline number", "contact number", "complaint number", "whatsapp us", "contact us on whatsapp",
  "कस्टमर केयर", "कस्टमर सपोर्ट", "ग्राहक सेवा", "हेल्पलाइन", "टोल फ्री",
]
/**
 * Help videos often say "contact customer support in the app": in a description only an explicit number claim
 * counts; in the title any support wording does (the video presents itself as the brand's customer care).
 */
export const NUMBER_CLAIMS = new Set(["care number", "helpline number", "contact number", "complaint number", "toll free", "टोल फ्री"])
/** 2. Wrong-details scam wording → High. */
export const WRONG_DETAILS_PHRASES = [
  "update your kyc", "account blocked", "account suspended", "verify your account",
  "guaranteed returns", "guaranteed return", "double your money", "double money", "fixed returns", "daily profit",
  "registration fee", "official agent", "authorised agent", "authorized agent", "lottery",
  "lucky draw", "you have won", "claim your", "refund call", "refund number",
]
/** 3. Brand abuse → Medium: earning / referral bait, cashback lures, unofficial APKs, easy-loan promises. */
export const ABUSE_PHRASES = [
  "refer and earn", "refer & earn", "referral", "earn money", "earning", "paise kamaye", "paisa kamaye",
  "paise kaise kamaye", "kamaye", "cashback", "apk", "mod apk", "free recharge",
  "loan without", "without cibil", "no documents", "work from home", "earn daily", "investment plan",
  "investment scheme", "invest now", "high returns", "free gift",
  "पैसे कमाए", "पैसे कमाएं", "कमाएं", "कमाई", "रेफर", "कैशबैक",
]
/** Other wording shown to the analyst but not scored on its own (common in ordinary tutorials and loan explainers) */
export const INFO_PHRASES = [
  "kyc", "kyc update", "kyc pending", "refund", "processing fee", "instant loan", "loan approval",
  "pre-approved loan", "call now", "dm for", "dm us", "franchise", "dealership", "job offer",
  "hiring now", "chit fund scheme", "chit scheme",
]
export const SCAM_PHRASES = [...new Set([...SUPPORT_PHRASES, ...WRONG_DETAILS_PHRASES, ...ABUSE_PHRASES, ...INFO_PHRASES])]
/** Hashtags glue words together (#navicustomercare): these are also matched with spaces removed */
const SQUASHED = new Map(
  ["customer care", "customer support", "customer service", "helpline", "toll free", "care number", "helpline number", "contact number"].map((p) => [p, p.replaceAll(" ", "")]),
)

/** Wording that on its own suggests fraud next to a brand name (fake support claim or wrong-details scam) */
export const STRONG_SCAM_PHRASES = new Set([...SUPPORT_PHRASES, ...WRONG_DETAILS_PHRASES])
/** Contact kinds that count as fake contact details. Telegram links are usually the video creator's own channel. */
export const SCORED_CONTACTS = ["phone", "whatsapp", "upi"] as const

export type Contacts = Partial<Record<"phone" | "whatsapp" | "telegram" | "upi", string[]>>

const unique = <T>(xs: T[]) => [...new Set(xs)]

function normPhone(p: string): string {
  let digits = p.replace(/\D/g, "")
  if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2)
  return digits
}

/** Phone numbers, WhatsApp / Telegram links and UPI IDs found in the text (at most 10 of each; empty kinds left out) */
export function contactDetails(text: string): Contacts {
  const t = normalize(text)
  const phones = unique([...t.matchAll(PHONE_RE)].map((m) => normPhone(m[0]))).filter((p) => p.length >= 8 && p.length <= 13)
  const out: Contacts = {
    phone: phones,
    whatsapp: unique([...t.matchAll(WHATSAPP_RE)].map((m) => m[0])),
    telegram: unique([...t.matchAll(TELEGRAM_RE)].map((m) => m[0])),
    upi: unique([...t.matchAll(UPI_RE)].map((m) => m[0].toLowerCase()).filter((u) => !PLACEHOLDER_UPI.has(u.split("@")[0]!))),
  }
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v.length).map(([k, v]) => [k, v.slice(0, 10)])) as Contacts
}

export const strongPhrases = (phrases: string[]) => phrases.filter((p) => STRONG_SCAM_PHRASES.has(p))
export const supportPhrases = (phrases: string[]) => phrases.filter((p) => SUPPORT_PHRASES.includes(p))
export const wrongDetailsPhrases = (phrases: string[]) => phrases.filter((p) => WRONG_DETAILS_PHRASES.includes(p))
export const abusePhrases = (phrases: string[]) => phrases.filter((p) => ABUSE_PHRASES.includes(p))

/** Presents itself as the brand's customer care: support wording in the title, or a number claim anywhere */
export function fakeSupportClaim(titlePhrases: string[], phrases: string[]): boolean {
  return supportPhrases(titlePhrases).length > 0 || phrases.some((p) => NUMBER_CLAIMS.has(p))
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
const PHRASE_RES = new Map(SCAM_PHRASES.map((p) => [p, new RegExp(`(?<![a-z])${escapeRe(p)}(?![a-z])`, "u")]))

/** Scam phrases in the text, in list order (whole words; hashtag spellings of support phrases too) */
export function scamPhrases(text: string): string[] {
  const low = normalize(text).toLowerCase().replace(/[\s\-_]+/gu, " ")
  const squashed = low.replace(/[^a-z]/g, "")
  return SCAM_PHRASES.filter((p) => PHRASE_RES.get(p)!.test(low) || (SQUASHED.has(p) && squashed.includes(SQUASHED.get(p)!)))
}

/** Contact details that point at the brand itself (its own Telegram handle) are not scam contacts */
export function dropOfficial(contacts: Contacts, _officialDomains: string[], officialHandles: string[]): Contacts {
  const handles = new Set(officialHandles.map((h) => h.toLowerCase()))
  const out: Contacts = { ...contacts }
  if (out.telegram) {
    out.telegram = out.telegram.filter((t) => !handles.has(t.split("/").slice(1).join("/").toLowerCase()))
    if (!out.telegram.length) delete out.telegram
  }
  return out
}
