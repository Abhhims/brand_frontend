"use client"

/**
 * Social media (Instagram): accounts, posts and reels that use the brand — fake customer care numbers, scam contacts,
 * impersonating accounts, the official logo on profile pictures/thumbnails — scored by risk.
 * Data: GET /social-media/items, /social-media/summary; collections run in the worker (Apify, costs credit).
 */
import { Suspense, useEffect, useMemo, useState } from "react"
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import {
  BadgeAlert,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Image as ImageIcon,
  ImageOff,
  Loader2,
  MessageCircleWarning,
  Phone,
  Play,
  RefreshCw,
  Search,
  SearchX,
  Share2,
  X,
} from "lucide-react"
import { PageHeader } from "@/components/app-shell"
import { RiskBadge, RiskMeter, StatusBadge } from "@/components/badges"
import { LogoComparisonPanel } from "@/components/logo-compare"
import { ErrorPanel } from "@/components/query-state"
import { EmptyState, MultiFilter, Panel, SimpleSelect } from "@/components/widgets"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { api, type Decision, type RiskLevel, type SocialItem, type SocialSource } from "@/lib/api"
import { NOTE_REQUIRED, RISK_LEVELS, STATUSES } from "@/lib/constants"
import { fmtDate, fmtDateTime, fmtNumber, fmtRelative } from "@/lib/format"
import { keys, useBrands } from "@/lib/queries"
import { useUrlFilters } from "@/lib/url-filters"
import { cn } from "@/lib/utils"

const FILTER_KEYS = ["platform", "content_type", "risk_level", "review_status", "q", "sort", "logo_match", "flagged_only"]
const PAGE_SIZE = 25
const TYPES = [
  { value: "account", label: "Accounts" },
  { value: "post", label: "Posts" },
  { value: "video", label: "Reels / videos" },
]
const SORTS = [
  { value: "risk", label: "Highest risk first" },
  { value: "recent", label: "Most recently found" },
  { value: "published", label: "Newest posts first" },
]
const REASON_LABEL: Record<string, string> = {
  "fake contact details": "Fake contact details",
  "fake customer care": "Fake customer care",
  "scam wording": "Scam wording",
  "brand abuse": "Brand abuse",
  "official logo": "Official logo",
}
const CONTACT_LABEL: Record<string, string> = { phone: "Phone", whatsapp: "WhatsApp", upi: "UPI", telegram: "Telegram" }
const SOURCES: { value: SocialSource; label: string; paid: boolean; hint: string }[] = [
  { value: "instagram", label: "Instagram", paid: true, hint: "posts, reels and accounts (Apify)" },
]

// ------------------------------------------------------------------ small pieces
function Thumb({ src, alt }: { src: string | null; alt: string }) {
  const [broken, setBroken] = useState(false)
  return (
    <span className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted/40">
      {src && !broken ? (
        <img src={src} alt={alt} referrerPolicy="no-referrer" loading="lazy" onError={() => setBroken(true)} className="size-full object-cover" />
      ) : (
        <ImageOff className="size-4 text-muted-foreground/60" aria-hidden />
      )}
    </span>
  )
}

function ReasonChips({ reasons }: { reasons: string[] }) {
  if (!reasons.length) return null
  return (
    <span className="flex flex-wrap gap-1">
      {reasons.map((r) => (
        <span
          key={r}
          className={cn(
            "rounded-md px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap",
            r === "fake contact details" || r === "fake customer care" ? "bg-[var(--risk-critical-wash)] text-[var(--risk-critical-ink)]" : "bg-secondary",
          )}
        >
          {REASON_LABEL[r] ?? r}
        </span>
      ))}
    </span>
  )
}

function Contacts({ contacts, max = 3 }: { contacts: Record<string, string[]>; max?: number }) {
  const all = Object.entries(contacts).flatMap(([k, vs]) => vs.map((v) => [k, v] as const))
  if (!all.length) return null
  return (
    <span className="flex flex-wrap gap-x-2 gap-y-0.5 text-[11px]">
      {all.slice(0, max).map(([k, v]) => (
        <span key={`${k}${v}`} className="inline-flex items-center gap-1 font-mono">
          <Phone className="size-3 text-[var(--risk-critical-ink)]" aria-hidden />
          <span className="text-muted-foreground">{CONTACT_LABEL[k] ?? k}</span> {v}
        </span>
      ))}
      {all.length > max && <span className="text-muted-foreground">+{all.length - max}</span>}
    </span>
  )
}

