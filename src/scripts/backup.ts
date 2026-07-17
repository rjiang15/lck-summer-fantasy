// CLI backup/restore, same format as the /api/export and /api/import routes.
// Usage:
//   npx tsx src/scripts/backup.ts export [file.json]
//   npx tsx src/scripts/backup.ts import <file.json>

import fs from "node:fs";
import { exportLeague, importLeague, type Backup } from "../lib/backup";
import { prisma } from "../lib/db";

async function main() {
  const [mode, file] = [process.argv[2], process.argv[3]];
  if (mode === "export") {
    const backup = await exportLeague();
    if (!backup) throw new Error("No league to export.");
    const out = file ?? `lck-fantasy-backup-${backup.exportedAt.slice(0, 10)}.json`;
    fs.writeFileSync(out, JSON.stringify(backup, null, 2));
    console.log(`Exported to ${out}`);
  } else if (mode === "import") {
    if (!file) throw new Error("Usage: backup.ts import <file.json>");
    const backup = JSON.parse(fs.readFileSync(file, "utf8")) as Backup;
    const result = await importLeague(backup);
    if (!result.ok) throw new Error(result.error);
    console.log("Import successful.");
  } else {
    console.error("Usage: backup.ts export [file.json] | import <file.json>");
    process.exit(1);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
