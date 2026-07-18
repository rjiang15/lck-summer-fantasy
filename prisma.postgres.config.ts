import { loadEnvConfig } from "@next/env";
import { defineConfig } from "prisma/config";

loadEnvConfig(process.cwd());

const runtimeUrl = process.env.DATABASE_URL;
const postgresUrl = process.env.POSTGRES_DIRECT_URL?.trim()
  || process.env.POSTGRES_DATABASE_URL?.trim()
  || (runtimeUrl?.startsWith("postgres://") || runtimeUrl?.startsWith("postgresql://") ? runtimeUrl : undefined)
  || "";

export default defineConfig({
  schema: "prisma/postgres/schema.prisma",
  migrations: {
    path: "prisma/postgres/migrations",
  },
  datasource: {
    // Prefer Neon's direct URL for migrations. DATABASE_URL may use its pooler
    // at application runtime.
    url: postgresUrl,
  },
});
