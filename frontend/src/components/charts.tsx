"use client"

import { useRouter } from "next/navigation"
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  LabelList,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type BarShapeProps,
  type TooltipContentProps,
} from "recharts"
import type { NameType, ValueType } from "recharts/types/component/DefaultTooltipContent"
import type { RiskLevel, TrendPoint } from "@/lib/api"
import { fmtDay, fmtNumber } from "@/lib/format"

/** Stacked bottom → top: least severe at the baseline, critical on top */
const RISK_SERIES: { key: "low" | "medium" | "high" | "critical"; level: RiskLevel }[] = [
  { key: "low", level: "Low" },
  { key: "medium", level: "Medium" },
  { key: "high", level: "High" },
  { key: "critical", level: "Critical" },
]
type SeriesKey = (typeof RISK_SERIES)[number]["key"]

type TrendRow = TrendPoint & { avg: number | null }
const GAP = 2 // card-coloured gap between stacked segments
const RADIUS = 4 // rounded data-end, square at the baseline

/**
 * One stacked segment. Only the topmost non-empty segment of a day gets the rounded end; each lower segment
 * gives up 2px at its top so the card colour separates it from the one above (no outline strokes).
 */
function segmentShape(key: SeriesKey) {
  return function Segment(props: BarShapeProps) {
    const { x, y, width, height, fill } = props
    const row = props.payload as TrendRow
    if (!height || height <= 0) return <g />
    const top = [...RISK_SERIES].reverse().find((s) => row[s.key] > 0)?.key === key
    const h = top ? height : height - GAP
    const yy = top ? y : y + GAP
    if (h <= 0) return <g />
    const r = top ? Math.min(RADIUS, width / 2, h) : 0
    const d = r
      ? `M${x},${yy + h} L${x},${yy + r} Q${x},${yy} ${x + r},${yy} L${x + width - r},${yy} Q${x + width},${yy} ${x + width},${yy + r} L${x + width},${yy + h} Z`
      : `M${x},${yy} h${width} v${h} h${-width} Z`
    return <path d={d} fill={fill} />
  }
}

function TrendTooltip({ active, payload, label }: TooltipContentProps<ValueType, NameType>) {
  if (!active || !payload?.length) return null
  const point = payload[0].payload as TrendRow
  return (
    <div className="min-w-44 rounded-lg border bg-popover px-3 py-2.5 text-xs shadow-lg">
      <div className="mb-2 flex items-baseline justify-between gap-4">
        <span className="font-medium">{fmtDay(String(label))}</span>
        <span className="tnum text-sm font-semibold">{fmtNumber(point.total)}</span>
      </div>
      <ul className="space-y-1">
        {[...RISK_SERIES].reverse().map((s) => (
          <li key={s.key} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-2 text-muted-foreground">
              <span className="size-2.5 rounded-[3px]" style={{ background: `var(--risk-${s.key})` }} aria-hidden />
              {s.level}
            </span>
            <span className="tnum font-medium">{fmtNumber(point[s.key])}</span>
          </li>
        ))}
      </ul>
      {point.avg !== null && (
        <div className="mt-2 flex items-center justify-between gap-4 border-t pt-2 text-muted-foreground">
          <span className="flex items-center gap-2">
            <span className="h-0.5 w-3 rounded-full bg-[var(--avg-line)]" aria-hidden />
            7-day average
          </span>
          <span className="tnum">{point.avg.toFixed(1)}</span>
        </div>
      )}
      <p className="mt-2 text-[11px] text-muted-foreground">Click to open this day&apos;s results</p>
    </div>
  )
}

export function RiskLegend({ withAverage = false }: { withAverage?: boolean }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-3.5 gap-y-1 text-xs text-muted-foreground">
      {[...RISK_SERIES].reverse().map((s) => (
        <li key={s.key} className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-[3px]" style={{ background: `var(--risk-${s.key})` }} aria-hidden />
          {s.level}
        </li>
      ))}
      {withAverage && (
        <li className="flex items-center gap-1.5">
          <span className="h-0.5 w-3.5 rounded-full bg-[var(--avg-line)]" aria-hidden />
          7-day average
        </li>
      )}
    </ul>
  )
}

/**
 * Day totals printed above the bars: every day when there are few bars, otherwise only the busiest day
 * (a number on every bar of a 30/90-day chart would be unreadable).
 */
function totalLabel(rows: TrendRow[]) {
  const every = rows.length <= 14
  const peak = Math.max(...rows.map((r) => r.total))
  return function TotalLabel(props: { x?: number | string; y?: number | string; width?: number | string; value?: unknown; index?: number }) {
    const total = Number(props.value)
    if (!total || (!every && total !== peak)) return null
    if (!every && rows.findIndex((r) => r.total === peak) !== props.index) return null
    const x = Number(props.x) + Number(props.width) / 2
    return (
      <text x={x} y={Number(props.y) - 6} textAnchor="middle" fontSize={11} fontWeight={600} fill="var(--foreground)" style={{ fontVariantNumeric: "tabular-nums" }}>
        {every ? total : `Peak ${total}`}
      </text>
    )
  }
}

