"use client"

import Image from "next/image"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useState } from "react"
import { useTheme } from "next-themes"
import { Building2, LayoutDashboard, LogOut, Menu, MessagesSquare, Monitor, Moon, Sun } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet"
import { useAuth } from "@/lib/auth"
import type { Overview } from "@/lib/api"
import { useOverallOverview } from "@/lib/queries"
import { cn } from "@/lib/utils"
import logo from "../../public/beyondcloud_logo.webp"

/**
 * `badge` = a small count on the menu item: what it counts, and whether it is urgent.
 * Only modules ported to the Node.js API are listed; the older pages (alerts, findings, scans, social, settings,
 * users) stay in the code base but are not linked until their endpoints exist.
 */
const NAV: {
  href: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  admin: boolean
  badge?: (o: Overview) => { value: number; hint: string; urgent?: boolean }
}[] = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard, admin: false },
  {
    href: "/social",
    label: "Social media",
    icon: MessagesSquare,
    admin: false,
    badge: (o) => {
      const n = o.open.by_risk.High + o.open.by_risk.Critical
      return { value: n, hint: `${n} open high or critical`, urgent: n > 0 }
    },
  },
  { href: "/brands", label: "Brands", icon: Building2, admin: false },
]

/**
 * The Beyond Cloud logo (public/beyondcloud_logo.webp, 470×120, navy on transparent).
 * In dark mode it sits on a white plate so the navy stays readable.
 */
export function Logo({ className, height = 30 }: { className?: string; height?: number }) {
  return (
    <span className={cn("inline-flex dark:rounded-md dark:bg-white dark:px-2 dark:py-1", className)}>
      <Image src={logo} alt="Beyond Cloud" height={height} width={Math.round((height * 470) / 120)} loading="eager" />
    </span>
  )
}

function ThemeSwitch() {
  const { theme, setTheme } = useTheme()
  const options = [
    { value: "light", icon: Sun, label: "Light" },
    { value: "dark", icon: Moon, label: "Dark" },
    { value: "system", icon: Monitor, label: "System" },
  ]
  return (
    <div role="radiogroup" aria-label="Colour theme" className="flex rounded-md bg-sidebar-accent/60 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={theme === o.value}
          aria-label={o.label}
          title={o.label}
          onClick={() => setTheme(o.value)}
          className={cn(
            "flex h-6 flex-1 items-center justify-center rounded-[5px] text-sidebar-foreground/60 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
            theme === o.value && "bg-card text-sidebar-foreground shadow-xs",
          )}
        >
          <o.icon className="size-3.5" />
        </button>
      ))}
    </div>
  )
}

/**
 * Shield part of the logo only (x 28–180 of the 470×120 image), for the collapsed rail.
 * Same image, cropped with overflow, so it widens smoothly into the full logo.
 */
function RailLogo({ expanded }: { expanded: boolean }) {
  const h = 32
  const full = Math.round((h * 470) / 120)
  return (
    <span
      className={cn(
        "inline-flex overflow-hidden transition-[width] duration-200 dark:rounded-md dark:bg-white",
        expanded ? "w-[128px]" : "w-10",
      )}
    >
      <Image src={logo} alt="Beyond Cloud" height={h} width={full} loading="eager" className="max-w-none" style={{ marginLeft: -7 }} />
    </span>
  )
}

/**
 * Navigation. `rail` = desktop: icons only, labels appear when `expanded` (hover or keyboard focus).
 * Without `rail` (mobile drawer) everything is always shown.
 */
