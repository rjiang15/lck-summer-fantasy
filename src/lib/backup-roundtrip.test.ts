import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@/generated/prisma/client";
import {
  createStoredLeagueBackup,
  deleteLeagueWithRecovery,
  deleteStoredLeagueBackup,
  exportLeague,
  importLeague,
  restoreStoredBackupAsLeague,
} from "./backup";

function createTestDatabase() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "lck-backup-test-"));
  const databasePath = path.join(directory, "test.db");
  const raw = new Database(databasePath);
  raw.pragma("foreign_keys = ON");
  const migrations = fs.readdirSync(path.resolve("prisma/migrations")).sort();
  for (const migration of migrations) {
    const migrationPath = path.resolve("prisma/migrations", migration, "migration.sql");
    if (fs.existsSync(migrationPath)) raw.exec(fs.readFileSync(migrationPath, "utf8"));
  }
  raw.close();
  const client = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: `file:${databasePath}` }) });
  return { client, directory };
}

test("checkpoint survives league deletion and restores the complete fantasy state", async () => {
  const { client, directory } = createTestDatabase();
  try {
    await client.tournament.create({ data: { id: "LCK/Test", name: "Test Tournament", catalogStatus: "PAST" } });
    await client.proTeam.create({ data: { id: "T1", short: "T1" } });
    await client.proPlayer.createMany({ data: [
      { id: "player-one", name: "One", role: "Top", teamId: "T1", tournamentId: "LCK/Test" },
      { id: "player-two", name: "Two", role: "Jungle", teamId: "T1", tournamentId: "LCK/Test" },
    ] });
    await client.tournamentPlayer.createMany({ data: [
      { tournamentId: "LCK/Test", playerId: "player-one", teamId: "T1", role: "Top" },
      { tournamentId: "LCK/Test", playerId: "player-two", teamId: "T1", role: "Jungle" },
    ] });
    const week = await client.week.create({ data: { tournamentId: "LCK/Test", number: 1, startsAt: new Date("2026-01-01T00:00:00Z"), endsAt: new Date("2026-01-07T00:00:00Z"), scheduleImportedAt: new Date(), resultsImportedAt: new Date() } });
    await client.match.create({ data: { id: "match-one", tournamentId: "LCK/Test", weekId: week.id, team1: "T1", team2: "T2", bestOf: 3, scheduledAt: new Date("2026-01-02T00:00:00Z"), winner: "T1", team1Score: 2, team2Score: 0 } });
    const owner = await client.user.create({ data: { username: "owner", passwordHash: "owner-hash" } });
    const participant = await client.user.create({ data: { username: "participant", passwordHash: "participant-hash" } });
    const league = await client.league.create({ data: {
      name: "Round Trip League", slug: "round-trip", inviteCode: "INVITE", tournamentId: "LCK/Test",
      scoringConfig: "{}", currentWeek: 1, seasonStatus: "ACTIVE", isSimulation: true,
      draftStatus: "COMPLETE", draftCurrentPick: 2,
      memberships: { create: [{ userId: owner.id, role: "OWNER" }, { userId: participant.id, role: "PARTICIPANT" }] },
    } });
    const ownerTeam = await client.fantasyTeam.create({ data: { leagueId: league.id, userId: owner.id, name: "Owners", roster: { create: [{ playerId: "player-one", slot: "TOP" }] } } });
    const participantTeam = await client.fantasyTeam.create({ data: { leagueId: league.id, userId: participant.id, name: "Participants", roster: { create: [{ playerId: "player-two", slot: "JNG" }] } } });
    await client.league.update({ where: { id: league.id }, data: { draftOrder: JSON.stringify([ownerTeam.id, participantTeam.id]) } });
    await client.draftPick.createMany({ data: [
      { leagueId: league.id, fantasyTeamId: ownerTeam.id, playerId: "player-one", overallPick: 1, round: 1, role: "Top", price: 1000 },
      { leagueId: league.id, fantasyTeamId: participantTeam.id, playerId: "player-two", overallPick: 2, round: 1, role: "Jungle", price: 1000 },
    ] });
    await client.pickem.create({ data: { leagueId: league.id, userId: owner.id, matchId: "match-one", predictedWinner: "T1", predictedScore: "2-0" } });
    await client.crystalBallQuestion.create({ data: { leagueId: league.id, prompt: "Most picked champion", answerType: "champion", points: 50, metricKey: "most_picked", answers: { create: [{ userId: owner.id, answer: "Ahri" }] } } });
    const leagueWeek = await client.leagueWeek.create({ data: { leagueId: league.id, weekId: week.id, status: "PUBLISHED", picksOpenAt: new Date(), picksLockedAt: new Date(), rosterLockedAt: new Date(), resultsImportedAt: new Date(), scoredAt: new Date(), publishedAt: new Date() } });
    await client.weeklyRosterSlot.createMany({ data: [
      { leagueWeekId: leagueWeek.id, fantasyTeamId: ownerTeam.id, playerId: "player-one", slot: "TOP" },
      { leagueWeekId: leagueWeek.id, fantasyTeamId: participantTeam.id, playerId: "player-two", slot: "JNG" },
    ] });
    await client.weeklyScore.create({ data: { leagueWeekId: leagueWeek.id, fantasyTeamId: ownerTeam.id, rosterPts: 21, pickemPts: 15, total: 36, breakdown: "{}", publishedAt: new Date() } });

    const exported = await exportLeague(league.id, client);
    assert.ok(exported);
    assert.equal(exported.version, 7);
    assert.equal(exported.users.some((user) => "passwordHash" in user), false);
    assert.ok(exported.users.every((user) => user.joinedAt));
    assert.ok(exported.pickems.every((pick) => pick.createdAt && pick.updatedAt));
    assert.ok(exported.cbQuestions[0].answers[0].createdAt);
    assert.ok(exported.leagueWeeks[0].rosters.every((slot) => slot.lockedAt));
    assert.ok(exported.leagueWeeks[0].scores.every((score) => score.calculatedAt));
    const checkpoint = await createStoredLeagueBackup(league.id, owner.id, "After Week 1", client);
    await assert.rejects(() => deleteLeagueWithRecovery(league.id, participant.id, client), /owner access/i);

    await deleteLeagueWithRecovery(league.id, owner.id, client);
    assert.equal(await client.league.count(), 0);
    assert.equal(await client.user.count(), 2);
    assert.equal(await client.tournament.count(), 1);
    assert.equal(await client.leagueBackup.count({ where: { sourceDeletedAt: { not: null } } }), 2);

    const restored = await restoreStoredBackupAsLeague(checkpoint.id, owner.id, client);
    assert.equal(restored.name, "Round Trip League");
    assert.notEqual(restored.inviteCode, "INVITE");
    assert.equal(await client.leagueMembership.count({ where: { leagueId: restored.id } }), 2);
    assert.equal(await client.fantasyTeam.count({ where: { leagueId: restored.id } }), 2);
    assert.equal(await client.draftPick.count({ where: { leagueId: restored.id } }), 2);
    assert.equal(await client.pickem.count({ where: { leagueId: restored.id } }), 1);
    assert.equal(await client.crystalBallAnswer.count({ where: { question: { leagueId: restored.id } } }), 1);
    assert.equal(await client.weeklyRosterSlot.count({ where: { leagueWeek: { leagueId: restored.id } } }), 2);
    assert.equal(await client.weeklyScore.count({ where: { leagueWeek: { leagueId: restored.id } } }), 1);

    await client.pickem.updateMany({ where: { leagueId: restored.id }, data: { predictedScore: "2-1" } });
    const imported = await importLeague(restored.id, exported, owner.id, client);
    assert.deepEqual(imported, { ok: true });
    assert.equal((await client.pickem.findFirstOrThrow({ where: { leagueId: restored.id } })).predictedScore, "2-0");
    assert.equal(await client.leagueBackup.count({ where: { originalLeagueId: restored.id } }), 1);
    await assert.rejects(() => deleteStoredLeagueBackup(checkpoint.id, participant.id, client), /do not own/i);
  } finally {
    await client.$disconnect();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
