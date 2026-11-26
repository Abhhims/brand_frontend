/** Instagram scraper output → SocialItem (legacy _instagram_post / _instagram_profile). */
import { socialItem, type SocialItem } from "../../social-item.js"
import { arr, authorRaw, first, str, toIso, type Json } from "./helpers.js"

const DISCOVERY = "Apify (Instagram)"

/** apify/instagram-hashtag-scraper, resultsType "posts" */
export function instagramPost(p: Json): SocialItem | null {
  const url = str(p.url) ?? (p.shortCode ? `https://www.instagram.com/p/${p.shortCode}/` : null)
  if (!url) return null
  const owner = str(p.ownerUsername)
  const caption = str(p.caption) ?? ""
  const video = p.type === "Video" || p.productType === "clips"
  return socialItem({
    platform: "Instagram",
    contentType: video ? "video" : "post",
    url,
    itemId: str(p.shortCode) ?? str(p.id),
    title: caption.slice(0, 120),
    text: caption,
    author: str(p.ownerFullName) ?? owner,
    authorHandle: owner,
    authorId: str(p.ownerId),
    authorUrl: owner ? `https://www.instagram.com/${owner}/` : null,
    published: toIso(p.timestamp),
    thumbnailUrl: str(p.displayUrl),
    metrics: {
      Views: first(p.videoViewCount, p.videoPlayCount),
      // -1 means the owner hid the like count
      Likes: (p.likesCount ?? 0) >= 0 ? (p.likesCount ?? null) : null,
      Comments: p.commentsCount ?? null,
    },
    discovery: DISCOVERY,
    structured: true,
    raw: { tags: arr(p.hashtags).slice(0, 30) },
  })
}

/** apify/instagram-scraper, searchType "user", resultsType "details" */
export function instagramProfile(p: Json): SocialItem | null {
  const username = str(p.username)
  if (!username) return null
  const url = str(p.url) ?? `https://www.instagram.com/${username}/`
  const avatar = first(p.profilePicUrlHD, p.profilePicUrl)
  return socialItem({
    platform: "Instagram",
    contentType: "account",
    url,
    itemId: username,
    title: str(p.fullName) ?? username,
    text: [p.biography, p.externalUrl].filter(Boolean).join(" "),
    author: str(p.fullName) ?? username,
    authorHandle: username,
    authorUrl: url,
    authorId: str(p.id),
    thumbnailUrl: str(avatar),
    metrics: { Followers: p.followersCount ?? null, Posts: p.postsCount ?? null, Verified: p.verified ?? null },
    discovery: DISCOVERY,
    structured: true,
    raw: authorRaw(avatar, p.followersCount, p.biography, p.verified),
  })
}
