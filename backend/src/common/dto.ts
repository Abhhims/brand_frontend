/** DTO building blocks shared by every module. */
import { z } from "zod"

/** Body of every error response (see plugins/error-handler.ts) */
export const ErrorDto = z.object({
  detail: z.union([z.string(), z.array(z.object({ loc: z.array(z.union([z.string(), z.number()])), msg: z.string() }))]),
})

/** ?page=&page_size= on every list endpoint. page_size is capped so no client can ask for a million rows. */
export const PageQueryDto = z.object({
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(200).default(25),
})
export type PageQuery = z.infer<typeof PageQueryDto>

/** { items, total, page, page_size } — same envelope the frontend already uses */
export const pageDto = <T extends z.ZodTypeAny>(item: T) =>
  z.object({ items: z.array(item), total: z.number().int(), page: z.number().int(), page_size: z.number().int() })

export const offsetOf = (q: PageQuery) => (q.page - 1) * q.page_size

/** A query parameter that may repeat (?platform=a&platform=b) → always an array (or undefined) */
export const queryArray = <T extends z.ZodTypeAny>(inner: T) =>
  z
    .union([inner, z.array(inner)])
    .optional()
    .transform((v): z.infer<T>[] | undefined => (v === undefined ? undefined : Array.isArray(v) ? v : [v]))

/** ?flag=true|false */
export const queryBool = z
  .enum(["true", "false", "1", "0"])
  .optional()
  .transform((v) => (v === undefined ? undefined : v === "true" || v === "1"))

/** YYYY-MM-DD */
export const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
