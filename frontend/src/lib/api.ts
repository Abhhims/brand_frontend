/**
 * Typed client for the Beyond Cloud Brand Intelligence REST API (Node.js backend, Swagger at /docs).
 * All requests go to `${NEXT_PUBLIC_API_URL}/api/v1` with the bearer token from localStorage.
 *
 * Ported to Node so far (used by the visible pages): auth, brands, dashboard, social media (Instagram).
 * The alert/finding/scan/user/settings calls further down target endpoints that are not ported yet; only the
 * hidden legacy pages use them.
 */

export const API_URL = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8020").replace(/\/$/, "")
/** false = no request leaves the browser (UI-only work); pages show "backend not connected". */
export const API_ENABLED = process.env.NEXT_PUBLIC_API_ENABLED === "true"
export const OFFLINE_MESSAGE = "Backend not connected yet — this page will load once the API is enabled."
const BASE = `${API_URL}/api/v1`

// ------------------------------------------------------------------ enums
export type Role = "admin" | "analyst"
export type ModuleName =
  | "typosquat"
  | "mx"
  | "phishing"
  | "apk"
  | "rogue_app"
  | "social"
  | "social_media"
  | "documents"
  | "logo"
  | "email"
  | "email_posture"
  | "dmarc"
export type RiskLevel = "Low" | "Medium" | "High" | "Critical"
/** Analyst decision on a finding (backend D-35). Alerts show their finding's decision as `status`. */
export type Decision =
  | "New"
  | "Investigating"
  | "Confirmed Threat"
  | "False Positive"
  | "Legitimate"
  | "Ignored"
  | "Resolved"
export type AlertStatus = Decision
/** Candidate = discovered but not yet analysed; Finding = analysed (D-33). */
export type FindingStage = "Candidate" | "Finding"
export type AlertTrigger = "first_crossing" | "change" | "reopen" | "migrated"
/** How often a brand is scanned automatically (D-39). */
export type AutoScanFrequency = "daily" | "every_3_days" | "weekly"
/** Scanners a brand can pick for automatic scans; none picked = every scanner. */
export type AutoRunner =
  | "domains"
  | "apk"
  | "rogue_app"
  | "social"
  | "social_media"
  | "documents"
  | "logo"
  | "email_posture"
export type AssetKind = "logo" | "favicon" | "app_icon"
export type AllowKind = "domain" | "package" | "publisher" | "social_handle" | "email_domain" | "signing_cert"
export type ScanStatus =
  | "queued"
  | "running"
  | "completed"
  | "partially_completed"
  | "completed_with_errors"
  | "failed"
  | "cancelled"

/** One part of a scan run (backend D-31): whether it ran, and why not. */
export type ComponentStatus = "ok" | "skipped" | "not_configured" | "unavailable" | "failed"

export interface ScanComponent {
  name: string
  status: ComponentStatus
  message: string
  counts: Record<string, number>
  fatal?: boolean
}

// ------------------------------------------------------------------ models
export interface User {
  id: string
  email: string
  name: string
  role: Role
  is_active: boolean
  created_at: string
}

export interface TokenOut {
  access_token: string
  token_type: string
  user: User
}

export interface Asset {
  id: string
  kind: AssetKind
  filename: string
  content_type: string
  sha256: string
  phash: string | null
  mmh3: number | null
  created_at: string
  url: string | null
}

export interface AllowEntry {
  id: string
  kind: AllowKind
  value: string
}

export interface Brand {
  id: string
  name: string
  description: string | null
  keywords: string[]
  product_terms: string[]
  is_active: boolean
  alert_min_level: RiskLevel
  auto_scan_enabled: boolean
  auto_scan_frequency: AutoScanFrequency
  auto_scan_runners: AutoRunner[]
  last_auto_scan_at: string | null
  next_auto_scan_at: string | null
  created_at: string
  assets: Asset[]
  allowlist: AllowEntry[]
  open_alerts: number
}

