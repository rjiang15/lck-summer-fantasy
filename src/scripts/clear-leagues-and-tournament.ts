// Destructive maintenance command used when rebuilding one shared tournament.
// User accounts and every other tournament remain intact.
// Usage: npm run data:clear -- "<Tournament id>" --confirm

import { prisma } from "../lib/db";

async function main() {
  const tournamentId = process.argv[2];
  if (!tournamentId || !process.argv.includes("--confirm")) {
    throw new Error('Usage: npm run data:clear -- "<Tournament id>" --confirm');
  }

  const before = {
    leagues: await prisma.league.count(),
    matches: await prisma.match.count({ where: { tournamentId } }),
    games: await prisma.game.count({ where: { match: { tournamentId } } }),
    playerStats: await prisma.playerGameStat.count({ where: { game: { match: { tournamentId } } } }),
  };

  await prisma.$transaction(async (tx) => {
    // CrystalBallAnswer does not cascade from its question, so remove it before
    // deleting the leagues. All other league-owned rows cascade from League.
    await tx.crystalBallAnswer.deleteMany();
    await tx.league.deleteMany();

    const gameScope = { game: { match: { tournamentId } } };
    await tx.gameEvent.deleteMany({ where: gameScope });
    await tx.playerTimelineSnapshot.deleteMany({ where: gameScope });
    await tx.teamTimelineSnapshot.deleteMany({ where: gameScope });
    await tx.statProvenance.deleteMany({ where: gameScope });
    await tx.draftAction.deleteMany({ where: gameScope });
    await tx.playerGameStat.deleteMany({ where: gameScope });
    await tx.teamGameStat.deleteMany({ where: gameScope });
    await tx.game.deleteMany({ where: { match: { tournamentId } } });
    await tx.match.deleteMany({ where: { tournamentId } });
    await tx.week.deleteMany({ where: { tournamentId } });
    await tx.tournamentPlayer.deleteMany({ where: { tournamentId } });
    await tx.proPlayer.updateMany({ where: { tournamentId }, data: { tournamentId: null } });
    await tx.tournament.deleteMany({ where: { id: tournamentId } });
    await tx.ingestionRun.deleteMany({ where: { tournamentId } });
  }, { timeout: 30_000 });

  console.log({ cleared: tournamentId, before, usersPreserved: await prisma.user.count() });
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
