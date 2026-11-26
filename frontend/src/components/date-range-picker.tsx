"use client"

/**
 * Date range picker (TypeScript port of the team's SPGO_DateRangePicker, in Beyond Cloud colours).
 *
 * Controlled with DD/MM/YYYY strings, like the original:
 *   <DateRangePicker startDate={s} endDate={e} setStartDate={setS} setEndDate={setE} onChange={(s, e, sd, ed) => …} />
 *
 * Features kept from the original: typed input with auto "/" and " - ", presets sidebar, one or two months,
 * month/year pickers over the grid, hover preview, min/max date, past/future limits, disabled dates,
 * min/max range length, single-day ranges, week numbers, weekend highlight, first day of week, Today/Clear,
 * close on select, single-date mode, flip up/left when there is no room.
 * Added: keyboard (Esc closes, arrow keys move between days), ARIA grid/labels, dark mode via theme tokens.
 */
import { Fragment, useCallback, useEffect, useId, useMemo, useRef, useState } from "react"
import { Calendar, ChevronDown, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, X } from "lucide-react"
import { cn } from "@/lib/utils"

const STRICT_DATE_PATTERN = /^\d{2}\/\d{2}\/\d{4}$/
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"]
const DAY_MS = 86_400_000

export interface Preset {
  label: string
  getDates: () => { start: Date; end: Date }
}

export interface DateRangePickerProps {
  startDate?: string
  endDate?: string
  setStartDate?: (v: string) => void
  setEndDate?: (v: string) => void
  onChange?: ((start: string, end: string, startDate: Date | null, endDate: Date | null) => void) | null
  disabled?: boolean
  label?: string
  error?: boolean
  errorMessage?: string
  showInput?: boolean
  dualCalendar?: boolean
  allowSingleDayRange?: boolean
  minDays?: number | null
  maxDays?: number | null
  disabledDates?: (Date | string)[]
  minDate?: Date | string | null
  maxDate?: Date | string | null
  disablePastDates?: boolean
  disableFutureDates?: boolean
  showTodayButton?: boolean
  showClearButton?: boolean
  showWeekNumbers?: boolean
  highlightWeekends?: boolean
  firstDayOfWeek?: number
  showPresets?: boolean
  customPresets?: Preset[] | null
  allowManualInput?: boolean
  closeOnSelect?: boolean
  hoverPreview?: boolean
  singleDate?: boolean
  className?: string
  inputClassName?: string
  placeholder?: string | null
  /** id for the input, so an external <label htmlFor> works */
  id?: string
}

// ------------------------------------------------------------------ date helpers

const startOfDay = (d: Date | string) => {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}
const sameDay = (a: Date | null, b: Date | null) =>
  !!a && !!b && a.getDate() === b.getDate() && a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear()
const pad = (n: number) => String(n).padStart(2, "0")

export function formatDate(d: Date | null): string {
  return d ? `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}` : ""
}

export function parseDate(s: string | null | undefined): Date | null {
  if (!s) return null
  const [dd, mm, yyyy] = s.split("/").map((p) => parseInt(p, 10))
  if ([dd, mm, yyyy].some((n) => Number.isNaN(n))) return null
  const d = new Date(yyyy, mm - 1, dd)
  return d.getDate() === dd && d.getMonth() === mm - 1 && d.getFullYear() === yyyy ? d : null
}

function isoWeek(date: Date): number {
  const d = startOfDay(date)
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7))
  const week1 = new Date(d.getFullYear(), 0, 4)
  return 1 + Math.round(((d.getTime() - week1.getTime()) / DAY_MS - 3 + ((week1.getDay() + 6) % 7)) / 7)
}

const addMonths = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth() + n, 1)

// ------------------------------------------------------------------ component