export interface BrandInput {
  name: string
  description?: string | null
  keywords: string[]
  product_terms: string[]
  is_active: boolean
  alert_min_level?: RiskLevel
  auto_scan_enabled?: boolean
  auto_scan_frequency?: AutoScanFrequency
  auto_scan_runners?: AutoRunner[]
  allowlist?: { kind: AllowKind; value: string }[]
}

/** Master switch for scheduled scans (D-39). */
export interface AutoScanSettings {
  enabled: boolean
  updated_at: string | null
  brands_enabled: number
  brands_total: number
  schedule_utc: string
}

export interface Scan {
  id: string
  brand_id: string
  brand_name: string | null
  module: ModuleName
  trigger: string
  status: ScanStatus
  started_at: string | null
  finished_at: string | null
  stats: Record<string, unknown>
  components: ScanComponent[]
  error: string | null
  created_at: string
}

export interface Evidence {
  id: string
  kind: string
  content_type: string | null
  sha256: string | null
  size: number | null
  meta: Record<string, unknown>
  captured_at: string
  url: string | null
}

export interface AlertEvent {
  id: string
  kind: string
  from_status: string | null
  to_status: string | null
  note: string | null
  at: string
  user_name: string | null
}

export interface AlertSignals {
  score?: number
  level?: string
  raw_score?: number
  rules?: Record<string, number>
  confidence?: {
    score: number
    level: string
    policy?: string
    factors: { factor: string; points: number; why: string }[]
  }
  [key: string]: unknown
}

export interface RelatedFinding {
  finding_id: string
  module: ModuleName
  entity_key: string
  title: string
  risk_level: RiskLevel
  score: number
  decision: string
  kind: string
  label: string
  value: string
  strong: boolean
  seen_in: string
}

export interface Observation {
  id: string
  scan_id: string | null
  channel: string
  observed_at: string
  stage: FindingStage
  module: ModuleName
  score: number
  risk_level: RiskLevel
  state: Record<string, unknown>
}

export interface AlertRecord {
  id: string
  finding_id: string
  scan_id: string | null
  trigger: AlertTrigger | string
  reason: string
  score: number
  risk_level: RiskLevel
  reasons: Record<string, unknown>
  created_at: string
}

export interface Finding {
  id: string
  brand_id: string
  brand_name: string
  module: ModuleName
  entity_key: string
  stage: FindingStage
  title: string
  similarity: number | null
  score: number
  risk_level: RiskLevel
  decision: Decision
  decision_note: string | null
  decided_at: string | null
  suspected_phishing: boolean
  details: Record<string, unknown>
  signals: AlertSignals
  state: Record<string, unknown>
  source_url: string | null
  first_seen: string
  last_seen: string
  last_alert_at: string | null
  updated_at: string
  thumbnail_url: string | null
  alert_count: number
}

export interface FindingDetail extends Finding {
  decided_by_name: string | null
  evidence: Evidence[]
  events: AlertEvent[]
  observations: Observation[]
  alerts: AlertRecord[]
}

export interface FindingPage {
  items: Finding[]
  total: number
  page: number
  page_size: number
}

export interface Alert {
  id: string
  finding_id: string
  brand_id: string
  brand_name: string
  module: ModuleName
  entity_key: string
  stage: FindingStage
  title: string
  similarity: number | null
  score: number
  risk_level: RiskLevel
  status: Decision
  suspected_phishing: boolean
  details: Record<string, unknown>
  signals: AlertSignals
  source_url: string | null
  first_seen: string
  last_seen: string
  updated_at: string
  alerted_at: string
  trigger: AlertTrigger | string
  /** Human-readable reason the alert was raised */
  reason: string
  scan_id: string | null
  thumbnail_url: string | null
}

export interface AlertDetail extends Alert {
  evidence: Evidence[]
  events: AlertEvent[]
  observations: Observation[]
  alerts: AlertRecord[]
  decision_note: string | null
}

