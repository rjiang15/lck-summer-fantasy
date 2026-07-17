import "dotenv/config";
import path from "node:path";
import { PrismaClient } from "@/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

// Resolve the same way the Prisma CLI does: file: paths in DATABASE_URL are
// relative to the project root (where prisma.config.ts lives).
const url = process.env.DATABASE_URL ?? "file:./dev.db";
const dbPath = url.replace(/^file:/, "");
const adapter = new PrismaBetterSqlite3({
  // DATABASE_URL is runtime configuration; do not make Turbopack trace every
  // possible file below the project while statically analyzing this path.
  url: `file:${path.resolve(/* turbopackIgnore: true */ process.cwd(), dbPath)}`,
});

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
