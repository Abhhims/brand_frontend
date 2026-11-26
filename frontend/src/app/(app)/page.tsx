"use client"

import { Suspense, useState, useSyncExternalStore } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { Download, RefreshCw, X } from "lucide-react"
import { PageHeader } from "@/components/app-shell"
import { RiskMeter } from "@/components/badges"
import {
  AttentionPanel,
  BrandsPanel,
  MetricsRow,
  NoDataYet,
  PostureBand,
  ThreatsPanel,
  TrendPanel,
  WorkflowPanel,
  type Scope,
} from "@/components/dashboard"
import { DateRangePicker } from "@/components/date-range-picker"
import { ModuleExplorer } from "@/components/module-explorer"
import { ErrorPanel } from "@/components/query-state"
import { MultiFilter } from "@/components/widgets"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { api, type DashboardQuery, type Overview, type RiskLevel } from "@/lib/api"
import { RISK_LEVELS, SOCIAL_REASONS, reasonLabel } from "@/lib/constants"
import { fmtDate } from "@/lib/format"
import { keys, useBrands } from "@/lib/queries"
import { cn } from "@/lib/utils"

const PERIODS = [
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
] as const
const DEFAULT_DAYS = 30

function useFilters() {
  const params = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()

  const brandIds = params.getAll("brand").filter((id) => UUID.test(id))
  const reasons = params.getAll("reason").filter((r) => SOCIAL_REASONS.some((x) => x.key === r))
  const risks = params.getAll("risk").filter((r): r is RiskLevel => (RISK_LEVELS as string[]).includes(r))
  // Period: a preset (?days=7|30|90) or a custom range (?from=YYYY-MM-DD&to=YYYY-MM-DD) from the calendar
  const range = customRange(params.get("from"), params.get("to"))
  const d = Number(params.get("days"))
  const presetDays = PERIODS.some((p) => p.days === d) ? d : DEFAULT_DAYS
  const days = range ? range.days : presetDays
  // "now" is read once per mount so render stays pure
  const [now] = useState(() => Date.now())
  const today = isoDay(new Date(now))
  const from = range ? range.from : isoDay(new Date(now - (days - 1) * DAY))
  const to = range && range.to !== today ? range.to : null
  const end = range && range.to !== today ? range.end : undefined
  const inPeriod = range ? (range.from === range.to ? `on ${fmtShort(range.from)}` : `from ${fmtShort(range.from)} to ${fmtShort(range.to)}`) : `in the last ${days} days`

  const replace = (next: URLSearchParams) => {
    const s = next.toString()
    router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false })
  }
  /** MultiFilter change → URL: add/remove one value, or [] to clear the key */
  const toggle = (key: string) => (change: { value: string; checked: boolean } | []) => {
    const next = new URLSearchParams(params)
    if (Array.isArray(change)) next.delete(key)
    else if (change.checked) next.append(key, change.value)
    else next.delete(key, change.value)
    replace(next)
  }
  const setDays = (n: number) => {
    const next = new URLSearchParams(params)
    next.delete("from")
    next.delete("to")
    if (n === DEFAULT_DAYS) next.delete("days")
    else next.set("days", String(n))
    replace(next)
  }
  /** from the calendar: DD/MM/YYYY strings ("" = cleared → back to the default period) */
  const setRange = (start: Date | null, endDate: Date | null) => {
    const next = new URLSearchParams(params)
    next.delete("days")
    next.delete("from")
    next.delete("to")
    if (start && endDate) {
      next.set("from", isoDay(start))
      next.set("to", isoDay(endDate))
    }
    replace(next)
  }
  const focusBrand = (id: string) => {
    const next = new URLSearchParams(params)
    next.delete("brand")
    next.append("brand", id)
    replace(next)
    window.scrollTo({ top: 0, behavior: "smooth" })
  }
  /** clears the main filters; keeps the module explorer's own choices (ex_*) */
  const reset = () => {
    const next = new URLSearchParams()
    for (const [k, v] of params) if (k.startsWith("ex_")) next.append(k, v)
    replace(next)
  }
  const active = brandIds.length + reasons.length + risks.length > 0 || days !== DEFAULT_DAYS || !!range
  /** what the overview and breakdown endpoints get */
  const query: DashboardQuery = {
    brand_id: brandIds.length ? brandIds : undefined,
    reason: reasons.length ? reasons : undefined,
    risk_level: risks.length ? risks : undefined,
    ...(range ? { from: range.from, to: range.to } : { days }),
  }

  return { now, brandIds, reasons, risks, days, range, from, to, end, inPeriod, query, toggle, setDays, setRange, focusBrand, reset, active }
}

