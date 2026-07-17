// Destructive lifecycle smoke test intended for a disposable database copy.
import assert from "node:assert/strict";
import { copyFileSync, existsSync, unlinkSync } from "node:fs";
import path from "node:path";

const disposableDb = `/tmp/lck-fantasy-pipeline-${process.pid}.db`;
const archivedFixture = path.resolve("archive/full-season-2026-07-17/dev.db");
copyFileSync(existsSync(archivedFixture) ? archivedFixture : path.resolve("dev.db"), disposableDb);
process.env.DATABASE_URL = `file:${disposableDb}`;

async function main() {
  const { prisma } = await import("../lib/db");
  const { calculateWeeklyScores, snapshotWeeklyRosters, validateLeagueWeek } = await import("../lib/season");
  const leagueWeek = await prisma.leagueWeek.findFirst({
    where: { status: "OPEN" },
    include: { league: { include: { fantasyTeams: true } }, week: true },
  });
  assert.ok(leagueWeek, "Expected an open league week");
  const validation = await validateLeagueWeek(leagueWeek.id);
  assert.equal(validation.ok, true, validation.errors.join("; "));
  await snapshotWeeklyRosters(leagueWeek.id);
  await calculateWeeklyScores(leagueWeek.id);
  const rosterRows = await prisma.weeklyRosterSlot.count({ where: { leagueWeekId: leagueWeek.id } });
  const scoreRows = await prisma.weeklyScore.count({ where: { leagueWeekId: leagueWeek.id } });
  assert.ok(rosterRows >= leagueWeek.league.fantasyTeams.length * 5);
  assert.equal(scoreRows, leagueWeek.league.fantasyTeams.length);
  console.log({ week: leagueWeek.week.number, validation, rosterRows, scoreRows });
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  try { unlinkSync(disposableDb); } catch { /* best-effort test cleanup */ }
});
