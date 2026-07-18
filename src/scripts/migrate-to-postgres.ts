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
  sortTablesByDependencies,
  sqlitePathFromUrl,
} from "@/lib/postgres-migration";

loadEnvConfig(process.cwd());

type SqliteColumn = { name: string; pk: number };
type SqliteForeignKey = { table: string };
type PostgresColumn = {
  column_name: string;
  data_type: string;
  column_default: string | null;
};

function argument(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

function sourceUrl() {
  const runtime = process.env.DATABASE_URL;
  return process.env.SQLITE_DATABASE_URL
    ?? (runtime?.startsWith("file:") ? runtime : undefined)
    ?? "file:./dev.db";
}

function targetUrl() {
  const runtime = process.env.DATABASE_URL;
  return process.env.POSTGRES_DIRECT_URL?.trim()
    || process.env.POSTGRES_DATABASE_URL?.trim()
    || (runtime?.startsWith("postgres://") || runtime?.startsWith("postgresql://") ? runtime : undefined);
}

function applicationTables(database: Database.Database): string[] {
  return (database.prepare(`
    SELECT name
    FROM sqlite_master
    WHERE type = 'table'
      AND name NOT LIKE 'sqlite_%'
      AND name <> '_prisma_migrations'
    ORDER BY name
  `).all() as Array<{ name: string }>).map(({ name }) => name);
}

function dependenciesFor(database: Database.Database, tables: string[]) {
  return new Map(tables.map((table) => {
    const foreignKeys = database.prepare(`PRAGMA foreign_key_list(${quoteIdentifier(table)})`).all() as SqliteForeignKey[];
    return [table, new Set(foreignKeys.map((foreignKey) => foreignKey.table))] as const;
  }));
}

async function targetColumns(client: Client, table: string): Promise<PostgresColumn[]> {
  const result = await client.query<PostgresColumn>(`
    SELECT column_name, data_type, column_default
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = $1
    ORDER BY ordinal_position
  `, [table]);
  return result.rows;
}

async function assertEmptyTarget(client: Client, tables: string[]) {
  const occupied: string[] = [];
  for (const table of tables) {
    const result = await client.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM ${quoteIdentifier(table)}`);
    if (Number(result.rows[0]?.count ?? 0) > 0) occupied.push(table);
  }
  if (occupied.length > 0) {
    throw new Error(`Target tables are not empty (${occupied.join(", ")}). Refusing to overwrite PostgreSQL data.`);
  }
}

async function insertTable(database: Database.Database, client: Client, table: string) {
  const sourceColumns = database.prepare(`PRAGMA table_info(${quoteIdentifier(table)})`).all() as SqliteColumn[];
  const postgresColumns = await targetColumns(client, table);
  const postgresByName = new Map(postgresColumns.map((column) => [column.column_name, column]));
  const missing = sourceColumns.filter((column) => !postgresByName.has(column.name)).map((column) => column.name);
  if (missing.length > 0) throw new Error(`${table} is missing PostgreSQL columns: ${missing.join(", ")}`);

  const columnNames = sourceColumns.map((column) => column.name);
  const rows = database.prepare(`SELECT * FROM ${quoteIdentifier(table)}`).all() as Array<Record<string, unknown>>;
  const batchSize = Math.max(1, Math.min(500, Math.floor(60_000 / Math.max(1, columnNames.length))));

  for (let offset = 0; offset < rows.length; offset += batchSize) {
    const batch = rows.slice(offset, offset + batchSize);
    const values: unknown[] = [];
    const tuples = batch.map((row) => `(${columnNames.map((columnName) => {
      const target = postgresByName.get(columnName)!;
      values.push(normalizePostgresValue(row[columnName], target.data_type, `${table}.${columnName}`));
      return `$${values.length}`;
    }).join(", ")})`);
    await client.query(
      `INSERT INTO ${quoteIdentifier(table)} (${columnNames.map(quoteIdentifier).join(", ")}) VALUES ${tuples.join(", ")}`,
      values,
    );
  }

  const serialId = postgresColumns.find((column) => column.column_name === "id" && column.column_default?.includes("nextval"));
  if (serialId && rows.length > 0) {
    await client.query(
      `SELECT setval(pg_get_serial_sequence($1, 'id'), MAX("id"), true) FROM ${quoteIdentifier(table)}`,
      [`"${table.replaceAll('"', '""')}"`],
    );
  }
  return rows.length;
}

async function main() {
  const mode = parseMigrationMode(argument("mode") ?? process.env.MIGRATION_MODE);
  const execute = process.argv.includes("--execute");
  const confirmed = argument("confirm") === "COPY_SQLITE_TO_POSTGRES";
  const sqlitePath = sqlitePathFromUrl(sourceUrl());
  if (!fs.existsSync(sqlitePath)) throw new Error(`SQLite source does not exist: ${sqlitePath}`);

  const database = new Database(sqlitePath, { readonly: true, fileMustExist: true });
  try {
    const tables = selectMigrationTables(applicationTables(database), mode);
    const counts = tables.map((table) => ({
      table,
      rows: Number((database.prepare(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(table)}`).get() as { count: number }).count),
    }));
    const totalRows = counts.reduce((sum, item) => sum + item.rows, 0);

    console.log(`Migration plan: ${mode} mode from ${sqlitePath}`);
    console.table(counts);
    console.log(`${counts.length} tables and ${totalRows.toLocaleString("en-US")} rows selected.`);
    if (!execute) {
      console.log("Plan only. No PostgreSQL connection was opened and no data was changed.");
      return;
    }
    if (!confirmed) throw new Error("Execution requires --confirm=COPY_SQLITE_TO_POSTGRES");

    const postgresUrl = targetUrl();
    if (!postgresUrl) throw new Error("Set POSTGRES_DIRECT_URL before executing the migration");
    console.log(`Target: ${describePostgresTarget(postgresUrl)}`);
    const client = new Client({ connectionString: postgresUrl });
    await client.connect();
    try {
      await client.query("BEGIN");
      try {
        // Serialize imports so two operators cannot both pass the empty-target
        // check and write the same catalog concurrently.
        await client.query("SELECT pg_advisory_xact_lock(hashtext('lck-fantasy-sqlite-import'))");
        const targetTableResult = await client.query<{ table_name: string }>(`
          SELECT table_name FROM information_schema.tables
          WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
        `);
        const targetTables = new Set(targetTableResult.rows.map(({ table_name }) => table_name));
        const missingTargetTables = tables.filter((table) => !targetTables.has(table));
        if (missingTargetTables.length > 0) {
          throw new Error(`PostgreSQL schema is not deployed; missing tables: ${missingTargetTables.join(", ")}`);
        }
        await assertEmptyTarget(client, tables);

        const orderedTables = sortTablesByDependencies(tables, dependenciesFor(database, tables));
        for (const table of orderedTables) {
          const copied = await insertTable(database, client, table);
          const targetCount = Number((await client.query<{ count: string }>(
            `SELECT COUNT(*)::text AS count FROM ${quoteIdentifier(table)}`,
          )).rows[0]?.count ?? 0);
          if (targetCount !== copied) throw new Error(`${table}: copied ${copied} rows but PostgreSQL contains ${targetCount}`);
          console.log(`Copied ${table}: ${copied.toLocaleString("en-US")} rows`);
        }
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    } finally {
      await client.end();
    }
    console.log("Migration committed. Run npm run db:migrate:verify before using the target database.");
  } finally {
    database.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