const DAY = 86_400_000
const HISTORY_DAYS = 365 // the API accepts periods up to a year
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
const fromIso = (s: string) => {
  const [y, m, d] = s.split("-").map(Number)
  return new Date(y, m - 1, d)
}
const fmtShort = (s: string) => fromIso(s).toLocaleDateString(undefined, { day: "numeric", month: "short" })
const toDmy = (s: string) => {
  const [y, m, d] = s.split("-")
  return `${d}/${m}/${y}`
}

/** A valid ?from/?to pair → its length in days and its end (end of the `to` day, capped at now) */
function customRange(from: string | null, to: string | null) {
  if (!from || !to || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return null
  const a = fromIso(from)
  const b = fromIso(to)
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime()) || b < a) return null
  const days = Math.round((b.getTime() - a.getTime()) / DAY) + 1
  const end = Math.min(Date.now(), b.getTime() + DAY - 1)
  return { from, to, days, end }
}

/** The open High/Critical items behind "Open next" (the overview returns the worst first) */
function exportCsv(o: Overview) {
  const header = ["Risk", "Score", "Confidence", "Title", "Platform", "Type", "Account", "URL", "Brand", "Review status", "Logo match", "Reasons", "First seen (UTC)"]
  const rows = o.attention.map((a) => [
    a.risk_level,
    a.risk_score,
    a.confidence,
    a.title,
    a.platform,
    a.content_type,
    a.author_handle ?? "",
    a.url,
    a.brand_name ?? "",
    a.review_status,
    a.logo_match ? "Yes" : "No",
    a.reasons.map(reasonLabel).join("; "),
    new Date(a.first_seen).toISOString(),
  ])
  const csv = [header, ...rows].map((r) => r.map((v) => `"${String(v).replaceAll('"', '""')}"`).join(",")).join("\r\n")
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }))
  const link = Object.assign(document.createElement("a"), { href: url, download: `open-high-risk-${new Date().toISOString().slice(0, 10)}.csv` })
  link.click()
  URL.revokeObjectURL(url)
}

