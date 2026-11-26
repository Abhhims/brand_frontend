/**
 * Fraud themes: the kinds of scams that use a brand name. A brand is not only abused by fake login pages — the
 * same name is used for fake job offers, admissions, loans, prizes, investment schemes, delivery fees and support
 * numbers, whatever the brand's own industry. Every theme supplies:
 *
 *   affixes   words attackers add to the brand in domain names (zentrova-careers.com, zentrova-scholarship.in)
 *   words     words that show the theme on a page / in a search result
 *   query     a web-search query fragment that finds pages of that theme
 *
 * Used by look-alike generation (affixes), web-search discovery (one query per theme), page analysis (which themes
 * a page shows) and social media scam searches.
 */

export interface FraudTheme {
  key: string
  label: string
  affixes: string[]
  words: string[]
  query: string
}

export const FRAUD_THEMES: FraudTheme[] = [
  {
    key: "account_login",
    label: "Account / login phishing",
    affixes: ["login", "secure", "verify", "account", "signin", "auth", "update", "portal", "my", "online", "web", "netbanking", "ekyc", "kyc", "otp", "verification"],
    words: ["login", "sign in", "verify your account", "password", "otp", "kyc", "account suspended", "account blocked"],
    query: '(login OR "sign in" OR verify OR kyc OR otp)',
  },
  {
    key: "customer_support",
    label: "Fake customer care / helpline",
    affixes: ["support", "help", "helpline", "care", "customer", "customercare", "contact", "service", "complaint"],
    words: ["customer care", "helpline", "toll free", "complaint", "contact us", "support number", "call us"],
    query: '("customer care" OR helpline OR "toll free" OR "contact number")',
  },
  {
    key: "jobs",
    label: "Job / recruitment scams",
    affixes: ["careers", "career", "jobs", "job", "recruitment", "hiring", "hr", "vacancy", "apply", "talent", "workfromhome", "internship"],
    words: ["job offer", "recruitment", "hiring", "vacancy", "work from home", "registration fee", "offer letter", "interview", "salary", "internship"],
    query: '(job OR recruitment OR hiring OR vacancy OR "work from home" OR "offer letter")',
  },
  {
    key: "education",
    label: "Education / admission / scholarship scams",
    affixes: ["admission", "admissions", "scholarship", "exam", "result", "results", "university", "college", "edu", "academy", "courses", "certificate"],
    words: ["admission", "scholarship", "exam", "result", "enrollment", "course fee", "certificate", "university", "college"],
    query: '(admission OR scholarship OR exam OR result OR course OR certificate)',
  },
  {
    key: "loans_credit",
    label: "Loan / credit card scams",
    affixes: ["loan", "loans", "credit", "creditcard", "card", "cards", "emi", "finance", "instantloan", "personalloan"],
    words: ["instant loan", "pre-approved", "loan approved", "processing fee", "credit card", "emi", "low interest", "credit limit"],
    query: '(loan OR "credit card" OR "pre-approved" OR "processing fee" OR emi)',
  },
  {
    key: "payments_refunds",
    label: "Payment / refund / cashback scams",
    affixes: ["pay", "payment", "upi", "wallet", "refund", "cashback", "billing", "invoice"],
    words: ["refund", "cashback", "upi", "payment failed", "billing", "invoice", "collect request", "wallet"],
    query: '(refund OR cashback OR upi OR "payment failed")',
  },
  {
    key: "rewards_lottery",
    label: "Rewards / lottery / giveaway scams",
    affixes: ["rewards", "reward", "points", "offer", "offers", "bonus", "gift", "giveaway", "lucky", "winner", "prize", "lottery", "contest"],
    words: ["you have won", "lucky draw", "lottery", "giveaway", "prize", "reward points", "claim now", "congratulations", "free gift"],
    query: '("reward points" OR "lucky draw" OR lottery OR giveaway OR prize OR "claim now")',
  },
  {
    key: "investment",
    label: "Investment / trading / crypto scams",
    affixes: ["invest", "investment", "trading", "trade", "crypto", "bitcoin", "returns", "stocks", "ipo", "fund", "profit"],
    words: ["guaranteed returns", "double your money", "trading tips", "crypto", "investment plan", "daily profit", "ipo allotment"],
    query: '("guaranteed returns" OR investment OR trading OR crypto OR "double your money")',
  },
  {
    key: "delivery",
    label: "Delivery / courier / order scams",
    affixes: ["delivery", "track", "tracking", "courier", "parcel", "shipping", "order", "orders"],
    words: ["parcel", "delivery failed", "track your order", "customs fee", "reschedule delivery", "shipment"],
    query: '(delivery OR parcel OR "track your order" OR courier OR shipment)',
  },
  {
    key: "government_tax",
    label: "Government / tax / subsidy scams",
    affixes: ["gov", "govt", "tax", "subsidy", "scheme", "yojana", "pension", "aadhaar", "pan"],
    words: ["income tax refund", "subsidy", "government scheme", "pan card", "aadhaar", "pension", "yojana"],
    query: '(subsidy OR "tax refund" OR "government scheme" OR yojana OR aadhaar)',
  },
  {
    key: "shopping",
    label: "Fake shop / sale / dealership scams",
    affixes: ["shop", "store", "sale", "deals", "discount", "outlet", "mart", "dealer", "franchise", "distributor"],
    words: ["clearance sale", "90% off", "dealership", "franchise", "distributorship", "limited offer", "buy now"],
    query: '(sale OR discount OR franchise OR dealership OR distributorship)',
  },
  {
    key: "app_download",
    label: "Fake app / APK download",
    affixes: ["app", "apk", "download", "mobile", "android"],
    words: ["download apk", "install app", "apk download", "update app"],
    query: '("download apk" OR "apk download" OR "install app")',
  },
]

export const THEME_KEYS = FRAUD_THEMES.map((t) => t.key) as [string, ...string[]]

export const themesFor = (keys?: string[] | null) => (keys?.length ? FRAUD_THEMES.filter((t) => keys.includes(t.key)) : FRAUD_THEMES)

/** Every theme's affixes, de-duplicated (used as the dnstwist dictionary) */
export const themeAffixes = (keys?: string[] | null) => [...new Set(themesFor(keys).flatMap((t) => t.affixes))]

/** Themes whose words appear in the text, e.g. ["jobs", "rewards_lottery"] */
export function themesInText(text: string): { key: string; label: string; words: string[] }[] {
  const hay = text.toLowerCase()
  return FRAUD_THEMES.map((t) => ({ key: t.key, label: t.label, words: t.words.filter((w) => hay.includes(w)) })).filter((t) => t.words.length > 0)
}

/**
 * Which theme a host name points at (zentrova-careers.in → jobs). Whole words only, so "careers" is jobs, not
 * "care"; joined words count when the affix ends the word (zentrovajobs → jobs). Generic words that every site has
 * (app, web, my, online…) never decide a theme.
 */
const NAME_NEUTRAL = new Set(["app", "web", "my", "online", "mobile", "portal", "service", "android"])
export function themeOfName(name: string): string | null {
  const tokens = name.toLowerCase().split(/[.\-_]/).filter(Boolean)
  for (const t of FRAUD_THEMES) {
    const affixes = t.affixes.filter((a) => a.length >= 3 && !NAME_NEUTRAL.has(a))
    if (tokens.some((tok) => affixes.some((a) => tok === a || (tok.length > a.length + 3 && tok.endsWith(a))))) return t.key
  }
  return null
}
