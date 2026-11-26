"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Building2, ImageOff, Plus, Search, SearchX } from "lucide-react"
import { PageHeader } from "@/components/app-shell"
import { BrandForm } from "@/components/brand-form"
import { ErrorPanel } from "@/components/query-state"
import { EmptyState } from "@/components/widgets"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { api, type Brand, type BrandSearchItem } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { fmtDate, fmtDateTime, fmtNumber } from "@/lib/format"
import { AUTO_FREQUENCY_LABELS } from "@/lib/constants"
import { cn } from "@/lib/utils"
import { keys, useBrands, useOverallOverview } from "@/lib/queries"

function BrandLogo({ brand }: { brand: Brand }) {
  const logo = brand.assets.find((a) => a.kind === "logo") ?? brand.assets[0]
  return logo?.url ? (
    <img src={logo.url} alt="" className="size-9 rounded-md border bg-white object-contain p-1" />
  ) : (
    <div className="flex size-9 items-center justify-center rounded-md border border-dashed text-muted-foreground/60">
      <ImageOff className="size-3.5" />
    </div>
  )
}

function CreateBrandDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient()
  const router = useRouter()
  const create = useMutation({
    mutationFn: api.createBrand,
    onSuccess: (b) => {
      qc.invalidateQueries({ queryKey: keys.brands })
      toast.success(`Brand ${b.name} created. Add its official logo and allowlists next.`)
      onOpenChange(false)
      router.push(`/brands/${b.id}`)
    },
  })
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Add a brand</DialogTitle>
          <DialogDescription>Official logos, domains and handles are added on the next screen.</DialogDescription>
        </DialogHeader>
        <BrandForm onSubmit={(v) => create.mutateAsync(v).catch(() => {})} submitLabel="Create brand" onCancel={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  )
}

export default function BrandsPage() {
  const { isAdmin } = useAuth()
  const router = useRouter()
  const all = useBrands()
  const [creating, setCreating] = useState(false)
  // free-text search (name, keywords, domains, handles, apps…) via GET /brands/search, debounced
  const [q, setQ] = useState("")
  const [term, setTerm] = useState("")
  useEffect(() => {
    const t = setTimeout(() => setTerm(q.trim()), 300)
    return () => clearTimeout(t)
  }, [q])
  const search = useQuery({
    queryKey: keys.brandSearch(term),
    queryFn: () => api.searchBrands({ q: term, page_size: 200 }),
    enabled: !!term,
    placeholderData: keepPreviousData,
  })
  const brands = term ? search : all
  const rows: (Brand | BrandSearchItem)[] | undefined = term ? search.data?.items : all.data
  const openByBrand = new Map((useOverallOverview().data?.brands ?? []).map((b) => [b.id, b.open]))

  return (
    <>
      <PageHeader
        title="Brands"
        description="Each brand is monitored with its own keywords, official assets and allowlists."
        actions={
          isAdmin && (
            <Button onClick={() => setCreating(true)}>
              <Plus />
              Add brand
            </Button>
          )
        }
      />
      <div className="relative mb-3 w-full sm:w-80">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, keyword, domain, handle, app…" aria-label="Search brands" className="h-8 pl-8" />
      </div>
      <div className="overflow-hidden rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="text-xs text-muted-foreground">Brand</TableHead>
              <TableHead className="hidden text-xs text-muted-foreground md:table-cell">Keywords</TableHead>
              <TableHead className="hidden text-xs text-muted-foreground sm:table-cell">Assets</TableHead>
              <TableHead className="hidden text-xs text-muted-foreground lg:table-cell">Allowlist</TableHead>
              <TableHead className="text-right text-xs text-muted-foreground">Open social items</TableHead>
              <TableHead className="text-xs text-muted-foreground">Monitoring</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {brands.isLoading &&
              Array.from({ length: 3 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={6}>
                    <Skeleton className="h-9 w-full" />
                  </TableCell>
                </TableRow>
              ))}
            {rows?.map((b) => (
              <TableRow key={b.id} className="cursor-pointer" onClick={() => router.push(`/brands/${b.id}`)}>
                <TableCell>
                  <div className="flex items-center gap-3">
                    <BrandLogo brand={b} />
                    <div className="min-w-0">
                      <Link href={`/brands/${b.id}`} className="font-medium hover:underline" onClick={(e) => e.stopPropagation()}>
                        {b.name}
                      </Link>
                      <div className="text-xs text-muted-foreground">
                        Added {fmtDate(b.created_at)}
                        {"matched_on" in b && b.matched_on.length > 0 && <> · matched on {b.matched_on.map((m) => m.replace(/_/g, " ")).join(", ")}</>}
                      </div>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="hidden max-w-xs md:table-cell">
                  <div className="truncate text-sm text-muted-foreground">{b.keywords.join(", ") || "—"}</div>
                </TableCell>
                <TableCell className="tnum hidden sm:table-cell">{b.assets.length}</TableCell>
                <TableCell className="tnum hidden lg:table-cell">{b.allowlist.length}</TableCell>
                <TableCell className="text-right">
                  <Link
                    href={`/social?brand_id=${b.id}`}
                    onClick={(e) => e.stopPropagation()}
                    className="tnum font-medium hover:underline"
                  >
                    {fmtNumber(openByBrand.get(b.id) ?? 0)}
                  </Link>
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1 text-xs">
                    <span className={b.is_active ? "text-foreground" : "text-muted-foreground"}>{b.is_active ? "Active" : "Paused"}</span>
                    <span
                      className={cn(
                        "rounded-md px-1.5 py-0.5 whitespace-nowrap ring-1 ring-inset",
                        b.auto_scan_enabled ? "bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-950/50 dark:text-sky-300 dark:ring-sky-900" : "bg-muted text-muted-foreground ring-border",
                      )}
                      title={b.auto_scan_enabled && b.next_auto_scan_at ? `Next automatic scan ${fmtDateTime(b.next_auto_scan_at)}` : "Automatic scanning is off for this brand"}
                    >
                      Auto: {b.auto_scan_enabled ? AUTO_FREQUENCY_LABELS[b.auto_scan_frequency] : "Off"}
                    </span>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {brands.error && (
          <ErrorPanel error={brands.error} onRetry={() => brands.refetch()} title="Couldn't load brands" className="m-3" />
        )}
        {term && rows?.length === 0 && (
          <EmptyState icon={SearchX} title={`No brand matches "${term}"`}>
            Search looks in names, descriptions, keywords, product terms and official domains, handles and apps.
          </EmptyState>
        )}
        {!term && rows?.length === 0 && (
          <EmptyState
            icon={Building2}
            title="No brands yet"
            action={
              isAdmin && (
                <Button onClick={() => setCreating(true)}>
                  <Plus />
                  Add the first brand
                </Button>
              )
            }
          >
            {isAdmin ? "Add a brand to start monitoring it." : "Ask an admin to add the brands you monitor."}
          </EmptyState>
        )}
      </div>
      {isAdmin && <CreateBrandDialog open={creating} onOpenChange={setCreating} />}
    </>
  )
}