const typeLabel = (t: string) => ({ account: "Account", channel: "Channel", post: "Post", video: "Video", ad: "Ad" })[t] ?? t

// ------------------------------------------------------------------ summary strip
function Summary({ brandId, platform, onPlatform }: { brandId: string; platform: string | null; onPlatform: (p: string | null) => void }) {
  const s = useQuery({ queryKey: keys.socialSummary(brandId), queryFn: () => api.socialSummary(brandId), refetchInterval: 15000 })
  if (s.isLoading) return <Skeleton className="mb-3 h-24 w-full" />
  if (!s.data) return null
  const d = s.data
  const tiles: [string, React.ReactNode, string?][] = [
    ["Flagged", fmtNumber(d.flagged), "Relevant to the brand with a risk score of 30 or more"],
    ["Critical", fmtNumber(d.by_risk_level.Critical)],
    ["High", fmtNumber(d.by_risk_level.High)],
    ["Logo on profile / thumbnail", fmtNumber(d.logo_matches)],
    ["Collected", fmtNumber(d.collected), `${fmtNumber(d.pending_analysis)} waiting for analysis`],
  ]
  return (
    <section className="mb-3 space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {tiles.map(([label, value, hint]) => (
          <div key={label} className="rounded-lg border bg-card px-3 py-2" title={hint}>
            <div className="text-[11px] text-muted-foreground">{label}</div>
            <div className="tnum text-xl font-semibold">{value}</div>
          </div>
        ))}
      </div>
      <div role="tablist" aria-label="Platforms" className="flex flex-wrap gap-1.5">
        <button
          role="tab"
          aria-selected={!platform}
          onClick={() => onPlatform(null)}
          className={cn("rounded-full border px-2.5 py-1 text-xs font-medium", !platform ? "border-primary bg-primary text-primary-foreground" : "hover:bg-secondary")}
        >
          All platforms <span className="tnum opacity-80">{fmtNumber(d.by_risk_level.total)}</span>
        </button>
        {d.by_platform.map((p) => {
          const hot = p.Critical + p.High
          const on = platform?.toLowerCase() === p.platform.toLowerCase()
          return (
            <button
              key={p.platform}
              role="tab"
              aria-selected={on}
              onClick={() => onPlatform(on ? null : p.platform)}
              className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium", on ? "border-primary bg-primary text-primary-foreground" : "hover:bg-secondary")}
              title={`${p.Critical} critical · ${p.High} high · ${p.Medium} medium · ${p.Low} low`}
            >
              {p.platform} <span className="tnum opacity-80">{fmtNumber(p.total)}</span>
              {hot > 0 && <span className="tnum rounded-full px-1.5 text-[10px] font-semibold" style={{ background: "var(--risk-critical)", color: "var(--risk-critical-on)" }}>{hot}</span>}
            </button>
          )
        })}
      </div>
      {d.last_collection && (
        <p className="text-xs text-muted-foreground">
          Last collection {d.last_collection.status} · {fmtRelative(d.last_collection.finished_at ?? d.last_collection.started_at ?? d.last_collection.created_at)}
          {d.last_analysed && <> · analysed {fmtRelative(d.last_analysed)}</>}
        </p>
      )}
    </section>
  )
}

