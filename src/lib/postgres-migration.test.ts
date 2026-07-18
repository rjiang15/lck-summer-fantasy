import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  CATALOG_TABLES,
  describePostgresTarget,
  normalizePostgresValue,
  parseMigrationMode,
  selectMigrationTables,
  sortTablesByDependencies,
  sqlitePathFromUrl,
} from "./postgres-migration";

test("PostgreSQL and SQLite Prisma models stay identical", () => {
  const sqlite = fs.readFileSync(path.resolve("prisma/schema.prisma"), "utf8");
  const postgres = fs.readFileSync(path.resolve("prisma/postgres/schema.prisma"), "utf8");
  assert.equal(postgres.slice(postgres.indexOf("model Tournament")), sqlite.slice(sqlite.indexOf("model Tournament")));
});

test("catalog migration excludes every fantasy and authentication table", () => {
  const allTables: string[] = [...CATALOG_TABLES, "User", "League", "Session"];
  const selected = selectMigrationTables(allTables, "catalog");
  assert.equal(selected.includes("User"), false);
  assert.equal(selected.includes("League"), false);
  assert.equal(selected.includes("Session"), false);
  assert.deepEqual(selected, [...CATALOG_TABLES]);
});

test("dependency sort inserts referenced tables first", () => {
  const dependencies = new Map<string, Set<string>>([
    ["Game", new Set(["Match"])],
    ["Match", new Set(["Week"])],
    ["Week", new Set(["Tournament"])],
    ["Tournament", new Set()],
  ]);
  assert.deepEqual(
    sortTablesByDependencies(["Game", "Week", "Tournament", "Match"], dependencies),
    ["Tournament", "Week", "Match", "Game"],
  );
});

test("migration parsing and value conversion reject unsafe configuration", () => {
  assert.equal(parseMigrationMode(undefined), "catalog");
  assert.equal(parseMigrationMode("all"), "all");
  assert.throws(() => parseMigrationMode("partial"));
  assert.equal(normalizePostgresValue(1, "boolean", "flag"), true);
  assert.equal(normalizePostgresValue("0", "boolean", "flag"), false);
  assert.throws(() => normalizePostgresValue("yes", "boolean", "flag"));
  assert.equal((normalizePostgresValue("2026-07-17T00:00:00.000Z", "timestamp without time zone", "date") as Date).toISOString(), "2026-07-17T00:00:00.000Z");
  assert.throws(() => normalizePostgresValue("not-a-date", "timestamp without time zone", "date"));
});

test("connection descriptions never expose credentials", () => {
  assert.equal(sqlitePathFromUrl("file:./dev.db", "/tmp/example"), "/tmp/example/dev.db");
  assert.equal(describePostgresTarget("postgresql://private-user:private-password@example.neon.tech/fantasy?sslmode=require"), "example.neon.tech/fantasy");
});