export interface AlertPage {
  items: Alert[]
  total: number
  page: number
  page_size: number
}

export interface ExecutiveStats {
  date: string
  total_alerts_today: number
  high_critical_alerts: number
  high_critical_today: number
  new_phishing_domains: number
  new_impersonation_accounts: number
  new_rogue_apps: number
  sensitive_document_exposures: number
  phishing_emails_today: number
  spoofed_sender_attempts: number
  open_alerts: number
  by_module: Record<string, number>
  by_risk: Record<string, number>
  /** keyed by analyst decision */
  by_status: Record<string, number>
  /** candidates not yet analysed into findings */
  candidates: number
  /** analysed findings held back by the brand's "Alert from" level */
  findings_below_alert_level: number
  /** null = no scan has completed yet, so "no threats" cannot be claimed */
  last_completed_scan_at: string | null
  /** scan components that could not run in the latest run of each scanner */
  components_unavailable: number
  /** brand/scanner pairs whose latest run failed or was cancelled — those checked nothing */
  scans_failed: number
}

export interface TrendPoint {
  date: string
  total: number
  low: number
  medium: number
  high: number
  critical: number
}

// ------------------------------------------------------------------ dashboard (GET /dashboard/overview, /dashboard/breakdown)
export type ByRisk = Record<RiskLevel, number>

/** A number for the period and for the previous period of the same length (null = nothing to measure) */
export interface Comparable {
  value: number | null
  previous: number | null
}

/** One row of the threat table: a reason (why flagged) or a content type */
export interface OverviewRow {
  key: string
  label: string
  current: number
  previous: number
  open: number
  open_high: number
}

/** A risky open social media item (Instagram post, reel or account) */
export interface AttentionItem {
  id: string
  title: string
  url: string
  platform: string
  content_type: string
  author_handle: string | null
  brand_id: string
  brand_name: string | null
  risk_score: number
  risk_level: RiskLevel
  confidence: number
  review_status: Decision
  logo_match: boolean
  /** fake contact details, fake customer care, scam wording, brand abuse, official logo */
  reasons: string[]
  first_seen: string
}

export interface Overview {
  generated_at: string
  period: { from: string; to: string; days: number }
  last_scan_at: string | null
  coverage_gaps: { brand: string; part: string; status: string; message: string }[]
  brands_in_scope: number
  open: { total: number; by_risk: ByRisk; oldest_high_at: string | null }
  new_alerts: Comparable & { daily: number[] }
  confirmed: Comparable
  median_hours_to_decision: Comparable
  false_positive_rate: Comparable
  trend: TrendPoint[]
  workflow: { open: Record<string, number>; closed: Record<string, number> }
  /** why items were flagged */
  reasons: OverviewRow[]
  /** posts, videos, accounts */
  content_types: OverviewRow[]
  brands: {
    id: string
    name: string
    open: number
    by_risk: ByRisk
    current: number
    previous: number
    last_scan_at: string | null
    gaps: number
  }[]
  attention: AttentionItem[]
  attention_total: number
}

/** Filters shared by the overview and the breakdown */
export interface DashboardQuery {
  brand_id?: string[]
  risk_level?: RiskLevel[]
  /** reason chips: fake contact details, fake customer care, scam wording, brand abuse, official logo */
  reason?: string[]
  days?: number
  from?: string
  to?: string
}

export type BreakdownGroup = "reason" | "content_type" | "platform"
export type BreakdownMeasure = "new" | "open"

export interface BreakdownQuery extends DashboardQuery {
  group: BreakdownGroup
  measure: BreakdownMeasure
  content_type?: string[]
  platform?: string[]
  logo_match?: boolean
}

export interface BreakdownRow {
  key: string
  label: string
  total: number
  /** null when measure = open (no previous period) */
  previous: number | null
  by_risk: ByRisk
}

