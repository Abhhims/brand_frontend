/** Database access for users. Used by auth now; the users admin module (list/create/update) builds on it. */
import { eq, sql } from "drizzle-orm"
import type { Db } from "../../infra/db.js"
import { users } from "../../db/schema/index.js"

export type UserRow = typeof users.$inferSelect

export class UsersRepository {
  constructor(private readonly db: Db) {}

  async findByEmail(email: string): Promise<UserRow | undefined> {
    const [row] = await this.db
      .select()
      .from(users)
      .where(sql`lower(${users.email}) = ${email.toLowerCase()}`)
      .limit(1)
    return row
  }

  async findById(id: string): Promise<UserRow | undefined> {
    const [row] = await this.db.select().from(users).where(eq(users.id, id)).limit(1)
    return row
  }
}
