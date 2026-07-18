import { loadEnvConfig } from "@next/env";
import { defineConfig } from "prisma/config";

loadEnvConfig(process.cwd());

const sqliteUrl = process.env.SQLITE_DATABASE_URL
  ?? (process.env.DATABASE_URL?.startsWith("file:") ? process.env.DATABASE_URL : undefined)
  ?? "file:./dev.db";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // Keep local SQLite tooling independent from the production Postgres URL.
    url: sqliteUrl,
  },
});
