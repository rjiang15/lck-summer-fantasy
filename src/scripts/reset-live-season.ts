// Reset the live database to Week 0 while preserving league membership,
// account credentials, league configuration, and Crystal Ball questions.
// Always archive dev.db before running this command.

import { prisma } from "../lib/db";

async function main() {
  await prisma.$transaction(async (tx) => {
    await tx.weeklyScore.deleteMany();
    await tx.weeklyRosterSlot.deleteMany();
    await tx.leagueWeek.deleteMany();
    await tx.crystalBallAnswer.deleteMany();
    await tx.pickem.deleteMany();
    await tx.rosterSlot.deleteMany();

    await tx.gameEvent.deleteMany();
    await tx.playerTimelineSnapshot.deleteMany();
    await tx.teamTimelineSnapshot.deleteMany();
    await tx.statProvenance.deleteMany();
    await tx.draftAction.deleteMany();
    await tx.playerGameStat.deleteMany();
    await tx.teamGameStat.deleteMany();
    await tx.game.deleteMany();
    await tx.match.deleteMany();
    await tx.week.deleteMany();
    await tx.proPlayer.deleteMany();
    await tx.proTeam.deleteMany();
    await tx.tournament.deleteMany();
    await tx.ingestionRun.deleteMany();

    await tx.crystalBallQuestion.updateMany({
      data: { correctAnswer: null, partialAnswers: null },
    });
    await tx.league.updateMany({
      data: {
        name: "LCK 2026 Pipeline Test",
        currentWeek: 0,
        seasonStatus: "PRESEASON",
        crystalBallLockedAt: null,
        isSimulation: false,
      },
    });
  });

  const league = await prisma.league.findFirst({
    include: { fantasyTeams: true, cbQuestions: true },
  });
  console.log({
    league: league?.name ?? null,
    currentWeek: league?.currentWeek ?? null,
    participants: league?.fantasyTeams.length ?? 0,
    crystalBallQuestions: league?.cbQuestions.length ?? 0,
    tournaments: await prisma.tournament.count(),
    games: await prisma.game.count(),
    rosters: await prisma.rosterSlot.count(),
    picks: await prisma.pickem.count(),
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
