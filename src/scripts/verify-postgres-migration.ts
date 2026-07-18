import { createHash } from "node:crypto";
import fs from "node:fs";
import Database from "better-sqlite3";
import { loadEnvConfig } from "@next/env";
import { Client } from "pg";
import {
  describePostgresTarget,
  normalizePostgresValue,
  parseMigrationMode,
  quoteIdentifier,
  selectMigrationTables,
  sqlitePathFromUrl,
} from "@/lib/postgres-migration";

loadEnvConfig(process.cwd());

type SqliteColumn = { name: string; pk: number };
type PostgresColumn = { column_name: string; data_type: string };

function argument(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

function sourceUrl() {
  const runtime = process.env.DATABASE_URL;
  return process.env.SQLITE_DATABASE_URL ?? (runtime?.startsWith("file:") ? runtime : undefined) ?? "file:./dev.db";
}

function targetUrl() {
  const runtime = process.env.DATABASE_URL;
  return process.env.POSTGRES_DIRECT_URL?.trim()
    || process.env.POSTGRES_DATABASE_URL?.trim()
    || (runtime?.startsWith("postgres://") || runtime?.startsWith("postgresql://") ? runtime : undefined);
}

function hashRows(rows: Array<Record<string, unknown>>, columns: string[], types: Map<string, string>) {
  const hash = createHash("sha256");
  for (const row of rows) {
    const normalized = columns.map((column) => normalizePostgresValue(row[column], types.get(column)!, column));
    hash.update(JSON.stringify(normalized));
    hash.update("\n");
  }
  return hash.digest("hex");
}

async function main() {
  const mode = parseMigrationMode(argument("mode") ?? process.env.MIGRATION_MODE);
  const postgresUrl = targetUrl();
  if (!postgresUrl) throw new Error("Set POSTGRES_DIRECT_URL before verifying the migration");
  const sqlitePath = sqlitePathFromUrl(sourceUrl());
  if (!fs.existsSync(sqlitePath)) throw new Error(`SQLite source does not exist: ${sqlitePath}`);

  const database = new Database(sqlitePath, { readonly: true, fileMustExist: true });
  const client = new Client({ connectionString: postgresUrl });
  await client.connect();
  try {
    const sourceTables = (database.prepare(`
      SELECT name FROM sqlite_master
      WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> '_prisma_migrations'
      ORDER BY name
    `).all() as Array<{ name: string }>).map(({ name }) => name);
    const tables = selectMigrationTables(sourceTables, mode);
    console.log(`Verifying ${mode} migration at ${describePostgresTarget(postgresUrl)}`);

    for (const table of tables) {
      const sqliteColumns = database.prepare(`PRAGMA table_info(${quoteIdentifier(table)})`).all() as SqliteColumn[];
      const columns = sqliteColumns.map(({ name }) => name);
      const primaryKey = sqliteColumns.filter(({ pk }) => pk > 0).sort((a, b) => a.pk - b.pk).map(({ name }) => name);
      if (primaryKey.length === 0) throw new Error(`${table} does not have a primary key for deterministic verification`);
      const postgresColumns = (await client.query<PostgresColumn>(`
        SELECT column_name, data_type FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1
      `, [table])).rows;
      const types = new Map(postgresColumns.map((column) => [column.column_name, column.data_type]));
      const missing = columns.filter((column) => !types.has(column));
      if (missing.length > 0) throw new Error(`${table} is missing PostgreSQL columns: ${missing.join(", ")}`);
      const order = primaryKey.map(quoteIdentifier).join(", ");
      const sourceRows = database.prepare(`SELECT * FROM ${quoteIdentifier(table)} ORDER BY ${order}`).all() as Array<Record<string, unknown>>;
      const targetRows = (await client.query<Record<string, unknown>>(
        `SELECT ${columns.map(quoteIdentifier).join(", ")} FROM ${quoteIdentifier(table)} ORDER BY ${order}`,
      )).rows;
      if (sourceRows.length !== targetRows.length) {
        throw new Error(`${table}: SQLite has ${sourceRows.length} rows; PostgreSQL has ${targetRows.length}`);
      }
      const sourceHash = hashRows(sourceRows, columns, types);
      const targetHash = hashRows(targetRows, columns, types);
      if (sourceHash !== targetHash) throw new Error(`${table}: row content hash does not match`);
      console.log(`Verified ${table}: ${sourceRows.length.toLocaleString("en-US")} rows (${sourceHash.slice(0, 12)})`);
    }
    console.log("Verification passed: every selected row matches PostgreSQL.");
  } finally {
    database.close();
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
