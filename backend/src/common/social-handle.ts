/**
 * Social account handle from a URL or "@name":
 *   https://www.instagram.com/examplebank/            → examplebank
 *   https://www.linkedin.com/company/example/?ref=x   → example
 *   https://www.youtube.com/@Example                  → example
 *   @examplebank                                      → examplebank
 */
const PREFIX_SEGMENTS = new Set(["company", "in", "school", "showcase", "channel", "c", "user", "people", "pg", "s"])
const IGNORED_SEGMENTS = new Set(["about", "posts", "videos", "featured", "home", "reels", "photos", "community"])

export function socialHandle(value: string): string {
  let v = value.trim()
  const looksLikeUrl = v.includes("://") || /^(www\.)?[a-z0-9-]+\.[a-z]{2,}\//i.test(v)
  if (looksLikeUrl) {
    let url: URL
    try {
      url = new URL(v.includes("://") ? v : `https://${v}`)
    } catch {
      return v.replace(/^@/, "").trim().toLowerCase()
    }
    let parts = url.pathname.split("/").filter((p) => p && !IGNORED_SEGMENTS.has(p.toLowerCase()))
    while (parts.length > 1 && PREFIX_SEGMENTS.has(parts[0]!.toLowerCase())) parts = parts.slice(1)
    if (parts.length) v = parts[0]!
    else if (url.hostname.replace(/^www\./, "") === "t.me") v = ""
  }
  return v.replace(/^@/, "").trim().toLowerCase()
}
