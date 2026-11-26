"use client"

/**
 * Side-by-side logo comparison: the brand's official logo next to the image found on the suspicious site, with the
 * located logo outlined and (on demand) the matching points that tie the two together. Below: how well shape,
 * design, colour and text agree after the found logo was aligned onto the official one.
 */
import { useState } from "react"
import { Check, CircleSlash, ImageOff, ScanSearch, X } from "lucide-react"
import type { LogoComparison } from "@/lib/api"
import { cn } from "@/lib/utils"

const CHECKER =
  "bg-white bg-[linear-gradient(45deg,#f1f3f5_25%,transparent_25%,transparent_75%,#f1f3f5_75%),linear-gradient(45deg,#f1f3f5_25%,transparent_25%,transparent_75%,#f1f3f5_75%)] bg-[length:12px_12px] bg-[position:0_0,6px_6px]"

/** Point-pair markers cycle through a few distinguishable hues — they identify a pair, they are not data */
const PAIR_HUES = ["#1C418C", "#E4572E", "#2A9D8F", "#B07D00", "#8E44AD", "#C0392B"]

function Verdict({ c }: { c: LogoComparison }) {
  const found = c.method !== null
  const [label, style, Icon] = c.matched
    ? (["Official logo verified", { background: "var(--risk-critical)", color: "var(--risk-critical-on)" }, Check] as const)
    : found
      ? (["Similar, but not the official logo", { background: "var(--risk-medium-wash)", color: "var(--risk-medium-ink)" }, CircleSlash] as const)
      : (["Official logo not found", { background: "var(--secondary)", color: "var(--muted-foreground)" }, X] as const)
  return (
    <span className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-semibold" style={style}>
      <Icon className="size-3.5" aria-hidden />
      {label}
    </span>
  )
}

/** An image with an SVG overlay in the image's own pixel space (box and points stay aligned at any size) */
function Overlaid({
  src,
  size,
  alt,
  box,
  points,
  hover,
  onHover,
}: {
  src: string | null
  size: [number, number] | null
  alt: string
  box?: [number, number][] | null
  points?: [number, number][]
  hover: number | null
  onHover: (i: number | null) => void
}) {
  const [broken, setBroken] = useState(false)
  if (!src || broken)
    return (
      <div className={cn("flex h-48 items-center justify-center rounded-md border", CHECKER)}>
        <span className="flex flex-col items-center gap-1 text-xs text-muted-foreground">
          <ImageOff className="size-5" aria-hidden />
          {src ? "Image link expired — reload the page" : "Not available"}
        </span>
      </div>
    )
  const [w, h] = size ?? [100, 100]
  const r = Math.max(w, h) / 90
  return (
    <div className={cn("flex h-56 items-center justify-center rounded-md border p-3", CHECKER)}>
      <div className="relative inline-block max-h-full max-w-full">
        <img src={src} alt={alt} referrerPolicy="no-referrer" onError={() => setBroken(true)} className="block max-h-[200px] max-w-full object-contain" />
        {size && (box || points?.length) ? (
          <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible" aria-hidden>
            {box && (
              <polygon
                points={box.map((p) => p.join(",")).join(" ")}
                fill="rgba(228,87,46,0.08)"
                stroke="#E4572E"
                strokeWidth={2}
                vectorEffect="non-scaling-stroke"
              />
            )}
            {points?.map(([x, y], i) => (
              <circle
                key={i}
                cx={x}
                cy={y}
                r={hover === i ? r * 1.8 : r}
                fill={PAIR_HUES[i % PAIR_HUES.length]}
                stroke="#fff"
                strokeWidth={r / 3}
                opacity={hover === null || hover === i ? 0.95 : 0.25}
                onMouseEnter={() => onHover(i)}
                onMouseLeave={() => onHover(null)}
                style={{ pointerEvents: "all", cursor: "crosshair" }}
              />
            ))}
          </svg>
        ) : null}
      </div>
    </div>
  )
}

function CheckMeter({ label, value, hint, children }: { label: string; value: number | null; hint: string; children?: React.ReactNode }) {
  const tone = value === null ? "var(--muted-foreground)" : value >= 70 ? "var(--status-good)" : value >= 45 ? "var(--status-warning)" : "var(--risk-critical)"
  return (
    <div className="rounded-md border p-2.5" title={hint}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium">{label}</span>
        <span className="tnum text-sm font-semibold">{value === null ? "n/a" : value}</span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[var(--meter-track)]" aria-hidden>
        <div className="h-full rounded-full" style={{ width: `${value ?? 0}%`, background: tone }} />
      </div>
      <div className="mt-1.5 text-[11px] leading-snug text-muted-foreground">{children ?? hint}</div>
    </div>
  )
}