// ------------------------------------------------------------------ collection dialog + recent collections
function StartCollectionDialog({ brandId, open, onOpenChange }: { brandId: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient()
  const [picked, setPicked] = useState<SocialSource[]>(["instagram"])
  const paid = picked.filter((p) => SOURCES.find((s) => s.value === p)?.paid)
  const start = useMutation({
    mutationFn: () => api.startSocialCollection({ brand_id: brandId, platforms: picked }),
    onSuccess: () => {
      toast.success("Collection started — results appear here as they are analysed")
      qc.invalidateQueries({ queryKey: ["social"] })
      onOpenChange(false)
    },
  })
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Start social media collection</DialogTitle>
          <DialogDescription>Search Instagram for accounts, posts and reels that use the brand. Everything found is analysed and scored automatically.</DialogDescription>
        </DialogHeader>
        <ul className="space-y-2">
          {SOURCES.map((s) => {
            const on = picked.includes(s.value)
            return (
              <li key={s.value}>
                <label className="flex cursor-pointer items-start gap-2.5 rounded-md border p-2.5 hover:bg-secondary/50">
                  <Checkbox checked={on} onCheckedChange={(c) => setPicked((p) => (c ? [...p, s.value] : p.filter((x) => x !== s.value)))} className="mt-0.5" />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 text-sm font-medium">
                      {s.label}
                      <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-semibold", s.paid ? "bg-[var(--risk-medium-wash)] text-[var(--risk-medium-ink)]" : "bg-secondary")}>{s.paid ? "Apify credit" : "Free"}</span>
                    </span>
                    <span className="block text-xs text-muted-foreground">{s.hint}</span>
                  </span>
                </label>
              </li>
            )
          })}
        </ul>
        {paid.length > 0 && <p className="text-xs text-[var(--risk-medium-ink)]">{paid.length} paid source{paid.length > 1 ? "s" : ""} selected — this run uses Apify credit (capped by the server&apos;s spend limit).</p>}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!picked.length || start.isPending} onClick={() => start.mutate()}>
            {start.isPending ? <Loader2 className="animate-spin" /> : <Play />} Start collection
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function RecentCollections({ brandId }: { brandId: string }) {
  const q = useQuery({
    queryKey: keys.socialCollections(brandId),
    queryFn: () => api.socialCollections(brandId),
    refetchInterval: (query) => (query.state.data?.some((s) => s.status === "queued" || s.status === "running") ? 5000 : 30000),
  })
  const rows = (q.data ?? []).slice(0, 5)
  if (!rows.length) return null
  return (
    <Panel title="Recent collections" bodyClassName="p-0">
      <ul className="divide-y text-sm">
        {rows.map((s) => {
          const stats = s.stats as Record<string, unknown>
          const running = s.status === "queued" || s.status === "running"
          return (
            <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2">
              {running ? <Loader2 className="size-3.5 animate-spin text-muted-foreground" aria-hidden /> : <Share2 className="size-3.5 text-muted-foreground" aria-hidden />}
              <span className="font-medium">{s.status.replace(/_/g, " ")}</span>
              <span className="text-xs text-muted-foreground">{fmtDateTime(s.started_at ?? s.created_at)}</span>
              {typeof stats.items_collected === "number" && <span className="tnum text-xs">{fmtNumber(stats.items_collected)} collected</span>}
              {Array.isArray(stats.platforms) && <span className="text-xs text-muted-foreground">{(stats.platforms as string[]).join(", ")}</span>}
              <span className="ml-auto flex flex-wrap gap-1">
                {s.components
                  .filter((c) => c.status !== "ok")
                  .slice(0, 3)
                  .map((c) => (
                    <span key={c.name} className="rounded bg-secondary px-1.5 py-0.5 text-[11px]" title={c.message ?? undefined}>
                      {c.name}: {c.status.replace(/_/g, " ")}
                    </span>
                  ))}
              </span>
            </li>
          )
        })}
      </ul>
    </Panel>
  )
}

// ------------------------------------------------------------------ detail dialog
function ItemDialog({ id, onClose }: { id: string | null; onClose: () => void }) {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: keys.socialItem(id ?? ""), queryFn: () => api.socialItem(id!), enabled: !!id })
  const d = q.data
  const [status, setStatus] = useState<Decision | null>(null)
  const [note, setNote] = useState("")
  const review = useMutation({
    mutationFn: () => api.reviewSocialItem(id!, status!, note),
    onSuccess: () => {
      toast.success(`Marked ${status}`)
      qc.invalidateQueries({ queryKey: ["social"] })
      setStatus(null)
      setNote("")
    },
  })
  const needsNote = !!status && NOTE_REQUIRED.has(status) && !note.trim()
  return (
    <Dialog open={!!id} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        {!d ? (
          <div className="space-y-3 py-6">
            <DialogTitle className="sr-only">Loading</DialogTitle>
            <Skeleton className="h-6 w-2/3" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex flex-wrap items-center gap-2 pr-6">
                {d.risk_level && <RiskBadge level={d.risk_level} score={d.risk_score ?? undefined} />}
                <span>{d.headline ?? `${d.platform} ${typeLabel(d.content_type).toLowerCase()}`}</span>
              </DialogTitle>
              <DialogDescription className="flex flex-wrap gap-x-3 gap-y-1">
                <span>
                  {d.platform} · {typeLabel(d.content_type)}
                </span>
                {d.author && <span>by {d.author_handle ? `@${d.author_handle}` : d.author}</span>}
                {d.published_at && <span>published {fmtDate(d.published_at)}</span>}
                <span>found by {d.discovery}</span>
                <StatusBadge status={d.review_status} />
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <ReasonChips reasons={d.reasons} />
                <a href={d.url} target="_blank" rel="noopener noreferrer nofollow" className="ml-auto inline-flex items-center gap-1 text-xs font-medium underline underline-offset-2">
                  Open on {d.platform} <ExternalLink className="size-3" />
                </a>
              </div>
              {d.stage === "Candidate" && (
                <p className="rounded-md bg-secondary px-3 py-2 text-xs">Found by web search — only the search title and snippet were analysed. Open it to check the full post.</p>
              )}
              <div className="grid gap-4 md:grid-cols-[1fr_200px]">
                <div className="space-y-2">
                  {d.title && <p className="font-medium">{d.title}</p>}
                  {d.text && <p className="max-h-48 overflow-y-auto text-xs whitespace-pre-wrap text-muted-foreground">{d.text}</p>}
                </div>
                {d.thumbnail_url && (
                  <img src={d.thumbnail_url} alt="Thumbnail or profile picture" referrerPolicy="no-referrer" className="max-h-48 w-full rounded-md border object-contain" />
                )}
              </div>
              <dl className="grid gap-x-4 gap-y-1.5 text-xs sm:grid-cols-[10rem_1fr]">
                <dt className="text-muted-foreground">Scam contacts</dt>
                <dd>{Object.keys(d.scam_contacts).length ? <Contacts contacts={d.scam_contacts} max={20} /> : "—"}</dd>
                <dt className="text-muted-foreground">Other links</dt>
                <dd className="font-mono">{Object.values(d.other_links).flat().join(", ") || "—"}</dd>
                <dt className="text-muted-foreground">Scam wording</dt>
                <dd>{d.scam_phrases.join(", ") || "—"}</dd>
                <dt className="text-muted-foreground">Brand terms</dt>
                <dd>{d.brand_terms.join(", ") || "—"}</dd>
                <dt className="text-muted-foreground">Confidence</dt>
                <dd>{d.confidence !== null ? `${d.confidence} (${d.confidence_level})` : "—"}</dd>
                <dt className="text-muted-foreground">Engagement</dt>
                <dd className="tnum">
                  {Object.entries(d.metrics)
                    .filter(([, v]) => v !== null && v !== undefined)
                    .map(([k, v]) => `${k} ${typeof v === "number" ? fmtNumber(v) : String(v)}`)
                    .join(" · ") || "—"}
                </dd>
              </dl>
              {d.scoring?.risk?.rules && Object.keys(d.scoring.risk.rules).length > 0 && (
                <div>
                  <h3 className="mb-1 text-xs font-medium text-muted-foreground">Why this score</h3>
                  <ul className="flex flex-wrap gap-1.5 text-xs">
                    {Object.entries(d.scoring.risk.rules).map(([rule, pts]) => (
                      <li key={rule} className="rounded-md border px-2 py-0.5">
                        {rule.replace(/_/g, " ")} <span className="tnum font-semibold">+{String(pts)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {d.logo_comparison && (
                <div>
                  <h3 className="mb-2 text-xs font-medium text-muted-foreground">Logo on the profile picture / thumbnail</h3>
                  <LogoComparisonPanel c={d.logo_comparison} />
                </div>
              )}
              <div className="border-t pt-3">
                <h3 className="mb-2 text-xs font-medium text-muted-foreground">Review</h3>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
                  <SimpleSelect ariaLabel="Review status" value={status ?? d.review_status} onChange={(v) => setStatus(v as Decision)} options={STATUSES.map((s) => ({ value: s, label: s }))} className="sm:w-52" />
                  <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder={needsNote ? "A note is required for this status" : "Note (optional)"} rows={2} className="min-w-0 flex-1 text-sm" />
                  <Button disabled={!status || status === d.review_status || needsNote || review.isPending} onClick={() => review.mutate()}>
                    {review.isPending && <Loader2 className="animate-spin" />} Save
                  </Button>
                </div>
                {d.review_note && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Last note: {d.review_note}
                    {d.reviewed_by && ` — ${d.reviewed_by}`}
                    {d.reviewed_at && `, ${fmtDateTime(d.reviewed_at)}`}
                  </p>
                )}
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ------------------------------------------------------------------ page
function SocialList() {
  const { params, update, toggle } = useUrlFilters()
  const brands = useBrands()
  const qc = useQueryClient()
  const [collecting, setCollecting] = useState(false)
  // ?item=<id> (links from the dashboard) opens that item straight away
  const [openId, setOpenId] = useState<string | null>(() => params.get("item"))
  const brandId = params.get("brand_id") ?? brands.data?.[0]?.id ?? ""
  const page = Math.max(1, Number(params.get("page") ?? 1) || 1)
  const platform = params.get("platform")

  const listQuery = useMemo(() => {
    const q = new URLSearchParams()
    if (brandId) q.set("brand_id", brandId)
    for (const k of FILTER_KEYS) for (const v of params.getAll(k)) if (v) q.append(k, v)
    q.set("page", String(page))
    q.set("page_size", String(PAGE_SIZE))
    return q
  }, [params, page, brandId])
  const collections = useQuery({ queryKey: keys.socialCollections(brandId), queryFn: () => api.socialCollections(brandId), enabled: !!brandId })
  const running = !!collections.data?.some((s) => s.status === "queued" || s.status === "running")
  const list = useQuery({
    queryKey: keys.socialItems(listQuery.toString()),
    queryFn: () => api.socialItems(listQuery),
    enabled: !!brandId,
    placeholderData: keepPreviousData,
    refetchInterval: running ? 8000 : false,
  })
  const analyse = useMutation({
    mutationFn: () => api.analyseSocial(brandId),
    onSuccess: (r) => {
      toast.success(`Analysed ${fmtNumber(r.analysed)} items — ${fmtNumber(r.flagged)} flagged${r.remaining ? `, ${fmtNumber(r.remaining)} left (run again)` : ""}`)
      qc.invalidateQueries({ queryKey: ["social"] })
    },
  })

  // debounced free-text search → URL
  const urlQ = params.get("q") ?? ""
  const [q, setQ] = useState(urlQ)
  const [syncedQ, setSyncedQ] = useState(urlQ)
  if (urlQ !== syncedQ) {
    setSyncedQ(urlQ)
    setQ(urlQ)
  }
  useEffect(() => {
    if (q === urlQ) return
    const t = setTimeout(() => update({ q: q.trim() || null }), 350)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q])

  const total = list.data?.total ?? 0
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const filtered = FILTER_KEYS.some((k) => k !== "sort" && params.getAll(k).length > 0)

  return (
    <>
      <PageHeader
        title="Social media"
        description="Accounts, posts, videos and ads that use your brand: fake customer care numbers, scam contacts, impersonating accounts and the official logo on profiles — scored by risk."
        actions={
          <>
            <Button variant="outline" disabled={!brandId || analyse.isPending} onClick={() => analyse.mutate()} title="Score items that were collected but not analysed yet">
              {analyse.isPending ? <Loader2 className="animate-spin" /> : <RefreshCw />} Analyse
            </Button>
            <Button disabled={!brandId} onClick={() => setCollecting(true)}>
              <Play /> Start collection
            </Button>
          </>
        }
      />

      {brands.data && brands.data.length > 1 && (
        <div className="mb-3">
          <SimpleSelect
            ariaLabel="Brand"
            value={brandId}
            onChange={(v) => update({ brand_id: v })}
            options={brands.data.map((b) => ({ value: b.id, label: b.name }))}
            className="w-64"
          />
        </div>
      )}

      {brandId && <Summary brandId={brandId} platform={platform} onPlatform={(p) => update({ platform: p })} />}

      <div role="toolbar" aria-label="Filters" className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search text, account or link" aria-label="Search" className="h-8 pl-8" />
        </div>
        <MultiFilter
          label="Risk"
          value={params.getAll("risk_level")}
          onChange={toggle("risk_level")}
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
        <MultiFilter label="Type" value={params.getAll("content_type")} onChange={toggle("content_type")} options={TYPES.map((t) => ({ value: t.value, label: t.label, text: t.label }))} />
        <MultiFilter
          label="Review status"
          value={params.getAll("review_status")}
          onChange={toggle("review_status")}
          options={STATUSES.map((s) => ({ value: s, label: <StatusBadge status={s} />, text: s }))}
        />
        <label className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium">
          <Checkbox checked={params.get("flagged_only") === "true"} onCheckedChange={(c) => update({ flagged_only: c ? "true" : null })} /> Flagged only
        </label>
        <label className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium">
          <Checkbox checked={params.get("logo_match") === "true"} onCheckedChange={(c) => update({ logo_match: c ? "true" : null })} /> Logo matched
        </label>
        {filtered && (
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            onClick={() => update(Object.fromEntries(FILTER_KEYS.filter((k) => k !== "sort").map((k) => [k, null])))}
          >
            <X /> Clear filters
          </Button>
        )}
        <SimpleSelect ariaLabel="Sort" size="sm" value={params.get("sort") ?? "risk"} onChange={(v) => update({ sort: v === "risk" ? null : v })} options={SORTS} className="ml-auto w-48" />
      </div>

      {list.error ? (
        <ErrorPanel error={list.error} onRetry={() => list.refetch()} title="Couldn't load social media results" />
      ) : list.isLoading || !brandId ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      ) : !list.data?.items.length ? (
        <EmptyState icon={filtered ? SearchX : MessageCircleWarning} title={filtered ? "Nothing matches these filters" : "Nothing collected yet"} className="rounded-lg border bg-card py-12">
          {filtered ? "Try fewer filters." : "Start a collection to search Instagram for posts, reels and accounts that use the brand."}
        </EmptyState>
      ) : (
        <ul className="divide-y overflow-hidden rounded-lg border bg-card">
          {list.data.items.map((it: SocialItem) => (
            <li key={it.id}>
              <button
                type="button"
                onClick={() => setOpenId(it.id)}
                className="flex w-full items-start gap-3 px-3 py-2.5 text-left hover:bg-secondary/50 focus-visible:bg-secondary/50 focus-visible:outline-none"
              >
                <Thumb src={it.thumbnail_url} alt={`${it.platform} ${it.content_type}`} />
                <span className="min-w-0 flex-1 space-y-1">
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                    <span className="font-semibold">{it.platform}</span>
                    <span className="text-muted-foreground">{typeLabel(it.content_type)}</span>
                    {it.author && <span className="truncate text-muted-foreground">{it.author_handle ? `@${it.author_handle}` : it.author}</span>}
                    {it.logo_match && (
                      <span className="inline-flex items-center gap-0.5 font-medium text-[var(--risk-critical-ink)]" title="The official logo is on the profile picture / thumbnail">
                        <ImageIcon className="size-3" aria-hidden /> Logo
                      </span>
                    )}
                    {it.stage === "Candidate" && <span className="rounded bg-secondary px-1 text-[10px]" title="Only a search snippet was analysed">snippet</span>}
                  </span>
                  <span className="line-clamp-1 block text-sm font-medium">{it.title || it.text || it.url}</span>
                  {it.text && it.title && <span className="line-clamp-1 block text-xs text-muted-foreground">{it.text}</span>}
                  <span className="flex flex-wrap items-center gap-2">
                    <ReasonChips reasons={it.reasons} />
                    <Contacts contacts={it.scam_contacts} />
                  </span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1">
                  {it.risk_level ? (
                    <RiskBadge level={it.risk_level as RiskLevel} score={it.risk_score ?? undefined} />
                  ) : (
                    <span className="text-xs text-muted-foreground" title="Not analysed yet">
                      <BadgeAlert className="inline size-3.5" /> pending
                    </span>
                  )}
                  <StatusBadge status={it.review_status} />
                  <span className="text-[11px] text-muted-foreground">{it.published_at ? fmtDate(it.published_at) : fmtRelative(it.first_seen)}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {total > PAGE_SIZE && (
        <div className="mt-3 flex items-center justify-end gap-2 text-sm">
          <span className="text-muted-foreground">
            Page {page} of {pages} · {fmtNumber(total)} items
          </span>
          <Button variant="outline" size="icon-sm" aria-label="Previous page" disabled={page <= 1} onClick={() => update({ page: String(page - 1) }, false)}>
            <ChevronLeft />
          </Button>
          <Button variant="outline" size="icon-sm" aria-label="Next page" disabled={page >= pages} onClick={() => update({ page: String(page + 1) }, false)}>
            <ChevronRight />
          </Button>
        </div>
      )}

      {brandId && (
        <div className="mt-4">
          <RecentCollections brandId={brandId} />
        </div>
      )}
      {brandId && <StartCollectionDialog brandId={brandId} open={collecting} onOpenChange={setCollecting} />}
      <ItemDialog id={openId} onClose={() => setOpenId(null)} />
    </>
  )
}

export default function SocialPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <SocialList />
    </Suspense>
  )
}
