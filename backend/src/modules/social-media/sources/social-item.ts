/**
 * The common shape every social source produces, whatever platform
 * or scraper it came from. Downstream code (storage, analysis) only ever sees this type.
 */

export type ContentType = "video" | "post" | "ad" | "channel" | "account"

export interface SocialItem {
  platform: string
  contentType: ContentType
  url: string
  itemId: string | null
  title: string
  text: string
  author: string | null
  authorHandle: string | null
  authorUrl: string | null
  authorId: string | null
  /** ISO 8601 when known */
  published: string | null
  thumbnailUrl: string | null
  metrics: Record<string, unknown>
  /** e.g. "Apify (Instagram)" */
  discovery: string
  /** came from a structured API with full fields */
  structured: boolean
  raw: Record<string, unknown>
  /** the search that found it */
  query: string | null
}

/** "{platform}:{type}:{id or url without query/fragment/trailing slash}", lower-case, max 1000 chars */
export function itemKey(item: Pick<SocialItem, "platform" | "contentType" | "itemId" | "url">): string {
  const ident = (item.itemId || item.url.replace(/[?#].*$/, "").replace(/\/+$/, "")).toLowerCase()
  return `${item.platform.toLowerCase()}:${item.contentType}:${ident}`.slice(0, 1000)
}

/** Defaults for optional fields, so mappers only state what they know */
export function socialItem(fields: Partial<SocialItem> & Pick<SocialItem, "platform" | "contentType" | "url" | "discovery">): SocialItem {
  return {
    itemId: null,
    title: "",
    text: "",
    author: null,
    authorHandle: null,
    authorUrl: null,
    authorId: null,
    published: null,
    thumbnailUrl: null,
    metrics: {},
    structured: false,
    raw: {},
    query: null,
    ...fields,
  }
}