function SidebarBody({ onNavigate, rail = false, expanded = true }: { onNavigate?: () => void; rail?: boolean; expanded?: boolean }) {
  const pathname = usePathname()
  const router = useRouter()
  const { user, isAdmin, logout } = useAuth()
  const isActive = (href: string) => (href === "/" ? pathname === href : pathname.startsWith(href))
  const shown = !rail || expanded
  const counts = useOverallOverview().data
  /** text that only appears when the rail is open */
  const label = cn("whitespace-nowrap transition-opacity duration-150", !shown && "pointer-events-none opacity-0")

  return (
    <div className="flex h-full flex-col">
      <div className={cn("pt-5 pb-5", rail ? "px-3" : "px-4")}>
        <Link href="/" onClick={onNavigate} aria-label="Beyond Cloud home" className="inline-flex rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {rail ? <RailLogo expanded={expanded} /> : <Logo height={34} />}
        </Link>
        <div className={cn("mt-2 pl-0.5 text-xs text-sidebar-foreground/60", label)}>Brand protection</div>
      </div>
      <nav aria-label="Main" className="flex flex-col gap-0.5 px-3">
        {NAV.filter((n) => !n.admin || isAdmin).map((n) => {
          const active = isActive(n.href)
          const badge = counts && n.badge ? n.badge(counts) : null
          return (
            <Link
              key={n.href}
              href={n.href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              title={rail && !expanded ? (badge ? `${n.label}: ${badge.hint}` : n.label) : undefined}
              className={cn(
                "group relative flex h-10 items-center gap-3 rounded-md px-3 text-sm text-sidebar-foreground/75 transition-colors outline-none hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-ring",
                active && "bg-sidebar-accent font-medium text-sidebar-primary",
              )}
            >
              {active && <span className="absolute top-2 bottom-2 -left-3 w-[3px] rounded-r bg-sidebar-primary" aria-hidden />}
              <n.icon className="size-4 shrink-0" />
              <span className={label}>{n.label}</span>
              {badge && badge.value > 0 && (
                <span
                  title={badge.hint}
                  className={cn(
                    "tnum flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1.5 text-[11px] leading-none font-semibold",
                    shown ? "ml-auto" : "absolute top-0.5 left-[22px] h-4 min-w-4 px-1 text-[10px] ring-2 ring-sidebar",
                    badge.urgent ? "bg-[var(--risk-critical)] text-[var(--risk-critical-on)]" : "bg-sidebar-accent text-sidebar-foreground",
                    !shown && !badge.urgent && "bg-sidebar-primary text-sidebar-primary-foreground",
                  )}
                >
                  <span className="sr-only">, </span>
                  {badge.value > 99 ? "99+" : badge.value}
                </span>
              )}
            </Link>
          )
        })}
      </nav>
      <div className="mt-auto space-y-3 border-t border-sidebar-border px-4 py-3">
        {shown && <ThemeSwitch />}
        {user && (
          <div className="flex items-center gap-2">
            <div
              className="flex size-8 shrink-0 items-center justify-center rounded-full bg-sidebar-accent text-xs font-semibold uppercase"
              title={rail && !expanded ? `${user.name} (${user.role})` : undefined}
            >
              {user.name.slice(0, 2)}
            </div>
            <div className={cn("min-w-0 flex-1 leading-tight", label)}>
              <div className="truncate text-sm font-medium">{user.name}</div>
              <div className="truncate text-xs text-sidebar-foreground/60 capitalize">{user.role}</div>
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Sign out"
              title="Sign out"
              className={label}
              tabIndex={shown ? undefined : -1}
              onClick={() => {
                logout()
                router.replace("/login")
              }}
            >
              <LogOut />
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * Desktop: a 64px icon rail that opens over the page (content does not move) while the pointer is on it or
 * keyboard focus is inside it. Mobile: a drawer opened from the top bar.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  const [expanded, setExpanded] = useState(false)
  return (
    <div className="min-h-dvh lg:pl-16">
      <aside
        aria-label="Sidebar"
        onMouseEnter={() => setExpanded(true)}
        onMouseLeave={() => setExpanded(false)}
        onFocus={(e) => e.target.matches(":focus-visible") && setExpanded(true)}
        onBlur={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && setExpanded(false)}
        className={cn(
          "fixed inset-y-0 left-0 z-30 hidden overflow-hidden border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width,box-shadow] duration-200 lg:block",
          expanded ? "w-60 shadow-xl" : "w-16",
        )}
      >
        <SidebarBody rail expanded={expanded} onNavigate={() => setExpanded(false)} />
      </aside>
      <header className="sticky top-0 z-20 flex h-12 items-center gap-2 border-b bg-background/90 px-3 backdrop-blur lg:hidden">
        <Button variant="ghost" size="icon" aria-label="Open navigation" onClick={() => setOpen(true)}>
          <Menu />
        </Button>
        <Logo height={24} />
      </header>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left" className="w-64 bg-sidebar p-0 text-sidebar-foreground" showCloseButton={false}>
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <SidebarBody onNavigate={() => setOpen(false)} />
        </SheetContent>
      </Sheet>
      <main className="mx-auto w-full max-w-[1600px] px-4 py-5 sm:px-6 lg:px-8 lg:py-7">{children}</main>
    </div>
  )
}

export function PageHeader({
  title,
  description,
  actions,
  children,
}: {
  title: React.ReactNode
  description?: React.ReactNode
  actions?: React.ReactNode
  children?: React.ReactNode
}) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight text-balance sm:text-2xl">{title}</h1>
        {description && <p className="mt-1 max-w-prose text-sm text-muted-foreground">{description}</p>}
        {children}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}
