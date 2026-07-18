import fs from "node:fs";
import path from "node:path";

const sourcePath = path.resolve("prisma/schema.prisma");
const targetPath = path.resolve("prisma/postgres/schema.prisma");
const source = fs.readFileSync(sourcePath, "utf8");
const generated = source
  .replace(
    "// LCK Fantasy League — Prisma schema\n// SQLite for the MVP; swap the datasource to Postgres before multi-user deploy.",
    "// Production mirror of prisma/schema.prisma for Neon PostgreSQL.\n// Keep every model block byte-for-byte equivalent; the schema parity test\n// prevents a deployment when the SQLite and PostgreSQL models drift.",
  )
  .replace('output   = "../src/generated/prisma"', 'output   = "../../src/generated/prisma-postgres"')
  .replace('provider = "sqlite"', 'provider = "postgresql"');

if (generated === source) throw new Error("Expected SQLite generator and datasource declarations were not found");
fs.writeFileSync(targetPath, generated);
console.log(`Synchronized ${path.relative(process.cwd(), targetPath)} from the canonical SQLite schema.`);
