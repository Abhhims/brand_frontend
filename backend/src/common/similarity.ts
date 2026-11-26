/**
 * Name similarity (docs/port §3.3 — simplified: one homoglyph reading).
 *
 *   similarity("zentr0va-login", "Zentrova") → 0..100
 *
 * Folds look-alike characters first (0→o, 1→l, Cyrillic а→a …), then takes the best of the plain Indel ratio and,
 * for longer candidates, the best matching window ("partial ratio") when it is ≥ 85.
 */
const CONFUSABLES: Record<string, string> = {
  "0": "o", "1": "l", "3": "e", "4": "a", "5": "s", "7": "t", "8": "b", "@": "a", "$": "s", "|": "l", "!": "i",
  а: "a", е: "e", о: "o", р: "p", с: "c", у: "y", х: "x", і: "i", ј: "j", ԁ: "d", ɡ: "g", ս: "u", ν: "v", ο: "o", α: "a", ε: "e", ι: "i", κ: "k", ρ: "p", τ: "t",
}

export function fold(text: string): string {
  const lower = text.normalize("NFKC").toLowerCase()
  let out = ""
  for (const ch of lower) out += CONFUSABLES[ch] ?? ch
  return out
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/rn/g, "m")
    .replace(/vv/g, "w")
}

const clean = (s: string) => s.replace(/[^a-z0-9]/g, "")

/** Indel similarity 0..100 (rapidfuzz fuzz.ratio) */
export function ratio(a: string, b: string): number {
  if (!a.length && !b.length) return 100
  // LCS length via DP over the shorter string
  const [s, t] = a.length < b.length ? [a, b] : [b, a]
  let prev = new Array<number>(s.length + 1).fill(0)
  for (let i = 1; i <= t.length; i++) {
    const cur = new Array<number>(s.length + 1).fill(0)
    for (let j = 1; j <= s.length; j++) cur[j] = t[i - 1] === s[j - 1] ? prev[j - 1]! + 1 : Math.max(prev[j]!, cur[j - 1]!)
    prev = cur
  }
  const lcs = prev[s.length]!
  return (100 * (2 * lcs)) / (a.length + b.length)
}

/** Best ratio of `short` against any equal-length window of `long` */
export function partialRatio(short: string, long: string): number {
  if (short.length > long.length) return partialRatio(long, short)
  let best = 0
  for (let i = 0; i + short.length <= long.length; i++) {
    best = Math.max(best, ratio(short, long.slice(i, i + short.length)))
    if (best === 100) break
  }
  return best
}

export function similarity(candidate: string, target: string): number {
  const c = clean(fold(candidate))
  const t = clean(fold(target))
  if (!c || !t) return 0
  let best = ratio(c, t)
  if (t.length >= 4 && c.length > t.length) {
    const p = partialRatio(t, c)
    if (p >= 85) best = Math.max(best, p)
  }
  return Math.round(best * 100) / 100
}

/** Highest similarity against any target, and which target it was */
export function bestSimilarity(candidate: string, targets: string[]): { score: number; term: string | null } {
  let score = 0
  let term: string | null = null
  for (const t of targets) {
    const s = similarity(candidate, t)
    if (s > score) {
      score = s
      term = t
    }
  }
  return { score, term }
}

/** Brand terms that appear in free text (word start boundary, folded) */
export function brandTermsInText(text: string, terms: string[]): string[] {
  const hay = fold(text).replace(/[-_]/g, " ").replace(/\s+/g, " ")
  return terms.filter((term) => {
    const needle = fold(term).replace(/[-_]/g, " ").replace(/\s+/g, " ").trim()
    if (!needle) return false
    const re = new RegExp(`(?<![a-z0-9])${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`)
    return re.test(hay)
  })
}
