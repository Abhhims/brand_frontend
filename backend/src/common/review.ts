/** Analyst review of a result (same statuses and rules for every module: phishing domains, social items…). */
import { z } from "zod"

export const REVIEW_STATUSES = ["New", "Investigating", "Confirmed Threat", "False Positive", "Legitimate", "Ignored", "Resolved"] as const
export const OPEN_REVIEW = ["New", "Investigating", "Confirmed Threat"] as const
/** closing a result as not a threat needs a reason */
export const NOTE_REQUIRED = new Set<string>(["False Positive", "Legitimate", "Ignored"])

export const ReviewDto = z
  .object({
    status: z.enum(REVIEW_STATUSES),
    /** required for False Positive, Legitimate and Ignored */
    note: z.string().trim().max(2000).optional(),
  })
  .strict()
export type ReviewInput = z.infer<typeof ReviewDto>
