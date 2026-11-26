/**
 * The official logo compared with an image found elsewhere (a page image, a screenshot, a social media thumbnail),
 * after alignment (integrations/vision/logo-matcher). One response shape for every module, so the UI can show any
 * comparison side by side.
 */
import { z } from "zod"
import type { LogoComparison } from "../integrations/vision/logo-matcher.js"

export const LogoComparisonDto = z.object({
  matched: z.boolean(),
  score: z.number().describe("overall 0–100 (shape 35 %, design 25 %, colour 20 %, text 20 %)"),
  method: z.enum(["fingerprint", "shape"]).nullable().describe("how the logo was located"),
  source: z.enum(["page_image", "screenshot", "thumbnail"]).describe("what was compared: a page image, the page screenshot, or a social media thumbnail / profile picture"),
  checks: z.object({
    shape: z.number(),
    design: z.number(),
    colour: z.number(),
    text: z.number().nullable().describe("null when the official logo has no readable text"),
  }),
  inliers: z.number().describe("matching points that agree on one position (≥ 25 needed)"),
  inlier_ratio: z.number(),
  box: z.array(z.tuple([z.number(), z.number()])).nullable().describe("corners of the located logo in the found image, original pixels"),
  points: z.array(z.tuple([z.number(), z.number(), z.number(), z.number()])).describe("official x,y → found x,y pairs, original pixels"),
  image_size: z.tuple([z.number(), z.number()]),
  logo_size: z.tuple([z.number(), z.number()]).nullable(),
  text_found: z.string().nullable(),
  text_expected: z.string().nullable(),
  colours: z.object({ logo: z.array(z.string()), found: z.array(z.string()) }),
  reason: z.string(),
  found_image_url: z.string().nullable().describe("the compared image (signed link)"),
  found_image_source: z.string().nullable().describe("where the image came from (page image URL, thumbnail URL)"),
  official_logo_url: z.string().nullable().describe("the official logo it was compared with (signed link)"),
  official_logo_name: z.string().nullable(),
  candidates: z.array(z.object({ url: z.string(), score: z.number(), matched: z.boolean(), inliers: z.number(), reason: z.string() })),
})
export type LogoComparisonOut = z.infer<typeof LogoComparisonDto>

/** A comparison as stored (matcher output + where it came from) */
export type StoredLogoComparison = Partial<LogoComparison> & { source?: string; asset_id?: string | null }

/** official logo assets by id: name + signed link (filled by the service for the rows being returned) */
export type OfficialLogos = Map<string, { name: string; url: string | null }>

/** Stored comparison → API shape; the links are resolved by the caller */
export function toLogoComparisonDto(
  c: StoredLogoComparison | null | undefined,
  links: { foundImageUrl: string | null; foundImageSource: string | null; logos: OfficialLogos; candidates?: LogoComparisonOut["candidates"] },
): LogoComparisonOut | null {
  if (!c || typeof c !== "object" || typeof c.matched !== "boolean") return null
  const asset = c.asset_id ? links.logos.get(c.asset_id) : undefined
  const source = c.source === "screenshot" || c.source === "thumbnail" ? c.source : "page_image"
  return {
    matched: c.matched,
    score: c.score ?? 0,
    method: c.method ?? null,
    source,
    checks: c.checks ?? { shape: 0, design: 0, colour: 0, text: null },
    inliers: c.inliers ?? 0,
    inlier_ratio: c.inlier_ratio ?? 0,
    box: c.box ?? null,
    points: c.points ?? [],
    image_size: c.image_size ?? [0, 0],
    logo_size: c.logo_size ?? null,
    text_found: c.text_found ?? null,
    text_expected: c.text_expected ?? null,
    colours: c.colours ?? { logo: [], found: [] },
    reason: c.reason ?? "",
    found_image_url: links.foundImageUrl,
    found_image_source: links.foundImageSource,
    official_logo_url: asset?.url ?? null,
    official_logo_name: asset?.name ?? null,
    candidates: links.candidates ?? [],
  }
}