function Swatches({ colours }: { colours: string[] }) {
  if (!colours.length) return <span>—</span>
  return (
    <span className="inline-flex gap-0.5 align-middle">
      {colours.map((c) => (
        <span key={c} className="inline-block size-3 rounded-sm border border-black/10" style={{ background: c }} title={c} />
      ))}
    </span>
  )
}

export function LogoComparisonPanel({ c }: { c: LogoComparison }) {
  const [showPoints, setShowPoints] = useState(false)
  const [hover, setHover] = useState<number | null>(null)
  const pts = showPoints ? c.points : []
  const located = c.method !== null
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <Verdict c={c} />
        {located && (
          <span className="text-xs text-muted-foreground">
            Overall <span className="tnum font-semibold text-foreground">{c.score}</span>/100 ·{" "}
            {c.method === "shape" ? `located by shape, ${c.inliers} matching points (${Math.round(c.inlier_ratio * 100)}% consistent)` : "exact copy (fingerprint)"}
            {c.source === "screenshot" ? " · found in the page screenshot" : ""}
          </span>
        )}
        {c.points.length > 0 && (
          <button
            type="button"
            onClick={() => setShowPoints((v) => !v)}
            className="ml-auto inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            aria-pressed={showPoints}
          >
            <ScanSearch className="size-3.5" aria-hidden />
            {showPoints ? "Hide matching points" : "Show matching points"}
          </button>
        )}
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <figure>
          <Overlaid
            src={c.official_logo_url}
            size={c.logo_size}
            alt="Official logo"
            points={pts.map(([x, y]) => [x, y])}
            hover={hover}
            onHover={setHover}
          />
          <figcaption className="mt-1 text-xs">
            <span className="font-medium">Official logo</span>
            {c.official_logo_name && <span className="text-muted-foreground"> · {c.official_logo_name}</span>}
          </figcaption>
        </figure>
        <figure>
          <Overlaid
            src={c.found_image_url}
            size={c.image_size}
            alt="Image found on the site"
            box={located ? c.box : null}
            points={pts.map(([, , x, y]) => [x, y])}
            hover={hover}
            onHover={setHover}
          />
          <figcaption className="mt-1 text-xs">
            <span className="font-medium">Found on the site</span>
            {located && <span className="text-muted-foreground"> · outlined where the logo was located</span>}
            {c.found_image_source && (
              <div className="truncate font-mono text-[11px] text-muted-foreground" title={c.found_image_source}>
                {c.found_image_source}
              </div>
            )}
          </figcaption>
        </figure>
      </div>

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <CheckMeter label="Shape" value={c.checks.shape} hint="Distinctive points of the official logo found in the same arrangement">
          {located ? `${c.inliers} matching points` : `${c.inliers} points (25 needed)`}
        </CheckMeter>
        <CheckMeter label="Design" value={located ? c.checks.design : null} hint="After alignment: do the outlines and layout of the two logos agree?" />
        <CheckMeter label="Colour" value={located ? c.checks.colour : null} hint="After alignment: colour difference on the logo's own pixels">
          {located ? (
            <span className="inline-flex flex-wrap items-center gap-1">
              Official <Swatches colours={c.colours.logo} /> · found <Swatches colours={c.colours.found} />
            </span>
          ) : undefined}
        </CheckMeter>
        <CheckMeter label="Text" value={located ? c.checks.text : null} hint="Text read inside the logo (OCR) compared with the official logo and brand name">
          {located && c.checks.text !== null ? (
            <span className="break-words">
              Read: <span className="font-mono">{c.text_found || "nothing"}</span>
            </span>
          ) : located ? (
            "The official logo has no readable text"
          ) : undefined}
        </CheckMeter>
      </div>

      <p className="text-xs text-muted-foreground">{c.reason}</p>

      {c.candidates.length > 1 && (
        <details className="text-xs">
          <summary className="cursor-pointer font-medium text-muted-foreground hover:text-foreground">Other images compared ({c.candidates.length})</summary>
          <ol className="mt-1.5 space-y-1">
            {c.candidates.map((m, i) => (
              <li key={i} className="flex items-baseline gap-2">
                {m.matched ? <Check className="size-3.5 shrink-0 self-center text-[var(--risk-critical-ink)]" aria-label="matched" /> : <X className="size-3.5 shrink-0 self-center text-muted-foreground/60" aria-label="not matched" />}
                <span className="tnum w-8 shrink-0 text-right font-semibold">{m.score}</span>
                <span className="min-w-0 flex-1">
                  <span className="block font-mono break-all text-muted-foreground" title="Image URL on the suspicious page (not loaded)">
                    {m.url}
                  </span>
                  <span className="text-muted-foreground/80">{m.reason}</span>
                </span>
              </li>
            ))}
          </ol>
        </details>
      )}
    </div>
  )
}
