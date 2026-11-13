import { defineConfig } from "drizzle-kit"

process.loadEnvFile(".env.local")

export default defineConfig({
  schema: "./db/schema.ts",
  dialect: "postgresql",
  casing: "snake_case",
  dbCredentials: {
    // Direct connection: schema changes need session state, which the pooler doesn't keep.
    url: process.env.DATABASE_URL_UNPOOLED!,
  },
})
