import path from "node:path";

export type MigrationMode = "catalog" | "all";

// Source-of-truth LCK data that is safe to publish without copying local test
// accounts, leagues, sessions, drafts, or predictions.
export const CATALOG_TABLES = [
  "Tournament",
  "ProTeam",
  "ProPlayer",
  "TournamentPlayer",
  "Week",
  "Match",
  "Game",
  "PlayerGameStat",
  "TeamGameStat",
  "DraftAction",
  "GameEvent",
  "PlayerTimelineSnapshot",
  "TeamTimelineSnapshot",
  "IngestionRun",
  "StatProvenance",
] as const;

export function parseMigrationMode(value: string | undefined): MigrationMode {
  if (!value || value === "catalog") return "catalog";
  if (value === "all") return "all";
  throw new Error(`Unknown migration mode "${value}". Use catalog or all.`);
}

export function selectMigrationTables(allTables: string[], mode: MigrationMode): string[] {
  const available = new Set(allTables);
  if (mode === "all") return [...allTables].sort();
  const missing = CATALOG_TABLES.filter((table) => !available.has(table));
  if (missing.length > 0) throw new Error(`SQLite source is missing catalog tables: ${missing.join(", ")}`);
  return [...CATALOG_TABLES];
}

export function sortTablesByDependencies(
  tables: string[],
  dependencies: ReadonlyMap<string, ReadonlySet<string>>,
): string[] {
  const selected = new Set(tables);
  const remaining = new Map(
    tables.map((table) => [
      table,
      new Set([...(dependencies.get(table) ?? [])].filter((dependency) => selected.has(dependency))),
    ]),
  );
  const ordered: string[] = [];

  while (remaining.size > 0) {
    const ready = [...remaining.entries()]
      .filter(([, tableDependencies]) => tableDependencies.size === 0)
      .map(([table]) => table)
      .sort();
    if (ready.length === 0) {
      const cycle = [...remaining.entries()]
        .map(([table, tableDependencies]) => `${table} -> ${[...tableDependencies].join(", ")}`)
        .join("; ");
      throw new Error(`Cannot order tables because their foreign keys form a cycle: ${cycle}`);
    }
    for (const table of ready) {
      ordered.push(table);
      remaining.delete(table);
      for (const tableDependencies of remaining.values()) tableDependencies.delete(table);
    }
  }
  return ordered;
}

export function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

export function normalizePostgresValue(value: unknown, dataType: string, label: string): unknown {
  if (value === null || value === undefined) return null;
  if (dataType === "boolean") {
    if (value === true || value === 1 || value === "1") return true;
    if (value === false || value === 0 || value === "0") return false;
    throw new Error(`Invalid boolean in ${label}: ${String(value)}`);
  }
  if (dataType.startsWith("timestamp") || dataType === "date") {
    const date = value instanceof Date ? value : new Date(value as string | number);
    if (Number.isNaN(date.getTime())) throw new Error(`Invalid date in ${label}: ${String(value)}`);
    return date;
  }
  return value;
}

export function sqlitePathFromUrl(url: string, cwd = process.cwd()): string {
  if (!url.startsWith("file:")) throw new Error("The SQLite source URL must start with file:");
  const configuredPath = url.slice("file:".length);
  if (!configuredPath) throw new Error("The SQLite source URL does not contain a file path");
  return path.resolve(cwd, configuredPath);
}

export function describePostgresTarget(url: string): string {
  const parsed = new URL(url);
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    throw new Error("The PostgreSQL target URL must start with postgres: or postgresql:");
  }
  return `${parsed.hostname}/${parsed.pathname.replace(/^\//, "") || "postgres"}`;
}
