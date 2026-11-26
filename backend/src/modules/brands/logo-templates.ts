/**
 * The brand's official logos, prepared once for logo matching (integrations/vision/logo-matcher) and shared by every
 * module that compares images with them (phishing websites, social media thumbnails).
 *
 * Templates are cached per brand and rebuilt only when the brand's logo set changes (assets added or removed), so
 * preparing them (OpenCV keypoints at several sizes + OCR) happens once per brand per process.
 */
import { logger } from "../../infra/logger.js"
import type { ObjectStorage } from "../../integrations/storage/object-storage.js"
import type { LogoMatcher, LogoTemplate } from "../../integrations/vision/logo-matcher.js"
import type { BrandsRepository } from "./brands.repository.js"

export class LogoTemplates {
  private readonly cache = new Map<string, { key: string; templates: LogoTemplate[] }>()

  constructor(
    private readonly brands: Pick<BrandsRepository, "logoAssets">,
    private readonly storage: Pick<ObjectStorage, "get">,
    /** null = logo matching switched off (no templates are ever prepared) */
    readonly matcher: LogoMatcher | null,
  ) {}

  /** Prepared official logos (logo + app icon assets) of a brand; [] when it has none or matching is off */
  async forBrand(brandId: string): Promise<LogoTemplate[]> {
    if (!this.matcher) return []
    const assets = await this.brands.logoAssets(brandId)
    const key = assets.map((a) => a.id).join(",")
    let cached = this.cache.get(brandId)
    if (!cached || cached.key !== key) {
      const loaded: { id: string; kind: string; filename: string; bytes: Buffer }[] = []
      for (const a of assets) {
        try {
          loaded.push({ id: a.id, kind: a.kind, filename: a.filename, bytes: await this.storage.get(a.storageKey) })
        } catch (err) {
          logger.warn({ err, asset: a.id }, "official logo could not be read from storage")
        }
      }
      cached = { key, templates: await this.matcher.prepare(loaded) }
      this.cache.set(brandId, cached)
    }
    return cached.templates
  }
}