export interface Breakdown {
  group: BreakdownGroup
  measure: BreakdownMeasure
  period: { from: string; to: string; days: number }
  total: number
  rows: BreakdownRow[]
  trend: TrendPoint[]
}

// ------------------------------------------------------------------ scoring and logo comparison (shared by social media)
export interface RiskBreakdown {
  score?: number
  level?: string
  raw_score?: number
  cap?: string | null
  cap_reason?: string | null
  rules?: Record<string, number>
  policy?: string
}

export interface ConfidenceBreakdown {
  score?: number
  level?: string
  policy?: string
  factors?: { factor: string; points: number; why: string }[]
}

/** Logo comparison (backend integrations/vision/logo-matcher): located by shape, aligned, then compared */
export interface LogoComparison {
  matched: boolean
  /** overall 0–100: shape 35 %, design 25 %, colour 20 %, text 20 % */
  score: number
  method: "fingerprint" | "shape" | null
  source: "thumbnail" | "page_image" | "screenshot"
  checks: { shape: number; design: number; colour: number; text: number | null }
  inliers: number
  inlier_ratio: number
  /** corners of the located logo in the found image (original pixels), clockwise from top-left */
  box: [number, number][] | null
  /** official x,y → found x,y (original pixels) */
  points: [number, number, number, number][]
  image_size: [number, number]
  logo_size: [number, number] | null
  text_found: string | null
  text_expected: string | null
  colours: { logo: string[]; found: string[] }
  reason: string
  found_image_url: string | null
  found_image_source: string | null
  official_logo_url: string | null
  official_logo_name: string | null
  candidates: { url: string; score: number; matched: boolean; inliers: number; reason: string }[]
}

// ------------------------------------------------------------------ social media (Node API)
/** Where social content is collected from (Apify actors, paid) — Instagram only in this sprint */
export type SocialSource = "instagram"
export type SocialContentType = "video" | "post" | "ad" | "channel" | "account"

export interface SocialItem {
  id: string
  brand_id: string
  scan_id: string | null
  platform: string
  content_type: SocialContentType
  url: string
  title: string
  text: string
  author: string | null
  author_handle: string | null
  author_url: string | null
  published_at: string | null
  thumbnail_url: string | null
  metrics: Record<string, unknown>
  discovery: string
  query: string | null
  is_official: boolean
  first_seen: string
  last_seen: string
  times_seen: number
  analysed_at: string | null
  /** true = about the brand, false = not (or official), null = not analysed yet */
  relevant: boolean | null
  risk_score: number | null
  risk_level: RiskLevel | null
  confidence: number | null
  confidence_level: string | null
  /** Finding = analysed with full content; Candidate = only a search snippet */
  stage: string | null
  structured: boolean
  headline: string | null
  /** fake contact details · fake customer care · scam wording · brand abuse · official logo */
  reasons: string[]
  signals: Record<string, boolean | number | null>
  scam_contacts: Record<string, string[]>
  other_links: Record<string, string[]>
  scam_phrases: string[]
  brand_terms: string[]
  logo_match: boolean
  logo_match_score: number | null
  logo_comparison: LogoComparison | null
  review_status: Decision
  review_note: string | null
  reviewed_at: string | null
  reviewed_by: string | null
}

export interface SocialItemDetail extends SocialItem {
  details: Record<string, unknown>
  scoring: { risk?: RiskBreakdown; confidence?: ConfidenceBreakdown; [key: string]: unknown }
  evidence: { kind: string; content_type: string; url: string | null; meta: Record<string, unknown> }[]
}

export interface SocialPage {
  items: SocialItem[]
  total: number
  page: number
  page_size: number
}

type LevelCounts = Record<RiskLevel, number> & { total: number }
export interface SocialSummary {
  brand_id: string
  collected: number
  relevant: number
  flagged: number
  pending_analysis: number
  logo_matches: number
  by_platform: ({ platform: string } & LevelCounts)[]
  by_risk_level: LevelCounts
  by_content_type: { content_type: SocialContentType; total: number; flagged: number }[]
  by_reason: { reason: string; count: number }[]
  by_review_status: Record<string, number>
  last_collection: { id: string; status: string; started_at: string | null; finished_at: string | null; created_at: string } | null
  last_seen: string | null
  last_analysed: string | null
}

