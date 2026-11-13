import { parseEnv } from "@neon/env"
import { drizzle } from "drizzle-orm/node-postgres"
import { Pool } from "pg"

import config from "@/neon"

import * as schema from "./schema"

const { postgres } = parseEnv(config, ["DATABASE_URL"])

// Reuse one pool across hot reloads in development.
const globalForDb = globalThis as unknown as { pgPool?: Pool }

const pool =
  globalForDb.pgPool ?? new Pool({ connectionString: postgres.databaseUrl })

if (process.env.NODE_ENV !== "production") {
  globalForDb.pgPool = pool
}

export const db = drizzle({ client: pool, schema, casing: "snake_case" })
