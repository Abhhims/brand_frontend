"use client"

/**
 * Social media explorer (GET /dashboard/breakdown): compare Instagram items about the brand by reason (why flagged),
 * content type (post / reel / account) or platform, split by risk, then jump to the matching Social media list.
 * Its own choices (group, measure, view) live in the URL as ex_* params, so a view can be shared; brand, risk,
 * reason and period come from the dashboard's main filters.
 */
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { ArrowRight } from "lucide-react"
import { RiskLegend, TrendChart } from "@/components/charts"
import { Delta, listLink } from "@/components/dashboard"
import { ErrorPanel } from "@/components/query-state"
import { Panel } from "@/components/widgets"
import { Skeleton } from "@/components/ui/skeleton"
import { api, type BreakdownGroup, type BreakdownMeasure, type BreakdownQuery, type BreakdownRow, type DashboardQuery, type RiskLevel } from "@/lib/api"
import { fmtNumber } from "@/lib/format"
import { keys } from "@/lib/queries"
import { cn } from "@/lib/utils"

function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex rounded-lg border bg-background p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "rounded-md px-2.5 py-1 text-xs font-medium whitespace-nowrap text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
            value === o.value && "bg-card text-foreground shadow-xs ring-1 ring-border",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

const ORDER: RiskLevel[] = ["Critical", "High", "Medium", "Low"]

/** One row: name, risk-stacked bar (length = total), total, change, link to the list */
function ExploreBar({ row, max, href, measure }: { row: BreakdownRow; max: number; href: string; measure: BreakdownMeasure }) {
  return (
    <li className="group relative grid grid-cols-[minmax(9rem,30%)_1fr_3rem_4.5rem_auto] items-center gap-3 rounded-md px-2 py-1.5 hover:bg-muted/60 focus-within:bg-muted/60">
      <span className="truncate text-sm font-medium" title={row.label}>
        {row.label}
      </span>

      <div className="relative h-5" aria-hidden>
        <div className="flex h-full gap-[2px] overflow-hidden rounded-r-[4px]" style={{ width: `${max ? Math.max(row.total ? 1.5 : 0, (row.total / max) * 100) : 0}%` }}>
          {ORDER.map((l) =>
            row.by_risk[l] > 0 ? (
              <span
                key={l}
                className="flex h-full min-w-[3px] items-center overflow-hidden"
                style={{ flexGrow: row.by_risk[l], flexBasis: 0, background: `var(--risk-${l.toLowerCase()})`, color: `var(--risk-${l.toLowerCase()}-on)` }}
              >
                {row.total > 0 && row.by_risk[l] / max >= 0.08 && <span className="tnum px-1.5 text-[11px] font-semibold">{row.by_risk[l]}</span>}
              </span>
            ) : null,
          )}
        </div>
        {/* hover/focus card with the full split */}
        <div className="pointer-events-none absolute top-full left-0 z-20 mt-1 hidden min-w-44 rounded-lg border bg-popover px-3 py-2 text-xs shadow-lg group-hover:block group-focus-within:block">
          <div className="mb-1.5 flex justify-between gap-4 font-medium">
            <span className="truncate">{row.label}</span>
            <span className="tnum">{fmtNumber(row.total)}</span>
          </div>
          {ORDER.map((l) => (
            <div key={l} className="flex items-center justify-between gap-4 py-0.5">
              <span className="flex items-center gap-2 text-muted-foreground">
                <span className="size-2.5 rounded-[3px]" style={{ background: `var(--risk-${l.toLowerCase()})` }} />
                {l}
              </span>
              <span className="tnum">{fmtNumber(row.by_risk[l])}</span>
            </div>
          ))}
        </div>
      </div>
      <span className="sr-only">{ORDER.map((l) => `${l} ${row.by_risk[l]}`).join(", ")}</span>

      <span className="tnum text-right text-sm font-semibold">{fmtNumber(row.total)}</span>
      <span className="text-right">
        {measure === "new" ? <Delta value={row.total} previous={row.previous} /> : <span className="text-xs text-muted-foreground">open</span>}
      </span>
      <Link
        href={href}
        className="inline-flex items-center gap-1 rounded text-xs font-medium text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
        title="Open these in the Social media list"
      >
        List <ArrowRight className="size-3" aria-hidden />
      </Link>
    </li>
  )
}

const GROUPS: { value: BreakdownGroup; label: string; column: string }[] = [
  { value: "reason", label: "Why flagged", column: "Reason" },
  { value: "content_type", label: "Content type", column: "Content type" },
  { value: "platform", label: "Platform", column: "Platform" },
]