export interface SocialAnalyseResult {
  analysed: number
  relevant: number
  flagged: number
  remaining: number
  failed: number
  duration_seconds: number
}

export interface SocialSourcesStatus {
  configured?: boolean
  platforms?: string[]
  [key: string]: unknown
}

// ------------------------------------------------------------------ brand search / add details
export interface BrandSearchItem extends Brand {
  /** where q was found: name, description, keyword, product_term, domain, email_domain, social_handle, … */
  matched_on: string[]
}

export interface BrandSearchPage {
  items: BrandSearchItem[]
  total: number
  page: number
  page_size: number
}

export interface AddDetailsInput {
  keywords?: string[]
  product_terms?: string[]
  domains?: string[]
  email_domains?: string[]
  social_handles?: string[]
  packages?: string[]
  publishers?: string[]
  signing_certs?: string[]
  description?: string
}

export interface AddDetailsResult {
  brand: Brand
  added: { keywords: string[]; product_terms: string[]; allowlist: AllowEntry[]; description: boolean }
  skipped: { field: string; value: string; reason: string }[]
}

// ------------------------------------------------------------------ token storage
const TOKEN_KEY = "bc.token"
const USER_KEY = "bc.user"

export const session = {
  token(): string | null {
    try {
      return localStorage.getItem(TOKEN_KEY)
    } catch {
      return null
    }
  },
  user(): User | null {
    try {
      const raw = localStorage.getItem(USER_KEY)
      return raw ? (JSON.parse(raw) as User) : null
    } catch {
      return null
    }
  },
  save(token: string, user: User) {
    localStorage.setItem(TOKEN_KEY, token)
    localStorage.setItem(USER_KEY, JSON.stringify(user))
  },
  clear() {
    try {
      localStorage.removeItem(TOKEN_KEY)
      localStorage.removeItem(USER_KEY)
    } catch {
      /* storage unavailable */
    }
  },
}

// ------------------------------------------------------------------ errors
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
    this.name = "ApiError"
  }
}

type FastApiDetail = string | { msg?: string; loc?: (string | number)[] }[] | undefined

function detailMessage(detail: FastApiDetail, fallback: string): string {
  if (typeof detail === "string") return detail
  if (Array.isArray(detail) && detail.length) {
    return detail
      .map((d) => {
        const field = d.loc?.filter((p) => p !== "body" && p !== "query").join(".")
        return field ? `${field}: ${d.msg}` : (d.msg ?? "")
      })
      .join("; ")
  }
  return fallback
}

function onUnauthorized() {
  session.clear()
  if (typeof window !== "undefined" && !window.location.pathname.startsWith("/login")) {
    const next = encodeURIComponent(window.location.pathname + window.location.search)
    // Full reload on purpose: drops every cached query belonging to the expired session
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign(`/login?next=${next}`)
  }
}

// ------------------------------------------------------------------ core request
export type Query = Record<string, string | number | boolean | null | undefined | (string | number)[]>

export function toSearch(query?: Query | URLSearchParams): string {
  if (!query) return ""
  const params = query instanceof URLSearchParams ? new URLSearchParams(query) : new URLSearchParams()
  if (!(query instanceof URLSearchParams)) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === "") continue
      if (Array.isArray(value)) value.forEach((v) => params.append(key, String(v)))
      else params.append(key, String(value))
    }
  }
  const s = params.toString()
  return s ? `?${s}` : ""
}

