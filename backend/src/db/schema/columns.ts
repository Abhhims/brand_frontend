/**
 * Column helpers shared by every table.
 *
 * IDs are UUIDv7: unique like UUIDv4, but time-ordered. New rows land at the end of the primary-key index
 * instead of at random positions, which keeps inserts fast and indexes compact as tables reach millions of rows.
 * They are generated in the app (as in the legacy backend), so an ID is known before the insert.
 */
import { timestamp, uuid } from "drizzle-orm/pg-core"
import { uuidv7 } from "uuidv7"

export const id = () => uuid().primaryKey().$defaultFn(() => uuidv7())

/** Always timestamptz (stored in UTC), never a naive timestamp */
export const tstz = () => timestamp({ withTimezone: true, mode: "date" })

export const createdAt = () => tstz().notNull().defaultNow()
export const updatedAt = () =>
  tstz()
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date())