/** A rolling 7-day average only says something once there are a couple of weeks of data */
export const showsAverage = (days: number) => days > 14

/**
 * New alerts per day, stacked by risk, with a 7-day rolling average of the total (same unit, same axis) so the
 * direction is readable through day-to-day noise. Clicking a day opens that day's alerts.
 */
export function TrendChart({ data, alertsHref }: { data: TrendPoint[]; alertsHref: (day: string) => string }) {
  const router = useRouter()
  const withAvg = showsAverage(data.length)
  const rows: TrendRow[] = data.map((d, i) => {
    if (!withAvg || i < 6) return { ...d, avg: null }
    const win = data.slice(i - 6, i + 1)
    return { ...d, avg: win.reduce((a, p) => a + p.total, 0) / win.length }
  })
  return (
    <>
      <div className="h-72 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={rows}
            margin={{ top: 22, right: 4, bottom: 0, left: -8 }}
            barCategoryGap={data.length > 45 ? "12%" : "22%"}
            onClick={(state) => {
              const day = state?.activeLabel
              if (day) router.push(alertsHref(String(day)))
            }}
            className="cursor-pointer"
          >
            <CartesianGrid vertical={false} stroke="var(--grid)" />
            <XAxis
              dataKey="date"
              tickFormatter={fmtDay}
              interval="preserveStartEnd"
              tickLine={false}
              axisLine={{ stroke: "var(--axis)" }}
              tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
              tickMargin={8}
              minTickGap={32}
            />
            <YAxis
              allowDecimals={false}
              tickLine={false}
              axisLine={false}
              width={40}
              tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
            />
            <Tooltip content={TrendTooltip} cursor={{ fill: "var(--muted)", opacity: 0.7 }} />
            {RISK_SERIES.map((s) => (
              <Bar
                key={s.key}
                dataKey={s.key}
                stackId="risk"
                fill={`var(--risk-${s.key})`}
                maxBarSize={24}
                shape={segmentShape(s.key)}
                isAnimationActive={false}
                name={s.level}
              >
                {s.key === "critical" && <LabelList dataKey="total" content={totalLabel(rows)} />}
              </Bar>
            ))}
            {withAvg && (
              <Line
                dataKey="avg"
                type="monotone"
                stroke="var(--avg-line)"
                strokeWidth={2}
                strokeOpacity={0.75}
                strokeLinecap="round"
                strokeLinejoin="round"
                dot={false}
                activeDot={{ r: 4, fill: "var(--avg-line)", stroke: "var(--card)", strokeWidth: 2 }}
                isAnimationActive={false}
                name="7-day average"
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <table className="sr-only">
        <caption>New alerts per day by risk level</caption>
        <thead>
          <tr>
            <th>Date</th>
            <th>Critical</th>
            <th>High</th>
            <th>Medium</th>
            <th>Low</th>
            <th>Total</th>
            <th>7-day average</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((d) => (
            <tr key={d.date}>
              <td>{d.date}</td>
              <td>{d.critical}</td>
              <td>{d.high}</td>
              <td>{d.medium}</td>
              <td>{d.low}</td>
              <td>{d.total}</td>
              <td>{d.avg === null ? "" : d.avg.toFixed(1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}

export interface BarRow {
  key: string
  label: string
  value: number
  href: string
  /** CSS colour for the bar; defaults to the single-series hue */
  color?: string
  marker?: React.ReactNode
}

/**
 * Horizontal bar list: label left, value at the tip. Plain HTML so labels never clip and each
 * row is a real link to the filtered queue.
 */
export function BarList({ rows, emptyText = "Nothing open" }: { rows: BarRow[]; emptyText?: string }) {
  const router = useRouter()
  const max = Math.max(1, ...rows.map((r) => r.value))
  const total = rows.reduce((a, r) => a + r.value, 0)
  return (
    <div>
      <ul className="space-y-1">
        {rows.map((r) => (
          <li key={r.key}>
            <button
              type="button"
              onClick={() => router.push(r.href)}
              className="group grid w-full grid-cols-[minmax(7rem,38%)_1fr] items-center gap-3 rounded-md px-1.5 py-1 text-left text-sm outline-none hover:bg-muted/70 focus-visible:ring-2 focus-visible:ring-ring"
              title={`${r.label}: ${r.value}`}
            >
              <span className="flex min-w-0 items-center gap-2">
                {r.marker}
                <span className="truncate text-foreground/85">{r.label}</span>
              </span>
              <span className="flex items-center gap-2">
                <span
                  className="h-3.5 rounded-r-[4px] transition-[width]"
                  style={{
                    width: r.value === 0 ? "2px" : `calc(${(r.value / max) * 100}% - 2.5rem)`,
                    minWidth: r.value === 0 ? 2 : 4,
                    background: r.value === 0 ? "var(--meter-track)" : (r.color ?? "var(--series-1)"),
                  }}
                />
                <span className="tnum text-xs font-medium text-foreground/80">{fmtNumber(r.value)}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      {total === 0 && <p className="mt-2 px-1.5 text-xs text-muted-foreground">{emptyText}</p>}
    </div>
  )
}
