// CLI backup/restore, same format as the /api/export and /api/import routes.
// Usage:
//   npx tsx src/scripts/backup.ts export <leagueId> [file.json]
//   npx tsx src/scripts/backup.ts import <leagueId> <file.json>

import fs from "node:fs";
import { exportLeague, importLeague } from "../lib/backup";
import { parseBackupJson } from "../lib/backup-format";
import { prisma } from "../lib/db";

async function main() {
  const [mode, leagueArg, file] = [process.argv[2], process.argv[3], process.argv[4]];
  const leagueId = Number(leagueArg);
  if (!Number.isInteger(leagueId)) throw new Error("A numeric leagueId is required");
  if (mode === "export") {
    const backup = await exportLeague(leagueId);
    if (!backup) throw new Error("No league to export.");
    const out = file ?? `lck-fantasy-backup-${backup.exportedAt.slice(0, 10)}.json`;
    fs.writeFileSync(out, JSON.stringify(backup, null, 2));
    console.log(`Exported to ${out}`);
  } else if (mode === "import") {
    if (!file) throw new Error("Usage: backup.ts import <file.json>");
    const backup = parseBackupJson(fs.readFileSync(file, "utf8"));
    const owner = await prisma.leagueMembership.findFirst({ where: { leagueId, role: "OWNER" } });
    if (!owner) throw new Error("Target league has no owner");
    const result = await importLeague(leagueId, backup, owner.userId);
    if (!result.ok) throw new Error(result.error);
    console.log("Import successful.");
  } else {
    console.error("Usage: backup.ts export <leagueId> [file.json] | import <leagueId> <file.json>");
    process.exit(1);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
