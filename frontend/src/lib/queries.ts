"use client"

import { useQuery } from "@tanstack/react-query"
import { api, type DashboardQuery } from "@/lib/api"

export const keys = {
  brands: ["brands"] as const,
  brand: (id: string) => ["brands", id] as const,
  brandSearch: (q: string) => ["brands", "search", q] as const,
  // dashboard (Node API)
  overview: (q: DashboardQuery) => ["dashboard", "overview", q] as const,
  breakdown: (q: object) => ["dashboard", "breakdown", q] as const,
  // social media (Node API)
  socialItems: (query: string) => ["social", "items", query] as const,
  socialItem: (id: string) => ["social", "item", id] as const,
  socialSummary: (brandId: string) => ["social", "summary", brandId] as const,
  socialCollections: (brandId?: string) => ["social", "collections", brandId ?? "all"] as const,
  socialSources: ["social", "sources"] as const,
  // legacy endpoints, not ported to Node yet (only hidden pages use these)
  alerts: (query: string) => ["alerts", "list", query] as const,
  alert: (id: string) => ["alerts", "detail", id] as const,
  findings: (query: string) => ["findings", "list", query] as const,
  finding: (id: string) => ["findings", "detail", id] as const,
  executive: (brandIds: string[]) => ["stats", "executive", brandIds] as const,
  trends: (days: number, brandIds: string[]) => ["stats", "trends", days, brandIds] as const,
  scans: (brandId?: string) => ["scans", brandId ?? "all"] as const,
  users: ["users"] as const,
  autoScan: ["settings", "auto-scan"] as const,
}

export function useBrands() {
  return useQuery({ queryKey: keys.brands, queryFn: api.brands, staleTime: 60_000 })
}

/** Dashboard overview with no filters: used by the sidebar badge and the brands list */
export function useOverallOverview() {
  return useQuery({ queryKey: keys.overview({}), queryFn: () => api.overview({}), refetchInterval: 60_000, staleTime: 30_000 })
}
