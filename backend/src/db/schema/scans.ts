/** Scan runs: one scanner for one brand (legacy scan_runs, docs/port §1.2). */
import { sql } from "drizzle-orm"
import { index, jsonb, pgTable, text, uuid, varchar } from "drizzle-orm/pg-core"
import type { ScanComponent } from "../../common/scan-report.js"
import { createdAt, id, tstz } from "./columns.js"
import { brands } from "./core.js"
import { moduleNameEnum, scanStatusEnum } from "./enums.js"

export const scanRuns = pgTable(
  "scan_runs",
  {
    id: id(),
    brandId: uuid()
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    module: moduleNameEnum().notNull(),
    /** manual | schedule */
    trigger: varchar({ length: 20 }).notNull().default("schedule"),
    status: scanStatusEnum().notNull().default("queued"),
    startedAt: tstz(),
    finishedAt: tstz(),
    /** {runner, date_from?, date_to?} at creation; run totals + module stats after the run */
    stats: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    /** what each part of the scan did */
    components: jsonb().$type<ScanComponent[]>().notNull().default(sql`'[]'::jsonb`),
    /** "{component}: {message}" lines for failed/unavailable parts */
    error: text(),
    createdAt: createdAt(),
  },
  (t) => [index("ix_scan_runs_brand_id").on(t.brandId), index("ix_scan_runs_created_at").on(t.createdAt)],
)
