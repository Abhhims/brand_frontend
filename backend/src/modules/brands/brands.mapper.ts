/** Entity → DTO for brands. Storage keys and image hashes other than phash stay internal. */
import type { AssetOut, BrandOut } from "./brands.dto.js"
import type { AllowRow, AssetRow, BrandAggregate } from "./brands.repository.js"

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null)

export const toAssetDto = (a: AssetRow, url: string | null): AssetOut => ({
  id: a.id,
  kind: a.kind,
  filename: a.filename,
  content_type: a.contentType,
  sha256: a.sha256,
  phash: a.phash,
  mmh3: a.mmh3,
  created_at: a.createdAt.toISOString(),
  url,
})

export const toAllowDto = (a: AllowRow) => ({ id: a.id, kind: a.kind, value: a.value })

export const toBrandDto = (
  agg: BrandAggregate,
  extra: { assetUrls: Map<string, string | null>; openAlerts: number; nextAutoScanAt: Date | null },
): BrandOut => {
  const b = agg.brand
  return {
    id: b.id,
    name: b.name,
    description: b.description,
    keywords: b.keywords,
    product_terms: b.productTerms,
    is_active: b.isActive,
    alert_min_level: b.alertMinLevel,
    auto_scan_enabled: b.autoScanEnabled,
    auto_scan_frequency: b.autoScanFrequency,
    auto_scan_runners: b.autoScanRunners,
    last_auto_scan_at: iso(b.lastAutoScanAt),
    next_auto_scan_at: iso(extra.nextAutoScanAt),
    created_at: b.createdAt.toISOString(),
    assets: agg.assets.map((a) => toAssetDto(a, extra.assetUrls.get(a.id) ?? null)),
    allowlist: agg.allowlist.map(toAllowDto),
    open_alerts: extra.openAlerts,
  }
}