async function raw(path: string, init: RequestInit = {}, query?: Query | URLSearchParams): Promise<Response> {
  if (!API_ENABLED) throw new ApiError(503, OFFLINE_MESSAGE)
  const headers = new Headers(init.headers)
  const token = session.token()
  if (token) headers.set("Authorization", `Bearer ${token}`)
  if (init.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json")
  }
  let res: Response
  try {
    res = await fetch(`${BASE}${path}${toSearch(query)}`, { ...init, headers })
  } catch {
    throw new ApiError(0, `Cannot reach the API at ${API_URL}. Check that the backend is running.`)
  }
  if (res.status === 401 && !path.startsWith("/auth/login")) {
    onUnauthorized()
    throw new ApiError(401, "Your session has expired. Sign in again.")
  }
  if (!res.ok) {
    let message = `Request failed (${res.status})`
    try {
      const body = (await res.json()) as { detail?: FastApiDetail }
      message = detailMessage(body.detail, message)
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, message)
  }
  return res
}

async function json<T>(path: string, init: RequestInit = {}, query?: Query | URLSearchParams): Promise<T> {
  const res = await raw(path, init, query)
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

/** Download an authenticated file and save it with the server-provided filename. */
async function download(path: string, query: URLSearchParams | Query, fallbackName: string) {
  const res = await raw(path, {}, query)
  const blob = await res.blob()
  const disposition = res.headers.get("Content-Disposition") ?? ""
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition)
  const filename = match ? decodeURIComponent(match[1]) : fallbackName
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  return filename
}