export function ModuleExplorer({
  filters,
  inPeriod,
  className,
}: {
  /** the dashboard's main filters, as sent to the API */
  filters: DashboardQuery
  from?: string
  to?: string | null
  inPeriod: string
  className?: string
}) {
  const params = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()

  const group: BreakdownGroup = GROUPS.find((g) => g.value === params.get("ex_group"))?.value ?? "reason"
  const measure: BreakdownMeasure = params.get("ex_measure") === "open" ? "open" : "new"
  const view = params.get("ex_view") === "time" ? "time" : "compare"

  const update = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params)
    for (const [k, v] of Object.entries(patch)) {
      next.delete(k)
      if (v !== null) next.set(k, v)
    }
    const s = next.toString()
    router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false })
  }

  const query: BreakdownQuery = { ...filters, group, measure }
  const data = useQuery({ queryKey: keys.breakdown(query), queryFn: () => api.breakdown(query), placeholderData: keepPreviousData })
  const d = data.data
  const max = d ? Math.max(1, ...d.rows.map((r) => r.total)) : 1

  const scope = { brandIds: filters.brand_id ?? [], risks: filters.risk_level ?? [] }
  const listHref = (extra: Record<string, string | undefined> = {}) =>
    listLink({ ...(measure === "open" ? { review_status: ["New", "Investigating", "Confirmed Threat"] } : { sort: "first_seen" }), ...extra }, scope)
  const rowHref = (r: BreakdownRow) =>
    group === "content_type" ? listHref({ content_type: r.key }) : group === "reason" && r.key === "official logo" ? listHref({ logo_match: "true" }) : listHref()

  const groupInfo = GROUPS.find((g) => g.value === group)!
  const measureText = measure === "new" ? `first seen ${inPeriod}` : "open now"

  return (
    <Panel
      className={className}
      title="Explore Instagram items"
      description={
        view === "compare"
          ? `${groupInfo.label}: ${measureText}, split by risk. Select List to open them.`
          : `${groupInfo.label}: first seen per day. Select a day to open the list.`
      }
      actions={<RiskLegend />}
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Segmented
          label="Group by"
          value={group}
          onChange={(v) => update({ ex_group: v === "reason" ? null : v })}
          options={GROUPS.map((g) => ({ value: g.value, label: g.label }))}
        />
        <div className="ml-auto flex flex-wrap gap-2">
          <Segmented
            label="Measure"
            value={measure}
            onChange={(v) => update({ ex_measure: v === "new" ? null : v })}
            options={[
              { value: "new", label: "New in period" },
              { value: "open", label: "Open now" },
            ]}
          />
          <Segmented
            label="View"
            value={view}
            onChange={(v) => update({ ex_view: v === "compare" ? null : v })}
            options={[
              { value: "compare", label: "Compare" },
              { value: "time", label: "Over time" },
            ]}
          />
        </div>
      </div>

      {data.error ? (
        <ErrorPanel error={data.error} onRetry={() => data.refetch()} title="Couldn't load the breakdown" />
      ) : !d ? (
        <Skeleton className="h-64 w-full" />
      ) : view === "time" ? (
        <TrendChart data={d.trend} alertsHref={() => listHref()} />
      ) : d.rows.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          {measure === "new" ? `Nothing first seen ${inPeriod} matches these filters.` : "Nothing open matches these filters."}
        </p>
      ) : (
        <>
          <div className="grid grid-cols-[minmax(9rem,30%)_1fr_3rem_4.5rem_auto] gap-3 border-b px-2 pb-1.5 text-xs text-muted-foreground">
            <span>{groupInfo.column}</span>
            <span>By risk</span>
            <span className="text-right">Total</span>
            <span className="text-right">{measure === "new" ? "Change" : ""}</span>
            <span className="w-12" />
          </div>
          <ul className={cn("mt-1 transition-opacity", data.isFetching && "opacity-70")}>
            {d.rows.map((r) => (
              <ExploreBar key={r.key} row={r} max={max} measure={measure} href={rowHref(r)} />
            ))}
          </ul>
          <p className="mt-2 px-2 text-xs text-muted-foreground">
            {group === "reason" ? "An item can have more than one reason, so rows may add up to more than the total. " : ""}
            {fmtNumber(d.total)} {measureText}
            {filters.risk_level?.length ? `, ${filters.risk_level.join(" and ").toLowerCase()} risk only` : ""}. Hover a bar for its risk split.
          </p>
        </>
      )}
    </Panel>
  )
}
