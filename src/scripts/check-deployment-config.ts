import fs from "node:fs";
import path from "node:path";
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

function modelBlocks(schema: string) {
  const firstModel = schema.indexOf("model Tournament");
  if (firstModel < 0) throw new Error("Prisma schema does not contain model Tournament");
  return schema.slice(firstModel);
}

const sqliteSchema = fs.readFileSync(path.resolve("prisma/schema.prisma"), "utf8");
const postgresSchema = fs.readFileSync(path.resolve("prisma/postgres/schema.prisma"), "utf8");
if (modelBlocks(sqliteSchema) !== modelBlocks(postgresSchema)) {
  throw new Error("SQLite and PostgreSQL Prisma models differ. Mirror the model change before deploying.");
}

const isVercelProduction = process.env.VERCEL === "1" && process.env.VERCEL_ENV === "production";
if (isVercelProduction) {
  const databaseUrl = process.env.DATABASE_URL ?? "";
  if (!databaseUrl.startsWith("postgres://") && !databaseUrl.startsWith("postgresql://")) {
    throw new Error("Production DATABASE_URL must be a PostgreSQL connection string; refusing an ephemeral SQLite deployment.");
  }
  if (!process.env.LP_BOT_USERNAME || !process.env.LP_BOT_PASSWORD) {
    throw new Error("Production requires LP_BOT_USERNAME and LP_BOT_PASSWORD for weekly ingestion.");
  }
}

const publicSecrets = ["NEXT_PUBLIC_DATABASE_URL", "NEXT_PUBLIC_POSTGRES_DIRECT_URL", "NEXT_PUBLIC_LP_BOT_PASSWORD"]
  .filter((name) => process.env[name]);
if (publicSecrets.length > 0) {
  throw new Error(`Server secrets must not use NEXT_PUBLIC_: ${publicSecrets.join(", ")}`);
}

console.log(isVercelProduction
  ? "Deployment configuration valid for Vercel production."
  : "Schema parity valid. Production-only environment checks skipped outside Vercel production.");
