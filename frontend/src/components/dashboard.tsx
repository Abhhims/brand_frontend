"use client"

/**
 * Dashboard building blocks (data: GET /api/v1/dashboard/overview). Each block answers one question an analyst
 * asks at the start of a shift:
 *
 *   PostureBand      How exposed are we right now?            (open social media items by risk, coverage)
 *   Metric           Is it getting better or worse?            (period vs previous period)
 *   TrendPanel       When were they found?                     (daily, stacked by risk)
 *   WorkflowPanel    Is the team keeping up?                   (open by review status, closed by outcome)
 *   AttentionPanel   What should I open next?                  (open High/Critical, worst first)
 *   ThreatsPanel     What kind of threats?                     (reasons and content types)
 *   BrandsPanel      Which brand is under pressure?            (one row per brand)
 *
 * Every number links to the Social media list (/social) with the filters it supports applied.
 */
import Link from "next/link"
import { ArrowDownRight, ArrowRight, ArrowUpRight, CircleAlert, Image as ImageIcon, Minus, Radar, ShieldCheck } from "lucide-react"
import { RiskBadge, RiskMeter } from "@/components/badges"
import { RiskLegend, TrendChart, showsAverage } from "@/components/charts"
import { EmptyState, Panel } from "@/components/widgets"
import type { ByRisk, Comparable, Overview, OverviewRow, RiskLevel } from "@/lib/api"
import { RISK_LEVELS, reasonLabel } from "@/lib/constants"
import { fmtDateTime, fmtNumber, fmtRelative } from "@/lib/format"
import { toSearch } from "@/lib/api"
import { cn } from "@/lib/utils"

/** Shared filters every link carries, so the list opens with what the dashboard was showing */
export interface Scope {
  brandIds: string[]
  reasons: string[]
  risks: RiskLevel[]
  days: number
  /** first and last day of the period (YYYY-MM-DD); `to` is null when the period ends today */
  from: string
  to: string | null
  /** the period as words, e.g. "in the last 30 days" or "from 1 Nov to 15 Nov" */
  inPeriod: string
}

const OPEN = { open: "true" }

/** Query values a dashboard link may carry; only the ones the Social media list understands are kept */
export type ListQuery = Record<string, string | string[] | undefined | null>
const LIST_KEYS = ["brand_id", "risk_level", "review_status", "content_type", "logo_match", "sort"]
const SORT_MAP: Record<string, string> = { first_seen: "recent", risk: "risk" }

/** /social link with the dashboard's brand and risk filters (q overrides). The list shows one brand at a time. */
export const listLink = (q: ListQuery, scope: Pick<Scope, "brandIds" | "risks">) => {
  const all: ListQuery = { brand_id: scope.brandIds[0], risk_level: scope.risks, ...q }
  const clean: Record<string, string | string[]> = {}
  for (const k of LIST_KEYS) {
    let v = all[k]
    if (k === "sort" && typeof v === "string") v = SORT_MAP[v]
    if (v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0)) continue
    clean[k] = v
  }
  return `/social${toSearch(clean)}`
}

const periodOf = (scope: Pick<Scope, "from" | "to">) => ({ since: scope.from, until: scope.to ?? undefined })

/** High + Critical, narrowed by the dashboard's risk filter when one is set */
const highRisks = (scope: Pick<Scope, "risks">): RiskLevel[] => {
  const hi: RiskLevel[] = ["Critical", "High"]
  return scope.risks.length ? hi.filter((r) => scope.risks.includes(r)) : hi
}

// ------------------------------------------------------------------ small pieces

/** "3 hours", "5 days" since a timestamp */
function waitedFor(iso: string): string {
  const h = Math.max(0, (Date.now() - new Date(iso).getTime()) / 3_600_000)
  if (h < 1) return "less than an hour"
  if (h < 48) return `${Math.round(h)} hours`
  return `${Math.round(h / 24)} days`
}

