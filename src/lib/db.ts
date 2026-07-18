import "dotenv/config";
import path from "node:path";
import { PrismaClient as SqlitePrismaClient } from "@/generated/prisma/client";
import { PrismaClient as PostgresPrismaClient } from "@/generated/prisma-postgres/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaPg } from "@prisma/adapter-pg";

const url = process.env.DATABASE_URL ?? "file:./dev.db";

function createClient(): SqlitePrismaClient {
  if (url.startsWith("postgres://") || url.startsWith("postgresql://")) {
    const adapter = new PrismaPg({ connectionString: url });
    // Both generated clients come from model-identical schemas. Exporting the
    // SQLite type keeps the rest of the app provider-agnostic while the runtime
    // client uses PostgreSQL in production.
    return new PostgresPrismaClient({ adapter }) as unknown as SqlitePrismaClient;
  }

  if (!url.startsWith("file:")) {
    throw new Error("DATABASE_URL must use file:, postgres:, or postgresql:");
  }

  // Resolve the same way the Prisma CLI does: file: paths are relative to the
  // project root (where prisma.config.ts lives).
  const dbPath = url.replace(/^file:/, "");
  const adapter = new PrismaBetterSqlite3({
    // DATABASE_URL is runtime configuration; do not make Turbopack trace every
    // possible file below the project while statically analyzing this path.
    url: `file:${path.resolve(/* turbopackIgnore: true */ process.cwd(), dbPath)}`,
  });
  return new SqlitePrismaClient({ adapter });
}

const globalForPrisma = globalThis as unknown as { prisma?: SqlitePrismaClient };

export const prisma = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
