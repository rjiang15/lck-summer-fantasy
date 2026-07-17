// Destructive lifecycle smoke test intended for a disposable database copy.
import assert from "node:assert/strict";
import { copyFileSync, existsSync, unlinkSync } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const disposableDb = `/tmp/lck-fantasy-pipeline-${process.pid}.db`;
const archivedFixture = path.resolve("archive/full-season-2026-07-17/dev.db");
copyFileSync(existsSync(archivedFixture) ? archivedFixture : path.resolve("dev.db"), disposableDb);
process.env.DATABASE_URL = `file:${disposableDb}`;
execFileSync(path.resolve("node_modules/.bin/prisma"), ["migrate", "deploy"], {
  env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL },
  stdio: "ignore",
});

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
  const lockedAt = new Date();
  await prisma.leagueWeek.update({
    where: { id: leagueWeek.id },
    data: { status: "LOCKED", picksLockedAt: lockedAt, rosterLockedAt: lockedAt },
  });
  await calculateWeeklyScores(leagueWeek.id);
  const rosterRows = await prisma.weeklyRosterSlot.count({ where: { leagueWeekId: leagueWeek.id } });
  const scoreRows = await prisma.weeklyScore.count({ where: { leagueWeekId: leagueWeek.id } });
  assert.ok(rosterRows >= leagueWeek.league.fantasyTeams.length * 5);
  assert.equal(scoreRows, leagueWeek.league.fantasyTeams.length);

  // Regression: a live roster move after the weekly lock must not rewrite the
  // frozen ownership rows or change that week's score on recalculation.
  const team = await prisma.fantasyTeam.findFirstOrThrow({
    where: { leagueId: leagueWeek.leagueId },
    include: { roster: true },
  });
  const outgoing = team.roster[0];
  assert.ok(outgoing, "Expected a current roster player");
  const currentIds = team.roster.map((slot) => slot.playerId);
  const replacement = await prisma.tournamentPlayer.findFirstOrThrow({
    where: { tournamentId: leagueWeek.league.tournamentId, playerId: { notIn: currentIds } },
  });
  const beforeSnapshot = await prisma.weeklyRosterSlot.findMany({
    where: { leagueWeekId: leagueWeek.id },
    orderBy: { id: "asc" },
    select: { fantasyTeamId: true, playerId: true, slot: true },
  });
  const beforeScores = await prisma.weeklyScore.findMany({
    where: { leagueWeekId: leagueWeek.id },
    orderBy: { fantasyTeamId: "asc" },
    select: { fantasyTeamId: true, rosterPts: true, pickemPts: true, total: true, breakdown: true },
  });
  await prisma.rosterSlot.update({ where: { id: outgoing.id }, data: { playerId: replacement.playerId } });
  await snapshotWeeklyRosters(leagueWeek.id);
  await calculateWeeklyScores(leagueWeek.id);
  const afterSnapshot = await prisma.weeklyRosterSlot.findMany({
    where: { leagueWeekId: leagueWeek.id },
    orderBy: { id: "asc" },
    select: { fantasyTeamId: true, playerId: true, slot: true },
  });
  const afterScores = await prisma.weeklyScore.findMany({
    where: { leagueWeekId: leagueWeek.id },
    orderBy: { fantasyTeamId: "asc" },
    select: { fantasyTeamId: true, rosterPts: true, pickemPts: true, total: true, breakdown: true },
  });
  assert.deepEqual(afterSnapshot, beforeSnapshot, "A locked weekly roster snapshot changed after a live roster move");
  assert.deepEqual(afterScores, beforeScores, "Historical weekly scores changed after a live roster move");
  assert.ok(afterSnapshot.some((slot) => slot.fantasyTeamId === team.id && slot.playerId === outgoing.playerId));
  assert.ok(!afterSnapshot.some((slot) => slot.fantasyTeamId === team.id && slot.playerId === replacement.playerId));
  console.log({ week: leagueWeek.week.number, validation, rosterRows, scoreRows, rosterHistoryProtected: true });
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  try { unlinkSync(disposableDb); } catch { /* best-effort test cleanup */ }
});