export function fmtHours(h: number | null): string {
  if (h === null) return "–"
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min`
  if (h < 48) return `${h < 10 ? h.toFixed(1) : Math.round(h)} h`
  return `${(h / 24).toFixed(1)} days`
}

/**
 * Change against the previous period of the same length. `worseWhen` says which direction is bad, so the colour
 * means "better/worse", not "up/down". Arrow + words carry the meaning without colour.
 */
export function Delta({
  value,
  previous,
  worseWhen = "up",
  suffix,
  className,
}: Comparable & { worseWhen?: "up" | "down"; suffix?: string; className?: string }) {
  if (value === null || previous === null) return <span className={cn("text-xs text-muted-foreground", className)}>No earlier data</span>
  const diff = value - previous
  const pct = previous === 0 ? null : Math.round((diff / previous) * 100)
  if (diff === 0 || pct === 0) {
    return (
      <span className={cn("inline-flex items-center gap-1 text-xs text-muted-foreground", className)}>
        <Minus className="size-3" aria-hidden /> No change{suffix && ` ${suffix}`}
      </span>
    )
  }
  const up = diff > 0
  const worse = (worseWhen === "up") === up
  const Icon = up ? ArrowUpRight : ArrowDownRight
  return (
    <span
      className={cn("inline-flex items-center gap-0.5 text-xs font-medium", className)}
      style={{ color: worse ? "var(--delta-bad)" : "var(--delta-good)" }}
    >
      <Icon className="size-3.5" aria-hidden />
      <span className="sr-only">{up ? "Up" : "Down"}</span>
      {pct === null ? `+${fmtNumber(diff)}` : `${Math.abs(pct)}%`}
      {suffix && <span className="font-normal text-muted-foreground">&nbsp;{suffix}</span>}
    </span>
  )
}

export function Sparkline({ values, className }: { values: number[]; className?: string }) {
  if (values.length < 2) return null
  const w = 120
  const h = 32
  const max = Math.max(1, ...values)
  const pts = values.map((v, i) => [(i / (values.length - 1)) * w, h - 2 - (v / max) * (h - 4)] as const)
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ")
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className={cn("h-8 w-full", className)} aria-hidden>
      <path d={`${line} L${w} ${h} L0 ${h} Z`} fill="var(--series-1)" opacity="0.08" />
      <path d={line} fill="none" stroke="var(--series-1)" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

export interface Part {
  key: string
  label: string
  value: number
  /** CSS colour of the block and of the text printed inside it */
  fill: string
  on: string
  href?: string
}

/**
 * One whole split into parts, as a 28px bar. Each block prints its count at the leading edge when it is wide
 * enough (≥ 7% of the bar); narrower blocks print nothing and keep their count in the tooltip and the legend.
 */
export function SegmentedBar({ parts, label, className }: { parts: Part[]; label: string; className?: string }) {
  const total = parts.reduce((a, p) => a + p.value, 0)
  return (
    <div className={cn("flex h-7 w-full gap-[2px]", className)} role="group" aria-label={label}>
      {total === 0 ? (
        <span className="h-full w-full rounded bg-[var(--meter-track)]" />
      ) : (
        parts
          .filter((p) => p.value > 0)
          .map((p) => {
            const share = p.value / total
            const body = share >= 0.07 ? <span className="tnum truncate px-2 text-xs font-semibold">{fmtNumber(p.value)}</span> : null
            const cls =
              "flex h-full min-w-[6px] items-center overflow-hidden rounded outline-none transition-[filter] hover:brightness-110 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
            const style = { flexGrow: p.value, flexBasis: 0, background: p.fill, color: p.on }
            const title = `${p.label}: ${fmtNumber(p.value)} (${Math.round(share * 100)}%)`
            return p.href ? (
              <Link key={p.key} href={p.href} className={cls} style={style} title={title} aria-label={title}>
                {body}
              </Link>
            ) : (
              <span key={p.key} className={cls} style={style} title={title}>
                {body}
              </span>
            )
          })
      )}
    </div>
  )
}

const riskParts = (byRisk: ByRisk, hrefFor: (l: RiskLevel) => string): Part[] =>
  [...RISK_LEVELS].map((l) => ({
    key: l,
    label: l,
    value: byRisk[l],
    fill: `var(--risk-${l.toLowerCase()})`,
    on: `var(--risk-${l.toLowerCase()}-on)`,
    href: hrefFor(l),
  }))

/** Open items split by risk as one thin bar; each segment is a link */
function RiskBar({ byRisk, hrefFor, className }: { byRisk: ByRisk; hrefFor?: (l: RiskLevel) => string; className?: string }) {
  const total = RISK_LEVELS.reduce((a, l) => a + byRisk[l], 0)
  return (
    <div
      className={cn("flex h-2.5 w-full gap-[2px] overflow-hidden rounded-full", className)}
      style={{ background: "var(--meter-track)" }}
      role="img"
      aria-label={RISK_LEVELS.map((l) => `${l} ${byRisk[l]}`).join(", ")}
    >
      {total > 0 &&
        RISK_LEVELS.map((l) =>
          byRisk[l] > 0 ? (
            hrefFor ? (
              <Link
                key={l}
                href={hrefFor(l)}
                tabIndex={-1}
                style={{ flexGrow: byRisk[l], background: `var(--risk-${l.toLowerCase()})` }}
                title={`${l}: ${byRisk[l]}`}
              />
            ) : (
              <span key={l} style={{ flexGrow: byRisk[l], background: `var(--risk-${l.toLowerCase()})` }} />
            )
          ) : null,
        )}
    </div>
  )
}

// ------------------------------------------------------------------ no data yet

/** Shown instead of the panels until the first scan has stored something */
export function NoDataYet({ filtered }: { filtered: boolean }) {
  return (
    <section className="rounded-lg border bg-card">
      <EmptyState
        icon={Radar}
        title={filtered ? "Nothing matches these filters yet" : "No collections yet"}
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <Link href="/brands" className="inline-flex h-8 items-center rounded-lg border px-3 text-sm font-medium hover:bg-muted">
              Add a brand
            </Link>
            <Link href="/social" className="inline-flex h-8 items-center rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90">
              Start an Instagram collection
            </Link>
          </div>
        }
      >
        {filtered
          ? "No collection has covered this brand or period yet. Clear the filters, or start an Instagram collection for the brand."
          : "Add a brand with its official Instagram handle and logo, then start an Instagram collection. Posts, reels and accounts that misuse the brand will show up here."}
      </EmptyState>
    </section>
  )
}

// ------------------------------------------------------------------ posture band

/**
 * The page's one dark element: a plain-language statement of the current exposure, the open risk split,
 * and how complete the last scan was. "Full coverage" is only claimed when a scan has run and nothing was missed.
 */
export function PostureBand({ o, scope }: { o: Overview; scope: Scope }) {
  const urgent = o.open.by_risk.Critical + o.open.by_risk.High
  const brands = o.brands_in_scope === 1 && o.brands[0] ? o.brands[0].name : `${o.brands_in_scope} ${o.brands_in_scope === 1 ? "brand" : "brands"}`
  const urgentHref = listLink({ ...OPEN, risk_level: highRisks(scope), sort: "risk" }, scope)

  return (
    <section aria-label="Current exposure" className="on-band mb-4 overflow-hidden rounded-xl bg-[var(--band)] text-[var(--band-foreground)]">
      <div className="grid gap-6 px-5 py-5 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:items-center">
        <div className="min-w-0">
          {urgent > 0 ? (
            <h2 className="text-balance">
              <Link href={urgentHref} className="group rounded outline-none focus-visible:ring-2 focus-visible:ring-white/70">
                <span className="tnum block text-5xl leading-none font-semibold tracking-tight">{fmtNumber(urgent)}</span>
                <span className="mt-2 block text-lg leading-snug font-medium group-hover:underline group-hover:underline-offset-4">
                  high-risk Instagram {urgent === 1 ? "item is" : "items are"} waiting for a decision
                </span>
              </Link>
            </h2>
          ) : (
            <h2 className="text-2xl leading-snug font-semibold">Nothing high-risk is waiting for a decision</h2>
          )}
          <p className="mt-2 max-w-xl text-sm text-[var(--band-muted)]">
            {o.open.by_risk.Critical} critical and {o.open.by_risk.High} high across {brands}.
            {o.open.oldest_high_at && <> The oldest has been waiting {waitedFor(o.open.oldest_high_at)}.</>}
          </p>
        </div>

        <div>
          <div className="mb-2 flex items-baseline justify-between text-sm">
            <span className="text-[var(--band-muted)]">All open</span>
            <Link
              href={listLink(OPEN, scope)}
              className="tnum rounded font-semibold outline-none hover:underline focus-visible:ring-2 focus-visible:ring-white/70"
            >
              {fmtNumber(o.open.total)}
            </Link>
          </div>
          <SegmentedBar label="Open by risk" parts={riskParts(o.open.by_risk, (l) => listLink({ ...OPEN, risk_level: l }, scope))} />
          <ul className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--band-muted)]">
            {RISK_LEVELS.map((l) => (
              <li key={l} className="flex items-center gap-1.5">
                <span className="size-2.5 rounded-[3px]" style={{ background: `var(--risk-${l.toLowerCase()})` }} aria-hidden />
                {l}
                <span className="tnum text-[var(--band-foreground)]">
                  {o.open.total ? Math.round((o.open.by_risk[l] / o.open.total) * 100) : 0}%
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-white/10 bg-black/10 px-5 py-2.5 text-sm sm:px-6" role="status">
        {o.last_scan_at === null ? (
          <span className="inline-flex items-center gap-2">
            <CircleAlert className="size-4 text-[var(--status-warning)]" aria-hidden />
            No scan has finished yet, so no result here can be called clean
          </span>
        ) : o.coverage_gaps.length === 0 ? (
          <span className="inline-flex items-center gap-2">
            <ShieldCheck className="size-4 text-[var(--status-good)]" aria-hidden />
            Full coverage
          </span>
        ) : (
          <span className="inline-flex items-center gap-2" title={o.coverage_gaps.map((g) => `${g.brand} · ${g.part}: ${g.message}`).join("\n")}>
            <CircleAlert className="size-4 text-[var(--status-warning)]" aria-hidden />
            Coverage is reduced: {o.coverage_gaps.length} {o.coverage_gaps.length === 1 ? "check" : "checks"} could not run
            <span className="text-[var(--band-muted)]">({o.coverage_gaps.map((g) => `${g.part}, ${g.brand}`).join("; ")})</span>
          </span>
        )}
        {o.last_scan_at && (
          <span className="text-[var(--band-muted)]" title={fmtDateTime(o.last_scan_at)}>
            Last scan {fmtRelative(o.last_scan_at)}
          </span>
        )}
        <Link
          href="/social"
          className="ml-auto rounded text-sm font-medium underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-white/70"
        >
          Review collections
        </Link>
      </div>
    </section>
  )
}

// ------------------------------------------------------------------ period metrics

export function Metric({
  label,
  value,
  delta,
  href,
  help,
  spark,
}: {
  label: string
  value: string
  delta: React.ReactNode
  href?: string
  help: string
  spark?: number[]
}) {
  const body = (
    <>
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="tnum mt-1 text-3xl leading-none font-semibold tracking-tight">{value}</span>
      <span className="mt-2 flex min-h-4 items-center">{delta}</span>
      {spark ? <Sparkline values={spark} className="mt-2" /> : <span className="mt-2 text-xs text-muted-foreground">{help}</span>}
    </>
  )
  const cls = "flex h-full flex-col rounded-lg border bg-card p-4"
  return href ? (
    <Link href={href} title={help} className={cn(cls, "outline-none transition-colors hover:border-primary/50 focus-visible:ring-2 focus-visible:ring-ring")}>
      {body}
    </Link>
  ) : (
    <div title={help} className={cls}>
      {body}
    </div>
  )
}

export function MetricsRow({ o, scope }: { o: Overview; scope: Scope }) {
  const vs = `vs previous ${scope.days === 1 ? "24 h" : `${scope.days} days`}`
  const period = periodOf(scope)
  return (
    <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Metric
        label="New flagged items"
        value={fmtNumber(o.new_alerts.value ?? 0)}
        delta={<Delta {...o.new_alerts} suffix={vs} />}
        href={listLink({ ...period, sort: "first_seen" }, scope)}
        help={`Instagram posts, reels and accounts about the brand first seen ${scope.inPeriod}`}
        spark={o.new_alerts.daily}
      />
      <Metric
        label="Confirmed threats"
        value={fmtNumber(o.confirmed.value ?? 0)}
        delta={<Delta {...o.confirmed} suffix={vs} />}
        href={listLink({ ...period, review_status: ["Confirmed Threat", "Resolved"] }, scope)}
        help="New results an analyst confirmed as real, including ones already taken down"
      />
      <Metric
        label="Median time to decision"
        value={fmtHours(o.median_hours_to_decision.value)}
        delta={<Delta {...o.median_hours_to_decision} suffix={vs} />}
        help="From first seen to an analyst's decision, for results decided in the period"
      />
      <Metric
        label="False-positive rate"
        value={o.false_positive_rate.value === null ? "–" : `${Math.round(o.false_positive_rate.value * 100)}%`}
        delta={<Delta {...o.false_positive_rate} suffix={vs} />}
        href={listLink({ review_status: "False Positive" }, scope)}
        help="Share of decisions in the period marked False Positive. Rising means detection rules need tuning."
      />
    </div>
  )
}

// ------------------------------------------------------------------ trend

export function TrendPanel({ o, scope, className }: { o: Overview; scope: Scope; className?: string }) {
  const high = o.trend.reduce((a, d) => a + d.high + d.critical, 0)
  return (
    <Panel
      className={className}
      title="New items per day"
      description={`${fmtNumber(o.new_alerts.value ?? 0)} ${scope.inPeriod}, ${fmtNumber(high)} of them high or critical. Select a day to open its results.`}
      actions={<RiskLegend withAverage={showsAverage(scope.days)} />}
    >
      <TrendChart data={o.trend} alertsHref={(day) => listLink({ since: day, until: day }, scope)} />
    </Panel>
  )
}

// ------------------------------------------------------------------ workflow

const CLOSED_LABELS = { Resolved: "Taken down / resolved", "False Positive": "False positive", Legitimate: "Legitimate (ours)", Ignored: "Ignored" } as const
const OPEN_ROWS = [
  { key: "New", label: "Not yet looked at", color: "var(--stage-1)", on: "var(--stage-1-on)" },
  { key: "Investigating", label: "Investigating", color: "var(--stage-2)", on: "var(--stage-2-on)" },
  { key: "Confirmed Threat", label: "Confirmed, awaiting takedown", color: "var(--stage-3)", on: "var(--stage-3-on)" },
] as const

export function WorkflowPanel({ o, scope, className }: { o: Overview; scope: Scope; className?: string }) {
  const open = (k: string) => o.workflow.open[k] ?? 0
  const closed = (k: string) => o.workflow.closed[k] ?? 0
  const openTotal = OPEN_ROWS.reduce((a, r) => a + open(r.key), 0)
  const closedTotal = Object.keys(CLOSED_LABELS).reduce((a, k) => a + closed(k), 0)
  return (
    <Panel className={className} title="Review workflow" description="Is the team keeping up with what comes in?">
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-medium">Open now</h3>
        <span className="tnum text-sm font-semibold">{fmtNumber(openTotal)}</span>
      </div>
      <SegmentedBar
        className="mt-2"
        label="Open by review status"
        parts={OPEN_ROWS.map((r) => ({
          key: r.key,
          label: r.label,
          value: open(r.key),
          fill: r.color,
          on: r.on,
          href: listLink({ review_status: r.key }, scope),
        }))}
      />
      <ul className="mt-2 -mx-1.5">
        {OPEN_ROWS.map((r) => (
          <li key={r.key}>
            <Link
              href={listLink({ review_status: r.key }, scope)}
              className="flex items-center gap-2 rounded px-1.5 py-1 text-sm outline-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="size-2.5 rounded-[3px]" style={{ background: r.color }} aria-hidden />
              <span className="text-foreground/85">{r.label}</span>
              <span className="tnum ml-auto font-medium">{fmtNumber(open(r.key))}</span>
            </Link>
          </li>
        ))}
      </ul>

      <div className="mt-4 flex items-baseline justify-between border-t pt-3">
        <h3 className="text-sm font-medium">Closed {scope.inPeriod}</h3>
        <span className="tnum text-sm font-semibold">{fmtNumber(closedTotal)}</span>
      </div>
      <ul className="mt-1 -mx-1.5">
        {(Object.keys(CLOSED_LABELS) as (keyof typeof CLOSED_LABELS)[]).map((k) => {
          const n = closed(k)
          return (
            <li key={k}>
              <Link
                href={listLink({ review_status: k }, scope)}
                className="grid grid-cols-[1fr_5rem_2.5rem] items-center gap-2 rounded px-1.5 py-1 text-sm outline-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="truncate text-foreground/85">{CLOSED_LABELS[k]}</span>
                <span className="h-1.5 overflow-hidden rounded-full bg-[var(--meter-track)]" aria-hidden>
                  <span className="block h-full rounded-full bg-[var(--series-1)]" style={{ width: `${closedTotal ? (n / closedTotal) * 100 : 0}%` }} />
                </span>
                <span className="tnum text-right font-medium">{fmtNumber(n)}</span>
              </Link>
            </li>
          )
        })}
      </ul>
    </Panel>
  )
}

// ------------------------------------------------------------------ needs attention

export function AttentionPanel({
  o,
  scope,
  className,
  limit = 8,
}: {
  o: Overview
  scope: Scope
  className?: string
  limit?: number
}) {
  const href = listLink({ ...OPEN, risk_level: highRisks(scope), sort: "risk" }, scope)
  return (
    <Panel
      className={className}
      title="Open next"
      description={`Open high and critical results, worst first${o.attention_total > limit ? ` (${fmtNumber(limit)} of ${fmtNumber(o.attention_total)})` : ""}`}
      actions={
        <>
          {highRisks(scope).map((l) => (
            <Link
              key={l}
              href={listLink({ ...OPEN, risk_level: l, sort: "risk" }, scope)}
              className="tnum inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
              title={`${o.open.by_risk[l]} open ${l.toLowerCase()}`}
            >
              <span className="size-2 rounded-full" style={{ background: `var(--risk-${l.toLowerCase()})` }} aria-hidden />
              <span className="text-muted-foreground">{l}</span>
              <span className="font-semibold">{fmtNumber(o.open.by_risk[l])}</span>
            </Link>
          ))}
          <Link href={href} className="inline-flex items-center gap-1 rounded text-xs font-medium text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring">
            View all <ArrowRight className="size-3" aria-hidden />
          </Link>
        </>
      }
      bodyClassName="p-0"
    >
      {o.attention.length === 0 ? (
        <EmptyState icon={ShieldCheck} title="Nothing urgent">
          No open high or critical results match these filters.
        </EmptyState>
      ) : (
        <ul className="divide-y">
          {o.attention.slice(0, limit).map((a) => (
            <li key={a.id}>
              <Link
                href={`/social?brand_id=${a.brand_id}&item=${a.id}`}
                className="grid grid-cols-[5.75rem_minmax(0,1fr)_auto] items-center gap-3 px-4 py-2.5 outline-none hover:bg-muted/60 focus-visible:bg-muted/60"
              >
                <RiskBadge level={a.risk_level} score={a.risk_score} className="justify-start" />
                <span className="min-w-0">
                  <span className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
                    <span className="truncate">{a.title}</span>
                    {a.logo_match && (
                      <span title="Official logo found in the image" className="shrink-0 text-[var(--risk-critical-ink)]">
                        <ImageIcon className="size-3.5" aria-label="Logo matched" />
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 flex min-w-0 gap-3 text-xs text-muted-foreground">
                    <span className="whitespace-nowrap text-foreground/85">{a.author_handle ? `@${a.author_handle}` : a.platform}</span>
                    <span className="truncate">{a.brand_name}</span>
                    {a.reasons[0] && <span className="hidden truncate md:inline">{reasonLabel(a.reasons[0])}</span>}
                    <span className={cn("whitespace-nowrap", a.review_status === "New" && "font-medium text-foreground")}>
                      {a.review_status === "New" ? "Not looked at" : a.review_status}
                    </span>
                  </span>
                </span>
                <span className="text-xs whitespace-nowrap text-muted-foreground" title={`First seen ${fmtDateTime(a.first_seen)}`}>
                  {fmtRelative(a.first_seen)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}

// ------------------------------------------------------------------ reasons and content types

/** Filters a reason row stands for on the Social media list (only the logo reason has its own filter) */
const reasonQuery = (key: string): ListQuery => (key === "official logo" ? { logo_match: "true" } : {})

function ThreatRows({ rows, scope, queryFor, emptyText }: { rows: OverviewRow[]; scope: Scope; queryFor: (key: string) => ListQuery; emptyText: string }) {
  const max = Math.max(1, ...rows.map((t) => t.current))
  const period = periodOf(scope)
  if (rows.length === 0)
    return (
      <tbody>
        <tr>
          <td colSpan={4} className="px-4 py-3 text-xs text-muted-foreground">
            {emptyText}
          </td>
        </tr>
      </tbody>
    )
  return (
    <tbody className="divide-y">
      {rows.map((t) => (
        <tr key={t.key} className="hover:bg-muted/50">
          <td className="px-4 py-2">
            <Link href={listLink({ ...period, ...queryFor(t.key) }, scope)} className="block rounded outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring">
              {t.label}
            </Link>
            <span className="mt-1 block h-1 overflow-hidden rounded-full bg-[var(--meter-track)]" aria-hidden>
              <span className="block h-full rounded-full bg-[var(--series-1)]" style={{ width: `${(t.current / max) * 100}%` }} />
            </span>
          </td>
          <td className="tnum px-2 py-2 text-right font-medium">{fmtNumber(t.current)}</td>
          <td className="hidden px-2 py-2 text-right sm:table-cell">
            <Delta value={t.current} previous={t.previous} />
          </td>
          <td className="px-4 py-2 text-right">
            <Link
              href={listLink({ ...OPEN, risk_level: highRisks(scope), ...queryFor(t.key) }, scope)}
              className={cn("tnum rounded font-medium outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring", t.open_high === 0 && "text-muted-foreground/60")}
            >
              {fmtNumber(t.open_high)}
            </Link>
          </td>
        </tr>
      ))}
    </tbody>
  )
}

export function ThreatsPanel({ o, scope, className }: { o: Overview; scope: Scope; className?: string }) {
  // reasons with nothing in them would fill the table with zeros
  const reasons = o.reasons.filter((t) => t.current > 0 || t.open > 0 || scope.reasons.includes(t.key))
  const head = (label: string) => (
    <thead>
      <tr className="border-b text-left text-xs text-muted-foreground">
        <th className="px-4 py-2 font-normal">{label}</th>
        <th className="px-2 py-2 text-right font-normal">New</th>
        <th className="hidden px-2 py-2 text-right font-normal sm:table-cell">Change</th>
        <th className="px-4 py-2 text-right font-normal">Open high</th>
      </tr>
    </thead>
  )
  return (
    <Panel className={className} title="By threat" description={`New ${scope.inPeriod}, and what is still open`} bodyClassName="p-0">
      <table className="w-full text-sm">
        {head("Why flagged")}
        <ThreatRows rows={reasons} scope={scope} queryFor={reasonQuery} emptyText={`Nothing flagged ${scope.inPeriod}.`} />
      </table>
      <table className="w-full border-t text-sm">
        {head("Content type")}
        <ThreatRows rows={o.content_types} scope={scope} queryFor={(k) => ({ content_type: k })} emptyText={`Nothing collected ${scope.inPeriod}.`} />
      </table>
    </Panel>
  )
}

// ------------------------------------------------------------------ brands

export function BrandsPanel({ o, scope, onFocusBrand }: { o: Overview; scope: Scope; onFocusBrand: (id: string) => void }) {
  const rows = [...o.brands].sort((a, b) => b.by_risk.Critical - a.by_risk.Critical || b.by_risk.High - a.by_risk.High || b.open - a.open)
  return (
    <Panel title="By brand" description="Which brand is under the most pressure. Select a brand to focus the whole dashboard on it." bodyClassName="p-0">
      {rows.length === 0 ? (
        <EmptyState title="No brands in scope" className="py-8">
          <Link href="/brands" className="underline underline-offset-2">
            Add a brand
          </Link>{" "}
          to start monitoring it.
        </EmptyState>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[44rem] text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="px-4 py-2 font-normal">Brand</th>
                <th className="w-[28%] px-2 py-2 font-normal">Open by risk</th>
                <th className="px-2 py-2 text-right font-normal">Critical</th>
                <th className="px-2 py-2 text-right font-normal">High</th>
                <th className="px-2 py-2 text-right font-normal">New</th>
                <th className="px-2 py-2 text-right font-normal">Change</th>
                <th className="px-4 py-2 text-right font-normal">Last scan</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((b) => {
                const s = { ...scope, brandIds: [b.id] }
                return (
                  <tr key={b.id} className="hover:bg-muted/50">
                    <td className="px-4 py-2.5">
                      <button
                        type="button"
                        onClick={() => onFocusBrand(b.id)}
                        className="rounded text-left font-medium outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                        title={`Show only ${b.name}`}
                      >
                        {b.name}
                      </button>
                    </td>
                    <td className="px-2 py-2.5">
                      <div className="flex items-center gap-2">
                        <RiskBar byRisk={b.by_risk} hrefFor={(l) => listLink({ ...OPEN, risk_level: l }, s)} />
                        <Link href={listLink(OPEN, s)} className="tnum w-8 shrink-0 text-right text-xs text-muted-foreground hover:underline">
                          {fmtNumber(b.open)}
                        </Link>
                      </div>
                    </td>
                    {(["Critical", "High"] as const).map((l) => (
                      <td key={l} className="px-2 py-2.5 text-right">
                        <Link
                          href={listLink({ ...OPEN, risk_level: l }, s)}
                          className={cn(
                            "tnum inline-flex items-center gap-1.5 rounded font-medium outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring",
                            b.by_risk[l] === 0 && "text-muted-foreground/60",
                          )}
                        >
                          {b.by_risk[l] > 0 && <RiskMeter level={l} />}
                          {fmtNumber(b.by_risk[l])}
                        </Link>
                      </td>
                    ))}
                    <td className="tnum px-2 py-2.5 text-right font-medium">{fmtNumber(b.current)}</td>
                    <td className="px-2 py-2.5 text-right">
                      <Delta value={b.current} previous={b.previous} />
                    </td>
                    <td className="px-4 py-2.5 text-right text-xs whitespace-nowrap text-muted-foreground" title={fmtDateTime(b.last_scan_at)}>
                      {b.gaps > 0 && (
                        <span className="mr-2 inline-flex items-center gap-1 text-foreground/80" title={`${b.gaps} checks could not run`}>
                          <CircleAlert className="size-3.5 text-[var(--status-warning)]" aria-hidden />
                          {b.gaps} {b.gaps === 1 ? "gap" : "gaps"}
                        </span>
                      )}
                      {b.last_scan_at ? fmtRelative(b.last_scan_at) : "Never scanned"}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  )
}
