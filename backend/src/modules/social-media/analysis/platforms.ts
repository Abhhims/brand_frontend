/**
 * Which social platform a URL belongs to and what kind of content it is.
 * Includes Reddit, Quora, WhatsApp
 * channels, Snapchat and Medium for the web-search source.
 */
import type { ContentType } from "../sources/social-item.js"

function parse(url: string): { host: string; path: string } {
  try {
    const u = new URL(url)
    return { host: u.hostname.toLowerCase(), path: u.pathname }
  } catch {
    return { host: "", path: "" }
  }
}

const PLATFORM_HOSTS: [string[], string][] = [
  [["youtube.com", "youtu.be"], "YouTube"],
  [["instagram.com"], "Instagram"],
  [["facebook.com", "fb.com", "fb.watch"], "Facebook"],
  [["x.com", "twitter.com"], "X"],
  [["threads.net", "threads.com"], "Threads"],
  [["tiktok.com"], "TikTok"],
  [["linkedin.com"], "LinkedIn"],
  [["t.me", "telegram.me"], "Telegram"],
  // not in the legacy table (web-search source)
  [["reddit.com", "redd.it"], "Reddit"],
  [["quora.com"], "Quora"],
  [["snapchat.com"], "Snapchat"],
  [["medium.com"], "Medium"],
]

/** Every platform name platformOf can return */
export const SOCIAL_PLATFORMS = [...PLATFORM_HOSTS.map(([, n]) => n), "Pinterest", "WhatsApp"] as const

export function platformOf(url: string): string | null {
  let { host } = parse(url)
  if (host.startsWith("www.")) host = host.slice(4)
  if (host.startsWith("m.")) host = host.slice(2)
  for (const [hosts, name] of PLATFORM_HOSTS) if (hosts.some((h) => host === h || host.endsWith(`.${h}`))) return name
  if (host === "pinterest.com" || host.startsWith("pinterest.") || host.includes(".pinterest.") || host === "pin.it") return "Pinterest"
  // WhatsApp channels and group invites only (wa.me / api.whatsapp.com links are contact details, not content)
  const { path } = parse(url)
  if ((host === "whatsapp.com" && /^\/channel\//i.test(path)) || host === "chat.whatsapp.com") return "WhatsApp"
  return null
}

/** video | post | channel | account, from the URL shape */
export function contentTypeOf(platform: string, url: string): ContentType {
  const { host, path } = parse(url)
  const parts = path.toLowerCase().split("/").filter(Boolean)
  const has = (...xs: string[]) => xs.some((x) => parts.includes(x))
  switch (platform) {
    case "YouTube":
      return has("watch", "shorts", "live") || host === "youtu.be" ? "video" : "channel"
    case "Instagram":
      return has("reel", "reels", "tv") ? "video" : has("p") ? "post" : "account"
    case "Facebook":
      if (has("videos", "watch", "reel", "reels") || url.includes("fb.watch")) return "video"
      return has("posts", "permalink.php", "story.php", "photos", "share") ? "post" : "account"
    case "X":
    case "Threads":
      return has("status", "post") ? "post" : "account"
    case "TikTok":
      return has("video") ? "video" : "account"
    case "Pinterest":
      return has("pin") ? "post" : "account"
    case "LinkedIn":
      return has("posts", "feed", "pulse") ? "post" : "account"
    case "Telegram":
      return parts.length >= 2 && /^\d+$/.test(parts[parts.length - 1]!) ? "post" : "account"
    // ---- not in the legacy table
    case "Reddit":
      if (has("comments") || host === "redd.it") return "post"
      return parts[0] === "user" || parts[0] === "u" ? "account" : "channel"
    case "Quora":
      if (parts[0] === "profile") return "account"
      if (parts[0] === "q") return parts.length > 2 ? "post" : "channel"
      return "post" // question / answer pages
    case "WhatsApp":
      return "channel"
    case "Snapchat":
      if (has("spotlight")) return "video"
      return has("discover") ? "channel" : "account"
    case "Medium": {
      const sub = host.replace(/^www\./, "") !== "medium.com" // name.medium.com is a blog
      if (has("p") || (sub && parts.length >= 1) || (!sub && parts.length >= 2)) return "post"
      return parts[0]?.startsWith("@") || sub ? "account" : "channel"
    }
    default:
      return "post"
  }
}

/**
 * The same post seen through different sources: no scheme, www./m., query or trailing slash; twitter → x. Pages
 * identified by their query (permalink.php?story_fbid=…, ads/library/?id=…) keep it.
 */
export function urlKey(url: string): string {
  const u = url.toLowerCase().replace(/^https?:\/\/(www\.|m\.|mobile\.)?/, "")
  const noFrag = u.replace(/#.*$/, "")
  const q = noFrag.indexOf("?")
  const path = (q < 0 ? noFrag : noFrag.slice(0, q)).replace(/\/+$/, "")
  const query = q < 0 ? "" : noFrag.slice(q + 1)
  const out = query && (path.endsWith(".php") || path.endsWith("/ads/library")) ? `${path}?${query}` : path
  return out.replace(/^twitter\.com\//, "x.com/")
}

/** The account a post URL belongs to, when the URL says so (x.com/{user}/status/…, tiktok.com/@{user}/video/…) */
export function authorFromUrl(platform: string, url: string): string | null {
  const parts = parse(url).path.split("/").filter(Boolean)
  const first = parts[0]
  if (!first) return null
  if (first.startsWith("@")) return first.slice(1).toLowerCase() || null
  if (platform === "Telegram") return (first === "s" ? (parts[1] ?? "") : first).toLowerCase() || null
  if (platform === "X" && parts[1] === "status") return first.toLowerCase()
  if (platform === "Reddit" && (first === "user" || first === "u") && parts[1]) return parts[1].toLowerCase()
  return null
}