function Dashboard() {
  const f = useFilters()
  const scope: Scope = { brandIds: f.brandIds, reasons: f.reasons, risks: f.risks, days: f.days, from: f.from, to: f.to, inPeriod: f.inPeriod }
  const brands = useBrands()

  const overview = useQuery({
    queryKey: keys.overview(f.query),
    queryFn: () => api.overview(f.query),
    placeholderData: keepPreviousData,
  })
  const o = overview.data
  const noData = !!o && o.last_scan_at === null && o.open.total === 0 && (o.new_alerts.value ?? 0) === 0

  const scopeText =
    f.brandIds.length === 0
      ? "All brands"
      : (brands.data ?? [])
          .filter((b) => f.brandIds.includes(b.id))
          .map((b) => b.name)
          .join(", ") || "Selected brands"

  return (
    <>
      <PageHeader
        title="Beyond Dashboard"
        description={`${scopeText}, ${fmtDate(new Date().toISOString())}`}
        actions={
          <>
            <Button variant="outline" size="sm" disabled={!o || o.attention.length === 0} onClick={() => o && exportCsv(o)}>
              <Download /> Export open high-risk
            </Button>
            <Button variant="outline" size="icon-sm" aria-label="Refresh" title="Refresh" onClick={() => overview.refetch()}>
              <RefreshCw className={cn(overview.isFetching && "animate-spin")} />
            </Button>
          </>
        }
      />

      <div
        role="toolbar"
        aria-label="Dashboard filters"
        className="sticky top-12 z-10 -mx-4 mb-4 flex flex-wrap items-center gap-2 border-b bg-background/95 px-4 py-2.5 backdrop-blur sm:-mx-6 sm:px-6 lg:top-0 lg:-mx-8 lg:px-8"
      >
        <MultiFilter
          label="Brand"
          value={f.brandIds}
          onChange={f.toggle("brand")}
          options={(brands.data ?? []).map((b) => ({ value: b.id, label: b.name, text: b.name }))}
        />
        <MultiFilter
          label="Reason"
          value={f.reasons}
          onChange={f.toggle("reason")}
          options={SOCIAL_REASONS.map((r) => ({ value: r.key, label: r.label, text: r.label }))}
        />
        <MultiFilter
          label="Risk"
          value={f.risks}
          onChange={f.toggle("risk")}
          options={RISK_LEVELS.map((l) => ({
            value: l,
            text: l,
            label: (
              <span className="flex items-center gap-2">
                <RiskMeter level={l} /> {l}
              </span>
            ),
          }))}
        />
        {f.active && (
          <Button variant="ghost" size="sm" onClick={f.reset} className="text-muted-foreground">
            <X /> Clear filters
          </Button>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-2">
        <div role="radiogroup" aria-label="Period" className="flex rounded-lg border bg-card p-0.5">
          {PERIODS.map((p) => (
            <button
              key={p.days}
              type="button"
              role="radio"
              aria-checked={!f.range && f.days === p.days}
              onClick={() => f.setDays(p.days)}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-medium text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
                !f.range && f.days === p.days && "bg-primary text-primary-foreground hover:text-primary-foreground",
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
        <DateRangePicker
          className="w-[15.5rem]"
          dualCalendar
          disableFutureDates
          minDate={new Date(f.now - (HISTORY_DAYS - 1) * DAY)}
          startDate={toDmy(f.from)}
          endDate={toDmy(f.to ?? isoDay(new Date(f.now)))}
          showTodayButton={false}
          showClearButton={!!f.range}
          onChange={(_s, _e, start, endDate) => f.setRange(start, endDate)}
          placeholder="Custom range"
        />
        </div>
      </div>

      {overview.error && !o ? (
        <ErrorPanel error={overview.error} onRetry={() => overview.refetch()} title="Couldn't load the dashboard" />
      ) : !o ? (
        <div className="space-y-4">
          <Skeleton className="h-48 w-full rounded-xl" />
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-32" />
            ))}
          </div>
          <Skeleton className="h-80 w-full" />
        </div>
      ) : noData ? (
        <NoDataYet filtered={f.active} />
      ) : (
        <div className={cn("transition-opacity", overview.isFetching && "opacity-70")}>
          <PostureBand o={o} scope={scope} />
          <MetricsRow o={o} scope={scope} />

          <div className="mb-4 grid grid-cols-1 gap-4 xl:grid-cols-3">
            <TrendPanel o={o} scope={scope} className="xl:col-span-2" />
            <WorkflowPanel o={o} scope={scope} />
          </div>

          <ModuleExplorer className="mb-4" filters={f.query} from={f.from} to={f.to} inPeriod={f.inPeriod} />

          <div className="mb-4 grid grid-cols-1 gap-4 xl:grid-cols-5">
            <AttentionPanel o={o} scope={scope} className="xl:col-span-3" />
            <ThreatsPanel o={o} scope={scope} className="xl:col-span-2" />
          </div>

          <BrandsPanel o={o} scope={scope} onFocusBrand={f.focusBrand} />
        </div>
      )}
    </>
  )
}

const subscribeNothing = () => () => {}

/**
 * Rendered in the browser only: every number here depends on the current time and the viewer's locale and
 * time zone, which the server cannot know (rendering it on the server caused a hydration mismatch).
 */
export default function DashboardPage() {
  const inBrowser = useSyncExternalStore(subscribeNothing, () => true, () => false)
  if (!inBrowser) return <Skeleton className="h-[60vh] w-full rounded-xl" />
  return (
    <Suspense>
      <Dashboard />
    </Suspense>
  )
}
