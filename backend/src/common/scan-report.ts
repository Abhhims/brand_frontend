/**
 * What each part of a scan did (legacy ScanReport, D-31). A source that could not run is reported as such,
 * never silently shown as "nothing found". Shared by every scan module.
 */

export type ComponentStatus = "ok" | "skipped" | "not_configured" | "unavailable" | "failed"
export type ScanStatus = "queued" | "running" | "completed" | "partially_completed" | "completed_with_errors" | "failed" | "cancelled"

export interface ScanComponent {
  name: string
  status: ComponentStatus
  /** first 5 distinct messages joined by "; " */
  message: string
  counts: Record<string, number>
  /** this part failing means the whole scan checked nothing */
  fatal: boolean
}

const SEVERITY: Record<ComponentStatus, number> = { ok: 0, skipped: 1, not_configured: 2, unavailable: 3, failed: 4 }

interface Entry {
  status: ComponentStatus
  messages: string[]
  counts: Record<string, number>
  fatal: boolean
}

export class ScanReport {
  private readonly entries = new Map<string, Entry>()

  ok(name: string, counts: Record<string, number> = {}) {
    this.add(name, "ok", "", counts)
  }
  skipped(name: string, message: string) {
    this.add(name, "skipped", message)
  }
  notConfigured(name: string, message: string) {
    this.add(name, "not_configured", message)
  }
  unavailable(name: string, message: string, fatal = false) {
    this.add(name, "unavailable", message, {}, fatal)
  }
  failed(name: string, message: string, fatal = false) {
    this.add(name, "failed", message, {}, fatal)
  }

  /** A component keeps its worst status, its distinct messages and the sum of its counts */
  private add(name: string, status: ComponentStatus, message: string, counts: Record<string, number> = {}, fatal = false) {
    const e = this.entries.get(name) ?? { status, messages: [], counts: {}, fatal: false }
    if (SEVERITY[status] > SEVERITY[e.status]) e.status = status
    if (message && !e.messages.includes(message)) e.messages.push(message)
    for (const [k, v] of Object.entries(counts)) e.counts[k] = (e.counts[k] ?? 0) + v
    e.fatal ||= fatal
    this.entries.set(name, e)
  }

  get components(): ScanComponent[] {
    return [...this.entries].map(([name, e]) => ({
      name,
      status: e.status,
      message: e.messages.slice(0, 5).join("; "),
      counts: e.counts,
      fatal: e.fatal,
    }))
  }

  /** "{component}: {message}" for every failed or unavailable component */
  get errors(): string[] {
    return this.components.filter((c) => c.status === "failed" || c.status === "unavailable").map((c) => `${c.name}: ${c.message}`)
  }

  get anyOk(): boolean {
    return this.components.some((c) => c.status === "ok")
  }
}

export function deriveRunStatus(components: ScanComponent[], crashed: boolean): ScanStatus {
  const bad = new Set<ComponentStatus>(["failed", "unavailable", "not_configured"])
  if (crashed || components.some((c) => c.fatal && bad.has(c.status))) return "failed"
  if (components.some((c) => c.status === "failed")) return "completed_with_errors"
  if (components.some((c) => c.status === "unavailable" || c.status === "not_configured")) return "partially_completed"
  return "completed"
}