export function DateRangePicker({
  startDate = "",
  endDate = "",
  setStartDate = () => {},
  setEndDate = () => {},
  onChange = null,
  disabled = false,
  label = "",
  error = false,
  errorMessage = "",
  showInput = true,
  dualCalendar = false,
  allowSingleDayRange = true,
  minDays = null,
  maxDays = null,
  disabledDates = [],
  minDate = null,
  maxDate = null,
  disablePastDates = false,
  disableFutureDates = true,
  showTodayButton = true,
  showClearButton = true,
  showWeekNumbers = false,
  highlightWeekends = true,
  firstDayOfWeek = 0,
  showPresets = true,
  customPresets = null,
  allowManualInput = true,
  closeOnSelect = true,
  hoverPreview = true,
  singleDate = false,
  className = "",
  inputClassName = "",
  placeholder = null,
  id,
}: DateRangePickerProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [selStart, setSelStart] = useState<Date | null>(() => parseDate(startDate))
  const [selEnd, setSelEnd] = useState<Date | null>(() => parseDate(endDate))
  const [hoverDate, setHoverDate] = useState<Date | null>(null)
  const [month1, setMonth1] = useState<Date>(() => addMonths(parseDate(startDate) ?? new Date(), dualCalendar && !parseDate(startDate) ? -1 : 0))
  const [month2, setMonth2] = useState<Date>(() => addMonths(parseDate(startDate) ?? new Date(), dualCalendar && !parseDate(startDate) ? 0 : 1))
  const [selectingStart, setSelectingStart] = useState(true)
  const [position, setPosition] = useState({ below: true, alignRight: false })
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState("")
  const [selector, setSelector] = useState<{ calendar: 1 | 2; type: "month" | "year" } | null>(null)
  const [focusDay, setFocusDay] = useState<Date | null>(null)

  const dialogId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const skipBlur = useRef(false)
  const gridRef = useRef<HTMLDivElement>(null)

  // controlled values → internal selection (adjusted during render, not in an effect)
  const [prevProps, setPrevProps] = useState({ startDate, endDate })
  if (prevProps.startDate !== startDate || prevProps.endDate !== endDate) {
    setPrevProps({ startDate, endDate })
    setSelStart(parseDate(startDate))
    setSelEnd(parseDate(endDate))
  }

  // the second calendar always shows a month after the first
  const month2Shown = dualCalendar && month2 <= month1 ? addMonths(month1, 1) : month2

  // ----------------------------------------------------------------- rules

  const bounds = useMemo(() => {
    const today = startOfDay(new Date())
    let min = minDate ? startOfDay(minDate) : null
    let max = maxDate ? startOfDay(maxDate) : null
    if (disablePastDates && (!min || min < today)) min = today
    if (disableFutureDates && (!max || max > today)) max = today
    return { min, max }
  }, [minDate, maxDate, disablePastDates, disableFutureDates])

  const isDisabled = useCallback(
    (date: Date) => {
      const d = startOfDay(date)
      if (bounds.min && d < bounds.min) return true
      if (bounds.max && d > bounds.max) return true
      if (disabledDates.some((x) => sameDay(startOfDay(x), d))) return true
      if (!selectingStart && selStart && minDays) {
        const minEnd = startOfDay(selStart)
        minEnd.setDate(minEnd.getDate() + minDays - 1)
        if (d < minEnd && d >= startOfDay(selStart)) return true
      }
      if (!selectingStart && selStart && maxDays) {
        const maxEnd = startOfDay(selStart)
        maxEnd.setDate(maxEnd.getDate() + maxDays - 1)
        if (d > maxEnd) return true
      }
      return false
    },
    [bounds, disabledDates, selectingStart, selStart, minDays, maxDays],
  )

  const presets = useMemo<Preset[]>(() => {
    if (customPresets) return customPresets
    const today = () => new Date()
    const back = (n: number) => {
      const d = new Date()
      d.setDate(d.getDate() - n)
      return d
    }
    const list: Preset[] = [{ label: "Today", getDates: () => ({ start: today(), end: today() }) }]
    if (!disablePastDates) {
      list.push(
        { label: "Yesterday", getDates: () => ({ start: back(1), end: back(1) }) },
        { label: "Last 7 days", getDates: () => ({ start: back(6), end: today() }) },
        { label: "Last 30 days", getDates: () => ({ start: back(29), end: today() }) },
        { label: "Last 90 days", getDates: () => ({ start: back(89), end: today() }) },
        { label: "This month to date", getDates: () => ({ start: new Date(today().getFullYear(), today().getMonth(), 1), end: today() }) },
        {
          label: "Last month",
          getDates: () => {
            const n = today()
            return { start: new Date(n.getFullYear(), n.getMonth() - 1, 1), end: new Date(n.getFullYear(), n.getMonth(), 0) }
          },
        },
      )
    }
    if (!disablePastDates && !disableFutureDates) {
      list.push({
        label: "This month",
        getDates: () => {
          const n = today()
          return { start: new Date(n.getFullYear(), n.getMonth(), 1), end: new Date(n.getFullYear(), n.getMonth() + 1, 0) }
        },
      })
    }
    // a preset that lands on disabled days is hidden
    return list.filter((p) => {
      const { start, end } = p.getDates()
      return !isDisabled(start) && !isDisabled(end)
    })
  }, [customPresets, disablePastDates, disableFutureDates, isDisabled])

  // ----------------------------------------------------------------- committing a selection

  const commit = useCallback(
    (start: Date | null, end: Date | null) => {
      const s = formatDate(start)
      const e = singleDate ? s : formatDate(end)
      setStartDate(s)
      setEndDate(e)
      if (!start) onChange?.("", "", null, null)
      else if (singleDate) onChange?.(s, s, start, start)
      else if (end) onChange?.(s, e, start, end)
    },
    [onChange, setStartDate, setEndDate, singleDate],
  )

  const select = (start: Date | null, end: Date | null, close: boolean) => {
    setSelStart(start)
    setSelEnd(end)
    setSelectingStart(true)
    setHoverDate(null)
    if (start) {
      setMonth1(new Date(start.getFullYear(), start.getMonth(), 1))
      if (dualCalendar) setMonth2(addMonths(start, 1))
    }
    commit(start, end)
    if (close && closeOnSelect) setTimeout(() => setIsOpen(false), 150)
  }

  const shownValue = selStart ? (singleDate ? formatDate(selStart) : selEnd ? `${formatDate(selStart)} - ${formatDate(selEnd)}` : formatDate(selStart)) : ""

  // ----------------------------------------------------------------- open / close / position

  useEffect(() => {
    if (!isOpen) return
    const onDown = (e: MouseEvent) => {
      if (rootRef.current?.contains(e.target as Node)) return
      // half-picked range: keep it open, like the original
      if (selStart && !selEnd && !singleDate) return
      setIsOpen(false)
      setEditing(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsOpen(false)
        inputRef.current?.focus()
      }
    }
    document.addEventListener("mousedown", onDown)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("mousedown", onDown)
      document.removeEventListener("keydown", onKey)
    }
  }, [isOpen, selStart, selEnd, singleDate])

  const open = () => {
    if (disabled) return
    const anchor = (inputRef.current ?? rootRef.current)?.getBoundingClientRect()
    if (anchor) {
      const height = 440
      const width = (dualCalendar ? 660 : 340) + (showPresets && !singleDate ? 150 : 0)
      const below = window.innerHeight - anchor.bottom
      setPosition({
        below: below >= height || below > anchor.top,
        alignRight: window.innerWidth - anchor.left < width && anchor.right >= width,
      })
    }
    setSelector(null)
    setIsOpen(true)
  }

  // ----------------------------------------------------------------- typed input

  const formatPart = (digits: string, trailing: boolean) => {
    let out = digits.slice(0, 2)
    if (digits.length > 2 || (trailing && digits.length === 2)) out += "/" + digits.slice(2, 4)
    if (digits.length > 4 || (trailing && digits.length === 4)) out += "/" + digits.slice(4, 8)
    return out
  }
  const formatTyped = (raw: string, deleting: boolean) => {
    const digits = raw.replace(/\D/g, "").slice(0, singleDate ? 8 : 16)
    if (digits.length <= 8) {
      const s = formatPart(digits, !deleting)
      return !singleDate && digits.length === 8 && !deleting ? `${s} - ` : s
    }
    return `${formatPart(digits.slice(0, 8), false)} - ${formatPart(digits.slice(8), !deleting)}`
  }
  const parseTyped = (value: string, strict: boolean) => {
    const parts = value.split("-").map((p) => p.trim()).filter(Boolean)
    if (strict && !parts.every((p) => STRICT_DATE_PATTERN.test(p))) return null
    if (parts.length === 2) {
      const s = parseDate(parts[0])
      const e = parseDate(parts[1])
      return s && e && s <= e && !isDisabled(s) && !isDisabled(e) ? { start: s, end: e } : null
    }
    if (parts.length === 1) {
      const d = parseDate(parts[0])
      return d && !isDisabled(d) ? { start: d, end: singleDate ? d : null } : null
    }
    return null
  }
  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const deleting = e.target.value.length < draft.length
    const next = formatTyped(e.target.value, deleting)
    setDraft(next)
    const parsed = parseTyped(next, true)
    if (parsed && (singleDate || parsed.end)) {
      setSelStart(parsed.start)
      setSelEnd(parsed.end)
      setMonth1(new Date(parsed.start.getFullYear(), parsed.start.getMonth(), 1))
    }
  }
  const applyTyped = (strict: boolean) => {
    const parsed = parseTyped(draft.trim(), strict)
    if (!parsed) return false
    select(parsed.start, parsed.end, false)
    if (!parsed.end && !singleDate) setSelectingStart(false)
    return parsed
  }
  const onInputBlur = () => {
    if (skipBlur.current) {
      skipBlur.current = false
      return
    }
    if (allowManualInput) {
      if (!draft.trim()) {
        if (shownValue) select(null, null, false)
      } else if (!applyTyped(false)) setDraft(shownValue)
    }
    setEditing(false)
  }
  const onInputKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault()
      const parsed = allowManualInput && applyTyped(true)
      if (!parsed) return
      setEditing(false)
      if (parsed.end) setIsOpen(false)
      skipBlur.current = true
      inputRef.current?.blur()
    } else if (e.key === "Escape") {
      setDraft(shownValue)
      setEditing(false)
      setIsOpen(false)
    } else if (e.key === "ArrowDown") {
      e.preventDefault()
      open()
      setFocusDay(selStart ?? startOfDay(new Date()))
    }
  }

  // ----------------------------------------------------------------- day grid

  const daysOf = (month: Date) => {
    const y = month.getFullYear()
    const m = month.getMonth()
    const lead = (new Date(y, m, 1).getDay() - firstDayOfWeek + 7) % 7
    return Array.from({ length: 42 }, (_, i) => {
      const date = new Date(y, m, 1 - lead + i)
      return { date, inMonth: date.getMonth() === m }
    })
  }

  const clickDay = (date: Date) => {
    if (isDisabled(date)) return
    if (singleDate) return select(date, date, true)
    if (selectingStart || !selStart) {
      setSelStart(date)
      setSelEnd(null)
      setSelectingStart(false)
      setHoverDate(null)
      return
    }
    if (!allowSingleDayRange && sameDay(date, selStart)) return
    const [s, e] = date < selStart ? [date, selStart] : [selStart, date]
    select(s, e, true)
  }

  const moveFocus = (date: Date, by: number) => {
    const next = new Date(date)
    next.setDate(next.getDate() + by)
    setFocusDay(next)
    if (next < month1 || next >= addMonths(dualCalendar ? month2Shown : month1, 1)) {
      const m = new Date(next.getFullYear(), next.getMonth(), 1)
      setMonth1(dualCalendar && next >= month1 ? addMonths(m, -1) : m)
    }
  }

  useEffect(() => {
    if (!focusDay || !isOpen) return
    const key = `${focusDay.getFullYear()}-${focusDay.getMonth()}-${focusDay.getDate()}`
    gridRef.current?.querySelector<HTMLButtonElement>(`[data-day="${key}"]`)?.focus()
  }, [focusDay, isOpen, month1, month2Shown])

  const onDayKey = (e: React.KeyboardEvent, date: Date) => {
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key]
    if (step) {
      e.preventDefault()
      moveFocus(date, step)
    } else if (e.key === "PageUp" || e.key === "PageDown") {
      e.preventDefault()
      const d = new Date(date)
      d.setMonth(d.getMonth() + (e.key === "PageUp" ? -1 : 1))
      setFocusDay(d)
      setMonth1(new Date(d.getFullYear(), d.getMonth(), 1))
    }
  }

  // ----------------------------------------------------------------- month / year overlay

  const setMonthOf = (cal: 1 | 2, d: Date) => (cal === 1 ? setMonth1(d) : setMonth2(d))
  const periodDisabled = (from: Date, to: Date) => (bounds.min && to < bounds.min) || (bounds.max && from > bounds.max)

  const renderSelector = (month: Date, cal: 1 | 2) => {
    if (!selector || selector.calendar !== cal) return null
    const shownY = month.getFullYear()
    const shownM = month.getMonth()
    const now = new Date()
    const option = (selected: boolean, dis: boolean, current: boolean) =>
      cn(
        "h-9 rounded-md text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
        selected
          ? "bg-primary font-semibold text-primary-foreground"
          : dis
            ? "cursor-not-allowed text-muted-foreground/40"
            : cn("hover:bg-accent", current ? "font-semibold text-primary" : "text-foreground"),
      )
    if (selector.type === "month") {
      return (
        <div className="absolute inset-x-0 top-10 bottom-0 z-10 grid animate-in grid-cols-3 content-center gap-1.5 rounded-lg border bg-popover p-2 shadow-md fade-in-0 slide-in-from-top-1">
          {MONTHS.map((name, i) => {
            const dis = !!periodDisabled(new Date(shownY, i, 1), new Date(shownY, i + 1, 0))
            return (
              <button
                key={name}
                type="button"
                disabled={dis}
                onClick={() => {
                  setMonthOf(cal, new Date(shownY, i, 1))
                  setSelector(null)
                }}
                className={option(i === shownM, dis, i === now.getMonth() && shownY === now.getFullYear())}
              >
                {name.slice(0, 3)}
              </button>
            )
          })}
        </div>
      )
    }
    const from = Math.min(bounds.min?.getFullYear() ?? now.getFullYear() - 50, shownY)
    const to = Math.max(bounds.max?.getFullYear() ?? now.getFullYear() + 10, shownY)
    const years = Array.from({ length: to - from + 1 }, (_, i) => from + i)
    return (
      <div
        className="absolute inset-x-0 top-10 bottom-0 z-10 grid animate-in grid-cols-3 content-start gap-1.5 overflow-y-auto rounded-lg border bg-popover p-2 shadow-md fade-in-0 slide-in-from-top-1"
        ref={(el) => {
          const sel = el?.querySelector<HTMLElement>("[data-selected='true']")
          if (el && sel && !el.dataset.scrolled) {
            el.scrollTop = sel.offsetTop - el.clientHeight / 2 + sel.clientHeight / 2
            el.dataset.scrolled = "true"
          }
        }}
      >
        {years.map((y) => {
          const dis = !!periodDisabled(new Date(y, 0, 1), new Date(y, 11, 31))
          return (
            <button
              key={y}
              type="button"
              data-selected={y === shownY}
              disabled={dis}
              onClick={() => {
                setMonthOf(cal, new Date(y, shownM, 1))
                setSelector(null)
              }}
              className={option(y === shownY, dis, y === now.getFullYear())}
            >
              {y}
            </button>
          )
        })}
      </div>
    )
  }

  const navBtn = "flex size-7 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"

  const renderCalendar = (month: Date, cal: 1 | 2) => {
    const days = daysOf(month)
    const today = new Date()
    const headers = [...WEEKDAYS.slice(firstDayOfWeek), ...WEEKDAYS.slice(0, firstDayOfWeek)]
    const isOpenSel = (t: "month" | "year") => selector?.calendar === cal && selector.type === t
    const step = (cal: 1 | 2, months: number) => setMonthOf(cal, addMonths(cal === 1 ? month1 : month2Shown, months))
    const previewEnd = hoverPreview && !selectingStart && selStart && !selEnd ? hoverDate : null
    const [rangeA, rangeB] =
      selStart && (selEnd || previewEnd) ? [selStart, (selEnd ?? previewEnd)!].sort((a, b) => a.getTime() - b.getTime()) : [null, null]

    return (
      <div className="relative min-w-0 flex-1">
        {renderSelector(month, cal)}
        <div className="mb-2 flex h-8 items-center justify-between">
          {cal === 1 || !dualCalendar ? (
            <div className="flex">
              <button type="button" className={navBtn} onClick={() => step(cal, -12)} aria-label="Previous year" title="Previous year">
                <ChevronsLeft className="size-4" />
              </button>
              <button type="button" className={navBtn} onClick={() => step(cal, -1)} aria-label="Previous month" title="Previous month">
                <ChevronLeft className="size-4" />
              </button>
            </div>
          ) : (
            <span className="w-14" />
          )}
          <div className="flex items-center gap-0.5">
            {(["month", "year"] as const).map((t) => (
              <button
                key={t}
                type="button"
                aria-expanded={isOpenSel(t)}
                onClick={() => setSelector((p) => (p?.calendar === cal && p.type === t ? null : { calendar: cal, type: t }))}
                className={cn(
                  "flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-sm font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                  isOpenSel(t) ? "bg-accent" : "hover:bg-accent",
                )}
              >
                {t === "month" ? MONTHS[month.getMonth()] : month.getFullYear()}
                <ChevronDown className={cn("size-3.5 text-muted-foreground transition-transform", isOpenSel(t) && "rotate-180")} />
              </button>
            ))}
          </div>
          {cal === 2 || !dualCalendar ? (
            <div className="flex">
              <button type="button" className={navBtn} onClick={() => step(cal, 1)} aria-label="Next month" title="Next month">
                <ChevronRight className="size-4" />
              </button>
              <button type="button" className={navBtn} onClick={() => step(cal, 12)} aria-label="Next year" title="Next year">
                <ChevronsRight className="size-4" />
              </button>
            </div>
          ) : (
            <span className="w-14" />
          )}
        </div>

        <div role="grid" aria-label={`${MONTHS[month.getMonth()]} ${month.getFullYear()}`} className={cn("grid gap-y-0.5", showWeekNumbers ? "grid-cols-8" : "grid-cols-7")}>
          <div role="row" className="contents">
            {showWeekNumbers && (
              <span role="columnheader" className="flex h-8 items-center justify-center text-[11px] font-medium text-muted-foreground/70">
                Wk
              </span>
            )}
            {headers.map((d) => (
              <span key={d} role="columnheader" className="flex h-8 items-center justify-center text-[11px] font-medium text-muted-foreground">
                {d}
              </span>
            ))}
          </div>
          {days.map(({ date, inMonth }, i) => {
            const isStart = sameDay(date, selStart)
            const isEnd = sameDay(date, selEnd) || (!selEnd && sameDay(date, previewEnd))
            const between = !!rangeA && !!rangeB && date > rangeA && date < startOfDay(rangeB) && !sameDay(date, rangeA)
            const edgeStart = !!rangeA && sameDay(date, rangeA)
            const edgeEnd = !!rangeB && sameDay(date, rangeB)
            const dis = isDisabled(date)
            const weekend = highlightWeekends && (date.getDay() === 0 || date.getDay() === 6)
            const isToday = sameDay(date, today)
            const selected = isStart || (isEnd && !!selEnd)
            const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
            const tabbable = focusDay ? sameDay(date, focusDay) : sameDay(date, selStart ?? today)
            return (
              <Fragment key={key}>
                {showWeekNumbers && i % 7 === 0 && (
                  <span className="flex h-9 items-center justify-center text-[11px] text-muted-foreground/70">{isoWeek(date)}</span>
                )}
                {/* the range band runs behind the day buttons, flat between start and end */}
                <div
                  className={cn(
                    "relative flex h-9 items-center justify-center",
                    inMonth && (between || ((edgeStart || edgeEnd) && rangeA && rangeB && !sameDay(rangeA, rangeB))) && "bg-primary/10",
                    inMonth && edgeStart && "rounded-l-md",
                    inMonth && edgeEnd && "rounded-r-md",
                  )}
                >
                  {inMonth ? (
                    <button
                      type="button"
                      role="gridcell"
                      data-day={key}
                      tabIndex={tabbable ? 0 : -1}
                      disabled={dis}
                      aria-selected={selected || between}
                      aria-current={isToday ? "date" : undefined}
                      aria-label={`${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}${dis ? ", unavailable" : ""}`}
                      onClick={() => clickDay(date)}
                      onMouseEnter={() => !selectingStart && setHoverDate(date)}
                      onKeyDown={(e) => onDayKey(e, date)}
                      className={cn(
                        "tnum relative flex size-9 items-center justify-center rounded-md text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
                        dis
                          ? "cursor-not-allowed text-muted-foreground/35 line-through decoration-muted-foreground/30"
                          : selected || (isEnd && previewEnd)
                            ? cn("font-semibold", isEnd && !selEnd ? "bg-primary/70 text-primary-foreground" : "bg-primary text-primary-foreground shadow-sm")
                            : between
                              ? "text-foreground hover:bg-primary/15"
                              : cn("hover:bg-accent", weekend ? "text-primary" : "text-foreground"),
                      )}
                    >
                      {date.getDate()}
                      {isToday && !selected && <span aria-hidden className="absolute bottom-1 left-1/2 size-1 -translate-x-1/2 rounded-full bg-[var(--risk-critical)]" />}
                    </button>
                  ) : (
                    <span className="tnum text-sm text-muted-foreground/30" aria-hidden>
                      {date.getDate()}
                    </span>
                  )}
                </div>
              </Fragment>
            )
          })}
        </div>
      </div>
    )
  }

  const dayCount = selStart && selEnd ? Math.round((startOfDay(selEnd).getTime() - startOfDay(selStart).getTime()) / DAY_MS) + 1 : 0
  const activePreset = selStart && selEnd ? presets.find((p) => {
    const r = p.getDates()
    return sameDay(r.start, selStart) && sameDay(r.end, selEnd)
  })?.label : undefined

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      {label && (
        <label htmlFor={id} className="mb-1 block text-sm font-medium">
          {label}
        </label>
      )}

      {showInput ? (
        <div className="relative">
          <Calendar className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input
            id={id}
            ref={inputRef}
            type="text"
            inputMode="numeric"
            autoComplete="off"
            role="combobox"
            aria-haspopup="dialog"
            aria-controls={dialogId}
            aria-expanded={isOpen}
            aria-invalid={error || undefined}
            value={editing ? draft : shownValue}
            readOnly={!allowManualInput || disabled}
            disabled={disabled}
            placeholder={placeholder ?? (singleDate ? "DD/MM/YYYY" : "DD/MM/YYYY - DD/MM/YYYY")}
            onClick={open}
            onFocus={() => {
              if (allowManualInput && !disabled) {
                setEditing(true)
                setDraft(shownValue)
              }
            }}
            onChange={onInputChange}
            onBlur={onInputBlur}
            onKeyDown={onInputKey}
            className={cn(
              "tnum h-8 w-full rounded-lg border bg-card pr-8 pl-8 text-sm outline-none transition-colors placeholder:text-muted-foreground",
              "hover:border-primary/50 focus:border-primary focus:ring-3 focus:ring-primary/15",
              error && "border-destructive hover:border-destructive focus:border-destructive focus:ring-destructive/15",
              disabled && "cursor-not-allowed bg-muted opacity-70",
              !allowManualInput && "cursor-pointer",
              inputClassName,
            )}
          />
          {shownValue && showClearButton && !disabled && (
            <button
              type="button"
              aria-label="Clear dates"
              onClick={() => select(null, null, false)}
              className="absolute top-1/2 right-1.5 flex size-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
      ) : (
        <button
          type="button"
          aria-label="Choose dates"
          aria-expanded={isOpen}
          disabled={disabled}
          onClick={() => (isOpen ? setIsOpen(false) : open())}
          className="flex size-8 items-center justify-center rounded-lg border bg-card text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Calendar className="size-4" />
        </button>
      )}

      {error && errorMessage && <p className="mt-1 text-xs text-destructive">{errorMessage}</p>}

      {isOpen && (
        <div
          id={dialogId}
          role="dialog"
          aria-label={singleDate ? "Choose a date" : "Choose a date range"}
          className={cn(
            "absolute z-50 animate-in rounded-xl border bg-popover text-popover-foreground shadow-xl fade-in-0 zoom-in-95",
            position.below ? "top-[calc(100%+0.5rem)]" : "bottom-[calc(100%+0.5rem)]",
            position.alignRight ? "right-0" : "left-0",
          )}
        >
          <div className="flex">
            {showPresets && !singleDate && presets.length > 0 && (
              <div className="w-36 shrink-0 border-r p-2">
                <p className="px-2 pt-1 pb-2 text-xs font-medium text-muted-foreground">Quick select</p>
                <ul className="space-y-0.5">
                  {presets.map((p) => (
                    <li key={p.label}>
                      <button
                        type="button"
                        onClick={() => {
                          const r = p.getDates()
                          select(startOfDay(r.start), startOfDay(r.end), true)
                        }}
                        className={cn(
                          "w-full rounded-md px-2 py-1.5 text-left text-[13px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                          activePreset === p.label ? "bg-primary/10 font-medium text-primary" : "hover:bg-accent",
                        )}
                      >
                        {p.label}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="p-3">
              <div className="mb-2 flex items-center justify-between gap-4 px-1 text-xs">
                <span className="text-muted-foreground">
                  {singleDate ? "Select a date" : selectingStart ? "Select the start date" : "Select the end date"}
                </span>
                {dayCount > 0 && !singleDate && (
                  <span className="tnum rounded-full bg-primary/10 px-2 py-0.5 font-medium text-primary">
                    {dayCount} {dayCount === 1 ? "day" : "days"}
                  </span>
                )}
              </div>

              <div ref={gridRef} className={cn("flex gap-5", dualCalendar ? "flex-row" : "flex-col")}>
                <div className="w-[17.5rem]">{renderCalendar(month1, 1)}</div>
                {dualCalendar && <div className="w-[17.5rem] border-l pl-5">{renderCalendar(month2Shown, 2)}</div>}
              </div>

              {(showTodayButton || showClearButton) && (
                <div className="mt-3 flex gap-2 border-t pt-3">
                  {showTodayButton && (
                    <button
                      type="button"
                      onClick={() => {
                        const t = startOfDay(new Date())
                        select(t, t, true)
                      }}
                      className="h-8 flex-1 rounded-lg border text-sm outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      Today
                    </button>
                  )}
                  {showClearButton && (
                    <button
                      type="button"
                      onClick={() => select(null, null, false)}
                      className="h-8 flex-1 rounded-lg border text-sm text-destructive outline-none transition-colors hover:bg-destructive/5 focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      Clear
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