// ------------------------------------------------------------------ endpoints
export const api = {
  login: (email: string, password: string) =>
    json<TokenOut>("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  me: () => json<User>("/auth/me"),

  users: () => json<User[]>("/users"),
  createUser: (body: { email: string; name: string; password: string; role: Role }) =>
    json<User>("/users", { method: "POST", body: JSON.stringify(body) }),
  updateUser: (id: string, body: Partial<{ name: string; password: string; role: Role; is_active: boolean }>) =>
    json<User>(`/users/${id}`, { method: "PATCH", body: JSON.stringify(body) }),

  brands: () => json<Brand[]>("/brands"),
  brand: (id: string) => json<Brand>(`/brands/${id}`),
  createBrand: (body: BrandInput) => json<Brand>("/brands", { method: "POST", body: JSON.stringify(body) }),
  updateBrand: (id: string, body: Partial<BrandInput>) =>
    json<Brand>(`/brands/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteBrand: (id: string) => json<void>(`/brands/${id}`, { method: "DELETE" }),
  uploadAsset: (brandId: string, kind: AssetKind, file: File) => {
    const form = new FormData()
    form.append("kind", kind)
    form.append("file", file)
    return json<Asset>(`/brands/${brandId}/assets`, { method: "POST", body: form })
  },
  deleteAsset: (brandId: string, assetId: string) =>
    json<void>(`/brands/${brandId}/assets/${assetId}`, { method: "DELETE" }),
  addAllow: (brandId: string, kind: AllowKind, value: string) =>
    json<AllowEntry>(`/brands/${brandId}/allowlist`, { method: "POST", body: JSON.stringify({ kind, value }) }),
  deleteAllow: (brandId: string, allowId: string) =>
    json<void>(`/brands/${brandId}/allowlist/${allowId}`, { method: "DELETE" }),

  scans: (query?: { brand_id?: string[]; limit?: number }) => json<Scan[]>("/scans", {}, query),
  autoScan: () => json<AutoScanSettings>("/settings/auto-scan"),
  setAutoScan: (enabled: boolean) =>
    json<AutoScanSettings>("/settings/auto-scan", { method: "PUT", body: JSON.stringify({ enabled }) }),
  startScan: (brand_id: string, modules: ModuleName[] | null, range?: { date_from?: string | null; date_to?: string | null }) =>
    json<Scan[]>("/scans", {
      method: "POST",
      body: JSON.stringify({ brand_id, modules, date_from: range?.date_from || null, date_to: range?.date_to || null }),
    }),

  alerts: (query: URLSearchParams) => json<AlertPage>("/alerts", {}, query),
  alert: (id: string) => json<AlertDetail>(`/alerts/${id}`),
  setStatus: (id: string, status: Decision, note?: string, addToAllowlist = false) =>
    json<AlertDetail>(`/alerts/${id}/status`, {
      method: "POST",
      body: JSON.stringify({ status, note: note?.trim() ? note.trim() : null, add_to_allowlist: addToAllowlist }),
    }),

  findings: (query: URLSearchParams) => json<FindingPage>("/findings", {}, query),
  finding: (id: string) => json<FindingDetail>(`/findings/${id}`),
  related: (id: string) => json<RelatedFinding[]>(`/findings/${id}/related`),
  decide: (id: string, decision: Decision, note?: string, addToAllowlist = false) =>
    json<FindingDetail>(`/findings/${id}/decision`, {
      method: "POST",
      body: JSON.stringify({ decision, note: note?.trim() ? note.trim() : null, add_to_allowlist: addToAllowlist }),
    }),
  bulkDecide: (findingIds: string[], decision: Decision, note?: string) =>
    json<Finding[]>("/findings/decision", {
      method: "POST",
      body: JSON.stringify({ finding_ids: findingIds, decision, note: note?.trim() ? note.trim() : null }),
    }),

  executive: (brandIds: string[]) => json<ExecutiveStats>("/stats/executive", {}, { brand_id: brandIds }),
  trends: (days: number, brandIds: string[]) => json<TrendPoint[]>("/stats/trends", {}, { days, brand_id: brandIds }),

  exportAlerts: (format: "csv" | "pdf", query: URLSearchParams) =>
    download(`/exports/alerts.${format}`, query, `alerts.${format}`),
  exportFindings: (format: "csv" | "pdf", query: URLSearchParams) =>
    download(`/exports/findings.${format}`, query, `findings.${format}`),

  // ---------------------------------------------------------------- Node API: brands extras
  searchBrands: (query: { q?: string; page?: number; page_size?: number }) =>
    json<BrandSearchPage>("/brands/search", {}, query),
  addBrandDetails: (id: string, body: AddDetailsInput) =>
    json<AddDetailsResult>(`/brands/${id}/details`, { method: "POST", body: JSON.stringify(body) }),

  // ---------------------------------------------------------------- Node API: dashboard
  overview: (query: DashboardQuery) => json<Overview>("/dashboard/overview", {}, { ...query }),
  breakdown: (query: BreakdownQuery) => json<Breakdown>("/dashboard/breakdown", {}, { ...query }),

  // ---------------------------------------------------------------- Node API: social media
  socialItems: (query: URLSearchParams) => json<SocialPage>("/social-media/items", {}, query),
  socialItem: (id: string) => json<SocialItemDetail>(`/social-media/items/${id}`),
  socialSummary: (brandId: string) => json<SocialSummary>("/social-media/summary", {}, { brand_id: brandId }),
  reviewSocialItem: (id: string, status: Decision, note?: string) =>
    json<SocialItemDetail>(`/social-media/items/${id}/review`, {
      method: "PATCH",
      body: JSON.stringify(note?.trim() ? { status, note: note.trim() } : { status }),
    }),
  analyseSocial: (brandId: string) =>
    json<SocialAnalyseResult>("/social-media/items/analyse", { method: "POST", body: JSON.stringify({ brand_id: brandId }) }),
  socialCollections: (brandId?: string) => json<Scan[]>("/social-media/collections", {}, brandId ? { brand_id: brandId, limit: 10 } : { limit: 10 }),
  startSocialCollection: (body: { brand_id: string; platforms?: SocialSource[] }) =>
    json<Scan>("/social-media/collections", { method: "POST", body: JSON.stringify(body) }),
  cancelSocialCollection: (id: string) => json<Scan>(`/social-media/collections/${id}/cancel`, { method: "POST" }),
  socialSources: () => json<SocialSourcesStatus>("/social-media/apify/status"),
}
