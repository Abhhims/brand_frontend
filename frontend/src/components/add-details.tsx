"use client"

/**
 * "Add details" for a brand (POST /brands/:id/details): keywords, product terms, official domains, email domains,
 * social handles, app packages, publishers and signing certificates in one go. Nothing is removed; what was not
 * saved comes back in `skipped` with a reason, shown after saving.
 */
import { useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Loader2, ListPlus } from "lucide-react"
import { TagInput } from "@/components/widgets"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { api, type AddDetailsInput, type AddDetailsResult, type Brand } from "@/lib/api"
import { keys } from "@/lib/queries"

type ListField = Exclude<keyof AddDetailsInput, "description">

const FIELDS: { key: ListField; label: string; placeholder: string }[] = [
  { key: "domains", label: "Official websites", placeholder: "example.com, https://www.example.com" },
  { key: "keywords", label: "Keywords", placeholder: "brand name, brandname" },
  { key: "product_terms", label: "Product terms", placeholder: "mobile banking, pay" },
  { key: "email_domains", label: "Email domains", placeholder: "mail.example.com" },
  { key: "social_handles", label: "Social accounts", placeholder: "@example or a profile URL" },
  { key: "packages", label: "App packages", placeholder: "com.example.app" },
  { key: "publishers", label: "App publishers", placeholder: "Example Ltd" },
  { key: "signing_certs", label: "App signing certificates (SHA-256)", placeholder: "AB:CD:…" },
]

const empty = (): Record<ListField, string[]> =>
  Object.fromEntries(FIELDS.map((f) => [f.key, [] as string[]])) as unknown as Record<ListField, string[]>

export function AddDetailsDialog({ brand, open, onOpenChange }: { brand: Brand; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient()
  const [values, setValues] = useState(empty)
  const [description, setDescription] = useState("")
  const [result, setResult] = useState<AddDetailsResult | null>(null)
  const body: AddDetailsInput = {
    ...Object.fromEntries(FIELDS.filter((f) => values[f.key].length).map((f) => [f.key, values[f.key]])),
    ...(description.trim() ? { description: description.trim() } : {}),
  }
  const hasAny = Object.keys(body).length > 0
  const save = useMutation({
    mutationFn: () => api.addBrandDetails(brand.id, body),
    onSuccess: (r) => {
      qc.setQueryData(keys.brand(brand.id), r.brand)
      qc.invalidateQueries({ queryKey: keys.brands })
      setResult(r)
      setValues(empty())
      setDescription("")
      const added = r.added.keywords.length + r.added.product_terms.length + r.added.allowlist.length + (r.added.description ? 1 : 0)
      toast.success(`${added} ${added === 1 ? "detail" : "details"} added to ${r.brand.name}`)
    },
  })
  const close = (o: boolean) => {
    if (!o) setResult(null)
    onOpenChange(o)
  }
  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Add details to {brand.name}</DialogTitle>
          <DialogDescription>Adds to what the brand already has; nothing is removed. Press Enter or comma after each value.</DialogDescription>
        </DialogHeader>
        {result && (
          <div className="space-y-2 rounded-lg border p-3 text-sm" role="status">
            <p className="font-medium">
              Added {result.added.keywords.length} keywords, {result.added.product_terms.length} product terms, {result.added.allowlist.length} allowlist
              entries{result.added.description ? " and the description" : ""}.
            </p>
            {result.skipped.length > 0 && (
              <div>
                <p className="text-xs font-medium text-muted-foreground">Not saved ({result.skipped.length})</p>
                <ul className="mt-1 max-h-40 space-y-0.5 overflow-y-auto text-xs">
                  {result.skipped.map((s, i) => (
                    <li key={i}>
                      <span className="font-mono">{s.value}</span> <span className="text-muted-foreground">({s.field.replace(/_/g, " ")}): {s.reason}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault()
            if (hasAny) save.mutate()
          }}
        >
          {FIELDS.map((f) => (
            <div key={f.key} className="space-y-1">
              <Label htmlFor={`details-${f.key}`}>{f.label}</Label>
              <TagInput id={`details-${f.key}`} value={values[f.key]} onChange={(v) => setValues((prev) => ({ ...prev, [f.key]: v }))} placeholder={f.placeholder} />
            </div>
          ))}
          <div className="space-y-1">
            <Label htmlFor="details-description">Description</Label>
            <Textarea id="details-description" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Replaces the description when filled in" />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => close(false)}>
              {result ? "Done" : "Cancel"}
            </Button>
            <Button type="submit" disabled={!hasAny || save.isPending}>
              {save.isPending ? <Loader2 className="animate-spin" /> : <ListPlus />}
              Add details
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
